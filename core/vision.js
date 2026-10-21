/*
 * 拍照 / 小票识别、笔记整理成菜谱：提示词、调用 OpenAI 兼容接口、清理模型返回。
 * 浏览器里挂在 window.CookVisionApi，Node 里 require 也能用（server/vision-proxy.js 在用）。
 *
 * 用的是你自己的接口和密钥，本项目不提供任何识别服务。
 * 接口要求：OpenAI 兼容的 POST {base}/chat/completions，模型能看图。
 *
 *   CookVisionApi.recognize({ base, key, model, timeout }, dataUrl, 'stock' | 'receipt')
 *     → Promise<[{ name, qty, unit, count, weight_g, note }]>
 *   CookVisionApi.recipeFromNote({ base, key, model }, { title, text, images: [dataUrl...] })
 *     → Promise<{ title, category, minutes, serves, ingredients: [{ name, amount }], seasonings, optional, steps, source }>
 *   只有文字时不需要模型能看图；带截图时要能看图。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CookVisionApi = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var UNITS = ['克', '个', '根', '包', '块', '条', '碗', '朵', '毫升', '瓶', '袋', '两', '斤', '千克'];
  var DEFAULT_BASE = 'https://api.openai.com/v1';
  var DEFAULT_MODEL = 'gpt-4o-mini';

  var FIELDS = [
    '对每一样给出：',
    '- name: 中文通用名，尽量用家常叫法（西红柿写成番茄，西红柿和番茄视为同一种）',
    '- count: 能数清的个数或件数，数不清则为 null',
    '- weight_g: 重量（克）。小票上写了克/斤/两/千克就换算成克；没有则为 null',
    '- qty: 建议记入库存的数字',
    '- unit: 必须是 克/个/根/包/块/条/碗/朵/毫升/瓶/袋 之一',
    '- note: 不确定时的一句中文说明；确定则空字符串',
    '只输出 JSON 对象：{"items":[...]}。看不出食材时输出 {"items":[]}。'
  ].join('\n');

  var PROMPTS = {
    stock: {
      system: '你是家庭厨房库存助手。只根据照片里真实可见的食材作答，不要编造看不到的东西。只输出 JSON，不要 markdown。',
      user: [
        '这是一张家里台面或冰箱里食材的照片。请识别能用于做饭的食材（蔬菜、肉禽、水产、蛋豆、主食等）。',
        '忽略盘子、厨具、人、纯调料瓶（盐生抽等如果非常明显也可以列，但优先固体食材）。',
        '一张图里可能有好几样，请尽量分开列。',
        FIELDS
      ].join('')
    },
    receipt: {
      system: '你是家庭厨房库存助手。只根据购物小票上的文字抽出能做饭的食材，不要编造小票上没有的行。只输出 JSON，不要 markdown。',
      user: [
        '这是一张超市/菜市场/商店的购物小票（收据）照片。请只提取食材、肉蛋奶、主食、蔬菜水果等可以进厨房库存的商品行。',
        '跳过非食材：购物袋、塑料袋、背心袋、打包盒、包装费、打包费、配送费、运费、服务费、会员、积分、微信支付、支付宝、现金、找零、税费、折扣、满减。',
        '同一商品多行请合并数量。小票上的规格（如 500g、2斤、3个）要读进 count / weight_g / qty / unit。',
        '不要把价格当成重量。',
        FIELDS
      ].join('')
    }
  };

  var RECIPE_PROMPT = {
    system: '你是家庭厨房助手，把随手记的菜谱、笔记或截图整理成家常菜谱。只根据给定文字和截图里实际出现的内容提取，不要编造看不到的步骤或用料。只输出 JSON，不要 markdown。',
    user: [
      '请从下面的内容里抽出一道能在家做的菜。内容可能很随意，用料和步骤可能混在一段话里，也可能只写在截图上。',
      '输出 JSON 对象，字段：',
      '- title: 菜名，去掉表情和营销词',
      '- category: 只能是 荤菜 / 素菜 / 蛋类 / 汤 / 主食 之一',
      '- minutes: 大约几分钟，看不出来则为 null',
      '- serves: 1 到 4 的整数，默认 2',
      '- ingredients: [{ "name": 食材中文名, "amount": 原文用量如"2个""150克""适量" }]，不要把调料放这里',
      '- seasonings: 调料名数组，如 盐、生抽、葱、姜、蒜、食用油',
      '- optional: 可选调料',
      '- steps: 做法步骤字符串数组，一句一步，不要带"步骤1"',
      '跳过清水。不是菜谱时 ingredients 和 steps 都给空数组。'
    ].join('\n')
  };
  var RCATS = ['荤菜', '素菜', '蛋类', '汤', '主食'];
  var MAX_NOTE_IMAGES = 4;

  function normalizeMode(m) {
    var s = String(m || '').trim().toLowerCase();
    return s === 'receipt' || s === 'ticket' || s === '小票' ? 'receipt' : 'stock';
  }
  function promptForMode(mode) { return PROMPTS[normalizeMode(mode)]; }

  function fail(status, message) { var e = new Error(message); e.status = status; return e; }

  function parseModelJson(text) {
    var s = String(text || '').trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    var start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start < 0 || end <= start) throw fail(502, '模型没有返回可识别的结果');
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { throw fail(502, '模型返回的内容读不出来'); }
  }

  function num(v) {
    if (typeof v === 'number' && isFinite(v) && v > 0) return Math.round(v * 100) / 100;
    if (typeof v === 'string') {
      var n = parseFloat(v.replace(/[^\d.]/g, ''));
      if (isFinite(n) && n > 0) return Math.round(n * 100) / 100;
    }
    return null;
  }

  function sanitizeItems(raw) {
    var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
    var out = [];
    for (var i = 0; i < list.length && out.length < 30; i++) {
      var it = list[i];
      if (!it || typeof it !== 'object') continue;
      var name = String(it.name || '').replace(/\s+/g, '').slice(0, 20);
      if (!name) continue;
      var unit = UNITS.indexOf(String(it.unit || '').trim()) >= 0 ? String(it.unit).trim() : '';
      var item = { name: name, qty: num(it.qty), unit: unit, count: num(it.count), weight_g: num(it.weight_g), note: String(it.note || '').trim().slice(0, 80) };
      if (!item.qty && !item.count && !item.weight_g) item.qty = null;
      out.push(item);
    }
    return out;
  }

  function clipStr(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }

  function sanitizeRecipe(raw, source) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var cat = RCATS.indexOf(clipStr(src.category, 4)) >= 0 ? clipStr(src.category, 4) : '';
    var minutes = Number(src.minutes), serves = Number(src.serves);
    var ingredients = [], seen = {};
    (Array.isArray(src.ingredients) ? src.ingredients : []).forEach(function (it) {
      if (ingredients.length >= 40 || !it) return;
      var name = clipStr(it.name, 20).replace(/\s+/g, '');
      if (!name || seen[name]) return;
      seen[name] = 1;
      ingredients.push({ name: name, amount: clipStr(it.amount, 24) });
    });
    function names(list) {
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (x) {
        var n = clipStr(x, 16).replace(/\s+/g, '');
        if (n && out.indexOf(n) < 0 && out.length < 20) out.push(n);
      });
      return out;
    }
    var url = String(source || src.source || '').trim();
    return {
      title: clipStr(src.title, 40),
      category: cat,
      minutes: isFinite(minutes) && minutes > 0 ? Math.min(300, Math.round(minutes)) : 0,
      serves: isFinite(serves) && serves >= 1 ? Math.min(4, Math.round(serves)) : 2,
      ingredients: ingredients,
      seasonings: names(src.seasonings),
      optional: names(src.optional),
      steps: (Array.isArray(src.steps) ? src.steps : []).map(function (x) { return clipStr(x, 120); }).filter(Boolean).slice(0, 40),
      source: /^https?:\/\//i.test(url) ? url : ''
    };
  }

  // 补全配置：base 去掉末尾斜杠和误填的 /chat/completions
  function config(c) {
    c = c || {};
    var base = String(c.base || DEFAULT_BASE).trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    return {
      base: base,
      key: String(c.key || '').trim(),
      model: String(c.model || DEFAULT_MODEL).trim(),
      timeout: +c.timeout || 45000
    };
  }

  function chatRequest(cfg, messages, maxTokens) {
    return {
      url: cfg.base + '/chat/completions',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
        body: JSON.stringify({ model: cfg.model, temperature: 0.1, max_tokens: maxTokens, messages: messages })
      }
    };
  }

  function buildRequest(cfg, dataUrl, mode) {
    var p = promptForMode(mode);
    return chatRequest(cfg, [
      { role: 'system', content: p.system },
      { role: 'user', content: [{ type: 'text', text: p.user }, { type: 'image_url', image_url: { url: dataUrl } }] }
    ], 1200);
  }

  // note: { title, text, images: [dataUrl] }
  function buildRecipeRequest(cfg, note) {
    var images = (note.images || []).filter(function (x) { return /^data:image\//.test(String(x)); }).slice(0, MAX_NOTE_IMAGES);
    var text = RECIPE_PROMPT.user + '\n\n标题：' + (clipStr(note.title, 40) || '（无）') + '\n原文：\n' + (String(note.text || '').trim().slice(0, 8000) || '（无文字，请看截图）');
    var content = images.length
      ? [{ type: 'text', text: text }].concat(images.map(function (u) { return { type: 'image_url', image_url: { url: u } }; }))
      : text;
    return chatRequest(cfg, [{ role: 'system', content: RECIPE_PROMPT.system }, { role: 'user', content: content }], 2500);
  }

  // 发请求、处理常见错误、读出模型返回的 JSON
  function callChat(cfg, req, fetchImpl) {
    var doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!cfg.key) return Promise.reject(fail(400, '还没填 API 密钥'));
    if (!doFetch) return Promise.reject(fail(500, '当前环境没有 fetch'));
    var timer = null, ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctrl) { req.init.signal = ctrl.signal; timer = setTimeout(function () { ctrl.abort(); }, cfg.timeout); }
    return doFetch(req.url, req.init).then(function (r) {
      return r.text().then(function (text) {
        var json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        if (r.status === 401 || r.status === 403) throw fail(502, '接口说密钥无效，请检查 API 密钥');
        if (r.status === 404) throw fail(502, '接口地址不对（404），请检查接口地址和模型名');
        if (r.status === 429) throw fail(429, '接口正忙或额度用完了，稍后再试');
        if (!r.ok) {
          var msg = json && json.error && json.error.message ? String(json.error.message).slice(0, 120) : '';
          throw fail(502, msg ? '接口出错：' + msg : '接口出错（' + r.status + '）');
        }
        var content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
        return parseModelJson(content);
      });
    }, function (e) {
      if (e && e.name === 'AbortError') throw fail(504, '请求超时，稍后再试');
      if (e && e.status) throw e;
      // 浏览器里跨域被拦也会走到这里
      throw fail(502, '连不上接口。如果接口不允许浏览器直接调用（跨域），请改用 server.js 代为调用');
    }).then(function (v) { if (timer) clearTimeout(timer); return v; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  // 拍照 / 小票识别
  function recognize(c, dataUrl, mode, fetchImpl) {
    var cfg = config(c);
    return callChat(cfg, buildRequest(cfg, dataUrl, mode), fetchImpl).then(sanitizeItems);
  }

  // 笔记文字 / 截图整理成菜谱
  function recipeFromNote(c, note, fetchImpl) {
    var cfg = config(c);
    note = note || {};
    if (!String(note.text || '').trim() && !(note.images || []).length && !String(note.title || '').trim()) {
      return Promise.reject(fail(400, '请贴菜谱文字，或上传截图'));
    }
    return callChat(cfg, buildRecipeRequest(cfg, note), fetchImpl).then(function (raw) { return sanitizeRecipe(raw, note.source); });
  }

  return {
    DEFAULT_BASE: DEFAULT_BASE, DEFAULT_MODEL: DEFAULT_MODEL, PROMPTS: PROMPTS,
    normalizeMode: normalizeMode, promptForMode: promptForMode, parseModelJson: parseModelJson,
    sanitizeItems: sanitizeItems, config: config, buildRequest: buildRequest, recognize: recognize,
    RECIPE_PROMPT: RECIPE_PROMPT, MAX_NOTE_IMAGES: MAX_NOTE_IMAGES, sanitizeRecipe: sanitizeRecipe,
    buildRecipeRequest: buildRecipeRequest, recipeFromNote: recipeFromNote
  };
});
