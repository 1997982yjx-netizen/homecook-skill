/*
 * 把识图结果整理成库存能认的行：对照食材字典和别名，把数量换算成库存用的单位。
 * 浏览器里挂在 window.CookVision；Node 里 require 也能用。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CookVision = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var UNITS = ['克', '个', '根', '包', '块', '条', '碗', '朵', '毫升', '瓶', '袋'];
  var WEIGHT = { '克': 1, 'g': 1, 'G': 1, '两': 50, '斤': 500, '千克': 1000, 'kg': 1000, 'KG': 1000 };
  var SKIP = /^(水|清水|温水|开水|热水|冷水|凉水|冰水|冰块|纯净水|矿泉水|盘子|碗|筷子|锅|人|手|购物袋|塑料袋|背心袋|打包袋|保鲜袋|包装费|打包费|配送费|运费|服务费|会员|积分|微信支付|支付宝|现金|找零|税费|折扣)$/;
  var AVG_G = {
    '番茄': 150, '土豆': 200, '青椒': 100, '黄瓜': 250, '茄子': 250, '胡萝卜': 150, '洋葱': 200, '香菇': 20,
    '鸡蛋': 55, '皮蛋': 60, '豆腐': 400, '鸡翅': 50, '鸡腿': 200, '鱼': 600, '米饭': 200, '火腿肠': 50, '金针菇': 200
  };

  function r2(n) { return Math.round(n * 100) / 100; }
  function num(v) {
    if (typeof v === 'number' && isFinite(v) && v > 0) return v;
    if (typeof v === 'string') {
      var n = parseFloat(v.replace(/[^\d.]/g, ''));
      if (isFinite(n) && n > 0) return n;
    }
    return null;
  }
  function canonUnit(u) {
    u = String(u || '').trim();
    if (UNITS.indexOf(u) >= 0) return u;
    if (WEIGHT[u]) return '克';
    var low = u.toLowerCase();
    if (low === 'ml' || low === '毫升') return '毫升';
    return '';
  }
  function gramsOf(item) {
    var g = num(item.weight_g);
    if (g) return g;
    var u = String(item.unit || '').trim();
    var q = num(item.qty);
    if (q && WEIGHT[u]) return q * WEIGHT[u];
    if (q && (u === 'g' || u === 'G')) return q;
    return null;
  }

  function infoOf(name, dict) {
    if (dict.ingredients[name]) return { u: dict.ingredients[name][0], c: dict.ingredients[name][1] };
    if (dict.seasonings.indexOf(name) >= 0) return { u: '', c: '调料' };
    var c = dict.customIng[name];
    if (c) return { u: c.c === '调料' ? '' : (c.u || '个'), c: c.c || '其他' };
    return null;
  }

  function matchName(raw, dict) {
    var s = String(raw || '').replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').replace(/\s+/g, '').trim();
    if (!s) return { name: '', known: false };
    var n = dict.alias[s] || s;
    if (infoOf(n, dict)) return { name: n, known: true };
    var t = s.replace(/^(新鲜|冷冻|去皮|去骨|带皮|精选|嫩|土)/, '').replace(/(丁|丝|片|块|末|碎|段|粒|泥|液|汁|蓉)$/, '');
    n = dict.alias[t] || t;
    if (t && infoOf(n, dict)) return { name: n, known: true };
    var best = '';
    Object.keys(dict.ingredients).forEach(function (k) {
      if (k.length >= 2 && s.indexOf(k) >= 0 && k.length > best.length) best = k;
    });
    dict.seasonings.forEach(function (k) {
      if (k.length >= 2 && s.indexOf(k) >= 0 && k.length > best.length) best = k;
    });
    return best ? { name: best, known: true } : { name: s, known: false };
  }

  function qtyFor(item, unit, name) {
    var count = num(item.count);
    var qty = num(item.qty);
    var g = gramsOf(item);
    if (unit === '克') {
      if (g) return Math.max(1, Math.round(g));
      if (count && AVG_G[name]) return Math.max(1, Math.round(count * AVG_G[name]));
      if (qty) return Math.max(1, Math.round(qty));
      return null;
    }
    if (unit === '毫升') {
      if (g) return Math.max(1, Math.round(g));
      if (qty && (item.unit === '毫升' || String(item.unit).toLowerCase() === 'ml')) return Math.max(1, Math.round(qty));
      if (qty) return Math.max(1, Math.round(qty));
      return null;
    }
    if (count) return r2(count);
    if (qty && !WEIGHT[String(item.unit || '')] && canonUnit(item.unit) !== '克' && canonUnit(item.unit) !== '毫升') return r2(qty);
    if (g && AVG_G[name]) return r2(Math.max(0.5, Math.round(g / AVG_G[name] * 2) / 2));
    if (qty) return r2(qty);
    return null;
  }

  function mapItem(raw, dict) {
    var nameRaw = String((raw && raw.name) || '').trim();
    var m = matchName(nameRaw, dict);
    if (!m.name || SKIP.test(m.name)) return null;
    var inf = infoOf(m.name, dict);
    if (inf && inf.c === '调料') {
      return { kind: 'spice', name: m.name, known: true, keep: true, note: nameRaw !== m.name ? '照片里写的是「' + nameRaw + '」' : '' };
    }
    var unit = inf ? inf.u : (canonUnit(raw.unit) || (gramsOf(raw) ? '克' : '个'));
    var qty = qtyFor(raw, unit, m.name);
    var note = String((raw && raw.note) || '').trim();
    if (!qty) {
      qty = inf ? (unit === '克' || unit === '毫升' ? 200 : 1) : 1;
      note = note || '数量看不太清，先按这个填，请改一下';
    } else if (!inf && nameRaw && nameRaw !== m.name) {
      note = note || '新食材，保存时会加进字典';
    } else if (!inf) {
      note = note || '新食材，保存时会加进字典';
    } else if (nameRaw && nameRaw !== m.name && nameRaw.replace(/\s+/g, '') !== m.name) {
      note = note || '照片里认成「' + nameRaw + '」';
    }
    return {
      kind: 'stock',
      name: m.name,
      known: !!inf,
      qty: qty,
      unit: unit,
      cat: inf ? inf.c : '其他',
      keep: true,
      note: note
    };
  }

  function mapItems(rawItems, dict) {
    dict = dict || {};
    var ctx = {
      ingredients: dict.ingredients || {},
      alias: dict.alias || {},
      seasonings: dict.seasonings || [],
      customIng: dict.customIng || {}
    };
    var out = [], byName = {};
    (Array.isArray(rawItems) ? rawItems : []).forEach(function (raw) {
      var row = mapItem(raw, ctx);
      if (!row) return;
      var prev = byName[row.kind + ':' + row.name];
      if (prev && row.kind === 'stock') {
        if (typeof prev.qty === 'number' && typeof row.qty === 'number') prev.qty = r2(prev.qty + row.qty);
        return;
      }
      if (prev && row.kind === 'spice') return;
      byName[row.kind + ':' + row.name] = row;
      out.push(row);
    });
    return out;
  }

  return { UNITS: UNITS, mapItems: mapItems, matchName: matchName, gramsOf: gramsOf };
});
