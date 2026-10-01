'use strict';
/* ============================================================
   tests/cases/43-v3-5-0-responsive-audit.js — v3.5.0 响应式与外部审计修复

   来源：一份外部审计报告（P1~P5）。逐条实测后确认并修复的内容：
     · P1 小屏顶栏溢出（≤420 时 STASH/ABOUT/ACCESS/主题按钮被 overflow-x:hidden 裁掉）
     · P2 #btn-theme 文字折成两个行盒（桌面同样存在）
     · 顺带：断点收敛（720/860/1000/640 → 768/1024）
     · P5.5 浅色档扫描线过重
     · P5.7 页脚导航漏 STASH

   ⚠ 本 case 的判据都是"防回流"型的：修好的东西最容易被日后的顺手改动还原回去
     （新增一个 720px 断点、把 nowrap 删掉…），所以每条修复都要有守卫。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { makeSuite, standalone } = require('../case-runner');
const { SRC, stripComments } = require('../common');

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

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);
  const rules = topLevelRules(css);
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const app = SRC.app;

  function bodyOf(selRe) {
    return rules.filter(function (r) { return selRe.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
  }
  const CN = 'v3.5.0 响应式与审计修复';

  /* ================= P2：主题按钮防折行 ================= */
  {
    /* ⚠ 判据必须**定位到基础规则那一条**。
       两个坑都踩过：① bodyOf 是浅解析，480 档里的同名规则会被一并取到
       —— 只查"有没有 nowrap"时，删掉基础规则那条仍然命中；
       ② 改用"全站 nowrap 计数 ≥ 2"同样无效（全站有 19 处 nowrap，删一处还有 18）。
       正解：按文件顺序取**第一条** `.theme-toggle` 规则（基础规则在文件前部，
       480 档那份在末尾）。 */
    const ttRules = rules.filter(function (r) { return r[0].trim() === '.theme-toggle'; });
    const base = ttRules.length ? ttRules[0][1] : null;
    T(CN, 'R200 .theme-toggle 基础规则声明 white-space: nowrap（P2：否则「☾ DARK」折成两个行盒）',
      !!base && /white-space:\s*nowrap/.test(base),
      base ? base.replace(/\s+/g, ' ').slice(0, 84) : '未找到基础规则');

    /* 审计给出的机制：flex item + flex-shrink:1 + 默认 normal ⇒ 空格处折行。
       既然加了 nowrap，就不该再被压到放不下（也不需要 flex-shrink:0 这种兜底）。 */
    T(CN, 'R200b nowrap 已声明，且不依赖 flex-shrink:0 兜底',
      !!base && /white-space:\s*nowrap/.test(base) && !/flex-shrink:\s*0/.test(base),
      'nowrap 已声明');
  }

  /* ================= P1：小屏顶栏 ================= */
  {
    const m480 = mediaBlocks(css, function (c) { return /max-width:\s*480px/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    T(CN, 'R201 新增 ≤480 档且让导航换行（P1：不换行就会被 overflow-x:hidden 静默裁掉）',
      m480.length > 0 && /\.nav\s*\{[^}]*flex-wrap:\s*wrap/.test(m480),
      m480.length ? 'nav 换行已就位' : '未找到 480 档');

    T(CN, 'R201b 480 档取消 nav 的 margin-left:auto（换行时它会把导航推到右端再折行）',
      /\.nav\s*\{[^}]*margin-left:\s*0/.test(m480),
      '未取消 margin-left');

    /* ★ 顶栏在窄屏变高 ⇒ 4 处 sticky 辅助栏的偏移量必须跟着调，否则会滑到页头底下 */
    const rootIn480 = /:root\s*\{\s*--topbar-h:\s*(\d+)px/.exec(m480);
    T(CN, 'R201c 480 档同步调高 --topbar-h（顶栏换行后变高，sticky 辅助栏读它）',
      !!rootIn480 && parseInt(rootIn480[1], 10) > 65,
      rootIn480 ? '--topbar-h: ' + rootIn480[1] + 'px' : '未覆盖 --topbar-h');
  }

  /* ================= 断点收敛 ================= */
  {
    /* ⚠ 只匹配**媒体查询**里的宽度：`max-width: 720px` 这种字面还可能出现在
       元素的宽度属性上（.form-panel.wide 就是 720px）—— 扫全文会把元素宽度
       误判成"断点回流"（我第一版就是这么假红的）。 */
    const LEGACY = [720, 860, 1000, 640];
    const back = LEGACY.filter(function (w) {
      return new RegExp('@media[^{]*max-width:\\s*' + w + 'px').test(css);
    });
    T(CN, 'R202 旧散值断点不得回流（720/860/1000/640 已并入体系值）',
      back.length === 0, back.length ? '回流：' + back.join(' ') + 'px' : '已收敛');

    const SYSTEM = ['480px', '768px', '1024px', '1600px'];
    const missing = SYSTEM.filter(function (w) {
      return !new RegExp('width:\\s*' + w.replace('px', '') + 'px').test(css);
    });
    T(CN, 'R202b 体系断点四值齐备（480 / 768 / 1024 / 1600）',
      missing.length === 0, missing.length ? '缺：' + missing.join(' ') : '四值齐备');

    /* 1400 是"版面空间阈值"（竖排名言需要两侧各 ~140px），不是设备档 —— 有意保留 */
    T(CN, 'R202c 1400 档保留且注明为有意例外（版面空间阈值，非设备档）',
      /@media \(max-width: 1400px\)/.test(css) &&
      /有意保留 1400/.test(SRC.css),
      '1400 档的例外说明缺失');

    /* 噪声检查：**宽度断点**块数应收敛。
       ⚠ 不能数全部 @media —— 全文有 50+ 个，其中 20 多个是 @media (hover: hover)
         与 print/reduce，拿它们当"断点数量"会得出 41 这种无意义的值
         （我第一版就是这么写错的）。这里只数含 width 条件的块。 */
    const widthBlocks = mediaBlocks(css, function (c) { return /(max|min)-width:/.test(c); });
    T(CN, 'R202d 宽度断点块受控（≤ 16 个，防"每修一处就加一档"）',
      widthBlocks.length <= 16, widthBlocks.length + ' 个宽度断点块');
  }

  /* ================= P5.7：页脚导航补全 ================= */
  {
    const footNav = (/<nav class="foot-col"[\s\S]*?<\/nav>/.exec(html) || [''])[0];
    T(CN, 'R203 页脚导航含 STASH（P5.7：顶栏 6 项、页脚原先只有 5 项）',
      /href="#\/marks">STASH/.test(footNav),
      (footNav.match(/href="#\/[a-z]*"/g) || []).join(' '));
    T(CN, 'R203b 页脚导航与顶栏同为 6 项',
      (footNav.match(/<a href="#\//g) || []).length === 6,
      (footNav.match(/<a href="#\//g) || []).length + ' 项');
  }

  /* P5.5（浅底档扫描线调轻）已随 v3.6.0 的氛围层移除一并作废：
     .scanlines 元素本身已不存在，其透明度规则与断言都已删除。 */

  /* ================= P5.1：记录"当前管线是正确的" ================= */
  {
    /* 审计看到的是**历史数据**（早期版本留下的：声明 png、负载 jpeg）。
       当前管线的 drawAndEncode 用同一个 type 既编码又声明，不可能不符 ——
       这条断言把这个不变量钉住，防止以后有人把两者拆开写。 */
    const cloud = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'cloud.js'), 'utf8');
    const d = /canvas\.toDataURL\((\w+),\s*quality\)[\s\S]{0,200}?content_type:\s*(\w+)/.exec(cloud);
    T(CN, 'R205 图片管线的"编码类型"与"声明类型"同源（P5.1 不变量：拆开写就会声明与字节不符）',
      !!d && d[1] === d[2],
      d ? ('toDataURL(' + d[1] + ') / content_type: ' + d[2]) : '未找到 drawAndEncode');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v3.5.0 响应式与审计修复" };

standalone(module, run);
