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

  /* ================= ④b 入库前试听校验（v4.9.6）================= */
  {
    /* 能播 → ok + 时长 */
    const okC = bootCloud();
    stubAudio(okC.w, 'ok');
    const r1 = await okC.NEON.Radio.probeSourceUrl(URL_OK);
    T(CASE, 'R298 试听校验：能播的地址返回 ok + 时长',
      r1.ok === true && r1.duration === 42, JSON.stringify(r1));

    /* 不能播（实测：站长贴的是一条 B 站**网页地址**）→ ok:false + 人话原因 */
    const badC = bootCloud();
    stubAudio(badC.w, 'bad');
    const r2 = await badC.NEON.Radio.probeSourceUrl('https://www.bilibili.com/video/BV1FN411n7FT/');
    T(CASE, 'R298b ★ 网页地址被识破（URL 合法但根本不是音频）—— ok:false',
      r2.ok === false, JSON.stringify(r2));
    T(CASE, 'R298c 且给出人话原因（点名"网页链接 / 需要登录 / 防盗链"，不是甩一句英文）',
      /不是可直接播放的音频文件/.test(String(r2.reason)) && /网页链接/.test(String(r2.reason)),
      String(r2.reason));

    /* 没有 Audio 的环境（显式抹掉；jsdom 其实**有** Audio 对象、只是不会解码 ——
       第一版按"jsdom 没有 Audio"写，结果走的是 8 秒超时路径，红得冤枉） */
    const noAudio = bootCloud();
    noAudio.w.Audio = undefined;
    const r3 = await noAudio.NEON.Radio.probeSourceUrl(URL_OK);
    T(CASE, 'R298d 环境不支持试听时不抛错（降级为"请自行确认"，不阻断入库）',
      r3 && r3.ok === false && /无法试听校验/.test(String(r3.reason)), JSON.stringify(r3));
  }


  /* ================= ④c 网易云官方外链播放器（v4.9.9）================= */
  {
    const c = bootCloud();
    const N = c.NEON;
    const WANT = 'https://music.163.com/outchain/player?type=2&id=2003621098&auto=0&height=66';

    /* 站长给的就是 outchain 页那种形式；三种常见形式 + 裸 id 都要认 */
    T(CASE, 'R299 认得出 outchain 页（站长截图里那种 /#/outchain/2/<id>/m/use/html）',
      N.Radio.neteaseEmbedUrl('https://music.163.com/#/outchain/2/2003621098/m/use/html') === WANT,
      N.Radio.neteaseEmbedUrl('https://music.163.com/#/outchain/2/2003621098/m/use/html'));
    T(CASE, 'R299b 认得出歌曲页 /#/song?id=… 与 /song/…',
      N.Radio.neteaseEmbedUrl('https://music.163.com/#/song?id=2003621098') === WANT &&
      N.Radio.neteaseEmbedUrl('https://music.163.com/song/2003621098') === WANT);
    T(CASE, 'R299c 裸歌曲 id 也认（最省事的一种贴法）',
      N.Radio.neteaseEmbedUrl('2003621098') === WANT);
    T(CASE, 'R299d 无关链接一律不认（不能把普通音频地址误判成网易云外链）',
      N.Radio.neteaseEmbedUrl('https://cdn.test/a.mp3') === '' &&
      N.Radio.neteaseEmbedUrl('') === '' && N.Radio.neteaseEmbedUrl('https://example.com/song/1') === '');

    T(CASE, 'R299e isEmbedUrl 只认官方播放器地址',
      N.Radio.isEmbedUrl(WANT) === true && N.Radio.isEmbedUrl('https://cdn.test/a.mp3') === false);

    /* ⚠ 关键：外链**不能**去做音频校验 —— <audio> 当然加载不了 iframe 播放器，
       不特判的话它会被当成坏链接拒掉，功能直接不可用。 */
    const noAudio = bootCloud();
    noAudio.w.Audio = undefined;              /* 连 Audio 都没有：能过 = 确实没走音频校验 */
    const pr = await noAudio.NEON.Radio.probeSourceUrl(WANT);
    T(CASE, 'R299f ★ 官方外链跳过音频校验直接放行（不特判就会被误判成坏链接）',
      pr && pr.ok === true && pr.embed === true, JSON.stringify(pr));

    /* 库里存的形态必须统一（只有一种形态，判断逻辑才简单） */
    T(CASE, 'R299g 入库的是规范化后的 outchain 地址（不是用户贴的原始页地址）',
      N.Radio.neteaseEmbedUrl('https://music.163.com/#/song?id=2003621098') === WANT);
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
    /* v4.9.6：界面提交现在会先试听校验 —— jsdom 里没有 Audio，
       不装桩的话校验会（正确地）拦下提交，R296d 就测不到入库分支了。 */
    stubAudio(ctx.w, 'ok');

    const dock = ctx.doc.getElementById('radio-dock');
    if (dock) dock.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));

    const ok = await waitFor(function () {
      return !!ctx.doc.querySelector('[data-radio-field="url"]');
    }, 4000);
    T(CASE, 'R296 站长面板里出现"https 直链"输入框（能力真的摆在界面上）',
      ok, ok ? '' : (dock ? '点了 dock 仍没渲染表单' : '没有 #radio-dock'));

    const form = ctx.doc.querySelector('[data-radio-form]');
    /* v5.0.0：文件上传整条路移除，改为"贴网易云链接 + 选类型" */
    T(CASE, 'R296b 表单含网易云条目输入与类型选择器，且**不再有文件输入**',
      !!ctx.doc.querySelector('.radio-src-head') && !!ctx.doc.querySelector('[data-radio-field="url"]') &&
      !!ctx.doc.querySelector('[data-radio-field="kind"]') && !ctx.doc.querySelector('[data-radio-field="file"]'),
      form ? 'form ok' : '没有表单');

    const hint = ctx.doc.querySelector('.radio-hint');
    /* v5.1.0：重做后不再有"展开小面板"，提示挪到了 #/radio 页面（radio-page-tip）。
       这里改判**页面视图源码**里有这句说明（界面文案的来源处）。 */
    const viewsSrc = require('fs').readFileSync(require('path').join(ROOT, 'js/views.js'), 'utf8');
    T(CASE, 'R296c 电台页写明"使用网易云官方外链播放器，播放与版权由网易云处理"',
      /radio-page-tip/.test(viewsSrc) && /官方外链播放器/.test(viewsSrc) && /版权由网易云处理/.test(viewsSrc),
      /radio-page-tip/.test(viewsSrc) ? 'ok' : '没有页面提示块');

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

    T(CASE, 'R296e 界面上贴直链时**没有**读文件（外链不必碰 base64 那条重路）',
      !ctx.queries.some(function (q) { return q.kind === 'storage-upload'; }));

    ctx.dom.window.close();
  }

  /* ================= ⑥ CSP：外链媒体确实被放行 ================= */
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


  /* ================= ⑦ 内核：外链曲目不碰 <audio> ================= */
  {
    const radioSrc = require('fs').readFileSync(require('path').join(ROOT, 'js/radio.js'), 'utf8');
    T(CASE, 'R301 内核认得出官方外链并转入 embed 态（不设 audio.src）',
      /* ⚠ 别去匹配源码里的转义（radio.js 里写的是 music\.163\.com / outchain\/player），
         只钉不带转义的确定事实 —— 少一次自找麻烦。 */
      /outchain/.test(radioSrc) && /embedUrl = got\.url/.test(radioSrc) &&
      /embedUrl = ''/.test(radioSrc), 'source 里查不到 embed 分支');
    T(CASE, 'R301b 转 embed 态时先 pause 并清掉 audio.src（否则 <audio> 会去加载 iframe 地址而报错）',
      /try \{ audio\.pause\(\); \} catch \(e\) \{\}[\s\S]{0,120}removeAttribute\('src'\)/.test(radioSrc));
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: 'v4.9.5 电台外链音源（URL 源播放）' };
standalone(module, run);
