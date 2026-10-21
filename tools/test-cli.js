#!/usr/bin/env node
/*
 * 测试命令行（skill 用的就是它）：录库存、匹配、扣库存、清单、识图结果对照、和网页备份互通。
 *   node tools/test-cli.js
 * 数据写在系统临时目录里，不碰 ~/.homecook。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../scripts/cook.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homecook-test-'));
const file = path.join(dir, 'data.json');
const run = (...a) => main(a.concat(['--state', file]));
const json = (...a) => JSON.parse(run(...a, '--json'));
let n = 0;
function test(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

try {
  test('空库存时 match 提示先录库存，不会写文件', () => {
    assert.ok(/库存是空的/.test(run('match')));
    assert.ok(!fs.existsSync(file));
  });

  test('录库存：别名、斤换算、到期天数、新食材要写单位和分类', () => {
    assert.strictEqual(json('stock', 'add', '西红柿', '4', '--exp', '2').name, '番茄');
    assert.strictEqual(json('stock', 'add', '五花肉', '1', '斤').qty, 500);
    run('stock', 'add', '鸡蛋', '10');
    assert.throws(() => run('stock', 'add', '秋葵', '8'), /--unit/);
    assert.strictEqual(json('stock', 'add', '秋葵', '8', '--unit', '根', '--cat', '蔬菜').unit, '根');
    assert.throws(() => run('stock', 'add', '番茄', '2', '斤'), /换算不了/);
  });

  test('match 能找到番茄炒蛋，并标出快过期的番茄', () => {
    const m = json('match');
    const d = m.ok.find((x) => x.name === '番茄炒蛋');
    assert.ok(d);
    assert.deepStrictEqual(d.usesExpiring, ['番茄']);
  });

  test('cook 按人份扣库存', () => {
    const r = json('cook', '番茄炒蛋', '--servings', '2');
    assert.strictEqual(r.lacking, false);
    const stock = json('stock');
    assert.strictEqual(stock.find((x) => x.name === '番茄').qty, 2);
  });

  test('缺的加进清单，买到后放回库存', () => {
    run('stock', 'remove', '五花肉');
    assert.ok(json('shop', 'missing', '红烧肉').added >= 1);
    assert.ok(json('shop').some((x) => x.name === '五花肉'));
    json('shop', 'bought');
    assert.strictEqual(json('shop').length, 0);
    assert.ok(json('stock').some((x) => x.name === '五花肉'));
  });

  test('识图结果先预览，加 --apply 才写入', () => {
    const items = path.join(dir, 'items.json');
    fs.writeFileSync(items, JSON.stringify([{ name: '土豆', count: 3, unit: '个' }, { name: '购物袋', qty: 1 }, { name: '醋', qty: 1, unit: '瓶' }]));
    const preview = json('import-items', items);
    assert.strictEqual(preview.applied, false);
    assert.deepStrictEqual(preview.rows.map((r) => r.kind + ':' + r.name), ['stock:土豆', 'spice:醋']);
    assert.ok(!json('stock').some((x) => x.name === '土豆'));
    json('import-items', items, '--apply');
    assert.strictEqual(json('stock').find((x) => x.name === '土豆').qty, 3);
  });

  test('导出的文件就是网页备份格式，导入后数据一样', () => {
    const out = path.join(dir, 'backup.json');
    run('export', out);
    const b = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.strictEqual(b.v, 1);
    assert.ok(b.stock['土豆'] && Array.isArray(b.spices) && b.custom && Array.isArray(b.shop));
    run('stock', 'clear');
    run('import', out);
    assert.strictEqual(json('stock').find((x) => x.name === '土豆').qty, 3);
  });

  test('出错时 --json 也能读出原因', () => {
    assert.throws(() => run('recipe', '不存在的菜'), /没找到/);
    assert.throws(() => run('nope'), /没有「nope」/);
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${n} 项测试全部通过。`);
