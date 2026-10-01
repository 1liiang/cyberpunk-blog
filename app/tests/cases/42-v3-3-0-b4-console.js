'use strict';
/* ============================================================
   tests/cases/42-v3-3-0-b4-console.js — v3.3.0 B4 控制台与侧栏件

   ① 控制台仪表盘化：左导航（TIER 编号 + aria-current）+ 统计块 + 记录列表
   ② 归档页热力图小工具：12 格 / 0~4 级 / 数据本地聚合 / 色值随色相
   ③ 兼容：控制台记录行与归档月份分组的既有类名一个都没动

   ⚠ 管理台需要登录态，jsdom 里进不去 ⇒ 那一半只能做源码断言；
     归档页是公开页 ⇒ 行为断言落在这里。
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
  const prBlk = mediaBlocks(css, function (c) { return /\bprint\b/.test(c); })
    .map(function (b) { return b.body; }).join('\n');
  const m1024 = mediaBlocks(css, function (c) { return /max-width:\s*1024px/.test(c); })
    .map(function (b) { return b.body; }).join('\n');

  function bodyOf(selRe) {
    return rules.filter(function (r) { return selRe.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
  }

  /* ================= ① 控制台仪表盘 ================= */
  {
    const CN = 'B4 控制台与侧栏件';
    const av = fnBody(views, 'adminView');

    T(CN, 'R195 控制台改为「左导航 + 主区」两列栅格',
      /'<div class="console">'/.test(av) &&
      /class="console-nav"/.test(av) &&
      /class="console-main"/.test(av),
      '控制台栅格结构缺失');

    T(CN, 'R195b 左导航按 TIER 分组编号，并标出当前位置',
      (av.match(/console-nav-label/g) || []).length >= 2 &&
      /aria-current="page"/.test(av),
      'TIER 分组或当前位置标记缺失');

    T(CN, 'R195c 统计块四项（已广播 / 草稿 / 本月 / 频段）',
      (av.match(/console-stat"/g) || []).length === 4 &&
      /已广播/.test(av) && /草稿/.test(av) && /本月/.test(av) && /频段/.test(av),
      (av.match(/console-stat"/g) || []).length + ' 个统计块');

    T(CN, 'R195d 统计全部本地聚合（不新增网络请求）',
      !/await|need\(/.test(stripComments(av)),
      '统计块内出现网络调用');

    /* 兼容：记录行与新建入口一个都没动 */
    T(CN, 'R195e 记录行结构保留（.admin-item / .admin-title[data-edit] / #/edit/new）',
      /class="admin-item"/.test(av) && /class="admin-title" data-edit="/.test(av) &&
      /href="#\/edit\/new"/.test(av),
      '既有记录行结构被改写');

    T(CN, 'R195f 控制台栅格 1024 收成单列，导航转横向',
      /\.console\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(m1024) &&
      /\.console-nav\s*\{[^}]*flex-direction:\s*row/.test(m1024),
      '响应式规则缺失');

    T(CN, 'R195g 当前位置用左侧实色边标记（与归档色条同一套位置语言）',
      /\.console-nav a\[aria-current="page"\]\s*\{[^}]*border-left-color:\s*var\(--cyan\)/.test(css),
      '当前位置样式缺失');

    T(CN, 'R195h 打印隐藏控制台导航（纸面上的导航无意义）',
      /\.console-nav/.test(prBlk), 'print 未隐藏控制台导航');
  }

  /* ================= ② 归档页热力图 ================= */
  {
    const CN = 'B4 控制台与侧栏件';
    const hw = fnBody(views, 'heatWidget');

    T(CN, 'R196 热力图由归档页已有的月份分组本地聚合（零额外请求）',
      hw.length > 0 && /groups/.test(hw) && !/await|need\(/.test(stripComments(hw)),
      hw ? '未从 groups 聚合' : '未找到 heatWidget');

    T(CN, 'R196b 固定 12 格（含无数据的空月，断更月份一眼可见）',
      /for \(var i = 11; i >= 0; i--\)/.test(hw) &&
      /new Date\(now\.getFullYear\(\), now\.getMonth\(\) - i, 1\)/.test(hw),
      '月份序列构造不符');

    T(CN, 'R196c 亮度分 0~4 级（data-lv）',
      /data-lv="' \+ lv/.test(hw) && /Math\.round\(\(c\.count \/ max\) \* 4\)/.test(hw),
      '分级逻辑缺失');

    const heatCell = bodyOf(/^\.heat-cell$/);
    /* ⚠ 必须检查**所有** lv 变体，不能只看基类与 lv=4：
       把中间某一级（比如 lv=2）改成硬编码 hex，同样会毁掉"随色相变"，
       而只查基类会漏掉它 —— 反向验证会当场证明这是假绿。 */
    const heatVariants = rules.filter(function (r) {
      return /^\.heat-cell\[data-lv="[0-4]"\]$/.test(r[0].trim());
    });
    T(CN, 'R196d 热力图色值全由 --cyan 派生（换色相时整块跟着变）',
      /color-mix\(in srgb,\s*var\(--cyan\)/.test(heatCell) &&
      heatVariants.length >= 4 &&
      heatVariants.every(function (r) {
        return /var\(--cyan\)/.test(r[1]) && !/#[0-9a-f]{3,8}/i.test(r[1]);
      }),
      heatVariants.length + ' 条变体；硬编码的：' +
        heatVariants.filter(function (r) { return /#[0-9a-f]{3,8}/i.test(r[1]); })
          .map(function (r) { return r[0]; }).join(' '));

    /* ⚠ 断言 CSS 声明时一律用 `[^}]*` 跳过兄弟声明：
       写 `\.archive-grid\s*\{\s*grid-template-columns:` 等于要求它是**第一条**声明，
       而我在 `{` 后先写了 `display: grid;` —— 第 N 次栽在"钉相邻"上了。 */
    T(CN, 'R196e 归档页双栏（时间线 + 小工具），1024 收成单列',
      /\.archive-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*260px/.test(css) &&
      /\.archive-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(m1024),
      '双栏或响应式缺失');

    T(CN, 'R196f 小工具走统一的 .widget 壳 + 人味层圆角（后续小工具沿用）',
      /border-radius:\s*var\(--r-soft\)/.test(bodyOf(/^\.widget$/)) &&
      /class="widget"/.test(hw),
      '小工具壳不规范');
  }

  /* ================= 行为（归档页是公开页，可以真渲染）================= */
  {
    const CN = 'B4 控制台与侧栏件';
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return !!ctx.doc.querySelector('.archive-item, .empty-state'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 200); });

    T(CN, 'R197 归档页渲染出双栏（时间线 + 热力图小工具）',
      !!ctx.doc.querySelector('.archive-grid') &&
      !!ctx.doc.querySelector('.archive-main') &&
      !!ctx.doc.querySelector('.archive-aside [data-widget="heat"]'),
      '双栏结构未渲染');

    const cells = ctx.doc.querySelectorAll('.heat-cell');
    T(CN, 'R197b 热力图恰好 12 格，且每格都有 0~4 级标记',
      cells.length === 12 &&
      Array.prototype.every.call(cells, function (c) {
        return /^[0-4]$/.test(c.getAttribute('data-lv') || '');
      }),
      cells.length + ' 格');

    T(CN, 'R197c 有数据月份的亮度高于空月（分级真的按密度走）',
      (function () {
        const lvs = Array.prototype.map.call(cells, function (c) {
          return parseInt(c.getAttribute('data-lv'), 10);
        });
        return Math.max.apply(null, lvs) > 0 &&
          lvs.filter(function (v) { return v === 0; }).length < lvs.length;
      })(),
      Array.prototype.map.call(cells, function (c) { return c.getAttribute('data-lv'); }).join(','));

    T(CN, 'R197d 兼容：月份分组与归档条目结构未变（既有断言继续生效）',
      ctx.doc.querySelectorAll('.archive-month').length > 0 &&
      ctx.doc.querySelectorAll('.archive-item[data-tone]').length > 0,
      ctx.doc.querySelectorAll('.archive-month').length + ' 个月份组');

    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v3.3.0 B4 控制台与侧栏件" };

standalone(module, run);
