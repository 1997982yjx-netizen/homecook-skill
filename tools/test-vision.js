#!/usr/bin/env node
/*
 * 测试拍照录入：字典对照、数量换算、模型 JSON 清理。不访问网络。
 *   node tools/test-vision.js
 * 识图接口用假的 fetch 代替，不会真的发请求。
 */
'use strict';
const assert = require('assert');
const { Readable } = require('stream');
const V = require('../core/vision-map.js');
const A = require('../core/vision.js');
const P = require('../server/vision-proxy.js');
const DATA = require('../recipes.js');
const dict = {
  ingredients: DATA.ingredients,
  alias: DATA.alias,
  seasonings: DATA.seasonings,
  customIng: {}
};

let n = 0;
function test(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

test('别名西红柿记成番茄，按个数', () => {
  const rows = V.mapItems([{ name: '西红柿', count: 4, qty: 4, unit: '个' }], dict);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].kind, 'stock');
  assert.strictEqual(rows[0].name, '番茄');
  assert.strictEqual(rows[0].unit, '个');
  assert.strictEqual(rows[0].qty, 4);
  assert.strictEqual(rows[0].known, true);
});

test('五花肉用斤换算成克', () => {
  const rows = V.mapItems([{ name: '五花肉', qty: 1, unit: '斤', weight_g: 500 }], dict);
  assert.strictEqual(rows[0].name, '五花肉');
  assert.strictEqual(rows[0].unit, '克');
  assert.strictEqual(rows[0].qty, 500);
});

test('番茄只给了克数时按常见重量估算个数', () => {
  const rows = V.mapItems([{ name: '番茄', unit: '克', weight_g: 300 }], dict);
  assert.strictEqual(rows[0].unit, '个');
  assert.strictEqual(rows[0].qty, 2);
});

test('青菜按克记，个数会换成克', () => {
  const rows = V.mapItems([{ name: '小白菜', count: 1, unit: '把' }], dict);
  assert.strictEqual(rows[0].name, '青菜');
  assert.strictEqual(rows[0].unit, '克');
  assert.ok(rows[0].qty > 0);
});

test('调料不进库存行', () => {
  const rows = V.mapItems([{ name: '生抽', qty: 1, unit: '瓶' }, { name: '盐', count: 1, unit: '包' }], dict);
  assert.deepStrictEqual(rows.map((r) => r.kind + ':' + r.name), ['spice:生抽', 'spice:盐']);
});

test('同名多条合并数量', () => {
  const rows = V.mapItems([
    { name: '鸡蛋', count: 3, unit: '个' },
    { name: '鸡蛋', count: 2, unit: '个' }
  ], dict);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].qty, 5);
});

test('字典没有的食材保留，并标成新食材', () => {
  const rows = V.mapItems([{ name: '秋葵', count: 8, unit: '根' }], dict);
  assert.strictEqual(rows[0].name, '秋葵');
  assert.strictEqual(rows[0].known, false);
  assert.strictEqual(rows[0].unit, '根');
  assert.strictEqual(rows[0].qty, 8);
  assert.ok(/新食材/.test(rows[0].note));
});

test('水和盘子被丢掉', () => {
  const rows = V.mapItems([{ name: '清水' }, { name: '盘子' }, { name: '黄瓜', count: 2, unit: '根' }], dict);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, '黄瓜');
});

test('小票上的袋子和费用被丢掉', () => {
  const rows = V.mapItems([
    { name: '购物袋', qty: 1, unit: '个' },
    { name: '打包费', qty: 1, unit: '个' },
    { name: '西红柿', count: 2, unit: '个' }
  ], dict);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, '番茄');
});

test('mode 缺省是 stock，receipt / 小票 会换成 receipt', () => {
  assert.strictEqual(A.normalizeMode(), 'stock');
  assert.strictEqual(A.normalizeMode('stock'), 'stock');
  assert.strictEqual(A.normalizeMode('receipt'), 'receipt');
  assert.strictEqual(A.normalizeMode('小票'), 'receipt');
});

test('小票提示词会要求跳过袋子和费用', () => {
  const p = A.promptForMode('receipt');
  assert.ok(/小票/.test(p.user));
  assert.ok(/购物袋/.test(p.user));
  assert.ok(!/台面或冰箱/.test(p.user));
  const s = A.promptForMode('stock');
  assert.ok(/台面或冰箱/.test(s.user));
});

test('模型把 JSON 包在代码块里也能读出来', () => {
  const j = A.parseModelJson('```json\n{"items":[{"name":"土豆","qty":2,"unit":"个"}]}\n```');
  assert.strictEqual(j.items[0].name, '土豆');
});

test('sanitize 丢掉空名字、截断过长字段、限制条数', () => {
  const items = A.sanitizeItems({
    items: [
      { name: '  番 茄  ', qty: '3', unit: '个', count: 3, weight_g: -1, note: 'x'.repeat(200) },
      { name: '', qty: 1, unit: '个' },
      { name: '五花肉', qty: 1, unit: '炸弹' }
    ]
  });
  assert.strictEqual(items[0].name, '番茄');
  assert.strictEqual(items[0].qty, 3);
  assert.strictEqual(items[0].note.length, 80);
  assert.strictEqual(items[1].name, '五花肉');
  assert.strictEqual(items[1].unit, '');
});

test('data URL 能拆出 jpeg', () => {
  const p = P.parseDataUrl('data:image/jpeg;base64,/9j/4AAQ');
  assert.strictEqual(p.mime, 'image/jpeg');
  assert.ok(p.b64.length > 0);
});

test('请求体里的 mode 会读出来', () => {
  const p = P.parseVisionBody(Buffer.from(JSON.stringify({
    image: 'data:image/jpeg;base64,/9j/4AAQ',
    mode: 'receipt'
  })));
  assert.strictEqual(p.mode, 'receipt');
  assert.ok(/^data:image\/jpeg;base64,/.test(p.dataUrl));
});

test('接口地址多写了 /chat/completions 或斜杠会被去掉', () => {
  assert.strictEqual(A.config({ base: 'https://example.com/v1/chat/completions' }).base, 'https://example.com/v1');
  assert.strictEqual(A.config({ base: 'https://example.com/v1/' }).base, 'https://example.com/v1');
  assert.strictEqual(A.config({}).base, A.DEFAULT_BASE);
  assert.strictEqual(A.config({}).model, A.DEFAULT_MODEL);
});

test('请求只带用户自己的密钥，发到用户填的地址', () => {
  const req = A.buildRequest(A.config({ base: 'https://example.com/v1', key: 'k-123', model: 'm' }), 'data:image/jpeg;base64,xx', 'receipt');
  assert.strictEqual(req.url, 'https://example.com/v1/chat/completions');
  assert.strictEqual(req.init.headers.Authorization, 'Bearer k-123');
  assert.deepStrictEqual(Object.keys(req.init.headers).sort(), ['Authorization', 'Content-Type']);
  const body = JSON.parse(req.init.body);
  assert.strictEqual(body.model, 'm');
  assert.ok(/小票/.test(body.messages[1].content[0].text));
});

test('没有密钥时配置是空的', () => {
  const prev = process.env.VISION_API_KEY;
  const prev2 = process.env.OPENAI_API_KEY;
  delete process.env.VISION_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.strictEqual(P.apiConfig().key, '');
  } finally {
    if (prev !== undefined) process.env.VISION_API_KEY = prev;
    if (prev2 !== undefined) process.env.OPENAI_API_KEY = prev2;
  }
});

function callHandler(method, body, url, handler) {
  return new Promise((resolve) => {
    const req = Readable.from([Buffer.from(body || '')]);
    req.method = method;
    req.url = url || '/api/vision-stock';
    req.headers = { 'content-type': 'application/json' };
    req.socket = { remoteAddress: '127.0.0.1' };
    const res = {
      writeHead: function (status, headers) { this.status = status; this.headers = headers; },
      end: function (buf) { this.body = buf ? String(buf) : ''; resolve(this); }
    };
    (handler || P.handleVisionStock)(req, res);
  });
}

function fakeFetch(status, payload, seen) {
  return (url, init) => {
    if (seen) seen.push({ url, init });
    return Promise.resolve({ status, ok: status >= 200 && status < 300, text: () => Promise.resolve(JSON.stringify(payload)) });
  };
}
const MODEL_OK = { choices: [{ message: { content: '```json\n{"items":[{"name":"西红柿","count":3,"qty":3,"unit":"个"}]}\n```' } }] };

async function extra() {
  {
    const seen = [];
    const items = await A.recognize({ key: 'k', base: 'https://example.com/v1' }, 'data:image/jpeg;base64,xx', 'stock', fakeFetch(200, MODEL_OK, seen));
    assert.strictEqual(items[0].name, '西红柿');
    assert.strictEqual(seen[0].url, 'https://example.com/v1/chat/completions');
    await assert.rejects(A.recognize({}, 'data:image/jpeg;base64,xx', 'stock', fakeFetch(200, MODEL_OK)), /密钥/);
    await assert.rejects(A.recognize({ key: 'k' }, 'x', 'stock', fakeFetch(401, {})), /密钥无效/);
    await assert.rejects(A.recognize({ key: 'k' }, 'x', 'stock', fakeFetch(404, {})), /地址不对/);
    await assert.rejects(A.recognize({ key: 'k' }, 'x', 'stock', () => Promise.reject(new TypeError('Failed to fetch'))), /server\.js/);
    n += 1;
    console.log('  ✓ 浏览器直连：成功、没密钥、密钥错、地址错、跨域被拦都有明确说明');
  }
  {
    const seen = [];
    const RECIPE_OK = { choices: [{ message: { content: JSON.stringify({ title: ' 番茄炒蛋 ', category: '蛋类', minutes: '10', serves: 9, ingredients: [{ name: '番茄', amount: '2个' }, { name: '番茄', amount: '1个' }, { name: '', amount: 'x' }], seasonings: ['盐', '盐', '糖'], steps: ['切', ' ', '炒'] }) } }] };
    const r = await A.recipeFromNote({ key: 'k', base: 'https://example.com/v1' }, { text: '番茄两个 鸡蛋三个', images: ['data:image/jpeg;base64,xx', 'not-an-image'], source: 'https://example.com/n/1' }, fakeFetch(200, RECIPE_OK, seen));
    assert.strictEqual(r.title, '番茄炒蛋');
    assert.strictEqual(r.serves, 4);
    assert.strictEqual(r.minutes, 10);
    assert.deepStrictEqual(r.ingredients, [{ name: '番茄', amount: '2个' }]);
    assert.deepStrictEqual(r.seasonings, ['盐', '糖']);
    assert.deepStrictEqual(r.steps, ['切', '炒']);
    assert.strictEqual(r.source, 'https://example.com/n/1');
    const body = JSON.parse(seen[0].init.body);
    assert.strictEqual(body.messages[1].content.filter((c) => c.type === 'image_url').length, 1, '只发合法的截图');
    const textOnly = JSON.parse(A.buildRecipeRequest(A.config({ key: 'k' }), { text: '只有文字' }).init.body);
    assert.strictEqual(typeof textOnly.messages[1].content, 'string', '只有文字时不带图片');
    await assert.rejects(A.recipeFromNote({ key: 'k' }, {}, fakeFetch(200, RECIPE_OK)), /贴菜谱文字/);
    n += 1;
    console.log('  ✓ 菜谱整理：结果清理、只发合法截图、纯文字不带图、空内容会提示');
  }
  const prev = process.env.VISION_API_KEY;
  const prev2 = process.env.OPENAI_API_KEY;
  delete process.env.VISION_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const get = await callHandler('GET', '');
    assert.strictEqual(get.status, 405);
    const opt = await callHandler('OPTIONS', '');
    assert.strictEqual(opt.status, 204);
    const post = await callHandler('POST', '{"image":"data:image/jpeg;base64,xx"}');
    assert.strictEqual(post.status, 503);
    const j = JSON.parse(post.body);
    assert.strictEqual(j.ok, false);
    assert.ok(/VISION_API_KEY/.test(j.error));
    assert.ok(!('Access-Control-Allow-Origin' in post.headers), '默认不允许跨域');
    n += 3;
    console.log('  ✓ GET 被拒绝、OPTIONS 放行、没密钥时 POST 返回 503、默认不开跨域');

    process.env.VISION_API_KEY = 'server-key';
    const seen = [];
    P.setFetch(fakeFetch(200, MODEL_OK, seen));
    const ok = await callHandler('POST', JSON.stringify({ image: 'data:image/jpeg;base64,/9j/4AAQ', mode: 'stock' }));
    const jo = JSON.parse(ok.body);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(jo.items[0].name, '西红柿');
    assert.strictEqual(seen[0].init.headers.Authorization, 'Bearer server-key');
    assert.ok(!/server-key/.test(ok.body), '密钥不会回给页面');
    n += 1;
    console.log('  ✓ 代理用服务器环境变量里的密钥，密钥不会回给页面');
    const note = await callHandler('POST', JSON.stringify({ text: '番茄炒蛋：番茄2个，鸡蛋3个' }), '/api/recipe-from-note', P.handleRecipeFromNote);
    assert.strictEqual(note.status, 200);
    const empty = await callHandler('POST', JSON.stringify({}), '/api/recipe-from-note', P.handleRecipeFromNote);
    assert.strictEqual(empty.status, 400);
    n += 1;
    console.log('  ✓ 代理的菜谱整理接口可用，空内容返回 400');
    delete process.env.VISION_API_KEY;
  } finally {
    if (prev !== undefined) process.env.VISION_API_KEY = prev;
    if (prev2 !== undefined) process.env.OPENAI_API_KEY = prev2;
  }
}

extra().then(() => {
  console.log(`\n${n} 项测试全部通过。`);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
