/* 做饭模块页面脚本 v2.0.0 —— 需要先引入 recipes.js 和 core/engine.js（拍照录入还需要 core/vision-map.js 和 core/vision.js）。用法见 README.md。 */
(function () {
  'use strict';

  /* ================= 基础数据 ================= */

  var CE = window.CookEngine;
  var CATS = CE ? CE.CATS : [];
  var RCATS = CE ? CE.RCATS : [];
  var UNITS = CE ? CE.UNITS : [];
  var WEIGHT = CE ? CE.WEIGHT : [];

  // 食材、调料、别名、菜谱都在 recipes.js 里（window.COOK_DATA），加菜只改那个文件
  var DATA = window.COOK_DATA || null;
  var E = DATA && CE ? CE.create(DATA) : null;
  var ING = E ? E.ingredients : {};
  var SPICES = E ? E.seasonings : [];
  var ALIAS = E ? E.alias : {};
  var RECIPES = E ? E.recipes : [];
  if (E && typeof console !== 'undefined') E.warnings.forEach(function (w) { console.warn('[做饭模块] ' + w + '，请在 recipes.js 的 ingredients 里加一行'); });

  var DEMO_STOCK = [
    ['番茄', 4, 2], ['鸡蛋', 8, 12], ['土豆', 3, null], ['青椒', 2, 6], ['五花肉', 300, 5],
    ['猪里脊', 250, 1], ['豆腐', 1, 4], ['黄瓜', 2, 5], ['米饭', 2, 1], ['青菜', 400, 4], ['面条', 500, null]
  ];

  /* ================= 小工具 ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 仓库里的相对路径（含中文文件名）编成 URL；http / data / blob 原样用
  function recipeImgSrc(url) {
    if (!url) return '';
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    return encodeURI(url);
  }
  function r2(n) { return Math.round(n * 100) / 100; }
  function fmtNum(n) { var v = Math.round(n * 10) / 10; return v % 1 === 0 ? String(v) : v.toFixed(1); }
  function fmtQty(q, u) { return fmtNum(q) + (u || ''); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function today0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(n) { var d = today0(); d.setDate(d.getDate() + n); return ymd(d); }
  function parseYmd(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function daysLeft(exp) { var d = parseYmd(exp); return d ? Math.round((d - today0()) / 864e5) : null; }
  function expLabel(n) {
    if (n === null) return '';
    if (n < 0) return '已过期 ' + (-n) + ' 天';
    if (n === 0) return '今天到期';
    return '还剩 ' + n + ' 天';
  }
  function mdLabel(exp) { var d = parseYmd(exp); return d ? (d.getMonth() + 1) + '月' + d.getDate() + '日' : ''; }
  function agoLabel(ts) {
    var d = new Date(ts); d.setHours(0, 0, 0, 0);
    var n = Math.round((today0() - d) / 864e5);
    return n <= 0 ? '今天' : n === 1 ? '昨天' : n + ' 天前';
  }
  function stepOf(u) { return u === '克' ? 50 : u === '毫升' ? 100 : 1; }
  function defaultBuy(u) { return u === '克' || u === '毫升' ? 500 : u === '' ? 0 : 1; }
  function uniq(a) { var seen = {}; return a.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }); }
  function zhSort(a, b) { return a.localeCompare(b, 'zh-Hans-CN'); }

  function makeStore(opts) {
    if (opts.storage && typeof opts.storage.load === 'function' && typeof opts.storage.save === 'function') return opts.storage;
    var key = opts.storageKey || 'cook-module-v1';
    var mem = null;
    return {
      load: function () {
        try { var t = window.localStorage.getItem(key); return t ? JSON.parse(t) : mem; } catch (e) { return mem; }
      },
      save: function (data) {
        mem = data;
        try { window.localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* 存不了就只留在内存里 */ }
      }
    };
  }

  var ICONS = {
    match: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v3.5A5.5 5.5 0 0 1 14.5 20h-5A5.5 5.5 0 0 1 4 14.5V11Z"/><path d="M2 11h20"/><path d="M9.5 7.5c0-1.2 1-1.6 1-2.8M13.5 7.5c0-1.2 1-1.6 1-2.8"/></svg>',
    stock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="2.5" width="13" height="19" rx="2.5"/><path d="M5.5 10h13M9 5.5v2M9 13v3.5"/></svg>',
    recipes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H18v-3"/><path d="M9 7.5h5"/></svg>',
    shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8h13l-1.2 12h-10.6L5.5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>'
  };
  var TABS = [['match', '能做啥'], ['stock', '库存'], ['recipes', '菜谱'], ['shop', '清单']];

  /* ================= 成品照片 ================= */

  // 照片存在浏览器的 IndexedDB 里（容量比 localStorage 大得多）；打不开时只留在内存里
  var PhotoDB = (function () {
    var dbp = null, mem = {};
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        try {
          var req = window.indexedDB.open('cook-module-photos', 1);
          req.onupgradeneeded = function () { req.result.createObjectStore('photos'); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        } catch (e) { reject(e); }
      });
      dbp.catch(function () { /* 没有 IndexedDB 时用内存 */ });
      return dbp;
    }
    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('photos', mode);
          fn(tx.objectStore('photos'));
          tx.oncomplete = function () { resolve(); };
          tx.onerror = tx.onabort = function () { reject(tx.error); };
        });
      });
    }
    return {
      set: function (k, v) { mem[k] = v; return run('readwrite', function (st) { st.put(v, k); }).catch(function () {}); },
      del: function (k) { delete mem[k]; return run('readwrite', function (st) { st.delete(k); }).catch(function () {}); },
      all: function (prefix) {
        return open().then(function (db) {
          return new Promise(function (resolve) {
            var out = {}, tx = db.transaction('photos', 'readonly'), req = tx.objectStore('photos').openCursor();
            req.onsuccess = function () {
              var c = req.result; if (!c) return;
              if (String(c.key).indexOf(prefix) === 0) out[c.key] = c.value;
              c.continue();
            };
            tx.oncomplete = function () { resolve(out); };
            tx.onerror = function () { resolve(out); };
          });
        }).catch(function () {
          var out = {};
          Object.keys(mem).forEach(function (k) { if (k.indexOf(prefix) === 0) out[k] = mem[k]; });
          return out;
        });
      }
    };
  })();

  // 在手机上先把照片缩小：大图最长边 1000px，另外裁一张 160px 的方形缩略图给列表用
  function compressPhoto(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 1000 / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
          var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
          x.drawImage(img, 0, 0, c.width, c.height);
          var t = document.createElement('canvas'), side = Math.min(w, h);
          t.width = t.height = 160;
          var y = t.getContext('2d'); y.fillStyle = '#fff'; y.fillRect(0, 0, 160, 160);
          y.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 160, 160);
          var out = { full: c.toDataURL('image/jpeg', 0.8), thumb: t.toDataURL('image/jpeg', 0.72) };
          URL.revokeObjectURL(url);
          resolve(out);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片打不开')); };
      img.src = url;
    });
  }

  var CAMERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  var TICKET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h12v3.2c-.9.4-1.5 1.3-1.5 2.3s.6 1.9 1.5 2.3v3.2H6v-3.2c.9-.4 1.5-1.3 1.5-2.3S6.9 8.1 6 7.7V4.5Z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>';

  var seq = 0;

  /* ================= 挂载 ================= */

  function mount(el, opts) {
    opts = opts || {};
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) throw new Error('CookModule: 找不到挂载元素');
    if (!E) {
      el.innerHTML = '<p style="padding:16px;color:#C3362C">没加载到菜谱数据：请确认在 cook.js 之前引入了 recipes.js 和 core/engine.js。</p>';
      return null;
    }
    if (el.__cook) el.__cook.destroy();

    var id = ++seq;
    var store = makeStore(opts);
    var S = E.normalize(store.load());
    var ui = { photoFor: null, formPhoto: null, quickOpen: false, tab: opts.tab || 'match', rendered: null, filter: '全部', rfilter: '全部', showFar: false, q: '', rq: '', sheet: null, sheetServ: 2, opener: null, scanGen: 0, scanKind: 'stock' };
    var toastTimer = null, toastFn = null, cleanups = [];

    el.classList.add('ck');
    el.setAttribute('data-nav', opts.nav === 'top' ? 'top' : 'bottom');
    if (opts.theme === 'light' || opts.theme === 'dark') el.setAttribute('data-theme', opts.theme);

    el.innerHTML =
      '<div class="ck-head"></div>' +
      '<main class="ck-body"></main>' +
      '<nav class="ck-nav" aria-label="做饭">' + TABS.map(function (t) {
        return '<button type="button" class="ck-tab" data-act="tab" data-tab="' + t[0] + '">' + ICONS[t[0]] + '<span>' + t[1] + '</span></button>';
      }).join('') + '</nav>' +
      '<div class="ck-scrim" data-act="close-sheet"></div>' +
      '<section class="ck-sheet" role="dialog" aria-modal="true" tabindex="-1"></section>' +
      '<div class="ck-toast" role="status" aria-live="polite"><span class="ck-toast-msg"></span><button type="button" hidden></button></div>' +
      '<datalist id="ck-dl-' + id + '"></datalist>' +
      '<input type="file" accept="application/json,.json" hidden data-backup>' +
      '<input type="file" accept="image/*" hidden data-photo>' +
      '<input type="file" accept="image/*" capture="environment" hidden data-stock-cam>' +
      '<input type="file" accept="image/*" hidden data-stock-gal>';

    var headEl = el.querySelector('.ck-head');
    var bodyEl = el.querySelector('.ck-body');
    var navEl = el.querySelector('.ck-nav');
    var sheetEl = el.querySelector('.ck-sheet');
    var toastEl = el.querySelector('.ck-toast');
    var dlEl = el.querySelector('datalist');
    var fileEl = el.querySelector('input[data-backup]');
    var photoEl = el.querySelector('input[data-photo]');
    var stockCamEl = el.querySelector('input[data-stock-cam]');
    var stockGalEl = el.querySelector('input[data-stock-gal]');
    var photoPrefix = (opts.storageKey || 'cook-module-v1') + ':';
    var photos = {}; // 菜谱 id → { full, thumb }（本机拍的或选的照片）
    var visionEndpoint = opts.visionProxy || '/api/vision-stock';
    var visionKey = (opts.storageKey || 'cook-module-v1') + ':vision';
    var dlId = 'ck-dl-' + id;

    /* ---------- 数据读写 ---------- */

    function commit() {
      var snap = JSON.parse(JSON.stringify(S));
      store.save(snap);
      if (typeof opts.onChange === 'function') { try { opts.onChange(snap); } catch (e) { /* 宿主回调出错不影响模块 */ } }
    }
    // 状态逻辑都在 core/engine.js 里，这里只是绑上当前的 S
    function info(name) { return E.info(S, name); }
    function unitOf(name) { return E.unitOf(S, name); }
    function isSpice(name) { return E.isSpice(S, name); }
    function hasSpice(name) { return E.hasSpice(S, name); }
    function normName(raw) { return E.normName(S, raw); }
    function allSpices() { return E.allSpices(S); }
    function allNames() { return E.allNames(S); }
    function allRecipes() { return E.allRecipes(S); }
    function findRecipe(rid) { return allRecipes().filter(function (r) { return r.id === rid; })[0]; }
    function analyze(r, n) { return E.analyze(S, r, n); }
    function score(a) { return E.score(S, a); }
    function missText(a, limit) {
      var parts = a.miss.map(function (m) { return m.n + ' ' + fmtQty(m.q, m.u); }).concat(a.missSp);
      if (limit && parts.length > limit) return parts.slice(0, limit).join('、') + ' 等 ' + parts.length + ' 样';
      return parts.join('、');
    }
    function expiringStock() { return E.expiringStock(S); }
    function addStock(name, qty, exp, mode) { E.addStock(S, name, qty, exp, mode); }
    function addShop(name, q, u) { E.addShop(S, name, q, u); }

    /* ---------- 渲染 ---------- */

    function render() {
      navEl.querySelectorAll('.ck-tab').forEach(function (b) {
        var on = b.getAttribute('data-tab') === ui.tab;
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        if (b.getAttribute('data-tab') === 'shop') {
          var n = S.shop.filter(function (x) { return !x.done; }).length;
          var badge = b.querySelector('.ck-tab-n');
          if (n && !badge) { badge = document.createElement('span'); badge.className = 'ck-tab-n'; b.appendChild(badge); }
          if (badge) { if (n) badge.textContent = n > 99 ? '99+' : n; else badge.remove(); }
        }
      });
      if (!VIEWS[ui.tab]) ui.tab = 'match';
      var v = VIEWS[ui.tab];
      if (ui.rendered !== ui.tab || v.dynamicHead) { headEl.innerHTML = v.head(); }
      if (ui.rendered !== ui.tab) {
        ui.rendered = ui.tab;
        if (el.getBoundingClientRect().top < 0) el.scrollIntoView();
      }
      bodyEl.innerHTML = v.body();
      dlEl.innerHTML = allNames().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    }
    function renderBody() { bodyEl.innerHTML = VIEWS[ui.tab].body(); }

    function chips(list, current, act) {
      return '<div class="ck-chips" role="group" aria-label="分类">' + ['全部'].concat(list).map(function (c) {
        return '<button type="button" class="ck-chip" data-act="' + act + '" data-v="' + esc(c) + '" aria-pressed="' + (c === current) + '">' + esc(c) + '</button>';
      }).join('') + '</div>';
    }
    function srvStepper(n, act) {
      return '<button type="button" class="ck-round" data-act="' + act + '" data-d="-1" aria-label="少一人"' + (n <= 1 ? ' disabled' : '') + '>−</button>' +
        '<b class="ck-srv-n" aria-live="polite">' + n + '</b>' +
        '<button type="button" class="ck-round" data-act="' + act + '" data-d="1" aria-label="多一人"' + (n >= 12 ? ' disabled' : '') + '>+</button>';
    }
    // 先用本机照片，其次用菜谱自带的图片地址（recipes.js 里写的）
    function photoOf(r) {
      var p = photos[r.id];
      if (p) return { full: p.full, thumb: p.thumb, local: true };
      if (r.img) return { full: r.img, thumb: r.img, local: false };
      return null;
    }
    function thumb(r) {
      var ph = photoOf(r);
      return '<span class="ck-thumb" aria-hidden="true"><b>' + esc(Array.from(r.name)[0] || '') + '</b>' +
        (ph ? '<img src="' + esc(recipeImgSrc(ph.thumb)) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-ck-img>' : '') + '</span>';
    }
    function dishRow(a, dot) {
      var r = a.r, meta, note = '';
      if (a.status === 'ok') {
        meta = '<span class="ck-ok-t">' + (a.max >= 12 ? '量很足' : '够 ' + a.max + ' 人份') + '</span>';
      } else {
        meta = '<span class="ck-miss-t">还差 ' + esc(missText(a, a.status === 'far' ? 3 : 0)) + '</span>';
        if (a.status === 'near' && !a.missSp.length && a.max >= 1) meta += '<span class="ck-muted-t">，够 ' + a.max + ' 人份</span>';
      }
      if (a.exp.length) note = '<span class="ck-dish-note">能用掉快过期的' + esc(a.exp.join('、')) + '</span>';
      return '<button type="button" class="ck-dish" data-act="recipe" data-id="' + esc(r.id) + '">' +
        (dot ? '<i class="ck-dot is-' + a.status + '" aria-hidden="true"></i>' : '') + thumb(r) +
        '<span class="ck-dish-main"><span class="ck-dish-name">' + esc(r.name) + (r.mine ? '<em class="ck-mine">我的</em>' : '') + '</span>' +
        '<span class="ck-dish-meta">' + meta + '</span>' + note + '</span>' +
        '<span class="ck-dish-time">' + (r.min ? r.min + ' 分钟' : '') + '</span></button>';
    }

    var VIEWS = {
      match: {
        dynamicHead: true,
        head: function () {
          return '<div class="ck-top"><h1 class="ck-h1">今天做什么</h1>' +
            '<div class="ck-srv" role="group" aria-label="几个人吃"><span class="ck-srv-l">几人吃</span>' + srvStepper(S.servings, 'srv') + '</div></div>';
        },
        body: function () {
          if (!Object.keys(S.stock).length) {
            return '<section class="ck-plate"><h2 class="ck-plate-h">家里有什么？</h2>' +
              '<p>把家里的菜、肉、蛋和数量录进库存，这里会算出现在能做哪些菜，差什么也会列出来。</p>' +
              '<div class="ck-btns"><button type="button" class="ck-btn" data-act="tab" data-tab="stock">去录库存</button>' +
              '<button type="button" class="ck-btn-2" data-act="demo">用示例数据看看</button></div></section>';
          }
          var all = allRecipes().map(function (r) { return analyze(r, S.servings); });
          var okAll = all.filter(function (a) { return a.status === 'ok'; });
          var nearAll = all.filter(function (a) { return a.status === 'near'; });
          var list = ui.filter === '全部' ? all : all.filter(function (a) { return a.r.cat === ui.filter; });
          var ok = list.filter(function (a) { return a.status === 'ok'; }).sort(function (x, y) { return score(y) - score(x); });
          var near = list.filter(function (a) { return a.status === 'near'; }).sort(function (x, y) { return x.mc - y.mc || score(y) - score(x); });
          var far = list.filter(function (a) { return a.status === 'far'; }).sort(function (x, y) { return x.mc - y.mc; });
          var expiring = expiringStock();

          var h = '<section class="ck-plate" aria-label="概览"><div class="ck-plate-row"><span class="ck-plate-num">' + okAll.length + '</span><div>' +
            '<div class="ck-plate-t">道菜现在就能做</div>' +
            '<div class="ck-plate-s">' + (nearAll.length ? '另有 ' + nearAll.length + ' 道只差一两样，' : '') + '按 ' + S.servings + ' 人份算</div></div></div>' +
            (expiring.length ? '<p class="ck-plate-warn">快过期：' + esc(expiring.join('、')) + '。用得上它们的菜排在前面。</p>' : '') +
            '</section>';
          h += chips(RCATS, ui.filter, 'filter');

          h += '<h2 class="ck-sec"><span>现在就能做</span><small>' + ok.length + ' 道</small></h2>';
          h += ok.length ? '<div class="ck-panel">' + ok.map(function (a) { return dishRow(a); }).join('') + '</div>'
            : '<p class="ck-empty">按 ' + S.servings + ' 人份暂时没有能直接做的' + (ui.filter === '全部' ? '' : ui.filter) + '。看看下面差一两样的，或者把人数调少一点。</p>';

          if (near.length) {
            h += '<h2 class="ck-sec"><span>只差一两样</span><small>点进去可以把缺的加入清单</small></h2>';
            h += '<div class="ck-panel">' + near.map(function (a) { return dishRow(a); }).join('') + '</div>';
          }
          if (far.length) {
            h += '<button type="button" class="ck-more" data-act="toggle-far" aria-expanded="' + ui.showFar + '">' +
              (ui.showFar ? '收起还差得多的菜' : '还差得多的 ' + far.length + ' 道，展开看看') + '</button>';
            if (ui.showFar) h += '<div class="ck-panel" style="margin-top:10px">' + far.map(function (a) { return dishRow(a); }).join('') + '</div>';
          }
          return h;
        }
      },

      stock: {
        head: function () {
          return '<div class="ck-top"><h1 class="ck-h1">库存</h1></div>' +
            '<form class="ck-search" data-form="stock-search" role="search">' +
            '<input class="ck-field" name="q" type="search" placeholder="加食材，比如 番茄、五花肉" autocomplete="off" enterkeyhint="done" data-input="stock-q" aria-label="要添加的食材">' +
            '<button class="ck-btn ck-btn-sm" type="submit">添加</button></form>';
        },
        body: function () {
          if (ui.q) return suggestions(ui.q);
          var names = Object.keys(S.stock);
          var h = '';
          h += '<div class="ck-scan-pair">';
          h += '<button type="button" class="ck-photo-add ck-scan-add" data-act="stock-photo" data-kind="stock" data-src="camera">' + CAMERA +
            '<span><span class="ck-photo-add-t">拍照录入</span><small>拍台面或冰箱里的菜，核对后再入库存</small></span></button>';
          h += '<p class="ck-scan-alt"><button type="button" class="ck-btn-text" data-act="stock-photo" data-kind="stock" data-src="gallery">从相册选图</button></p>';
          h += '<button type="button" class="ck-photo-add ck-scan-add" data-act="stock-photo" data-kind="receipt" data-src="camera">' + TICKET +
            '<span><span class="ck-photo-add-t">拍小票</span><small>拍购物小票上的食材行，核对后再入库存</small></span></button>';
          h += '<p class="ck-scan-alt"><button type="button" class="ck-btn-text" data-act="stock-photo" data-kind="receipt" data-src="gallery">从相册选小票</button></p>';
          h += '</div>';
          h += '<p class="ck-note ck-vision-note">识图用你自己的 AI 接口（' + (visionCfg().key ? '已设置' : '还没设置') + '）。' +
            '<button type="button" class="ck-btn-text" data-act="vision-settings">识图设置</button></p>';
          if (!names.length) {
            h += '<p class="ck-empty" style="margin-top:8px">库存是空的。可以拍照或拍小票识别，也可以在上面输入食材名，或点下面的常用食材。' +
              '</p><div class="ck-btns"><button type="button" class="ck-btn-2" data-act="demo">先用示例数据看看</button></div>';
          }
          var groups = {};
          names.forEach(function (n) { var c = (info(n) || {}).c || '其他'; if (c === '调料') c = '其他'; (groups[c] = groups[c] || []).push(n); });
          CATS.forEach(function (c) {
            var g = groups[c]; if (!g) return;
            g.sort(function (a, b) {
              var da = daysLeft(S.stock[a].exp), db = daysLeft(S.stock[b].exp);
              da = da === null ? 999 : da; db = db === null ? 999 : db;
              return da - db || zhSort(a, b);
            });
            h += '<h2 class="ck-sec"><span>' + c + '</span><small>' + g.length + ' 样</small></h2><div class="ck-panel">' + g.map(stockRow).join('') + '</div>';
          });

          h += '<details class="ck-quick"' + (!names.length || ui.quickOpen ? ' open' : '') + '><summary>常用食材，点一下就加</summary>';
          CATS.forEach(function (c) {
            var g = Object.keys(ING).filter(function (n) { return ING[n][1] === c && !S.stock[n]; });
            if (!g.length) return;
            h += '<div class="ck-qgroup"><h3>' + c + '</h3><div class="ck-qwrap">' + g.map(function (n) {
              return '<button type="button" class="ck-qitem" data-act="pick" data-n="' + esc(n) + '">' + esc(n) + '</button>';
            }).join('') + '</div></div>';
          });
          h += '</details>';

          h += '<h2 class="ck-sec"><span>调料和葱姜蒜</span><small>点一下切换有没有</small></h2><div class="ck-spices">' +
            allSpices().map(function (s) {
              var on = hasSpice(s);
              return '<button type="button" class="ck-spice' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-act="spice" data-n="' + esc(s) + '">' + esc(s) + '</button>';
            }).join('') +
            '<button type="button" class="ck-spice is-add" data-act="new-ing" data-n="" data-c="调料">＋ 其他调料</button></div>';
          h += '<p class="ck-note">调料只记有没有，不记数量；做菜扣库存时也不会扣调料。</p>';

          h += '<h2 class="ck-sec"><span>数据</span><small>只存在这台设备的浏览器里</small></h2><div class="ck-panel">' +
            '<button type="button" class="ck-act" data-act="export">导出备份</button>' +
            '<button type="button" class="ck-act" data-act="import">从备份导入</button>' +
            (names.length ? '<button type="button" class="ck-act is-danger" data-act="clear-stock">清空库存</button>' : '') + '</div>';
          return h;
        }
      },

      recipes: {
        head: function () {
          return '<div class="ck-top"><h1 class="ck-h1">菜谱</h1><button type="button" class="ck-btn-2 ck-btn-sm" data-act="new-recipe">新建菜谱</button></div>' +
            '<div class="ck-search"><input class="ck-field" type="search" placeholder="搜菜名或食材" autocomplete="off" data-input="recipe-q" aria-label="搜索菜谱"></div>';
        },
        body: function () {
          var q = ui.rq;
          var list = allRecipes().filter(function (r) {
            if (ui.rfilter !== '全部' && r.cat !== ui.rfilter) return false;
            if (!q) return true;
            var nq = normName(q);
            return r.name.indexOf(q) >= 0 || Object.keys(r.items).some(function (k) { return k.indexOf(nq) >= 0 || k.indexOf(q) >= 0; });
          }).map(function (r) { return analyze(r, S.servings); });
          var rank = { ok: 0, near: 1, far: 2 };
          list.sort(function (x, y) { return rank[x.status] - rank[y.status] || x.mc - y.mc || zhSort(x.r.name, y.r.name); });
          var h = chips(RCATS, ui.rfilter, 'rfilter');
          h += '<div class="ck-legend"><span>按 ' + S.servings + ' 人份：</span><span><i class="ck-dot is-ok"></i>能做</span><span><i class="ck-dot is-near"></i>差一两样</span><span><i class="ck-dot"></i>还差得多</span></div>';
          h += list.length ? '<div class="ck-panel">' + list.map(function (a) { return dishRow(a, true); }).join('') + '</div>'
            : '<p class="ck-empty">没找到相关的菜。可以点右上角「新建菜谱」，把自己常做的加进来。</p>';
          return h;
        }
      },

      shop: {
        head: function () {
          return '<div class="ck-top"><h1 class="ck-h1">购物清单</h1></div>' +
            '<form class="ck-search" data-form="shop-add"><input class="ck-field" name="q" placeholder="要买什么" autocomplete="off" list="' + dlId + '" enterkeyhint="done" aria-label="要买的东西">' +
            '<button class="ck-btn ck-btn-sm" type="submit">加入</button></form>';
        },
        body: function () {
          if (!S.shop.length) {
            return '<p class="ck-empty" style="margin-top:16px">清单是空的。在菜谱详情里点「把缺的加入清单」，或者在上面直接输入。</p>';
          }
          var done = S.shop.filter(function (x) { return x.done; }).length;
          var h = '<h2 class="ck-sec"><span>要买 ' + S.shop.length + ' 样</span><small>买到了就勾上</small></h2><div class="ck-panel">';
          h += S.shop.map(function (x, i) {
            return '<div class="ck-shrow' + (x.done ? ' is-done' : '') + '">' +
              '<button type="button" class="ck-check" role="checkbox" aria-checked="' + !!x.done + '" data-act="shop-toggle" data-i="' + i + '"><span class="ck-box"></span><span class="ck-shname">' + esc(x.n) + '</span></button>' +
              (x.u ? '<div class="ck-stepper"><button type="button" class="ck-round" data-act="shop-step" data-i="' + i + '" data-d="-1" aria-label="' + esc(x.n) + '少买一点">−</button>' +
                '<span class="ck-qty">' + fmtNum(x.q) + '<small>' + esc(x.u) + '</small></span>' +
                '<button type="button" class="ck-round" data-act="shop-step" data-i="' + i + '" data-d="1" aria-label="' + esc(x.n) + '多买一点">+</button></div>'
                : '<span class="ck-muted-t" style="font-size:13px;padding:0 6px">调料</span>') +
              '<button type="button" class="ck-x" data-act="shop-del" data-i="' + i + '" aria-label="从清单删掉' + esc(x.n) + '">×</button></div>';
          }).join('');
          h += '</div><div class="ck-shop-foot">';
          if (done) h += '<button type="button" class="ck-btn ck-btn-block" data-act="shop-in">把勾上的 ' + done + ' 样放进库存</button>';
          h += '<div class="ck-row2"><button type="button" class="ck-btn-2" data-act="shop-copy">复制清单</button>' +
            '<button type="button" class="ck-btn-2" data-act="shop-clear">清空清单</button></div></div>';
          return h;
        }
      }
    };

    function stockRow(name) {
      var st = S.stock[name], u = unitOf(name), dl = daysLeft(st.exp), badge = '';
      if (dl !== null) badge = dl <= 3 ? '<span class="ck-badge is-warn">' + expLabel(dl) + '</span>' : '<span class="ck-exp">' + mdLabel(st.exp) + '到期</span>';
      return '<div class="ck-srow"><button type="button" class="ck-srow-main" data-act="edit-stock" data-n="' + esc(name) + '" aria-label="修改' + esc(name) + '">' +
        '<span class="ck-srow-name">' + esc(name) + '</span>' + badge + '</button>' +
        '<div class="ck-stepper"><button type="button" class="ck-round" data-act="stock-step" data-n="' + esc(name) + '" data-d="-1" aria-label="' + esc(name) + '减少">−</button>' +
        '<span class="ck-qty">' + fmtNum(st.qty) + '<small>' + esc(u) + '</small></span>' +
        '<button type="button" class="ck-round" data-act="stock-step" data-n="' + esc(name) + '" data-d="1" aria-label="' + esc(name) + '增加">+</button></div></div>';
    }

    function suggestions(raw) {
      var q = String(raw).replace(/\s+/g, '');
      var nq = normName(q);
      var names = allNames();
      var hits = names.filter(function (n) { return n.indexOf(q) >= 0 || n.indexOf(nq) >= 0; });
      Object.keys(ALIAS).forEach(function (a) { if (a.indexOf(q) >= 0) hits.push(ALIAS[a]); });
      hits = uniq(hits).sort(function (a, b) { return (b.indexOf(q) === 0) - (a.indexOf(q) === 0) || a.length - b.length; }).slice(0, 12);
      var h = '<div class="ck-panel" style="margin-top:12px">';
      h += hits.map(function (n) {
        var i = info(n), right;
        if (i.c === '调料') right = hasSpice(n) ? '已有' : '记为有';
        else right = S.stock[n] ? '已有 ' + fmtQty(S.stock[n].qty, i.u) : '加入';
        return '<button type="button" class="ck-sug" data-act="pick" data-n="' + esc(n) + '"><b>' + esc(n) + '</b><span>' + (i.c === '调料' ? '调料' : '按' + esc(i.u) + '记') + '</span><span class="ck-sug-r">' + esc(right) + '</span></button>';
      }).join('');
      if (q && names.indexOf(nq) < 0) {
        h += '<button type="button" class="ck-sug" data-act="new-ing" data-n="' + esc(q) + '"><b>新建「' + esc(q) + '」</b><span>字典里没有，自己定单位</span><span class="ck-sug-r">新建</span></button>';
      }
      return h + '</div>';
    }

    /* ---------- 弹层 ---------- */

    function openSheet(kind, args) {
      if (!ui.sheet) ui.opener = document.activeElement;
      clearTimeout(toastTimer); toastEl.classList.remove('is-on'); toastFn = null;
      ui.sheet = { kind: kind, args: args || {} };
      if (kind === 'recipe' && !(args && args.keepServ)) ui.sheetServ = S.servings;
      if (kind === 'recipe-form') {
        var fr = args && args.id ? findRecipe(args.id) : null;
        ui.formPhoto = fr ? (photos[fr.id] ? { full: photos[fr.id].full, thumb: photos[fr.id].thumb } : fr.img ? { url: fr.img } : null) : null;
      }
      renderSheet();
      sheetEl.scrollTop = 0;
      el.classList.add('is-sheet');
      document.documentElement.classList.add('ck-lock');
      sheetEl.focus({ preventScroll: true });
    }
    function closeSheet() {
      if (!ui.sheet) return;
      if (ui.sheet.kind === 'stock-scan') ui.scanGen += 1;
      ui.sheet = null;
      el.classList.remove('is-sheet');
      document.documentElement.classList.remove('ck-lock');
      if (ui.opener && document.body.contains(ui.opener)) { try { ui.opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      ui.opener = null;
    }
    function renderSheet() {
      if (!ui.sheet) return;
      var k = ui.sheet.kind, a = ui.sheet.args;
      var scanTitle = (k === 'stock-scan' && a.scanKind === 'receipt') ? '小票识别' : '拍照录入';
      var title = { recipe: '菜谱', stock: '库存', ing: '新食材', 'recipe-form': '菜谱', 'stock-scan': scanTitle, vision: '识图设置' }[k] || '详情';
      sheetEl.setAttribute('aria-label', title);
      sheetEl.innerHTML = SHEETS[k](a);
      var sf = sheetEl.querySelector('form[data-form="stock"]');
      if (sf) updateHint(sf);
    }
    function sheetHead(title) {
      return '<header class="ck-sh-head"><h2 class="ck-sh-title">' + title + '</h2><button type="button" class="ck-close" data-act="close-sheet" aria-label="关闭">×</button></header>';
    }
    function optList(name, values, current, labels) {
      return values.map(function (v, i) {
        return '<label class="ck-opt"><input type="radio" name="' + name + '" value="' + esc(v) + '"' + (String(v) === String(current) ? ' checked' : '') + '><span>' + esc(labels ? labels[i] : v) + '</span></label>';
      }).join('');
    }

    var SHEETS = {
      recipe: function (args) {
        var r = findRecipe(args.id);
        if (!r) return sheetHead('找不到这道菜') + '<p class="ck-note">它可能已经被删掉了。</p>';
        var n = ui.sheetServ, a = analyze(r, n), last = S.log[r.id];
        var h = sheetHead(esc(r.name) + (r.mine ? '<em class="ck-mine">我的</em>' : ''));
        var ph = photoOf(r);
        if (ph) {
          h += '<figure class="ck-photo"><img src="' + esc(recipeImgSrc(ph.full)) + '" alt="' + esc(r.name) + '的成品照片" referrerpolicy="no-referrer" data-ck-img>' +
            '<div class="ck-photo-fallback">照片加载不出来，可以换一张</div>' +
            '<div class="ck-photo-acts"><button type="button" class="ck-photo-btn" data-act="photo-pick" data-id="' + esc(r.id) + '">换一张</button>' +
            (ph.local || r.mine ? '<button type="button" class="ck-photo-btn" data-act="photo-del" data-id="' + esc(r.id) + '">删除</button>' : '') + '</div></figure>';
        } else {
          h += '<button type="button" class="ck-photo-add" data-act="photo-pick" data-id="' + esc(r.id) + '">' + CAMERA +
            '<span><span class="ck-photo-add-t">添加成品照片</span><small>做好了拍一张，或者从相册选</small></span></button>';
        }
        h += '<div class="ck-sh-meta"><span>' + esc(r.cat) + '</span>' + (r.min ? '<span>大约 ' + r.min + ' 分钟</span>' : '') +
          (last ? '<span>上次做是' + agoLabel(last) + '</span>' : '') +
          (r.src && /^https?:\/\//.test(r.src) ? '<a class="ck-src" href="' + esc(r.src) + '" target="_blank" rel="noopener noreferrer">原菜谱</a>' : '') + '</div>';
        h += '<div class="ck-sh-srv"><span>按</span>' + srvStepper(n, 'sh-srv') + '<span>人份算</span>' +
          '<span style="margin-left:auto" class="' + (a.status === 'ok' ? 'ck-ok-t' : 'ck-miss-t') + '">' +
          (a.status === 'ok' ? '都够' : '缺 ' + a.mc + ' 样') + '</span></div>';
        if (a.items.length) {
          h += '<h3 class="ck-h3"><span>食材</span><small>要多少 / 家里有</small></h3><ul class="ck-need">' + a.items.map(function (it) {
            return '<li class="' + (it.short ? 'is-miss' : 'is-ok') + '"><span class="n">' + esc(it.n) + '</span><span class="q">要 ' + fmtQty(it.need, it.u) + '</span>' +
              '<span class="h">' + (it.short ? '差 ' + fmtQty(it.short, it.u) : '有 ' + fmtQty(it.have, it.u)) + '</span></li>';
          }).join('') + '</ul>';
        }
        if (a.sp.length) {
          h += '<h3 class="ck-h3"><span>调料</span>' + (a.missSp.length ? '<small>红色的家里没有</small>' : '') + '</h3><div class="ck-tags">' + a.sp.map(function (s) {
            var cls = s.has ? '' : s.opt ? ' is-opt' : ' is-lack';
            return '<span class="ck-tag' + cls + '">' + esc(s.n) + (s.opt ? '（可选）' : '') + '</span>';
          }).join('') + '</div>';
        }
        if (r.steps && r.steps.length) {
          h += '<h3 class="ck-h3"><span>做法</span></h3><ol class="ck-steps">' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
        }
        h += '<div class="ck-sh-actions">';
        if (a.used > 0 || !a.items.length) {
          h += '<button type="button" class="ck-btn ck-btn-block" data-act="cook" data-id="' + esc(r.id) + '">做好了，从库存扣掉食材</button>';
        }
        if (a.mc) h += '<button type="button" class="ck-btn-2 ck-btn-block" data-act="miss-to-shop" data-id="' + esc(r.id) + '">把缺的 ' + a.mc + ' 样加入清单</button>';
        if (r.mine) {
          h += '<div class="ck-row2"><button type="button" class="ck-btn-text" data-act="edit-recipe" data-id="' + esc(r.id) + '">编辑这道菜</button>' +
            '<button type="button" class="ck-btn-text is-danger" data-act="del-recipe" data-id="' + esc(r.id) + '">删除</button></div>';
        }
        return h + '</div>';
      },

      stock: function (args) {
        var name = args.name, u = unitOf(name), st = S.stock[name];
        var mode = args.mode || (st ? 'add' : 'set');
        var isW = u === '克';
        var init = mode === 'set' && st ? st.qty : defaultBuy(u);
        var h = sheetHead(esc(name) + (st ? '<span class="ck-muted-t" style="font-family:var(--ck-sans);font-size:15px;font-weight:400">（现有 ' + fmtQty(st.qty, u) + '）</span>' : ''));
        h += '<form class="ck-form" data-form="stock" novalidate>';
        if (st) {
          h += '<div class="ck-seg" role="radiogroup" aria-label="怎么记">' +
            optList('mode', ['add', 'set'], mode, ['又买了一些', '改成实际数量']) + '</div>';
        }
        h += '<label class="ck-label" for="ck-q-' + id + '">' + (mode === 'add' && st ? '这次买了多少' : '有多少') + '</label>' +
          '<div class="ck-qtybox"><button type="button" class="ck-round" data-act="f-step" data-d="-1" aria-label="减少">−</button>' +
          '<input class="ck-field" id="ck-q-' + id + '" name="qty" type="text" inputmode="decimal" value="' + fmtNum(init) + '" autocomplete="off">' +
          '<button type="button" class="ck-round" data-act="f-step" data-d="1" aria-label="增加">+</button>' +
          (isW ? '<select class="ck-field" name="unit" aria-label="单位">' + WEIGHT.map(function (w) { return '<option value="' + w[0] + '">' + w[0] + '</option>'; }).join('') + '</select>'
            : '<span class="ck-unit">' + esc(u) + '</span>') + '</div>';
        h += '<p class="ck-hint" data-hint></p>';
        var exp = mode === 'set' && st && st.exp ? st.exp : '';
        h += '<span class="ck-label">' + (mode === 'add' && st ? '这次买的什么时候到期' : '什么时候到期') + '<small>不填也行，填了会优先推荐用它的菜</small></span>' +
          '<div class="ck-opts" role="radiogroup" aria-label="保质期">' + optList('exp', ['', '3', '7', '14'], exp ? 'x' : '', ['不记', '3 天内', '一周', '两周']) + '</div>' +
          '<label class="ck-date">或者选日期<input class="ck-field" type="date" name="date" value="' + esc(exp) + '"></label>';
        h += '<p class="ck-err" role="alert"></p>';
        h += '<div class="ck-form-foot">' + (st ? '<button type="button" class="ck-btn-text is-danger" data-act="stock-del" data-n="' + esc(name) + '">用完了</button>' : '') +
          '<button type="submit" class="ck-btn">' + (st ? '保存' : '放进库存') + '</button></div>';
        return h + '</form>';
      },

      ing: function (args) {
        var c = args.c || '蔬菜';
        var h = sheetHead('新食材');
        h += '<form class="ck-form" data-form="ing" novalidate>' +
          '<label class="ck-label" for="ck-in-' + id + '">叫什么</label>' +
          '<input class="ck-field" id="ck-in-' + id + '" name="name" value="' + esc(args.name || '') + '" autocomplete="off" placeholder="比如 腊肠">' +
          '<span class="ck-label">属于哪类</span><div class="ck-opts" role="radiogroup" aria-label="分类">' + optList('c', CATS.concat('调料'), c) + '</div>' +
          '<div data-unitbox' + (c === '调料' ? ' hidden' : '') + '><span class="ck-label">用什么单位记</span><div class="ck-opts" role="radiogroup" aria-label="单位">' + optList('u', UNITS, '个') + '</div></div>' +
          '<p class="ck-err" role="alert"></p>' +
          '<div class="ck-form-foot"><button type="submit" class="ck-btn">下一步</button></div></form>';
        return h;
      },

      'recipe-form': function (args) {
        var r = args.id ? findRecipe(args.id) : null;
        var rows = r ? Object.keys(r.items).map(function (k) { return { n: k, q: r.items[k] }; }) : [{}, {}, {}];
        var sp = r ? (r.s || []).concat(r.o || []) : [];
        var spList = allSpices();
        var src = r && r.src ? r.src : '';
        var steps = r && r.steps ? r.steps : [];
        var h = sheetHead(r ? '编辑菜谱' : '新建菜谱');
        h += '<form class="ck-form" data-form="recipe" novalidate>' +
          '<label class="ck-label" for="ck-rn-' + id + '">菜名</label>' +
          '<input class="ck-field" id="ck-rn-' + id + '" name="name" value="' + esc(r ? r.name : '') + '" autocomplete="off" placeholder="比如 酸辣土豆丝">' +
          '<span class="ck-label">成品照片<small>可以不加</small></span><div class="ck-fphoto" data-fphoto>' + formPhotoInner() + '</div>' +
          '<span class="ck-label">分类</span><div class="ck-opts" role="radiogroup" aria-label="分类">' + optList('cat', RCATS, r ? r.cat : '素菜') + '</div>' +
          '<span class="ck-label">下面的用量是几人份</span><div class="ck-opts" role="radiogroup" aria-label="人份">' + optList('base', [1, 2, 3, 4], r ? r.base : 2, ['1 人', '2 人', '3 人', '4 人']) + '</div>' +
          '<label class="ck-label" for="ck-rm-' + id + '">大约几分钟<small>可不填</small></label>' +
          '<input class="ck-field" id="ck-rm-' + id + '" name="min" type="text" inputmode="numeric" value="' + esc(r && r.min ? r.min : '') + '" style="max-width:120px">' +
          '<span class="ck-label">食材和用量</span>' +
          '<div data-rows>' + rows.map(function (it) { return ingRow(it.n || '', it.q === undefined ? '' : it.q, it.u, it.note); }).join('') + '</div>' +
          '<button type="button" class="ck-addrow" data-act="add-row">＋ 再加一样</button>' +
          '<span class="ck-label">要用的调料</span><div class="ck-opts">' + spList.map(function (s) {
            return '<label class="ck-opt"><input type="checkbox" name="sp" value="' + esc(s) + '"' + (sp.indexOf(s) >= 0 ? ' checked' : '') + '><span>' + esc(s) + '</span></label>';
          }).join('') + '</div>' +
          '<label class="ck-label" for="ck-rs-' + id + '">做法<small>一行一步</small></label>' +
          '<textarea class="ck-field" id="ck-rs-' + id + '" name="steps" placeholder="土豆切丝泡水&#10;热油炒香蒜&#10;下土豆丝大火快炒">' + esc(steps.join('\n')) + '</textarea>' +
          '<input type="hidden" name="rid" value="' + esc(r ? r.id : '') + '">' +
          '<input type="hidden" name="src" value="' + esc(src) + '">' +
          '<p class="ck-err" role="alert"></p>' +
          '<div class="ck-form-foot"><button type="submit" class="ck-btn">保存菜谱</button></div></form>';
        return h;
      },

      vision: function () {
        var c = visionCfg(), VA = window.CookVisionApi || {};
        var h = sheetHead('识图设置');
        h += '<p class="ck-note">拍照录入和拍小票需要一个能看图的 AI 接口。这里填你自己的接口和密钥，本项目不提供识别服务，也收不到你的照片和密钥。</p>';
        h += '<form class="ck-form" data-form="vision" novalidate>' +
          '<label class="ck-label" for="ck-vb-' + id + '">接口地址<small>OpenAI 兼容，不带 /chat/completions</small></label>' +
          '<input class="ck-field" id="ck-vb-' + id + '" name="base" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="' + esc(VA.DEFAULT_BASE || '') + '" value="' + esc(c.base || '') + '">' +
          '<label class="ck-label" for="ck-vk-' + id + '">API 密钥</label>' +
          '<input class="ck-field" id="ck-vk-' + id + '" name="key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-..." value="' + esc(c.key || '') + '">' +
          '<label class="ck-label" for="ck-vm-' + id + '">模型<small>要能看图</small></label>' +
          '<input class="ck-field" id="ck-vm-' + id + '" name="model" autocomplete="off" spellcheck="false" placeholder="' + esc(VA.DEFAULT_MODEL || '') + '" value="' + esc(c.model || '') + '">' +
          '<p class="ck-note">密钥只存在这台设备的浏览器里，不会进备份。照片会从浏览器直接发到你填的接口。' +
          '有的接口不允许浏览器直接调用，识别时会提示连不上，这时改用自己运行的 server.js 代为调用（见 README）。</p>' +
          '<p class="ck-err" role="alert"></p>' +
          '<div class="ck-form-foot">' + (c.key ? '<button type="button" class="ck-btn-text is-danger" data-act="vision-clear">清除设置</button>' : '') +
          '<button type="submit" class="ck-btn">保存</button></div></form>';
        return h;
      },

      'stock-scan': function (args) {
        var receipt = args.scanKind === 'receipt';
        var h = sheetHead(receipt ? '小票识别' : '拍照录入');
        if (args.preview) {
          h += '<div class="ck-scan-preview' + (receipt ? ' is-ticket' : '') + '"><img src="' + esc(args.preview) + '" alt="' + (receipt ? '刚才拍的小票' : '刚才拍的照片') + '"></div>';
        }
        if (args.status === 'loading') {
          h += '<p class="ck-note" role="status">' + (receipt ? '正在识别小票上的食材，请稍等…' : '正在识别照片里的食材，请稍等…') + '</p>';
          return h;
        }
        h += '<form class="ck-form" data-form="stock-scan" novalidate>';
        if (args.err) h += '<p class="ck-imp-msg is-err" role="alert">' + esc(args.err) + '</p>';
        else h += '<p class="ck-note">核对名字和数量。认错的改掉或删掉，确认后才会写入库存。</p>';
        var lines = args.lines || [];
        var stockN = lines.filter(function (x) { return x.kind === 'stock'; }).length;
        if (stockN) {
          h += '<span class="ck-label">已经在库存里的怎么记</span>' +
            '<div class="ck-seg" role="radiogroup" aria-label="怎么记">' +
            optList('scan-mode', ['add', 'set'], args.mode || 'add', ['累加进去', receipt ? '改成小票上的数量' : '改成照片里的数量']) + '</div>';
        }
        h += '<div data-scan-rows>' + (lines.length ? lines.map(scanRow).join('') : '') + '</div>';
        h += '<button type="button" class="ck-addrow" data-act="scan-add">＋ 再加一样</button>';
        h += '<p class="ck-err" role="alert"></p>';
        if (args.setup) h += '<p class="ck-scan-alt"><button type="button" class="ck-btn-text" data-act="vision-settings">识图设置</button></p>';
        h += '<div class="ck-form-foot">' +
          '<button type="button" class="ck-btn-2" data-act="stock-photo" data-kind="' + esc(args.scanKind || 'stock') + '" data-src="' + esc(args.src || 'camera') + '">再拍一张</button>' +
          '<button type="submit" class="ck-btn">放进库存</button></div></form>';
        return h;
      }
    };

    function scanRow(it) {
      if (it.kind === 'spice') {
        return '<div class="ck-irow ck-scanrow is-spice" data-kind="spice" data-n="' + esc(it.name) + '">' +
          '<label class="ck-scan-spice"><input type="checkbox" name="sk"' + (it.keep === false ? '' : ' checked') + '>' +
          '记下家里有「' + esc(it.name) + '」</label>' +
          '<button type="button" class="ck-x" data-act="scan-del" aria-label="去掉' + esc(it.name) + '">×</button>' +
          (it.note ? '<p class="ck-irow-note">' + esc(it.note) + '</p>' : '') + '</div>';
      }
      var known = it.known && info(it.name);
      var u = known ? known.u : (it.unit && UNITS.indexOf(it.unit) >= 0 ? it.unit : '个');
      var have = S.stock[it.name] ? '现有 ' + fmtQty(S.stock[it.name].qty, unitOf(it.name)) : '';
      var note = it.note || (known ? '' : '新食材，保存时会加进字典');
      if (have) note = (note ? note + ' · ' : '') + have;
      return '<div class="ck-irow ck-scanrow' + (note ? ' is-check' : '') + '" data-kind="stock">' +
        '<input class="ck-field" name="sn" list="' + dlId + '" value="' + esc(it.name || '') + '" placeholder="食材" autocomplete="off" aria-label="食材">' +
        '<input class="ck-field" name="sq" inputmode="decimal" value="' + esc(it.qty === undefined || it.qty === null ? '' : it.qty) + '" placeholder="数量" autocomplete="off" aria-label="数量">' +
        '<select class="ck-field" name="su" aria-label="单位"' + (known ? ' disabled' : '') + '>' + UNITS.map(function (x) {
          return '<option' + (x === u ? ' selected' : '') + '>' + x + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="ck-x" data-act="scan-del" aria-label="删掉这一行">×</button>' +
        (note ? '<p class="ck-irow-note">' + esc(note) + '</p>' : '') + '</div>';
    }

    function formPhotoInner() {
      var p = ui.formPhoto, src = p ? (p.thumb || p.url) : '';
      return (p ? '<img src="' + esc(recipeImgSrc(src)) + '" alt="成品照片预览" referrerpolicy="no-referrer" data-ck-img>' : '<span class="ck-fphoto-empty">' + CAMERA + '</span>') +
        '<div class="ck-fphoto-btns"><button type="button" class="ck-btn-2 ck-btn-sm" data-act="photo-pick" data-id="form">' + (p ? '换一张' : '拍照或选图') + '</button>' +
        (p ? '<button type="button" class="ck-btn-text" data-act="fphoto-clear">去掉</button>' : '') + '</div>';
    }
    function refreshFormPhoto() {
      var box = sheetEl.querySelector('[data-fphoto]');
      if (box) box.innerHTML = formPhotoInner();
    }

    function ingRow(name, q, unitHint, note) {
      var known = name && info(name);
      var u = known ? known.u : (unitHint && UNITS.indexOf(unitHint) >= 0 ? unitHint : '个');
      return '<div class="ck-irow' + (note ? ' is-check' : '') + '"><input class="ck-field" name="in" list="' + dlId + '" value="' + esc(name) + '" placeholder="食材" autocomplete="off" aria-label="食材">' +
        '<input class="ck-field" name="iq" inputmode="decimal" value="' + esc(q) + '" placeholder="用量" autocomplete="off" aria-label="用量">' +
        '<select class="ck-field" name="iu" aria-label="单位"' + (known ? ' disabled' : '') + '>' + UNITS.map(function (x) {
          return '<option' + (x === u ? ' selected' : '') + '>' + x + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="ck-x" data-act="row-del" aria-label="删掉这一行">×</button>' +
        (note ? '<p class="ck-irow-note">' + esc(note) + '</p>' : '') + '</div>';
    }

    function pickStockPhoto(src, kind) {
      var inp = src === 'gallery' ? stockGalEl : stockCamEl;
      ui.scanSrc = src === 'gallery' ? 'gallery' : 'camera';
      ui.scanKind = kind === 'receipt' ? 'receipt' : 'stock';
      inp.value = '';
      inp.click();
    }

    function onStockFile(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      ui.scanGen += 1;
      var gen = ui.scanGen;
      var scanKind = ui.scanKind === 'receipt' ? 'receipt' : 'stock';
      compressPhoto(file).then(function (ph) {
        if (gen !== ui.scanGen) return;
        openSheet('stock-scan', {
          status: 'loading', preview: ph.thumb, src: ui.scanSrc || 'camera',
          scanKind: scanKind, mode: 'add', lines: [], err: ''
        });
        recognizeStockPhoto(ph.full, gen, scanKind);
      }, function () { toast('这张照片读不了，换一张试试'); });
    }

    /* ---------- 识图接口（用户自己的） ---------- */

    // 用户在「识图设置」里填的接口、密钥、模型，只存在这台设备的浏览器里，不进备份
    function visionCfg() {
      try { var t = window.localStorage.getItem(visionKey); var c = t ? JSON.parse(t) : null; return c && typeof c === 'object' ? c : {}; } catch (e) { return {}; }
    }
    function saveVisionCfg(c) {
      try {
        if (c) window.localStorage.setItem(visionKey, JSON.stringify(c)); else window.localStorage.removeItem(visionKey);
        return true;
      } catch (e) { return false; }
    }
    // 自己填了密钥就直接调；没填时，如果页面是从服务器打开的，就试试 server.js 的代理
    function visionRoute() {
      if (visionCfg().key) return 'direct';
      if (opts.visionProxy || location.protocol !== 'file:') return 'proxy';
      return '';
    }
    var NEED_SETUP = '还没设置识图接口。点下面的「识图设置」填你自己的 AI 接口和密钥，或者改用手加。';

    function recognizeStockPhoto(dataUrl, gen, scanKind) {
      var receipt = scanKind === 'receipt';
      var mode = receipt ? 'receipt' : 'stock';
      function live() { return gen === ui.scanGen && ui.sheet && ui.sheet.kind === 'stock-scan'; }
      function fail(msg, setup) {
        if (!live()) return;
        ui.sheet.args.status = 'review';
        ui.sheet.args.err = msg;
        ui.sheet.args.setup = !!setup;
        ui.sheet.args.lines = ui.sheet.args.lines || [];
        renderSheet();
      }
      function done(items) {
        if (!live()) return;
        var lines = window.CookVision.mapItems(items, E.dict(S));
        ui.sheet.args.status = 'review';
        ui.sheet.args.lines = lines;
        ui.sheet.args.setup = false;
        ui.sheet.args.err = lines.length ? '' : (receipt
          ? '没认出小票上的食材。换张更清楚的再拍，或者改用手加。'
          : '没认出食材。换个角度再拍，或者改用手加。');
        renderSheet();
      }
      if (!window.CookVision || !window.CookVisionApi) {
        fail('没加载到识图功能：页面里要引入 core/vision-map.js 和 core/vision.js。也可以关掉后改用手加。');
        return;
      }
      var route = visionRoute();
      if (route === 'direct') {
        window.CookVisionApi.recognize(visionCfg(), dataUrl, mode).then(done, function (e) {
          fail((e && e.message) || '识别失败', true);
        });
        return;
      }
      if (route !== 'proxy') { fail(NEED_SETUP, true); return; }
      fetch(visionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, mode: mode })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { j = j || {}; j.status = r.status; return j; });
      }).then(function (j) {
        if (j.ok) { done(j.items); return; }
        // 没有代理（404/405）或代理没配密钥（503）时，引导用户去填自己的接口
        if (j.status === 503) { fail(NEED_SETUP + '自己运行 server.js 的，也可以设置 VISION_API_KEY 后重启。', true); return; }
        if (!j.error || j.status === 404 || j.status === 405) { fail(NEED_SETUP, true); return; }
        fail(j.error + '。可以改用手加，或在「识图设置」里填你自己的接口。', true);
      }, function () { fail(NEED_SETUP, true); });
    }

    /* ---------- 提示条 ---------- */

    function toast(msg, actLabel, fn) {
      clearTimeout(toastTimer);
      toastEl.querySelector('.ck-toast-msg').textContent = msg;
      var b = toastEl.querySelector('button');
      toastFn = fn || null;
      if (actLabel && fn) { b.hidden = false; b.textContent = actLabel; } else { b.hidden = true; }
      toastEl.classList.add('is-on');
      toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); toastFn = null; }, fn ? 6000 : 3000);
    }

    /* ---------- 动作 ---------- */

    function removeStockWithUndo(name, msg) {
      var old = S.stock[name];
      delete S.stock[name];
      commit(); render();
      toast(msg || (name + ' 用完了，已从库存移除'), '撤销', function () { S.stock[name] = old; commit(); render(); });
    }

    function pickIngredient(name, origin) {
      var i = info(name);
      if (!i) { openSheet('ing', { name: name, origin: origin }); return; }
      if (origin === 'shop') {
        addShop(name, defaultBuy(i.u), i.u); commit(); render();
        toast('已加入清单：' + name);
        return;
      }
      if (i.c === '调料') {
        if (!hasSpice(name)) { S.spices.push(name); commit(); }
        ui.q = ''; clearInput('stock-q'); render();
        toast('记下了，家里有' + name);
        return;
      }
      openSheet('stock', { name: name, mode: S.stock[name] ? 'add' : 'set' });
    }
    function clearInput(key) {
      var inp = headEl.querySelector('[data-input="' + key + '"]');
      if (inp) inp.value = '';
    }

    function cook(rid) {
      var r = findRecipe(rid); if (!r) return;
      var n = ui.sheetServ;
      var snap = JSON.stringify({ stock: S.stock, log: S.log });
      var lacking = E.cook(S, r, n).lacking;
      commit(); closeSheet(); render();
      toast(lacking ? '已扣库存，不够的部分按用完算' : '已扣掉' + r.name + '用的食材', '撤销', function () {
        var o = JSON.parse(snap); S.stock = o.stock; S.log = o.log; commit(); render();
      });
    }

    function missToShop(rid) {
      var r = findRecipe(rid); if (!r) return;
      var mc = E.missToShop(S, r, ui.sheetServ);
      commit(); closeSheet(); render();
      toast('已把 ' + mc + ' 样加入清单', '去看看', function () { ui.tab = 'shop'; render(); toastEl.classList.remove('is-on'); });
    }

    function loadDemo() {
      DEMO_STOCK.forEach(function (d) { addStock(d[0], d[1], d[2] === null ? null : addDays(d[2]), 'set'); });
      commit(); ui.tab = 'match'; render();
      toast('已放入 ' + DEMO_STOCK.length + ' 样示例食材，可以在库存里改掉');
    }

    function exportData() {
      PhotoDB.all(photoPrefix).then(function (all) {
        var out = JSON.parse(JSON.stringify(S));
        out.photos = {};
        Object.keys(all).forEach(function (k) { out.photos[k.slice(photoPrefix.length)] = all[k]; });
        saveBackup(JSON.stringify(out, null, 2));
      });
    }
    function saveBackup(text) {
      try {
        var blob = new Blob([text], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '做饭备份-' + ymd(new Date()) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        toast('备份文件已下载');
      } catch (e) {
        copyText(text, '下载不了，已把备份内容复制到剪贴板');
      }
    }
    function copyText(text, okMsg) {
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        toast(ok ? okMsg : '复制失败，请手动选择文字复制');
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
      } else fallback();
    }

    /* ---------- 表单提交 ---------- */

    function formErr(f, msg) { var e = f.querySelector('.ck-err'); if (e) e.textContent = msg; }
    function radioVal(f, name) { var x = f.querySelector('input[name="' + name + '"]:checked'); return x ? x.value : ''; }

    var FORMS = {
      'stock-search': function (f) {
        var name = normName(f.q.value);
        if (!name) return;
        pickIngredient(name, 'stock');
      },
      'shop-add': function (f) {
        var name = normName(f.q.value);
        if (!name) return;
        f.q.value = '';
        pickIngredient(name, 'shop');
      },
      stock: function (f) {
        var name = ui.sheet.args.name;
        var raw = parseFloat(String(f.qty.value).replace(/[^\d.]/g, ''));
        var factor = 1;
        if (f.unit) WEIGHT.forEach(function (w) { if (w[0] === f.unit.value) factor = w[1]; });
        if (!(raw > 0)) { formErr(f, '数量要填一个大于 0 的数'); return; }
        var qty = r2(raw * factor);
        var exp = f.date.value || '';
        var ev = radioVal(f, 'exp');
        if (!exp && ev) exp = addDays(+ev);
        var mode = radioVal(f, 'mode') || 'set';
        var existed = !!S.stock[name];
        addStock(name, qty, exp || null, mode);
        ui.q = ''; clearInput('stock-q');
        commit(); closeSheet(); render();
        var st = S.stock[name];
        toast((existed ? '已更新：' : '已放进库存：') + name + (st ? ' ' + fmtQty(st.qty, unitOf(name)) : ''));
      },
      ing: function (f) {
        var name = normName(f.name.value);
        if (!name) { formErr(f, '先写个名字'); return; }
        var c = radioVal(f, 'c') || '其他';
        var u = c === '调料' ? '' : (radioVal(f, 'u') || '个');
        if (!ING[name] && SPICES.indexOf(name) < 0) S.custom.ing[name] = { u: u, c: c };
        var origin = ui.sheet.args.origin;
        if (c === '调料' && !hasSpice(name) && origin !== 'shop') S.spices.push(name);
        commit();
        if (origin === 'shop') { closeSheet(); pickIngredient(name, 'shop'); return; }
        if (c === '调料') { ui.q = ''; clearInput('stock-q'); closeSheet(); render(); toast('记下了，家里有' + name); return; }
        openSheet('stock', { name: name, mode: 'set' });
        render();
      },
      recipe: function (f) {
        var name = String(f.name.value).trim();
        if (!name) { formErr(f, '先写菜名'); return; }
        var items = {}, sp = [], bad = '';
        f.querySelectorAll('.ck-irow').forEach(function (row) {
          var n = normName(row.querySelector('[name=in]').value);
          if (!n) return;
          var qv = parseFloat(String(row.querySelector('[name=iq]').value).replace(/[^\d.]/g, ''));
          if (isSpice(n)) { if (sp.indexOf(n) < 0) sp.push(n); return; }
          if (!(qv > 0)) { bad = n; return; }
          if (!info(n)) S.custom.ing[n] = { u: row.querySelector('[name=iu]').value, c: '其他' };
          items[n] = (items[n] || 0) + qv;
        });
        if (bad) { formErr(f, '「' + bad + '」的用量要填数字'); return; }
        f.querySelectorAll('input[name=sp]:checked').forEach(function (x) {
          if (!info(x.value)) S.custom.ing[x.value] = { u: '', c: '调料' }; // 导入时识别出的新调料
          if (sp.indexOf(x.value) < 0) sp.push(x.value);
        });
        if (!Object.keys(items).length && !sp.length) { formErr(f, '至少填一样食材'); return; }
        var rec = {
          id: f.querySelector('[name=rid]').value || 'u' + Date.now().toString(36),
          name: name,
          cat: radioVal(f, 'cat') || '素菜',
          base: +radioVal(f, 'base') || 2,
          min: parseInt(f.min.value, 10) || 0,
          items: items, s: sp, o: [],
          steps: String(f.steps.value).split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
          src: /^https?:\/\//.test(f.querySelector('[name=src]').value) ? f.querySelector('[name=src]').value : '',
          mine: true
        };
        var fp = ui.formPhoto;
        rec.img = fp && fp.url ? fp.url : '';
        if (fp && fp.full) { photos[rec.id] = { full: fp.full, thumb: fp.thumb }; PhotoDB.set(photoPrefix + rec.id, photos[rec.id]); }
        else if (photos[rec.id]) { delete photos[rec.id]; PhotoDB.del(photoPrefix + rec.id); }
        var idx = -1;
        S.custom.recipes.forEach(function (r, i) { if (r.id === rec.id) idx = i; });
        if (idx >= 0) S.custom.recipes[idx] = rec; else S.custom.recipes.push(rec);
        commit(); render();
        openSheet('recipe', { id: rec.id });
        toast(idx >= 0 ? '已保存修改' : '已新建：' + name);
      },
      vision: function (f) {
        var base = String(f.base.value).trim(), key = String(f.key.value).trim(), model = String(f.model.value).trim();
        if (!key) { formErr(f, '先填 API 密钥'); return; }
        if (base && !/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(base)) {
          formErr(f, '接口地址要以 https:// 开头'); return;
        }
        if (!saveVisionCfg({ base: base, key: key, model: model })) { formErr(f, '这个浏览器存不了设置（可能是无痕模式）'); return; }
        closeSheet(); render(); toast('识图设置已保存');
      },
      'stock-scan': function (f) {
        var mode = radioVal(f, 'scan-mode') || (ui.sheet && ui.sheet.args.mode) || 'add';
        var added = 0, spices = 0, bad = '';
        var snap = JSON.stringify({ stock: S.stock, spices: S.spices, custom: S.custom });
        f.querySelectorAll('.ck-scanrow').forEach(function (row) {
          if (row.getAttribute('data-kind') === 'spice') {
            var on = row.querySelector('[name=sk]');
            var sn = row.getAttribute('data-n') || '';
            sn = normName(sn);
            if (on && on.checked && sn) {
              if (info(sn) && info(sn).c !== '调料' && !isSpice(sn)) return;
              if (!info(sn)) S.custom.ing[sn] = { u: '', c: '调料' };
              if (!hasSpice(sn)) { S.spices.push(sn); spices++; }
            }
            return;
          }
          var inp = row.querySelector('[name=sn]');
          if (!inp) return;
          var n = normName(inp.value);
          if (!n) return;
          if (isSpice(n)) {
            if (!hasSpice(n)) { S.spices.push(n); spices++; }
            return;
          }
          var qv = parseFloat(String(row.querySelector('[name=sq]').value).replace(/[^\d.]/g, ''));
          if (!(qv > 0)) { bad = n; return; }
          if (!info(n)) {
            var u = row.querySelector('[name=su]').value;
            S.custom.ing[n] = { u: UNITS.indexOf(u) >= 0 ? u : '个', c: '其他' };
          }
          addStock(n, qv, null, mode);
          added++;
        });
        if (bad) { formErr(f, '「' + bad + '」的数量要填大于 0 的数'); return; }
        if (!added && !spices) { formErr(f, '至少留一样再放进库存'); return; }
        commit(); closeSheet(); render();
        toast('已放入 ' + (added + spices) + ' 样', '撤销', function () {
          var o = JSON.parse(snap); S.stock = o.stock; S.spices = o.spices; S.custom = o.custom; commit(); render();
        });
      }
    };

    /* ---------- 事件 ---------- */

    function onClick(e) {
      var t = e.target.closest('[data-act]');
      if (!t || !el.contains(t)) return;
      var act = t.getAttribute('data-act');
      var n = t.getAttribute('data-n');
      var d = +t.getAttribute('data-d') || 0;
      var i = +t.getAttribute('data-i');
      switch (act) {
        case 'tab': ui.tab = t.getAttribute('data-tab'); ui.q = ''; ui.rq = ''; render(); break;
        case 'srv': S.servings = Math.min(12, Math.max(1, S.servings + d)); commit(); render(); break;
        case 'filter': ui.filter = t.getAttribute('data-v'); renderBody(); break;
        case 'rfilter': ui.rfilter = t.getAttribute('data-v'); renderBody(); break;
        case 'toggle-far': ui.showFar = !ui.showFar; renderBody(); break;
        case 'demo': loadDemo(); break;
        case 'recipe': openSheet('recipe', { id: t.getAttribute('data-id') }); break;
        case 'close-sheet': closeSheet(); break;
        case 'sh-srv': ui.sheetServ = Math.min(12, Math.max(1, ui.sheetServ + d)); renderSheet(); break;
        case 'cook': cook(t.getAttribute('data-id')); break;
        case 'miss-to-shop': missToShop(t.getAttribute('data-id')); break;
        case 'new-recipe': openSheet('recipe-form', {}); break;
        case 'photo-pick': ui.photoFor = t.getAttribute('data-id'); photoEl.value = ''; photoEl.click(); break;
        case 'stock-photo': pickStockPhoto(t.getAttribute('data-src') || 'camera', t.getAttribute('data-kind') || 'stock'); break;
        case 'scan-add': {
          var sbox = sheetEl.querySelector('[data-scan-rows]');
          if (!sbox) break;
          sbox.insertAdjacentHTML('beforeend', scanRow({ kind: 'stock', name: '', qty: '', unit: '个', known: false, note: '' }));
          var sub = sheetEl.querySelector('form[data-form="stock-scan"] [type=submit]');
          if (sub) sub.disabled = false;
          sbox.lastElementChild.querySelector('input').focus();
          break;
        }
        case 'scan-del': {
          var srow = t.closest('.ck-scanrow');
          if (srow) srow.remove();
          break;
        }
        case 'vision-settings': openSheet('vision'); break;
        case 'vision-clear':
          if (window.confirm('清除这台设备上保存的识图接口和密钥？')) { saveVisionCfg(null); closeSheet(); render(); toast('识图设置已清除'); }
          break;
        case 'fphoto-clear': ui.formPhoto = null; refreshFormPhoto(); break;
        case 'photo-del': {
          var pid = t.getAttribute('data-id');
          if (!window.confirm('删除这张成品照片？')) break;
          if (photos[pid]) { delete photos[pid]; PhotoDB.del(photoPrefix + pid); }
          else S.custom.recipes.forEach(function (x) { if (x.id === pid) x.img = ''; });
          commit(); renderSheet(); renderBody(); toast('照片已删除');
          break;
        }
        case 'edit-recipe': openSheet('recipe-form', { id: t.getAttribute('data-id') }); break;
        case 'del-recipe':
          if (window.confirm('删除这道菜谱？')) {
            var rid = t.getAttribute('data-id');
            S.custom.recipes = S.custom.recipes.filter(function (r) { return r.id !== rid; });
            delete S.log[rid];
            if (photos[rid]) { delete photos[rid]; PhotoDB.del(photoPrefix + rid); }
            commit(); closeSheet(); render(); toast('已删除');
          }
          break;
        case 'add-row': {
          var box = sheetEl.querySelector('[data-rows]');
          box.insertAdjacentHTML('beforeend', ingRow('', ''));
          box.lastElementChild.querySelector('input').focus();
          break;
        }
        case 'row-del': {
          var row = t.closest('.ck-irow');
          if (row.parentNode.children.length > 1) row.remove();
          else row.querySelectorAll('input').forEach(function (x) { x.value = ''; });
          break;
        }
        case 'pick': pickIngredient(n, 'stock'); break;
        case 'new-ing': openSheet('ing', { name: n || '', c: t.getAttribute('data-c') || '', origin: 'stock' }); break;
        case 'edit-stock': openSheet('stock', { name: n, mode: 'set' }); break;
        case 'stock-step': {
          var st = S.stock[n]; if (!st) break;
          var nq = r2(st.qty + d * stepOf(unitOf(n)));
          if (nq <= 0) { removeStockWithUndo(n); break; }
          st.qty = nq; commit(); renderBody(); break;
        }
        case 'stock-del': closeSheet(); removeStockWithUndo(n, n + ' 已从库存移除'); break;
        case 'spice': {
          var k = S.spices.indexOf(n);
          if (k >= 0) S.spices.splice(k, 1); else S.spices.push(n);
          commit();
          t.classList.toggle('is-on', k < 0);
          t.setAttribute('aria-pressed', String(k < 0));
          break;
        }
        case 'f-step': {
          var f = t.closest('form'), inp = f.qty;
          var unit = f.unit ? f.unit.value : unitOf(ui.sheet.args.name);
          var step = { '克': 50, '两': 1, '斤': 0.5, '千克': 0.5, '毫升': 100 }[unit] || 1;
          var v = parseFloat(inp.value) || 0;
          v = Math.max(0, r2(v + d * step));
          inp.value = fmtNum(v);
          updateHint(f);
          break;
        }
        case 'shop-toggle': S.shop[i].done = !S.shop[i].done; commit(); render(); break;
        case 'shop-step': {
          var x = S.shop[i];
          x.q = Math.max(stepOf(x.u), r2(x.q + d * stepOf(x.u)));
          commit(); renderBody(); break;
        }
        case 'shop-del': {
          var removed = S.shop.splice(i, 1)[0];
          commit(); render();
          toast('已删掉' + removed.n, '撤销', function () { S.shop.splice(i, 0, removed); commit(); render(); });
          break;
        }
        case 'shop-in': {
          var got = S.shop.filter(function (s) { return s.done; });
          got.forEach(function (s) {
            if (isSpice(s.n) || !s.u) { if (!hasSpice(s.n)) S.spices.push(s.n); }
            else addStock(s.n, s.q || defaultBuy(s.u), null, 'add');
          });
          S.shop = S.shop.filter(function (s) { return !s.done; });
          commit(); render();
          toast('已把 ' + got.length + ' 样放进库存');
          break;
        }
        case 'shop-copy': {
          var lines = S.shop.filter(function (s) { return !s.done; }).map(function (s) { return s.n + (s.u ? ' ' + fmtQty(s.q, s.u) : ''); });
          if (!lines.length) { toast('清单里的都买到了'); break; }
          copyText('购物清单\n' + lines.join('\n'), '已复制，可以直接发到微信');
          break;
        }
        case 'shop-clear':
          if (window.confirm('清空整个购物清单？')) { S.shop = []; commit(); render(); }
          break;
        case 'export': exportData(); break;
        case 'import': fileEl.value = ''; fileEl.click(); break;
        case 'clear-stock':
          if (window.confirm('把库存全部清空？调料和菜谱会保留。')) {
            var old = S.stock; S.stock = {}; commit(); render();
            toast('库存已清空', '撤销', function () { S.stock = old; commit(); render(); });
          }
          break;
      }
    }

    function updateHint(f) {
      var hint = f.querySelector('[data-hint]'); if (!hint) return;
      if (!f.unit) { hint.textContent = ''; return; }
      var v = parseFloat(f.qty.value) || 0, factor = 1;
      WEIGHT.forEach(function (w) { if (w[0] === f.unit.value) factor = w[1]; });
      var g = v * factor;
      hint.textContent = g > 0 ? (f.unit.value === '克' ? '约 ' + fmtNum(g / 500) + ' 斤' : '= ' + fmtNum(g) + ' 克') : '';
    }

    function onInput(e) {
      var t = e.target;
      var key = t.getAttribute && t.getAttribute('data-input');
      // 搜索框失焦时也会触发 change；这时重绘会吃掉正在点的建议项，所以只认 input
      if (key && e.type === 'change') return;
      if (key === 'stock-q') { ui.q = t.value.trim(); renderBody(); return; }
      if (key === 'recipe-q') { ui.rq = t.value.trim(); renderBody(); return; }
      if (t.name === 'qty' || t.name === 'unit') { updateHint(t.form); return; }
      if (t.name === 'date' && t.value) {
        var r = t.form.querySelector('input[name=exp]:checked'); if (r) r.checked = false;
        return;
      }
      if (t.name === 'exp') { var dt = t.form.date; if (dt) dt.value = ''; return; }
      if (t.name === 'mode' && e.type === 'change' && ui.sheet && ui.sheet.kind === 'stock') { ui.sheet.args.mode = t.value; renderSheet(); return; }
      if (t.name === 'in') {
        var row = t.closest('.ck-irow'), sel = row.querySelector('[name=iu]');
        var i = info(normName(t.value));
        if (i && i.u) { sel.value = i.u; sel.disabled = true; } else { sel.disabled = false; }
        return;
      }
      if (t.name === 'sn') {
        var srow = t.closest('.ck-scanrow'), ssel = srow && srow.querySelector('[name=su]');
        if (!ssel) return;
        var si = info(normName(t.value));
        if (si && si.u) { ssel.value = si.u; ssel.disabled = true; } else { ssel.disabled = false; }
        return;
      }
      if (t.name === 'scan-mode' && e.type === 'change' && ui.sheet && ui.sheet.kind === 'stock-scan') {
        ui.sheet.args.mode = t.value;
        return;
      }
      if (t.name === 'c') {
        var box = t.form.querySelector('[data-unitbox]');
        if (box) box.hidden = t.value === '调料';
      }
    }

    function onSubmit(e) {
      var f = e.target.closest('form[data-form]');
      if (!f || !el.contains(f)) return;
      e.preventDefault();
      var fn = FORMS[f.getAttribute('data-form')];
      if (fn) fn(f);
    }

    function onToggle(e) {
      if (e.target.classList && e.target.classList.contains('ck-quick') && Object.keys(S.stock).length) ui.quickOpen = e.target.open;
    }

    function onKey(e) {
      if (e.key === 'Escape' && ui.sheet) { e.preventDefault(); closeSheet(); }
    }

    function onFile() {
      var file = fileEl.files && fileEl.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); } catch (e) { toast('这个文件不是有效的备份'); return; }
        if (!data || typeof data !== 'object' || !data.stock) { toast('这个文件不是做饭模块的备份'); return; }
        if (!window.confirm('导入会覆盖现在的库存、调料、清单和自己的菜谱，继续？')) return;
        S = E.normalize(data);
        if (data.photos && typeof data.photos === 'object') {
          Object.keys(data.photos).forEach(function (rid) {
            var ph = data.photos[rid];
            if (ph && /^data:image\//.test(ph.full || '') && /^data:image\//.test(ph.thumb || '')) {
              photos[rid] = { full: ph.full, thumb: ph.thumb };
              PhotoDB.set(photoPrefix + rid, photos[rid]);
            }
          });
        }
        commit(); render(); toast('导入好了');
      };
      reader.readAsText(file);
    }

    function onPhoto() {
      var file = photoEl.files && photoEl.files[0], target = ui.photoFor;
      if (!file || !target) return;
      compressPhoto(file).then(function (ph) {
        if (target === 'form') { ui.formPhoto = ph; refreshFormPhoto(); return; }
        photos[target] = ph;
        PhotoDB.set(photoPrefix + target, ph);
        if (ui.sheet && ui.sheet.kind === 'recipe') renderSheet();
        renderBody();
        toast('成品照片已保存');
      }, function () { toast('这张照片读不了，换一张试试'); });
    }
    function onImgError(e) {
      var t = e.target;
      if (!t || t.tagName !== 'IMG' || !t.hasAttribute('data-ck-img')) return;
      t.classList.add('is-broken');
      var fig = t.closest('.ck-photo');
      if (fig) fig.classList.add('is-broken');
    }

    el.addEventListener('click', onClick);
    el.addEventListener('error', onImgError, true);
    photoEl.addEventListener('change', onPhoto);
    stockCamEl.addEventListener('change', onStockFile);
    stockGalEl.addEventListener('change', onStockFile);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    el.addEventListener('submit', onSubmit);
    el.addEventListener('toggle', onToggle, true);
    document.addEventListener('keydown', onKey);
    fileEl.addEventListener('change', onFile);
    toastEl.querySelector('button').addEventListener('click', function (e) {
      e.stopPropagation();
      var fn = toastFn; toastFn = null;
      toastEl.classList.remove('is-on');
      if (fn) fn();
    });
    cleanups.push(function () {
      el.removeEventListener('click', onClick);
      el.removeEventListener('error', onImgError, true);
      el.removeEventListener('input', onInput);
      el.removeEventListener('change', onInput);
      el.removeEventListener('submit', onSubmit);
      el.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('keydown', onKey);
    });

    // 手机键盘弹起时，让底部弹层跟着上移
    if (window.visualViewport) {
      var vv = window.visualViewport;
      var onVV = function () {
        var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        el.style.setProperty('--ck-kb', (kb > 60 ? kb : 0) + 'px');
      };
      vv.addEventListener('resize', onVV);
      vv.addEventListener('scroll', onVV);
      cleanups.push(function () { vv.removeEventListener('resize', onVV); vv.removeEventListener('scroll', onVV); });
    }

    render();
    PhotoDB.all(photoPrefix).then(function (all) {
      var keys = Object.keys(all);
      if (!keys.length) return;
      keys.forEach(function (k) { photos[k.slice(photoPrefix.length)] = all[k]; });
      renderBody();
      if (ui.sheet && ui.sheet.kind === 'recipe') renderSheet();
    });

    var api = {
      getData: function () { return JSON.parse(JSON.stringify(S)); },
      setData: function (d) { S = E.normalize(d); commit(); render(); },
      go: function (tab) { if (VIEWS[tab]) { ui.tab = tab; render(); } },
      destroy: function () {
        cleanups.forEach(function (fn) { fn(); });
        clearTimeout(toastTimer);
        document.documentElement.classList.remove('ck-lock');
        el.innerHTML = '';
        el.classList.remove('ck', 'is-sheet');
        delete el.__cook;
      }
    };
    el.__cook = api;
    return api;
  }

  window.CookModule = { mount: mount, recipes: RECIPES, version: '2.0.0' };

  // 页面里有 #cook-app 或 [data-cook-app] 时自动挂载；想自己控制就先设置 window.COOK_NO_AUTOMOUNT = true
  function auto() {
    if (window.COOK_NO_AUTOMOUNT) return;
    var target = document.querySelector('[data-cook-app]') || document.getElementById('cook-app');
    if (target && !target.__cook) {
      mount(target, {
        nav: target.getAttribute('data-nav') || 'bottom',
        theme: target.getAttribute('data-theme') || 'auto',
        storageKey: target.getAttribute('data-storage-key') || undefined,
        visionProxy: target.getAttribute('data-vision-proxy') || undefined
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
