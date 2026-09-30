'use strict';
/* ============================================================
   tests/cases/19-o8-分隔线.js — O8 分隔线
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L1270-1296
   独立运行：node tests/cases/19-o8-分隔线.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  {
    const cssTxt = SRC.css || '';
    const afterM = /\.page-head::after\s*\{([\s\S]*?)\}/.exec(cssTxt);
    const beforeM = /\.page-head::before\s*\{([\s\S]*?)\}/.exec(cssTxt);
    const headM = /\.page-head\s*\{([\s\S]*?)\}/.exec(cssTxt);

    T('O8 分隔线', 'R56 .page-head::after 分隔线规则存在', !!afterM);
    T('O8 分隔线', 'R56b 分隔线用 background 渐变绘制（非 border 实线）',
      !!afterM && /background\s*:/.test(afterM[1]) && /linear-gradient/.test(afterM[1]));
    T('O8 分隔线', 'R56c 分隔线高度 1px + 上方留白',
      !!afterM && /height\s*:\s*1px/.test(afterM[1]) && /margin-top\s*:/.test(afterM[1]));
    T('O8 分隔线', 'R56d 分隔线含「扫描段」（第二层渐变）',
      !!afterM && (afterM[1].match(/linear-gradient/g) || []).length >= 2);
    T('O8 分隔线', 'R56e 左端菱形锚点（::before + clip-path polygon）',
      !!beforeM && /clip-path\s*:\s*polygon/.test(beforeM[1]));
    T('O8 分隔线', 'R56f .page-head 有 position:relative（菱形锚的定位基准）',
      !!headM && /position\s*:\s*relative/.test(headM[1]));
    /* 关键：颜色必须走变量，否则亮色主题下分隔线仍是刺眼荧光青 */
    const afterBgVar = afterM ? /var\(--(cyan|line-strong|magenta|glow)/.test(afterM[1]) : false;
    T('O8 分隔线', 'R56g 分隔线配色走 CSS 变量（亮色主题自动适配）', afterBgVar);
    const hardNeon = afterM ? (afterM[1].match(/#00f0ff|#ff2a6d|#f9f002/gi) || []) : [];
    T('O8 分隔线', 'R56h 分隔线内无硬编码霓虹色值',
      hardNeon.length === 0, hardNeon.join(',') || '无');
    /* 全站复用：所有页面标题区都该有这条分隔线（用的是同一个 .page-head） */
    T('O8 分隔线', 'R56i 分隔线挂在通用 .page-head 上（全站页面同享）',
      /\.page-head::after/.test(cssTxt) && !/\.archive-view\s+\.page-head::after/.test(cssTxt));
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O8 分隔线" };

standalone(module, run);
