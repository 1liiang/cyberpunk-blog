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
    T(CN, 'R210 层集常量双处一致（scene.js ↔ theme-boot.js），共 9 层',
      sceneAll.split(' ').length === 9 &&
      sceneAll === bootAll &&
      sceneStatic === bootStatic &&
      sceneStatic.split(' ').length === 6,
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

  /* ================= ② 氛围载体与样式 ================= */
  {
    const CN = 'v4.0 B1 地基重铸';
    const LAYERS = ['noise', 'scanline', 'grid', 'glow', 'bloom', 'signs', 'stardust', 'pulse', 'rain'];

    T(CN, 'R211 index.html 双层载体 + 9 层注册齐全（aria-hidden 装饰）',
      /class="atmo atmo-under"[^>]*aria-hidden="true"/.test(html) &&
      /class="atmo atmo-over"[^>]*aria-hidden="true"/.test(html) &&
      LAYERS.every(function (id) { return html.indexOf('data-layer="' + id + '"') !== -1; }),
      LAYERS.filter(function (id) { return html.indexOf('data-layer="' + id + '"') === -1; }).join(',') || '9 层齐');

    /* 逐层开关：id 与 data-layer 必须配对（写错一个 = 那层永远不显示） */
    const pairs = [];
    const re = /html\[data-atmo~="([a-z]+)"\]\s+\.atmo-layer\[data-layer="([a-z]+)"\]/g;
    let m;
    while ((m = re.exec(css))) pairs.push([m[1], m[2]]);
    T(CN, 'R211b 9 条逐层开关规则，id 与 data-layer 严格配对',
      pairs.length === 9 && pairs.every(function (p) { return p[0] === p[1]; }),
      pairs.length + ' 条' + (pairs.every(function (p) { return p[0] === p[1]; }) ? '' : '（有错配）'));

    /* 材质层低强度（红线：颗粒纹理加深只会变花屏，不会变"更多光"） */
    const noiseOpacity = parseFloat((/opacity:\s*([\d.]+)/.exec(
      cssRuleBody(css, '.atmo-layer[data-layer="noise"]') || '') || [, '1'])[1]);
    const scanLine = parseFloat((/rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/.exec(
      cssRuleBody(css, '.atmo-layer[data-layer="scanline"]') || '') || [, '1'])[1]);
    T(CN, 'R211c 材质层保持低强度（噪点 ≤5% / 扫描线暗线 ≤16%）',
      noiseOpacity <= 0.05 && scanLine <= 0.16,
      'noise=' + noiseOpacity + ' / scanline=' + scanLine);

    /* reduce 块：动画层直接不渲染 */
    const reduceBlk = mediaBlockOf(css, /prefers-reduced-motion/);
    T(CN, 'R211d reduce 下动画层（雨/星尘/脉冲/招牌）不渲染，静态层保留',
      /rain/.test(reduceBlk) && /stardust/.test(reduceBlk) &&
      /pulse/.test(reduceBlk) && /signs/.test(reduceBlk) &&
      /display:\s*none\s*!important/.test(reduceBlk),
      reduceBlk ? '规则缺项' : '未找到 reduce 块');

    /* 闪烁守 WCAG 2.3.1：周期 ≥2s 且明暗变化 ≤5 次（最坏 2.5 次/秒 < 3Hz） */
    const flickPeriod = parseFloat((/animation:\s*atmo-flicker\s+([\d.]+)s/.exec(css) || [, '0'])[1]);
    const flickKf = (/@keyframes atmo-flicker\s*\{([\s\S]*?)\n\}/.exec(css) || [, ''])[1];
    const flickChanges = (flickKf.match(/opacity:/g) || []).length;
    T(CN, 'R211e 招牌闪烁守 WCAG 2.3.1（周期 ≥2s、每周期明暗变化 ≤5 次 ⇒ <3Hz）',
      flickPeriod >= 2 && flickChanges >= 2 && flickChanges <= 5,
      flickPeriod + 's / ' + flickChanges + ' 次变化');
  }

  /* ================= ③ 氛围运行时（源码契约） ================= */
  {
    const CN = 'v4.0 B1 地基重铸';
    const order = (/DOWNGRADE_ORDER\s*=\s*\[([^\]]*)\]/.exec(atmoSrc) || [, ''])[1]
      .split(',').map(function (s) { return s.trim().replace(/['"]/g, ''); }).filter(Boolean);
    T(CN, 'R211f 降档顺序：雨最先、静态纹理最后；阈值 45fps / 连续 4 个坏样本',
      order.length === 9 && order[0] === 'rain' && order.indexOf('noise') === order.length - 1 &&
      /FPS_MIN\s*=\s*45/.test(atmoSrc) && /BAD_LIMIT\s*=\s*4/.test(atmoSrc),
      order.join('>') + ' | 45fps/' + (/BAD_LIMIT\s*=\s*(\d+)/.exec(atmoSrc) || [, '?'])[1]);

    T(CN, 'R211g 运行时的三层防御：reduce 直通 / 层缺失静默跳过 / 用户锁定不降档',
      /prefers-reduced-motion: reduce/.test(atmoSrc) &&
      /* v4.4.1：雨改 DOM 列实现后，防御点从"无 2D canvas 跳过"升级为"层缺失跳过"——
         判据同步演进（原 if (!ctx) 是 Canvas 时代的限制，已随实现退役）。 */
      /if\s*\(!layer\)\s*return;/.test(atmoSrc) &&
      /neon_atmo_lock/.test(atmoSrc),
      '防御缺失');
  }

  /* ================= ④ 行为（jsdom 真渲染） ================= */
  {
    const CN = 'v4.0 B1 地基重铸';
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () {
      return ctx.doc.body.getAttribute('data-scene') === 'archive';
    }, 5000);

    T(CN, 'R212 归档路由 → data-scene=archive；层集 = 档案库温差（5 层）',
      ctx.doc.body.getAttribute('data-scene') === 'archive' &&
      (ctx.doc.documentElement.getAttribute('data-atmo') || '').split(' ').filter(Boolean).length === 5,
      'scene=' + ctx.doc.body.getAttribute('data-scene') +
        ' atmo=[' + ctx.doc.documentElement.getAttribute('data-atmo') + ']');

    /* 切换到详情页（reading 专注档）：hashchange 触发真实路由 */
    ctx.w.location.hash = '#/post/1';
    await waitFor(function () {
      return ctx.doc.body.getAttribute('data-scene') === 'reading';
    }, 5000);
    const atmoReading = (ctx.doc.documentElement.getAttribute('data-atmo') || '')
      .split(' ').filter(Boolean);
    T(CN, 'R212b 切到详情页 → reading 专注档（仅静态光 + 噪点，无动画层）',
      ctx.doc.body.getAttribute('data-scene') === 'reading' &&
      atmoReading.length === 2 && atmoReading.indexOf('rain') === -1 &&
      atmoReading.indexOf('noise') !== -1,
      '[' + atmoReading.join(' ') + ']');

    /* layersFor 三态纯函数（tower 场景：9 / 6 / 0） */
    const S2 = ctx.w.NEONScene;
    const pol = S2.layersFor('tower', 'pollution');
    const std = S2.layersFor('tower', 'standard');
    const sil = S2.layersFor('tower', 'silent');
    T(CN, 'R212c layersFor 三态：光污染=全开 / 标准=仅静态 6 层 / 静音=空',
      pol.length === 9 && std.length === 6 && sil.length === 0 &&
      std.every(function (id) { return S2.ATMO_STATIC.indexOf(id) !== -1; }),
      pol.length + '/' + std.length + '/' + sil.length);

    ctx.dom.window.close();
  }

  /* 首绘前写入（theme-boot 三态）+ rain 在 jsdom 的降级 */
  {
    const CN = 'v4.0 B1 地基重铸';
    const c1 = bootDom({
      url: 'https://x.test/#/', themeBoot: true,
      storage: { neon_atmo_mode: 'silent' }
    });
    await waitFor(function () { return !!c1.w.NEONAtmo; }, 5000);
    T(CN, 'R212d 静音模式：data-atmo 为空（首绘前由 theme-boot 写入，路由校正一致）',
      c1.doc.documentElement.getAttribute('data-atmo') === '',
      'atmo=[' + c1.doc.documentElement.getAttribute('data-atmo') + ']');

    const c2 = bootDom({
      url: 'https://x.test/#/', themeBoot: true,
      storage: { neon_atmo_mode: 'standard' }
    });
    await waitFor(function () { return !!c2.w.NEONAtmo; }, 5000);
    const atmoStd = (c2.doc.documentElement.getAttribute('data-atmo') || '')
      .split(' ').filter(Boolean);
    T(CN, 'R212e 标准模式：塔台场景只落静态 6 层（动画层被模式过滤）',
      atmoStd.length === 6 && atmoStd.indexOf('rain') === -1 && atmoStd.indexOf('stardust') === -1,
      '[' + atmoStd.join(' ') + ']');

    /* jsdom 无 2D canvas：startRain 应静默跳过（rain 对象保持 null），页面不崩 */
    /* v4.4.1：雨改为 DOM 列实现 —— 不再依赖 Canvas，jsdom 也能真实启动。
       ⚠⚠ 考证（本次迁移的意外收获）：旧断言写在 c2 上，而 c2 是 **standard 模式**
       （雨不在层集）⇒ "rain === null" 在它上面**恒真**——那句"无 canvas 静默跳过"
       其实从未被真正检验过（历史假绿）。新断言必须用 **pollution 实例**（雨在层集）
       才能测到"启动"这条路。
       ⚠ 另：旧断言对时序不敏感，新断言要**等 sync 链跑完**
       （app boot → scene.apply → NEONAtmo.sync）。 */
    const c3 = bootDom({ url: 'https://x.test/#/', themeBoot: true });
    await waitFor(function () {
      return !!(c3.w.NEONAtmo && c3.w.NEONAtmo._rain());
    }, 5000);
    var r3 = c3.w.NEONAtmo._rain();
    T(CN, 'R212f jsdom 下 DOM 列实现照常启动（雨已不依赖 Canvas）',
      !!r3 && r3.cols.length > 0 && r3.layer.getAttribute('data-layer') === 'rain',
      'rain=' + (r3 ? '已启动 ' + r3.cols.length + ' 列（预期）' : 'null（异常）'));
    c3.dom.window.close();

    c1.dom.window.close();
    c2.dom.window.close();
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
