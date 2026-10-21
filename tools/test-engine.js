#!/usr/bin/env node
/*
 * 测试做饭引擎：用量换算、能做/差一两样/差得多的分组、排序、扣库存、购物清单。不访问网络。
 *   node tools/test-engine.js
 */
'use strict';
const assert = require('assert');
const CookEngine = require('../core/engine.js');
const DATA = require('../recipes.js');

const E = CookEngine.create(DATA);
const NOW = new Date(2026, 9, 21, 12).getTime();
let n = 0;
function test(name, fn) { fn(); n++; console.log('  ✓ ' + name); }
function state(stock, extra) {
  const S = E.normalize(Object.assign({ stock: {} }, extra || {}));
  Object.keys(stock).forEach((k) => {
    const v = stock[k];
    S.stock[k] = typeof v === 'number' ? { qty: v, exp: null, at: NOW } : Object.assign({ at: NOW }, v);
  });
  return S;
}
function names(list) { return list.map((a) => a.r.name); }

test('内置菜谱都能读进来，没有不在字典里的食材', () => {
  assert.strictEqual(E.recipes.length, DATA.recipes.length);
  assert.deepStrictEqual(E.warnings, []);
});

test('用量换算：计数向上取整，克取到 5 的倍数', () => {
  assert.strictEqual(CookEngine.scaled(3, '个', 1, 2), 2);
  assert.strictEqual(CookEngine.scaled(3, '个', 3, 2), 5);
  assert.strictEqual(CookEngine.scaled(250, '克', 3, 2), 375);
  assert.strictEqual(CookEngine.scaled(250, '克', 1, 4), 65);
  assert.strictEqual(CookEngine.scaled(1, '克', 1, 4), 5);
});

test('斤、两、千克换算成克', () => {
  assert.strictEqual(CookEngine.toGrams(1, '斤'), 500);
  assert.strictEqual(CookEngine.toGrams(3, '两'), 150);
  assert.strictEqual(CookEngine.toGrams(0.5, '千克'), 500);
  assert.strictEqual(CookEngine.toGrams(2, '个'), null);
});

test('常见叫法会换成字典里的名字', () => {
  const S = state({});
  assert.strictEqual(E.normName(S, '西红柿'), '番茄');
  assert.strictEqual(E.normName(S, ' 番 茄 '), '番茄');
});

test('番茄炒蛋：东西够就是能做，少一样是差一两样', () => {
  const r = E.findRecipe(state({}), '番茄炒蛋');
  assert.ok(r);
  const enough = {};
  Object.keys(r.items).forEach((k) => { enough[k] = r.items[k] * 5; });
  const S = state(enough);
  assert.strictEqual(E.analyze(S, r, 2, NOW).status, 'ok');
  const first = Object.keys(r.items)[0];
  delete S.stock[first];
  const a = E.analyze(S, r, 2, NOW);
  assert.strictEqual(a.status, 'near');
  assert.strictEqual(a.miss[0].n, first);
});

test('缺的调料也算缺；可选调料不算', () => {
  const r = E.findRecipe(state({}), '番茄炒蛋');
  const enough = {};
  Object.keys(r.items).forEach((k) => { enough[k] = r.items[k] * 5; });
  const S = state(enough, { spices: [] });
  const a = E.analyze(S, r, 2, NOW);
  assert.strictEqual(a.mc, (r.s || []).length);
  assert.ok(a.sp.filter((x) => x.opt).every((x) => a.missSp.indexOf(x.n) < 0));
});

test('空库存时没有能做的菜', () => {
  const p = E.plan(state({}), { servings: 2, now: NOW });
  assert.strictEqual(p.ok.length, 0);
  assert.ok(p.far.length > 0);
});

test('快过期的食材能用上的菜排在前面', () => {
  const S = state({ '鸡蛋': 10, '番茄': 5, '黄瓜': { qty: 3, exp: '2026-10-22' } });
  const p = E.plan(S, { servings: 2, now: NOW });
  const okNames = names(p.ok);
  assert.ok(okNames.length >= 2, okNames.join(','));
  assert.ok(p.ok[0].exp.indexOf('黄瓜') >= 0, '第一道应该用到快过期的黄瓜：' + okNames.join(','));
  assert.deepStrictEqual(E.expiringStock(S, NOW), ['黄瓜']);
});

test('两天内做过的菜往后放', () => {
  const S = state({ '鸡蛋': 10, '番茄': 5, '黄瓜': 3 });
  const before = names(E.plan(S, { servings: 2, now: NOW }).ok);
  const top = E.findRecipe(S, before[0]);
  S.log[top.id] = NOW - 3600e3;
  const after = names(E.plan(S, { servings: 2, now: NOW }).ok);
  assert.notStrictEqual(after[0], before[0]);
});

test('按分类筛选', () => {
  const S = state({ '鸡蛋': 10, '番茄': 5 });
  const p = E.plan(S, { servings: 2, category: '汤', now: NOW });
  p.ok.concat(p.near, p.far).forEach((a) => assert.strictEqual(a.r.cat, '汤'));
});

test('做好了会按人份扣库存，用完的删掉，并记下时间', () => {
  const r = E.findRecipe(state({}), '番茄炒蛋');
  const stock = {};
  Object.keys(r.items).forEach((k) => { stock[k] = r.items[k]; });
  const S = state(stock);
  const res = E.cook(S, r, r.base, NOW);
  assert.strictEqual(res.lacking, false);
  Object.keys(r.items).forEach((k) => assert.ok(!S.stock[k], k + ' 应该用完了'));
  assert.strictEqual(S.log[r.id], NOW);
});

test('库存不够也能做，标记 lacking', () => {
  const r = E.findRecipe(state({}), '番茄炒蛋');
  const S = state({});
  assert.strictEqual(E.cook(S, r, 2, NOW).lacking, true);
});

test('缺的加进购物清单，重复加会合并数量', () => {
  const r = E.findRecipe(state({}), '番茄炒蛋');
  const S = state({}, { spices: [] });
  const mc = E.missToShop(S, r, 2);
  assert.strictEqual(mc, Object.keys(r.items).length + (r.s || []).length);
  const first = S.shop[0];
  const q = first.q;
  E.missToShop(S, r, 2);
  assert.strictEqual(S.shop.filter((x) => x.n === first.n).length, 1);
  assert.strictEqual(S.shop[0].q, q * 2);
});

test('累加库存时到期日取更早的', () => {
  const S = state({ '番茄': { qty: 2, exp: '2026-10-30' } });
  E.addStock(S, '番茄', 3, '2026-10-25', 'add');
  assert.strictEqual(S.stock['番茄'].qty, 5);
  assert.strictEqual(S.stock['番茄'].exp, '2026-10-25');
  E.addStock(S, '番茄', 1, null, 'set');
  assert.strictEqual(S.stock['番茄'].qty, 1);
});

test('页面导出的备份可以直接读（多余字段忽略，坏数据丢掉）', () => {
  const S = E.normalize({
    v: 1, stock: { '番茄': { qty: 4, exp: '2026-10-21', at: 1 }, '坏的': { qty: -1 } },
    spices: ['盐', 3], custom: { ing: {}, recipes: [{ id: 'u1', name: '我的菜', items: { '番茄': 1 } }, { name: '缺 id' }] },
    shop: [{ n: '青椒', q: 2, u: '个', done: false }, {}], log: {}, servings: 99, photos: { x: 1 }
  });
  assert.deepStrictEqual(Object.keys(S.stock), ['番茄']);
  assert.deepStrictEqual(S.spices, ['盐']);
  assert.strictEqual(S.custom.recipes.length, 1);
  assert.strictEqual(S.shop.length, 1);
  assert.strictEqual(S.servings, 2);
  assert.ok(!('photos' in S));
  assert.ok(E.findRecipe(S, '我的菜').mine);
});

console.log(`\n${n} 项测试全部通过。`);
