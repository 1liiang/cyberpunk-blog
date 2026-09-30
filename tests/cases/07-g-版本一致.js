'use strict';
/* ============================================================
   tests/cases/07-g-版本一致.js — G 版本一致
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L169-176
   独立运行：node tests/cases/07-g-版本一致.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 G：版本三处一致性 ================= */
  {
    const m = /\?v=([0-9.]+)/.exec(SRC.html);
    const htmlV = m ? m[1] : null;
    const allSame = SRC.html.split('?v=').length - 1 >= 5 &&
      SRC.html.replace(new RegExp('\\?v=' + (htmlV || 'x').replace(/\./g, '\\.'), 'g'), '').indexOf('?v=') === -1;
    T('G 版本一致', 'R25 index.html 全部 ?v= 同值', !!htmlV && allSame, '?v=' + htmlV + ' × ' + (SRC.html.split('?v=').length - 1));
    T('G 版本一致', 'R25b ?v= === version.js BUILD', htmlV === BUILD, htmlV + ' vs ' + BUILD);
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "G 版本一致" };

standalone(module, run);
