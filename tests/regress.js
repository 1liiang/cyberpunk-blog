'use strict';
/* ============================================================
   tests/regress.js — 功能回归【编排层】
   ------------------------------------------------------------
   D3 之前：本文件是一整块 2700+ 行的单体，28 个场景全塞在 run() 里。
   D3 之后：场景全部迁到 tests/cases/*.js（每个文件可独立运行），
            本文件只负责 ① 按序加载 ② 汇总 ③ 三道自审。

   三道自审（都是拆分逼出来的，不是摆设）：
     · checkDuplicateNames —— 跨文件断言重名检测
         拆分前靠"共用同一个 results 数组"天然去重，拆开后没人管。
     · checkCaseCounts     —— 断言数对账（对照 manifest 基线）
         拆分实测抓到过真 bug：L 图片收口 的 R34/R34b 写在【没有 await 的
         async IIFE】里，原先靠"后面还有慢 case"才碰巧落袋，拆开后直接蒸发
         （453 → 451）。没有对账，这种"静默少两条"根本看不出来。
     · lintFloatingAsync   —— 上面那个坑的根因，钉在语法层面

   ⚠ 新增/删除断言后必须跑 `npm run baseline` 更新基线，否则对账会报红。
   ⚠ 新增 case 文件后必须跑 `node tools/baseline-cases.js` 更新 manifest（拆分器 split-regress.js 已于 v4.8.1 清理删除，拆分工作早已完成）。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const {
  checkDuplicateNames, checkCaseCounts, lintFloatingAsync
} = require('./case-runner');

const CASE_DIR = path.join(__dirname, 'cases');
const MANIFEST = path.join(CASE_DIR, 'manifest.json');

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error('找不到 tests/cases/manifest.json —— 先跑 node tools/baseline-cases.js');
  }
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

async function run() {
  const manifest = loadManifest();
  const results = [];
  const perCase = {};

  /* ---------- ① 按序执行各 case ---------- */
  for (const m of manifest) {
    const file = path.join(CASE_DIR, m.file);

    if (!fs.existsSync(file)) {
      results.push({
        suite: 'regress', case: m.name || m.file,
        name: '⚠ case 文件缺失：' + m.file, pass: false,
        info: 'manifest 里有登记，磁盘上找不到'
      });
      continue;
    }

    let mod;
    try {
      mod = require(file);
    } catch (e) {
      results.push({
        suite: 'regress', case: m.name || m.file,
        name: '⚠ case 文件加载失败：' + m.file, pass: false,
        info: e.message
      });
      continue;
    }
    if (typeof mod.run !== 'function') {
      results.push({
        suite: 'regress', case: m.name || m.file,
        name: '⚠ case 文件未导出 run()：' + m.file, pass: false,
        info: '必须 module.exports = { run: run }'
      });
      continue;
    }

    let r;
    try {
      r = await mod.run();
    } catch (e) {
      results.push({
        suite: 'regress', case: m.name || m.file,
        name: '⚠ case 执行抛错：' + m.file, pass: false,
        info: e && e.message ? e.message : String(e)
      });
      continue;
    }

    (r.results || []).forEach(function (x) { results.push(x); });
    perCase[m.name] = (perCase[m.name] || 0) + (r.results || []).length;
  }

  /* ---------- ② 静态自审：悬浮异步 IIFE ---------- */
  manifest.forEach(function (m) {
    const file = path.join(CASE_DIR, m.file);
    if (!fs.existsSync(file)) return;
    lintFloatingAsync(fs.readFileSync(file, 'utf8'), m.file).forEach(function (b) {
      results.push({
        suite: 'regress', case: '测试自审',
        name: '⚠ ' + b, pass: false,
        info: '异步断言不 await 会静默丢失（拆分实测踩过：453 → 451）'
      });
    });
  });

  /* ---------- ③ 汇总自审：重名 + 断言数对账 ---------- */
  const extra = checkDuplicateNames(results).concat(checkCaseCounts(manifest, perCase));
  const all = results.concat(extra);
  const fail = all.filter(function (r) { return !r.pass; }).length;
  return { pass: all.length - fail, fail: fail, results: all };
}

module.exports = { run: run };

if (require.main === module) {
  run().then(function (r) {
    r.results.forEach(function (x) {
      console.log((x.pass ? '  PASS  ' : '  FAIL  ') + '[' + x.case + '] ' + x.name +
        (x.info ? '  [' + x.info + ']' : ''));
    });
    console.log('\n功能回归: ' + r.pass + '/' + (r.pass + r.fail));
    process.exit(r.fail === 0 ? 0 : 1);
  });
}
