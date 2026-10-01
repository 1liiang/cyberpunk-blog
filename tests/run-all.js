'use strict';
/* ============================================================
   tests/run-all.js — 一键回归入口
   用法：node tests/run-all.js
   退出码 0 = 全绿；非 0 = 有红项，禁止发布。
   三个套件：故障注入 + 功能回归 + 行为沙箱
   ============================================================ */
const fm = require('./fault-matrix');
const rg = require('./regress');
const sb = require('./sandbox-p2');

function report(title, r) {
  console.log(title);
  r.results.forEach(function (x) {
    console.log((x.pass ? '  PASS  ' : '  FAIL  ') + '[' + x.case + '] ' + x.name + (x.info ? '  [' + x.info + ']' : ''));
  });
  console.log('');
}

(async function () {
  const r1 = await fm.run();
  report('── 故障注入矩阵 ──────────────────────────', r1);

  const r2 = await rg.run();
  report('── 功能回归 ──────────────────────────────', r2);

  const r3 = await sb.run();
  report('── 行为沙箱（第三批） ────────────────────', r3);

  const suites = [r1, r2, r3];
  const total = suites.reduce(function (a, s) { return a + s.results.length; }, 0);
  const fail = suites.reduce(function (a, s) { return a + s.fail; }, 0);
  console.log('══════════════════════════════════════════');
  console.log('故障注入: ' + r1.pass + '/' + r1.results.length +
    '   功能回归: ' + r2.pass + '/' + r2.results.length +
    '   行为沙箱: ' + r3.pass + '/' + r3.results.length);
  console.log('合计: ' + (total - fail) + '/' + total +
    (fail === 0 ? '   总览: 全绿 ✓ 允许发布' : '   总览: ' + fail + ' 项红 ✗ 禁止发布'));
  process.exit(fail === 0 ? 0 : 1);
})();
