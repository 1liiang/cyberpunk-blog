'use strict';
/* ============================================================
   tests/cases/57-v5-7-0-低端档.js — 低端设备档（P2 硬化）

   背景（取证）：全站 64 条规则用了 box-shadow / filter:blur / backdrop-filter，
   其中 35 条**常驻**（每帧都在付）。高端显卡无感，集显/老机器上就是拖帧主因。
   策略不是删效果，而是**按设备降一档**：
     · js/theme-boot.js 首绘前判档 → html[data-tier="low"]，并在"自动模式"下少开
       最重的三层氛围（rain/stardust/signs）
     · js/scene.js 路由校正时同样按档位裁剪（否则一切页面就被打回全开）
     · style.css 用 html[data-tier="low"] 关掉最贵的常驻效果

   ⚠ 两条纪律必须钉住（本文件存在的主要理由）：
     1. 用户**手动**选的层集不降级（尊重用户优先于省性能）
     2. theme-boot 与 scene 裁剪的必须是**同一批层**，且与 atmo.js 的降档顺序开头一致
        —— 不一致就会出现"探针以为开着、其实没渲染"的错判
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments } = require('../common');

const CASE = 'v5.7.0 低端档';
const LIGHT_LAYERS = ['rain', 'stardust', 'signs', 'pulse', 'bloom', 'glow', 'grid', 'scanline', 'noise'];

/* jsdom 里 navigator.deviceMemory / hardwareConcurrency 多为只读 getter —— 必须 defineProperty */
function setNav(w, key, val) {
  try {
    Object.defineProperty(w.navigator, key, { value: val, configurable: true, writable: true });
    return w.navigator[key] === val;
  } catch (e) { return false; }
}
function unsetNav(w, key) {
  try { Object.defineProperty(w.navigator, key, { value: undefined, configurable: true }); } catch (e) {}
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const boot = stripComments(SRC.themeBoot);
  const scene = stripComments(SRC.scene);
  const atmo = stripComments(SRC.atmo);
  const css = stripComments(SRC.css);

  /* ================= ① 源码契约：判定依据与裁剪顺序 ================= */
  {
    T(CASE, 'R307 判定依据是"低配信号"而非猜（deviceMemory / hardwareConcurrency / reduce）',
      /navigator\.deviceMemory/.test(boot) && /navigator\.hardwareConcurrency/.test(boot) &&
      /prefers-reduced-motion: reduce/.test(boot),
      'deviceMemory=' + /navigator\.deviceMemory/.test(boot) +
        ' hardwareConcurrency=' + /navigator\.hardwareConcurrency/.test(boot));

    T(CASE, 'R307b 首绘前写 data-tier（CSS 挂在这上面，晚写就等于首帧全价）',
      /setAttribute\('data-tier'/.test(boot) &&
      boot.indexOf("setAttribute('data-tier'") < boot.indexOf("setProperty('--hue'"),
      'data-tier 写入位置 ' + boot.indexOf("setAttribute('data-tier'") + ' < --hue ' + boot.indexOf("setProperty('--hue'"));

    /* 三个脚本必须裁同一批层：atmo 的降档顺序开头 == theme-boot 的 drop == scene 的 drop */
    const order = (/DOWNGRADE_ORDER\s*=\s*\[([^\]]*)\]/.exec(atmo) || [, ''])[1]
      .split(',').map(function (s) { return s.trim().replace(/['"]/g, ''); }).filter(Boolean);
    const tbDrop = (/var drop = \[([^\]]*)\]/.exec(boot) || [, ''])[1]
      .split(',').map(function (s) { return s.trim().replace(/['"]/g, ''); }).filter(Boolean);
    const scDrop = (/var LOW_END_DROP = \[([^\]]*)\]/.exec(scene) || [, ''])[1]
      .split(',').map(function (s) { return s.trim().replace(/['"]/g, ''); }).filter(Boolean);

    T(CASE, 'R307c ★ theme-boot 与 scene 裁同一批层，且等于 atmo 降档顺序的开头（防口径漂移）',
      tbDrop.length > 0 && tbDrop.join(',') === scDrop.join(',') &&
      tbDrop.join(',') === order.slice(0, tbDrop.length).join(','),
      'boot=[' + tbDrop + '] scene=[' + scDrop + '] atmo序=' + order.slice(0, tbDrop.length));

    T(CASE, 'R307d CSS 侧低端档规则在位（关掉最贵的常驻效果）',
      /html\[data-tier="low"\] \.topbar/.test(css) &&
      /html\[data-tier="low"\] \.post-card:hover/.test(css) &&
      /backdrop-filter:\s*none\s*!important/.test(css),
      'data-tier 规则数 ' + (css.match(/html\[data-tier="low"\]/g) || []).length);
  }

  /* ================= ② 动态：低配信号 → 少开三层 ================= */
  {
    const ctx = bootDom({ url: 'https://x.test/#/' });
    const w = ctx.w;
    const memOk = setNav(w, 'deviceMemory', 2);
    const cpuOk = setNav(w, 'hardwareConcurrency', 2);
    w.eval(SRC.themeBoot);                 /* 重跑引导脚本：读的正是这两个值 */

    const tier = w.document.documentElement.getAttribute('data-tier');
    const layers = (w.document.documentElement.getAttribute('data-atmo') || '')
      .split(/\s+/).filter(Boolean);
    const dropped = LIGHT_LAYERS.filter(function (id) { return layers.indexOf(id) === -1; });

    T(CASE, 'R308 ★ 低配设备（2GB / 2 核）判定为 low，并首绘前少开最重的三层',
      memOk && cpuOk && tier === 'low' &&
      dropped.sort().join(',') === 'rain,signs,stardust' && layers.length === 6,
      'tier=' + tier + ' 层数=' + layers.length + ' 少了=[' + dropped.sort() + ']');

    let tier2 = '', n2count = -1;
    T(CASE, 'R308b 高配设备（8GB / 12 核）仍判 high，氛围全开（不误伤）',
      (function () {
        const c2 = bootDom({ url: 'https://x.test/#/' });
        const w2 = c2.w;
        setNav(w2, 'deviceMemory', 8);
        setNav(w2, 'hardwareConcurrency', 12);
        w2.eval(SRC.themeBoot);
        const t2 = w2.document.documentElement.getAttribute('data-tier');
        const n2 = (w2.document.documentElement.getAttribute('data-atmo') || '').split(/\s+/).filter(Boolean).length;
        tier2 = t2; n2count = n2;
        c2.dom.window.close();
        return t2 === 'high' && n2 === 9;
      })(),
      '8GB/12 核 → tier=' + tier2 + ' 层数=' + n2count);

    let tier3 = '';
    T(CASE, 'R308c 用户开了"减少动效"也算低端（首绘就不该跑装饰动效）',
      (function () {
        /* bootDom 已能注入 matchMedia 吗？直接改 jsdom 的 matchMedia 再重跑引导脚本 */
        const c3 = bootDom({ url: 'https://x.test/#/' });
        const w3 = c3.w;
        setNav(w3, 'deviceMemory', 16);
        setNav(w3, 'hardwareConcurrency', 16);
        w3.matchMedia = function (q) { return { matches: /reduce/.test(q), media: q }; };
        w3.eval(SRC.themeBoot);
        const t3 = w3.document.documentElement.getAttribute('data-tier');
        tier3 = t3;
        c3.dom.window.close();
        return t3 === 'low';
      })(),
      'reduce 下 tier=' + tier3);

    ctx.dom.window.close();
  }

  /* ================= ③ 手动层集优先：用户选过就不降级 ================= */
  {
    const ctx = bootDom({ url: 'https://x.test/#/' });
    const w = ctx.w;
    setNav(w, 'deviceMemory', 2);
    setNav(w, 'hardwareConcurrency', 2);
    /* 手动勾选了全部 9 层（装置面板写的就是这个键） */
    w.localStorage.setItem('neon_atmo_manual', JSON.stringify(LIGHT_LAYERS));
    w.eval(SRC.themeBoot);
    const n = (w.document.documentElement.getAttribute('data-atmo') || '').split(/\s+/).filter(Boolean).length;
    T(CASE, 'R308d ★ 用户手动选过的层集不降级（省性能不能凌驾于用户选择）',
      n === 9, '手动 9 层 → 实际 ' + n + ' 层');
    ctx.dom.window.close();
  }

  /* ================= ④ 路由校正时也守档位（否则一切页就打回全开） ================= */
  {
    const ctx = bootDom({ url: 'https://x.test/#/' });
    const w = ctx.w;
    setNav(w, 'deviceMemory', 2);
    setNav(w, 'hardwareConcurrency', 2);
    w.document.documentElement.setAttribute('data-tier', 'low');
    /* 直接问 scene：它给塔楼场景（ATMO_ALL）算出的是几层 */
    const got = w.NEONScene.layersFor ? w.NEONScene.layersFor('tower', 'pollution') : null;
    const eff = w.NEONScene.effectiveLayers ? w.NEONScene.effectiveLayers('tower') : null;
    T(CASE, 'R308e ★ 路由校正也按档位裁剪（低端机切页面不会被打回全开）',
      Array.isArray(eff) && eff.length <= 6 && eff.indexOf('rain') === -1,
      'tower 生效层数=' + (eff ? eff.length : '?') + (got ? '（原始 ' + got.length + '）' : ''));
    ctx.dom.window.close();
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: 'v5.7.0 低端档（按设备降一档，不误伤高配）' };
standalone(module, run);
