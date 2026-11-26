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

  test('整理好的菜谱先预览，--apply 才保存；能参与匹配，也能删掉', () => {
    const rf = path.join(dir, 'recipe.json');
    fs.writeFileSync(rf, JSON.stringify({ title: '土豆炖蛋', category: '蛋类', ingredients: [{ name: '土豆', amount: '1个' }, { name: '鸡蛋', amount: '两个' }], seasonings: ['盐'], steps: ['炖'] }));
    const pre = json('recipe-import', rf);
    assert.strictEqual(pre.applied, false);
    assert.deepStrictEqual(pre.ingredients.map((x) => x.name + x.qty), ['土豆1', '鸡蛋2']);
    assert.throws(() => run('recipe', '土豆炖蛋'), /没找到/);
    assert.strictEqual(json('recipe-import', rf, '--apply').applied, true);
    assert.ok(json('recipes').some((r) => r.name === '土豆炖蛋' && r.mine));
    assert.ok(json('match').ok.some((d) => d.name === '土豆炖蛋'));
    fs.writeFileSync(rf, JSON.stringify({ title: '番茄炒蛋', ingredients: [{ name: '番茄', amount: '1个' }] }));
    assert.throws(() => run('recipe-import', rf), /内置菜谱/);
    fs.writeFileSync(rf, JSON.stringify({ title: '缺用量', ingredients: [{ name: '五花肉', amount: '一块' }] }));
    assert.throws(() => run('recipe-import', rf, '--apply'), /五花肉/);
    run('recipe-remove', '土豆炖蛋');
    assert.ok(!json('recipes').some((r) => r.name === '土豆炖蛋'));
    assert.throws(() => run('recipe-remove', '番茄炒蛋'), /内置/);
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

  test('边界与参数校验：连写单位、非法数量/日期、值型参数、空清单操作与缺 steps 菜谱', () => {
    assert.strictEqual(json('stock', 'add', '五花肉', '1斤', '--set').qty, 500);
    assert.strictEqual(json('stock', 'add', '五花肉', '250g').qty, 750);
    assert.throws(() => run('stock', 'add', '番茄', '2abc'), /换算不了/);
    assert.throws(() => run('stock', 'add', '番茄', '-2'), /写法/);
    assert.throws(() => run('stock', 'add', '番茄', '4', '--exp', '2026-02-31'), /--exp/);
    assert.throws(() => main(['status', '--state']), /--state/);

    assert.throws(() => run('shop', 'add', '番茄', 'abc'), /数量/);
    assert.throws(() => run('shop', 'add', '番茄', '-5'), /数量/);
    const sp = json('shop', 'add', '盐', '1', '瓶');
    assert.strictEqual(sp.unit, null);
    run('shop', 'clear');
    run('shop', 'add', '丝瓜', '3', '--unit', '根');
    run('shop', 'bought');
    assert.strictEqual(json('stock').find((x) => x.name === '丝瓜').unit, '根');
    assert.throws(() => run('shop', 'remove'), /写法/);
    assert.throws(() => run('recipe-remove'), /写法/);

    const emptyItems = path.join(dir, 'empty-items.json');
    fs.writeFileSync(emptyItems, JSON.stringify([{ name: '购物袋', qty: 1 }]));
    assert.strictEqual(json('import-items', emptyItems, '--apply').applied, false);

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.custom.recipes.push({ id: 'u_nostep', name: '简略菜', items: { '番茄': 1 } });
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.strictEqual(json('recipe', '简略菜').name, '简略菜');

    const badBackup = path.join(dir, 'bad-backup.json');
    fs.writeFileSync(badBackup, JSON.stringify({ stock: [] }));
    assert.throws(() => run('import', badBackup), /备份/);

    const badFile = path.join(dir, 'broken.json');
    fs.writeFileSync(badFile, '{broken');
    assert.ok(/用法/.test(main(['match', '--help', '--state', badFile])));
  });
  test('凑一顿、标签/耗时筛选与拼音搜索', () => {
    const m = json('meal', '--dishes', '2', '--soup', '0');
    assert.ok(Array.isArray(m.dishes));
    assert.strictEqual(typeof m.complete, 'boolean');
    const quick = json('recipes', '--max-min', '10');
    quick.forEach((r) => assert.ok((r.minutes || 0) <= 10));
    const ns = json('match', '--no-spicy');
    ns.ok.concat(ns.near).forEach((d) => assert.ok(d.tags.indexOf('不辣') >= 0));
    assert.ok(json('recipes', 'fqcd').some((r) => r.name === '番茄炒蛋'));
  });

  test('导入菜谱保留可选调料', () => {
    const rf = path.join(dir, 'opt-recipe.json');
    fs.writeFileSync(rf, JSON.stringify({ title: '香油蛋羹', ingredients: [{ name: '鸡蛋', amount: '2个' }], seasonings: ['盐'], optional: ['香油'] }));
    const pre = json('recipe-import', rf);
    assert.deepStrictEqual(pre.optional, ['香油']);
    json('recipe-import', rf, '--apply');
    const saved = json('recipe', '香油蛋羹');
    assert.ok(saved.seasonings.some((s) => s.name === '香油' && s.optional));
  });

  test('import --merge 库存相加、同名菜谱覆盖', () => {
    const before = json('stock').find((x) => x.name === '番茄');
    const out = path.join(dir, 'merge.json');
    run('export', out);
    const r = json('import', out, '--merge');
    assert.strictEqual(r.merged, true);
    const after = json('stock').find((x) => x.name === '番茄');
    assert.ok(after.qty >= before.qty * 2 - 1e-6);
  });

} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${n} 项测试全部通过。`);
