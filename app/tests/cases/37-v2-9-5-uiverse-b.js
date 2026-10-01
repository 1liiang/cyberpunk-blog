'use strict';
/* ============================================================
   tests/cases/37-v2-9-5-uiverse-b.js — v2.9.5 Uiverse 借法第二批

   三项（当时按"只借技法，不搬组件"做的 —— ⚠ 该约定已于 2026-10-01 取消，
   改为"要搬组件先报备、经站长同意后再落地"，见 HANDOVER §5）：
     ① 双色内发光卡片   · AnthonyPreite/tiny-shrimp-10 → .post-card:hover
     ② 旋转光晕搜索框   · Lakshay-art/curvy-earwig-22  → .search-field::before
     ③ 扫描线霓虹输入框 · MijailVillegas/grumpy-horse-85 → #ed-title 等

   覆盖三层：
     ① 源码结构（js/views.js）—— 搜索框的 .search-field 宿主
     ② 运行时行为（jsdom）—— 搜索页 DOM 层级
     ③ 样式（css/style.css）—— 技法落地 / 主题适配 / reduce / 拒绝搬的部分

   ⚠ 本 case 特有的坑：
     · @property 是**顶层 at-rule**，topLevelRules 会把它当选择器抓出来 ——
       断言时要么专门匹配它，要么确保其它规则的锚点不含 "@property" 前缀。
     · 拒绝搬的两段动画（backglitch / blinkShadowsFilter）必须用**反向断言**
       钉住 —— 否则后人"补全"原组件时会把光敏性风险带回来，且门禁不报红。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments } = require('../common');

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
  const views = SRC.views;
  const rules = topLevelRules(css);
  const rmBlk = mediaBlocks(css, function (c) { return /prefers-reduced-motion/.test(c); })
    .map(function (b) { return b.body; }).join('\n');

  function bodyOf(selRe) {
    return rules.filter(function (r) { return selRe.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
  }

  /* ==========================================================
     ① 双色内发光卡片
     ========================================================== */
  {
    const CN = 'V1 双色内发光卡片';
    const hoverBlk = mediaBlocks(css, function (c) { return /hover\s*:\s*hover/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    const m = hoverBlk.match(/\.post-card:hover\s*\{([^}]*)\}/);
    const body = m ? m[1] : '';

    /* ★ 核心技法是「左右对冲」：一个 inset 用正水平偏移（光从左缘往里渗）、
       一个用负偏移（从右缘往里渗）。只写一层居中 inset 不算对冲 —— 那是普通内发光。 */
    T(CN, 'R175 卡片 hover 有左右对冲的双色 inset 光（正负偏移各一条）',
      (body.match(/inset\s+-?\d+px\s+0\s+/g) || []).length >= 2 &&
      /inset\s+\d+px\s+0/.test(body) && /inset\s+-\d+px\s+0/.test(body),
      body ? body.replace(/\s+/g, ' ').slice(0, 150) : 'hover 块内未找到 .post-card:hover');

    T(CN, 'R175b 双色分别来自 --cyan 与 --magenta（与站点双色对位，非任意配色）',
      /color-mix\(in srgb,\s*var\(--cyan\)/.test(body) &&
      /color-mix\(in srgb,\s*var\(--magenta\)/.test(body),
      '未走主题色变量');

    /* 原组件硬编码 #0ff / #f0f / whitesmoke —— 浅底上会炸出刺眼原色，必须拦住 */
    T(CN, 'R175c 未硬编码霓虹色（三主题下都成立）',
      !/#0ff\b|#f0f\b|whitesmoke|#00f0ff|#ff2a6d/i.test(body),
      body.replace(/\s+/g, ' ').slice(0, 150));

    T(CN, 'R175d 原有的顶部霓虹与落地投影仍在（inset 负责"点亮"，外阴影负责"浮起"）',
      /0\s+14px\s+40px/.test(body) && /0\s+0\s+24px/.test(body),
      '原有外层阴影丢失');

    T(CN, 'R175e hover 规则在 @media(hover:hover) 内（E1 铁律）',
      /\.post-card:hover\s*\{[^}]*box-shadow/.test(hoverBlk),
      '不在 hover 媒体块内');
  }

  /* ==========================================================
     ② 旋转光晕搜索框
     ========================================================== */
  {
    const CN = 'V2 旋转光晕搜索框';

    /* 宿主必须在 views.js 里真实包住输入框（<input> 不支持伪元素） */
    T(CN, 'R176 views.js 用 .search-field 包住搜索输入框（伪元素宿主）',
      /<div class="search-field">/.test(views) &&
      /<div class="search-field">[\s\S]{0,300}id="search-input"/.test(views),
      '未找到 .search-field 宿主');

    /* ⚠ 不注册 @property 的话，keyframes 动自定义属性只会离散跳变（50% 处瞬切），
       没有旋转观感 —— 这是本技法能否成立的关键一行。 */
    T(CN, 'R176b @property 已把 --halo-spin 注册为 <angle>（否则无法插值）',
      /@property\s+--halo-spin\s*\{[^}]*syntax:\s*"<angle>"/.test(css),
      '未注册或语法类型不对');

    const halo = bodyOf(/^\.search-field::before$/);
    T(CN, 'R176c 光晕是双色弧的 conic-gradient，角度由 --halo-spin 驱动',
      /conic-gradient\(\s*from\s+var\(--halo-spin\)/.test(halo) &&
      /var\(--cyan\)/.test(halo) && /var\(--magenta\)/.test(halo),
      halo ? halo.replace(/\s+/g, ' ').slice(0, 140) : '未找到 .search-field::before');

    T(CN, 'R176d 聚焦才点亮并开始旋转（:focus-within 同时给 opacity 与 animation）',
      /\.search-field:focus-within::before\s*\{[^}]*opacity:\s*0?\.?\d+[^}]*animation:\s*halo-spin/.test(css),
      'focus-within 未同时点亮与驱动');

    T(CN, 'R176e @keyframes halo-spin 存在且转满一圈（to = 360deg）',
      /@keyframes\s+halo-spin\s*\{\s*to\s*\{\s*--halo-spin:\s*360deg/.test(css),
      'keyframes 缺失或角度不对');

    /* 非聚焦态必须不可见 —— 否则搜索框永远顶着一圈光，聚焦就失去意义 */
    T(CN, 'R176f 静止态光晕不可见（opacity: 0）',
      /opacity:\s*0;/.test(halo),
      '静止态未隐藏');

    T(CN, 'R176g 减少动效下停转但光晕保留（仍是"此处已聚焦"的指示物）',
      /\.search-field:focus-within::before\s*\{[^}]*animation:\s*none\s*!important/.test(rmBlk) &&
      !/\.search-field[^{]*\{\s*display:\s*none/.test(rmBlk),
      'reduce 未处理或误隐藏');

    /* 输入框本身要撑满宿主 —— flex:1 已交给宿主，输入框改用 width:100% */
    T(CN, 'R176h .search-input 在宿主内撑满（width:100%，flex 交给宿主）',
      /width:\s*100%;/.test(bodyOf(/^\.search-input$/)),
      '输入框未撑满宿主');
  }

  /* ==========================================================
     ② 旋转光晕搜索框：运行时
     ========================================================== */
  {
    const CN = 'V2 旋转光晕搜索框';
    const ctx = bootDom({ url: 'https://x.test/#/search', captureConsole: true });
    await waitFor(function () { return !!ctx.doc.getElementById('search-input'); }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });

    const input = ctx.doc.getElementById('search-input');
    const host = input && input.parentElement;
    T(CN, 'R176i 输入框的父节点就是 .search-field（层级正确，光晕才罩得住）',
      !!host && host.classList.contains('search-field'),
      host ? host.className : 'null');
    T(CN, 'R176j 搜索按钮仍在 .search-bar 直下（未被裹进宿主，光晕不会漏到按钮后面）',
      !!ctx.doc.querySelector('.search-bar > #search-go'),
      '按钮层级变动');
    ctx.dom.window.close();
  }

  /* ==========================================================
     ③ 扫描线霓虹输入框
     ========================================================== */
  {
    const CN = 'V3 扫描线霓虹输入框';
    const base = bodyOf(/^#ed-title,\s*#ed-summary,\s*#ed-tags,\s*#ed-cover$/);
    const root = bodyOf(/^:root$/);

    T(CN, 'R177 编辑器文本输入使用小号切角（--clip-corner-sm）',
      base.length > 0 && /clip-path:\s*var\(--clip-corner-sm\)/.test(base),
      base ? '未套用切角变量' : '未找到 #ed-* 规则');

    /* ⚠ 必须与 --clip-corner 结构对齐（同为 6 顶点的对角切口），
       否则编辑器输入框的"装甲缺口"会和全站切角语言不一致 */
    T(CN, 'R177b --clip-corner-sm 已定义且与 --clip-corner 同构（6 顶点 + 9px 切角）',
      /--clip-corner-sm:\s*polygon\(0 0,\s*calc\(100% - 9px\) 0,\s*100% 9px,\s*100% 100%,\s*9px 100%,\s*0 calc\(100% - 9px\)\)/.test(root),
      '小切角变量缺失或顶点结构不一致');

    T(CN, 'R177c 静态扫描线已铺上（repeating-linear-gradient，青色低透明度）',
      /repeating-linear-gradient\(\s*to bottom/.test(base) &&
      /color-mix\(in srgb,\s*var\(--cyan\)/.test(base),
      base ? '扫描线缺失' : '未找到规则');

    const focus = bodyOf(/^#ed-title:focus,\s*#ed-summary:focus,\s*#ed-tags:focus,\s*#ed-cover:focus$/);
    T(CN, 'R177d 聚焦叠一层自左向右的青色扫光（原组件的 focus 渐变技法）',
      focus.length > 0 && /linear-gradient\(90deg,\s*transparent/.test(focus) &&
      (focus.match(/repeating-linear-gradient/g) || []).length >= 1,
      '聚焦扫光缺失');

    /* ★ 反向断言：原组件有两段**被刻意拒绝**的动画，必须钉住不能被"补全"回来。
       backglitch = 50ms 无限抖动的 inset 阴影（高频闪烁，光敏性癫痫风险）；
       blinkShadowsFilter = 8s 无限跳变的双向大范围 drop-shadow（阅读噪音）。 */
    T(CN, 'R177e 未引入 backglitch 高频抖动动画（光敏性风险，刻意拒绝）',
      !/backglitch/.test(css),
      'backglitch 被搬进来了');
    T(CN, 'R177f 未引入 blinkShadowsFilter 双向跳变阴影（编辑界面久看的噪音）',
      !/blinkShadowsFilter/.test(css),
      'blinkShadowsFilter 被搬进来了');

    /* 范围控制：这套形态只给编辑器，不能顺着 .field 全局铺开 */
    const fieldInput = bodyOf(/^\.field input\[type="text"\],\s*\.field input\[type="email"\],\s*\.field input\[type="password"\],\s*\n?\.field textarea,\s*\.field select$/);
    T(CN, 'R177g 通用 .field 输入未被打上切角（登录框/标签管理保持原样）',
      fieldInput.length === 0 || !/clip-path/.test(fieldInput),
      '.field 全局被改，改动范围失控');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v2.9.5 Uiverse 借法二" };

standalone(module, run);
