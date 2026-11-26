#!/usr/bin/env node
/*
 * 测试网页里抽出来的纯逻辑：数字校验、步骤计时识别、备份增量合并。不碰 DOM、不访问网络。
 *   node tools/test-web.js
 */
'use strict';
const assert = require('assert');
const W = require('../core/web-utils.js');

let n = 0;
function test(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

test('正数校验：全角数字、小数可以；负数、0、乱写不行', () => {
  assert.strictEqual(W.parsePosNum('3'), 3);
  assert.strictEqual(W.parsePosNum(' 2.5 '), 2.5);
  assert.strictEqual(W.parsePosNum('３'), 3);
  assert.ok(Number.isNaN(W.parsePosNum('-5')));
  assert.ok(Number.isNaN(W.parsePosNum('0')));
  assert.ok(Number.isNaN(W.parsePosNum('abc')));
  assert.ok(Number.isNaN(W.parsePosNum('')));
});

test('步骤时长：阿拉伯/中文数字、分钟/秒/小时、半小时', () => {
  assert.strictEqual(W.stepDuration('焯水 1 分钟'), 60);
  assert.strictEqual(W.stepDuration('小火炖四十分钟'), 2400);
  assert.strictEqual(W.stepDuration('煮30秒'), 30);
  assert.strictEqual(W.stepDuration('腌半小时'), 1800);
  assert.strictEqual(W.stepDuration('再炖 1 小时'), 3600);
  assert.strictEqual(W.stepDuration('切丝'), null);
});

test('合并备份：库存相加、到期取更早、调料合并、同名菜谱覆盖', () => {
  const cur = {
    stock: { '番茄': { qty: 2, exp: '2026-10-30', at: 1 }, '鸡蛋': { qty: 3, exp: null, at: 1 } },
    spices: ['盐'], custom: { ing: { '秋葵': { u: '根', c: '蔬菜' } }, recipes: [{ id: 'u1', name: '我的菜', items: { '番茄': 1 } }] },
    shop: [{ n: '青椒', q: 1, u: '个', done: false }], log: { 'r:番茄炒蛋': 100 }, servings: 2
  };
  const inc = {
    stock: { '番茄': { qty: 3, exp: '2026-10-25', at: 2 }, '土豆': { qty: 4, exp: null, at: 2 } },
    spices: ['盐', '糖'], custom: { ing: {}, recipes: [{ id: 'u1', name: '我的菜', items: { '番茄': 2 } }, { id: 'u2', name: '新菜', items: { '鸡蛋': 1 } }] },
    shop: [{ n: '青椒', q: 2, u: '个', done: false }], log: { 'r:番茄炒蛋': 200 }, servings: 4
  };
  const m = W.mergeState(cur, inc);
  assert.strictEqual(m.stock['番茄'].qty, 5);
  assert.strictEqual(m.stock['番茄'].exp, '2026-10-25');
  assert.strictEqual(m.stock['土豆'].qty, 4);
  assert.deepStrictEqual(m.spices.sort(), ['盐', '糖'].sort());
  assert.strictEqual(m.custom.recipes.length, 2);
  assert.strictEqual(m.custom.recipes.find((r) => r.id === 'u1').items['番茄'], 2);
  assert.strictEqual(m.shop[0].q, 3);
  assert.strictEqual(m.log['r:番茄炒蛋'], 200);
  assert.strictEqual(m.servings, 4);
  assert.strictEqual(cur.stock['番茄'].qty, 2, '不改传入对象');
});

console.log(`\n${n} 项测试全部通过。`);
