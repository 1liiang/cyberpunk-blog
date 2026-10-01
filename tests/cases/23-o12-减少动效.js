'use strict';
/* ============================================================
   tests/cases/23-o12-减少动效.js — O12 减少动效
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L1884-2002
   独立运行：node tests/cases/23-o12-减少动效.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, stripComments, cssBlockAt } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ---- O12：C13 尊重 prefers-reduced-motion ---- */
  {
    const cssRaw = SRC.css || '';
    /* 同 O11：注释里会大段说明"为什么这么做"，扫之前一律剥注释 */
    const cssBare = stripComments(cssRaw);

    /* --- 静态结构：块必须存在，且必须在文件末尾（靠层叠顺序覆盖前文） --- */
    const rmIdx = cssBare.indexOf('@media (prefers-reduced-motion: reduce)');
    T('O12 减少动效', 'R66 CSS 含 @media (prefers-reduced-motion: reduce) 块',
      rmIdx !== -1, rmIdx === -1 ? '未找到' : 'offset ' + rmIdx);
    T('O12 减少动效', 'R66b 该块位于样式表末尾（层叠顺序才能压过前面的规则）',
      rmIdx !== -1 && rmIdx > cssBare.length * 0.8,
      rmIdx === -1 ? '未找到' : Math.round(rmIdx / cssBare.length * 100) + '% 处');

    /* 截出该块内容，后面的断言只在这个块内找 —— 否则会误命中块外的同名规则 */
    /* D3：花括号配平统一走 common.js 的 cssBlockAt（O13/O17 共用同一份实现）。
       原实现在这里内联了一遍 —— 拆分后若各写各的，判据漂移无人察觉。 */
    const block = rmIdx !== -1 ? cssBlockAt(cssBare, rmIdx) : '';

    /* --- 块内必须真的关掉了方案点名的几项动画 ---
       注意：不能只断言"块存在"。整块写空 `{}` 也能过第一层，
       故逐项断言关键属性确实出现在【块内】。 */
        /* v3.6.1：'R66c —— 其守卫对象（氛围层）已整体移除，断言作废。 */
    /* v3.4.0 批 A：这条原本钉的是「加载跑马灯在 reduce 下停动」。
       审计发现 `.loading-bar` 早已没有任何 JS/HTML 生成它（死样式），
       而 reduce 块里还为它留着一段关闭规则 —— 那会让后人以为它还在用。
       批 A 把样式与关闭规则一并删除，判据随之升级为更强的形态：**防回流**。
       保留原编号（R66d）以维持"减少动效点名了哪几项"的序列完整。 */
    T('O12 减少动效', 'R66d 旧加载跑马灯已整体移除（含 reduce 内关闭规则，防回流）',
      !/\.loading-bar/.test(cssBare) && !/loading-scan/.test(cssBare),
      /\.loading-bar/.test(cssBare) ? '样式仍在' : '已移除');
    T('O12 减少动效', 'R66e 打字光标闪烁被停（.type-cursor → animation:none）',
      /\.type-cursor::after\s*\{[^}]*animation:\s*none/.test(block));
    T('O12 减少动效', 'R66f Logo 故障抖动被停（.logo:hover .logo-mark → animation:none）',
      /\.logo:hover\s+\.logo-mark[^{]*\{[^}]*animation:\s*none/.test(block));
    T('O12 减少动效', 'R66g 三档时长变量在块内归零（--t-fast/normal/slow）',
      /--t-fast:\s*0\.001ms/.test(block) &&
      /--t-normal:\s*0\.001ms/.test(block) &&
      /--t-slow:\s*0\.001ms/.test(block));
    T('O12 减少动效', 'R66h 通配兜底把 transition-duration 全局归零',
      /\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition-duration:\s*0\.001ms/.test(block));
    T('O12 减少动效', 'R66i 平滑滚动改回瞬时（html → scroll-behavior:auto）',
      /html\s*\{[^}]*scroll-behavior:\s*auto/.test(block));

    /* --- 反向保护：不能把 fadein 之类"承担可见性职责"的动画整个 none 掉 ---
       @keyframes fadein 的 to 才是 opacity:1；若把 .post-card 的 animation
       置为 none，元素会停在初始的 opacity:0 = 内容永久不可见。
       故此处【禁止】出现 `.post-card { ... animation: none }` 这种写法。 */
    T('O12 减少动效', 'R66j 位移动画只压时长不禁用（避免元素停在 opacity:0）',
      !/\.post-card\s*\{[^}]*animation:\s*none/.test(block) &&
      !/\.toast\s*\{[^}]*animation:\s*none/.test(block) &&
      !/\.modal\s*\{[^}]*animation:\s*none/.test(block));
    T('O12 减少动效', 'R66k 位移动画确有压缩时长与次数（.post-card/.modal/.toast）',
      /\.post-card,\s*\.modal,\s*\.toast,\s*\.toast\.hide\s*\{[^}]*animation-duration/.test(block));

    /* --- 全局副作用守卫：该块不得削弱主题变量表 ---
       同理于 O11 的教训：不能为了停动画把亮色变量一起删掉。 */
    T('O12 减少动效', 'R66l 该块未误伤主题变量表（亮色 --bg-0 仍在块外）',
      /html\[data-theme="light"\]\s*\{[\s\S]*?--bg-0:\s*#eef2f8/.test(cssBare) &&
      !/--bg-0/.test(block));

    /* --- 全站时长收敛：transition 不应再有裸写的 .x s 时长（除 0.001ms 兜底） --- */
    const bareDurations = (cssBare.match(/transition:[^;}]*?(?<![\w-])\d*\.?\d+s(?![a-z])/g) || []);
    T('O12 减少动效', 'R66m 正文 transition 时长已全部收敛到 --t-* 变量',
      bareDurations.length === 0,
      bareDurations.length ? bareDurations.slice(0, 2).join(' | ') : '无裸时长');

    /* --- 变量本身必须存在（收敛的前提） --- */
    const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(cssBare);
    const rootVars = rootBlock ? rootBlock[1] : '';
    T('O12 减少动效', 'R66n :root 定义了 --t-fast/--t-normal/--t-slow 三档',
      /--t-fast:/.test(rootVars) && /--t-normal:/.test(rootVars) && /--t-slow:/.test(rootVars));

    /* --- 运行时：块内规则能被真实 CSS 引擎解析（不是靠正则自欺） ---
       正则能验证"文本里有这些字样"，但验证不了"浏览器真能读懂它"——
       一个漏掉的括号就会让整块规则被引擎静默丢弃，而正则照样全绿。
       故这里把块交给 jsdom 的真实 CSS 解析器，读回子规则数与选择器。

       ⚠ 踩坑记录（实测得出）：jsdom 解析器遇到**孤立的 `}`**（未配对的闭合括号）
       会把后续所有内容降级成普通 CSSStyleRule —— 即 `{ display:none }` 被当成声明
       而不是规则体。而 stripComments() 剥走注释后，`@media` 前面恰好残留着
       上一条规则的 `}` 与空白。直接把 `slice(i, end+1)`（只有块体）喂进去，
       必然报 "Could not parse CSS stylesheet"。
       故这里【从块体的第一个块内容开始构造】，前面不携带任何前导括号。
       注意 jsdom 只解析样式表；@media 是否命中（媒体特性）不在此覆盖范围 ——
       本条守的是"语法可解析"，不是"媒体查询生效"。 */
    {
      const c = bootDom({});
      const style = c.doc.createElement('style');
      /* block 是 `{...}` 形态，前缀上 @media 条件即可得到语法完整的样式表，
         不带任何前导 `}`，避免触发上面那个降级行为。 */
      style.textContent = '@media (prefers-reduced-motion: reduce) ' + block;
      c.doc.head.appendChild(style);

      /* 只认我们自己刚插入的这张表，避免被 head 里已有的样式干扰 */
      let mediaRule = null;
      try {
        const sheets = c.doc.styleSheets;
        for (let i = 0; i < sheets.length; i++) {
          const rs = sheets[i].cssRules || [];
          for (let j = 0; j < rs.length; j++) {
            if (rs[j].media && String(rs[j].media.mediaText).indexOf('prefers-reduced-motion') !== -1) {
              mediaRule = rs[j];
              break;
            }
          }
          if (mediaRule) break;
        }
      } catch (e) { /* 解析异常按失败处理，下方断言会报红 */ }

      const inner = mediaRule && mediaRule.cssRules ? Array.prototype.slice.call(mediaRule.cssRules) : [];
      const sels = inner.map(function (r) { return r.selectorText || ''; }).join(' | ');
      T('O12 减少动效', 'R66o 块内容被 CSS 引擎成功解析（无语法错误导致整块丢弃）',
        !!mediaRule && inner.length > 0,
        mediaRule ? inner.length + ' 条子规则' : '未解析出 media 规则');
      /* 更进一步：最关键的几条规则必须真的被引擎认到（不是正则幻觉）。
         v3.4.0 批 A：`.loading-bar` 已作为死样式整体移除，样本换成仍在块内、
         且技术代表性更强的两条 —— 「全屏 blur 压制」（body::before，块内唯一
         带 !important 的一条，注释里记着三层媒体上下文的竞争）与
         「高频闪烁常亮」（.type-cursor::after）。三条样本的形态不变。 */
      /* v3.6.1：样本换成块内仍在的两条 —— 高频闪烁（.type-cursor::after）与
         logo 故障抖动（.logo:hover .logo-mark）。此前用的 .scanlines / body::before
         已随氛围层移除。三条样本的形态（两条具体 + 通配兜底）不变。 */
      T('O12 减少动效', 'R66p 引擎确实认出了 .type-cursor::after / logo 抖动 / 通配兜底三条',
        inner.some(function (r) { return (r.selectorText || '').indexOf('.type-cursor') !== -1; }) &&
        inner.some(function (r) { return (r.selectorText || '').indexOf('.logo') !== -1; }) &&
        inner.some(function (r) { return /^\*/.test(r.selectorText || ''); }),
        sels.slice(0, 120));
      c.dom.window.close();
    }
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O12 减少动效" };

standalone(module, run);
