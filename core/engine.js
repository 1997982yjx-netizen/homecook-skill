/*
 * 做饭引擎：库存、调料、菜谱匹配、扣库存、购物清单。不碰页面，浏览器和 Node 都能用。
 *
 *   浏览器：<script src="core/engine.js"></script> 之后用 window.CookEngine
 *   Node：  const CookEngine = require('./core/engine.js')
 *
 *   var E = CookEngine.create(COOK_DATA);   // COOK_DATA 来自 recipes.js
 *   var S = E.normalize(saved);             // saved 是页面导出的备份，或者 null
 *   E.plan(S, { servings: 2 })              // → { ok: [...], near: [...], far: [...] }
 *
 * 状态 S 的格式和页面「导出备份」的 JSON 一样，见 README 的「数据」一节。
 * 下面所有改动状态的函数都直接改传进来的 S。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CookEngine = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var CATS = ['蔬菜', '肉禽', '水产', '蛋豆', '主食', '其他'];
  var RCATS = ['荤菜', '素菜', '蛋类', '汤', '主食'];
  var UNITS = ['克', '个', '根', '包', '块', '条', '碗', '朵', '毫升', '瓶', '袋'];
  var WEIGHT = [['克', 1], ['两', 50], ['斤', 500], ['千克', 1000]];
  var DAY = 864e5;

  function r2(n) { return Math.round(n * 100) / 100; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function day0(now) { var d = now ? new Date(now) : new Date(); d.setHours(0, 0, 0, 0); return d; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(n, now) { var d = day0(now); d.setDate(d.getDate() + n); return ymd(d); }
  function parseYmd(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function daysLeft(exp, now) { var d = parseYmd(exp); return d ? Math.round((d - day0(now)) / DAY) : null; }
  // 按人数换算用量：计数单位向上取整，克/毫升取到 5 的倍数
  function scaled(q, u, n, base) {
    var v = q * n / (base || 2);
    if (u === '克' || u === '毫升') return Math.max(5, Math.round(v / 5) * 5);
    return Math.max(1, Math.ceil(v - 1e-9));
  }
  // 斤、两、千克换成克；其他单位原样返回 null
  function toGrams(qty, unit) {
    for (var i = 0; i < WEIGHT.length; i++) if (WEIGHT[i][0] === unit) return r2(qty * WEIGHT[i][1]);
    return null;
  }
  function uniq(a) { var seen = {}; return a.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }); }

  function create(data) {
    data = data || {};
    var ING = data.ingredients || {};
    var SPICES = data.seasonings || [];
    var DEFAULT_SPICES = data.defaultSeasonings || SPICES.slice();
    var ALIAS = data.alias || {};
    var warnings = [];

    function canon(n) { n = String(n).replace(/\s+/g, ''); return ALIAS[n] || n; }

    // 把 recipes.js 里好读的写法换成内部用的短字段
    function fromData(x) {
      if (!x || !x.name) return null;
      var items = {};
      Object.keys(x.ingredients || {}).forEach(function (k) {
        var n = canon(k);
        if (!ING[n]) warnings.push('菜谱「' + x.name + '」用到的「' + k + '」不在食材字典里');
        items[n] = (items[n] || 0) + Number(x.ingredients[k]);
      });
      return {
        id: 'r:' + x.name,
        name: x.name,
        cat: x.category || '素菜',
        min: x.minutes || 0,
        base: x.serves || 2,
        items: items,
        s: (x.seasonings || []).map(canon),
        o: (x.optional || []).map(canon),
        steps: x.steps || [],
        img: typeof x.image === 'string' ? x.image : ''
      };
    }
    var RECIPES = (data.recipes || []).map(fromData).filter(Boolean);

    function blank() {
      return { v: 1, stock: {}, spices: DEFAULT_SPICES.slice(), custom: { ing: {}, recipes: [] }, shop: [], log: {}, servings: 2 };
    }
    function normalize(d) {
      var b = blank();
      if (!d || typeof d !== 'object') return b;
      if (d.stock && typeof d.stock === 'object') {
        Object.keys(d.stock).forEach(function (k) {
          var s = d.stock[k];
          if (s && typeof s.qty === 'number' && s.qty > 0) b.stock[k] = { qty: s.qty, exp: parseYmd(s.exp) ? s.exp : null, at: s.at || Date.now() };
        });
      }
      if (Array.isArray(d.spices)) b.spices = d.spices.filter(function (x) { return typeof x === 'string'; });
      if (d.custom && typeof d.custom === 'object') {
        if (d.custom.ing && typeof d.custom.ing === 'object') b.custom.ing = d.custom.ing;
        if (Array.isArray(d.custom.recipes)) b.custom.recipes = d.custom.recipes.filter(function (r) { return r && r.id && r.name && r.items; });
      }
      if (Array.isArray(d.shop)) b.shop = d.shop.filter(function (x) { return x && x.n; });
      if (d.log && typeof d.log === 'object') b.log = d.log;
      if (d.servings >= 1 && d.servings <= 12) b.servings = Math.round(d.servings);
      return b;
    }

    /* ---------- 查询 ---------- */

    function info(S, name) {
      if (ING[name]) return { u: ING[name][0], c: ING[name][1] };
      if (SPICES.indexOf(name) >= 0) return { u: '', c: '调料' };
      var c = S.custom.ing[name];
      if (c) return { u: c.c === '调料' ? '' : (c.u || '个'), c: c.c || '其他' };
      return null;
    }
    function unitOf(S, name) { var i = info(S, name); return i ? i.u : '个'; }
    function isSpice(S, name) { var i = info(S, name); return !!i && i.c === '调料'; }
    function hasSpice(S, name) { return S.spices.indexOf(name) >= 0; }
    function normName(S, raw) {
      var s = String(raw || '').replace(/\s+/g, '').trim();
      return ALIAS[s] && !S.custom.ing[s] ? ALIAS[s] : s;
    }
    function allSpices(S) {
      return SPICES.concat(Object.keys(S.custom.ing).filter(function (k) { return S.custom.ing[k].c === '调料'; }));
    }
    function allNames(S) { return uniq(Object.keys(ING).concat(SPICES, Object.keys(S.custom.ing))); }
    function allRecipes(S) {
      return RECIPES.concat(S.custom.recipes.map(function (r) { r.mine = true; return r; }));
    }
    // 按 id 或菜名找；菜名完全相同优先，其次包含
    function findRecipe(S, key) {
      var all = allRecipes(S), k = String(key || '').trim();
      return all.filter(function (r) { return r.id === k || r.name === k; })[0] ||
        all.filter(function (r) { return k && r.name.indexOf(k) >= 0; })[0] || null;
    }
    function have(S, name) { return S.stock[name] ? S.stock[name].qty : 0; }

    function maxServ(S, r) {
      var keys = Object.keys(r.items);
      if (!keys.length) return 12;
      var m = 0;
      for (var n = 1; n <= 12; n++) {
        var ok = keys.every(function (k) { return have(S, k) >= scaled(r.items[k], unitOf(S, k), n, r.base) - 1e-6; });
        if (ok) m = n; else break;
      }
      return m;
    }

    // 一道菜按 n 人份算：每样要多少、家里有多少、缺什么；status 是 ok / near / far
    function analyze(S, r, n, now) {
      var items = [], miss = [], exp = [], used = 0;
      Object.keys(r.items).forEach(function (name) {
        var u = unitOf(S, name);
        var need = scaled(r.items[name], u, n, r.base);
        var h = have(S, name);
        var short = need - h > 1e-6 ? r2(need - h) : 0;
        if (h > 0) used++;
        if (short) miss.push({ n: name, q: short, u: u });
        var dl = S.stock[name] ? daysLeft(S.stock[name].exp, now) : null;
        if (h > 0 && dl !== null && dl <= 3) exp.push(name);
        items.push({ n: name, u: u, need: need, have: h, short: short });
      });
      var sp = [], missSp = [];
      (r.s || []).forEach(function (s) { var h = hasSpice(S, s); sp.push({ n: s, has: h, opt: false }); if (!h) missSp.push(s); });
      (r.o || []).forEach(function (s) { sp.push({ n: s, has: hasSpice(S, s), opt: true }); });
      var mc = miss.length + missSp.length;
      var status = mc === 0 ? 'ok' : (mc <= 2 && (used > 0 || !items.length)) ? 'near' : 'far';
      return { r: r, items: items, sp: sp, miss: miss, missSp: missSp, exp: exp, used: used, status: status, mc: mc, max: maxServ(S, r) };
    }
    // 排序分：能用掉 3 天内到期食材的优先，其次用到库存种类多的；两天内做过的往后放
    function score(S, a, now) {
      var s = a.exp.length * 100 + a.used * 10;
      var t = S.log[a.r.id];
      if (t && (now || Date.now()) - t < 2 * DAY) s -= 50;
      return s;
    }
    function missText(a, limit, fmt) {
      fmt = fmt || function (q, u) { return String(q) + (u || ''); };
      var parts = a.miss.map(function (m) { return m.n + ' ' + fmt(m.q, m.u); }).concat(a.missSp);
      if (limit && parts.length > limit) return parts.slice(0, limit).join('、') + ' 等 ' + parts.length + ' 样';
      return parts.join('、');
    }
    // 现在能做什么：分成 ok / near / far 三组，各自排好序
    function plan(S, opts) {
      opts = opts || {};
      var n = opts.servings || S.servings || 2, now = opts.now;
      var all = allRecipes(S).map(function (r) { return analyze(S, r, n, now); });
      if (opts.category && opts.category !== '全部') all = all.filter(function (a) { return a.r.cat === opts.category; });
      return {
        servings: n,
        ok: all.filter(function (a) { return a.status === 'ok'; }).sort(function (x, y) { return score(S, y, now) - score(S, x, now); }),
        near: all.filter(function (a) { return a.status === 'near'; }).sort(function (x, y) { return x.mc - y.mc || score(S, y, now) - score(S, x, now); }),
        far: all.filter(function (a) { return a.status === 'far'; }).sort(function (x, y) { return x.mc - y.mc; })
      };
    }
    function expiringStock(S, now) {
      return Object.keys(S.stock).filter(function (k) { var d = daysLeft(S.stock[k].exp, now); return d !== null && d <= 3; })
        .sort(function (a, b) { return daysLeft(S.stock[a].exp, now) - daysLeft(S.stock[b].exp, now); });
    }

    /* ---------- 修改 ---------- */

    // mode 'add' 累加（到期日取更早的），'set' 改成这个数
    function addStock(S, name, qty, exp, mode) {
      var st = S.stock[name];
      if (mode === 'set' || !st) {
        S.stock[name] = { qty: r2(qty), exp: exp || null, at: Date.now() };
      } else {
        st.qty = r2(st.qty + qty);
        if (exp && (!st.exp || exp < st.exp)) st.exp = exp;
      }
      if (S.stock[name].qty <= 1e-6) delete S.stock[name];
    }
    function addShop(S, name, q, u) {
      var ex = S.shop.filter(function (x) { return x.n === name && !x.done; })[0];
      if (ex) { if (u) ex.q = r2((ex.q || 0) + q); }
      else S.shop.push({ n: name, q: u ? r2(q) : 0, u: u || '', done: false });
    }
    // 做好一道菜：按 n 人份扣库存，记下做的时间。返回 { recipe, used, lacking }
    function cook(S, r, n, now) {
      var used = [], lacking = false;
      Object.keys(r.items).forEach(function (name) {
        var u = unitOf(S, name);
        var need = scaled(r.items[name], u, n, r.base);
        var st = S.stock[name];
        if (!st || st.qty < need - 1e-6) lacking = true;
        if (st) {
          used.push({ n: name, q: Math.min(need, st.qty), u: u });
          st.qty = r2(st.qty - need);
          if (st.qty <= 1e-6) delete S.stock[name];
        }
      });
      S.log[r.id] = now || Date.now();
      return { recipe: r, used: used, lacking: lacking };
    }
    // 把一道菜缺的食材和调料加进购物清单，返回加了几样
    function missToShop(S, r, n) {
      var a = analyze(S, r, n);
      a.miss.forEach(function (m) { addShop(S, m.n, m.q, m.u); });
      a.missSp.forEach(function (s) { addShop(S, s, 0, ''); });
      return a.mc;
    }

    return {
      ingredients: ING, seasonings: SPICES, alias: ALIAS, recipes: RECIPES, warnings: warnings,
      blank: blank, normalize: normalize,
      info: info, unitOf: unitOf, isSpice: isSpice, hasSpice: hasSpice, normName: normName,
      allSpices: allSpices, allNames: allNames, allRecipes: allRecipes, findRecipe: findRecipe, have: have,
      maxServ: maxServ, analyze: analyze, score: score, missText: missText, plan: plan, expiringStock: expiringStock,
      addStock: addStock, addShop: addShop, cook: cook, missToShop: missToShop,
      // 给 vision-map 用的字典
      dict: function (S) { return { ingredients: ING, alias: ALIAS, seasonings: SPICES, customIng: S.custom.ing }; }
    };
  }

  return {
    version: '2.0.0',
    create: create,
    CATS: CATS, RCATS: RCATS, UNITS: UNITS, WEIGHT: WEIGHT,
    r2: r2, ymd: ymd, addDays: addDays, parseYmd: parseYmd, daysLeft: daysLeft, scaled: scaled, toGrams: toGrams
  };
});
