/*
 * 食材字典的公共工具：单位、常见重量、洗名字、对照字典。给 core/vision-map.js 和 core/recipe-draft.js 共用，
 * 避免两处词表和 matchName 逻辑各写一份、慢慢长出差异。
 *
 * 浏览器里挂在 window.CookDict，Node 里 require 也能用。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CookDict = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var UNITS = ['克', '个', '根', '包', '块', '条', '碗', '朵', '毫升', '瓶', '袋'];
  var WEIGHT = { '克': 1, 'g': 1, 'G': 1, '两': 50, '斤': 500, '千克': 1000, 'kg': 1000, 'KG': 1000 };
  // 计数食材大约多重，用来把"300克番茄"换算成个数
  var AVG_G = {
    '番茄': 150, '土豆': 200, '青椒': 100, '黄瓜': 250, '茄子': 250, '胡萝卜': 150, '洋葱': 200, '香菇': 20,
    '鸡蛋': 55, '皮蛋': 60, '豆腐': 400, '鸡翅': 50, '鸡腿': 200, '鱼': 600, '米饭': 200, '火腿肠': 50, '金针菇': 200
  };
  // 菜谱里做菜本身用的水，直接跳过
  var SKIP_ING = /^(水|清水|温水|开水|热水|冷水|凉水|冰水|冰块|纯净水|矿泉水)$/;
  // 识图 / 小票里不属于食材的东西
  var SKIP_STOCK = /^(水|清水|温水|开水|热水|冷水|凉水|冰水|冰块|纯净水|矿泉水|盘子|碗|筷子|锅|人|手|购物袋|塑料袋|背心袋|打包袋|保鲜袋|包装费|打包费|配送费|运费|服务费|会员|积分|微信支付|支付宝|现金|找零|税费|折扣)$/;

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
    return null;
  }

  // 去掉括号、空格；没有括号时保留原文
  function cleanName(raw) {
    return String(raw || '').replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').replace(/\s+/g, '').trim();
  }

  function infoOf(name, dict) {
    if (dict.ingredients[name]) return { u: dict.ingredients[name][0], c: dict.ingredients[name][1] };
    if ((dict.seasonings || []).indexOf(name) >= 0) return { u: '', c: '调料' };
    var c = dict.customIng && dict.customIng[name];
    if (c) return { u: c.c === '调料' ? '' : (c.u || '个'), c: c.c || '其他' };
    return null;
  }

  // 别名换成正式名；用户自定义的同名食材优先，不被内置别名吃掉
  function aliasOf(name, dict) {
    var custom = dict.customIng && dict.customIng[name];
    return !custom && dict.alias && dict.alias[name] ? dict.alias[name] : name;
  }

  // 原文里的名字对照字典：去修饰词、去刀工后缀，再找包含的字典词
  function matchName(raw, dict) {
    dict = dict || {};
    var s = cleanName(raw);
    if (!s) return { name: '', known: false };
    var n = aliasOf(s, dict);
    if (infoOf(n, dict)) return { name: n, known: true };
    var t = s.replace(/^(新鲜|冷冻|去皮|去骨|带皮|精选|嫩|土)/, '').replace(/(丁|丝|片|块|末|碎|段|粒|泥|液|汁|蓉)$/, '');
    n = aliasOf(t, dict);
    if (t && infoOf(n, dict)) return { name: n, known: true };
    var best = '';
    var keys = Object.keys(dict.ingredients || {}).concat(dict.seasonings || [], Object.keys(dict.customIng || {}));
    keys.forEach(function (k) { if (k.length >= 2 && s.indexOf(k) >= 0 && k.length > best.length) best = k; });
    return best ? { name: best, known: true } : { name: s, known: false };
  }

  return {
    UNITS: UNITS, WEIGHT: WEIGHT, AVG_G: AVG_G, SKIP_ING: SKIP_ING, SKIP_STOCK: SKIP_STOCK,
    num: num, canonUnit: canonUnit, gramsOf: gramsOf, cleanName: cleanName,
    infoOf: infoOf, aliasOf: aliasOf, matchName: matchName
  };
});
