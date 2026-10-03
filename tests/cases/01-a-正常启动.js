'use strict';
/* ============================================================
   tests/cases/01-a-正常启动.js — A 正常启动
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L27-55
   独立运行：node tests/cases/01-a-正常启动.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { bootDom, waitFor, FIXTURES } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 A：正常启动（首页） ================= */
  {
    const ctx = bootDom({ captureConsole: true });
    await waitFor(function () { return ctx.doc.body.innerHTML.length > 600; }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    const fv = ctx.doc.getElementById('foot-version');
    T('A 正常启动', 'R01 页脚渲染版本号', fv && /^v\d+\.\d+\.\d+$/.test(fv.textContent), fv && fv.textContent);
    T('A 正常启动', 'R02 页脚标注来源与构建标识', fv && /BUILD_ID=/.test(fv.getAttribute('title') || ''), fv && fv.getAttribute('title'));
    T('A 正常启动', 'R03 工程日志按钮存在', !!ctx.doc.getElementById('btn-changelog'));
    T('A 正常启动', 'R04 控制台打印版本横幅', ctx.logs.some(function (l) { return /BUILD_ID/.test(l); }));
    T('A 正常启动', 'R05 无诊断横幅（未带 diag 参数）', !ctx.doc.getElementById('neon-diag'));
    T('A 正常启动', 'R06 无未处理拒绝', ctx.unhandled.length === 0, ctx.unhandled[0] || '');
    T('A 正常启动', 'R07 无 console.error', !ctx.logs.some(function (l) { return l.indexOf('ERR:') === 0; }));

    /* 版本数据源 */
    const NV = ctx.w.NEONVersion;
    T('A 正常启动', 'R08 NEONVersion.LOG 非空且结构完整',
      NV && Array.isArray(NV.LOG) && NV.LOG.length >= 4 && NV.LOG.every(function (e) { return e.version && Array.isArray(e.items); }),
      NV && NV.LOG.length);
    T('A 正常启动', 'R09 最新日志版本 === BUILD', NV && NV.LOG[0].version === NV.BUILD, NV && NV.LOG[0].version + ' vs ' + NV.BUILD);

    /* 工程日志弹窗 */
    const btn = ctx.doc.getElementById('btn-changelog');
    if (btn) btn.click();
    const modal = ctx.doc.querySelector('.modal-log');
    const entries = ctx.doc.querySelectorAll('.log-entry');
    T('A 正常启动', 'R10 日志弹窗可打开且有内容', !!modal && entries.length >= 4, entries.length + ' 条');
    ctx.dom.window.close();
  }

  /* 请求完成前离开页面：成功与失败都不得夺回当前页面。
     通过替换真实数据边界的 Promise 控制返回顺序，不读取实现文本。 */
  {
    const fixtures = Object.assign({}, FIXTURES, {
      __session: { user: { id: 'u1', email: 'reader@example.com' } },
      bookmarks: [{ owner_id: 'u1', post_id: 1 }]
    });
    const ctx = bootDom({ url: 'https://x.test/#/about', fixtures: fixtures });
    await waitFor(function () { return ctx.doc.querySelector('.about-card'); }, 3000);
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    const scenarios = [
      ['#/', 'listPublished', { posts: [FIXTURES.posts[0]], total: 1 }],
      ['#/search/test', 'listPublished', { posts: [FIXTURES.posts[0]], total: 1 }],
      ['#/archive', 'listPublished', { posts: [FIXTURES.posts[0]], total: 1 }],
      ['#/tags', 'tagStats', {}],
      ['#/tagadmin', 'tagStats', {}],
      ['#/post/1', 'get', FIXTURES.posts[0]],
      ['#/marks', 'get', FIXTURES.posts[0]],
      ['#/admin', 'listMine', [FIXTURES.posts[0]]],
      ['#/edit/1', 'get', FIXTURES.posts[0]]
    ];
    const failures = [];
    for (const scenario of scenarios) {
      for (const rejectLate of [false, true]) {
        const method = scenario[1];
        const original = ctx.w.NEON.Posts[method];
        let settle, started = false;
        ctx.w.NEON.Posts[method] = function () {
          started = true;
          return new Promise(function (resolve, reject) { settle = rejectLate ? reject : resolve; });
        };
        ctx.w.location.hash = scenario[0];
        const didStart = await waitFor(function () { return started; }, 1000);
        ctx.w.location.hash = '#/about';
        await waitFor(function () { return /关于/.test(ctx.doc.title) && ctx.doc.querySelector('.about-card'); }, 1000);
        const current = ctx.doc.querySelector('.about-card');
        if (settle) settle(rejectLate ? new Error('过期请求失败') : scenario[2]);
        await new Promise(function (resolve) { setTimeout(resolve, 20); });
        if (!didStart || !current || ctx.doc.querySelector('.about-card') !== current ||
            ctx.w.location.hash !== '#/about' || /过期请求失败/.test(ctx.doc.body.textContent)) {
          failures.push(scenario[0] + (rejectLate ? ': failure' : ': success'));
        }
        ctx.w.NEON.Posts[method] = original;
      }
    }
    T('A 正常启动', 'R10a 迟到的页面请求不会覆盖当前路由或弹出过期错误', failures.length === 0, failures.join(', '));
    ctx.dom.window.close();
  }

  /* 紧凑导航的账户/栏目入口可通过菜单操作，Esc 与导航点击均收起。 */
  {
    const ctx = bootDom({ url: 'https://x.test/#/about' });
    await waitFor(function () { return ctx.doc.getElementById('nav-menu-toggle'); }, 1000);
    const toggle = ctx.doc.getElementById('nav-menu-toggle');
    const links = ctx.doc.getElementById('nav-menu-links');
    toggle.click();
    const opened = toggle.getAttribute('aria-expanded') === 'true' && links.classList.contains('is-open');
    ctx.doc.dispatchEvent(new ctx.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const closedByEscape = toggle.getAttribute('aria-expanded') === 'false' &&
      !links.classList.contains('is-open') && ctx.doc.activeElement === toggle;
    toggle.click();
    links.querySelector('[data-nav="archive"]').click();
    await waitFor(function () { return ctx.w.location.hash === '#/archive'; }, 1000);
    T('A 正常启动', 'R10b 紧凑导航保留栏目与登录入口，Esc和导航点击均关闭菜单',
      opened && closedByEscape && !!links.querySelector('[data-nav="login"]') &&
      toggle.getAttribute('aria-expanded') === 'false' && !links.classList.contains('is-open') &&
      ctx.w.location.hash === '#/archive');
    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "A 正常启动" };

standalone(module, run);
