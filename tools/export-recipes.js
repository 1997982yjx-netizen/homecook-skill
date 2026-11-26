#!/usr/bin/env node
/*
 * 把 recipes.js 里的数据导出成纯 JSON，方便社区贡献菜谱或做别的工具。
 *   node tools/export-recipes.js              输出到屏幕
 *   node tools/export-recipes.js 菜谱.json     写进文件
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = require('../recipes.js');

const text = JSON.stringify(DATA, null, 2) + '\n';
const out = process.argv[2];
if (out) {
  fs.writeFileSync(path.resolve(out), text);
  console.log('已导出到 ' + path.resolve(out) + '（' + DATA.recipes.length + ' 道菜）');
} else {
  process.stdout.write(text);
}
