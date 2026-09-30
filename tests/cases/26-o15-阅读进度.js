'use strict';
/* ============================================================
   tests/cases/26-o15-阅读进度.js — O15 阅读进度
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L2348-2506
   独立运行：node tests/cases/26-o15-阅读进度.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments, stripJsLineComments } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ---- O15：C9 阅读进度条 + 回到顶部 ---- */
  {
    const html = SRC.html || '';
    const cssBare = stripComments(SRC.css || '');
    const appBare = stripComments(stripJsLineComments(SRC.app || ''));

    /* --- 结构：节点挂在 #app 之外（否则被路由重渲染抹掉） --- */
    const appOpen = html.indexOf('id="app"');
    const progIdx = html.indexOf('id="read-progress"');
    const toTopIdx = html.indexOf('id="to-top"');
    T('O15 阅读进度', 'R74 index.html 含进度条容器', progIdx !== -1);
    T('O15 阅读进度', 'R74b 进度条挂在 #app 之外（在它之前，不会被 innerHTML 抹掉）',
      progIdx !== -1 && appOpen !== -1 && progIdx < appOpen,
      'progress@' + progIdx + ' app@' + appOpen);
    T('O15 阅读进度', 'R74c 进度条对读屏隐藏（纯视觉指示）',
      /id="read-progress"[^>]*aria-hidden="true"/.test(html) ||
      /aria-hidden="true"[^>]*id="read-progress"/.test(html));

    T('O15 阅读进度', 'R74d 回到顶部是 <button> 而非 <a href="#">',
      /<button[^>]*id="to-top"/.test(html));
    T('O15 阅读进度', 'R74e 回到顶部带 aria-label（读屏有人话）',
      /id="to-top"[^>]*aria-label="[^"]+"/.test(html) ||
      /aria-label="[^"]+"[^>]*id="to-top"/.test(html));
    T('O15 阅读进度', 'R74f 回到顶部挂在 #app 之外',
      toTopIdx !== -1 && appOpen !== -1 && toTopIdx > appOpen);
    /* CSP 硬约束：绝不能有内联 onclick */
    T('O15 阅读进度', 'R74g 回到顶部无内联 onclick（CSP 会拦死）',
      !/<button[^>]*id="to-top"[^>]*onclick=/.test(html));

    /* --- CSS：必须用 transform 而非 width 驱动进度 --- */
    const progRule = (function () {
      const m = /\.read-progress-bar\s*\{([\s\S]*?)\}/.exec(cssBare);
      return m ? m[1] : '';
    })();
    T('O15 阅读进度', 'R74h 进度条用 transform: scaleX() 驱动（不触发重排）',
      /transform:\s*scaleX\(/.test(progRule));
    /* 精确断言：CSS 里 width 只能是布局用的固定值（100% 撑满父容器），
       绝不能出现"按进度动态赋值"的百分比写法。真正的动态写入在 JS 侧，
       由 R75g 断言 JS 不碰 style.width —— 两侧都守住才算数。 */
    T('O15 阅读进度', 'R74i 进度条的 width 不用于表达进度（只作布局撑满）',
      !/width:\s*(?:calc\(|\d*\.?\d+%\s*[+*])/.test(progRule) &&
      !/width:\s*\d+px/.test(progRule),
      progRule.match(/width:[^;]+/g) ? progRule.match(/width:[^;]+/g).join(' | ') : '无 width');
    T('O15 阅读进度', 'R75g JS 不通过 style.width 更新进度（一律走 transform）',
      !/\.style\.width\s*=/.test(appBare));
    T('O15 阅读进度', 'R74j 进度条设了 transform-origin: 0（从左端生长）',
      /transform-origin:\s*0/.test(progRule));
    T('O15 阅读进度', 'R74k 进度条 pointer-events:none（不挡下方可点元素）',
      /\.read-progress\s*\{[^}]*pointer-events:\s*none/.test(cssBare));
    T('O15 阅读进度', 'R74l 回顶按钮默认隐藏，靠 data-visible 显形',
      /\.to-top\s*\{[^}]*opacity:\s*0/.test(cssBare) &&
      /\.to-top\[data-visible="1"\]/.test(cssBare));

    /* --- JS：节流与不依赖 IO --- */
    T('O15 阅读进度', 'R75 滚动处理用 requestAnimationFrame 节流',
      /requestAnimationFrame/.test(appBare));
    T('O15 阅读进度', 'R75b 有"本帧已排期"的去重判断（不是每帧多次重算）',
      /if \(scrollUI\.rafId\) return/.test(appBare));
    /* R75c：判据必须切在 updateScrollUI 函数体内（不是"从它到最后"），
       否则会把后面 buildToc 里的 IntersectionObserver 也算进来（误报）。
       切法：取 updateScrollUI 定义到下一个顶层 function 之间的片段。 */
    const updateFn = (function () {
      const i = appBare.indexOf('function updateScrollUI(');
      if (i === -1) return '';
      const rest = appBare.slice(i + 10);
      const next = rest.search(/\n  function\s/);
      return next === -1 ? rest : rest.slice(0, next);
    })();
    T('O15 阅读进度', 'R75c 进度/回顶用 scrollTop 与视口高度算（不依赖 IntersectionObserver）',
      /currentScrollTop\s*\(/.test(updateFn) &&
      /innerHeight/.test(updateFn) &&
      !/IntersectionObserver/.test(updateFn),
      '片段长 ' + updateFn.length);
    T('O15 阅读进度', 'R75d 提供释放函数（监听器可回收）',
      /function releaseScrollUI\s*\(/.test(appBare));
    T('O15 阅读进度', 'R75e init 幂等：先释放再安装（重复调用不叠加）',
      /function initScrollUI\s*\([\s\S]{0,200}releaseScrollUI\(\)/.test(appBare));
    T('O15 阅读进度', 'R75f 回顶按钮的 click 绑定有防重复标记',
      /__neonBound/.test(appBare));

    /* --- 运行时：真跑（jsdom 无布局，故用属性/风格状态验证，不验像素） --- */
    {
      const c = bootDom({ captureConsole: true, url: 'https://x.test/#/archive' });
      await waitFor(function () { return c.doc.body.innerHTML.length > 600; }, 3000);
      await new Promise(function (r) { setTimeout(r, 200); });

      T('O15 阅读进度', 'R76 启动后进度条节点存在',
        !!c.doc.getElementById('read-progress'));
      T('O15 阅读进度', 'R76b 启动后回顶按钮存在',
        !!c.doc.getElementById('to-top'));
      T('O15 阅读进度', 'R76c 初始（未滚动）时进度条处于 idle 隐藏态',
        c.doc.getElementById('read-progress').getAttribute('data-idle') === '1');
      T('O15 阅读进度', 'R76d 初始（未滚动）时回顶按钮隐藏',
        c.doc.getElementById('to-top').getAttribute('data-visible') === '0');

      /* 模拟滚动：jsdom 无布局，故直接喂 scrollTop 与尺寸，再派发 scroll */
      c.doc.documentElement.scrollTop = 0;
      Object.defineProperty(c.w, 'pageYOffset', { value: 0, writable: true, configurable: true });
      Object.defineProperty(c.doc.documentElement, 'scrollHeight', { value: 4000, configurable: true });
      Object.defineProperty(c.w, 'innerHeight', { value: 800, configurable: true });

      /* 滚到中点 */
      Object.defineProperty(c.w, 'pageYOffset', { value: 1600, writable: true, configurable: true });
      c.w.dispatchEvent(new c.w.Event('scroll'));
      await new Promise(function (r) { setTimeout(r, 80); });

      const bar = c.doc.getElementById('read-progress-bar');
      const tf = bar ? (bar.style.transform || '') : '';
      T('O15 阅读进度', 'R76e 滚动到中点后进度条 scaleX 约为 0.5',
        /scaleX\(0\.5/.test(tf), tf || '（无 transform）');
      T('O15 阅读进度', 'R76f 滚动中进度条脱离 idle 态（可见）',
        c.doc.getElementById('read-progress').getAttribute('data-idle') === '0');
      T('O15 阅读进度', 'R76g 滚过一屏后回顶按钮显形',
        c.doc.getElementById('to-top').getAttribute('data-visible') === '1');

      /* 滚到底 */
      Object.defineProperty(c.w, 'pageYOffset', { value: 3200, writable: true, configurable: true });
      c.w.dispatchEvent(new c.w.Event('scroll'));
      await new Promise(function (r) { setTimeout(r, 80); });
      T('O15 阅读进度', 'R76h 滚到底时进度条满格 scaleX(1)',
        /scaleX\(1(\.0+)?\)/.test(c.doc.getElementById('read-progress-bar').style.transform || ''),
        c.doc.getElementById('read-progress-bar').style.transform);
      T('O15 阅读进度', 'R76i 滚到底后进度条回到 idle 隐藏态（顶边不留静止线）',
        c.doc.getElementById('read-progress').getAttribute('data-idle') === '1');

      /* 回到顶部：模拟点击，断言 scrollTo 被调用 */
      let scrolledTo = null;
      c.w.scrollTo = function (a, b) {
        scrolledTo = (typeof a === 'object') ? (a && a.top) : a;
      };
      c.doc.getElementById('to-top').click();
      await new Promise(function (r) { setTimeout(r, 60); });
      T('O15 阅读进度', 'R76j 点击回顶按钮触发滚动到 0',
        scrolledTo === 0, 'scrollTo top=' + String(scrolledTo));

      /* 监听器幂等：再装一次不应增加 */
      const before = c.w.__scrollListeners;
      T('O15 阅读进度', 'R76k 详情/归档页 scroll 监听数已计入（>0 说明 C9 已装）',
        before > 0, 'count=' + before);
      c.dom.window.close();
    }

    /* 短页面（内容不足一屏）：两种 UI 都不该出现 */
    {
      const c = bootDom({ url: 'https://x.test/#/about' });
      await waitFor(function () { return c.doc.body.innerHTML.length > 400; }, 3000);
      await new Promise(function (r) { setTimeout(r, 150); });
      /* 把页面高度设成小于视口 */
      Object.defineProperty(c.doc.documentElement, 'scrollHeight', { value: 400, configurable: true });
      Object.defineProperty(c.w, 'innerHeight', { value: 900, configurable: true });
      Object.defineProperty(c.w, 'pageYOffset', { value: 0, writable: true, configurable: true });
      c.w.dispatchEvent(new c.w.Event('scroll'));
      await new Promise(function (r) { setTimeout(r, 80); });
      T('O15 阅读进度', 'R76l 内容不足一屏时进度条隐藏（无 0% 死线）',
        c.doc.getElementById('read-progress').getAttribute('data-idle') === '1');
      T('O15 阅读进度', 'R76m 内容不足一屏时回顶按钮不出现（短页面无悬浮物）',
        c.doc.getElementById('to-top').getAttribute('data-visible') === '0');
      c.dom.window.close();
    }
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O15 阅读进度" };

standalone(module, run);
