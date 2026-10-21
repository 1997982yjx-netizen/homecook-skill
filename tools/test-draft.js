#!/usr/bin/env node
/*
 * 测试 AI 整理菜谱后的对照：用量解析、名字对照、单位换算、保存成我的菜谱。不访问网络。
 *   node tools/test-draft.js
 */
'use strict';
const assert = require('assert');
const CookEngine = require('../core/engine.js');
const D = require('../core/recipe-draft.js');
const E = CookEngine.create(require('../recipes.js'));

let n = 0;
function test(name, fn) { fn(); n++; console.log('  ✓ ' + name); }
const S = () => E.normalize(null);

test('用量解析：数字、中文数字、半、分数、范围、斤两、勺、适量', () => {
  assert.deepStrictEqual([D.parseAmount('2个').num, D.parseAmount('2个').kind], [2, 'count']);
  assert.strictEqual(D.parseAmount('两个').num, 2);
  assert.strictEqual(D.parseAmount('一个半').num, 1.5);
  assert.strictEqual(D.parseAmount('半个').num, 0.5);
  assert.strictEqual(D.parseAmount('1/2个').num, 0.5);
  assert.strictEqual(D.parseAmount('2-3个').num, 2);
  assert.strictEqual(D.parseAmount('半斤').grams, 250);
  assert.strictEqual(D.parseAmount('二两').grams, 100);
  assert.strictEqual(D.parseAmount('300g').grams, 300);
  assert.strictEqual(D.parseAmount('１５０克').grams, 150);
  assert.strictEqual(D.parseAmount('500ml').ml, 500);
  assert.strictEqual(D.parseAmount('一勺').kind, 'spoon');
  assert.strictEqual(D.parseAmount('适量').kind, 'vague');
  assert.strictEqual(D.parseAmount('').kind, 'none');
});

test('名字对照：别名、刀工后缀、修饰词、包含字典词', () => {
  const s = S();
  assert.strictEqual(D.matchName(E, s, '西红柿').name, '番茄');
  assert.strictEqual(D.matchName(E, s, '土豆丝').name, '土豆');
  assert.strictEqual(D.matchName(E, s, '新鲜鸡蛋（土鸡蛋）').name, '鸡蛋');
  const x = D.matchName(E, s, '杏鲍菇');
  assert.deepStrictEqual([x.name, x.known], ['杏鲍菇', false]);
});

test('整理结果变成草稿：换算、估算、调料分开、跳过清水、新食材标注', () => {
  const dr = D.fromNote(E, S(), {
    title: '【下饭】番茄炒蛋', minutes: 10, serves: 3,
    ingredients: [
      { name: '西红柿', amount: '300克' }, { name: '鸡蛋', amount: '3个' }, { name: '清水', amount: '一碗' },
      { name: '五花肉', amount: '半斤' }, { name: '杏鲍菇', amount: '200g' }, { name: '黑胡椒碎', amount: '少许' }
    ],
    seasonings: ['食盐', '白糖'], steps: ['切', '炒', ''], source: 'https://example.com/r/1'
  });
  assert.strictEqual(dr.name, '番茄炒蛋');
  assert.strictEqual(dr.base, 3);
  assert.strictEqual(dr.min, 10);
  assert.strictEqual(dr.cat, '荤菜');
  const by = Object.fromEntries(dr.items.map((x) => [x.n, x]));
  assert.strictEqual(by['番茄'].q, 2);
  assert.ok(/估算/.test(by['番茄'].note));
  assert.strictEqual(by['鸡蛋'].q, 3);
  assert.strictEqual(by['五花肉'].q, 250);
  assert.strictEqual(by['杏鲍菇'].u, '克');
  assert.ok(/新食材/.test(by['杏鲍菇'].note));
  assert.ok(!by['清水']);
  assert.deepStrictEqual(dr.sp.sort(), ['盐', '糖'].sort());
  assert.deepStrictEqual(dr.extra, ['黑胡椒碎']);
  assert.deepStrictEqual(dr.steps, ['切', '炒']);
  assert.strictEqual(dr.src, 'https://example.com/r/1');
});

test('分类没给时按菜名和食材猜', () => {
  assert.strictEqual(D.fromNote(E, S(), { title: '紫菜汤', ingredients: [] }).cat, '汤');
  assert.strictEqual(D.fromNote(E, S(), { title: '炒饭', ingredients: [] }).cat, '主食');
  assert.strictEqual(D.fromNote(E, S(), { title: '拍黄瓜', ingredients: [{ name: '黄瓜', amount: '1根' }] }).cat, '素菜');
});

test('保存成我的菜谱：新食材和新调料加进字典，能参与匹配', () => {
  const s = S();
  const dr = D.fromNote(E, s, { title: '杏鲍菇炒蛋', ingredients: [{ name: '杏鲍菇', amount: '200g' }, { name: '鸡蛋', amount: '2个' }], seasonings: ['盐', '黑胡椒碎'] });
  const res = D.toRecipe(E, s, dr);
  assert.ok(res.recipe);
  assert.deepStrictEqual(res.recipe.items, { '杏鲍菇': 200, '鸡蛋': 2 });
  assert.deepStrictEqual(s.custom.ing['杏鲍菇'], { u: '克', c: '其他' });
  assert.strictEqual(s.custom.ing['黑胡椒碎'].c, '调料');
  s.custom.recipes.push(res.recipe);
  E.addStock(s, '杏鲍菇', 300, null, 'add');
  E.addStock(s, '鸡蛋', 5, null, 'add');
  s.spices.push('黑胡椒碎');
  assert.strictEqual(E.analyze(s, E.findRecipe(s, '杏鲍菇炒蛋'), 2).status, 'ok');
});

test('用量缺了不能保存，会说哪一样', () => {
  const s = S();
  const dr = D.fromNote(E, s, { title: 'x', ingredients: [{ name: '五花肉', amount: '一块' }] });
  assert.strictEqual(dr.items[0].q, '');
  assert.ok(/五花肉/.test(D.toRecipe(E, s, dr).error));
});

console.log(`\n${n} 项测试全部通过。`);
