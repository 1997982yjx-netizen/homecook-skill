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

  var Dict = (typeof module === 'object' && module.exports) ? require('./dict-utils.js') : (typeof window !== 'undefined' ? window.CookDict : null);
  var UNITS = Dict.UNITS;
  var WEIGHT = Dict.WEIGHT;
  var SKIP = Dict.SKIP_STOCK;
  var AVG_G = Dict.AVG_G;

  function r2(n) { return Math.round(n * 100) / 100; }
  var num = Dict.num;
  var canonUnit = Dict.canonUnit;
  var gramsOf = Dict.gramsOf;

  function infoOf(name, dict) { return Dict.infoOf(name, dict); }

  function matchName(raw, dict) {
    return Dict.matchName(raw, dict);
  }

  function qtyFor(item, unit, name) {
    var count = num(item.count);
    var qty = num(item.qty);
    var g = gramsOf(item);
    var rawUnit = String(item.unit || '').trim();
    var lowUnit = rawUnit.toLowerCase();
    if (unit === '克') {
      if (g) return Math.max(1, Math.round(g));
      if (count && AVG_G[name]) return Math.max(1, Math.round(count * AVG_G[name]));
      if (qty && (!rawUnit || WEIGHT[rawUnit])) return Math.max(1, Math.round(qty));
      return null;
    }
    if (unit === '毫升') {
      if (qty && (rawUnit === '升' || lowUnit === 'l')) return Math.max(1, Math.round(qty * 1000));
      if (qty && (rawUnit === '毫升' || lowUnit === 'ml')) return Math.max(1, Math.round(qty));
      if (g) return Math.max(1, Math.round(g));
      if (qty && !rawUnit) return Math.max(1, Math.round(qty));
      return null;
    }
    if (count) return r2(count);
    if (qty && !WEIGHT[rawUnit] && canonUnit(rawUnit) !== '克' && canonUnit(rawUnit) !== '毫升') return r2(qty);
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
      var key = row.kind === 'stock' ? row.kind + ':' + row.name + ':' + row.unit : row.kind + ':' + row.name;
      var prev = byName[key];
      if (prev && row.kind === 'stock') {
        if (typeof prev.qty === 'number' && typeof row.qty === 'number') prev.qty = r2(prev.qty + row.qty);
        return;
      }
      if (prev && row.kind === 'spice') return;
      byName[key] = row;
      out.push(row);
    });
    return out;
  }

  return { UNITS: UNITS, mapItems: mapItems, matchName: matchName, gramsOf: gramsOf };
});
