'use strict';
/* ============================================================
   tests/cases/44-v3-7-0-widget-collapse.js — v3.7.0 小工具折叠

   ① .widget 通用壳新增折叠能力（3.0 方案 §9.8 遗留项）
   ② 折叠状态按 data-widget 名持久化（localStorage；存储异常静默降级）
   ③ 无障碍：原生 button + aria-expanded + aria-controls 配对

   ⚠ 为什么三层都要断言：结构在 views、行为在 app、外观在 css ——
     任何一处被摘掉，只看单层都会漏过（本项目"假绿"的经典姿势）。
   ⚠ 状态契约：折叠 data-collapsed="1" / 展开 "0"（展开是写 0 而非删属性），
     aria-expanded 随之同步 —— 改契约必须同步改本文件。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments } = require('../common');

function fnBody(src, name) {
  const at = src.indexOf('function ' + name);
  if (at === -1) return '';
  const open = src.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

function topLevelRules(css) {
  const out = [];
  const re = /(^|\})\s*([^{}]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const open = re.lastIndex;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    const sel = m[2].replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    out.push([sel, css.slice(open, close)]);
    re.lastIndex = close;
  }
  return out;
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);
  const rules = topLevelRules(css);
  const views = SRC.views;
  const appSrc = SRC.app;

  function bodyOf(selRe) {
    return rules.filter(function (r) { return selRe.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
  }

  /* ================= ① 结构（views） ================= */
  {
    const CN = 'v3.7.0 小工具折叠';
    const hw = stripComments(fnBody(views, 'heatWidget'));

    T(CN, 'R206 标题行包进原生按钮，初始 aria-expanded=true（CSP：不得内联事件）',
      /<button type="button"[^>]*data-widget-toggle/.test(hw) &&
      /aria-expanded="true"/.test(hw) &&
      !/onclick=/.test(hw),
      '折叠按钮结构缺失或不是原生按钮');

    const ctrlMatch = hw.match(/aria-controls="([^"]+)"/);
    const ctrlId = ctrlMatch ? ctrlMatch[1] : '';
    T(CN, 'R206b aria-controls 与正文 body 的 id 严格配对（读屏能定位被控区域）',
      !!ctrlId && hw.indexOf('id="' + ctrlId + '"') !== -1,
      ctrlId ? 'id 不匹配：' + ctrlId : '未找到 aria-controls');

    T(CN, 'R206c 正文与注脚统一收进 .widget-body，且位于标题行之后',
      /class="widget-body"/.test(hw) &&
      hw.indexOf('widget-head') !== -1 && hw.indexOf('heat-grid') !== -1 &&
      hw.indexOf('widget-head') < hw.indexOf('widget-body') &&
      hw.indexOf('widget-body') < hw.indexOf('heat-grid'),
      '.widget-body 未正确包住正文与注脚');
  }

  /* ================= ② 外观（css） ================= */
  {
    const CN = 'v3.7.0 小工具折叠';

    /* ⚠ 断言 CSS 声明一律用 [^}]* 跳过兄弟声明（不许钉相邻）。 */
    T(CN, 'R206d 折叠规则：正文整块隐藏 + 标题行底距归零',
      /\.widget\[data-collapsed="1"\]\s*\.widget-body\s*\{[^}]*display:\s*none/.test(css) &&
      /\.widget\[data-collapsed="1"\]\s*\.widget-head\s*\{[^}]*margin-bottom:\s*0/.test(css),
      '折叠样式缺失');

    T(CN, 'R206e caret 指示随状态旋转，过渡时长走统一变量（禁裸写时长）',
      /\.widget\[data-collapsed="1"\]\s*\.widget-caret\s*\{[^}]*transform:\s*rotate\(-90deg\)/.test(css) &&
      /transition:\s*transform\s+var\(--t-/.test(bodyOf(/^\.widget-caret$/)),
      'caret 旋转或时长变量缺失');

    T(CN, 'R206f 按钮重置原生样式（background/border/font），并给出键盘焦点环',
      /background:\s*none/.test(bodyOf(/^\.widget-toggle$/)) &&
      /border:\s*0/.test(bodyOf(/^\.widget-toggle$/)) &&
      /font:\s*inherit/.test(bodyOf(/^\.widget-toggle$/)) &&
      /\.widget-toggle:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--cyan\)/.test(css),
      '按钮重置或焦点环缺失');
  }

  /* ================= ③ 行为代码（app） ================= */
  {
    const CN = 'v3.7.0 小工具折叠';
    /* ⚠ 一律跑在 stripComments 之后：否则"调用被注释掉"仍会命中（本项目经典假绿），
       反向验证里有一条变异专门盯这个（注释掉 renderArchive 里的调用 ⇒ R207b 必须红）。 */
    const appClean = stripComments(appSrc);
    const read = stripComments(fnBody(appSrc, 'readWidgetCollapse'));
    const persist = stripComments(fnBody(appSrc, 'persistWidgetCollapsed'));
    const setFn = stripComments(fnBody(appSrc, 'setWidgetCollapsed'));
    const bind = stripComments(fnBody(appSrc, 'bindWidgetCollapse'));
    const render = stripComments(fnBody(appSrc, 'renderArchive'));

    T(CN, 'R207 状态按 data-widget 名持久化，读写都包在 try/catch 内（存储被禁不崩）',
      /WIDGET_COLLAPSE_KEY\s*=\s*'neon_widget_collapsed'/.test(appClean) &&
      /try\s*\{[\s\S]*?localStorage\.getItem[\s\S]*?\}\s*catch/.test(read) &&
      /try\s*\{[\s\S]*?localStorage\.setItem[\s\S]*?\}\s*catch/.test(persist),
      '持久化键或防护缺失');

    T(CN, 'R207b 渲染后接入绑定：恢复持久化 + 点击切换 + data/aria 双同步',
      /bindWidgetCollapse\(\)\s*;/.test(render) &&
      /addEventListener\('click'/.test(bind) &&
      /setWidgetCollapsed\(w, btn, true\)/.test(bind) &&
      /setAttribute\('data-collapsed'/.test(setFn) &&
      /setAttribute\('aria-expanded'/.test(setFn),
      '绑定未接入或状态未同步');
  }

  /* ================= ④ 行为（jsdom 真渲染归档页） ================= */
  {
    const CN = 'v3.7.0 小工具折叠';
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return !!ctx.doc.querySelector('[data-widget-toggle]'); }, 5000);

    const btn = ctx.doc.querySelector('[data-widget-toggle]');
    const w = ctx.doc.querySelector('.widget[data-widget="heat"]');

    T(CN, 'R208 默认展开：aria-expanded=true 且无 data-collapsed=1',
      !!btn && !!w &&
      btn.getAttribute('aria-expanded') === 'true' &&
      w.getAttribute('data-collapsed') !== '1',
      btn ? 'aria=' + btn.getAttribute('aria-expanded') : '未找到折叠按钮');

    btn.click();
    T(CN, 'R208b 点击折叠：data-collapsed=1 且 aria-expanded=false',
      w.getAttribute('data-collapsed') === '1' &&
      btn.getAttribute('aria-expanded') === 'false',
      w.getAttribute('data-collapsed') + ' / ' + btn.getAttribute('aria-expanded'));

    btn.click();
    T(CN, 'R208c 再点击恢复展开：data-collapsed=0 且 aria-expanded=true',
      w.getAttribute('data-collapsed') === '0' &&
      btn.getAttribute('aria-expanded') === 'true',
      w.getAttribute('data-collapsed') + ' / ' + btn.getAttribute('aria-expanded'));

    ctx.dom.window.close();
  }

  /* 预置折叠状态 → 渲染即折叠（持久化恢复路径；渲染后同帧应用，无闪烁） */
  {
    const CN = 'v3.7.0 小工具折叠';
    /* ⚠ bootDom 的 opts.storage 预置被包在 `if (opts.themeBoot)` 分支内 ——
       不传 themeBoot:true 时写入被静默跳过（本 case 初版就栽在这，恢复路径假绿）。 */
    const ctx = bootDom({
      url: 'https://x.test/#/archive',
      themeBoot: true,
      storage: { neon_widget_collapsed: JSON.stringify({ heat: true }) }
    });
    await waitFor(function () { return !!ctx.doc.querySelector('[data-widget-toggle]'); }, 5000);

    const btn = ctx.doc.querySelector('[data-widget-toggle]');
    const w = ctx.doc.querySelector('.widget[data-widget="heat"]');
    T(CN, 'R208d 持久化恢复：预置折叠 → 渲染后即为折叠态',
      w.getAttribute('data-collapsed') === '1' &&
      btn.getAttribute('aria-expanded') === 'false',
      btn ? 'aria=' + btn.getAttribute('aria-expanded') : '未找到按钮');

    btn.click(); /* 展开 */
    const saved = JSON.parse(ctx.w.localStorage.getItem('neon_widget_collapsed') || '{}');
    T(CN, 'R208e 展开后持久化记录被清除（而非写 false）',
      saved.heat === undefined && w.getAttribute('data-collapsed') === '0',
      JSON.stringify(saved));

    ctx.dom.window.close();
  }

  /* 存储异常降级：损坏数据 / 写入抛错 */
  {
    const CN = 'v3.7.0 小工具折叠';
    /* 同样需要 themeBoot:true 才会真正预置（见上一段的坑注）。 */
    const ctx = bootDom({
      url: 'https://x.test/#/archive',
      themeBoot: true,
      storage: { neon_widget_collapsed: '{{{bad' }
    });
    await waitFor(function () { return !!ctx.doc.querySelector('[data-widget-toggle]'); }, 5000);

    const btn = ctx.doc.querySelector('[data-widget-toggle]');
    const w = ctx.doc.querySelector('.widget[data-widget="heat"]');
    T(CN, 'R208f 存储数据损坏 → 按"全部展开"处理，页面不崩',
      w.getAttribute('data-collapsed') !== '1' &&
      btn.getAttribute('aria-expanded') === 'true',
      '损坏数据导致异常状态');

    /* 场景 2：写入抛错（配额满 / 隐私模式）。替换 window.localStorage 为会抛的实现 ——
       app.js 里是裸引用 localStorage，每次访问都走 window，替换即刻生效。
       注意必须发生在 boot 之后：State 初始化的 nickname 读没有防护，
       boot 前破坏会让既有代码先崩（与本次功能无关）。 */
    Object.defineProperty(ctx.w, 'localStorage', {
      configurable: true,
      get: function () {
        return {
          getItem: function () { return null; },
          setItem: function () { throw new Error('QuotaExceededError'); }
        };
      }
    });
    let threw = false;
    try { btn.click(); } catch (e) { threw = true; }
    T(CN, 'R208g 写入抛错（配额满/隐私模式）→ 不冒泡，会话内仍可折叠',
      !threw && w.getAttribute('data-collapsed') === '1',
      threw ? '点击时异常冒泡' : w.getAttribute('data-collapsed'));

    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v3.7.0 小工具折叠" };

standalone(module, run);
