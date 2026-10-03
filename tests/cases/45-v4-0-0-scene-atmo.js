'use strict';
/* ============================================================
   tests/cases/45-v4-0-0-scene-atmo.js — v4.0 B1「地基重铸」

   ① 场景框架：路由 → 场景注册表 → body[data-scene] / html[data-atmo]
   ② 氛围系统：9 层注册（材质 3 + 光 6）、逐层开关、材质层低强度、
      reduce 全关、闪烁守 WCAG、帧率保底参数
   ③ 排版 2.0：Sarasa 自托管（白名单由 39 号 R175o 守）、字号归并、滚动条

   ⚠ 一致性契约（本文件是"双处定义"的仲裁者）：
     scene.js 的 ATMO_ALL / ATMO_STATIC 与 theme-boot.js 的同名字符串必须逐值一致，
     不一致 = "首绘的层"与"路由校正的层"打架（丢层 / 闪变）。
   ⚠ jsdom 没有 2D canvas：atmo.js 会走"无 canvas 静默跳过"的降级分支 ——
     本条既是被测行为（不崩），也是本文件其余行为断言成立的前提。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { makeSuite, standalone } = require('../case-runner');
const { SRC, ROOT, bootDom, waitFor, stripComments, cssRuleBody } = require('../common');

function fnBody(src, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp('\\bfunction\\s+' + escapedName + '\\s*\\(').exec(src);
  if (!declaration) return '';
  const at = declaration.index;
  const open = src.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

/* 取某个 @media 块的体（按花括号配平；从条件处的 { 起算） */
function mediaBlockOf(css, condRe) {
  const re = /@media([^{]*)\{/g;
  let m;
  while ((m = re.exec(css))) {
    if (!condRe.test(m[1])) continue;
    let depth = 1, i = re.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    return css.slice(re.lastIndex, i - 1);
  }
  return '';
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);
  const html = SRC.html;
  const sceneSrc = SRC.scene || '';
  const atmoSrc = SRC.atmo || '';

  /* ================= ① 场景框架 ================= */
  {
    const CN = 'v4.0 B1 地基重铸';

    /* 双处定义的常量一致性（scene.js 数组 vs theme-boot.js 字符串） */
    const sceneAll = (/var ATMO_ALL\s*=\s*\[([^\]]*)\]/.exec(sceneSrc) || [, ''])[1]
      .split(',').map(function (s) { return s.trim().replace(/['"]/g, ''); })
      .filter(Boolean).join(' ');
    const bootAll = (/var ATMO_ALL\s*=\s*'([^']+)'/.exec(SRC.themeBoot) || [, ''])[1];
    const sceneStatic = (/var ATMO_STATIC\s*=\s*\[([^\]]*)\]/.exec(sceneSrc) || [, ''])[1]
      .split(',').map(function (s) { return s.trim().replace(/['"]/g, ''); })
      .filter(Boolean).join(' ');
    const bootStatic = (/var ATMO_STATIC\s*=\s*'([^']+)'/.exec(SRC.themeBoot) || [, ''])[1];
    T(CN, 'R210 层集常量双处一致（scene.js ↔ theme-boot.js），共 3 类',
      sceneAll.split(' ').length === 3 &&
      sceneAll === bootAll &&
      sceneStatic === bootStatic &&
      sceneStatic.split(' ').length === 2,
      'scene=[' + sceneAll + '] boot=[' + bootAll + ']');

    /* app.js 接入：route 里调 applyScene + helper 惰性降级 */
    const routeFn = stripComments(fnBody(SRC.app, 'route'));
    const applyFn = stripComments(fnBody(SRC.app, 'applyScene'));
    T(CN, 'R210b 路由分发处接入场景应用（惰性取用 + 异常不拖累渲染）',
      /applyScene\(r\.name\)/.test(routeFn) &&
      /window\.NEONScene/.test(applyFn) &&
      /try\s*\{[\s\S]*?\}\s*catch/.test(applyFn),
      'route 未接入或 applyScene 缺防护');
  }

  /* ================= ② 三类背景与安全边界 ================= */
  {
    const CN = '全息背景整合';
    const LAYERS = ['glow', 'grid', 'stardust'];
    const retired = ['rain', 'signs', 'pulse', 'scanline', 'noise', 'bloom'];
    T(CN, 'R211 三类背景共用内容下方载体，移除全屏覆盖层',
      /class="atmo atmo-under"[^>]*aria-hidden="true"/.test(html) &&
      !/class="atmo atmo-over"/.test(html) &&
      LAYERS.every(function (id) { return html.indexOf('data-layer="' + id + '"') !== -1; }) &&
      retired.every(function (id) { return html.indexOf('data-layer="' + id + '"') === -1; }),
      '底光 / 纹理 / 星点');
    const pairs = [];
    const re = /html\[data-atmo~="([a-z]+)"\]\s+\.atmo-layer\[data-layer="([a-z]+)"\]/g;
    let m;
    while ((m = re.exec(css))) pairs.push([m[1], m[2]]);
    T(CN, 'R211b 三条逐层规则与三个 DOM id 严格配对',
      pairs.length === 3 && pairs.every(function (p) { return p[0] === p[1]; }), pairs.length + ' 条');
    const opacity = parseFloat((/opacity:\s*([\d.]+)/.exec(cssRuleBody(css, '.atmo-layer[data-layer="grid"]') || '') || [, '1'])[1]);
    T(CN, 'R211c 空间纹理低强度且没有全屏扫描线',
      opacity <= .05 && !/\.atmo-layer\[data-layer="scanline"\]/.test(css), 'opacity=' + opacity);
    const reduceBlk = mediaBlockOf(css, /prefers-reduced-motion/);
    T(CN, 'R211d 减少动效时星点不渲染，静态底光保留',
      /stardust/.test(reduceBlk) && /display:\s*none\s*!important/.test(reduceBlk) && /glow/.test(reduceBlk), 'reduce');
    const drift = (/@keyframes atmo-dust-drift\s*\{([\s\S]*?)\n\}/.exec(css) || [, ''])[1];
    T(CN, 'R211e 星点只用低频 transform / opacity，不做逐帧布局或闪烁',
      /atmo-dust-drift 32s/.test(css) && !!drift && !/(background-position|top|left|width|height)\s*:/.test(drift) &&
      !/@keyframes atmo-flicker/.test(css), '32s 缓动');
    const bad = Number((/BAD_LIMIT\s*=\s*(\d+)/.exec(atmoSrc) || [, '0'])[1]);
    const sample = Number((/SAMPLE_MS\s*=\s*(\d+)/.exec(atmoSrc) || [, '0'])[1]);
    T(CN, 'R211f 降档只移除星点，45fps 以下触发窗口不超过 3 秒',
      /DOWNGRADE_ORDER\s*=\s*\['stardust'\]/.test(atmoSrc) && /FPS_MIN\s*=\s*45/.test(atmoSrc) &&
      bad >= 1 && sample > 0 && bad * sample <= 3000, sample + 'ms × ' + bad);
    const c = bootDom({ skipApp: true, skipAtmo: true });
    c.doc.body.setAttribute('data-scene', 'tower');
    c.doc.documentElement.setAttribute('data-atmo', 'glow grid stardust');
    c.doc.querySelector('[data-layer="stardust"]').remove();
    c.w.eval(SRC.atmo);
    T(CN, 'R211g 星点载体缺失时不启动探针，运行时不抛错',
      !!c.w.NEONAtmo && !c.w.NEONAtmo._probe.raf && !c.w.NEONAtmo._probe.timer, '无探针');
    c.dom.window.close();
  }

  /* ================= ③ 场景与档位行为 ================= */
  {
    const CN = '全息背景整合';
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return ctx.doc.body.getAttribute('data-scene') === 'archive'; }, 5000);
    T(CN, 'R212 首访默认标准档：归档只有静态底光与纹理',
      ctx.w.NEONScene.readMode() === 'standard' && ctx.doc.documentElement.getAttribute('data-atmo') === 'glow grid',
      ctx.doc.documentElement.getAttribute('data-atmo'));
    ctx.w.localStorage.setItem('neon_atmo_manual', JSON.stringify(['glow', 'grid', 'stardust']));
    ctx.w.location.hash = '#/post/1';
    await waitFor(function () { return ctx.doc.body.getAttribute('data-scene') === 'reading'; }, 5000);
    T(CN, 'R212b 旧手动星点也受阅读场景限制，正文始终静态',
      ctx.doc.documentElement.getAttribute('data-atmo') === 'glow grid' && !ctx.w.NEONAtmo._probe.raf,
      ctx.doc.documentElement.getAttribute('data-atmo'));
    const S2 = ctx.w.NEONScene;
    T(CN, 'R212c 三档：梦游 3 类 / 标准 2 类 / 静谧为空，内页没有动态星点',
      S2.layersFor('tower', 'pollution').length === 3 && S2.layersFor('tower', 'standard').length === 2 &&
      S2.layersFor('tower', 'silent').length === 0 && S2.layersFor('workshop', 'pollution').join(' ') === 'glow grid',
      '3 / 2 / 0');
    ctx.dom.window.close();
    const silent = bootDom({ url: 'https://x.test/#/', themeBoot: true, storage: { neon_atmo_mode: 'silent' } });
    await waitFor(function () { return silent.doc.body.getAttribute('data-scene') === 'tower'; }, 5000);
    T(CN, 'R212d 静谧首绘和路由校正都关闭背景且不启动探针',
      silent.doc.documentElement.getAttribute('data-atmo') === '' && !silent.w.NEONAtmo._probe.raf,
      '[' + silent.doc.documentElement.getAttribute('data-atmo') + ']');
    silent.dom.window.close();
    const standard = bootDom({ url: 'https://x.test/#/', themeBoot: true });
    await waitFor(function () { return standard.doc.body.getAttribute('data-scene') === 'tower'; }, 5000);
    T(CN, 'R212e 标准档无 rAF、无采样计时器，数字雨节点和运行函数已移除',
      standard.doc.documentElement.getAttribute('data-atmo') === 'glow grid' &&
      !standard.w.NEONAtmo._probe.raf && !standard.w.NEONAtmo._probe.timer &&
      !standard.doc.querySelector('.rain-col') && !/function (startRain|churnRain|buildColumns)/.test(atmoSrc), '静态背景零循环');
    standard.dom.window.close();
    const legacy = ['noise', 'scanline', 'grid', 'glow', 'bloom', 'signs', 'stardust', 'pulse', 'rain', '__proto__'];
    const migrated = bootDom({ url: 'https://x.test/#/', themeBoot: true, skipApp: true,
      storage: { neon_atmo_manual: JSON.stringify(legacy) } });
    const first = migrated.doc.documentElement.getAttribute('data-atmo');
    const manual = migrated.w.NEONScene.readManual().join(' ');
    migrated.w.localStorage.setItem('neon_atmo_manual', '[]');
    migrated.w.NEONScene.apply('home');
    T(CN, 'R212f 旧九层偏好归并去重且首绘/运行时一致；空数组保持明确关闭',
      first === 'glow grid stardust' && manual === first &&
      migrated.doc.documentElement.getAttribute('data-atmo') === '', first + ' → []');
    migrated.dom.window.close();
  }

  /* ================= ⑤ 排版 2.0 ================= */
  {
    const CN = 'v4.0 B1 地基重铸';

    /* Sarasa 子集：文件真实存在 + @font-face 指向它 + 中文区进 unicode-range */
    const fontPath = path.join(ROOT, 'assets/fonts/sarasa-mono-sc-subset.woff2');
    let fontOk = false, fontKB = 0;
    try {
      const st = fs.statSync(fontPath);
      fontOk = st.size > 300 * 1024;
      fontKB = Math.round(st.size / 1024);
    } catch (e) { fontOk = false; }
    T(CN, 'R213 Sarasa 子集在位（>300KB）且 @font-face 指向它并覆盖中文区',
      fontOk &&
      /@font-face\s*\{[^}]*sarasa-mono-sc-subset\.woff2/.test(css) &&
      /unicode-range:[^;]*U\+4E00-U\+9FFF/.test(css),
      fontOk ? fontKB + 'KB' : '字体文件缺失');

    /* 字体栈：Sarasa 必须在拉丁等宽字体之后（英文观感不变的实现前提） */
    const monoStack = (/--mono:\s*([^;]+);/.exec(css) || [, ''])[1];
    T(CN, 'R213b --mono 栈把 Sarasa 排在 Courier New 之后（英文仍走原字体）',
      monoStack.indexOf('"Sarasa Mono SC"') !== -1 &&
      monoStack.indexOf('"Sarasa Mono SC"') > monoStack.indexOf('"Courier New"'),
      monoStack.slice(0, 80) + '…');

    /* 字号归并：半像素只允许白名单（14.5 有历史理由 / 16.5 是阅读正文，均被断言钉住） */
    const halfPx = SRC.css.match(/font-size:\s*\d+\.5px/g) || [];
    const halfVals = Array.from(new Set(halfPx.map(function (s) {
      return (/[\d.]+/.exec(s) || [''])[0];
    })));
    T(CN, 'R213c 半像素字号收敛到白名单（14.5 / 16.5），漂移半档已归并',
      halfVals.length > 0 &&
      halfVals.every(function (v) { return v === '14.5' || v === '16.5'; }),
      halfVals.join(' / '));

    /* 滚动条：标准属性（Chromium 121+/Firefox）+ WebKit 伪元素（Safari）双通道 */
    T(CN, 'R213d 滚动条美化双通道（scrollbar-color 标准属性 + ::-webkit-scrollbar）',
      /scrollbar-color:\s*hsl\(var\(--hue\)/.test(css) &&
      /::-webkit-scrollbar-thumb/.test(css),
      '缺标准属性或伪元素通道');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v4.0 B1 场景/氛围/排版" };

standalone(module, run);
