'use strict';
/* ============================================================
   tests/cases/46-v4-1-0-scene-gate.js — v4.1 B2「门廊」

   ① 霓虹字标：字形路径数据（字体转曲）+ 双 g 层 + CSS 描边动画（无 JS 测长）
   ② 开场序列：theme-boot 首访标记 + boot.js 四态 + CSS 兜底自退场
   ③ 街区设施：灯牌招牌 / 挂架节点 / 街道母线 / 沿街点亮（40 号已覆盖结构，
      本文件补"设施"与"迁移完整性"两条线）

   ⚠ 迁移完整性（R218）是本批特有的一条：bento → district 是重命名迁移，
     最怕"新老两套并存"—— 剥注释后全仓不允许残留 .bento 选择器/类名。
   ⚠ jsdom 无 canvas / 无 view-timeline：涉及它们的断言只查源码契约。
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
  const bootSrc = SRC.boot || '';
  const wmSrc = SRC.wordmark || '';

  /* ================= ① 霓虹字标 ================= */
  {
    const CN = 'v4.1 门廊';

    /* 路径数据：12 字形 = "NEON://DIARY"；等宽字体的 advance 必须一致
       （字标按 advance 累加 x 定距 —— 不一致会出现字距漂移） */
    let W = null;
    try { W = JSON.parse((/window\.NEONWordmark\s*=\s*(\{[\s\S]*\});/.exec(wmSrc) || [, 'null'])[1]); }
    catch (e) { W = null; }
    const advs = W ? W.glyphs.map(function (g) { return g.adv; }) : [];
    T(CN, 'R215 字标路径数据完整（12 字形 / 等宽 advance / 坐标字段齐）',
      !!W && W.text === 'NEON://DIARY' && W.glyphs.length === 12 &&
      new Set(advs).size === 1 && W.width === advs[0] * 12 &&
      W.glyphs.every(function (g) { return typeof g.d === 'string' && g.d.length > 10; }),
      W ? W.glyphs.length + ' 字形 / adv=' + advs[0] : '路径数据解析失败');

    const wmBody = fnBody(views, 'wordmarkSvg');
    /* ⚠ 判据必须跑在剥注释后：wmBody 的注释里就写着 `<g class="wordmark-echo">`
       （解释"为什么翻转不写在 g 上"）—— 不剥注释的话，把代码里的 echo 层删掉
       注释照样命中（反向验证实测：假绿，仅行为断言 R219 抓住）。
       这是项目经典教训"判据不许钉注释"的第 N 次复现，写在这里防再犯。 */
    const wmCode = stripComments(wmBody);
    T(CN, 'R215b 字标双 g 层（主 + 残影），翻转写在 path 上（CSS 才能给 g 加偏移）',
      /class="wordmark-echo"/.test(wmCode) &&
      /class="wordmark-main"/.test(wmCode) &&
      /pathLength="100"/.test(wmCode) &&
      /scale\(1 -1\)/.test(wmCode) &&
      /* 翻转变换必须在 path 的 transform 里（写在 g 上会被 CSS transform 覆盖掉） */
      !/<g[^>]*transform=/.test(wmCode) &&
      /window\.NEONWordmark/.test(wmCode) &&
      /if \(!W[\s\S]*?\) return '';/.test(wmCode),
      '双层结构或降级缺失');

    T(CN, 'R215c CSS 描边动画：dasharray 归一化 + 0.6s/字 + 0.24s 错峰 + 时长变量',
      /stroke-dasharray:\s*100/.test(css) &&
      /stroke-dashoffset:\s*100/.test(css) &&
      /animation:\s*wordmark-draw 0\.6s var\(--t-bezier\)/.test(css) &&
      /animation-delay:\s*calc\(var\(--i\) \* 0\.24s\)/.test(css) &&
      /--i:/.test(views),
      '描边动画参数缺失');

    T(CN, 'R215d 残影层走语义品红 + 偏移；主层走色相派生 + 双层发光',
      /\.wordmark-echo\s*\{[^}]*transform:\s*translate/.test(css) &&
      /\.wordmark-echo \.wordmark-glyph\s*\{[^}]*stroke:\s*var\(--magenta\)/.test(css) &&
      /\.wordmark-main\s*\{[^}]*drop-shadow[^}]*drop-shadow/.test(css) &&
      /\.wordmark-main \.hl\s*\{\s*stroke:\s*var\(--magenta\)/.test(css),
      '残影/发光/单字母强调缺失');
  }

  /* ================= ② 开场序列 ================= */
  {
    const CN = 'v4.1 门廊';

    /* theme-boot：首绘前打标记；只在"未看过 + 落首页"时打 */
    T(CN, 'R216 首访标记在 theme-boot（首绘前）：检查 neon_boot_seen + 仅首页',
      /neon_boot_seen/.test(SRC.themeBoot) &&
      /classList\.add\('boot-first'\)/.test(SRC.themeBoot) &&
      /location\.hash/.test(SRC.themeBoot),
      '首访标记逻辑缺失');

    T(CN, 'R216b boot.js 四态与收尾：reduce 直通 / 跳过监听 / markSeen / 淡出移除',
      /prefers-reduced-motion: reduce/.test(bootSrc) &&
      /addEventListener\('keydown', onAny, true\)/.test(bootSrc) &&
      /addEventListener\('click', onAny, true\)/.test(bootSrc) &&
      /sessionStorage\.setItem\(SEEN_KEY/.test(bootSrc) &&
      /classList\.add\('is-done'\)/.test(bootSrc) &&
      /classList\.remove\('boot-first'\)/.test(bootSrc),
      'boot.js 状态机缺项');

    /* CSS：显示开关 + 退场 + **无 JS 兜底自退场**（防"没 JS 卡在开机屏"） */
    T(CN, 'R216c Boot 三件套：.boot-first 显示 / .is-done 淡出 / failsafe 3.2s 兜底',
      /\.boot-first \.boot-screen\s*\{\s*display:\s*block/.test(css) &&
      /\.boot-screen\.is-done\s*\{[^}]*opacity:\s*0/.test(css) &&
      /boot-failsafe/.test(css) &&
      /animation:\s*boot-failsafe 0\.5s ease 3\.2s forwards/.test(css),
      'Boot CSS 缺项');

    /* index.html：容器/行/进度条/跳过提示齐备且 aria-hidden。
       ⚠ 数行时要带边界：`class="boot-line` 的前缀会误匹配容器的 `class="boot-lines"`，
       故正则要求紧跟 `"` 或空格（实测第一版就数成了 6）。 */
    T(CN, 'R216d 容器静态就位（自检行 + 进度条 + 跳过提示，aria-hidden）',
      /class="boot-screen" id="boot-screen" aria-hidden="true"/.test(SRC.html) &&
      (SRC.html.match(/class="boot-line[" ]/g) || []).length >= 5 &&   /* v5.3.0：动画加料到 8 行，判据改成"不少于 5" */
      /id="boot-bar-fill"/.test(SRC.html) &&
      /boot-skip/.test(SRC.html),
      '开机屏容器不完整');
  }

  /* ================= ③ 街区设施 ================= */
  {
    const CN = 'v4.1 门廊';
    /* 同上：views 全文提到装饰类名时一律剥注释后再查（注释里解释结构时
       会写类名，不剥就会让"删代码"变异假绿） */
    const viewsCode = stripComments(views);

    T(CN, 'R217 灯牌招牌：挂架节点 + BLOCK 编号 + 名称（node 是装饰）',
      /class="block-sign"/.test(viewsCode) &&
      /class="block-node" aria-hidden="true"/.test(viewsCode) &&
      /BLOCK ' \+ no/.test(viewsCode),
      '招牌结构缺失');

    T(CN, 'R217b 街道母线：district-line + 流动光点动画（窄屏 768 隐藏）',
      /class="district-line" aria-hidden="true"/.test(viewsCode) &&
      /@keyframes line-pulse/.test(css) &&
      /\.district-line::before\s*\{[^}]*animation:\s*line-pulse/.test(css) &&
      /\.district-line\s*\{\s*display:\s*none/.test(css),
      '母线或光点缺失');

    T(CN, 'R217c 门面语言：雨棚条纹（.block::before）+ 招牌左缘发光竖杆',
      /\.block::before\s*\{[^}]*repeating-linear-gradient/.test(css) &&
      /\.block-sign\s*\{[^}]*border-left:/.test(css),
      '门面纹理缺失');

    /* 迁移完整性：剥注释后全仓无 .bento 残留（防"新老两套并存"） */
    T(CN, 'R218 迁移完整性：CSS 与 views 均无 .bento 选择器/类名残留',
      !/\.bento/.test(css) && !/class="bento/.test(viewsCode),
      (/\.bento/.test(css) ? 'CSS 残留 ' + (css.match(/\.bento/g) || []).length + ' 处' : '') +
        (/class="bento/.test(viewsCode) ? ' views 残留' : ''));
  }

  /* ================= ④ 行为（jsdom） ================= */
  {
    const CN = 'v4.1 门廊';
    const ctx = bootDom({ url: 'https://x.test/#/' });
    await waitFor(function () { return !!ctx.doc.querySelector('.district'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 120); });

    /* 字标渲染：24 条 path（12 字形 × 主/残影两层）+ h1 语义完整 */
    const wm = ctx.doc.querySelector('.wordmark');
    const paths = ctx.doc.querySelectorAll('.wordmark-glyph');
    const h1Text = (ctx.doc.querySelector('.hero-title') || {}).textContent || '';
    T(CN, 'R219 首页渲染霓虹字标（24 path = 12×2），h1 语义完整（可访问名不受 SVG 影响）',
      !!wm && paths.length === 24 && /NEON:\/\/DIARY/.test(h1Text),
      (paths.length) + ' path / h1="' + h1Text.trim().slice(0, 24) + '"');

    /* 街区设施渲染：6 招牌 + 6 节点 + 1 母线 */
    T(CN, 'R219b 六个灯牌 + 六个挂架节点 + 一条街道母线全部渲染',
      ctx.doc.querySelectorAll('.block-sign').length === 6 &&
      ctx.doc.querySelectorAll('.block-node').length === 6 &&
      ctx.doc.querySelectorAll('.district-line').length === 1,
      ctx.doc.querySelectorAll('.block-sign').length + ' 招牌 / ' +
        ctx.doc.querySelectorAll('.block-node').length + ' 节点');

    /* 开机屏：常规启动（无 .boot-first）→ 不播放、静默清理、写 seen */
    T(CN, 'R219c 常规启动（回访/无标记）：开机屏不播放，sessionStorage 已写 seen',
      !ctx.doc.documentElement.classList.contains('boot-first') &&
      ctx.w.sessionStorage.getItem('neon_boot_seen') === '1',
      'seen=' + ctx.w.sessionStorage.getItem('neon_boot_seen'));

    ctx.dom.window.close();

    /* 首访路径：themeBoot 打标记 → 播放 → 完成收尾（约 1.7s + 淡出） */
    const ctx2 = bootDom({ url: 'https://x.test/#/', themeBoot: true });
    await waitFor(function () { return !!ctx2.w.NEONScene; }, 5000);
    await new Promise(function (r) { setTimeout(r, 2600); });
    const screen2 = ctx2.doc.getElementById('boot-screen');
    T(CN, 'R219d 首访路径：标记 → 播放 → 收尾（boot-first 摘除、屏淡出或已移除）',
      !ctx2.doc.documentElement.classList.contains('boot-first') &&
      (!screen2 || screen2.classList.contains('is-done')),
      'boot-first=' + ctx2.doc.documentElement.classList.contains('boot-first') +
        ' / 屏=' + (screen2 ? (screen2.classList.contains('is-done') ? 'is-done' : '仍在') : '已移除'));
    ctx2.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v4.1 门廊：字标/开场/街区" };

standalone(module, run);
