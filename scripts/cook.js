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
      if (['json', 'all', 'set', 'apply', 'help'].includes(k) || next === undefined || next.startsWith('--')) flags[k] = true;
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
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, file);
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
function dishJson(a) {
  return {
    name: a.r.name, category: a.r.cat, minutes: a.r.min || null, mine: !!a.r.mine,
    status: a.status, missingCount: a.mc, maxServings: a.max,
    missing: a.miss.map((m) => ({ name: m.n, qty: m.q, unit: m.u })),
    missingSeasonings: a.missSp,
    usesExpiring: a.exp
  };
}
function dishLine(a) {
  let t = `- ${a.r.name}`;
  if (a.r.min) t += `（${a.r.min} 分钟）`;
  if (a.status === 'ok') t += a.max >= 12 ? '：量很足' : `：够 ${a.max} 人份`;
  else t += `：还差 ${E.missText(a, a.status === 'far' ? 3 : 0, fmtQty)}`;
  if (a.exp.length) t += `；能用掉快过期的${a.exp.join('、')}`;
  return t;
}
function needRecipe(S, name) {
  if (!name) die('要写菜名，比如：recipe 番茄炒蛋');
  const r = E.findRecipe(S, name);
  if (!r) die(`没找到「${name}」。用 recipes 看看有哪些菜`);
  return r;
}
// 单位换算：论克的食材可以写斤、两、千克
function qtyIn(S, name, qty, unit) {
  const u = E.unitOf(S, name);
  if (!unit || unit === u) return qty;
  if (u === '克') { const g = CookEngine.toGrams(qty, unit); if (g !== null) return g; }
  die(`「${name}」按${u}记，${unit} 换算不了。` + (u === '克' ? '可以写 克、两、斤、千克' : `请直接写${u}数`));
}
function parseExp(v) {
  if (v === undefined || v === true) return null;
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
    const p = E.plan(S, { servings: n, category: flags.cat });
    const json = { servings: n, ok: p.ok.map(dishJson), near: p.near.map(dishJson) };
    if (flags.all) json.far = p.far.map(dishJson);
    let text = `按 ${n} 人份算${flags.cat ? '（' + flags.cat + '）' : ''}：\n\n现在就能做（${p.ok.length} 道）\n`;
    text += p.ok.length ? p.ok.map(dishLine).join('\n') : '- 暂时没有。看看下面差一两样的，或者把人数调少一点';
    if (p.near.length) text += `\n\n只差一两样（${p.near.length} 道）\n` + p.near.map(dishLine).join('\n');
    if (flags.all && p.far.length) text += `\n\n还差得多（${p.far.length} 道）\n` + p.far.map(dishLine).join('\n');
    else if (p.far.length) text += `\n\n另有 ${p.far.length} 道还差得多，加 --all 查看。`;
    if (!Object.keys(S.stock).length) text = '库存是空的。先用 stock add 录入，比如：stock add 番茄 4\n\n' + text;
    return { json, text };
  },

  recipe(S, args, flags) {
    const r = needRecipe(S, args.join(''));
    const n = servingsOf(flags, S);
    const a = E.analyze(S, r, n);
    const json = Object.assign(dishJson(a), {
      servings: n,
      ingredients: a.items.map((x) => ({ name: x.n, need: x.need, have: x.have, short: x.short, unit: x.u })),
      seasonings: a.sp.map((x) => ({ name: x.n, have: x.has, optional: x.opt })),
      steps: r.steps
    });
    const lines = [`${r.name}（${r.cat}${r.min ? '，约 ' + r.min + ' 分钟' : ''}），按 ${n} 人份：`, '', '食材：'];
    a.items.forEach((x) => lines.push(`- ${x.n} 要 ${fmtQty(x.need, x.u)}，${x.short ? '差 ' + fmtQty(x.short, x.u) : '有 ' + fmtQty(x.have, x.u)}`));
    if (a.sp.length) lines.push('', '调料：' + a.sp.map((x) => x.n + (x.opt ? '（可选）' : '') + (x.has ? '' : x.opt ? '' : '【没有】')).join('、'));
    if (r.steps.length) { lines.push('', '做法：'); r.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`)); }
    lines.push('', a.status === 'ok' ? '都够，可以做。' : `缺 ${a.mc} 样：${E.missText(a, 0, fmtQty)}`);
    return { json, text: lines.join('\n') };
  },

  recipes(S, args, flags) {
    const list = E.allRecipes(S).filter((r) => !flags.cat || r.cat === flags.cat);
    const json = list.map((r) => ({ name: r.name, category: r.cat, minutes: r.min || null, serves: r.base, mine: !!r.mine }));
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
      const qty = parseFloat(args[2]);
      if (!name || !(qty > 0)) die('写法：stock add 名字 数量 [单位] [--exp 日期或天数] [--set]');
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
      const q = qtyIn(S, name, qty, args[3]);
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
      const u = inf ? inf.u : (flags.unit || '个');
      const q = args[2] ? qtyIn(S, name, parseFloat(args[2]), args[3]) : (u === '克' || u === '毫升' ? 500 : u ? 1 : 0);
      E.addShop(S, name, q, inf && inf.c === '调料' ? '' : u);
      ctx.dirty = true;
      return { json: { name, qty: q, unit: u }, text: `已加入清单：${name}${u ? ' ' + fmtQty(q, u) : ''}` };
    }
    if (sub === 'missing') {
      const r = needRecipe(S, args.slice(1).join(''));
      const n = servingsOf(flags, S);
      const mc = E.missToShop(S, r, n);
      ctx.dirty = true;
      return { json: { name: r.name, added: mc }, text: mc ? `已把${r.name}缺的 ${mc} 样加入清单。` : `${r.name}按 ${n} 人份什么都不缺。` };
    }
    if (sub === 'bought') {
      if (!S.shop.length) die('清单是空的。');
      const want = args.slice(1).map((x) => E.normName(S, x));
      const got = S.shop.filter((x) => !want.length || want.includes(x.n));
      if (!got.length) die('清单里没有这些：' + want.join('、'));
      got.forEach((x) => {
        if (E.isSpice(S, x.n) || !x.u) { if (!S.spices.includes(x.n)) S.spices.push(x.n); }
        else E.addStock(S, x.n, x.q || 1, null, 'add');
      });
      S.shop = S.shop.filter((x) => !got.includes(x));
      ctx.dirty = true;
      return { json: { moved: got.map((x) => x.n) }, text: '已放进库存：' + got.map((x) => x.n).join('、') };
    }
    if (sub === 'remove' || sub === 'rm') {
      const want = args.slice(1).map((x) => E.normName(S, x));
      const before = S.shop.length;
      S.shop = S.shop.filter((x) => !want.includes(x.n));
      ctx.dirty = true;
      return { json: { removed: before - S.shop.length }, text: `已从清单删掉 ${before - S.shop.length} 样。` };
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
    const json = { applied: !!flags.apply, rows: rows.map((r) => ({ kind: r.kind, name: r.name, qty: r.qty || null, unit: r.unit || null, known: r.known, note: r.note || '' })) };
    if (flags.apply) {
      rows.forEach((r) => {
        if (r.kind === 'spice') { if (!S.spices.includes(r.name)) S.spices.push(r.name); return; }
        if (!r.known) S.custom.ing[r.name] = { u: r.unit, c: '其他' };
        E.addStock(S, r.name, r.qty, null, flags.set ? 'set' : 'add');
      });
      ctx.dirty = true;
    }
    const text = (rows.length ? rows.map((r) => r.kind === 'spice' ? `- 调料：${r.name}` : `- ${r.name} ${fmtQty(r.qty, r.unit)}${r.note ? '（' + r.note + '）' : ''}`).join('\n') : '没有可以记的食材。') +
      (flags.apply ? '\n\n已写入库存。' : '\n\n还没写入。核对没问题后加 --apply 再运行一次。');
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
      seasonings: dr.sp.concat(dr.extra), newSeasonings: dr.extra, steps: dr.steps, replaces: exact ? exact.name : null
    };
    const lines = [`${dr.name}（${dr.cat}，${dr.base} 人份${dr.min ? '，约 ' + dr.min + ' 分钟' : ''}）`, '食材：'];
    json.ingredients.forEach((x) => lines.push(`- ${x.name} ${x.qty === null ? '（用量待填）' : fmtQty(x.qty, x.unit)}${x.note ? '：' + x.note : ''}`));
    lines.push('调料：' + (json.seasonings.join('、') || '（无）'));
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
    const name = args.join('');
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
    if (!args[0]) die('写法：import 备份文件.json（会覆盖现在的数据）');
    const src = path.resolve(args[0]);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { die('备份文件读不出来：' + e.message); }
    if (!raw || typeof raw !== 'object' || !raw.stock) die('这个文件不是做饭模块的备份');
    ctx.replace = E.normalize(raw);
    ctx.extra = raw.photos ? { photos: raw.photos } : {};
    ctx.dirty = true;
    return { json: { file: src }, text: '已导入 ' + src };
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
  match [--servings 3] [--cat 汤] [--all]   现在能做什么、差一两样的
  recipe 番茄炒蛋 [--servings 3]       用量、家里有多少、缺什么、做法
  recipes [--cat 荤菜]                 所有菜谱
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
  export 文件.json / import 文件.json   和网页互相导入导出

数据文件：--state > 环境变量 HOMECOOK_STATE > ~/.homecook/data.json`;

function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0] || 'help';
  const fn = COMMANDS[flags.help ? 'help' : cmd];
  if (!fn) die(`没有「${cmd}」这个命令。运行 help 看看有哪些`);
  const file = statePath(flags);
  const S = cmd === 'help' ? null : load(file);
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
