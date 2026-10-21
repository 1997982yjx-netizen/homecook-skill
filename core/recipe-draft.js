/*
 * 把 AI 整理出来的菜谱（菜名、用料原文、调料、做法）对照食材字典，变成可以保存的菜谱草稿。
 * 浏览器里挂在 window.CookDraft，Node 里 require 也能用。需要 core/engine.js 创建的引擎 E。
 *
 *   var dr = CookDraft.fromNote(E, S, { title, ingredients: [{ name, amount }], seasonings, optional, steps, category, minutes, serves, source });
 *   // dr.items 里标了 note 的行需要用户核对
 *   var r = CookDraft.toRecipe(E, S, dr);   // 保存成"我的菜谱"，返回 { recipe } 或 { error }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CookDraft = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var RCATS = ['荤菜', '素菜', '蛋类', '汤', '主食'];
  var UNITS = ['克', '个', '根', '包', '块', '条', '碗', '朵', '毫升', '瓶', '袋'];
  var SKIP_ING = /^(水|清水|温水|开水|热水|冷水|凉水|冰水|冰块|纯净水|矿泉水)$/;
  // 计数食材大约多重，用来把"300克番茄"换算成个数
  var AVG_G = { '番茄': 150, '土豆': 200, '青椒': 100, '黄瓜': 250, '茄子': 250, '胡萝卜': 150, '洋葱': 200, '香菇': 20,
    '鸡蛋': 55, '皮蛋': 60, '豆腐': 400, '鸡翅': 50, '鸡腿': 200, '鱼': 600, '米饭': 200, '火腿肠': 50, '金针菇': 200 };

  var CN = { '零': 0, '一': 1, '二': 2, '两': 2, '俩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function cnInt(s) {
    if (s.indexOf('十') < 0) return CN[s];
    var p = s.split('十');
    return (p[0] ? CN[p[0]] : 1) * 10 + (p[1] ? CN[p[1]] : 0);
  }
  var WEIGHT = { 'g': 1, '克': 1, 'kg': 1000, '千克': 1000, '公斤': 1000, '斤': 500, '两': 50 };
  var VOLUME = { 'ml': 1, '毫升': 1, 'l': 1000, '升': 1000 };
  var COUNT = { '个': '个', '只': '个', '颗': '个', '枚': '个', '粒': '个', '根': '根', '条': '条', '块': '块', '朵': '朵', '包': '包', '袋': '袋', '碗': '碗', '瓶': '瓶', '盒': '包', '把': '把', '棵': '棵', '头': '头', '片': '片', '瓣': '瓣', '节': '节', '段': '段', '张': '张' };
  var SPOON = { '勺': 1, '汤匙': 1, '大勺': 1, '小勺': 1, '茶匙': 1, '杯': 1, '小碗': 1 };

  // "2个" "300g" "半斤" "一勺" "适量" → { num, unit, kind: weight/volume/count/spoon/vague/none, grams?, ml? }
  function parseAmount(raw) {
    var s = String(raw == null ? '' : raw).trim()
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[．]/g, '.').replace(/\s+/g, '').replace(/^(约|大约|大概)/, '').replace(/(左右|多|以上)$/, '');
    if (!s) return { num: null, unit: '', kind: 'none', raw: raw };
    if (/^(适量|少许|少量|若干|一点|随意|按口味|适当|酌量|根据口味|几)/.test(s)) return { num: null, unit: '', kind: 'vague', raw: raw };

    var num = NaN, rest = s, m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/))) { num = +m[1] / +m[2]; rest = s.slice(m[0].length); }
    else if ((m = s.match(/^(\d+(?:\.\d+)?)(?:[-~～到至](\d+(?:\.\d+)?))?/))) { num = +m[1]; rest = s.slice(m[0].length); }
    else if ((m = s.match(/^半/))) { num = 0.5; rest = s.slice(1); }
    else if ((m = s.match(/^([一二两三四五六七八九]?十[一二三四五六七八九]?|[一二两俩三四五六七八九])/))) {
      num = cnInt(m[1] === '俩' ? '两' : m[1]); rest = s.slice(m[0].length);
      var range = rest.match(/^[到至-]?([一二两三四五六七八九])/);
      if (range && !/^两/.test(rest)) rest = rest.slice(range[0].length);
    }
    if (isNaN(num)) return { num: null, unit: '', kind: 'none', raw: raw };

    var unitMatch = rest.match(/^(kg|g|ml|l|千克|公斤|克|斤|两|毫升|升|汤匙|茶匙|大勺|小勺|小碗|勺|杯|个|只|颗|枚|粒|根|条|块|朵|包|袋|碗|瓶|盒|把|棵|头|片|瓣|节|段|张)/i);
    var unit = unitMatch ? unitMatch[1].toLowerCase() : '';
    rest = unitMatch ? rest.slice(unitMatch[0].length) : rest;
    if (/^半/.test(rest)) num += 0.5; // 一个半

    if (WEIGHT[unit]) return { num: num, unit: '克', kind: 'weight', grams: num * WEIGHT[unit], raw: raw };
    if (VOLUME[unit]) return { num: num, unit: '毫升', kind: 'volume', ml: num * VOLUME[unit], raw: raw };
    if (SPOON[unit]) return { num: num, unit: '勺', kind: 'spoon', raw: raw };
    if (COUNT[unit]) return { num: num, unit: COUNT[unit], kind: 'count', raw: raw };
    return { num: num, unit: '', kind: 'count', raw: raw };
  }

  function r2(n) { return Math.round(n * 100) / 100; }

  // 原文里的名字对照字典：去掉括号、常见修饰词和刀工后缀，再找包含的字典词
  function matchName(E, S, raw) {
    var s = String(raw || '').replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').replace(/\s+/g, '').trim();
    if (!s) return { name: '', known: false };
    var n = E.normName(S, s);
    if (E.info(S, n)) return { name: n, known: true };
    var t = s.replace(/^(新鲜|冷冻|去皮|去骨|带皮|精选|嫩|土)/, '').replace(/(丁|丝|片|块|末|碎|段|粒|泥|液|汁|蓉)$/, '');
    n = E.normName(S, t);
    if (t && E.info(S, n)) return { name: n, known: true };
    var best = '';
    Object.keys(E.ingredients).forEach(function (k) { if (k.length >= 2 && s.indexOf(k) >= 0 && k.length > best.length) best = k; });
    return best ? { name: best, known: true } : { name: s, known: false };
  }

  function guessCat(E, S, title, names) {
    if (/汤|羹|煲/.test(title)) return '汤';
    if (/饭|面|粥|饼|包子|饺|馄饨|粉|馒头|花卷|吐司|面包|蛋糕/.test(title)) return '主食';
    if (names.some(function (x) { var i = E.info(S, x); return i && (i.c === '肉禽' || i.c === '水产'); })) return '荤菜';
    if (names.indexOf('鸡蛋') >= 0 || /蛋/.test(title)) return '蛋类';
    return '素菜';
  }

  // AI 整理出的菜谱 → 草稿 { name, cat, base, min, items: [{ n, q, u?, note }], sp, extra, steps, src }
  // sp：字典里的调料；extra：字典里没有、又没写具体用量的东西，当作新调料
  function fromNote(E, S, p) {
    p = p || {};
    var items = [], byName = {}, sp = [], extra = [];
    var ings = (p.ingredients || []).slice();
    (p.seasonings || []).concat(p.optional || []).forEach(function (name) {
      if (name && !ings.some(function (i) { return i.name === name; })) ings.push({ name: name, amount: '适量' });
    });
    ings.forEach(function (ing) {
      if (!ing || !ing.name) return;
      var m = matchName(E, S, ing.name), a = parseAmount(ing.amount), raw = ing.amount || '没写用量';
      if (!m.name || SKIP_ING.test(m.name)) return;
      if (m.known && E.isSpice(S, m.name)) { if (sp.indexOf(m.name) < 0) sp.push(m.name); return; }
      if (!m.known && (a.kind === 'vague' || a.kind === 'none' || a.kind === 'spoon')) { if (extra.indexOf(m.name) < 0) extra.push(m.name); return; }
      var row = { n: m.name, q: '', note: '' };
      if (m.known) {
        var u = E.unitOf(S, m.name);
        if (u === '克' || u === '毫升') {
          if (a.kind === 'weight') row.q = Math.round(a.grams);
          else if (a.kind === 'volume') row.q = Math.round(a.ml);
          else row.note = '原文是"' + raw + '"，请换成' + u + '数';
        } else if (a.kind === 'count' && a.num !== null) {
          row.q = a.num;
          if (a.unit && a.unit !== u && a.unit !== '个') row.note = '原文是"' + raw + '"，单位是' + u + '，请核对';
        } else if (a.kind === 'weight' && AVG_G[m.name]) {
          row.q = Math.max(0.5, Math.round(a.grams / AVG_G[m.name] * 2) / 2);
          row.note = '原文是"' + raw + '"，按 1' + u + '约 ' + AVG_G[m.name] + ' 克估算';
        } else {
          row.note = '原文是"' + raw + '"，请填' + u + '数';
        }
        if (String(ing.name).replace(/\s+/g, '') !== m.name && !row.note) row.note = '原文写的是"' + ing.name + '"';
      } else {
        row.u = a.kind === 'weight' ? '克' : a.kind === 'volume' ? '毫升' : (UNITS.indexOf(a.unit) >= 0 ? a.unit : '个');
        row.q = a.kind === 'weight' ? Math.round(a.grams) : a.kind === 'volume' ? Math.round(a.ml) : a.num;
        row.note = '新食材，保存时会加进字典';
      }
      var prev = byName[m.name];
      if (prev) { if (typeof prev.q === 'number' && typeof row.q === 'number') prev.q = r2(prev.q + row.q); return; }
      byName[m.name] = row;
      items.push(row);
    });
    var title = String(p.title || '').trim();
    var name = title.replace(/【[^】]*】|\[[^\]]*\]/g, '').trim() || title;
    var serves = p.serves >= 1 && p.serves <= 4 ? Math.round(p.serves) : 2;
    var cat = RCATS.indexOf(p.category) >= 0 ? p.category : guessCat(E, S, name, items.map(function (x) { return x.n; }));
    return {
      name: name, cat: cat, base: serves, min: +p.minutes > 0 ? Math.round(+p.minutes) : 0,
      items: items, sp: sp, extra: extra, steps: (p.steps || []).map(String).filter(Boolean).slice(0, 40),
      src: /^https?:\/\//.test(p.source || '') ? p.source : ''
    };
  }

  // 草稿 → 我的菜谱（会把新食材、新调料加进 S.custom.ing）。返回 { recipe } 或 { error }
  function toRecipe(E, S, dr, id) {
    var name = String(dr.name || '').trim();
    if (!name) return { error: '没有菜名' };
    var items = {}, s = [], bad = '';
    (dr.items || []).forEach(function (it) {
      var n = E.normName(S, it.n);
      if (!n) return;
      if (E.isSpice(S, n)) { if (s.indexOf(n) < 0) s.push(n); return; }
      var q = parseFloat(it.q);
      if (!(q > 0)) { bad = n; return; }
      if (!E.info(S, n)) S.custom.ing[n] = { u: UNITS.indexOf(it.u) >= 0 ? it.u : '个', c: '其他' };
      items[n] = (items[n] || 0) + q;
    });
    if (bad) return { error: '「' + bad + '」的用量要填数字' };
    (dr.sp || []).concat(dr.extra || []).forEach(function (x) {
      if (!E.info(S, x)) S.custom.ing[x] = { u: '', c: '调料' };
      if (s.indexOf(x) < 0) s.push(x);
    });
    if (!Object.keys(items).length && !s.length) return { error: '至少要有一样食材' };
    return {
      recipe: {
        id: id || 'u' + Date.now().toString(36),
        name: name, cat: RCATS.indexOf(dr.cat) >= 0 ? dr.cat : '素菜', base: +dr.base || 2, min: +dr.min || 0,
        items: items, s: s, o: [], steps: (dr.steps || []).slice(), src: dr.src || '', mine: true
      }
    };
  }

  return { parseAmount: parseAmount, matchName: matchName, fromNote: fromNote, toRecipe: toRecipe };
});
