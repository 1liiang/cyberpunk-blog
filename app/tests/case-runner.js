'use strict';
/* ============================================================
   tests/case-runner.js — 套件基座（D3 拆分配套）
   ------------------------------------------------------------
   拆分前只有一个 tests/regress.js，所有断言共用模块级 results 数组，
   "断言名唯一"这件事靠"大家都在同一个数组里"天然保证。
   拆成 tests/cases/*.js 后，每个文件各自收集结果 —— 跨文件的重名
   就没人管了。重名的后果很隐蔽：报告里两条同名断言，看不出哪条是哪条，
   排查时会被误导。

   故提供两样东西：
     · makeSuite()          —— 每个 case 文件用它拿到 T()，并记录 BUILD
     · checkDuplicateNames()—— 编排层在汇总后调用，把重名直接判红

   ⚠ 这条是 D3 拆分守则第 2 条：「T() name 需在 runner 做重名检测」。
   ============================================================ */
const { parseBuild, SRC } = require('./common');

/* ------------------------------------------------------------
   makeSuite() —— 每个 case 文件开头调用一次
   返回 { T, results, BUILD }：
     T(caseName, name, pass, info)  记一条断言
     results                        本文件的断言数组（供编排层汇总）
     BUILD                          当前构建版本号（从 version.js 读）
   ------------------------------------------------------------ */
function makeSuite() {
  const results = [];
  const BUILD = parseBuild(SRC.ver);

  function T(caseName, name, pass, info) {
    results.push({
      suite: 'regress',
      case: caseName,
      name: name,
      pass: !!pass,
      info: info === undefined ? '' : String(info)
    });
  }

  return { T: T, results: results, BUILD: BUILD };
}

/* ------------------------------------------------------------
   checkDuplicateNames(results) —— 编排层汇总后调用
   把重复出现的断言名作为【额外的失败项】追加，而不是静默放过。
   返回追加的失败项数组（无重名时为空数组）。
   ------------------------------------------------------------ */
function checkDuplicateNames(results) {
  const seen = {};
  const extra = [];
  results.forEach(function (r) {
    const key = r.case + '::' + r.name;
    if (seen[key]) {
      extra.push({
        suite: 'regress',
        case: r.case,
        name: '⚠ 断言名重复：' + r.name,
        pass: false,
        info: '该 case 内已出现过同名断言（第 ' + (seen[key] + 1) + ' 次）'
      });
    }
    seen[key] = (seen[key] || 0) + 1;
  });
  return extra;
}

/* ------------------------------------------------------------
   单文件独立运行支持：node tests/cases/xxx.js
   每个 case 文件在末尾调用 standalone(module, run) 即可获得
   「直接运行就打印结果 + 正确退出码」的能力（D3 守则第 4 条）。
   ------------------------------------------------------------ */
function standalone(mod, run) {
  if (mod === require.main) {
    run().then(function (r) {
      r.results.forEach(function (x) {
        console.log((x.pass ? '  PASS  ' : '  FAIL  ') + '[' + x.case + '] ' + x.name +
          (x.info ? '  [' + x.info + ']' : ''));
      });
      const fail = r.results.filter(function (x) { return !x.pass; }).length;
      console.log('\n' + (r.results.length - fail) + '/' + r.results.length +
        (fail === 0 ? '  全绿 ✓' : '  ' + fail + ' 项红 ✗'));
      process.exit(fail === 0 ? 0 : 1);
    });
  }
}

/* ------------------------------------------------------------
   checkCaseCounts(manifest, perCase) —— 断言数对账（D3 拆分暴露的教训）
   ------------------------------------------------------------
   拆分前所有断言落在同一个 results 数组里，"少了几条"一眼看不出来。
   拆分后每个文件各自收集，一旦某个 case 的断言【静默丢失】，
   总数只掉一两条，很容易被当成"本来就这样"放过。

   实例：L 图片收口 的 R34/R34b 写在一个【没有 await 的 async IIFE】里，
   原先靠"后面还有一堆慢 case，微任务赶在 return 前跑完"才碰巧落袋；
   拆成独立文件后 run() 立刻返回，两条直接蒸发（453 → 451）。

   故把每个 case 的实测条数写进 manifest 作基线，编排层逐一对账：
   少了 = 有断言被吞（判红），多了 = 新增断言（提醒补基线）。
   ------------------------------------------------------------ */
function checkCaseCounts(manifest, perCase) {
  const extra = [];
  (manifest || []).forEach(function (m) {
    if (m.expect === null || m.expect === undefined) return;   // 未基线，跳过
    const actual = perCase[m.name] || 0;
    if (actual !== m.expect) {
      extra.push({
        suite: 'regress',
        case: m.name,
        name: '⚠ 断言数对账不符：' + m.name,
        pass: false,
        info: '基线 ' + m.expect + ' 条，实测 ' + actual + ' 条（' +
          (actual < m.expect ? '少了 ' + (m.expect - actual) + ' 条——多半是异步断言没 await 被吞了'
                             : '多了 ' + (actual - m.expect) + ' 条——请跑 npm run baseline 更新基线') + '）'
      });
    }
  });
  return extra;
}

/* ------------------------------------------------------------
   lintFloatingAsync(text, file) —— 悬浮异步 IIFE 静态检查
   ------------------------------------------------------------
   直接盯上面那个坑的【根因】：`(async function () {...})()` 前面没有 await。
   光靠运行时对账只能事后发现，这里把它钉在语法层面。
   返回问题描述数组（空 = 没问题）。
   ------------------------------------------------------------ */
function lintFloatingAsync(text, file) {
  const bad = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach(function (ln, i) {
    const s = ln.replace(/\s+/g, '');       // 去空白，防 `async function` 中间空格干扰
    /* 只盯「(async function」—— 必须是【左括号紧跟 async】的【函数】形式。
       为什么这么窄：
         · 不能只匹配 `async function`，否则 `async function run() {`（普通声明）
           会被误判 —— 第一版就在这上面 28 个文件全红。
         · 不收 `(async () =>` 箭头形式：它大量用作 .map/.forEach 回调，
           由调用方决定时序，误报率远高于真问题。真出问题还有断言数对账兜着。 */
    if (s.indexOf('(asyncfunction') === -1) return;
    /* 这些前缀说明返回值被接住了，不算悬浮 */
    if (/\bawait\b/.test(s) || /\breturn\b/.test(s) || /Promise\.all/.test(s) || /=/.test(s)) return;
    bad.push((file || '') + ':' + (i + 1) + '  悬浮异步 IIFE（前面没有 await/return）：' + ln.trim().slice(0, 60));
  });
  return bad;
}

module.exports = {
  makeSuite: makeSuite,
  checkDuplicateNames: checkDuplicateNames,
  checkCaseCounts: checkCaseCounts,
  lintFloatingAsync: lintFloatingAsync,
  standalone: standalone
};
