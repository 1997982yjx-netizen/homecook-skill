#!/usr/bin/env node
/*
 * 检查 recipes.js 有没有写错。用法（在项目根目录）：
 *   node tools/check-recipes.js
 * 有错误时会列出是哪道菜、哪里不对，退出码为 1。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'recipes.js');
const UNITS = ['克', '个', '根', '包', '块', '条', '碗', '朵', '毫升', '瓶', '袋'];
const ING_CATS = ['蔬菜', '肉禽', '水产', '蛋豆', '主食', '其他'];
const RECIPE_CATS = ['荤菜', '素菜', '蛋类', '汤', '主食'];

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`  ✗ ${where}：${msg}`);
const warn = (where, msg) => warnings.push(`  ! ${where}：${msg}`);

let data;
try {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: 'recipes.js' });
  data = sandbox.window.COOK_DATA;
} catch (e) {
  const line = (e.stack || '').match(/recipes\.js:(\d+)/);
  console.error('recipes.js 有语法错误' + (line ? `，大概在第 ${line[1]} 行附近` : '') + '：');
  console.error('  ' + e.message);
  console.error('常见原因：两段 { ... } 之间漏了逗号、引号没配对、用了中文逗号或中文引号。');
  process.exit(1);
}
if (!data || typeof data !== 'object') {
  console.error('recipes.js 里没有找到 window.COOK_DATA = { ... }');
  process.exit(1);
}

const ing = data.ingredients || {};
const seasonings = data.seasonings || [];
const alias = data.alias || {};
const canon = (n) => { n = String(n).replace(/\s+/g, ''); return alias[n] || n; };

// 食材字典
Object.keys(ing).forEach((name) => {
  const v = ing[name];
  if (!Array.isArray(v) || v.length !== 2) { err(`食材「${name}」`, `要写成 ['单位', '分类']`); return; }
  if (!UNITS.includes(v[0])) err(`食材「${name}」`, `单位「${v[0]}」不认识，可用：${UNITS.join(' ')}`);
  if (!ING_CATS.includes(v[1])) err(`食材「${name}」`, `分类「${v[1]}」不认识，可用：${ING_CATS.join(' ')}`);
  if (seasonings.includes(name)) warn(`食材「${name}」`, '同时出现在食材字典和调料里，只留一处');
});

// 调料
(data.defaultSeasonings || []).forEach((s) => {
  if (!seasonings.includes(s)) err('defaultSeasonings', `「${s}」不在 seasonings 列表里`);
});

// 别名
Object.keys(alias).forEach((a) => {
  const t = alias[a];
  if (!ing[t] && !seasonings.includes(t)) err(`别名「${a}」`, `指向的「${t}」既不在食材字典也不在调料里`);
});

// 菜谱
const recipes = Array.isArray(data.recipes) ? data.recipes : [];
if (!Array.isArray(data.recipes)) err('recipes', '要写成数组 [ { ... }, { ... } ]');
const seen = {};
recipes.forEach((r, i) => {
  const where = r && r.name ? `菜谱「${r.name}」` : `第 ${i + 1} 道菜谱`;
  if (!r || typeof r !== 'object') { err(where, '格式不对'); return; }
  if (!r.name) err(where, '缺少 name（菜名）');
  else if (seen[r.name]) err(where, `和第 ${seen[r.name]} 道重名了`);
  else seen[r.name] = i + 1;

  if (!RECIPE_CATS.includes(r.category)) err(where, `category 要是 ${RECIPE_CATS.join(' / ')} 之一，现在是「${r.category}」`);
  if (r.serves !== undefined && !(Number.isInteger(r.serves) && r.serves >= 1 && r.serves <= 12)) err(where, 'serves（几人份）要是 1 到 12 的整数');
  if (r.minutes !== undefined && !(typeof r.minutes === 'number' && r.minutes >= 0)) err(where, 'minutes 要是数字');

  const items = r.ingredients || {};
  if (typeof items !== 'object' || Array.isArray(items)) { err(where, "ingredients 要写成 { '食材': 用量 }"); return; }
  Object.keys(items).forEach((k) => {
    const n = canon(k);
    const q = items[k];
    if (seasonings.includes(n)) { warn(where, `「${k}」是调料，建议写到 seasonings 里（调料不记数量）`); return; }
    if (!ing[n]) err(where, `食材「${k}」不在食材字典里，请先在 ingredients 里加一行，比如 '${k}': ['个', '蔬菜']`);
    if (typeof q !== 'number' || !(q > 0)) err(where, `「${k}」的用量要写数字，不要加引号或单位，比如 '${k}': 2`);
    else if (ing[n] && ing[n][0] === '克' && q < 5) warn(where, `「${k}」按克记，用量 ${q} 克是不是太少了？`);
  });

  ['seasonings', 'optional'].forEach((key) => {
    const list = r[key] || [];
    if (!Array.isArray(list)) { err(where, `${key} 要写成数组 ['盐', '生抽']`); return; }
    list.forEach((s) => {
      if (!seasonings.includes(canon(s))) err(where, `${key} 里的「${s}」不在调料列表里，需要的话先加进 seasonings`);
    });
  });

  if (!Object.keys(items).length && !(r.seasonings || []).length) err(where, '至少要有一样食材');
  if (r.image !== undefined) {
    if (typeof r.image !== 'string' || !r.image.trim()) err(where, "image 要写图片网址，或者仓库里的图片路径，比如 'images/番茄炒蛋.jpg'");
    else if (!/^https?:\/\//.test(r.image) && !fs.existsSync(path.join(__dirname, '..', r.image))) warn(where, `图片「${r.image}」在仓库里找不到，确认文件放对了位置`);
  }
  if (!Array.isArray(r.steps) || !r.steps.length) warn(where, '还没写做法（steps）');
  else if (r.steps.some((s) => typeof s !== 'string' || !s.trim())) err(where, 'steps 里每一步都要是一句文字');
});

console.log(`检查了 ${recipes.length} 道菜、${Object.keys(ing).length} 种食材、${seasonings.length} 种调料。`);
if (warnings.length) console.log(`\n提醒 ${warnings.length} 条（不影响使用）：\n` + warnings.join('\n'));
if (errors.length) {
  console.log(`\n错误 ${errors.length} 条，改好再用：\n` + errors.join('\n'));
  process.exit(1);
}
console.log(errors.length || warnings.length ? '\n没有错误。' : '没有发现问题。');
