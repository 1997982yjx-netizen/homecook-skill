#!/usr/bin/env node
/*
 * 可选的本地服务：提供做饭页面，并可以用你自己的密钥代为调用识图接口（拍照录入、笔记整理成菜谱）。
 * 需要 Node 18 及以上，不用装依赖。只想用页面的话，直接打开 index.html 也行。
 *
 *   node server.js                                   默认端口 8080，不开识图代理
 *   VISION_API_KEY=你的密钥 node server.js            同时开启识图代理
 *   PORT=3000 node server.js                         换端口
 *
 * 启动后电脑上打开 http://localhost:8080；
 * 手机和电脑连同一个 Wi-Fi 时，用终端里打印的"手机访问"地址打开。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { handleVisionStock, handleRecipeFromNote } = require('./server/vision-proxy');

const ROOT = __dirname;
const PORT = +process.env.PORT || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon'
};
// 只对外提供页面要用的文件，服务端代码、脚本、说明文档都不提供
const PUBLIC = /^\/(index\.html|embed-example\.html|cook\.js|cook\.css|recipes\.js|core\/[\w.-]+\.js|images\/[^/]+)$/;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/vision-stock') return handleVisionStock(req, res);
  if (url.pathname === '/api/recipe-from-note') return handleRecipeFromNote(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!PUBLIC.test(rel) || !file.startsWith(ROOT + path.sep) || !TYPES[path.extname(file)]) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});

server.listen(PORT, () => {
  console.log(`做饭页面已启动：http://localhost:${PORT}`);
  console.log(process.env.VISION_API_KEY || process.env.OPENAI_API_KEY
    ? '识图代理已开启：/api/vision-stock、/api/recipe-from-note（用的是你环境变量里的密钥）'
    : '识图代理没开启：需要的话设置 VISION_API_KEY 后重启，或在页面「AI 接口设置」里填自己的接口');
  Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal)
    .forEach((n) => console.log(`手机访问（同一个 Wi-Fi）：http://${n.address}:${PORT}`));
});
