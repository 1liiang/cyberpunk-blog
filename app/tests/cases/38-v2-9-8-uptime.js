'use strict';
/* ============================================================
   tests/cases/38-v2-9-8-uptime.js — v2.9.8 ABOUT 在线时长 HUD
   （v2.9.9 修正：建站日期改为博主本人创建博客的时刻 2026-09-28 00:18；
     读数改为 天/时/分/秒 四段分解，退役「累计总秒数+千分位」）

   三层覆盖：
     ① 源码结构（js/views.js）—— 建站时间是**单一来源**（SITE_BORN 一个字面量）
     ② 运行时行为（jsdom）—— 进入 #/about 秒表真的会走、离开后真的会停
     ③ 样式（css/style.css）—— 色即信号 / reduce 停动效 / 打印隐藏

   ⚠ 本 case 特有的两个坑：
     · 计时器是 setInterval(…,1000) —— 断言"秒位在走"必须真等 1.2s 以上，
       且读两次的间隔要跨过整秒边界，否则会假绿/假红
     · 泄漏判据（离开页面停表）没法在 jsdom 里直接观测 clearInterval，
       只能钉「route() 顶部调用了 stopUptimeTicker」这一源码事实 ——
       所以另配一条行为断言（离开再回来读数仍正确）兜住
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
  const rmBlk = mediaBlocks(css, function (c) { return /prefers-reduced-motion/.test(c); })
    .map(function (b) { return b.body; }).join('\n');
  const prBlk = mediaBlocks(css, function (c) { return /\bprint\b/.test(c); })
    .map(function (b) { return b.body; }).join('\n');

  /* 选择器 → 规则体（③④ 两段共用 —— 各写一份迟早漂移） */
  function bodyOf(selRe) {
    return rules.filter(function (r) { return selRe.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
  }

  /* 从 marker 之后第一个 { 起按花括号配平抠出整块。
     ⚠ @keyframes 体内有嵌套 }（每个档位一行）—— 用「懒匹配到 \n}」会在
     第一个内层 } 处截断，导致"只看到第一档"的假红（或反过来漏检后档的假绿）。
     固定窗口（slice 600 字符）同样不行：会跨出关键帧边界扫到邻居。 */
  function blockAfter(src, marker) {
    const at = src.indexOf(marker);
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

  /* ================= ① 源码结构 ================= */
  {
    const CN = 'W1 在线时长 HUD';

    /* ⚠ 日期字面量只允许出现在 SITE_BORN 一处 —— 若有人在别处再写一份
       "2026-09-28"，改建站日时就会漏改一处，出现"建站显示 A、读数按 B 算"的漂移。
       v2.9.9 起旧值 2026-07-03 必须清零（防回归钉死）。
       次数统计在剥掉块注释后的代码上做 —— 注释里的日期说明不算重复。 */
    const viewsCode = stripComments(SRC.views);
    const bornHits = (viewsCode.match(/2026-09-28/g) || []).length;
    const oldHits = (viewsCode.match(/2026-07-03/g) || []).length;
    T(CN, 'R180 建站日期单一来源（SITE_BORN=2026-09-28T00:18，旧值 2026-07-03 清零）',
      /var SITE_BORN = '2026-09-28T00:18:00\+08:00';/.test(SRC.views) &&
      bornHits === 1 && oldHits === 0,
      '2026-09-28 出现 ' + bornHits + ' 次，旧值 2026-07-03 残留 ' + oldHits + ' 次');

    T(CN, 'R180b aboutView 输出 HUD（data-born + 天/时/分/秒四个读数位）',
      /class="uptime-hud" data-born="' \+ SITE_BORN \+ '"/.test(SRC.views) &&
      /id="uptime-days"/.test(SRC.views) && /id="uptime-hours"/.test(SRC.views) &&
      /id="uptime-min"/.test(SRC.views) && /id="uptime-sec"/.test(SRC.views),
      'HUD 结构缺失');

    /* ⚠ 若有人在 app.js 里再写一份日期字面量（而不是读 data-born），
       就破坏了"单一来源"。这里钉住：计算必须来自 DOM 属性 */
    const tick = fnBody(SRC.app, 'uptimeTick');
    T(CN, 'R180c 读数计算读 DOM 的 data-born（不在 app.js 里重复日期）',
      tick.length > 0 && /getAttribute\('data-born'\)/.test(tick) &&
      !/2026-07-03|2026-09-28/.test(SRC.app),
      tick ? '未从 data-born 取值或出现了重复日期' : '未找到 uptimeTick');

    T(CN, 'R180d 进页开表、route 顶部停表（离页不残留定时器）',
      /function startUptimeTicker/.test(SRC.app) &&
      /stopUptimeTicker\(\); \/\* v2\.9\.9：同理/.test(SRC.app) &&
      /startUptimeTicker\(\);\s*\n\s*return;/.test(SRC.app),
      '开/停表挂载点缺失');

    T(CN, 'R180e 时/分/秒补零两位（pad2，仪表读数不跳宽）',
      /function pad2/.test(SRC.app) && (tick.match(/pad2\(/g) || []).length >= 3,
      'pad2 缺失或未用于至少三个分解位');
  }

  /* ================= ② 运行时 ================= */
  {
    const CN = 'W1 在线时长 HUD';
    const ctx = bootDom({ url: 'https://x.test/#/about', captureConsole: true });
    await waitFor(function () { return !!ctx.doc.getElementById('uptime-sec'); }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    const days = ctx.doc.getElementById('uptime-days');
    const hours = ctx.doc.getElementById('uptime-hours');
    const min = ctx.doc.getElementById('uptime-min');
    const sec = ctx.doc.getElementById('uptime-sec');
    const born = ctx.doc.querySelector('.uptime-hud');

    T(CN, 'R180f 建站日期正确渲染为 2026.09.28',
      /2026\.09\.28/.test(born ? born.textContent : ''),
      born ? (born.textContent || '').slice(0, 60) : '无 HUD');

    const d0 = days ? parseInt(days.textContent, 10) : NaN;
    const h0 = hours ? parseInt(hours.textContent, 10) : NaN;
    const m0 = min ? parseInt(min.textContent, 10) : NaN;
    const s0 = sec ? parseInt(String(sec.textContent).replace(/,/g, ''), 10) : NaN;
    T(CN, 'R180g 天数在合理区间（建站于昨日：0~3650 天）',
      !isNaN(d0) && d0 >= 0 && d0 <= 3650, String(d0));

    /* v2.9.9 核心判据：四段分解必须与真实流逝自洽 ——
       d*86400 + h*3600 + m*60 + s ≈ (Date.now() - data-born)，容差 2s
       （覆盖"渲染一帧 → 读取"之间的时间流逝）。
       同时钉住钟表口径：h<24 / m<60 / s<60。 */
    const bornMs = born ? new Date(born.getAttribute('data-born') || '').getTime() : NaN;
    const expectS = Math.floor((Date.now() - bornMs) / 1000);
    const rebuilt = d0 * 86400 + h0 * 3600 + m0 * 60 + s0;
    T(CN, 'R180h 四段分解自洽（重总 ≈ 真实流逝，容差 2s，且 h<24/m<60/s<60）',
      isFinite(bornMs) && !isNaN(d0) && !isNaN(h0) && !isNaN(m0) && !isNaN(s0) &&
      h0 >= 0 && h0 < 24 && m0 >= 0 && m0 < 60 && s0 >= 0 && s0 < 60 &&
      Math.abs(rebuilt - expectS) <= 2,
      'rebuilt=' + rebuilt + ' expect=' + expectS);

    /* 秒位真的在走：跨过 1.2s 再读一次。v2.9.9 起秒位是 0~59 循环，
       判「变化」而非「递增」—— 59→00 的进位不是故障。
       ⚠ sec 判空：视图层若崩成 FAULT 面板，此节点已被替换掉（null），
       这里要「报红」而不是让 case 自己崩（崩溃≠报红） */
    await new Promise(function (r) { setTimeout(r, 1300); });
    const s1 = sec ? parseInt(String(sec.textContent), 10) : NaN;
    T(CN, 'R180i 秒位随时间跳动（定时器真的在跑；59→00 进位也算）',
      !isNaN(s1) && s1 !== s0, s0 + ' → ' + s1);

    /* 离开 ABOUT 再回来：停表后重开，读数仍然正确（不残留旧值/不 NaN） */
    ctx.w.location.hash = '#/';
    await new Promise(function (r) { setTimeout(r, 120); });
    /* v5.4.0：HUD 从 ABOUT 页**迁到首页**（站长选 B），
         所以判据改成"离开**首页**后卸载" —— 意图不变，只是换了宿主页面。 */
      ctx.w.location.hash = '#/tags';
      await waitFor(function () { return !ctx.doc.getElementById('uptime-sec'); }, 3000);
      T(CN, 'R180j 离开首页后 HUD 随页面卸载（无残留节点）',
        !ctx.doc.getElementById('uptime-sec'),
        '仍有残留节点');
    ctx.w.location.hash = '#/about';
    await waitFor(function () { return !!ctx.doc.getElementById('uptime-sec'); }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });
    /* ⚠ 判空链：若视图层崩成 FAULT 面板（如 uptimeTick 抛错被 safeRoute 接住），
       uptime-sec/days 都不存在 —— 这里要「报红」而不是让 case 自己崩（崩溃≠报红） */
    const daysEl2 = ctx.doc.getElementById('uptime-days');
    const d2 = daysEl2 ? parseInt(daysEl2.textContent, 10) : NaN;
    T(CN, 'R180k 再次进入读数依旧正确（重开表不 NaN、不归零）',
      !isNaN(d2) && d2 === d0, d0 + ' → ' + d2);

    ctx.dom.window.close();
  }

  /* ================= ③ 样式 ================= */
  {
    const CN = 'W1 在线时长 HUD';

    /* 色即信号：青 = 累计在线，品红 = 正在流逝。两种语义不得混用。
       v2.9.10 起光晕由 text-shadow 改为 drop-shadow（渐变文字的前提），
       但色相来源仍必须是 --cyan / --magenta 变量 —— 语义判据不变，只换实现载体。 */
    T(CN, 'R180l 天数走青光、秒数走品红光（两种霓虹各承担一种语义）',
      /\.uptime-num b#uptime-sec\s*\{[^}]*var\(--magenta\)/.test(css) &&
      /\.uptime-num b\s*\{[^}]*var\(--cyan\)/.test(css),
      '色彩语义未分离');

    T(CN, 'R180m 数字锁定等宽（tabular-nums），秒数跳动不抖版面',
      /font-variant-numeric:\s*tabular-nums/.test(bodyOf(/^\.uptime-num$/)),
      '未锁定字宽');

    /* 电流弧 + LIVE 点：裸时长 animation，R66m/R72k 都够不着 ⇒ 必须显式关 */
    T(CN, 'R180n reduce 停掉电流弧与 LIVE 闪烁（光敏风险，无其它守卫）',
      /\.uptime-arc::before,\s*\.uptime-live i\s*\{\s*animation:\s*none\s*!important/.test(rmBlk),
      'reduce 未停 HUD 动效');

    T(CN, 'R180o 打印隐藏 HUD（纸面上的"XX秒"立刻失真，不如不印）',
      /\.uptime-hud/.test(prBlk),
      '打印未隐藏');

    T(CN, 'R180p HUD 无硬编码霓虹色（三主题自适应）',
      !/#00f0ff|#ff2a6d|#b537f2|#05ffa1/i.test(bodyOf(/^\.uptime-/)),
      '存在硬编码霓虹色');

    T(CN, 'R180q 角括号取景存在（HUD bracket framing 的身份标识）',
      /\.uptime-hud::before\s*\{[^}]*border-right:\s*0/.test(css) &&
      /\.uptime-hud::after\s*\{[^}]*border-left:\s*0/.test(css),
      '角括号缺失');
  }

  /* ================= ④ v2.9.10 计时数字上色 ================= */
  {
    const CN = 'W1 在线时长 HUD';
    const hvBlk = mediaBlocks(css, function (c) { return /hover:\s*hover/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    const numB = bodyOf(/^\.uptime-num b$/);
    const numSec = bodyOf(/^\.uptime-num b#uptime-sec$/);

    /* 渐变文字三件套缺一不可 —— 渐变图 / background-clip:text / 透明字色。
       少最后一件 = 渐变被字色盖住（看着"没生效"）；少中间一件 = 一块渐变方块。
       ⚠ 标准属性与 -webkit- 前缀要**分别**断言：`/background-clip:\s*text/` 会被
         "-webkit-background-clip: text" 的子串命中 —— 摘掉标准属性也不会报红（假绿）。 */
    T(CN, 'R181 数字为渐变文字（linear-gradient + background-clip:text + 透明字色）',
      /background-image:\s*linear-gradient/.test(numB) &&
      /(?:^|[;\s])background-clip:\s*text/.test(numB) &&
      /-webkit-background-clip:\s*text/.test(numB) &&
      /color:\s*transparent/.test(numB),
      '渐变文字三件套不全');

    /* ⚠ 渐变文字与 text-shadow **互斥**：字形色为 transparent 之后，
       阴影成了可见主体，观感是一坨糊色块。光晕必须走 drop-shadow
       （作用于渲染后的不透明像素，background-clip:text 裁出的字形正是它的输入）。 */
    T(CN, 'R181b 光晕走 drop-shadow 而非 text-shadow（透明字色下的唯一正确解）',
      /drop-shadow/.test(numB) && !/text-shadow/.test(numB) &&
      /drop-shadow/.test(numSec) && !/text-shadow/.test(numSec),
      '仍在用 text-shadow，渐变文字会被阴影糊住');

    /* 呼吸：一套 keyframes 服务两处语义 —— 色相经 --breathe-c 注入
       （天/时/分走青、秒走品红），不必维护两份呼吸动画。 */
    const breatheBlk = blockAfter(css, '@keyframes uptime-breathe');
    T(CN, 'R181c 呼吸动画（0/50/100 三档，色相经 --breathe-c 变量注入）',
      /0%,\s*100%/.test(breatheBlk) && /50%/.test(breatheBlk) &&
      /var\(--breathe-c\)/.test(breatheBlk) &&
      /animation:\s*uptime-breathe/.test(numB) &&
      /--breathe-c:\s*var\(--cyan\)/.test(numB) &&
      /--breathe-c:\s*var\(--magenta\)/.test(numSec),
      '呼吸动画缺失或色相未变量化');

    /* hover 铁律 E1：电光三组的触发规则必须全部落在 @media (hover: hover) 内 ——
       触屏没有"悬停"，漏出去会让移动端永久停在炸裂态。
       判据用"总数 = 块内数"反查，避免依赖拼接串能否被 replace 命中。 */
    const hoverSelTotal = (css.match(/\.uptime-num b:hover/g) || []).length;
    const hoverSelInBlk = (hvBlk.match(/\.uptime-num b:hover/g) || []).length;
    T(CN, 'R181d 电光炸裂的触发全在 @media (hover: hover) 内（触屏不误触）',
      /uptime-burst/.test(hvBlk) && /uptime-arcflash/.test(hvBlk) &&
      /uptime-jolt/.test(hvBlk) &&
      hoverSelTotal > 0 && hoverSelTotal === hoverSelInBlk,
      'hover 选择器 ' + hoverSelTotal + ' 处，块内仅 ' + hoverSelInBlk + ' 处');

    /* 爆环（圆环 + 三点火花碎屑）与电弧枝纹（双色斜纹 + mask 边缘渐隐） */
    const ringB = bodyOf(/^\.uptime-num b::before$/);
    const arcB = bodyOf(/^\.uptime-num b::after$/);
    T(CN, 'R181e 爆环（圆环 + 三点火花）与电弧枝纹（双色斜纹 + mask 渐隐）',
      /border-radius:\s*50%/.test(ringB) &&
      (ringB.match(/-?\d+px\s+-?\d+px\s+0\s+-3px/g) || []).length >= 3 &&
      /repeating-linear-gradient/.test(arcB) && /mask-image/.test(arcB),
      '爆环或枝纹结构缺失');

    /* 呼吸是"常驻循环"，比一次性过渡更持续地消耗前庭耐受 ⇒ reduce 必须停；
       电光三组同样裸时长、同样够不着 R66m/R72k。 */
    T(CN, 'R181f reduce 停掉呼吸与电光（常驻循环动效无其它守卫）',
      /\.uptime-num b\s*\{\s*animation:\s*none\s*!important/.test(rmBlk) &&
      /\.uptime-num b::before,\s*\.uptime-num b::after\s*\{\s*animation:\s*none\s*!important/.test(rmBlk),
      'reduce 未停数字动效');

    /* ⚠ animation 是简写属性：hover 规则若只写 utime-jolt，会把主规则的
       breathe 一并抹掉 —— 一悬停数字就"屏住呼吸"。必须把呼吸写回同一简写。 */
    T(CN, 'R181g 悬停不掐断呼吸（hover 的 animation 简写把 breathe 一并写回）',
      /\.uptime-num b:hover\s*\{[^}]*animation:\s*uptime-breathe/.test(hvBlk),
      'hover 覆盖 animation 简写，呼吸被掐断');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v2.9.8 在线时长 HUD" };

standalone(module, run);
