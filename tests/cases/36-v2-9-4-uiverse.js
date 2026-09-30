'use strict';
/* ============================================================
   tests/cases/36-v2-9-4-uiverse.js — v2.9.4 Uiverse 借法两项

   改造内容（只借技法，不搬组件）：
     ① 主题罗盘单选组（借自「旋转罗盘单选组」）
        #btn-theme 由「单按钮循环」退化为 disclosure 触发器，
        #theme-menu 为 role=radiogroup，三项 <button role=radio> 直选。
     ② 按钮对向充能光条（借自「切角光轨按钮」）
        .btn::after 由「斜光扫过」改为「上缘向右 + 下缘向左」双光条充能。

   覆盖三层：
     ① 源码结构（js/app.js）—— 面板/选项/白名单/委托
     ② 运行时行为（jsdom）—— 开合 / roving tabindex / 方向键 / Escape / 外部点击
     ③ 样式（css/style.css）—— 定位 / 颜色变量 / 光条实现 / reduce / print

   写法原则（同 29–35 号）：行为 > 语义 > 字面；每条可反向验证。

   ⚠ 本 case 特有的坑：
     · jsdom 无 CSS 引擎 —— hover 态无法运行时验证，光条只能验 CSS 声明，
       因此每条 CSS 断言都钉「具体值」而非「存在某个属性」，防止字面假绿。
     · 面板点击走 document 上的 async 委托 —— .click() 的同步部分会立刻执行，
       但仍需 await 一帧再读 DOM（toast 分支之后才有状态落定）。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments } = require('../common');

/* 顶层规则遍历器（同 33/34/35 号）：返回 [sel, body] 对 */
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

/* @media 块提取（按花括号配平，同 35 号 —— 不能贪婪到文件结尾） */
function mediaBlocks(css, cond) {
  const re = /@media([^{]*)\{/g;
  const out = [];
  let m;
  while ((m = re.exec(css))) {
    if (cond && !cond(m[1])) { continue; }
    let depth = 1, i = re.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push({ cond: m[1].trim(), body: css.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

/* 抠出函数体（花括号配平）—— 防「带大窗口的懒匹配跨出函数边界」型假绿 */
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

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);
  const app = SRC.app;
  const rules = topLevelRules(css);
  const hoverBlk = mediaBlocks(css, function (c) { return /hover\s*:\s*hover/.test(c); })
    .map(function (b) { return b.body; }).join('\n');
  const rmBlk = mediaBlocks(css, function (c) { return /prefers-reduced-motion/.test(c); })
    .map(function (b) { return b.body; }).join('\n');
  const prBlk = mediaBlocks(css, function (c) { return /\bprint\b/.test(c); })
    .map(function (b) { return b.body; }).join('\n');

  function bodyOf(selRe) {
    return rules.filter(function (r) { return selRe.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
  }

  /* ==========================================================
     ① 主题罗盘：源码结构
     ========================================================== */
  {
    T('U1 主题罗盘', 'R170 renderNav 输出罗盘面板（radiogroup + button[role=radio]）',
      /id="theme-menu"/.test(app) && /role="radiogroup"/.test(app) &&
      /class="theme-swap"\s+role="radio"/.test(app),
      '面板或选项结构缺失');

    /* ⚠ 反向验证要点：用原生 <input type=radio> 也能让"三选一"跑通，
       但它需要 <label> 包裹才能样式化，而 label 会改变 e.target，
       本站的 closest() 委托要另写一套判定 —— 故这里明确钉死不用 input。 */
    /* ⚠ 必须限定在 themeSwapsHtml 函数体内：全文件扫描会把源码**注释**里的
       "<input type="radio">"（本文件 852 行那条说明）也当成真实标签 → 假红。
       这是"断言要钉代码、不能钉注释"的又一次实例。 */
    const swapsFn = fnBody(app, 'themeSwapsHtml');
    T('U1 主题罗盘', 'R170b 选项用 button[role=radio] 而非原生 input（不破坏 closest 委托）',
      swapsFn.length > 0 && /role="radio"/.test(swapsFn) && !/<input/i.test(swapsFn),
      swapsFn ? '函数体内仍有 <input' : '未找到 themeSwapsHtml 函数体');

    T('U1 主题罗盘', 'R170c 三档来自 THEME_ORDER 单一来源（不另写一份档位清单）',
      /THEME_ORDER\.map\(/.test(app) && /data-theme-val="'\s*\+\s*m\s*\+\s*'"/.test(app),
      '档位未由 THEME_ORDER 派生');

    /* 旧实现必须真的消失 —— 否则会留下"点了既循环又直选"的双重行为 */
    T('U1 主题罗盘', 'R170d 旧的循环切换实现已移除（cycleTheme 不再存在）',
      !/function cycleTheme/.test(app) && /function setTheme\(/.test(app),
      'cycleTheme 仍在 / setTheme 缺失');

    T('U1 主题罗盘', 'R170e setTheme 走 THEME_ORDER 白名单校验（脏值落回默认）',
      /function setTheme\(mode\)\s*\{\s*if\s*\(THEME_ORDER\.indexOf\(mode\)\s*===\s*-1\)/.test(app),
      '未做白名单校验');

    /* roving tabindex 是"键盘用户不必按三次 Tab 穿过一个开关"的关键 */
    T('U1 主题罗盘', 'R170f roving tabindex：只给选中项 tabindex=0（在函数体内，防跨边界假绿）',
      /setAttribute\('tabindex',\s*on\s*\?\s*'0'\s*:\s*'-1'\)/.test(fnBody(app, 'syncThemeMenu')),
      'syncThemeMenu 未做 roving tabindex');

    /* 外部点击必须同时放过"点面板内"和"点触发器"，否则点选项会先被关掉面板 */
    const outside = fnBody(app, 'toggleThemeMenu');
    T('U1 主题罗盘', 'R170g 外部点击关闭时不误伤面板内与触发器（两个 closest 守卫都在）',
      /closest\('#theme-menu'\)\)/.test(app) && /closest\('#btn-theme'\)\)/.test(app) &&
      outside.length > 0,
      '缺少 closest 守卫');

    T('U1 主题罗盘', 'R170h 触发器 aria-controls / aria-expanded 齐备（disclosure 语义完整）',
      /aria-controls="theme-menu"/.test(app) && /aria-expanded="false"/.test(app),
      '触发器 ARIA 属性不全');
  }

  /* ==========================================================
     ① 主题罗盘：样式
     ========================================================== */
  {
    const menuBody = bodyOf(/^\.theme-menu$/);
    T('U1 主题罗盘', 'R170i 面板绝对定位（不占 nav 弹性行空间 → 不推歪整行）',
      /position:\s*absolute/.test(menuBody) && /right:\s*0/.test(menuBody),
      menuBody ? '未绝对定位' : '未找到 .theme-menu');

    /* ⚠ 最容易漏的一条：.theme-menu 设了 display:flex，
       而 [hidden] 的默认样式权重更低 —— 不显式写这条，hidden 属性形同虚设。 */
    const hiddenRule = bodyOf(/^\.theme-menu\[hidden\]$/);
    T('U1 主题罗盘', 'R170j .theme-menu[hidden] 显式 display:none（否则 hidden 被 flex 覆盖）',
      /display:\s*none/.test(hiddenRule),
      hiddenRule ? '未隐藏' : '未定义 [hidden] 规则');

    const valBody = bodyOf(/^\.theme-swap\[data-theme-val=/);
    T('U1 主题罗盘', 'R170k 三档各配一个主题色（青/黄/品红，全走变量无硬编码 hex）',
      /var\(--cyan\)/.test(valBody) && /var\(--yellow\)/.test(valBody) && /var\(--magenta\)/.test(valBody) &&
      !/#00f0ff|#ff2a6d|#f9f002|#b537f2/i.test(valBody),
      valBody.replace(/\s+/g, ' ').slice(0, 120));

    /* ⚠ 不能数 dashed 字面出现次数：两个伪元素**共用一条** border 声明
       （.theme-swap-ring::before, .theme-swap-ring::after { border: 1px dashed }），
       字面只有 2 处，视觉上却是 3 层环 —— 数字面会假红。
       改成钉结构：本体虚线 + 两伪元素各自有且仅有一个 inset 且方向相反（内环/外环）。 */
    const ringSelf = bodyOf(/^\.theme-swap-ring$/);
    const ringBoth = bodyOf(/^\.theme-swap-ring::before,\s*\.theme-swap-ring::after$/);
    const ringIn = bodyOf(/^\.theme-swap-ring::before$/);
    const ringOut = bodyOf(/^\.theme-swap-ring::after$/);
    T('U1 主题罗盘', 'R170l 罗盘是三层同心虚线环（本体 + 内环 + 外环，内外尺寸相反）',
      /border:\s*1px dashed/.test(ringSelf) && /border-radius:\s*50%/.test(ringSelf) &&
      /border:\s*1px dashed/.test(ringBoth) &&
      /inset:\s*2px/.test(ringIn) && /inset:\s*-3px/.test(ringOut),
      ringSelf ? '本体环 ' + (ringIn.trim() + ' | ' + ringOut.trim()) : '未找到 .theme-swap-ring');

    /* 三层环同时是"当前档位"的指示物 —— 非选中项不转，避免三档一起转的噪音 */
    const animRules = rules.filter(function (r) { return /theme-rotor/.test(r[1]); });
    T('U1 主题罗盘', 'R170m 自转只挂在选中项（.is-on）上，且恰好三层',
      animRules.length === 3 && animRules.every(function (r) { return /\.is-on/.test(r[0]); }),
      animRules.length + ' 层');
    T('U1 主题罗盘', 'R170n @keyframes theme-rotor 已定义（整圈旋转）',
      /@keyframes\s+theme-rotor\s*\{\s*to\s*\{\s*transform:\s*rotate\(360deg\)/.test(css),
      '未定义 keyframes');

    T('U1 主题罗盘', 'R170o 减少动效下自转停转，但环不隐藏（仍指示当前档位）',
      /\.theme-swap\.is-on \.theme-swap-ring[^{]*\{\s*animation:\s*none\s*!important/.test(rmBlk) &&
      !/\.theme-swap-ring[^{]*\{\s*display:\s*none/.test(rmBlk),
      'reduce 未处理或误隐藏');

    T('U1 主题罗盘', 'R170p 打印时隐藏罗盘面板（不浪费纸墨）',
      /\.theme-menu/.test(prBlk),
      '打印未隐藏 .theme-menu');
  }

  /* ==========================================================
     ① 主题罗盘：运行时行为（jsdom 真点真派键）
     ========================================================== */
  {
    const ctx = bootDom({ captureConsole: true });
    const CN = 'U1 主题罗盘';
    await waitFor(() => !!ctx.doc.getElementById('theme-menu'), 3000);
    await new Promise(r => setTimeout(r, 150));

    const menu = ctx.doc.getElementById('theme-menu');
    const trigger = ctx.doc.getElementById('btn-theme');
    const opts = menu ? Array.prototype.slice.call(menu.querySelectorAll('[data-theme-val]')) : [];

    T(CN, 'R170q 启动即渲染三项，档位值与 THEME_ORDER 一一对应',
      opts.length === 3 &&
      opts.map(function (o) { return o.getAttribute('data-theme-val'); }).join(',') === 'dark,light,warm',
      opts.map(function (o) { return o.getAttribute('data-theme-val'); }).join(','));

    T(CN, 'R170r 初始为收起态（hidden 属性在场，不是靠 CSS 类名）',
      !!menu && menu.hasAttribute('hidden'), String(menu && menu.hasAttribute('hidden')));

    /* roving tabindex：**每组**恰一个可 Tab 到的项。
       v3.0 B1 起面板是两组（明度/色相）；v4.3 B4 装置面板扩为四组
       （+氛围/+装置）⇒ 判据从"数固定 2"升级为"组数动态、每组恰一"：
       只数全局会漏掉"某一组整组够不着"，写死组数则会拦住正常的面板扩展。
       ⚠ 先取 onOpt 再判空 —— 直接链式 .getAttribute 会在"没有选中项"时抛
       TypeError，把整个 case 跑挂（那是"崩溃"不是"报红"，两种失败要分清楚）。 */
    const onOpt = menu.querySelector('[data-theme-val][aria-checked="true"]');
    const rgAll = menu.querySelectorAll('[role="radiogroup"]');
    const tab0 = menu.querySelectorAll('[tabindex="0"]');
    const everyGroupHasOne = Array.prototype.every.call(rgAll, function (g) {
      return g.querySelectorAll('[tabindex="0"]').length === 1;
    });
    T(CN, 'R170s 初始每组恰一个可 Tab 项（roving tabindex，组内不重复、组间各一）',
      !!onOpt && rgAll.length >= 2 && tab0.length === rgAll.length && everyGroupHasOne &&
      onOpt.getAttribute('tabindex') === '0',
      '可 Tab 项数 ' + tab0.length + ' / radiogroup 数 ' + rgAll.length +
        (everyGroupHasOne ? '' : ' / 存在"整组够不着"的组'));

    /* 开 → 焦点应落到当前档位上（方向键即可换档，不必先 Tab 找位置） */
    trigger.click();
    await new Promise(r => setTimeout(r, 40));
    T(CN, 'R170t 展开后焦点落在当前档位上（方向键可直接换档）',
      !menu.hasAttribute('hidden') && ctx.doc.activeElement === menu.querySelector('[aria-checked="true"]'),
      ctx.doc.activeElement ? (ctx.doc.activeElement.className || ctx.doc.activeElement.tagName) : 'null');

    /* 方向键：radiogroup 标准行为 —— 移动即选中 */
    const right = new ctx.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    ctx.doc.activeElement.dispatchEvent(right);
    await new Promise(r => setTimeout(r, 40));
    T(CN, 'R170u 方向键在组内换档并立即生效（dark → light）',
      ctx.doc.documentElement.getAttribute('data-theme') === 'light',
      String(ctx.doc.documentElement.getAttribute('data-theme')));

    const left = new ctx.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    ctx.doc.activeElement.dispatchEvent(left);
    await new Promise(r => setTimeout(r, 40));
    T(CN, 'R170v 反向键回退生效（light → dark）',
      ctx.doc.documentElement.getAttribute('data-theme') === 'dark',
      String(ctx.doc.documentElement.getAttribute('data-theme')));

    /* Escape：关面板 + 焦点归还触发器（否则焦点掉到 body，键盘用户丢失位置） */
    const esc = new ctx.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ctx.doc.activeElement.dispatchEvent(esc);
    await new Promise(r => setTimeout(r, 40));
    T(CN, 'R170w Escape 关闭面板并把焦点还给触发器',
      menu.hasAttribute('hidden') && ctx.doc.activeElement === trigger,
      'hidden=' + menu.hasAttribute('hidden'));

    /* 外部 mousedown：关闭且不归还焦点（用户点的是别处，焦点该留那儿） */
    trigger.click();
    await new Promise(r => setTimeout(r, 30));
    const outsideOpen = !menu.hasAttribute('hidden');
    ctx.doc.body.dispatchEvent(new ctx.w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 40));
    T(CN, 'R170x 点击面板外部收起（且不抢走焦点）',
      outsideOpen && menu.hasAttribute('hidden'),
      '展开成功=' + outsideOpen + ' 已收起=' + menu.hasAttribute('hidden'));

    /* ==========================================================
       v3.0 B1：色相维度（面板的第二个分组）
       ========================================================== */
    const hueOpts = Array.prototype.slice.call(menu.querySelectorAll('[data-hue-val]'));
    T(CN, 'R172 色相组九档齐备，档位与 HUE_STOPS 同序',
      hueOpts.length === 9 &&
      hueOpts.map(function (o) { return o.getAttribute('data-hue-val'); }).join(',') ===
        '184,217,250,285,330,350,25,38,145',
      hueOpts.map(function (o) { return o.getAttribute('data-hue-val'); }).join(','));

    T(CN, 'R172b 色相组默认选中紫（285，v4.5.0 新出厂色），且组内唯一选中',
      (function () {
        const on = menu.querySelectorAll('[data-hue-val][aria-checked="true"]');
        return on.length === 1 && on[0].getAttribute('data-hue-val') === '285';
      })(),
      menu.querySelectorAll('[data-hue-val][aria-checked="true"]').length + ' 项选中');

    /* 点第 5 档（品红 330）：应立即写 --hue、落存储、迁移选中态。
       ⚠ 先重开面板 —— 上一条 R170x 刚把它收起，不重开的话
       "保持展开"这条断言的前提根本不成立（会假红）。
       ⚠ pink 判空：色相组若被删空，这里要**报红**而不是让 case 崩
       （崩溃≠报红 —— 同一个坑在 38 号已踩过一次，这里预先堵住）。 */
    trigger.click();
    await new Promise(r => setTimeout(r, 40));
    const pink = menu.querySelector('[data-hue-val="330"]');
    if (pink) pink.click();
    await new Promise(r => setTimeout(r, 60));
    T(CN, 'R172c 点击色相档立即生效（写 --hue + 落存储 + 选中态迁移）',
      !!pink &&
      ctx.doc.documentElement.style.getPropertyValue('--hue') === '330' &&
      ctx.w.localStorage.getItem('neon_hue') === '330' &&
      pink.getAttribute('aria-checked') === 'true' &&
      pink.classList.contains('is-on'),
      '--hue=' + ctx.doc.documentElement.style.getPropertyValue('--hue') +
      ' store=' + ctx.w.localStorage.getItem('neon_hue'));

    T(CN, 'R172d 色相切换后面板保持展开（试色是连续行为，不该被打断）',
      !menu.hasAttribute('hidden'), 'hidden=' + menu.hasAttribute('hidden'));

    /* 键盘：焦点在色相组内 → 方向键只在这一组里走，不串到明度组 */
    try { if (pink) pink.focus(); } catch (e) { /* 忽略 */ }
    const hueArrow = new ctx.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    if (ctx.doc.activeElement) ctx.doc.activeElement.dispatchEvent(hueArrow);
    await new Promise(r => setTimeout(r, 60));
    T(CN, 'R172e 色相组内方向键换档（330 → 350），且不串门到明度组',
      ctx.doc.documentElement.style.getPropertyValue('--hue') === '350' &&
      ctx.doc.documentElement.getAttribute('data-theme') === 'dark',
      '--hue=' + ctx.doc.documentElement.style.getPropertyValue('--hue') +
      ' theme=' + ctx.doc.documentElement.getAttribute('data-theme'));

    const hueCssBody = bodyOf(/^\.theme-hue\[data-hue-val=/);
    T(CN, 'R172f 色卡配色由 CSS 单一来源决定（九条 --sw 规则，不写死进 JS）',
      /--sw:\s*184/.test(hueCssBody) && (hueCssBody.match(/--sw:\s*\d+/g) || []).length === 9 &&
      /hsl\(var\(--sw\)/.test(bodyOf(/^\.theme-hue-dot$/)),
      '色点未走 CSS 变量（--sw 规则 ' + (hueCssBody.match(/--sw:\s*\d+/g) || []).length + ' 条）');

    T(CN, 'R172g 面板由总装函数渲染，明度块与色相块分离（两块各成一组）',
      /function themeMenuHtml/.test(app) &&
      /themeSwapsHtml\(\)/.test(fnBody(app, 'themeMenuHtml')) &&
      /themeHuesHtml\(\)/.test(fnBody(app, 'themeMenuHtml')),
      '未找到 themeMenuHtml 或未复用两个子渲染函数');

    /* ==========================================================
       v3.4.0：色相自由滑杆（九档降级为快捷档）
       ========================================================== */
    if (menu.hasAttribute('hidden')) { trigger.click(); await new Promise(r => setTimeout(r, 40)); }
    const slider = ctx.doc.getElementById('hue-slider');
    const readout = ctx.doc.getElementById('hue-readout');
    T(CN, 'R173 滑杆就位：原生 range（0~359），且**不在** radiogroup 内',
      !!slider && slider.type === 'range' &&
      slider.getAttribute('min') === '0' && slider.getAttribute('max') === '359' &&
      !!readout && !slider.closest('[role="radiogroup"]'),
      slider ? ('type=' + slider.type + ' min=' + slider.getAttribute('min') +
        ' max=' + slider.getAttribute('max') +
        ' inRadiogroup=' + !!slider.closest('[role="radiogroup"]')) : '未找到滑杆');

    /* 拖动：input 事件应**实时**改 --hue（否则滑杆成了盲调），
       且此刻**不落存储** —— 存储留到松手（change）再写。
       ⚠ 必须同时钉住"改了 --hue"和"没写存储"两件事：只查前者的话，
         把拖动改走 setHue（逐帧同步写 localStorage，会把手感拖钝）照样通过。 */
    slider.value = '60';
    slider.dispatchEvent(new ctx.w.Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    T(CN, 'R173b 拖动实时生效（input → --hue 立刻变，但**不写存储**）',
      ctx.doc.documentElement.style.getPropertyValue('--hue') === '60' &&
      ctx.w.localStorage.getItem('neon_hue') !== '60',
      '--hue=' + ctx.doc.documentElement.style.getPropertyValue('--hue') +
      ' store=' + ctx.w.localStorage.getItem('neon_hue'));

    slider.dispatchEvent(new ctx.w.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    T(CN, 'R173c 松手落存储（change → 写入拖动结果）',
      ctx.w.localStorage.getItem('neon_hue') === '60',
      'store=' + ctx.w.localStorage.getItem('neon_hue'));

    T(CN, 'R173d 读数同步（output 显示度数 + aria-valuetext 供读屏）',
      !!readout && readout.textContent === '60°' &&
      slider.getAttribute('aria-valuetext') === '60 度',
      readout ? readout.textContent + ' / ' + slider.getAttribute('aria-valuetext') : '(无读数)');

    /* ★ 键盘不能被抢：滑杆上的方向键必须交给原生（增减 1 度），
       若被"组内换档"劫持，滑杆就成了只能鼠标拖的控件。
       jsdom 不实现 range 的原生方向键 ⇒ "值未变"恰好证明**我们没劫持它**。 */
    const beforeSlider = ctx.doc.documentElement.style.getPropertyValue('--hue');
    const themeBeforeSlider = ctx.doc.documentElement.getAttribute('data-theme');
    try { slider.focus(); } catch (e) { /* 忽略 */ }
    const arrowOnSlider = new ctx.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    if (ctx.doc.activeElement) ctx.doc.activeElement.dispatchEvent(arrowOnSlider);
    await new Promise(r => setTimeout(r, 60));
    T(CN, 'R173e 滑杆上的方向键不被「组内换档」抢走（值不变＝未被劫持）',
      ctx.doc.documentElement.style.getPropertyValue('--hue') === beforeSlider &&
      ctx.doc.documentElement.getAttribute('data-theme') === themeBeforeSlider,
      '--hue=' + ctx.doc.documentElement.style.getPropertyValue('--hue') +
      ' theme=' + ctx.doc.documentElement.getAttribute('data-theme'));

    T(CN, 'R173f 九档快捷仍在（滑杆与色卡并存：自由 + 一键）',
      menu.querySelectorAll('[data-hue-val]').length === 9,
      menu.querySelectorAll('[data-hue-val]').length + ' 档');

    ctx.dom.window.close();
  }

  /* ==========================================================
     ② 按钮对向充能光条
     ========================================================== */
  {
    const CN = 'U2 充能光条';
    const afterRules = rules.filter(function (r) { return /^\.btn::after$/.test(r[0].trim()); });
    const afterBody = afterRules.map(function (r) { return r[1]; }).join('\n');

    /* ★ 核心：两条光条来自**两个 background 层**，不是两个伪元素。
       ::before 已被取景框占用（R104 守着），.btn 的调用点又遍布各视图，
       再插一个 <span> 要改十几处模板 —— 故必须零新增 DOM。
       钉"恰好 2 条 linear-gradient"而不是"存在 background-image"，
       否则单层实现也能绿（字面假绿）。 */
    T(CN, 'R171 .btn::after 用两个背景层实现双光条（零新增 DOM）',
      afterRules.length === 1 &&
      (afterBody.match(/linear-gradient\(/g) || []).length === 2 &&
      /background-size/.test(afterBody) && /background-position/.test(afterBody),
      '渐变层数 ' + (afterBody.match(/linear-gradient\(/g) || []).length);

    /* 对向的判据：两条光条锚定**对角**，才会一条向右一条向左合拢。
       同角锚定会变成两条平行向右 —— 那就不是"对向充能"了。 */
    T(CN, 'R171b 两条光条锚定对角（0 0 / 100% 100%）→ 上缘向右、下缘向左合拢',
      /background-position:\s*0\s+0,\s*100%\s+100%/.test(afterBody),
      afterBody.replace(/\s+/g, ' ').slice(0, 140));

    T(CN, 'R171c 静止态两条光条宽度为 0（不可见，不干扰常态）',
      /background-size:\s*0%\s+2px,\s*0%\s+2px/.test(afterBody) && /opacity:\s*0/.test(afterBody),
      afterBody.replace(/\s+/g, ' ').slice(0, 140));

    const hm = hoverBlk.match(/\.btn:hover:not\(:disabled\)::after\s*\{([^}]*)\}/);
    T(CN, 'R171d hover 时两条光条同时充能到 52%（在 @media(hover:hover) 内）',
      !!hm && /background-size:\s*52%\s+2px,\s*52%\s+2px/.test(hm[1]) && /opacity:\s*1/.test(hm[1]),
      hm ? hm[1].replace(/\s+/g, ' ') : 'hover 块内未找到 ::after 充能规则');

    /* currentColor 派生 —— 四个 .btn 变体（cyan/magenta/yellow/ghost）自动适配，
       不必为每个变体重写一次光条颜色。 */
    T(CN, 'R171e 光条颜色由 currentColor 派生（四个变体自动适配）',
      (afterBody.match(/linear-gradient\(currentColor,\s*currentColor\)/g) || []).length === 2,
      'currentColor 渐变数 ' + (afterBody.match(/linear-gradient\(currentColor,\s*currentColor\)/g) || []).length);

    /* 用 transition 而非 animation：移开鼠标时光条会**反向收回**（有放电回程），
       animation + forwards 只能停在终点、移开即消失。 */
    T(CN, 'R171f 充能走 transition 且时长收敛到 --t-*（可反向收回，无裸时长）',
      /transition:[^;}]*var\(--t-/.test(afterBody) &&
      !/transition:[^;}]*?(?<![\w-])\d*\.?\d+s(?![a-z])/.test(afterBody),
      afterBody.replace(/\s+/g, ' ').slice(0, 160));

    /* 旧实现必须真的清干净 —— 留着就是"斜光 + 光条"两套效果打架 */
    T(CN, 'R171g 旧的斜光扫过已彻底移除（skewX / left:-80% / 105deg 渐变）',
      !/skewX/.test(afterBody) && !/left:\s*-80%/.test(css) && !/105deg/.test(afterBody),
      '仍有旧斜光残留');

    /* 取景框不能被这次改动带崩（R104 已守，这里从本次改动视角再确认一次） */
    const beforeBody = bodyOf(/^\.btn::before$/);
    T(CN, 'R171h 双层取景框未被破坏（::before 仍 clip-path:inherit + pointer-events:none）',
      /clip-path\s*:\s*inherit/.test(beforeBody) && /pointer-events\s*:\s*none/.test(beforeBody),
      beforeBody ? '::before 被改坏' : '未找到 .btn::before');

    T(CN, 'R171i 减少动效下光条瞬时到位（走全局 transition-duration 归零）',
      /\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition-duration:\s*0\.001ms/.test(rmBlk),
      'reduce 未全局归零过渡');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v2.9.4 Uiverse 借法" };

standalone(module, run);
