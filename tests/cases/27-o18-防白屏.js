'use strict';
/* ============================================================
   tests/cases/27-o18-防白屏.js — O18 防白屏
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L2518-2577
   独立运行：node tests/cases/27-o18-防白屏.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments, stripJsLineComments } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  {
    const appBare = stripComments(stripJsLineComments(SRC.app || ''));

    /* --- 源码结构：四层防线必须都在，且接线正确 --- */
    T('O18 防白屏', 'R89 四层防线函数均存在（bootSafe/safeRoute/safeRenderNav/fatalPanel）',
      /function bootSafe\s*\(/.test(appBare) &&
      /function safeRoute\s*\(/.test(appBare) &&
      /function safeRenderNav\s*\(/.test(appBare) &&
      /function fatalPanel\s*\(/.test(appBare));
    T('O18 防白屏', 'R89b bootSafe 包裹 boot 调用（启动期异常可兜）',
      /function bootSafe\s*\(\s*\)\s*\{[\s\S]{0,200}boot\(\)/.test(appBare));
    T('O18 防白屏', 'R89c safeRoute 捕获异常后转调 fatalPanel（异常变故障面板）',
      /function safeRoute\s*\(\s*\)\s*\{[\s\S]{0,300}fatalPanel\(/.test(appBare));
    T('O18 防白屏', 'R89d safeRenderNav 已接入 boot 与认证变化（≥2 处调用）',
      (appBare.match(/safeRenderNav\(\)/g) || []).length >= 2,
      (appBare.match(/safeRenderNav\(\)/g) || []).length + ' 处');

    /* --- 行为：真注入抛错视图函数，看防线是否接住 --- */
    const c = bootDom({
      captureConsole: true,
      breakRouteOnBoot: 'homeView',
      breakRouteMsg: '<img src=x onerror=alert(1)>BOOM'
    });
    await waitFor(function () { return c.doc.body.innerHTML.length > 100; }, 3000);
    await new Promise(function (r) { setTimeout(r, 300); });

    T('O18 防白屏', 'R89e 渲染异常时不白屏（body 仍有实质内容）',
      c.doc.body.innerHTML.length > 600, c.doc.body.innerHTML.length + 'B');
    const codeEl = c.doc.querySelector('.empty-code');
    T('O18 防白屏', 'R89f 渲染异常时显示 RENDER FAULT 故障面板',
      !!c.doc.querySelector('.empty-state') && !!codeEl &&
      /RENDER FAULT/.test(codeEl.textContent || ''),
      codeEl ? codeEl.textContent : '(无面板)');
    T('O18 防白屏', 'R89g 故障面板给出「返回首页」出口（用户不困死）',
      !!c.doc.querySelector('.empty-state a.btn[href="#/"]'));
    /* 错误面板本身也是渲染面：异常信息若夹带标签，必须被 esc 转义。
       否则「渲染出错」这条路径就变成了注入点 —— 越慌越容易被打。 */
    const hintEl = c.doc.querySelector('.empty-hint');
    T('O18 防白屏', 'R89h 异常信息经 esc 转义（故障面板也不注入）',
      !c.doc.querySelector('img[src="x"]') && /&lt;/.test(hintEl ? hintEl.innerHTML : ''),
      hintEl ? hintEl.textContent.slice(0, 50) : '(无)');
    T('O18 防白屏', 'R89i 渲染异常不产生未处理 Promise 拒绝',
      (c.unhandled || []).length === 0, (c.unhandled || [])[0] || '');
    /* 原始错误只进 console，不整段糊到页面上 —— 与 E1 脱敏同源的要求 */
    T('O18 防白屏', 'R89j 原始异常只进 console.error（不外泄给访客）',
      c.logs.some(function (l) { return l.indexOf('ERR:') === 0 && /路由渲染失败/.test(l); }),
      (c.logs.filter(function (l) { return l.indexOf('ERR:') === 0; })[0] || '(无)').slice(0, 60));
    c.dom.window.close();

    /* --- 反向确认：正常启动绝不该出现 RENDER FAULT ---
       没有这一条，上面 R89f 可能因「面板恒存在」而恒真。 */
    const c2 = bootDom({ captureConsole: true });
    await waitFor(function () { return c2.doc.body.innerHTML.length > 600; }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });
    const code2 = c2.doc.querySelector('.empty-code');
    T('O18 防白屏', 'R89k 正常启动不出现 RENDER FAULT（故障面板非默认态）',
      !code2 || !/RENDER FAULT/.test(code2.textContent || ''),
      code2 ? code2.textContent : '(无面板)');
    c2.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O18 防白屏" };

standalone(module, run);
