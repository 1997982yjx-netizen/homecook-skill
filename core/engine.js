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
  // 辣的调料；菜谱里有这些（或菜名带「辣」）就算偏辣
  var SPICY = ['干辣椒', '辣椒', '豆瓣酱', '花椒', '辣椒酱', '老干妈'];
  // 菜名里出现的汉字的拼音首字母，用来支持拼音首字母搜索（零依赖，只收内置菜名用到的字）
  var PINYIN = {
    '番': 'f', '茄': 'q', '炒': 'c', '蛋': 'd', '青': 'q', '椒': 'j', '土': 't', '豆': 'd', '丝': 's',
    '鱼': 'y', '香': 'x', '肉': 'r', '红': 'h', '烧': 's', '可': 'k', '乐': 'l', '鸡': 'j', '翅': 'c',
    '饭': 'f', '面': 'm', '麻': 'm', '婆': 'p', '腐': 'f', '宫': 'g', '保': 'b', '丁': 'd', '蒜': 's',
    '蓉': 'r', '西': 'x', '兰': 'l', '花': 'h', '手': 's', '撕': 's', '包': 'b', '菜': 'c', '清': 'q',
    '地': 'd', '三': 's', '鲜': 'x', '子': 'z', '糖': 't', '醋': 'c', '排': 'p', '骨': 'g', '炖': 'd',
    '牛': 'n', '黄': 'h', '瓜': 'g', '羹': 'g', '紫': 'z', '汤': 't', '冬': 'd', '白': 'b', '灼': 'z',
    '虾': 'x', '韭': 'j', '洋': 'y', '葱': 'c', '菇': 'g', '家': 'j', '常': 'c', '拍': 'p', '胡': 'h',
    '萝': 'l', '卜': 'b', '饼': 'b', '照': 'z', '腿': 't', '蒸': 'z', '皮': 'p', '瘦': 's', '粥': 'z',
    '蚝': 'h', '油': 'y', '生': 's', '芹': 'q', '溜': 'l', '金': 'j', '针': 'z', '仁': 'r', '凉': 'l',
    '拌': 'b', '菠': 'b', '芽': 'y'
  };

  function r2(n) { return Math.round(n * 100) / 100; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function day0(now) { var d = now ? new Date(now) : new Date(); d.setHours(0, 0, 0, 0); return d; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(n, now) { var d = day0(now); d.setDate(d.getDate() + n); return ymd(d); }
  function parseYmd(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-'), y = +p[0], m = +p[1], day = +p[2];
    var d = new Date(y, m - 1, day);
    return d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day ? d : null;
  }
  function daysLeft(exp, now) { var d = parseYmd(exp); return d ? Math.round((d - day0(now)) / DAY) : null; }
  // 按人数换算用量：计数单位向上取整，不足一份时允许半份；克/毫升取到 5 的倍数
  function scaled(q, u, n, base) {
    var v = q * n / (base || 2);
    if (u === '克' || u === '毫升') return Math.max(5, Math.round(v / 5) * 5);
    if (v < 1) return 0.5;
    return Math.max(1, Math.ceil(v - 1e-9));
  }
  // 斤、两、千克换成克；其他单位原样返回 null
  function toGrams(qty, unit) {
    for (var i = 0; i < WEIGHT.length; i++) if (WEIGHT[i][0] === unit) return r2(qty * WEIGHT[i][1]);
    return null;
  }
  function uniq(a) { var seen = {}; return a.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }); }
  // 取名字的拼音首字母；没收录的字原样保留（英文按小写）
  function initials(name) {
    return Array.from(String(name || '')).map(function (c) {
      return PINYIN[c] || (/[a-z0-9]/i.test(c) ? c.toLowerCase() : c);
    }).join('');
  }

  function create(data) {
    data = data || {};
    var ING = data.ingredients || {};
    var SPICES = data.seasonings || [];
    var DEFAULT_SPICES = data.defaultSeasonings || SPICES.slice();
    var ALIAS = data.alias || {};
    var SUBST = data.substitutes || {};
    var SHELF = data.shelfLife || {};
    var SHELF_CAT = data.shelfLifeByCategory || {};
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
        prep: x.prepMinutes || 0,
        cook: x.cookMinutes || 0,
        base: x.serves || 2,
        items: items,
        s: (x.seasonings || []).map(canon),
        o: (x.optional || []).map(canon),
        tags: Array.isArray(x.tags) ? x.tags.filter(function (t) { return typeof t === 'string' && t; }) : [],
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
      if (d.stock && typeof d.stock === 'object' && !Array.isArray(d.stock)) {
        Object.keys(d.stock).forEach(function (k) {
          var s = d.stock[k];
          if (s && typeof s === 'object' && typeof s.qty === 'number' && isFinite(s.qty) && s.qty > 0) {
            b.stock[k] = {
              qty: s.qty,
              exp: parseYmd(s.exp) ? s.exp : null,
              at: typeof s.at === 'number' && isFinite(s.at) ? s.at : Date.now()
            };
          }
        });
      }
      if (Array.isArray(d.spices)) {
        b.spices = uniq(d.spices.filter(function (x) { return typeof x === 'string' && x.trim(); }));
      }
      if (d.custom && typeof d.custom === 'object') {
        if (d.custom.ing && typeof d.custom.ing === 'object' && !Array.isArray(d.custom.ing)) {
          Object.keys(d.custom.ing).forEach(function (k) {
            var v = d.custom.ing[k];
            if (!v || typeof v !== 'object') return;
            var c = typeof v.c === 'string' && v.c ? v.c : '其他';
            var u = c === '调料' ? '' : (typeof v.u === 'string' && v.u ? v.u : '个');
            b.custom.ing[k] = { u: u, c: c };
          });
        }
        if (Array.isArray(d.custom.recipes)) {
          b.custom.recipes = d.custom.recipes.filter(function (r) {
            return r && typeof r === 'object' && typeof r.id === 'string' && r.id && typeof r.name === 'string' && r.name &&
              r.items && typeof r.items === 'object' && !Array.isArray(r.items);
          }).map(function (r) {
            var items = {};
            Object.keys(r.items).forEach(function (k) {
              var q = Number(r.items[k]);
              if (isFinite(q) && q > 0) items[k] = q;
            });
            return {
              id: r.id,
              name: r.name,
              cat: typeof r.cat === 'string' && r.cat ? r.cat : '素菜',
              base: typeof r.base === 'number' && isFinite(r.base) && r.base >= 1 ? Math.min(12, Math.round(r.base)) : 2,
              min: typeof r.min === 'number' && isFinite(r.min) && r.min > 0 ? Math.round(r.min) : 0,
              prep: typeof r.prep === 'number' && isFinite(r.prep) && r.prep > 0 ? Math.round(r.prep) : 0,
              cook: typeof r.cook === 'number' && isFinite(r.cook) && r.cook > 0 ? Math.round(r.cook) : 0,
              items: items,
              s: Array.isArray(r.s) ? r.s.filter(function (x) { return typeof x === 'string' && x; }) : [],
              o: Array.isArray(r.o) ? r.o.filter(function (x) { return typeof x === 'string' && x; }) : [],
              tags: Array.isArray(r.tags) ? r.tags.filter(function (x) { return typeof x === 'string' && x; }) : [],
              steps: Array.isArray(r.steps) ? r.steps.filter(function (x) { return typeof x === 'string' && x; }) : [],
              img: typeof r.img === 'string' ? r.img : '',
              src: typeof r.src === 'string' ? r.src : '',
              mine: true
            };
          });
        }
      }
      if (Array.isArray(d.shop)) {
        b.shop = d.shop.filter(function (x) { return x && typeof x === 'object' && typeof x.n === 'string' && x.n; }).map(function (x) {
          var u = typeof x.u === 'string' ? x.u : '';
          var q = typeof x.q === 'number' && isFinite(x.q) && x.q >= 0 ? x.q : 0;
          return { n: x.n, q: u ? q : 0, u: u, done: !!x.done };
        });
      }
      if (d.log && typeof d.log === 'object' && !Array.isArray(d.log)) {
        Object.keys(d.log).forEach(function (k) {
          if (typeof d.log[k] === 'number' && isFinite(d.log[k])) b.log[k] = d.log[k];
        });
      }
      if (typeof d.servings === 'number' && isFinite(d.servings) && d.servings >= 1 && d.servings <= 12) b.servings = Math.round(d.servings);
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
      return SPICES.concat(Object.keys(S.custom.ing).filter(function (k) { return S.custom.ing[k] && S.custom.ing[k].c === '调料'; }));
    }
    function allNames(S) { return uniq(Object.keys(ING).concat(SPICES, Object.keys(S.custom.ing))); }
    function allRecipes(S) {
      return RECIPES.concat(S.custom.recipes.map(function (r) { return r.mine ? r : Object.assign({}, r, { mine: true }); }));
    }
    // 按 id 或菜名找；菜名完全相同优先，其次包含
    function findRecipe(S, key) {
      var all = allRecipes(S), k = String(key || '').trim();
      return all.filter(function (r) { return r.id === k || r.name === k; })[0] ||
        all.filter(function (r) { return k && r.name.indexOf(k) >= 0; })[0] || null;
    }
    function have(S, name) { return S.stock[name] ? S.stock[name].qty : 0; }

    // 菜谱标签：菜谱里写的 tags + 按耗时、调料、做法自动推断的标签
    function tagsOf(S, r) {
      var set = {};
      (r.tags || []).forEach(function (t) { set[t] = 1; });
      if (r.min && r.min <= 15) set['快手'] = 1;
      var spicy = /辣/.test(r.name) || (r.s || []).concat(r.o || []).some(function (x) { return SPICY.indexOf(x) >= 0; });
      if (!spicy) set['不辣'] = 1;
      var text = r.name + ' ' + (r.steps || []).join(' ');
      if (r.cat === '汤' || /蒸|煮|白灼|凉拌|汤|羹|拌/.test(text)) set['免油烟'] = 1;
      var fat = ['五花肉', '猪里脊', '猪肉馅', '排骨', '鸡翅', '牛肉'];
      if (!Object.keys(r.items).some(function (k) { return fat.indexOf(k) >= 0; }) && /蒸|煮|白灼|凉拌|汤|羹|拌/.test(text)) set['少油低脂'] = 1;
      return Object.keys(set);
    }
    function hasAllTags(S, r, tags) {
      if (!tags || !tags.length) return true;
      var t = tagsOf(S, r);
      return tags.every(function (x) { return t.indexOf(x) >= 0; });
    }
    // 推荐保质天数：先看具体食材，再按分类；都没有返回 null
    function shelfLife(S, name) {
      if (SHELF[name]) return SHELF[name];
      var i = info(S, name);
      if (i && SHELF_CAT[i.c]) return SHELF_CAT[i.c];
      return null;
    }
    // 可替代食材：A ↔ B 双向都算；返回家里还有的替代品
    function subsFor(S, name) {
      var alts = SUBST[name] || [];
      Object.keys(SUBST).forEach(function (k) { if (SUBST[k].indexOf(name) >= 0 && alts.indexOf(k) < 0) alts = alts.concat(k); });
      return alts.filter(function (x) { return have(S, x) > 0; });
    }

    // 搜索菜谱：菜名 / 食材 / 调料 / 拼音首字母，可再按分类、标签、耗时筛
    function searchRecipes(S, opts) {
      opts = opts || {};
      var q = String(opts.q || '').replace(/\s+/g, '').toLowerCase();
      var tags = opts.tags || [];
      return allRecipes(S).filter(function (r) {
        if (opts.category && opts.category !== '全部' && r.cat !== opts.category) return false;
        if (opts.maxMin != null && (r.min || 0) > opts.maxMin) return false;
        if (opts.noSpicy && tagsOf(S, r).indexOf('不辣') < 0) return false;
        if (!hasAllTags(S, r, tags)) return false;
        if (!q) return true;
        if (r.name.toLowerCase().indexOf(q) >= 0) return true;
        if (initials(r.name).indexOf(q) >= 0) return true;
        if (Object.keys(r.items).some(function (k) { return k.toLowerCase().indexOf(q) >= 0; })) return true;
        if ((r.s || []).concat(r.o || []).some(function (k) { return k.toLowerCase().indexOf(q) >= 0; })) return true;
        return false;
      });
    }

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
      var items = [], miss = [], exp = [], expired = [], used = 0;
      Object.keys(r.items).forEach(function (name) {
        var u = unitOf(S, name);
        var need = scaled(r.items[name], u, n, r.base);
        var h = have(S, name);
        var short = need - h > 1e-6 ? r2(need - h) : 0;
        if (h > 0) used++;
        if (short) miss.push({ n: name, q: short, u: u });
        var dl = S.stock[name] ? daysLeft(S.stock[name].exp, now) : null;
        if (h > 0 && dl !== null && dl < 0) expired.push(name);
        else if (h > 0 && dl !== null && dl <= 3) exp.push(name);
        var subs = short ? subsFor(S, name) : [];
        items.push({ n: name, u: u, need: need, have: h, short: short, subs: subs });
      });
      var sp = [], missSp = [];
      (r.s || []).forEach(function (s) { var h = hasSpice(S, s); sp.push({ n: s, has: h, opt: false }); if (!h) missSp.push(s); });
      (r.o || []).forEach(function (s) { sp.push({ n: s, has: hasSpice(S, s), opt: true }); });
      var mc = miss.length + missSp.length;
      var status = mc === 0 ? 'ok' : (mc <= 2 && (used > 0 || !items.length)) ? 'near' : 'far';
      return { r: r, items: items, sp: sp, miss: miss, missSp: missSp, exp: exp, expired: expired, used: used, status: status, mc: mc, max: maxServ(S, r) };
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
      var tags = opts.tags || [];
      var byTime = opts.sort === 'time';
      var all = allRecipes(S).filter(function (r) {
        if (opts.category && opts.category !== '全部' && r.cat !== opts.category) return false;
        if (opts.maxMin != null && (r.min || 0) > opts.maxMin) return false;
        if (opts.noSpicy && tagsOf(S, r).indexOf('不辣') < 0) return false;
        return hasAllTags(S, r, tags);
      }).map(function (r) { return analyze(S, r, n, now); });
      function timeKey(a) { return a.r.min || 9999; }
      return {
        servings: n,
        ok: all.filter(function (a) { return a.status === 'ok'; }).sort(function (x, y) { return byTime ? timeKey(x) - timeKey(y) : score(S, y, now) - score(S, x, now); }),
        near: all.filter(function (a) { return a.status === 'near'; }).sort(function (x, y) { return byTime ? timeKey(x) - timeKey(y) : x.mc - y.mc || score(S, y, now) - score(S, x, now); }),
        far: all.filter(function (a) { return a.status === 'far'; }).sort(function (x, y) { return byTime ? timeKey(x) - timeKey(y) : x.mc - y.mc; })
      };
    }
    function expiringStock(S, now) {
      return Object.keys(S.stock).filter(function (k) { var d = daysLeft(S.stock[k].exp, now); return d !== null && d <= 3; })
        .sort(function (a, b) { return daysLeft(S.stock[a].exp, now) - daysLeft(S.stock[b].exp, now); });
    }

    // 一餐多菜：在共享库存不冲突的前提下凑 dishes 道菜 + soup 道汤，优先用掉快过期的
    // opts: { dishes, soup, servings, now, category }。返回 { servings, dishes:[analyze...], missing:[{n,q,u}], missingSeasonings, expiringUsed, complete }
    function planMeal(S, opts) {
      opts = opts || {};
      var n = opts.servings || S.servings || 2, now = opts.now;
      var wantDish = Math.max(0, opts.dishes == null ? 2 : opts.dishes);
      var wantSoup = Math.max(0, opts.soup == null ? 1 : opts.soup);
      var all = allRecipes(S).map(function (r) { return analyze(S, r, n, now); });
      if (opts.category && opts.category !== '全部') all = all.filter(function (a) { return a.r.cat === opts.category; });
      var dishPool = all.filter(function (a) { return a.r.cat !== '汤'; }).sort(function (x, y) { return score(S, y, now) - score(S, x, now); });
      var soupPool = all.filter(function (a) { return a.r.cat === '汤'; }).sort(function (x, y) { return score(S, y, now) - score(S, x, now); });
      var picked = [], used = {};
      function fits(a) {
        return a.items.every(function (it) { return (used[it.n] || 0) + it.need <= it.have + 1e-6; });
      }
      function take(a) {
        picked.push(a);
        a.items.forEach(function (it) { used[it.n] = (used[it.n] || 0) + it.need; });
      }
      function fill(pool, count) {
        for (var i = 0; i < pool.length && count > 0; i++) {
          if (picked.indexOf(pool[i]) >= 0) continue;
          if (fits(pool[i])) { take(pool[i]); count--; }
        }
        return count;
      }
      var lackDish = fill(dishPool, wantDish);
      var lackSoup = fill(soupPool, wantSoup);
      // 凑不齐时，从剩下的菜里挑缺得最少的补进方案，好告诉用户还差什么
      function bestRemaining(pool) {
        return pool.filter(function (a) { return picked.indexOf(a) < 0; })
          .sort(function (x, y) { return x.mc - y.mc || score(S, y, now) - score(S, x, now); })[0];
      }
      while (lackDish > 0) { var d1 = bestRemaining(dishPool); if (!d1) break; take(d1); lackDish--; }
      while (lackSoup > 0) { var d2 = bestRemaining(soupPool); if (!d2) break; take(d2); lackSoup--; }
      // 汇总食材总需求，再和库存比，得出还缺多少（把共享食材算在一起）
      var needTot = {}, meta = {};
      picked.forEach(function (a) {
        a.items.forEach(function (it) { needTot[it.n] = (needTot[it.n] || 0) + it.need; meta[it.n] = it; });
      });
      var missing = Object.keys(needTot).map(function (k) {
        var q = r2(needTot[k] - have(S, k));
        return q > 1e-6 ? { n: k, q: q, u: meta[k].u } : null;
      }).filter(Boolean);
      var missSp = [];
      picked.forEach(function (a) { a.missSp.forEach(function (s) { if (missSp.indexOf(s) < 0) missSp.push(s); }); });
      var expiringUsed = [];
      picked.forEach(function (a) { a.exp.forEach(function (x) { if (expiringUsed.indexOf(x) < 0) expiringUsed.push(x); }); });
      return {
        servings: n, dishes: picked, missing: missing, missingSeasonings: missSp,
        expiringUsed: expiringUsed, complete: missing.length === 0 && missSp.length === 0 && lackDish === 0 && lackSoup === 0,
        short: lackDish + lackSoup
      };
    }
    function mealToShop(S, meal) {
      var count = 0;
      (meal.missing || []).forEach(function (m) { addShop(S, m.n, m.q, m.u); count++; });
      (meal.missingSeasonings || []).forEach(function (s) { addShop(S, s, 0, ''); count++; });
      return count;
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
      substitutes: SUBST, shelfLifeData: SHELF, shelfLifeByCategory: SHELF_CAT,
      blank: blank, normalize: normalize,
      info: info, unitOf: unitOf, isSpice: isSpice, hasSpice: hasSpice, normName: normName,
      allSpices: allSpices, allNames: allNames, allRecipes: allRecipes, findRecipe: findRecipe, have: have,
      tagsOf: tagsOf, hasAllTags: hasAllTags, shelfLife: shelfLife, subsFor: subsFor, initials: initials, searchRecipes: searchRecipes,
      maxServ: maxServ, analyze: analyze, score: score, missText: missText, plan: plan, expiringStock: expiringStock,
      planMeal: planMeal, mealToShop: mealToShop,
      addStock: addStock, addShop: addShop, cook: cook, missToShop: missToShop,
      // 给 vision-map 用的字典
      dict: function (S) { return { ingredients: ING, alias: ALIAS, seasonings: SPICES, customIng: S.custom.ing }; }
    };
  }

  return {
    version: '2.0.0',
    create: create,
    CATS: CATS, RCATS: RCATS, UNITS: UNITS, WEIGHT: WEIGHT,
    r2: r2, ymd: ymd, addDays: addDays, parseYmd: parseYmd, daysLeft: daysLeft, scaled: scaled, toGrams: toGrams,
    initials: initials, PINYIN: PINYIN
  };
});
