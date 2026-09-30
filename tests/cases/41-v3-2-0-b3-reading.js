'use strict';
/* ============================================================
   tests/cases/41-v3-2-0-b3-reading.js — v3.2.0 B3 阅读与列表

   ① 页脚三栏（身份 / 导航矩阵 / 元信息）+ 名言走衬线
   ② 页面编号标（SECTOR 07~13，接首页 MODULE 01~06）
   ③ 搜索筛选条（吸附 + 快捷频段，数据本地聚合）
   ④ 详情页阅读栅格（正文 + TOC 辅助栏 + 超宽屏浮动目录）

   ⚠ 本 case 的两条特有判据：
     · 名言必须**仍是 .site-footer 的最后一个 div 子元素** —— R70 / R85c 钉着它，
       三栏化时若把名言包进 .foot-grid，两条老断言会一起红。
     · TOC 的 DOM 位置必须在正文**之后** —— 视觉上它在右侧第 2 列，
       但 Tab 顺序应当"读完正文才到目录"；靠 CSS 定位而非 tabindex 硬掰。
   ============================================================ */
const fs = require('fs');
const path = require('path');
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

function readIndex() {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8'); }
  catch (e) { return ''; }
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);
  const rules = topLevelRules(css);
  const views = SRC.views;
  const app = SRC.app;
  const html = readIndex();
  const prBlk = mediaBlocks(css, function (c) { return /\bprint\b/.test(c); })
    .map(function (b) { return b.body; }).join('\n');
  const m1024 = mediaBlocks(css, function (c) { return /max-width:\s*1024px/.test(c); })
    .map(function (b) { return b.body; }).join('\n');
  const m1600 = mediaBlocks(css, function (c) { return /min-width:\s*1600px/.test(c); })
    .map(function (b) { return b.body; }).join('\n');

  function bodyOf(selRe) {
    return rules.filter(function (r) { return selRe.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
  }

  /* ================= ① 页脚三栏 ================= */
  {
    const CN = 'B3 阅读与列表';
    T(CN, 'R190 页脚改为三栏（.foot-grid + 三个 .foot-col）',
      /class="foot-grid"/.test(html) && (html.match(/class="foot-col"/g) || []).length === 3,
      'foot-col 数量 ' + (html.match(/class="foot-col"/g) || []).length);

    /* ★ 兼容判据：R70 / R85c 钉着 `.site-footer > div:last-child` ——
       名言若被包进 .foot-grid 就不在直接子级里了，两条老断言会一起红。
       判据用 **div 配平**求出 .foot-grid 的闭合位置，要求它在名言之前。
       ⚠ 只查"名言后面跟着 </footer>"是不够的：把名言挪进网格（顺手归拢的
         常见动作）之后，那个关系依然成立 —— 反向验证会当场证明它是假绿。 */
    T(CN, 'R190b 名言在 .foot-grid **之外**（仍是 .site-footer 的直接子元素）',
      (function () {
        const gridAt = html.indexOf('class="foot-grid"');
        const quoteAt = html.indexOf('class="foot-quote"');
        if (gridAt === -1 || quoteAt === -1) return false;
        /* ⚠ depth 必须从 1 起（此刻已经在 .foot-grid 内部了）：
           从 0 起的话，扫到第一个 .foot-col 的闭合就归零 → 提前 break，
           于是"网格闭合位置"取的其实是第一列的位置，判据恒真（假绿）。
           反向验证的"把名言挪进网格"场景会当场暴露这一点。 */
        let depth = 1;
        let i = html.indexOf('>', gridAt) + 1;
        for (; i < html.length; i++) {
          if (html.startsWith('<div', i)) { depth++; i += 4; }
          else if (html.startsWith('</div>', i)) {
            depth--;
            i += 6;
            if (depth === 0) break;
          }
        }
        return i < quoteAt;
      })(),
      '名言可能被包进了 .foot-grid');

    T(CN, 'R190c 页脚导航矩阵含五个入口',
      (html.match(/<a href="#\/(archive|tags|search|about)?">[A-Z]+<\/a>/g) || []).length >= 5 ||
      (html.match(/href="#\/[a-z]*">(HOME|ARCHIVE|TAGS|SEARCH|ABOUT)</g) || []).length === 5,
      '导航入口不全');

    T(CN, 'R190d 版本号与工程日志按钮保留（B1 的 footer 判据不受影响）',
      /id="foot-version"/.test(html) && /id="btn-changelog"/.test(html),
      '关键 id 丢失');

    T(CN, 'R190e 名言走人味层衬线（--font-serif-cn）',
      /font-family:\s*var\(--font-serif-cn\)/.test(bodyOf(/^\.foot-quote$/)),
      '名言未走衬线');

    T(CN, 'R190f 页脚 hover 效果关在 @media (hover: hover) 内',
      mediaBlocks(css, function (c) { return /hover:\s*hover/.test(c); })
        .map(function (b) { return b.body; }).join('\n')
        .indexOf('.foot-col a:hover') !== -1,
      'hover 未包媒体查询');

    T(CN, 'R190g 窄屏页脚回落单列（768px 体系断点）',
      /\.foot-grid\s*\{\s*grid-template-columns:\s*1fr/.test(
        mediaBlocks(css, function (c) { return /max-width:\s*768px/.test(c); })
          .map(function (b) { return b.body; }).join('\n')),
      '未做窄屏回落');
  }

  /* ================= ② 页面编号标 ================= */
  {
    const CN = 'B3 阅读与列表';
    const codes = ['07', '08', '09', '10', '11', '12', '13'];
    const missing = codes.filter(function (c) {
      return views.indexOf("pageNo('" + c + "')") === -1;
    });
    T(CN, 'R191 七个版块各自带编号标（SECTOR 07~13，接首页 MODULE 01~06）',
      missing.length === 0, missing.length ? '缺：' + missing.join(',') : '七处齐备');

    T(CN, 'R191b 编号标是 h1 的兄弟节点（不在 h1 内部，页头文案断言不受影响）',
      /'<span class="page-no">SECTOR ' \+ code \+ '<\/span>'/.test(fnBody(views, 'pageNo')),
      'pageNo 实现不符');

    T(CN, 'R191c 编号标走系统层语言（等宽 + 切角贴片，与 .bento-no 同源）',
      /font-family:\s*var\(--mono\)/.test(bodyOf(/^\.page-no$/)) &&
      /clip-path:\s*var\(--clip-corner-sm\)/.test(bodyOf(/^\.page-no$/)),
      '编号标样式不符');
  }

  /* ================= ③ 搜索筛选条 ================= */
  {
    const CN = 'B3 阅读与列表';
    const filters = fnBody(views, 'searchFilters');
    T(CN, 'R192 快捷频段由 state.source 本地聚合（零新增网络请求）',
      filters.length > 0 && /localTagStats\(state\.source/.test(filters) &&
      !/await|need\(/.test(stripComments(filters)),
      filters ? '未从 state.source 聚合' : '未找到 searchFilters');

    T(CN, 'R192b 芯片带 data-search-fill（点击即换关键词）',
      /data-search-fill="/.test(filters) && /data-tone="t' \+ tagTone\(k\)/.test(filters),
      '芯片缺少填充属性或色号');

    /* ⚠ 判据要钉住"委托结果真的被用"：只查 `closest('[data-search-fill]')`
       出现过是不够的 —— 把赋值改成 `null && e.target.closest(…)`（等于废掉委托）
       照样能通过（反向验证会当场证明）。所以要同时钉住赋值形式与它的使用。 */
    T(CN, 'R192c 点击委托改 hash 触发搜索（与手输走同一条路径）',
      /var fillEl = e\.target\.closest\('\[data-search-fill\]'\);/.test(app) &&
      /if \(fillEl\) \{[\s\S]{0,140}location\.hash = '#\/search\/' \+ encodeURIComponent\(/.test(app),
      '缺少委托或未走 hash');

    const barBody = bodyOf(/^\.search-bar$/);
    T(CN, 'R192d 搜索条吸附在页头正下方（top 用 --topbar-h，层序低于页头）',
      /position:\s*sticky/.test(barBody) &&
      /top:\s*var\(--topbar-h\)/.test(barBody) &&
      /z-index:\s*20/.test(barBody),
      '吸附配方不符');
  }

  /* ================= ④ 详情页阅读栅格 ================= */
  {
    const CN = 'B3 阅读与列表';
    const pv = fnBody(views, 'postView');
    T(CN, 'R193 详情页用「正文列 + TOC 辅助栏」两列栅格',
      /'<div class="reading">'/.test(pv) && /'<div class="reading-main">'/.test(pv) &&
      /class="toc" id="post-toc"/.test(pv),
      '阅读栅格结构缺失');

    /* ★ 关键：TOC 的 DOM 在正文之后（视觉右侧、Tab 顺序在后） */
    const tocAt = pv.indexOf('id="post-toc"');
    const mdAt = pv.lastIndexOf('id="md-target"');
    T(CN, 'R193b TOC 的 DOM 位置在正文之后（Tab 顺序 = 读完正文再到目录）',
      tocAt !== -1 && mdAt !== -1 && tocAt > mdAt,
      'TOC 在正文之前（Tab 顺序会先跳目录）');

    T(CN, 'R193c 页尾三件套留在栅格之外（相关信号通栏，不被目录挤窄）',
      (function () {
        const readingEnd = pv.indexOf("'</div>' +");
        const trailAt = pv.indexOf('postTrail(state, p)');
        return readingEnd !== -1 && trailAt > readingEnd;
      })(),
      'postTrail 被放进了栅格内');

    const tocBody = bodyOf(/^\.reading \.toc$/);
    T(CN, 'R193d sticky 四件套齐备（align-self + max-height + overflow + top）',
      /position:\s*sticky/.test(tocBody) &&
      /align-self:\s*start/.test(tocBody) &&
      /max-height:\s*calc\(100vh - var\(--topbar-h\)/.test(tocBody) &&
      /overflow-y:\s*auto/.test(tocBody) &&
      /top:\s*calc\(var\(--topbar-h\) \+ 24px\)/.test(tocBody),
      '配方不全（缺一条 sticky 就会静默失效）');

    T(CN, 'R193e ≤1024 辅助栏收起（TOC 回文档流，不再是侧栏）',
      /position:\s*static/.test((/\.reading \.toc\s*\{[^}]*\}/.exec(m1024) || [''])[0]),
      '未做收起');

    T(CN, 'R193f ≥1600 目录浮动到视口右侧（全站唯一允许 fixed 的元素）',
      /position:\s*fixed/.test((/\.reading \.toc\s*\{[^}]*\}/.exec(m1600) || [''])[0]) &&
      /\.reading\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(m1600),
      '浮动目录未实现');

    T(CN, 'R193g 打印隐藏目录（纸面上的 sticky 目录会错乱）',
      /\.toc/.test(prBlk), 'print 未隐藏目录');
  }

  /* ================= 行为 ================= */
  {
    const CN = 'B3 阅读与列表';

    /* 详情页：TOC 在栅格内、且为第二列 */
    const ctx = bootDom({ url: 'https://x.test/#/post/1' });
    await waitFor(function () { return !!ctx.doc.querySelector('.reading'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 200); });
    const reading = ctx.doc.querySelector('.reading');
    const kids = reading ? Array.prototype.slice.call(reading.children) : [];
    T(CN, 'R194 详情页渲染出阅读栅格，且 TOC 是第二列',
      !!reading && kids.length === 2 &&
      kids[0].classList.contains('reading-main') &&
      kids[1].id === 'post-toc',
      kids.map(function (k) { return k.id || k.className; }).join(' | '));

    T(CN, 'R194b 页脚三栏渲染出三列 + 名言独立成行',
      ctx.doc.querySelectorAll('.site-footer .foot-col').length === 3 &&
      !!ctx.doc.querySelector('.site-footer > .foot-quote'),
      ctx.doc.querySelectorAll('.site-footer .foot-col').length + ' 列');

    T(CN, 'R194c 页面编号标已渲染（详情页无编号，归档页有）',
      !ctx.doc.querySelector('.page-no') ||
      /SECTOR/.test((ctx.doc.querySelector('.page-no') || {}).textContent || ''),
      '详情页编号异常');
    ctx.dom.window.close();

    /* 搜索页：筛选条渲染 + 点击芯片改 hash */
    const ctx2 = bootDom({ url: 'https://x.test/#/search/code' });
    await waitFor(function () { return !!ctx2.doc.querySelector('.filter-row, .empty-state'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 200); });
    const chips = ctx2.doc.querySelectorAll('.filter-row [data-search-fill]');
    T(CN, 'R194d 搜索页渲染快捷频段芯片',
      chips.length > 0, chips.length + ' 个芯片');
    if (chips.length) {
      chips[0].click();
      await new Promise(function (r) { setTimeout(r, 120); });
      T(CN, 'R194e 点击芯片把搜索关键词写进路由（可分享、可回退）',
        /^#\/search\//.test(ctx2.w.location.hash),
        ctx2.w.location.hash);
    } else {
      T(CN, 'R194e 点击芯片把搜索关键词写进路由（可分享、可回退）', false, '无芯片可点');
    }
    ctx2.dom.window.close();

    /* 归档页：编号标落地 */
    const ctx3 = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return !!ctx3.doc.querySelector('.archive-item, .empty-state'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 150); });
    const no3 = ctx3.doc.querySelector('.page-no');
    T(CN, 'R194f 归档页编号标为 SECTOR 07',
      !!no3 && /SECTOR 07/.test(no3.textContent || ''),
      no3 ? no3.textContent : '(无)');
    ctx3.dom.window.close();

    /* v3.4.2 批 B：空态块从"9 个视图各写一遍"收敛为两个产出函数。
       这类重构最容易被日后"顺手展开回去"（毕竟直接写 HTML 更直观），故钉一条：
       视图里不得再出现 loading / error 两种空态的内联拼接。
       ⚠ 只钉这两种 —— empty（NO SIGNAL / EMPTY ARCHIVE 等）文案各异，
         刻意保留内联，不做过度抽象。 */
    T(CN, 'R194g 空态一律走 loadingBlock / errorBlock（防重构被展开回去）',
      /function loadingBlock\(/.test(views) && /function errorBlock\(/.test(views) &&
      !/html \+= '<div class="empty-state"><span class="empty-glyph">▚<\/span><span class="empty-hint/.test(views) &&
      !/html \+= '<div class="empty-state"><span class="empty-glyph">⚠<\/span><span class="empty-code">CONNECTION/.test(views) &&
      !/html \+= '<div class="empty-state"><span class="empty-glyph">⚠<\/span><span class="empty-hint/.test(views),
      '仍有内联拼接的 loading/error 空态');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v3.2.0 B3 阅读与列表" };

standalone(module, run);
