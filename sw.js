/*
 * 很轻的 Service Worker：只缓存页面自己的静态文件，接口请求一律走网络。
 * 目的是把网页“添加到主屏幕”后能离线秒开；更新时先拿网络、同时更新缓存。
 * 不想用离线，可以不注册（页面会自动忽略注册失败）。
 */
'use strict';

var CACHE = 'homecook-static-v1';
var ASSETS = [
  './index.html', './cook.css', './cook.js', './recipes.js', './manifest.json',
  './core/engine.js', './core/dict-utils.js', './core/web-utils.js',
  './core/vision-map.js', './core/vision.js', './core/recipe-draft.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).catch(function () { /* 某个文件缺失不影响安装 */ }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
