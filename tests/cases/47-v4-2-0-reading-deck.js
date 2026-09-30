'use strict';
/* ============================================================
   tests/cases/47-v4-2-0-reading-deck.js — v4.2 B3「阅读舱」

   ① 终端阅读框：工具条（读数 + 行号开关）+ 行号 gutter（counter 机制）
   ② 编辑级叙事：byline 呼吸 / lead 衬线首段 / 章节 hairline（Wired 转译）
   ③ TOC 迷你地图：章节长度条（--seg）+ 游标（随活跃章节移动）
   ④ 归档时间线：年份牌（描边字）+ 发光轴 + 月份节点
   ⑤ 证件档案化：FILE 编号（01~04）+ 翻阅点亮

   ⚠ 行号与既有装饰的边界（R224）：blockquote 有自己的引号装饰（O17 R78k），
     不参与行号计数 —— 两条伪元素语言必须互不干扰。
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

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);
  const views = SRC.views;
  const app = stripComments(SRC.app);

  /* ================= ① 终端阅读框 ================= */
  {
    const CN = 'v4.2 阅读舱';
    const postBody = fnBody(views, 'postView');

    T(CN, 'R220 终端阅读框：工具条三件（解码标签 + 读数 + 行号开关）',
      /class="reading-frame"/.test(postBody) &&
      /class="rf-bar"/.test(postBody) &&
      /rf-tag/.test(postBody) && /rf-stats/.test(postBody) &&
      /id="ln-toggle"[^>]*aria-pressed="true"/.test(postBody),
      '阅读框结构缺项');

    /* 读数在服务端渲染阶段从 renderedMd 算出（零 DOM 依赖、不 await 网络）。
       ⚠ renderedMd 需防御兜底（|| ''）—— 29 号等以不完整 state 调 postView，
       缺兜底会直接抛错（实测踩过，见 v4.2 发布日志）。 */
    T(CN, 'R220b 读数（段数/字数）从 renderedMd 本地算出（含兜底），零网络',
      /state\.renderedMd \|\| ''/.test(postBody) &&
      /blockCount/.test(postBody) && /charCount/.test(postBody) &&
      /\.match\(\/<\[?\(p\|h2\|h3\|ul\|ol\|pre\|blockquote\)/.test(postBody) &&
      /replace\(\/<\[\^>\]\*>\/g/.test(postBody) &&
      !/await|need\(/.test(postBody),
      '读数算法缺项或引入网络调用');

    T(CN, 'R220c 行号 CSS 机制：counter 六类块 + ::before 进左侧 gutter',
      /\.md-body\s*\{\s*counter-reset:\s*mdline/.test(css) &&
      /counter-increment:\s*mdline/.test(css) &&
      /content:\s*counter\(mdline,\s*decimal-leading-zero\)/.test(css) &&
      /left:\s*-38px/.test(css),
      '行号机制缺项');

    T(CN, 'R220d 行号开关：body:not(.linenum-off) 前缀 + 关闭态归零 gutter',
      /body:not\(\.linenum-off\)\s*\.md-body\s*\{\s*padding-left:\s*38px/.test(css),
      '开关前缀缺失');

    T(CN, 'R220e 开关接线：localStorage 记忆 + aria-pressed 同步 + 类切换 + 渲染后挂载',
      /function bindLineNumbers/.test(app) &&
      /neon_linenum/.test(app) &&
      /classList\.toggle\('linenum-off'/.test(app) &&
      /setAttribute\('aria-pressed'/.test(app) &&
      /* ⚠ 必须钉"调用点"（挂在 renderPost 的 DOM 落地行里）——
         只查函数定义会漏掉"忘了调用"（函数在、按钮永远不响应），
         反向验证实测：删调用后仅行为断言 R225b 抓住，源码层应同步挡住。 */
      /if \(post\) \{[^}]*bindLineNumbers\(\)/.test(app),
      '开关接线缺项');

    /* Wired 转译的三条叙事语法 */
    T(CN, 'R220f 编辑级叙事：byline 上下 hairline / lead 首段衬线 / h2 章节分隔线',
      /\.post-meta\s*\{[^}]*border-top:\s*1px solid/.test(css) &&
      /\.post-meta\s*\{[^}]*border-bottom:\s*1px solid/.test(css) &&
      /\.md-body > p:first-child\s*\{[^}]*var\(--font-serif-cn\)/.test(css) &&
      /\.md-body > h2\s*\{[^}]*border-top:/.test(css),
      '叙事语法缺项');
  }

  /* ================= ② TOC 迷你地图 ================= */
  {
    const CN = 'v4.2 阅读舱';
    /* ⚠ 用剥注释后的体：R221b 的"初调紧随 observer"检查会被长注释撑爆字符窗口
       （实测：新加的 4 行注释让两段代码间距超过上限）——判据只该看代码本身。 */
    const tocBody = stripComments(fnBody(SRC.app, 'buildToc'));

    T(CN, 'R221 迷你地图：章节长度条（--seg 由高度占比算出并夹取）',
      /--seg:/.test(tocBody) &&
      /getBoundingClientRect\(\)\.top/.test(tocBody) &&
      /Math\.max\(6,\s*Math\.min\(100/.test(tocBody) &&
      /toc-bar/.test(tocBody),
      '长度条算法缺项');

    T(CN, 'R221b 游标：元素 + 随活跃章节更新 top + 增强路径的初始调用（对齐降级路径）',
      /toc-cursor/.test(tocBody) &&
      /cursor\.style\.top/.test(tocBody) &&
      /* ⚠ v4.2.1：observer 只对交叉变化发事件 —— 直接访问页面时若无进出视野，
         setTocActive 一次都不会被调用（游标滞留默认位）。增强路径必须有初调，
         与降级路径的 onScroll() 初调对称。 */
      /observer\.observe\(it\.el\)[\s\S]{0,220}setTocActive\(items\[0\]\.id\)/.test(tocBody) &&
      /\.toc-cursor\s*\{[^}]*transition:\s*top var\(--t-normal\)/.test(css) &&
      /\.toc\s*\{\s*position:\s*relative/.test(css),
      '游标缺项或增强路径无初始调用');

    T(CN, 'R221c 游标骑在左轨上（left 对齐 border 轨道）+ 长度条按层级缩进',
      /\.toc-cursor\s*\{[^}]*left:\s*-3px/.test(css) &&
      /\.toc-lv3 \.toc-bar\s*\{\s*margin-left:\s*24px/.test(css),
      '轨道对位缺项');
  }

  /* ================= ③ 归档时间线 ================= */
  {
    const CN = 'v4.2 阅读舱';
    const archBody = fnBody(views, 'archiveView');

    T(CN, 'R222 年份牌：label 前四位取年 + 变化时插入 + aria-hidden（信息不重复）',
      /String\(g\.label \|\| ''\)\.slice\(0,\s*4\)/.test(archBody) &&
      /archive-year"[^>]*aria-hidden="true"/.test(archBody) &&
      /lastYear/.test(archBody),
      '年份标逻辑缺项');

    T(CN, 'R222b 时间线轴 + 月份节点 + 描边年份牌（全色相派生）',
      /\.archive-main\s*\{[^}]*padding-left:\s*30px/.test(css) &&
      /\.archive-main::before/.test(css) &&
      /\.archive-month::after\s*\{[^}]*border-radius:\s*50%/.test(css) &&
      /\.archive-year\s*\{[^}]*text-stroke:\s*1px hsl\(var\(--hue\)/.test(css),
      '时间线视觉缺项');
  }

  /* ================= ④ 证件档案化 ================= */
  {
    const CN = 'v4.2 阅读舱';

    T(CN, 'R223 四张档案卡各带 FILE 编号（01~04，aria-hidden 装饰）',
      ['FILE 01', 'FILE 02', 'FILE 03', 'FILE 04'].every(function (n) {
        return views.indexOf('about-file" aria-hidden="true">' + n) !== -1;
      }),
      '编号不全');

    T(CN, 'R223b 翻阅点亮（view timeline）+ reduce 停用',
      /@supports \(animation-timeline: view\(\)\)/.test(css) &&
      /\.about-card\s*\{\s*animation:\s*block-light/.test(css) &&
      /\.about-card\s*\{\s*animation:\s*none\s*!important/.test(css),
      '点亮或 reduce 缺项');
  }

  /* ================= ⑤ 边界：行号与引号装饰互不干扰 ================= */
  {
    const CN = 'v4.2 阅读舱';
    const incSel = (/counter-increment:\s*mdline;/.source, css);
    /* 参与计数（也就意味着会出现行号 ::before）的选择器清单里不得含 blockquote */
    const incBlock = (/\.md-body > p,[\s\S]*?counter-increment:\s*mdline;/.exec(css) || [''])[0];

    T(CN, 'R224 blockquote 不参与行号（它的 ::before 保留给装饰引号，O17 R78k）',
      incBlock.length > 0 &&
      !/> blockquote/.test(incBlock) &&
      !/\.md-body > blockquote/.test(css) &&
      /\.md-body blockquote::before/.test(css),
      '行号与引号装饰的边界被破坏');
  }

  /* ================= ⑥ 行为（jsdom 真渲染） ================= */
  {
    const CN = 'v4.2 阅读舱';

    /* 详情页：阅读框 + 行号开关 + TOC 迷你地图 */
    const ctx = bootDom({ url: 'https://x.test/#/post/1' });
    await waitFor(function () { return !!ctx.doc.querySelector('.md-body'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 300); });

    T(CN, 'R225 详情页渲染：阅读框 + 行号按钮 + 迷你地图（TOC 显示时游标必须就位）',
      !!ctx.doc.querySelector('.reading-frame') &&
      !!ctx.doc.getElementById('ln-toggle') &&
      /* ⚠ fixture 文章可能不足 2 个标题 ⇒ TOC 隐藏（设计如此）——
         此时不强求游标；TOC 一旦显示，游标必须在。 */
      (function () {
        var tocEl = ctx.doc.getElementById('post-toc');
        if (!tocEl) return false;
        return tocEl.hidden ? true : !!tocEl.querySelector('.toc-cursor');
      })(),
      '阅读框或迷你地图未渲染');

    /* 行号开关的交互（程序化点击 = jsdom 的 click()，与真实点击走同一监听） */
    var btn = ctx.doc.getElementById('ln-toggle');
    var offBefore = ctx.doc.body.classList.contains('linenum-off');
    btn.click();
    var offAfter = ctx.doc.body.classList.contains('linenum-off');
    T(CN, 'R225b 点击行号开关：类切换 + aria-pressed 翻转 + 写入 localStorage',
      offAfter !== offBefore &&
      btn.getAttribute('aria-pressed') === (offAfter ? 'false' : 'true') &&
      ctx.w.localStorage.getItem('neon_linenum') === (offAfter ? '0' : '1'),
      'off: ' + offBefore + '→' + offAfter);
    ctx.dom.window.close();

    /* 归档页：年份牌 */
    const ctx2 = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return !!ctx2.doc.querySelector('.archive-group'); }, 5000);
    T(CN, 'R225c 归档页渲染年份牌（去重：每年一块）',
      (function () {
        var years = ctx2.doc.querySelectorAll('.archive-year');
        if (!years.length) return false;
        var texts = Array.prototype.map.call(years, function (y) { return y.textContent; });
        return new Set(texts).size === texts.length;   /* 每年只出现一次 */
      })(),
      ctx2.doc.querySelectorAll('.archive-year').length + ' 块年份牌');
    ctx2.dom.window.close();

    /* 证件页：FILE 编号 */
    const ctx3 = bootDom({ url: 'https://x.test/#/about' });
    await waitFor(function () { return !!ctx3.doc.querySelector('.about-card'); }, 5000);
    T(CN, 'R225d About 页渲染四张档案卡的 FILE 编号',
      ctx3.doc.querySelectorAll('.about-file').length === 4,
      ctx3.doc.querySelectorAll('.about-file').length + ' 张卡带编号');
    ctx3.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v4.2 阅读舱：阅读框/迷你地图/档案" };

standalone(module, run);
