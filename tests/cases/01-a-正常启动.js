'use strict';
/* ============================================================
   tests/cases/01-a-正常启动.js — A 正常启动
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L27-55
   独立运行：node tests/cases/01-a-正常启动.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { bootDom, waitFor } = require('../common');

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

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "A 正常启动" };

standalone(module, run);
