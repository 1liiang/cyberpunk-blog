'use strict';
/* ============================================================
   tests/cases/54-v4-9-5-radio-url.js — v4.9.5 电台「外链音源」

   背景：站长要电台支持"贴一个 URL 就能播"。方案 A（站长拍板）：
   做**能力**、不做内容审核 —— 库里只存一条 https 直链，音频由浏览器直接从该地址取。

   这条改造最容易出错的不是"能不能播"，而是这几个边界，本 case 逐条钉死：
     ① 音源**二选一**：文件（base64 内链）或直链（外链）—— 两个都没有必须拦在入口
         （否则库里会出现"看着有曲目、点了没声"的记录，比报错难查得多）
     ② 直链只放行 https —— 与库层 CHECK 同规则（http 会被浏览器当混合内容拦掉）
     ③ playUrl 遇到外链**不得**去拉 base64 —— 否则"轻量外链"退化成"白等十几 MB"
     ④ 没有外链时**仍然**走原来的 base64 路（老记录不能因为这次改造播不了）
     ⑤ 界面那条分支真的会调 addByUrl（不是只把字段摆出来）

   ⚠ 本文件不用 bootDom 跑数据层：需要按场景替换 PostgREST 的返回值，
     bootDom 的桩是固定的。数据层部分自己开最小 jsdom 跑**真 cloud.js**（同 52 号的姿势）；
     界面部分再另开一份 bootDom。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
/* ⚠ SRC 是"各文件内容"的字典（SRC.cloud 等），**没有** root 字段 —— 路径要用 ROOT。
   （第一版把它写成 SRC.root，直接 path.join(undefined) 崩了；基线工具立刻抓住。） */
const { SRC, ROOT, bootDom, waitFor } = require('../common');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const CASE = 'v4.9.5 电台外链音源';
const SESSION = { user: { id: 'uid-1', email: 'me@x.test', user_metadata: {} } };
const URL_OK = 'https://cdn.test/music/track1.mp3';

/* ---------- 可链式的 PostgREST 桩 ----------
   ⚠ 必须实现 then()：适配器是 `await from(t).insert(r).select(f)` —— thenable 才可 await。
   每个请求落进 log，断言才看得见"到底发了什么"。 */
function bootCloud() {
  const log = [];
  function qb(table) {
    const st = { table: table, ops: [], filters: [] };
    const api = {
      select: function (f) { st.ops.push(['select', f]); st.select = f; return api; },
      insert: function (row) { st.ops.push(['insert', row]); st.insert = row; return api; },
      update: function (p) { st.ops.push(['update', p]); return api; },
      delete: function () { st.ops.push(['delete']); return api; },
      eq: function (c, v) { st.filters.push([c, v]); return api; },
      order: function () { return api; },
      limit: function () { return api; },
      then: function (res, rej) {
        let out;
        try { out = resolve(st); } catch (e) { out = { data: null, error: { message: String(e && e.message || e) } }; }
        log.push(st);
        return Promise.resolve(out).then(res, rej);
      }
    };
    return api;
  }
  function resolve(st) {
    /* 单曲音频数据：只有"没有外链"的那条路才该走到这里 */
    if (st.select && /(^|,)data(,|$)/.test(String(st.select))) {
      return { data: [{ id: 2, data: 'data:audio/mpeg;base64,QUFB', mime: 'audio/mpeg' }], error: null };
    }
    if (st.insert) return { data: [Object.assign({ id: 9 }, st.insert)], error: null };
    return { data: [], error: null };
  }
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only', url: 'https://x.test/' });
  const w = dom.window;
  w.supabase = {
    createClient: function () {
      return {
        auth: { getSession: async function () { return { data: { session: SESSION }, error: null }; } },
        from: qb,
        storage: { from: function (b) { return { __bucket: b }; } }
      };
    }
  };
  w.eval(SRC.cloud);
  w.NEON.init();
  return { w: w, NEON: w.NEON, log: log };
}

/* 取"关于某张表的、带某种操作的"请求 */
function reqs(log, table, op) {
  return log.filter(function (s) {
    if (table && s.table !== table) return false;
    if (!op) return true;
    return s.ops.some(function (o) { return o[0] === op; });
  });
}
function insertOf(log) {
  const withInsert = reqs(log, null, 'insert');
  return withInsert.length ? withInsert[withInsert.length - 1].insert : null;
}
/* 某次请求读的字段串 */
function selectOf(st) {
  const hit = st.ops.filter(function (o) { return o[0] === 'select'; })[0];
  return hit ? String(hit[1]) : '';
}

async function run() {
  const S = makeSuite();
  const T = S.T;

  /* ================= ① 直链规范化：只放行 https ================= */
  {
    const c = bootCloud();
    const N = c.NEON;
    T(CASE, 'R290 空值不算填写（返回空串，交给上层判"二选一"）',
      N.Radio.normalizeSourceUrl('') === '' && N.Radio.normalizeSourceUrl(null) === '');

    T(CASE, 'R290b 合法 https 直链原样通过（首尾空白被裁掉）',
      N.Radio.normalizeSourceUrl('  ' + URL_OK + '  ') === URL_OK,
      N.Radio.normalizeSourceUrl('  ' + URL_OK + '  '));

    let e1 = null;
    try { N.Radio.normalizeSourceUrl('http://cdn.test/a.mp3'); } catch (e) { e1 = e; }
    T(CASE, 'R290c ★ http:// 被拒（与库层 CHECK 同规则：混合内容会被浏览器拦掉）',
      !!e1 && /https/.test(String(e1.message)), e1 ? e1.message : '没有抛错');

    let e2 = null;
    try { N.Radio.normalizeSourceUrl('javascript:alert(1)'); } catch (e) { e2 = e; }
    T(CASE, 'R290d ★ javascript: 被拒（这条管道不该承载可执行协议）',
      !!e2, e2 ? e2.message : '没有抛错');

    let e3 = null;
    try { N.Radio.normalizeSourceUrl('https://cdn.test/' + 'x'.repeat(2100)); } catch (e) { e3 = e; }
    T(CASE, 'R290e 超长直链被拒（库列有长度上限，早报比入库失败清楚）',
      !!e3, e3 ? e3.message : '没有抛错');
  }

  /* ================= ② 入库：二选一 + 外链不写 data ================= */
  {
    const c = bootCloud();
    const N = c.NEON;

    let e = null;
    try { await N.Radio.create({ title: '无音源' }); } catch (x) { e = x; }
    T(CASE, 'R291 ★ 既没文件也没直链 → 入口就拦（防"看着有曲目、点了没声"）',
      !!e && /音源/.test(String(e.message)), e ? e.message : '没有抛错');

    await N.Radio.create({ title: '外链曲', artist: '某人', source_url: URL_OK });
    const row = insertOf(c.log);
    T(CASE, 'R291b 外链入库：source_url 写入、data 保持 null',
      !!row && row.source_url === URL_OK && row.data === null,
      row ? ('source_url=' + row.source_url + ' data=' + JSON.stringify(row.data)) : '没发出 insert');

    const ins = reqs(c.log, null, 'insert').slice(-1)[0];
    const sel = selectOf(ins);
    T(CASE, 'R291c 入库的返回字段含 source_url、不含 data（不回吐大对象）',
      /source_url/.test(sel) && !/(^|,)data(,|$)/.test(sel), sel);

    T(CASE, 'R291d 入库记录 storage_path 一律 null（旧云存储方案的孤儿路径不再产生）',
      !!row && row.storage_path === null);

    /* addByUrl 是"只凭一个链接"的入口，形状必须与 create 一致 */
    await N.Radio.addByUrl(URL_OK, { title: '外链曲2' }, 'uid-1');
    const row2 = insertOf(c.log);
    T(CASE, 'R292 addByUrl 与 create 同形（source_url + data null + owner_id）',
      !!row2 && row2.source_url === URL_OK && row2.data === null && row2.owner_id === 'uid-1',
      row2 ? JSON.stringify({ u: row2.source_url, d: row2.data, o: row2.owner_id }) : 'no insert');

    T(CASE, 'R292b addByUrl 会带上归属人（外链曲目同样受"只能管自己的"约束）',
      !!row2 && row2.owner_id === 'uid-1');
  }

  /* ================= ③ playUrl：外链抄近路，内链走原路 ================= */
  {
    const c = bootCloud();
    const N = c.NEON;

    const before = c.log.length;
    const u = await N.Radio.playUrl({ id: 1, source_url: URL_OK });
    T(CASE, 'R293 playUrl 遇到外链直接返回该地址', u === URL_OK, String(u).slice(0, 60));

    const asked = c.log.slice(before).filter(function (st) {
      return /(^|,)data(,|$)/.test(selectOf(st));
    });
    T(CASE, 'R293b ★ 且**没有**去拉 base64（否则"轻量外链"退化成白等十几 MB）',
      asked.length === 0, '拉 data 的请求数=' + asked.length);

    /* 没有外链的老记录：必须仍然能播 */
    const before2 = c.log.length;
    const d = await N.Radio.playUrl({ id: 2 });
    T(CASE, 'R294 无外链的老记录仍走 base64（这次改造不能让老曲目播不了）',
      /^data:audio\/mpeg;base64,/.test(String(d)), String(d).slice(0, 40));

    const asked2 = c.log.slice(before2).filter(function (st) {
      return /(^|,)data(,|$)/.test(selectOf(st));
    });
    T(CASE, 'R294b 且确实发了那一次取 data 的请求（证明走的是真路，不是桩里编出来的）',
      asked2.length === 1, '拉 data 的请求数=' + asked2.length);
  }

  /* ================= ④ 列表字段：能区分来源 ================= */
  {
    const c = bootCloud();
    const before = c.log.length;
    await c.NEON.Radio.list();
    const sel = c.log.slice(before).map(selectOf).join(' ');
    T(CASE, 'R295 列表字段含 source_url（面板要标"内链/外链"，也供 playUrl 抄近路）',
      /source_url/.test(sel), sel.slice(0, 120));
    T(CASE, 'R295b 列表字段仍**不含** data（打开面板≠下载整个曲库）',
      !/(^|,)data(,|$)/.test(sel), sel.slice(0, 120));
  }

  /* ================= ⑤ 界面：那条分支真的会调 addByUrl ================= */
  {
    /* ⚠ 必须显式 radio: true —— bootDom 默认**不装载** radio.js（见 common.js 的说明），
       不装载的话 window.NEONRadio 不存在，面板点开也是空的。 */
    const ctx = bootDom({ url: 'https://x.test/#/', fixtures: { __session: SESSION }, radio: true });
    await waitFor(function () { return !!ctx.doc.getElementById('radio-dock'); }, 4000);

    /* ⚠ 面板默认**不渲染**（RadioUI.panelOpen 才画），所以要像真人一样先点开 dock。
       第一版没点，于是 4 条界面断言全红 —— 红得对：证明的是"没打开就没有表单"，
       而不是"功能不在"。 */
    const dock = ctx.doc.getElementById('radio-dock');
    if (dock) dock.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));

    const ok = await waitFor(function () {
      return !!ctx.doc.querySelector('[data-radio-field="url"]');
    }, 4000);
    T(CASE, 'R296 站长面板里出现"https 直链"输入框（能力真的摆在界面上）',
      ok, ok ? '' : (dock ? '点了 dock 仍没渲染表单' : '没有 #radio-dock'));

    const form = ctx.doc.querySelector('[data-radio-form]');
    T(CASE, 'R296b 表单里有"音源（二选一）"的分隔标题 + 原有的文件输入仍在',
      !!ctx.doc.querySelector('.radio-src-head') && !!ctx.doc.querySelector('[data-radio-field="file"]'),
      form ? 'form ok' : '没有表单');

    const hint = ctx.doc.querySelector('.radio-hint');
    T(CASE, 'R296c 提示里写明"外链只存地址、请自行确认来源与授权"（责任在站长，界面说清楚）',
      !!hint && /授权/.test(hint.textContent || '') && /外链/.test(hint.textContent || ''),
      hint ? (hint.textContent || '').slice(0, 70) : '没有提示块');

    /* 真点一次：填直链 → 加入频段 → 应当产生一条带 source_url 的 insert */
    const openBtn = ctx.doc.querySelector('[data-radio-act="add"]');
    if (openBtn) openBtn.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(function () {
      const f = ctx.doc.querySelector('[data-radio-form]');
      return !!f && !f.hidden;
    }, 2000);

    const urlEl = ctx.doc.querySelector('[data-radio-field="url"]');
    const titleEl = ctx.doc.querySelector('[data-radio-field="title"]');
    const submit = ctx.doc.querySelector('[data-radio-act="submit-add"]');
    if (urlEl && titleEl && submit) {
      titleEl.value = '界面外链曲';
      urlEl.value = URL_OK;
      submit.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));
      /* ⚠ 桩把插入的行记在 `payload`（不是 row）—— 断言要按桩的形状写，
         第一版写成 q.row 于是"明明写了库却抓不到"，红得冤枉。 */
      await waitFor(function () {
        return ctx.queries.some(function (q) {
          return q.table === 'radio_tracks' && q.kind === 'insert' && q.payload && q.payload.source_url;
        });
      }, 3000);
    }
    const wrote = ctx.queries.filter(function (q) {
      return q.table === 'radio_tracks' && q.kind === 'insert' && q.payload && q.payload.source_url;
    });
    T(CASE, 'R296d ★ 界面上贴直链并提交 → 真的按外链入库（走的是 addByUrl 那条分支）',
      wrote.length >= 1 && wrote[0].payload.source_url === URL_OK && wrote[0].payload.data === null,
      wrote.length ? JSON.stringify({ u: wrote[0].payload.source_url, d: wrote[0].payload.data }) : '没有外链写入请求');

    T(CASE, 'R296e 界面上贴直链时**没有**读文件（外链不必碰 base64 那条重路）',
      !ctx.queries.some(function (q) { return q.kind === 'storage-upload'; }));

    ctx.dom.window.close();
  }

  /* ================= ⑥ CSP：外链媒体确实被放行 ================= */
  {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    const media = (csp.match(/media-src ([^;]+)/) || [])[1] || '';
    T(CASE, 'R297 CSP 的 media-src 放行了 https（否则外链音频会被浏览器直接拦掉）',
      /\bhttps:\s*$|\bhttps:\s/.test(media.trim() + ' '), 'media-src ' + media.trim());
    T(CASE, 'R297b script-src 仍是纯 self（这次放宽只碰媒体，不碰脚本面）',
      /script-src 'self'(;|\s|$)/.test(csp), csp.slice(0, 60));
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: 'v4.9.5 电台外链音源（URL 源播放）' };
standalone(module, run);
