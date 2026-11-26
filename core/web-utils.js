/*
 * 网页里用到的纯逻辑：数字校验、备份合并、步骤时长识别。故意不碰 DOM，方便在 Node 里单测。
 * 浏览器里挂在 window.CookWeb，Node 里 require 也能用。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CookWeb = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // 全角转半角、去空白；只接受大于 0 的数字，负数/0/乱写返回 NaN
  function parsePosNum(v) {
    var s = String(v == null ? '' : v).trim()
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/．/g, '.');
    if (!/^\d+(?:\.\d+)?$/.test(s)) return NaN;
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : NaN;
  }

  var CN = { '零': 0, '一': 1, '二': 2, '两': 2, '俩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function cnInt(s) {
    if (s.indexOf('十') < 0) return CN[s];
    var p = s.split('十');
    return (p[0] ? CN[p[0]] : 1) * 10 + (p[1] ? CN[p[1]] : 0);
  }
  // 从一句话里认出时长，返回秒数；认不出返回 null。支持「焯水1分钟」「炖四十分钟」「半小时」「30秒」「1小时」。
  function stepDuration(text) {
    var s = String(text || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    if (/半\s*小时/.test(s)) return 1800;
    if (/半\s*分钟/.test(s)) return 30;
    var m = s.match(/(\d+)\s*(小时|分钟|分|秒)/);
    var num, unit;
    if (m) { num = +m[1]; unit = m[2]; }
    else if ((m = s.match(/([一二两三四五六七八九十]+)\s*(小时|分钟|分|秒)/))) { num = cnInt(m[1]); unit = m[2]; }
    else return null;
    if (!(num > 0)) return null;
    if (unit === '小时') return num * 3600;
    if (unit === '秒') return num;
    return num * 60;
  }

  function mergeStock(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) {
      var x = out[k], y = b[k];
      if (!y || typeof y !== 'object') return;
      if (!x) { out[k] = y; return; }
      var exp = x.exp && y.exp ? (x.exp < y.exp ? x.exp : y.exp) : (x.exp || y.exp || null);
      out[k] = { qty: Math.round((x.qty + y.qty) * 100) / 100, exp: exp, at: Math.min(x.at || Infinity, y.at || Infinity) };
      if (!isFinite(out[k].at)) out[k].at = Date.now();
    });
    return out;
  }

  function mergeShop(a, b) {
    var out = (a || []).slice();
    (b || []).forEach(function (y) {
      var ex = out.filter(function (x) { return x.n === y.n && !x.done && !y.done; })[0];
      if (ex && ex.u === y.u) { ex.q = Math.round((ex.q + y.q) * 100) / 100; return; }
      out.push(y);
    });
    return out;
  }

  // 增量合并两个备份（不改传入对象）。cur 是当前状态，inc 是新导入的备份。
  function mergeState(cur, inc) {
    cur = cur || {}; inc = inc || {};
    var out = {};
    Object.keys(cur).forEach(function (k) { out[k] = cur[k]; });
    out.v = 1;
    out.stock = mergeStock(cur.stock, inc.stock);
    out.spices = Array.from(new Set((cur.spices || []).concat(inc.spices || [])));
    var ci = Object.assign({}, (cur.custom && cur.custom.ing) || {});
    Object.keys((inc.custom && inc.custom.ing) || {}).forEach(function (k) { if (!ci[k]) ci[k] = inc.custom.ing[k]; });
    var recipes = ((cur.custom && cur.custom.recipes) || []).slice();
    ((inc.custom && inc.custom.recipes) || []).forEach(function (r) {
      var byId = recipes.findIndex(function (x) { return x.id === r.id; });
      var byName = recipes.findIndex(function (x) { return x.name === r.name; });
      if (byId >= 0) recipes[byId] = r;
      else if (byName >= 0) recipes[byName] = r;
      else recipes.push(r);
    });
    out.custom = { ing: ci, recipes: recipes };
    out.shop = mergeShop(cur.shop, inc.shop);
    var log = Object.assign({}, cur.log || {});
    Object.keys(inc.log || {}).forEach(function (k) { log[k] = Math.max(log[k] || 0, inc.log[k] || 0); });
    out.log = log;
    out.servings = inc.servings || cur.servings || 2;
    return out;
  }

  return { parsePosNum: parsePosNum, stepDuration: stepDuration, cnInt: cnInt, mergeState: mergeState, mergeStock: mergeStock, mergeShop: mergeShop };
});
