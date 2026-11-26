#!/usr/bin/env node
/*
 * homecook 命令行：给 AI 助手（skill）和人都能用。Node 18 及以上，不用装依赖。
 *
 *   node scripts/cook.js help
 *
 * 数据存在一个 JSON 文件里，格式和网页「导出备份」一样，两边可以互相导入。
 * 文件位置：--state 参数 > 环境变量 HOMECOOK_STATE > ~/.homecook/data.json
 * 每个命令加 --json 会输出结构化结果，方便程序读取。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const CookEngine = require('../core/engine.js');
const CookVision = require('../core/vision-map.js');
const CookDraft = require('../core/recipe-draft.js');
const WebUtils = require('../core/web-utils.js');
const DATA = require('../recipes.js');

const E = CookEngine.create(DATA);

/* ---------- 参数 ---------- */

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2), next = argv[i + 1];
      if (['json', 'all', 'set', 'apply', 'help', 'merge', 'no-spicy'].includes(k) || next === undefined || next.startsWith('--')) flags[k] = true;
      else { flags[k] = next; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}

class UserError extends Error {}
function die(msg) { throw new UserError(msg); }

/* ---------- 数据文件 ---------- */

function statePath(flags) {
  if (typeof flags.state === 'string') return path.resolve(flags.state);
  if (process.env.HOMECOOK_STATE) return path.resolve(process.env.HOMECOOK_STATE);
  return path.join(os.homedir(), '.homecook', 'data.json');
}
function load(file) {
  if (!fs.existsSync(file)) return E.normalize(null);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`数据文件读不出来：${file}（${e.message}）`); }
  return E.normalize(raw);
}
function save(file, S, extra) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = Object.assign({}, S, extra || {});
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  try {
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw e;
  }
}
// 读原文件里的照片，改完数据写回去时保留（页面导出的备份里可能带照片）
function photosOf(file) {
  try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); return raw && raw.photos ? { photos: raw.photos } : {}; } catch (e) { return {}; }
}

/* ---------- 格式化 ---------- */

function fmtNum(n) { const v = Math.round(n * 10) / 10; return v % 1 === 0 ? String(v) : v.toFixed(1); }
function fmtQty(q, u) { return fmtNum(q) + (u || ''); }
function expText(exp) {
  const d = CookEngine.daysLeft(exp);
  if (d === null) return '';
  if (d < 0) return `已过期 ${-d} 天`;
  if (d === 0) return '今天到期';
  return d <= 3 ? `还剩 ${d} 天` : `${exp} 到期`;
}
function servingsOf(flags, S) {
  if (flags.servings === undefined) return S.servings || 2;
  const n = Math.round(+flags.servings);
  if (!(n >= 1 && n <= 12)) die('--servings 要是 1 到 12 的整数');
  return n;
}
function listOf(v) {
  if (v === undefined || v === true || v === '') return [];
  return String(v).split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
}
function filtersOf(flags) {
  const maxMin = flags['max-min'] === undefined ? undefined : Math.round(+flags['max-min']);
  if (maxMin !== undefined && !(maxMin > 0)) die('--max-min 要把分钟数写成大于 0 的整数');
  return { tags: listOf(flags.tag), noSpicy: !!flags['no-spicy'], maxMin, sort: flags.sort === 'time' ? 'time' : undefined };
}
function dishJson(S, a) {
  return {
    name: a.r.name, category: a.r.cat, minutes: a.r.min || null, mine: !!a.r.mine,
    tags: E.tagsOf(S, a.r),
    status: a.status, missingCount: a.mc, maxServings: a.max,
    missing: a.miss.map((m) => ({ name: m.n, qty: m.q, unit: m.u, substitutes: m.subs || [] })),
    missingSeasonings: a.missSp,
    optionalSeasonings: a.sp.filter((x) => x.opt).map((x) => x.n),
    usesExpiring: a.exp,
    expired: a.expired
  };
}
function dishLine(a) {
  let t = `- ${a.r.name}`;
  if (a.r.min) t += `（${a.r.min} 分钟）`;
  if (a.status === 'ok') t += a.max >= 12 ? '：量很足' : `：够 ${a.max} 人份`;
  else t += `：还差 ${E.missText(a, a.status === 'far' ? 3 : 0, fmtQty)}`;
  const subs = a.miss.filter((m) => m.subs && m.subs.length).map((m) => `${m.n}可用${m.subs.join('/')}`);
  if (subs.length) t += `；替代：${subs.join('，')}`;
  if (a.exp.length) t += `；能用掉快过期的${a.exp.join('、')}`;
  if (a.expired.length) t += `；注意${a.expired.join('、')}已过期`;
  return t;
}
function needRecipe(S, name) {
  if (!name) die('要写菜名，比如：recipe 番茄炒蛋');
  const r = E.findRecipe(S, name);
  if (!r) die(`没找到「${name}」。用 recipes 看看有哪些菜`);
  return r;
}
function parseQtyArg(rawQty, rawUnit) {
  const s = String(rawQty == null ? '' : rawQty).trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/．/g, '.');
  const m = s.match(/^(\d+(?:\.\d+)?)([^\d.\s]+)?$/);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (!(isFinite(qty) && qty > 0)) return null;
  let unit = rawUnit;
  if (m[2]) {
    if (rawUnit) return null;
    const low = m[2].toLowerCase();
    unit = low === 'g' ? '克' : low === 'kg' ? '千克' : low === 'ml' ? '毫升' : m[2];
  } else if (unit) {
    const low = String(unit).trim().toLowerCase();
    unit = low === 'g' ? '克' : low === 'kg' ? '千克' : low === 'ml' ? '毫升' : String(unit).trim();
  }
  return { qty, unit };
}
// 单位换算：论克的食材可以写斤、两、千克
function qtyIn(S, name, qty, unit) {
  const u = E.unitOf(S, name);
  if (!unit || unit === u) return qty;
  if (u === '克') { const g = CookEngine.toGrams(qty, unit); if (g !== null) return g; }
  die(`「${name}」按${u}记，${unit} 换算不了。` + (u === '克' ? '可以写 克、两、斤、千克' : `请直接写${u}数`));
}
function parseExp(v) {
  if (v === undefined) return null;
  if (v === true) die('--exp 后面要写日期（2026-10-25）或天数（3）');
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && CookEngine.parseYmd(s)) return s;
  const m = s.match(/^(\d{1,3})\s*天?$/);
  if (m) return CookEngine.addDays(+m[1]);
  die('--exp 写日期（2026-10-25）或天数（3）');
}

/* ---------- 命令 ---------- */

const COMMANDS = {
  help() {
    return { text: HELP };
  },

  status(S) {
    const p = E.plan(S, {});
    const expiring = E.expiringStock(S);
    const json = {
      stockCount: Object.keys(S.stock).length, spices: S.spices.length,
      shopping: S.shop.filter((x) => !x.done).length, servings: S.servings,
      canCookNow: p.ok.length, nearlyCanCook: p.near.length, expiring
    };
    const text = [
      `库存 ${json.stockCount} 样，调料 ${json.spices} 样，清单里还要买 ${json.shopping} 样。`,
      `按 ${S.servings} 人份：现在就能做 ${p.ok.length} 道，只差一两样的 ${p.near.length} 道。`,
      expiring.length ? `快过期：${expiring.join('、')}` : ''
    ].filter(Boolean).join('\n');
    return { json, text };
  },

  match(S, args, flags) {
    const n = servingsOf(flags, S);
    const f = filtersOf(flags);
    const p = E.plan(S, { servings: n, category: flags.cat, tags: f.tags, noSpicy: f.noSpicy, maxMin: f.maxMin, sort: f.sort });
    const json = { servings: n, ok: p.ok.map((a) => dishJson(S, a)), near: p.near.map((a) => dishJson(S, a)) };
    if (flags.all) json.far = p.far.map((a) => dishJson(S, a));
    const cond = [flags.cat ? flags.cat : '', f.tags.length ? '标签：' + f.tags.join('/') : '', f.noSpicy ? '不辣' : '', f.maxMin ? f.maxMin + ' 分钟内' : ''].filter(Boolean).join('，');
    let text = `按 ${n} 人份算${cond ? '（' + cond + '）' : ''}：\n\n现在就能做（${p.ok.length} 道）\n`;
    text += p.ok.length ? p.ok.map(dishLine).join('\n') : '- 暂时没有。看看下面差一两样的，或者把人数调少一点';
    if (p.near.length) text += `\n\n只差一两样（${p.near.length} 道）\n` + p.near.map(dishLine).join('\n');
    if (flags.all && p.far.length) text += `\n\n还差得多（${p.far.length} 道）\n` + p.far.map(dishLine).join('\n');
    else if (p.far.length) text += `\n\n另有 ${p.far.length} 道还差得多，加 --all 查看。`;
    if (!Object.keys(S.stock).length) text = '库存是空的。先用 stock add 录入，比如：stock add 番茄 4\n\n' + text;
    return { json, text };
  },

  meal(S, args, flags) {
    const n = servingsOf(flags, S);
    const dishes = flags.dishes === undefined ? 2 : Math.round(+flags.dishes);
    const soup = flags.soup === undefined ? 1 : Math.round(+flags.soup);
    if (!(dishes >= 0 && dishes <= 6)) die('--dishes 要是 0 到 6 的整数');
    if (!(soup >= 0 && soup <= 3)) die('--soup 要是 0 到 3 的整数');
    if (!dishes && !soup) die('--dishes 和 --soup 不能同时是 0');
    const m = E.planMeal(S, { servings: n, dishes, soup });
    const json = {
      servings: n, complete: m.complete, short: m.short,
      dishes: m.dishes.map((a) => dishJson(S, a)),
      missing: m.missing, missingSeasonings: m.missingSeasonings, usesExpiring: m.expiringUsed
    };
    const lines = [`按 ${n} 人份凑 ${dishes} 菜 ${soup} 汤：`];
    if (!m.dishes.length) lines.push('- 家里的库存暂时凑不出一顿，先把缺的加进清单吧。');
    m.dishes.forEach((a) => lines.push(`- ${a.r.name}（${a.r.cat}）`));
    if (m.expiringUsed.length) lines.push('', '能用掉快过期的：' + m.expiringUsed.join('、'));
    if (m.missing.length) lines.push('', '还缺食材：' + m.missing.map((x) => x.n + ' ' + fmtQty(x.q, x.u)).join('、'));
    if (m.missingSeasonings.length) lines.push('还缺调料：' + m.missingSeasonings.join('、'));
    if (m.complete) lines.push('', '这一桌都够了，可以做。');
    else if (!m.missing.length && !m.missingSeasonings.length) lines.push('', `库存够做已选这些，还差 ${m.short} 道凑不齐。`);
    return { json, text: lines.join('\n') };
  },

  recipe(S, args, flags) {
    const r = needRecipe(S, args.join(''));
    const n = servingsOf(flags, S);
    const a = E.analyze(S, r, n);
    const steps = Array.isArray(r.steps) ? r.steps : [];
    const json = Object.assign(dishJson(S, a), {
      servings: n,
      ingredients: a.items.map((x) => ({ name: x.n, need: x.need, have: x.have, short: x.short, unit: x.u, substitutes: x.subs || [] })),
      seasonings: a.sp.map((x) => ({ name: x.n, have: x.has, optional: x.opt })),
      steps
    });
    const lines = [`${r.name}（${r.cat}${r.min ? '，约 ' + r.min + ' 分钟' : ''}），按 ${n} 人份：`, '', '食材：'];
    a.items.forEach((x) => lines.push(`- ${x.n} 要 ${fmtQty(x.need, x.u)}，${x.short ? '差 ' + fmtQty(x.short, x.u) : '有 ' + fmtQty(x.have, x.u)}` + (x.subs && x.subs.length ? `（可用 ${x.subs.join('/')}）` : '')));
    if (a.sp.length) lines.push('', '调料：' + a.sp.map((x) => x.n + (x.opt ? '（可选）' : '') + (x.has ? '' : x.opt ? '' : '【没有】')).join('、'));
    if (steps.length) { lines.push('', '做法：'); steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`)); }
    lines.push('', a.status === 'ok' ? '都够，可以做。' : `缺 ${a.mc} 样：${E.missText(a, 0, fmtQty)}`);
    return { json, text: lines.join('\n') };
  },

  recipes(S, args, flags) {
    const f = filtersOf(flags);
    const q = args.join('') || flags.q || '';
    const list = E.searchRecipes(S, { q, category: flags.cat, tags: f.tags, noSpicy: f.noSpicy, maxMin: f.maxMin });
    if (f.sort === 'time') list.sort((a, b) => (a.min || 9999) - (b.min || 9999));
    const json = list.map((r) => ({ name: r.name, category: r.cat, minutes: r.min || null, serves: r.base, tags: E.tagsOf(S, r), mine: !!r.mine }));
    const byCat = {};
    list.forEach((r) => { (byCat[r.cat] = byCat[r.cat] || []).push(r.name + (r.mine ? '（我的）' : '')); });
    const text = `共 ${list.length} 道：\n` + Object.keys(byCat).map((c) => `${c}：${byCat[c].join('、')}`).join('\n');
    return { json, text };
  },

  stock(S, args, flags, ctx) {
    const sub = args[0];
    if (!sub || sub === 'list') {
      const names = Object.keys(S.stock).sort((a, b) => {
        const da = CookEngine.daysLeft(S.stock[a].exp), db = CookEngine.daysLeft(S.stock[b].exp);
        return (da === null ? 999 : da) - (db === null ? 999 : db) || a.localeCompare(b, 'zh-Hans-CN');
      });
      const json = names.map((k) => ({ name: k, qty: S.stock[k].qty, unit: E.unitOf(S, k), exp: S.stock[k].exp, category: (E.info(S, k) || {}).c || '其他' }));
      const text = names.length
        ? `库存 ${names.length} 样：\n` + json.map((x) => `- ${x.name} ${fmtQty(x.qty, x.unit)}${x.exp ? '，' + expText(x.exp) : ''}`).join('\n')
        : '库存是空的。';
      return { json, text };
    }
    if (sub === 'add') {
      const name = E.normName(S, args[1]);
      const parsed = parseQtyArg(args[2], args[3]);
      if (!name || !parsed) die('写法：stock add 名字 数量 [单位] [--exp 日期或天数] [--set]');
      let inf = E.info(S, name);
      if (!inf) {
        if (!flags.unit || !flags.cat) {
          die(`「${name}」不在食材字典里。新食材要写明单位和分类，比如：stock add ${name} ${args[2]} --unit 个 --cat 蔬菜\n` +
            `单位：${CookEngine.UNITS.join(' ')}；分类：${CookEngine.CATS.join(' ')}`);
        }
        if (!CookEngine.UNITS.includes(flags.unit)) die('单位只能是：' + CookEngine.UNITS.join(' '));
        if (!CookEngine.CATS.includes(flags.cat)) die('分类只能是：' + CookEngine.CATS.join(' '));
        S.custom.ing[name] = { u: flags.unit, c: flags.cat };
        inf = E.info(S, name);
      }
      if (inf.c === '调料') return COMMANDS.spice(S, ['add', name], flags, ctx);
      const q = qtyIn(S, name, parsed.qty, parsed.unit);
      E.addStock(S, name, q, parseExp(flags.exp), flags.set ? 'set' : 'add');
      ctx.dirty = true;
      const st = S.stock[name];
      return { json: { name, qty: st.qty, unit: inf.u, exp: st.exp }, text: `已记下：${name} 现有 ${fmtQty(st.qty, inf.u)}${st.exp ? '，' + expText(st.exp) : ''}` };
    }
    if (sub === 'remove' || sub === 'rm') {
      const removed = args.slice(1).map((x) => E.normName(S, x)).filter((k) => S.stock[k]);
      if (!removed.length) die('库存里没有这些：' + args.slice(1).join('、'));
      removed.forEach((k) => { delete S.stock[k]; });
      ctx.dirty = true;
      return { json: { removed }, text: '已从库存移除：' + removed.join('、') };
    }
    if (sub === 'clear') {
      S.stock = {}; ctx.dirty = true;
      return { json: { cleared: true }, text: '库存已清空（调料和菜谱保留）。' };
    }
    die('stock 的子命令：list、add、remove、clear');
  },

  spice(S, args, flags, ctx) {
    const sub = args[0];
    if (!sub || sub === 'list') {
      const all = E.allSpices(S);
      const json = { have: S.spices, missing: all.filter((x) => !S.spices.includes(x)) };
      return { json, text: `家里有：${json.have.join('、') || '（没有）'}\n没有：${json.missing.join('、') || '（都有）'}` };
    }
    const names = args.slice(1).map((x) => E.normName(S, x)).filter(Boolean);
    if (!names.length) die(`写法：spice ${sub} 名字…`);
    if (sub === 'add') {
      names.forEach((n) => {
        const inf = E.info(S, n);
        if (inf && inf.c !== '调料') die(`「${n}」是食材，不是调料，请用 stock add`);
        if (!inf) S.custom.ing[n] = { u: '', c: '调料' };
        if (!S.spices.includes(n)) S.spices.push(n);
      });
      ctx.dirty = true;
      return { json: { added: names }, text: '记下了，家里有：' + names.join('、') };
    }
    if (sub === 'remove' || sub === 'rm') {
      S.spices = S.spices.filter((x) => !names.includes(x));
      ctx.dirty = true;
      return { json: { removed: names }, text: '记下了，家里没有：' + names.join('、') };
    }
    die('spice 的子命令：list、add、remove');
  },

  cook(S, args, flags, ctx) {
    const r = needRecipe(S, args.join(''));
    const n = servingsOf(flags, S);
    const res = E.cook(S, r, n);
    ctx.dirty = true;
    const json = { name: r.name, servings: n, lacking: res.lacking, used: res.used.map((x) => ({ name: x.n, qty: x.q, unit: x.u })) };
    const text = `已按 ${n} 人份扣掉${r.name}用的食材：` + (res.used.map((x) => x.n + ' ' + fmtQty(x.q, x.u)).join('、') || '（库存里没有用到的）') +
      (res.lacking ? '\n有的食材不够，按用完算了。' : '');
    return { json, text };
  },

  shop(S, args, flags, ctx) {
    const sub = args[0];
    if (!sub || sub === 'list') {
      const json = S.shop.map((x) => ({ name: x.n, qty: x.u ? x.q : null, unit: x.u || null, done: !!x.done }));
      const text = json.length ? '购物清单：\n' + json.map((x) => `- ${x.done ? '[已买] ' : ''}${x.name}${x.unit ? ' ' + fmtQty(x.qty, x.unit) : ''}`).join('\n') : '清单是空的。';
      return { json, text };
    }
    if (sub === 'add') {
      const name = E.normName(S, args[1]);
      if (!name) die('写法：shop add 名字 [数量]');
      const inf = E.info(S, name);
      if (inf && inf.c === '调料') {
        E.addShop(S, name, 0, '');
        ctx.dirty = true;
        return { json: { name, qty: null, unit: null }, text: `已加入清单：${name}` };
      }
      if (!inf && flags.unit && !CookEngine.UNITS.includes(flags.unit)) {
        die('单位只能是：' + CookEngine.UNITS.join(' '));
      }
      const u = inf ? inf.u : (flags.unit || '个');
      let q;
      if (args[2] !== undefined) {
        const parsed = parseQtyArg(args[2], args[3]);
        if (!parsed) die('数量要填大于 0 的数字，比如：shop add 青椒 2');
        if (inf) q = qtyIn(S, name, parsed.qty, parsed.unit);
        else if (!parsed.unit || parsed.unit === u) q = parsed.qty;
        else if (u === '克') {
          const g = CookEngine.toGrams(parsed.qty, parsed.unit);
          if (g === null) die(`「${name}」按${u}记，${parsed.unit} 换算不了。可以写 克、两、斤、千克`);
          q = g;
        } else die(`「${name}」按${u}记，${parsed.unit} 换算不了。请直接写${u}数`);
      } else {
        q = u === '克' || u === '毫升' ? 500 : u ? 1 : 0;
      }
      E.addShop(S, name, q, u);
      ctx.dirty = true;
      return { json: { name, qty: q, unit: u }, text: `已加入清单：${name}${u ? ' ' + fmtQty(q, u) : ''}` };
    }
    if (sub === 'missing') {
      const r = needRecipe(S, args.slice(1).join(''));
      const n = servingsOf(flags, S);
      const mc = E.missToShop(S, r, n);
      if (mc > 0) ctx.dirty = true;
      return { json: { name: r.name, added: mc }, text: mc ? `已把${r.name}缺的 ${mc} 样加入清单。` : `${r.name}按 ${n} 人份什么都不缺。` };
    }
    if (sub === 'bought') {
      if (!S.shop.length) die('清单是空的。');
      const want = args.slice(1).map((x) => E.normName(S, x));
      const got = S.shop.filter((x) => !want.length || want.includes(x.n));
      if (!got.length) die('清单里没有这些：' + want.join('、'));
      got.forEach((x) => {
        if (E.isSpice(S, x.n) || !x.u) {
          if (!E.info(S, x.n)) S.custom.ing[x.n] = { u: '', c: '调料' };
          if (!S.spices.includes(x.n)) S.spices.push(x.n);
        } else {
          if (!E.info(S, x.n)) S.custom.ing[x.n] = { u: CookEngine.UNITS.includes(x.u) ? x.u : '个', c: '其他' };
          E.addStock(S, x.n, x.q || 1, null, 'add');
        }
      });
      S.shop = S.shop.filter((x) => !got.includes(x));
      ctx.dirty = true;
      return { json: { moved: got.map((x) => x.n) }, text: '已放进库存：' + got.map((x) => x.n).join('、') };
    }
    if (sub === 'remove' || sub === 'rm') {
      const want = args.slice(1).map((x) => E.normName(S, x)).filter(Boolean);
      if (!want.length) die('写法：shop remove 名字…');
      const before = S.shop.length;
      S.shop = S.shop.filter((x) => !want.includes(x.n));
      const removed = before - S.shop.length;
      if (removed > 0) ctx.dirty = true;
      return { json: { removed }, text: `已从清单删掉 ${removed} 样。` };
    }
    if (sub === 'clear') { S.shop = []; ctx.dirty = true; return { json: { cleared: true }, text: '清单已清空。' }; }
    die('shop 的子命令：list、add、missing、bought、remove、clear');
  },

  // 识图结果（AI 助手自己看图后整理的 JSON）对照字典；加 --apply 才写入库存
  'import-items'(S, args, flags, ctx) {
    const src = args[0];
    if (!src) die('写法：import-items 文件.json（或 - 从标准输入读）[--apply] [--set]');
    let raw;
    try { raw = JSON.parse(src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(src), 'utf8')); } catch (e) { die('识图结果不是有效的 JSON：' + e.message); }
    const items = Array.isArray(raw) ? raw : raw && raw.items;
    if (!Array.isArray(items)) die('要是数组，或 {"items": [...]}，每项 { name, qty, unit, count, weight_g }');
    const rows = CookVision.mapItems(items, E.dict(S));
    const applied = !!(flags.apply && rows.length);
    const json = { applied, rows: rows.map((r) => ({ kind: r.kind, name: r.name, qty: r.qty || null, unit: r.unit || null, known: r.known, note: r.note || '' })) };
    if (applied) {
      rows.forEach((r) => {
        if (r.kind === 'spice') { if (!S.spices.includes(r.name)) S.spices.push(r.name); return; }
        if (!r.known) S.custom.ing[r.name] = { u: r.unit, c: '其他' };
        E.addStock(S, r.name, r.qty, null, flags.set ? 'set' : 'add');
      });
      ctx.dirty = true;
    }
    const text = rows.length
      ? rows.map((r) => r.kind === 'spice' ? `- 调料：${r.name}` : `- ${r.name} ${fmtQty(r.qty, r.unit)}${r.note ? '（' + r.note + '）' : ''}`).join('\n') +
        (applied ? '\n\n已写入库存。' : '\n\n还没写入。核对没问题后加 --apply 再运行一次。')
      : '没有可以记的食材。';
    return { json, text };
  },

  // 菜谱 JSON（AI 助手从文字、笔记或截图里整理出来的）对照字典变成"我的菜谱"；加 --apply 才保存
  'recipe-import'(S, args, flags, ctx) {
    const src = args[0];
    if (!src) die('写法：recipe-import 菜谱.json（或 - 从标准输入读）[--apply]');
    let raw;
    try { raw = JSON.parse(src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(src), 'utf8')); } catch (e) { die('菜谱不是有效的 JSON：' + e.message); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) die('要是一个对象：{ title, category, minutes, serves, ingredients: [{ name, amount }], seasonings, optional, steps }');
    const dr = CookDraft.fromNote(E, S, raw);
    if (!dr.name) die('缺少菜名（title）');
    const dup = E.findRecipe(S, dr.name);
    const exact = dup && dup.name === dr.name ? dup : null;
    if (exact && !exact.mine) die(`内置菜谱里已经有「${dr.name}」了，换个名字再导入`);
    const json = {
      applied: false, name: dr.name, category: dr.cat, serves: dr.base, minutes: dr.min || null,
      ingredients: dr.items.map((x) => ({ name: x.n, qty: x.q === '' ? null : x.q, unit: x.u || E.unitOf(S, x.n), note: x.note || '' })),
      seasonings: dr.sp.concat(dr.extra), optional: dr.opt || [], newSeasonings: dr.extra, steps: dr.steps, replaces: exact ? exact.name : null
    };
    const lines = [`${dr.name}（${dr.cat}，${dr.base} 人份${dr.min ? '，约 ' + dr.min + ' 分钟' : ''}）`, '食材：'];
    json.ingredients.forEach((x) => lines.push(`- ${x.name} ${x.qty === null ? '（用量待填）' : fmtQty(x.qty, x.unit)}${x.note ? '：' + x.note : ''}`));
    lines.push('调料：' + (json.seasonings.join('、') || '（无）') + (json.optional.length ? '\n可选调料：' + json.optional.join('、') : ''));
    if (dr.steps.length) { lines.push('做法：'); dr.steps.forEach((t, i) => lines.push(`${i + 1}. ${t}`)); }
    if (flags.apply) {
      const res = CookDraft.toRecipe(E, S, dr, exact ? exact.id : undefined);
      if (res.error) die(res.error + '。在菜谱 JSON 里把用量写清楚（比如 "2个"、"300克"）后再导入');
      const i = S.custom.recipes.findIndex((r) => r.id === res.recipe.id);
      if (i >= 0) S.custom.recipes[i] = res.recipe; else S.custom.recipes.push(res.recipe);
      ctx.dirty = true;
      json.applied = true;
      lines.push('', exact ? `已更新「${dr.name}」。` : `已保存为我的菜谱「${dr.name}」。`);
    } else {
      lines.push('', '还没保存。' + (json.ingredients.some((x) => x.note) ? '有标注的行请核对；' : '') + '确认后加 --apply 再运行一次。');
    }
    return { json, text: lines.join('\n') };
  },

  'recipe-remove'(S, args, flags, ctx) {
    const name = args.join('').trim();
    if (!name) die('写法：recipe-remove 菜名');
    const r = S.custom.recipes.find((x) => x.name === name);
    if (!r) die(`「${name}」不是你自己加的菜谱（内置菜谱不能删）`);
    S.custom.recipes = S.custom.recipes.filter((x) => x !== r);
    delete S.log[r.id];
    ctx.dirty = true;
    return { json: { removed: name }, text: `已删除菜谱「${name}」。` };
  },

  export(S, args, flags, ctx) {
    if (!args[0]) die('写法：export 文件.json');
    const out = path.resolve(args[0]);
    save(out, S, photosOf(ctx.file));
    return { json: { file: out }, text: '已导出到 ' + out + '，可以在网页「库存 → 从备份导入」里导入。' };
  },

  import(S, args, flags, ctx) {
    if (!args[0]) die('写法：import 备份文件.json [--merge]（默认覆盖现在的数据，--merge 按库存合并）');
    const src = path.resolve(args[0]);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { die('备份文件读不出来：' + e.message); }
    if (!raw || typeof raw !== 'object' || !raw.stock || typeof raw.stock !== 'object' || Array.isArray(raw.stock)) die('这个文件不是做饭模块的备份');
    if (flags.merge) {
      ctx.replace = E.normalize(WebUtils.mergeState(S, raw));
      const cur = photosOf(ctx.file).photos || {};
      ctx.extra = raw.photos ? { photos: Object.assign({}, cur, raw.photos) } : photosOf(ctx.file);
      ctx.dirty = true;
      return { json: { file: src, merged: true }, text: '已按合并方式导入 ' + src + '（库存数量相加，菜谱同名覆盖）' };
    }
    ctx.replace = E.normalize(raw);
    ctx.extra = raw.photos ? { photos: raw.photos } : {};
    ctx.dirty = true;
    return { json: { file: src, merged: false }, text: '已导入 ' + src + '（覆盖）' };
  },

  servings(S, args, flags, ctx) {
    if (!args[0]) return { json: { servings: S.servings }, text: `默认按 ${S.servings} 人份算。` };
    S.servings = servingsOf({ servings: args[0] }, S);
    ctx.dirty = true;
    return { json: { servings: S.servings }, text: `以后默认按 ${S.servings} 人份算。` };
  }
};

const HELP = `homecook：按家里的库存算能做什么菜

用法：node scripts/cook.js <命令> [参数] [--json] [--state 数据文件]

  status                              概况：库存、能做几道、快过期的
  match [--servings 3] [--cat 汤] [--all] [--tag 快手,不辣] [--no-spicy] [--max-min 15] [--sort time]
                                      现在能做什么、差一两样的；可按标签/口味/耗时筛
  meal [--dishes 2] [--soup 1] [--servings 3]
                                      凑一顿（多道菜共享库存不冲突，优先用快过期的）
  recipe 番茄炒蛋 [--servings 3]       用量、家里有多少、缺什么、做法
  recipes [搜索词] [--cat 荤菜] [--tag 快手] [--max-min 15] [--sort time]
                                      所有菜谱，可按菜名/食材/调料/拼音首字母搜
  stock                               列出库存
  stock add 番茄 4 [--exp 3] [--set]   记库存（--exp 天数或日期；--set 改成这个数而不是累加）
  stock add 五花肉 1 斤                 论克的食材可以写 斤 / 两 / 千克
  stock add 秋葵 8 --unit 根 --cat 蔬菜 字典里没有的新食材
  stock remove 番茄                     从库存删掉
  spice / spice add 盐 生抽 / spice remove 醋
  cook 番茄炒蛋 [--servings 3]          做好了：按人份扣库存
  shop / shop add 青椒 2 / shop missing 番茄炒蛋 / shop bought [名字…] / shop clear
  import-items 识图结果.json [--apply]  把看图识别出的食材对照字典；--apply 写入库存
  recipe-import 菜谱.json [--apply]    把整理好的菜谱对照字典；--apply 保存为我的菜谱
  recipe-remove 菜名                   删掉自己加的菜谱
  servings 3                          以后默认按几人份算
  export 文件.json / import 文件.json [--merge]   和网页互相导入导出（--merge 合并库存）

数据文件：--state > 环境变量 HOMECOOK_STATE > ~/.homecook/data.json`;

const VALUE_FLAGS = ['state', 'servings', 'cat', 'exp', 'unit', 'tag', 'max-min', 'dishes', 'soup', 'q', 'sort'];

function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0] || 'help';
  const isHelp = !!flags.help || cmd === 'help';
  const fn = COMMANDS[isHelp ? 'help' : cmd];
  if (!fn) die(`没有「${cmd}」这个命令。运行 help 看看有哪些`);
  if (!isHelp) {
    for (const k of VALUE_FLAGS) {
      if (flags[k] === true || flags[k] === '') die(`--${k} 后面要写值`);
    }
  }
  const file = statePath(flags);
  const S = isHelp ? null : load(file);
  const ctx = { file, dirty: false };
  const res = fn(S, pos.slice(1), flags, ctx);
  if (ctx.dirty) save(file, ctx.replace || S, ctx.extra || photosOf(file));
  return flags.json ? JSON.stringify(res.json === undefined ? { text: res.text } : res.json, null, 2) : res.text;
}

if (require.main === module) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (e) {
    if (e instanceof UserError) {
      if (process.argv.includes('--json')) console.log(JSON.stringify({ error: e.message }, null, 2));
      else console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
}

module.exports = { main, parseArgs };
