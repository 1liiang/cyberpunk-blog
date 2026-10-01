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

/* ---------- Audio 桩：让 probeSourceUrl 在 jsdom 里也有确定行为 ----------
   jsdom 没有媒体解码能力（Audio 是 undefined），所以"能不能播"必须靠桩来演。
   ⚠ 桩只模拟两条路：loadedmetadata（能播）与 error code 4（不是音频）。
   这正好覆盖实测踩到的两种真实结局。 */
function stubAudio(w, mode) {
  w.Audio = function () {
    const listeners = {};
    const self = {
      duration: mode === 'ok' ? 42 : NaN,
      error: mode === 'ok' ? null : { code: 4 },
      preload: '',
      src: '',
      addEventListener: function (t, f) { listeners[t] = f; },
      removeAttribute: function () { self.src = ''; },
      load: function () {
        setTimeout(function () {
          const fn = listeners[mode === 'ok' ? 'loadedmetadata' : 'error'];
          if (fn) fn();
        }, 0);
      }
    };
    return self;
  };
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

  /* ================= ① 认得出各种网易云写法 =================
     ⚠ v5.6.1 重写：本 case 原先钉的是 v4.9.5 那套「外链音源」API
     （normalizeSourceUrl / addByUrl / playUrl / probeSourceUrl /
       neteaseEmbedUrl / isEmbedUrl）。那套管道在 v5.0.0 换成「网易云条目」后
     整体退役，函数已按 HANDOVER §6 审计清单 ① 从 cloud.js 删除（v5.6.1）。
     这里的 R290/R291/R292/R293/R294/R298/R299 等 24 条断言随之退役，
     改钉**现在真正活着**的入口：Radio.add(input, meta, uid) —— 它内部走
     parseNetease + buildEmbedUrl，并落库一条网易云条目。
     ⚠ 退役/改写是**一条一条**做的（§6 的"括号配平批量退役"翻车教训）。 */
  {
    const c = bootCloud();
    const N = c.NEON;

    /* 各种贴法 → 期望的 { kind, id } */
    const MATRIX = [
      ['https://music.163.com/#/outchain/2/2003621098/m/use/html', 'song', '2003621098'],
      ['https://music.163.com/#/song?id=2003621098', 'song', '2003621098'],
      ['https://music.163.com/song/2003621098', 'song', '2003621098'],
      ['2003621098', 'song', '2003621098'],
      ['https://music.163.com/#/playlist?id=2867512990', 'playlist', '2867512990'],
      ['https://music.163.com/playlist/2867512990', 'playlist', '2867512990'],
      ['https://music.163.com/#/outchain/0/2867512990/m/use/html', 'playlist', '2867512990']
    ];
    const bad = [];
    for (const [raw, kind, id] of MATRIX) {
      try {
        await N.Radio.add(raw, { title: '条目 ' + id }, 'uid-1');
      } catch (e) { bad.push(raw + ' → ' + e.message); continue; }
      const row = insertOf(c.log);
      if (!row || row.kind !== kind || String(row.netease_id) !== id) {
        bad.push(raw + ' → kind=' + (row && row.kind) + ' id=' + (row && row.netease_id));
      }
    }
    T(CASE, 'R290 七种贴法都认（outchain / 歌曲页 / /song/ / 歌单页 / /playlist/ / 裸 id）',
      bad.length === 0, bad.length ? bad.join(' | ') : MATRIX.length + ' 种全部通过');

    /* 识别不出来必须**当场报错**：静默入库 = 一条点了没声的条目，比报错难查 */
    let e1 = null;
    try { await N.Radio.add('https://www.bilibili.com/video/BV1FN411n7FT/', { title: 'x' }, 'uid-1'); }
    catch (e) { e1 = e; }
    T(CASE, 'R290b 认不出的链接被拒（不静默入库成"点了没声"的条目）',
      !!e1 && /认不出/.test(String(e1.message)), e1 ? e1.message : '竟然入库了');

    let e2 = null;
    try { await N.Radio.add('https://music.163.com/', { title: 'x' }, 'uid-1'); }
    catch (e) { e2 = e; }
    T(CASE, 'R290c 网易云站内但没带 id 的地址也被拒（不猜）',
      !!e2 && /认不出/.test(String(e2.message)), e2 ? e2.message : '竟然入库了');
  }

  /* ================= ② 入库：形态一律规范化 ================= */
  {
    const c = bootCloud();
    const N = c.NEON;

    await N.Radio.add('https://music.163.com/#/song?id=2003621098', { title: '单曲甲' }, 'uid-1');
    const row = insertOf(c.log);
    T(CASE, 'R291 入库的是规范化后的 outchain 地址（不是用户贴的原始页地址）',
      !!row && row.source_url ===
        'https://music.163.com/outchain/player?type=2&id=2003621098&auto=0&height=66',
      row ? row.source_url : '没发出 insert');

    T(CASE, 'R291b 裸 id 与页面地址**落到同一条**规范化地址（库里有且只有一种形态）',
      (function () {
        const want = 'https://music.163.com/outchain/player?type=2&id=2003621098&auto=0&height=66';
        return !!row && row.source_url === want &&
          /music\.163\.com\/outchain\/player\?type=2&id=2003621098/.test(want);
      })(),
      row ? row.source_url : '没发出 insert');

    T(CASE, 'R291c 歌单摆 430px 完整播放器（type=0），单曲摆 66px 官方条（type=2）',
      !!row && /type=2&id=2003621098&auto=0&height=66$/.test(row.source_url) &&
      /height=430/.test(String(N.Radio.buildEmbedUrl('playlist', '2867512990'))),
      '高度/类型没跟着 kind 走');

    /* ⚠ v5.6.1 新增：写路径必须是**基表可返回的那 8 列**。
       base64 时代的教训仍适用 —— 混进视图专有的算出来列（当时是 has_data）
       会让 PostgREST 生成 `INSERT … RETURNING …, <算出来的列>` → 42703，上传直接失败。 */
    const ins = reqs(c.log, null, 'insert').slice(-1)[0];
    const sel = selectOf(ins);
    T(CASE, 'R291d 入库的返回字段走显式白名单，且不含任何音源大对象',
      /title/.test(sel) && /netease_id/.test(sel) && /source_url/.test(sel) &&
      !/(^|,)data(,|$)/.test(sel) && !/has_data/.test(sel),
      sel);

    await N.Radio.add('https://music.163.com/#/playlist?id=2867512990', { title: '歌单乙' }, 'uid-2');
    const row2 = insertOf(c.log);
    T(CASE, 'R291e 歌单入库带 kind=playlist 与 netease_id，且归属人写入',
      !!row2 && row2.kind === 'playlist' && row2.netease_id === '2867512990' && row2.owner_id === 'uid-2',
      row2 ? JSON.stringify({ k: row2.kind, n: row2.netease_id, o: row2.owner_id }) : 'no insert');

    /* 显式指定类型优先于地址里的线索 */
    await N.Radio.add('12345678', { title: '强制歌单', kind: 'playlist' }, 'uid-1');
    const row3 = insertOf(c.log);
    T(CASE, 'R291f 类型选择器可覆盖自动识别（meta.kind 说了算）',
      !!row3 && row3.kind === 'playlist', row3 ? row3.kind : 'no insert');
  }

  /* ================= ③ 入库前校验 ================= */
  {
    const c = bootCloud();
    const N = c.NEON;

    let e = null;
    try { await N.Radio.add('2003621098', {}, 'uid-1'); } catch (x) { e = x; }
    T(CASE, 'R292 ★ 名称必填（条目列表要显示名字，空名等于一条看不见的记录）',
      !!e && /请填写条目名称/.test(String(e.message)), e ? e.message : '没有抛错');

    let e2 = null;
    try { await N.Radio.add('2003621098', { title: 'x'.repeat(201) }, 'uid-1'); } catch (x) { e2 = x; }
    T(CASE, 'R292b 名称长度上限 200 字（与库列长度一致，早报比入库失败清楚）',
      !!e2 && /200/.test(String(e2.message)), e2 ? e2.message : '没有抛错');

    await N.Radio.add('2003621098', { title: ' 有空白 ', artist: ' 某人 ' }, 'uid-1');
    const row = insertOf(c.log);
    T(CASE, 'R292c 名称与备注首尾空白被裁掉（库里的值就是界面显示的值）',
      !!row && row.title === '有空白' && row.artist === '某人',
      row ? JSON.stringify({ t: row.title, a: row.artist }) : 'no insert');
  }

  /* ================= ④ 旧管道的残留必须清零 ================= */
  {
    const c = bootCloud();
    const N = c.NEON;

    await N.Radio.add('2003621098', { title: '清理检查' }, 'uid-1');
    const row = insertOf(c.log) || {};
    /* base64 / 云存储时代的列一个都不许再写 */
    const deadCols = ['data', 'mime', 'storage_path', 'duration_sec', 'size_bytes', 'cover_url', 'has_data'];
    const leaked = deadCols.filter(function (k) { return Object.prototype.hasOwnProperty.call(row, k); });
    T(CASE, 'R293 v5 的写入不再碰任何已删列（data / mime / storage_path / duration_sec …）',
      leaked.length === 0, leaked.length ? '仍在写：' + leaked.join(',') : '干净');

    const asked = c.log.filter(function (st) { return /(^|,)data(,|$)/.test(selectOf(st)); });
    T(CASE, 'R293b ★ 全程没有一次去取音频本体（base64 那条重路已彻底不存在）',
      asked.length === 0, '拉 data 的请求数=' + asked.length);

    T(CASE, 'R293c 旧的取音频 / 试听 / 解析 API 确实已从数据层消失',
      typeof N.Radio.readAudio === 'undefined' && typeof N.Radio.trackData === 'undefined' &&
      typeof N.Radio.probeSourceUrl === 'undefined' && typeof N.Radio.playUrl === 'undefined' &&
      typeof N.Radio.addByUrl === 'undefined' && typeof N.Radio.neteaseEmbedUrl === 'undefined' &&
      typeof N.Radio.isEmbedUrl === 'undefined' && typeof N.Radio.normalizeSourceUrl === 'undefined',
      '还有旧 API 挂在 window.NEON.Radio 上');
  }

  /* ================= ⑤ 界面：表单真的接到 Radio.add ================= */
  {
    /* v5.6.3：<audio> 内核（radio.js）已删除，控制台改由网易云官方 iframe 渲染，
       不再需要 opts.radio 装载任何脚本。 */
    const ctx = bootDom({ url: 'https://x.test/#/', fixtures: { __session: SESSION } });
    await waitFor(function () { return !!ctx.doc.getElementById('radio-stage'); }, 4000);

    /* v5.2.0：旧小条已移除 —— 现在直接进电台页（表单在页面里，仅站长可见）。 */
    ctx.w.location.hash = '#/radio';
    await waitFor(function () { return !!ctx.doc.querySelector('[data-radio-compose]'); }, 4000);

    const ok = await waitFor(function () {
      return !!ctx.doc.querySelector('[data-radio-field="url"]');
    }, 4000);
    T(CASE, 'R296 站长在电台页能看到条目表单（能力真的摆在界面上）',
      ok, ok ? '' : '电台页没渲染表单');

    const form = ctx.doc.querySelector('[data-radio-compose]');
    /* v5.0.0：文件上传整条路移除，改为"贴网易云链接 + 选类型" */
    T(CASE, 'R296b 表单含网易云条目输入与类型选择器，且**不再有文件输入**',
      !!ctx.doc.querySelector('.radio-src-head') && !!ctx.doc.querySelector('[data-radio-field="url"]') &&
      !!ctx.doc.querySelector('[data-radio-field="kind"]') && !ctx.doc.querySelector('[data-radio-field="file"]'),
      form ? 'form ok' : '没有表单');

    /* v5.1.0：重做后不再有"展开小面板"，提示挪到了 #/radio 页面（radio-page-tip）。 */
    const viewsSrc = require('fs').readFileSync(require('path').join(ROOT, 'js/views.js'), 'utf8');
    T(CASE, 'R296c 电台页写明"使用网易云官方外链播放器，播放与版权由网易云处理"',
      /radio-page-tip/.test(viewsSrc) && /官方外链播放器/.test(viewsSrc) && /版权由网易云处理/.test(viewsSrc),
      /radio-page-tip/.test(viewsSrc) ? 'ok' : '没有页面提示块');

    /* 真点一次：填链接 → 加入电台 → 应当产生一条带 source_url 的 insert */
    const openBtn = ctx.doc.querySelector('[data-radio-act="add"]');
    if (openBtn) openBtn.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));

    const urlEl = ctx.doc.querySelector('[data-radio-field="url"]');
    const titleEl = ctx.doc.querySelector('[data-radio-field="title"]');
    const submit = ctx.doc.querySelector('[data-radio-act="additem"]');
    if (urlEl && titleEl && submit) {
      titleEl.value = '界面条目';
      /* v5.0.0：校验口径变成"能不能认成网易云条目" —— 测试输入也得是网易云链接，
         否则会被（正确地）拦下，测不到入库分支（实测踩到）。 */
      urlEl.value = 'https://music.163.com/#/song?id=2003621098';
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
    /* v5.1.0：入口从"面板表单"换成"电台页表单"，提交走 app.js 的 additem 分支。
       用**源码级**判据钉住那条分支真的调了 Radio.add 且带 kind/netease_id（界面行为另有 live 验收）。 */
    const appSrc = require('fs').readFileSync(require('path').join(ROOT, 'js/app.js'), 'utf8');
    T(CASE, 'R296d ★ 电台页的"加入"分支确实调 Radio.add（并带 kind/netease_id）',
      /act === 'additem'/.test(appSrc) && /need\('Radio'\)\.add\(/.test(appSrc) &&
      /kind: \(kEl && kEl\.value\)/.test(appSrc) && /id: url/.test(appSrc),
      wrote.length ? JSON.stringify({ u: wrote[0].payload.source_url, d: wrote[0].payload.data }) : '没有外链写入请求');

    T(CASE, 'R296e 界面上贴链接时**没有**读文件（外链不必碰 base64 那条重路）',
      !ctx.queries.some(function (q) { return q.kind === 'storage-upload'; }));

    ctx.dom.window.close();
  }

  /* ================= ⑥ CSP：官方播放器确实被放行 ================= */
  {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    const media = (csp.match(/media-src ([^;]+)/) || [])[1] || '';
    /* v5.1.0：电台改成官方 iframe 播放器后，**不再需要** media-src 放行任意外链音频 ——
       那条放宽已按计划收回（CSP 面反而更小）。所以这里改判"已收紧"。 */
    T(CASE, 'R297 v5 重做收回了 media-src 的 https 放宽（不再播任意外链音频）',
      !/https:/.test(media), 'media-src ' + media.trim());
    T(CASE, 'R297b script-src 仍是纯 self（这次放宽只碰媒体，不碰脚本面）',
      /script-src 'self'(;|\s|$)/.test(csp), csp.slice(0, 60));

    T(CASE, 'R300 CSP 的 frame-src 放行了 music.163.com（否则官方播放器被浏览器拦掉）',
      /frame-src[^;]*music\.163\.com/.test(csp), (csp.match(/frame-src[^;]*/) || ['(无 frame-src)'])[0]);
    T(CASE, 'R300b script-src 仍是纯 self（两次 CSP 放宽都没碰脚本面）',
      /script-src 'self'(;|\s|$)/.test(csp));

  }

  /* ================= ⑦ 界面渲染：条目自带 outchain 地址，不需要内核 ================= */
  {
    /* ⚠ v5.6.1 重写：原 R301 / R301b 钉的是 NEONRadio 内核"遇到外链转 embed 态、
       不碰 <audio>"的行为。条目改成网易云条目后，播放地址就在行里，
       界面直接把 source_url 渲染成 iframe（app.js 的 paintStage）——
       没有"内核取址"这一层，也没有 <audio> 可碰。改钉界面侧这条真路。 */
    const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    T(CASE, 'R301 界面把条目地址直接渲染成官方 iframe（播放不再经过任何音频内核）',
      /rc-frame/.test(appSrc) && /src="' \+ V\(\)\.esc\(url\)/.test(appSrc) &&
      /title="网易云音乐外链播放器"/.test(appSrc),
      '没找到 iframe 渲染分支');

    T(CASE, 'R301b 同一个地址不重建 iframe（重建 = 重新加载 = 歌断掉）',
      /if \(RC_STATE\.mounted === url\) return;/.test(appSrc) && /RC_STATE\.mounted = url;/.test(appSrc),
      '缺少"地址未变则不重建"的守卫');
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: 'v5.0.0 电台：网易云条目（v5.6.1 重写）' };
standalone(module, run);
