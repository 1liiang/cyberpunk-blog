'use strict';
/* ============================================================
   tests/cases/40-v3-1-0-home-bento.js — v3.1.0 B2 首页 Hero + bento
   （v4.1 B2 街区化迁移：bento → district / 模块 → 街块 / 错峰 → 沿街点亮）

   ① 源码结构：homeView 分流（首页街区 / 标签页列表）、Hero 字标、六街块、入场双路径
   ② 行为：首页真的渲染出 Hero + 街区；标签页仍是列表；卡片与加载更多仍可用
   ③ 兼容：既有结构（.page-head / .post-list / .post-card / #btn-load-more）保留

   ⚠ 本 case 特有的一条判据：**首页与标签页必须是两种形态**。
     很容易写成"全站都街区"（少一个 if），那样 #/tag/x 会从"连续列表"
     变成"六格网格"——用户去标签页是找东西，不是逛站台。
   ⚠ v4.1 迁移时的教训：断言里的 fnBody(views, '函数名') 一旦函数改名返回空串，
     **"未出现 X"类否定断言会对空串假绿**（R185h 就差点如此）——
     迁移时务必先确认 fnBody 拿到的体非空（本文件 R185e 的 info 会显示体长）。
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
  const rules = topLevelRules(css);
  const views = SRC.views;
  const rmBlk = mediaBlocks(css, function (c) { return /prefers-reduced-motion/.test(c); })
    .map(function (b) { return b.body; }).join('\n');
  const prBlk = mediaBlocks(css, function (c) { return /\bprint\b/.test(c); })
    .map(function (b) { return b.body; }).join('\n');

  function bodyOf(selRe) {
    return rules.filter(function (r) { return selRe.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
  }

  /* ================= ① 源码结构 ================= */
  {
    const CN = 'B2 首页街区';

    /* ★ 核心判据：两种形态分流。少了这个 if，标签页会被一起 bento 化。
       拆成两条独立断言 —— 红的时候能一眼看出是"首页没走新形态"
       还是"标签页被误改"，不必再猜。 */
    const homeBody = fnBody(views, 'homeView');
    T(CN, 'R185 homeView 按页型分流：首页走 Hero + 街区（v4.1 起）',
      /if \(!state\.tagName\) \{/.test(homeBody) &&
      /return heroHtml\(state\) \+ districtHtml\(state\);/.test(homeBody),
      homeBody ? '首页分支缺失' : '未找到 homeView');

    T(CN, 'R185a 标签页分支仍是连续列表（未被 bento 化）',
      /* v3.5.2：标签页 h1 由 `TAG //` 改为中文 `标签 //`，识别标志跟着改 */
      /标签 \/\/ /.test(homeBody) &&
      /'<div class="post-list">' \+ posts\.map\(postCard\)/.test(homeBody),
      '标签页列表分支被改写');

    const heroBody = fnBody(views, 'heroHtml');
    const wmBody = fnBody(views, 'wordmarkSvg');
    /* v4.1：主视觉从文字标题升级为霓虹字标 —— 单字母强调（.hl）随之迁移：
       主路径 = 字标里 R 单独高亮（动态生成，恰一处）；降级路径 = 文字标题里的
       .hl（数据缺失时用）。两条路径互斥，合起来仍保证"整屏恰一处强调"。 */
    T(CN, 'R185b Hero 主视觉 = 霓虹字标（R 单字母强调恰一处）+ MODULE 00 编号',
      /class="hl"/.test(heroBody) &&
      (heroBody.match(/class="hl"/g) || []).length === 1 &&
      /MODULE 00/.test(heroBody) &&
      /hero-scroll/.test(heroBody) &&
      /wordmarkSvg\(\)/.test(heroBody) &&
      /g\.char === 'R'/.test(wmBody) &&
      (wmBody.match(/'\s*hl'/g) || []).length === 1,
      '字标接线 ' + (/wordmarkSvg\(\)/.test(heroBody) ? 'OK' : '缺失') +
        ' / 降级 .hl ' + (heroBody.match(/class="hl"/g) || []).length + ' 处');

    /* ⚠ hash 路由陷阱：本站任何 #xxx 都会被 parseHash 当路由解析
       （#bento → 未知路由 → 404 视图）。滚动引导只能是提示，不能是锚点。
       ⚠ 判据必须跑在**剥注释后**的函数体上 —— heroHtml 的注释里正解释着
       "为什么不用 <a href=\"#bento\">"，不剥注释会被自己写的说明文字命中（假红）。
       同一个坑在 R170b（themeSwapsHtml 的 <input> 注释）上踩过。 */
    const heroCode = stripComments(heroBody);
    T(CN, 'R185c Hero 内的滚动引导不是 # 锚点（否则会被当成路由跳转）',
      !/href="#[a-z]/i.test(heroCode),
      /href="#[a-z]/i.test(heroCode) ? '出现了 # 锚点' : '无锚点');

    T(CN, 'R185d Hero 复用 .page-head（全站页头装饰与判据的挂载点）',
      /class="page-head"/.test(heroBody),
      '未复用 .page-head');

    const districtBody = fnBody(views, 'districtHtml');
    T(CN, 'R185e 街区输出六个街块（data-block 01~06 + 灯牌招牌）',
      ['01', '02', '03', '04', '05', '06'].every(function (n) {
        return new RegExp("data-block=\"" + n + "\"").test(views);
      }) && /blockSign\('01'/.test(districtBody),
      '街块编号不全（districtHtml 体长 ' + districtBody.length + '）');

    T(CN, 'R185f 跨度分配：精选通栏 / 信号流 8 / 街角与广场 4（12 列制）',
      /block block-featured" data-block="01"/.test(districtBody) &&
      /block block-stream" data-block="02"/.test(districtBody) &&
      /* ⚠ 街角/广场的跨度类出现在 statModule / tagModule / monthModule / idCardModule
         等**被调用的函数体**里，不在 districtHtml 体里 —— 扫 districtBody 会假红。
         故这一项扫全文件（它们合起来才是"六个街块"的完整定义）。 */
      /class="block block-stat"/.test(views),
      '跨度分配不符');

    /* 精选卡是"单张"，不该套 .post-list（那会让 .post-list 出现两次，
       而既有断言里"取第一个 .post-list"的读法会拿到只有一张卡的那个） */
    T(CN, 'R185g 精选卡不套 .post-list（保持 .post-list 唯一）',
      (districtBody.match(/class="post-list"/g) || []).length === 1 &&
      /block-featured"[^]*postCard\(featured\)/.test(districtBody),
      'post-list 出现 ' + (districtBody.match(/class="post-list"/g) || []).length + ' 次');

    /* 面板渲染绝不 await 网络（项目铁律）：新模块的数据必须全部来自已加载的 posts。
       ⚠ 判据跑在**剥注释后**的体上 —— 实现注释里就在解释"数据全部本地聚合"，
       不剥注释会被自己的说明命中（假红）。
       ⚠ v4.1：函数改名后 fnBody 若拿到空串，本条的否定半句会对空串假绿 ——
       故 info 里回显体长供人工复核（正整数即正常）。 */
    T(CN, 'R185h 街区数据全部本地聚合（不新增网络请求）',
      districtBody.length > 100 &&
      !/await|need\(/.test(stripComments(districtBody)) &&
      /localTagStats/.test(views) && /monthStats/.test(views),
      'districtHtml 体长 ' + districtBody.length + '（应为正）');

    T(CN, 'R185i 加载更多按钮仍在（结构迁移后功能未丢）',
      /id="btn-load-more"/.test(districtBody),
      '缺少 #btn-load-more');

    /* 兼容三件套：迁移期间既要新结构，也不能砸掉旧判据 */
    T(CN, 'R185j 兼容：.page-head / .post-list / .post-card 三者全部保留',
      /class="page-head"/.test(views) && /class="post-list"/.test(views) &&
      /<article class="post-card"/.test(views),
      '兼容结构缺失');
  }

  /* ================= ② 样式 ================= */
  {
    const CN = 'B2 首页街区';

    T(CN, 'R186 街区用 12 列网格，主轴/街角/广场跨度各有规则',
      /grid-template-columns:\s*repeat\(12,\s*1fr\)/.test(bodyOf(/^\.district$/)) &&
      /grid-column:\s*span 4/.test(bodyOf(/^\.block-stat$/)) &&
      /grid-column:\s*span 8/.test(bodyOf(/^\.block-stream$/)) &&
      /grid-column:\s*span 12/.test(bodyOf(/^\.block-featured$/)),
      '网格或跨度规则缺失');

    /* 双层视觉语言：街块容器圆角取 --r-soft（与系统层切角同值），编号走系统层切角 */
    T(CN, 'R186b 双层语言：街块走人味层圆角，灯牌编号走系统层切角',
      /border-radius:\s*var\(--r-soft\)/.test(bodyOf(/^\.block$/)) &&
      /clip-path:\s*var\(--clip-corner-sm\)/.test(bodyOf(/^\.block-no$/)),
      '两层语言未分层');

    /* 一街块一墨色：六条规则指向六个不同的墨色变量 */
    const inkBodies = rules
      .filter(function (r) { return /^\.block\[data-block="0[1-6]"\]$/.test(r[0].trim()); })
      .map(function (r) { return r[1].trim(); });
    const inks = inkBodies.map(function (b) { return (/var\(--ink-(\d)\)/.exec(b) || [, '?'])[1]; });
    T(CN, 'R186c 六个街块各取一种墨色（不重复、不手写颜色）',
      inkBodies.length === 6 && new Set(inks).size === 6 && inks.indexOf('?') === -1,
      inks.join(','));

    T(CN, 'R186d 墨色由主色相偏移派生（换色相时六块一起平移）',
      /--ink-1:\s*hsl\(var\(--hue\)/.test(css) &&
      /--ink-2:\s*hsl\(calc\(var\(--hue\) \+ 40\)/.test(css) &&
      /--ink-6:\s*hsl\(calc\(var\(--hue\) \+ 260\)/.test(css),
      '墨色未走色相派生');

    /* v4.1：入场从"错峰淡入"升级为"沿街点亮"（双路径）——
       增强路径走 animation-timeline: view()（进入视口才亮），
       降级路径 = 原错峰阶梯（六条 delay）。两套都必须在。 */
    const delays = rules.filter(function (r) { return /^\.block:nth-of-type\(/.test(r[0].trim()); });
    T(CN, 'R186e 沿街点亮双路径：@supports 增强 + 降级错峰（六条阶梯 delay）',
      delays.length === 6 &&
      delays.every(function (r) { return /animation-delay:\s*\d+ms/.test(r[1]); }) &&
      /@keyframes block-in/.test(css) &&
      /@supports \(animation-timeline: view\(\)\)/.test(css) &&
      /@keyframes block-light/.test(css),
      delays.length + ' 条 delay 规则');

    T(CN, 'R186f 滚动引导用 @supports 降级（不支持滚动驱动动画时静态常显）',
      /@supports \(animation-timeline: scroll\(\)\)/.test(css) &&
      /animation-range:\s*0 60vh/.test(css),
      '未做能力检测降级');

    T(CN, 'R186g reduce 停掉首页动效（入场/点亮/字标描边/引导）+ 开机屏不出现',
      /\.hero-inner,\s*\.block,\s*\.hero-scroll,\s*\.hero-scroll i\s*\{\s*animation:\s*none\s*!important/.test(rmBlk) &&
      /\.wordmark-glyph\s*\{\s*animation:\s*none\s*!important/.test(rmBlk) &&
      /\.boot-first \.boot-screen\s*\{\s*display:\s*none\s*!important/.test(rmBlk),
      'reduce 未停首页动效');

    /* 打印：只隐藏装饰层，Hero 的标题与 bento 的卡片是要印的。
       ⚠ 判据要**顺序无关**：原来写成 `/\.hero-bg,\s*\.hero-scroll\s*\{/`，
         等于要求两个选择器在清单里紧挨着 —— B3 往同一条规则里插了 `.toc`，
         这条就假红了。钉"同一规则的选择器列表里同时含两者"即可，与顺序/邻居无关。 */
    T(CN, 'R186h 打印隐藏 Hero 光晕与滚动引导，但保留正文内容',
      /\.hero-bg\b[^{}]*\.hero-scroll\b|\.hero-scroll\b[^{}]*\.hero-bg\b/.test(prBlk) &&
      !/\.block\s*\{[^}]*display:\s*none/.test(prBlk),
      'print 处理不当');

    const m1024 = mediaBlocks(css, function (c) { return /max-width:\s*1024px/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    const m768 = mediaBlocks(css, function (c) { return /max-width:\s*768px/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    T(CN, 'R186i 响应式用体系断点（1024 折半 / 768 单列）',
      /\.block-stat,\s*\.block-freq,\s*\.block-rhythm,\s*\.block-id\s*\{\s*grid-column:\s*span 6/.test(m1024) &&
      /\.district\s*\{\s*grid-template-columns:\s*1fr/.test(m768),
      '断点规则缺失');
  }

  /* ================= ③ 行为 ================= */
  {
    const CN = 'B2 首页街区';

    /* --- 首页：Hero + 街区 --- */
    const ctx = bootDom({ url: 'https://x.test/#/' });
    await waitFor(function () { return !!ctx.doc.querySelector('.district'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 120); });

    const district = ctx.doc.querySelector('.district');
    const mods = ctx.doc.querySelectorAll('.block[data-block]');
    T(CN, 'R187 首页渲染出 Hero + 街区六块',
      !!ctx.doc.querySelector('.hero') && !!district && mods.length === 6,
      '街块 ' + mods.length + ' 个');

    T(CN, 'R187b 六个街块编号齐备且顺序正确（01~06）',
      Array.prototype.map.call(mods, function (m) { return m.getAttribute('data-block'); })
        .join(',') === '01,02,03,04,05,06',
      Array.prototype.map.call(mods, function (m) { return m.getAttribute('data-block'); }).join(','));

    /* 迁移后功能仍可用：卡片照常渲染。
       ⚠ "加载更多"按钮是**条件渲染**的（hasMore 为真才出现），
       而测试 fixtures 只有 6 篇、一页装得下 ⇒ hasMore=false ⇒ 按钮本就不该在。
       所以这里只钉"卡片在"，按钮的存在性由源码断言（R185i）负责 ——
       把条件性元素写成无条件断言，是在测"测试数据"而不是测代码。 */
    const cards = ctx.doc.querySelectorAll('.post-card');
    T(CN, 'R187c 卡片照常渲染（迁移未砸掉既有结构）',
      cards.length > 0,
      cards.length + ' 张卡');

    T(CN, 'R187d 首页版块不再有旧的大标题（Hero 取代 SIGNAL LOG）',
      !/SIGNAL LOG/.test((ctx.doc.querySelector('.page-head h1') || {}).textContent || ''),
      (ctx.doc.querySelector('.page-head h1') || {}).textContent || '(无)');

    /* MODULE 03 的四项读数：全部来自本地，不依赖网络 */
    const statVals = Array.prototype.slice.call(ctx.doc.querySelectorAll('.stat-list .stat-v'))
      .map(function (el) { return el.textContent; });
    T(CN, 'R187e 站台状态四项读数（建站/信号/频段/色相）且均为数字',
      statVals.length === 4 && statVals.every(function (v) { return /^\d+$/.test(v); }),
      statVals.join(' / '));

    T(CN, 'R187f 标签频段芯片带 data-tone（复用全站色号体系）',
      ctx.doc.querySelectorAll('.freq-chip[data-tone]').length > 0,
      ctx.doc.querySelectorAll('.freq-chip').length + ' 个芯片');

    T(CN, 'R187g 归档节奏条形按百分比渲染，最大月为 100%',
      (function () {
        const bars = Array.prototype.slice.call(ctx.doc.querySelectorAll('.rhythm-bar'));
        if (!bars.length) return false;
        const widths = bars.map(function (b) { return parseInt(b.style.width, 10); });
        return Math.max.apply(null, widths) === 100 && widths.every(function (w) { return w > 0 && w <= 100; });
      })(),
      '条形宽度异常');

    ctx.dom.window.close();

    /* --- 标签页：仍是列表（不能被一起 bento 化）--- */
    const ctx2 = bootDom({ url: 'https://x.test/#/tag/code' });
    await waitFor(function () { return ctx2.doc.querySelector('.post-list, .empty-state'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 120); });
    T(CN, 'R187h 标签页仍是连续列表（无 .district、无 Hero）',
      !ctx2.doc.querySelector('.district') && !ctx2.doc.querySelector('.hero') &&
      /标签 \/\/ /.test((ctx2.doc.querySelector('.page-head h1') || {}).textContent || ''),
      '标签页被街区化了');
    ctx2.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v3.1.0 首页 Hero+bento" };

standalone(module, run);
