'use strict';
/* ============================================================
   tests/cases/55-v5-7-0-超时硬化.js — 出网超时与首屏兜底（P0 硬化）

   为什么单独立一条：
     实测事故（2026-10-02）—— 页面顶部没有报错、控制台干净，但首屏偶尔"一直转圈"。
     取证结论：
       ① supabase-js 只给 Realtime 与 Auth 路径加了时限；**PostgREST 请求
          （文章列表/标签统计/电台条目）走 postgrest-js，没有任何 signal/timeout**；
       ② 更致命的是"挂住 ≠ 失败"：withFallback 的兜底挂在 catch 上，
          "一直 pending"永远不切快照 ⇒ 骨架屏可以挂到浏览器 TCP 超时（几十秒~2 分钟）；
       ③ jsdom 实测（永不 resolve 的请求桩）：6 秒过去仍是 0 张卡片、一直骨架态。

   本 case 守三件事（每条都可反向验证）：
     · 出网边界真的注入了带时限的 fetch（不是"某处写了 AbortController"就算）
     · 注入的 fetch 在超时后**真的会 abort**（用毫秒级时限真跑一遍）
     · 悬挂请求下首屏**必须有界**地出内容（走真实 renderHome → withFallback → 快照）
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments } = require('../common');
const { JSDOM } = require('jsdom');

const CASE = 'v5.7.0 超时硬化';

/* 起一个最小环境：真 cloud.js + 会记账的 createClient 桩 + 可控 window.fetch */
function bootCloud(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only', url: 'https://x.test/' });
  const w = dom.window;
  const captured = [];
  if (opts.timeoutMs) w.__NEON_REQ_TIMEOUT_MS = opts.timeoutMs;
  if (opts.noFetch) { try { delete w.fetch; } catch (e) { w.fetch = undefined; } }
  else if (opts.fetch) w.fetch = opts.fetch;
  else w.fetch = function () { return Promise.resolve({ ok: true }); };
  w.console = { log: function () {}, warn: function () {}, error: function () {} };
  w.supabase = {
    createClient: function (url, key, options) {
      captured.push({ url: url, key: key, options: options });
      return {
        auth: { getSession: async function () { return { data: { session: null }, error: null }; } },
        from: function () { return {}; },
        storage: { from: function () { return {}; } }
      };
    }
  };
  w.eval(SRC.cloud);
  w.NEON.init();
  return { w: w, dom: dom, captured: captured, NEON: w.NEON };
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const cloud = SRC.cloud;
  const cloudCode = stripComments(cloud);

  /* ================= ① 超时**挂在出网边界**上 ================= */
  {
    const c = bootCloud();
    const opt = (c.captured[0] || {}).options || {};
    T(CASE, 'R302 ★ createClient 收到 global.fetch（一处覆盖 Auth + PostgREST + Storage）',
      typeof (opt.global || {}).fetch === 'function',
      typeof (opt.global || {}).fetch === 'function' ? '已注入' : '未注入 —— 又回到"无限等待"了');

    /* 时限必须是个"明显异常"的数：太小会误伤跨境慢请求，太大就失去意义 */
    const m = /REQ_TIMEOUT_MS\s*=\s*(\d+)/.exec(cloudCode);
    const ms = m ? Number(m[1]) : NaN;
    T(CASE, 'R302b 超时时限取在 2s~15s 之间（跨境正常往返是几十~几百毫秒）',
      Number.isFinite(ms) && ms >= 2000 && ms <= 15000,
      'REQ_TIMEOUT_MS = ' + ms);

    T(CASE, 'R302c 包装函数只认 window.fetch（拿不到时不改 SDK 原行为）',
      /function makeTimeoutFetch/.test(cloudCode) &&
      /typeof window\.fetch !== 'function'\) return undefined/.test(cloudCode),
      '缺少"没有 fetch 就不注入"的守卫');
  }

  /* ================= ② 没有 fetch 的环境：照旧不注入 ================= */
  {
    const c = bootCloud({ noFetch: true });
    const opt = (c.captured[0] || {}).options || {};
    T(CASE, 'R302d 环境没有 window.fetch 时不传 global.fetch（老环境行为不变）',
      !opt.global || typeof opt.global.fetch !== 'function',
      opt.global ? '竟然注入了' : '未注入 ✓');
  }

  /* ================= ③ 超时真的会 abort（毫秒级时限真跑一遍） ================= */
  {
    let aborted = false;
    const c = bootCloud({
      timeoutMs: 40,
      fetch: function (input, init) {
        /* 永不 resolve，但要能被 abort 打断 —— 这才是"网络挂住"的真实形状 */
        return new Promise(function (resolve, reject) {
          if (init && init.signal) {
            init.signal.addEventListener('abort', function () {
              aborted = true;
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }
    });
    const f = ((c.captured[0] || {}).options || {}).global
      ? ((c.captured[0] || {}).options || {}).global.fetch : null;
    let name = '(未抛错)';
    const t0 = Date.now();
    if (typeof f !== 'function') {
      name = '(没拿到注入的 fetch)';
    } else {
      try { await f('https://example.test/hang'); }
      catch (e) { name = e && e.name; }
    }
    const dt = Date.now() - t0;
    T(CASE, 'R302e ★ 悬挂请求会在时限内被 abort（无限等待 → 有界失败）',
      typeof f === 'function' && aborted && /Abort/.test(String(name)) && dt < 2000,
      name + ' 用时 ' + dt + 'ms');

    /* 正常请求不该被误伤：时限内返回就照常拿到响应，且不再 abort */
    let aborted2 = false;
    const c2 = bootCloud({
      timeoutMs: 5000,
      fetch: function (input, init) {
        return new Promise(function (resolve) {
          if (init && init.signal) init.signal.addEventListener('abort', function () { aborted2 = true; });
          setTimeout(function () { resolve({ ok: true, status: 200 }); }, 10);
        });
      }
    });
    const f2 = ((c2.captured[0] || {}).options || {}).global
      ? ((c2.captured[0] || {}).options || {}).global.fetch : null;
    const r = (typeof f2 === 'function') ? await f2('https://example.test/ok') : null;
    await new Promise(function (res) { setTimeout(res, 60); });
    T(CASE, 'R302f 时限内返回的请求不被误伤（正常拿到响应、之后也不再 abort）',
      !!r && r.ok === true && aborted2 === false,
      'ok=' + (r && r.ok) + ' 之后被 abort=' + aborted2);

    /* 调用方自己传了 signal：两边都要生效（任一 abort 都该中断） */
    const c3 = bootCloud({
      timeoutMs: 8000,
      /* ⚠ 桩必须**像真 fetch 那样**响应 signal —— 否则测的是"桩不守契约"，
         不是实现（本项目在 55 号上已经栽过一次同类的：桩缺字段）。 */
      fetch: function (i, init) {
        return new Promise(function (_, reject) {
          if (init && init.signal) {
            init.signal.addEventListener('abort', function () {
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }
    });
    const f3 = ((c3.captured[0] || {}).options || {}).global
      ? ((c3.captured[0] || {}).options || {}).global.fetch : null;
    const outer = new c3.w.AbortController();
    const p3 = (typeof f3 === 'function') ? f3('https://example.test/x', { signal: outer.signal }) : Promise.reject(new Error('no-fetch'));
    outer.abort();
    let p3name = '';
    try {
      await Promise.race([p3, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout-race')); }, 500); })]);
    } catch (e) { p3name = e && e.name; }
    T(CASE, 'R302g 调用方自带的 signal 仍然生效（不因为加了超时就把取消能力弄丢）',
      /Abort/.test(String(p3name)),
      'race 结果: ' + (p3name || '(未中断)'));
  }

  /* ================= ④ 端到端：悬挂请求下首屏必须有界出内容 ================= */
  {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('../common');
    const SNAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/posts.json'), 'utf8'));

    const SESSION = { user: { id: 'uid-t', email: 't@x.test', user_metadata: {} } };
    /* ⚠ 把时限缩到 400ms：真实环境是 8s，但这里要能在门禁里跑。
       语义完全一致 —— 桩会像真 fetch 那样在时限到达时抛 AbortError。 */
    const ctx = bootDom({
      url: 'https://x.test/#/',
      timeoutMs: 400,
      /* hangCloud 要放进 fixtures —— 桩是从 fixtures 上读的（见 common.js 的说明） */
      fixtures: { __session: SESSION, __hangCloud: true }
    });
    /* 快照兜底要读 data/posts.json —— 门禁里没有服务器，得给它一个取数源
       （与 51 号 R254b 同一套做法：只放行快照，其余一律当成被 CSP 拦掉）。 */
    ctx.w.fetch = function (url) {
      if (String(url).indexOf('data/posts.json') === 0) {
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve(SNAP); } });
      }
      return Promise.reject(new Error('CSP 拦截'));
    };

    const t0 = Date.now();
    const ok = await waitFor(function () {
      return ctx.doc.querySelectorAll('.post-card').length > 0;
    }, 12000);
    const dt = Date.now() - t0;
    T(CASE, 'R303 ★ 云端请求悬挂时，首屏仍会在有界时间内渲染出文章（走快照兜底）',
      ok, ok ? ('用时 ' + dt + 'ms，渲染出 ' + ctx.doc.querySelectorAll('.post-card').length + ' 张卡片')
             : '12 秒内仍无内容 —— 首屏被悬挂请求挡死了');
    T(CASE, 'R303b 且页面不因此报未处理拒绝（降级要静默且可读）',
      ctx.unhandled.length === 0, ctx.unhandled[0] || '干净');
    ctx.dom.window.close();
  }

  /* ================= ⑤ 第二层保险：竞速上限（fetch 超时本身失效时兜底） =================
     为什么要这一层：fetch 超时是"请求层"的时限，可它依赖底层 fetch 真的会 abort。
     若某天底层 fetch 被 polyfill 掉、或 SDK 换了通道（不再走 global.fetch），
     首屏又会回到"无限等"。所以 withFallback 自己也带一个竞速上限 ——
     两层都在，才叫"有界"。 */
  {
    const c = bootCloud();
    const code = stripComments(cloud);
    const m = /FALLBACK_RACE_MS\s*=\s*(\d+)/.exec(code);
    const race = m ? Number(m[1]) : NaN;
    const req = Number((/REQ_TIMEOUT_MS\s*=\s*(\d+)/.exec(code) || [, NaN])[1]);
    T(CASE, 'R304 ★ withFallback 带竞速上限（超时先手，竞速兜"超时失效"的底）',
      Number.isFinite(race) && race > 0 && /Promise\.race\(\[/.test(code),
      'FALLBACK_RACE_MS = ' + race);
    T(CASE, 'R304b 竞速上限 > 请求超时（否则正常慢请求会被快照抢先，内容会"变")',
      Number.isFinite(race) && Number.isFinite(req) && race > req,
      'race=' + race + ' / req=' + req);
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: 'v5.7.0 超时硬化（出网时限 + 首屏兜底）' };
standalone(module, run);
