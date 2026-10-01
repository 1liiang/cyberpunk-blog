'use strict';
/* ============================================================
   tests/fault-matrix.js — 故障注入矩阵（7 场景）
   模拟各层脚本 / SDK / 本地库缺失，断言：
   不白屏、无未处理拒绝、降级提示可读、页脚版本号正确。
   ============================================================ */
const { bootDom, waitFor } = require('./common');

const SCENARIOS = [
  {
    name: 'normal（一切正常）',
    opts: {},
    expect: { foot: /^v\d+\.\d+\.\d+$/, must: [] }
  },
  {
    name: 'noVer（version.js 加载失败）',
    opts: { skipVer: true },
    expect: { foot: 'v?' }
  },
  {
    name: 'noViews（views.js 加载失败）',
    opts: { skipViews: true },
    expect: { foot: /^v\d+\.\d+\.\d+$/, must: ['VIEW LAYER MISSING'] }
  },
  {
    name: 'noCloud（cloud.js 加载失败）',
    opts: { skipCloud: true },
    expect: { foot: /^v\d+\.\d+\.\d+$/, must: ['数据层（cloud.js）未就绪'] }
  },
  {
    name: 'noSDK（云 SDK 加载失败）',
    opts: { noSDK: true },
    expect: { foot: /^v\d+\.\d+\.\d+$/, must: ['云服务 SDK 未就绪'] }
  },
  {
    /* ⚠ v5.6.5：这条原先期待页面出现「CDN 组件加载失败」—— 那是启动时的**假警报**：
       v4.8.1 起三个库已本地托管（文案里的 CDN 就不成立），v5.3.0 起它们又改成
       "渲染正文时按需注入"，于是启动那一刻它们必然不存在 → 红条 100% 亮。
       现在改成钉**真实且准确**的降级：库缺失时不再对"还没用到的库"下结论，
       页面照常可用（首屏正常、无未处理拒绝）。 */
    name: 'noMarked（Markdown 引擎缺失）',
    opts: { noMarked: true },
    expect: { foot: /^v\d+\.\d+\.\d+$/, must: [], mustNot: ['CDN 组件加载失败'] }
  },
  {
    /* 原先叫 noAllCDN（"全部 CDN 依赖缺失"）—— 站里早已没有 CDN 依赖了，
       这个场景的真实含义是"三个本地库桩 + SDK 一起缺失"。名字与判据一并改准。 */
    name: 'noAllLibs（本地库与 SDK 一起缺失）',
    opts: { noMarked: true, noPurify: true, noHljs: true, noSDK: true },
    expect: { foot: /^v\d+\.\d+\.\d+$/, must: ['云服务 SDK 未就绪'], mustNot: ['CDN 组件加载失败'] }
  }
];

async function run() {
  const results = [];
  for (const sc of SCENARIOS) {
    const ctx = bootDom(sc.opts);
    const ok = await waitFor(function () {
      const el = ctx.doc.getElementById('foot-version');
      return el && el.textContent && el.textContent !== '----' && ctx.doc.body.innerHTML.length > 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); }); /* 留出异步渲染余量 */

    const body = ctx.doc.body ? ctx.doc.body.innerHTML : '';
    const footEl = ctx.doc.getElementById('foot-version');
    const footText = footEl ? footEl.textContent.trim() : '(无页脚)';
    const checks = [];
    checks.push({ name: '页面不白屏', pass: body.length >= 600, info: 'body ' + body.length + 'B' });
    checks.push({
      name: '页脚版本 = ' + (sc.expect.foot instanceof RegExp ? '(版本号格式)' : sc.expect.foot),
      pass: typeof sc.expect.foot === 'string' ? footText === sc.expect.foot : sc.expect.foot.test(footText),
      info: footText
    });
    sc.expect.must = sc.expect.must || [];
    sc.expect.must.forEach(function (m) {
      checks.push({ name: '降级提示含「' + m + '」', pass: body.indexOf(m) !== -1 });
    });
    /* mustNot：**不许**出现的过期文案（假警报回流即红） */
    (sc.expect.mustNot || []).forEach(function (m) {
      checks.push({ name: '不出现过期文案「' + m + '」', pass: body.indexOf(m) === -1 });
    });
    checks.push({ name: '无未处理 Promise 拒绝', pass: ctx.unhandled.length === 0, info: ctx.unhandled[0] || '' });

    const allPass = checks.every(function (c) { return c.pass; });
    checks.forEach(function (c) {
      results.push({ suite: 'fault', case: sc.name, name: c.name, pass: c.pass, info: c.info || '' });
    });
    if (!ok && allPass) { /* 等待超时但断言全过，视为通过（慢环境） */ }
    ctx.dom.window.close();
  }
  const fail = results.filter(function (r) { return !r.pass; }).length;
  return { pass: results.length - fail, fail: fail, results: results };
}

module.exports = { run: run, SCENARIOS: SCENARIOS };

/* 直接运行时输出 */
if (require.main === module) {
  run().then(function (r) {
    r.results.forEach(function (x) {
      console.log((x.pass ? '  PASS  ' : '  FAIL  ') + '[' + x.case + '] ' + x.name + (x.info ? '  [' + x.info + ']' : ''));
    });
    console.log('\n故障注入矩阵: ' + r.pass + '/' + (r.pass + r.fail));
    process.exit(r.fail === 0 ? 0 : 1);
  });
}
