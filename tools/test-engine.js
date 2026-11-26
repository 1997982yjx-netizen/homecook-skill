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
    v: 1, stock: { '番茄': { qty: 4, exp: '2026-10-21', at: 1 }, '坏的': { qty: -1 }, '无穷': { qty: Infinity }, '错日期': { qty: 2, exp: '2026-02-31' } },
    spices: ['盐', '盐', '', 3], custom: { ing: { '坏食材': null, '秋葵': { u: '根', c: '蔬菜' } }, recipes: [{ id: 'u1', name: '我的菜', items: { '番茄': 1 } }, { name: '缺 id' }, { id: 'u2', name: '坏items', items: [] }] },
    shop: [{ n: '青椒', q: 2, u: '个', done: false }, {}], log: { 'r:番茄炒蛋': 123, bad: 'x' }, servings: 99, photos: { x: 1 }
  });
  assert.deepStrictEqual(Object.keys(S.stock).sort(), ['番茄', '错日期'].sort());
  assert.strictEqual(S.stock['错日期'].exp, null);
  assert.deepStrictEqual(S.spices, ['盐']);
  assert.ok(!S.custom.ing['坏食材']);
  assert.ok(Array.isArray(E.allSpices(S)));
  assert.strictEqual(S.custom.recipes.length, 1);
  assert.deepStrictEqual(S.custom.recipes[0].steps, []);
  assert.strictEqual(S.shop.length, 1);
  assert.strictEqual(S.servings, 2);
  assert.ok(!('photos' in S));
  assert.ok(E.findRecipe(S, '我的菜').mine);
});

test('parseYmd 拒绝不存在的日历日期', () => {
  assert.strictEqual(CookEngine.parseYmd('2026-02-31'), null);
  assert.strictEqual(CookEngine.parseYmd('2026-13-45'), null);
  assert.strictEqual(CookEngine.parseYmd('2024-02-29').getDate(), 29);
  assert.strictEqual(CookEngine.parseYmd('2026-02-29'), null);
});

test('一个人份时计数食材允许半份', () => {
  assert.strictEqual(CookEngine.scaled(1, '块', 1, 2), 0.5);
  assert.strictEqual(CookEngine.scaled(3, '个', 1, 2), 2);
  assert.strictEqual(CookEngine.scaled(3, '个', 3, 2), 5);
});

test('菜谱标签按耗时、调料和做法推断', () => {
  const S = state({});
  const quick = E.tagsOf(S, E.findRecipe(S, '拍黄瓜'));
  assert.ok(quick.indexOf('快手') >= 0);
  assert.ok(quick.indexOf('不辣') >= 0);
  assert.ok(quick.indexOf('免油烟') >= 0);
  const spicy = E.tagsOf(S, E.findRecipe(S, '宫保鸡丁'));
  assert.ok(spicy.indexOf('不辣') < 0);
});

test('搜索支持拼音首字母、调料和耗时筛选', () => {
  const S = state({});
  assert.ok(E.searchRecipes(S, { q: 'fqcd' }).some((r) => r.name === '番茄炒蛋'));
  assert.ok(E.searchRecipes(S, { q: '八角' }).some((r) => r.name === '红烧肉'));
  const quick = E.searchRecipes(S, { maxMin: 10 });
  assert.ok(quick.length > 0);
  quick.forEach((r) => assert.ok((r.min || 0) <= 10));
  const noSpicy = E.searchRecipes(S, { noSpicy: true });
  assert.ok(noSpicy.every((r) => E.tagsOf(S, r).indexOf('不辣') >= 0));
});

test('缺主料时给出家里有的替代食材', () => {
  const r = E.findRecipe(state({}), '鱼香肉丝');
  const S = state({ '鸡胸肉': 500 });
  const a = E.analyze(S, r, 2, NOW);
  const pork = a.items.filter((x) => x.n === '猪里脊')[0];
  assert.ok(pork && pork.subs.indexOf('鸡胸肉') >= 0);
});

test('推荐保质天数按食材和分类给出', () => {
  const S = state({});
  S.custom.ing['秋葵'] = { u: '克', c: '蔬菜' };
  assert.strictEqual(E.shelfLife(S, '青菜'), 3);
  assert.strictEqual(E.shelfLife(S, '鸡蛋'), 14);
  assert.strictEqual(E.shelfLife(S, '秋葵'), 4); // 没单独写，落到「蔬菜」分类
  assert.strictEqual(E.shelfLife(S, '不存在的东西'), null);
});

test('凑一顿会在共享库存内选菜，库存不够时把缺的算出来', () => {
  const S = state({ '番茄': 10, '鸡蛋': 20, '黄瓜': 5 });
  const m = E.planMeal(S, { servings: 2, dishes: 2, soup: 0, now: NOW });
  assert.strictEqual(m.dishes.length, 2);
  assert.strictEqual(m.complete, true);
  assert.deepStrictEqual(m.missing, []);
  const S2 = state({ '番茄': 5, '鸡蛋': 4 });
  const m2 = E.planMeal(S2, { servings: 2, dishes: 2, soup: 0, now: NOW });
  assert.strictEqual(m2.complete, false);
  assert.ok(m2.missing.length > 0 || m2.short > 0);
});

test('过期的食材单独标出，不再只说快过期', () => {
  const r = E.findRecipe(state({}), '番茄炒蛋');
  const S = state({ '番茄': { qty: 5, exp: '2026-10-19' }, '鸡蛋': 10 });
  const a = E.analyze(S, r, 2, NOW);
  assert.deepStrictEqual(a.expired, ['番茄']);
  assert.deepStrictEqual(a.exp, []);
});

test('normalize 保留可选调料、1-12 人份', () => {
  const S = E.normalize({
    custom: { recipes: [{ id: 'u9', name: '大锅菜', base: 8, items: { '番茄': 4 }, o: ['香菜'], tags: ['快手'], prep: 5, cook: 20 }] },
    servings: 6
  });
  const r = S.custom.recipes[0];
  assert.strictEqual(r.base, 8);
  assert.deepStrictEqual(r.o, ['香菜']);
  assert.deepStrictEqual(r.tags, ['快手']);
  assert.strictEqual(r.prep, 5);
  assert.strictEqual(r.cook, 20);
  assert.strictEqual(S.servings, 6);
});

console.log(`\n${n} 项测试全部通过。`);
