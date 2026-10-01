'use strict';
/* ============================================================
   tests/cases/56-v5-7-0-降档收敛.js — 氛围降档的**收敛时间**（P1 硬化）

   为什么单独立一条：
     原实现是 3s 采样 × 4 个坏样本 = 连续 12 秒不达标才降档，而 downgrade()
     一次只摘一层 ⇒ 最坏 9×12 ≈ 108 秒才关到不卡。用户体感就是
     "先卡十几秒，机器才开始自救"，而且自救远远跟不上。
     v5.7.0 改成 1s 采样 × 2 个坏样本 + **一次可连降多层**。

     这条用例不看字面常量（那是 45 号 R211f 的活），而是**把探针跑起来**：
     用桩把帧率按到 10fps，然后断言"几秒内真的掉了层"。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor } = require('../common');

const CASE = 'v5.7.0 降档收敛';

/* 在页面里装一组"低帧率"时钟：
   · requestAnimationFrame 每次回调把时间戳推进 100ms（= 10fps）
   · setInterval 用真定时器（否则探针永远不触发）
   这两个一起，就把探针看到的世界变成"这台机器只有 10fps"。 */
function installSlowClock(w, fps) {
  const frameMs = Math.round(1000 / fps);
  let ts = 0;
  w.requestAnimationFrame = function (fn) {
    return w.setTimeout(function () { ts += frameMs; fn(ts); }, 1);
  };
  w.cancelAnimationFrame = function (id) { w.clearTimeout(id); };
}

async function run() {
  const S = makeSuite();
  const T = S.T;

  /* ================= ① 低帧率下必须**有界收敛** ================= */
  {
    const ctx = bootDom({ url: 'https://x.test/#/archive', atmoSampleMs: 120 });
    const w = ctx.w;
    installSlowClock(w, 10);           /* 10fps：远低于 45 的阈值 */
    w.document.documentElement.setAttribute('data-atmo', 'rain stardust signs pulse bloom glow grid scanline noise');

    const before = 9;
    /* 记账：每次 data-atmo 变化都记一笔（含时间），才能分清
       "一次触发连降 N 层" 与 "多轮触发各降一层"。 */
    const changes = [];
    const t0 = Date.now();
    const root = w.document.documentElement;
    const origSet = root.setAttribute.bind(root);
    const attr = function () { return (root.getAttribute('data-atmo') || '').split(/\s+/).filter(Boolean).length; };
    root.setAttribute = function (k, v) {
      if (k === 'data-atmo') changes.push({ t: Date.now() - t0, n: String(v).split(/\s+/).filter(Boolean).length });
      return origSet(k, v);
    };

    w.NEONAtmo.sync();                 /* 启探针（probeNeeded: 层数 ≥2 且未锁） */

    const dropped = await waitFor(function () { return attr() < before; }, 4000);
    const firstAt = changes.length ? changes[0].t : -1;
    await new Promise(function (r) { setTimeout(r, 80); });   /* 让本轮连降跑完再读 */
    const afterCascade = attr();

    /* 单次连降的证据口径：一次触发引发的属性变化可能被场景框架（applyLayers）
       重新写一遍，所以不能靠"变化条数"数层数。改成：从这一串**最后一次**变化往前看，
       总共掉了多少层 —— ≥2 就说明这一轮确实连降了多层。
       ⚠ 不要拿"两轮之和"当连降证据（实测踩到：读晚了会把两轮 2+2 误当成一次 4）。 */
    const burstDrop = changes.length ? (before - changes[changes.length - 1].n) : 0;

    T(CASE, 'R305 ★ 持续低帧率时，氛围会在有界时间内真的降档（不是等十几秒）',
      dropped && firstAt >= 0 && firstAt < 3000,
      dropped ? ('首次降档在 ' + firstAt + 'ms（9 层 → ' + afterCascade + '）') : '4 秒内没降档');

    T(CASE, 'R305b ★ 一次触发连降多层（只调采样密度的话最坏仍要 9×2=18 秒才关完）',
      burstDrop >= 2,
      '本轮共降 ' + burstDrop + ' 层：' + changes.slice(0, 4).map(function (c) { return c.t + 'ms→' + c.n; }).join(' , '));

    T(CASE, 'R305c 降档从最耗的层开始摘（雨最先、静态纹理最后）',
      !/\brain\b/.test(root.getAttribute('data-atmo') || ''),
      '剩余：' + root.getAttribute('data-atmo'));

    /* 提示这条**直接驱动**一次降档来验（探针的触发时机受场景框架写 data-atmo 影响，
       靠等红灯不稳）。这里只问：降档时用户看不看得见提示。 */
    root.setAttribute = origSet;
    root.setAttribute('data-atmo', 'rain stardust signs');
    w.NEONAtmo.downgrade();
    await new Promise(function (r) { setTimeout(r, 30); });
    T(CASE, 'R305d 降档时给出可见提示（用户知道发生了什么，不是氛围凭空消失）',
      /氛围自动降档/.test(ctx.doc.body.textContent) && /已关闭/.test(ctx.doc.body.textContent),
      (ctx.doc.body.textContent.match(/氛围自动降档[^」]*」/) || ['(无提示)'])[0]);

    ctx.dom.window.close();
  }

  /* ================= ② 防抖：抖动不该把氛围一次抖光 =================
     ⚠ 拆成两条，因为"读得太早会撞上连降中途"（实测踩到：26ms 那一轮其实要降 2 层，
       只读第一笔会误判成 1 层）。一条盯"单轮连降的上限"，一条盯"总量不失控"。 */
  {
    const ctx = bootDom({ url: 'https://x.test/#/archive', atmoSampleMs: 120 });
    const w = ctx.w;
    /* 每帧 50ms（=20fps）→ 低于 45 阈值；用真定时器推进，避免"人造时钟跑赢真实冷却"。 */
    let ts = 0;
    w.requestAnimationFrame = function (fn) { return w.setTimeout(function () { ts += 50; fn(ts); }, 20); };
    w.cancelAnimationFrame = function (id) { w.clearTimeout(id); };

    const root = w.document.documentElement;
    root.setAttribute('data-atmo', 'rain stardust signs pulse bloom');
    const changes = [];
    const t0 = Date.now();
    const origSet = root.setAttribute.bind(root);
    root.setAttribute = function (k, v) {
      if (k === 'data-atmo') changes.push({ t: Date.now() - t0, n: String(v).split(/\s+/).filter(Boolean).length });
      return origSet(k, v);
    };
    w.NEONAtmo.sync();

    /* 只看第一个 300ms 窗口：冷却期 2000ms 内**只允许一轮**触发 */
    await new Promise(function (r) { setTimeout(r, 300); });
    const inWindow = changes.filter(function (c) { return c.t <= 300; });
    const dropInWindow = inWindow.length ? (5 - inWindow[inWindow.length - 1].n) : 0;

    T(CASE, 'R305e 冷却期内只触发一轮降档（连降有上限，不会一降到底）',
      dropInWindow >= 1 && dropInWindow <= 4,
      '首个 300ms 内掉了 ' + dropInWindow + ' 层：' +
        inWindow.map(function (c) { return c.t + 'ms→' + c.n; }).join(' , '));

    await new Promise(function (r) { setTimeout(r, 900); });
    const finalN = (root.getAttribute('data-atmo') || '').split(/\s+/).filter(Boolean).length;
    T(CASE, 'R305f 持续低帧率下保留"静态纹理"作底（不会把氛围全关成空）',
      finalN >= 1,
      '最终剩 ' + finalN + ' 层：' + root.getAttribute('data-atmo'));
    ctx.dom.window.close();
  }

  /* ================= ③ 源码契约：节奏参数与防抖参数都在 ================= */
  {
    const src = SRC.atmo;
    const num = function (re) { const m = re.exec(src); return m ? Number(m[1]) : NaN; };
    const sample = num(/SAMPLE_MS\s*=\s*(\d+)/);
    const bad = num(/BAD_LIMIT\s*=\s*(\d+)/);
    const cascade = num(/CASCADE_LIMIT\s*=\s*(\d+)/);
    const cool = num(/COOLDOWN_MS\s*=\s*(\d+)/);

    T(CASE, 'R306 触发窗口 ≤ 3 秒（采样 × 坏样本数；旧实现是 12 秒）',
      Number.isFinite(sample) && Number.isFinite(bad) && (sample * bad) <= 3000,
      sample + 'ms × ' + bad + ' = ' + (sample * bad) + 'ms');
    T(CASE, 'R306b 连降上限 ≥ 2（单层不够：最坏 9 层 × 2 秒仍要 18 秒）',
      Number.isFinite(cascade) && cascade >= 2, 'CASCADE_LIMIT = ' + cascade);
    T(CASE, 'R306c 有冷却期且不短于触发窗口（否则阈值附近会抖动降档）',
      Number.isFinite(cool) && Number.isFinite(sample) && cool >= sample * 2,
      'COOLDOWN_MS = ' + cool);
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: 'v5.7.0 降档收敛（氛围保底的时间上界）' };
standalone(module, run);
