/*
 * 可选：由你自己的服务器代为调用识图接口（Node 18 及以上，不需要安装依赖）。
 *
 * 什么时候用：你填的接口不允许浏览器直接调用（跨域被拦），或者你不想把密钥存在浏览器里。
 * 密钥只从你服务器的环境变量读，不会发给页面。本项目不提供任何公共识别服务。
 *
 *   POST /api/vision-stock
 *   { "image": "data:image/jpeg;base64,...", "mode": "stock" | "receipt" }
 *   → { ok: true, mode, items: [{ name, qty, unit, count, weight_g, note }] }
 *   → { ok: false, error: '原因' }
 *
 *   POST /api/recipe-from-note
 *   { "title": "", "text": "菜谱文字", "source": "原文链接（可选）", "images": ["data:image/jpeg;base64,..."] }（截图最多 4 张）
 *   → { ok: true, recipe: { title, category, minutes, serves, ingredients: [{ name, amount }], seasonings, optional, steps, source } }
 *
 *   两个接口共用同一套环境变量和限额（每个 IP 每分钟合计 8 次）。
 *
 * 环境变量：
 *   VISION_API_KEY       必填。你自己的 OpenAI 兼容接口密钥（也认 OPENAI_API_KEY）
 *   VISION_API_BASE      默认 https://api.openai.com/v1
 *   VISION_MODEL         默认 gpt-4o-mini，要能看图
 *   VISION_TIMEOUT_MS    默认 45000
 *   VISION_ALLOW_ORIGIN  页面和服务不在同一个网址时，填页面的来源（如 https://example.com）；默认不允许跨域
 */
'use strict';

const V = require('../core/vision.js');

const MAX_BODY = 2 * 1024 * 1024;
const MAX_NOTE_BODY = 6 * 1024 * 1024;
const MAX_IMAGE = 1.5 * 1024 * 1024;
const RATE = { windowMs: 60 * 1000, max: 8 };
const ALLOW_MIME = { 'image/jpeg': 1, 'image/jpg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1 };
const hits = new Map();
let doFetch = (...a) => global.fetch(...a);
function setFetch(fn) { doFetch = fn; }

function fail(status, message) { const e = new Error(message); e.status = status; return e; }

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 1000) hits.delete(hits.keys().next().value);
  return list.length > RATE.max;
}

function send(res, status, body) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const origin = (process.env.VISION_ALLOW_ORIGIN || '').trim();
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    let stopped = false;
    req.on('data', (c) => {
      if (stopped) return;
      n += c.length;
      if (n > max) {
        stopped = true;
        reject(fail(413, '图片太大，请换一张或压缩后再试'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!stopped) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function parseDataUrl(image) {
  const s = String(image || '').trim();
  const m = s.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  return m ? { mime: m[1].toLowerCase(), b64: m[2].replace(/\s+/g, '') } : null;
}

function parseVisionBody(buf) {
  let obj;
  try { obj = JSON.parse(buf.toString('utf8') || '{}'); } catch (e) { throw fail(400, '请求不是 JSON'); }
  const parsed = parseDataUrl(obj.image);
  if (!parsed) throw fail(400, '请把照片以 data URL 放在 image 字段里');
  if (!ALLOW_MIME[parsed.mime]) throw fail(400, '只接受 jpeg / png / webp 图片');
  const bytes = Buffer.from(parsed.b64, 'base64');
  if (!bytes.length) throw fail(400, '图片是空的');
  if (bytes.length > MAX_IMAGE) throw fail(413, '图片太大，请换一张或压缩后再试');
  const mime = parsed.mime === 'image/jpg' ? 'image/jpeg' : parsed.mime;
  return { dataUrl: 'data:' + mime + ';base64,' + parsed.b64, mode: V.normalizeMode(obj.mode) };
}

function parseNoteBody(buf) {
  let obj;
  try { obj = JSON.parse(buf.toString('utf8') || '{}'); } catch (e) { throw fail(400, '请求不是 JSON'); }
  const images = [];
  const raw = Array.isArray(obj.images) ? obj.images : [];
  for (let i = 0; i < raw.length && images.length < V.MAX_NOTE_IMAGES; i++) {
    const parsed = parseDataUrl(raw[i]);
    if (!parsed) continue;
    if (!ALLOW_MIME[parsed.mime]) throw fail(400, '只接受 jpeg / png / webp 图片');
    const bytes = Buffer.from(parsed.b64, 'base64');
    if (!bytes.length) continue;
    if (bytes.length > MAX_IMAGE) throw fail(413, '图片太大，请换一张或压缩后再试');
    images.push('data:' + (parsed.mime === 'image/jpg' ? 'image/jpeg' : parsed.mime) + ';base64,' + parsed.b64);
  }
  const note = { title: String(obj.title || '').slice(0, 80), text: String(obj.text || '').slice(0, 8000), source: String(obj.source || ''), images };
  if (!note.text.trim() && !note.title.trim() && !images.length) throw fail(400, '请贴菜谱文字，或上传截图');
  return note;
}

function apiConfig() {
  return V.config({
    key: process.env.VISION_API_KEY || process.env.OPENAI_API_KEY || '',
    base: process.env.VISION_API_BASE,
    model: process.env.VISION_MODEL,
    timeout: process.env.VISION_TIMEOUT_MS
  });
}

async function handleVisionStock(req, res) {
  const cfg = guard(req, res);
  if (!cfg) return;
  try {
    const body = parseVisionBody(await readBody(req, MAX_BODY));
    const items = await V.recognize(cfg, body.dataUrl, body.mode, doFetch);
    send(res, 200, { ok: true, mode: body.mode, items: items });
  } catch (e) {
    send(res, e.status || 502, { ok: false, error: e.status ? e.message : '识别失败' });
  }
}

// 共同的前置检查：方法、限额、密钥。没问题返回配置，否则已经回复了错误、返回 null
function guard(req, res) {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return null; }
  if (req.method !== 'POST') { send(res, 405, { ok: false, error: '只支持 POST' }); return null; }
  if (limited(req.socket.remoteAddress || '')) { send(res, 429, { ok: false, error: '请求太频繁，等一分钟再试' }); return null; }
  const cfg = apiConfig();
  if (!cfg.key) { send(res, 503, { ok: false, error: '服务器还没配置识图：设置环境变量 VISION_API_KEY 后重启（见 README）' }); return null; }
  return cfg;
}

async function handleRecipeFromNote(req, res) {
  const cfg = guard(req, res);
  if (!cfg) return;
  try {
    const note = parseNoteBody(await readBody(req, MAX_NOTE_BODY));
    const recipe = await V.recipeFromNote(cfg, note, doFetch);
    if (!recipe.ingredients.length && !recipe.steps.length) {
      return send(res, 200, { ok: false, error: '没认出用料和做法。把菜谱文字贴全一点，或换张清楚的截图', recipe });
    }
    send(res, 200, { ok: true, recipe });
  } catch (e) {
    send(res, e.status || 502, { ok: false, error: e.status ? e.message : '整理失败' });
  }
}

module.exports = { handleVisionStock, handleRecipeFromNote, parseVisionBody, parseNoteBody, parseDataUrl, apiConfig, setFetch };
