/* ============================================================
   atmo.js — 氛围运行时（v4.0 B1「地基重铸」）
   ------------------------------------------------------------
   氛围「注册表」的层定义在 style.css（9 层，html[data-atmo] 驱动开关），
   场景温差在 js/scene.js（谁能亮哪些层）。本文件是运行时里"会动"的部分：

     ① rain（数字雨）：v4.4.1 起为「DOM 列」实现 ——
        每列 = 固定字符数的元素串，整列由 CSS transform 下落（合成器线程），
        主线程只做低频字符流变（churn）。拖尾长度/密度/强度全部是精确参数，
        离屏即随元素消失（物理上不可能残留）；不再依赖 Canvas。
        进入含 rain 的场景启动、离开即停（省电；"场景感知"的首个实践）。
     ② 帧率保底：持续 <45fps 时自动降档（从最重的层开始关），
        防止"光污染"变成"卡成幻灯片"。用户可在存储里锁定不降档
        （neon_atmo_lock = '1'，B4 装置面板会给它一个开关）。

   设计约束（沿用项目纪律）：
     · 零依赖、惰性取用外部全局、异常不外抛（氛围坏了不能拖累路由）
     · 尊重 prefers-reduced-motion：动画层直接不启动（无障碍红线）
     · 页面隐藏时暂停渲染循环（tab 后台不烧 CPU）
     · 不新增计时器负担：探针只在「层数 ≥ 2 且未锁定」时运行
   ============================================================ */
(function () {
  'use strict';

  /* 降档顺序：从"最耗 / 最可牺牲"到"几乎免费"。
     静态纹理（noise/scanline/grid）放最后 —— 它们不拖帧，没必要牺牲。 */
  var DOWNGRADE_ORDER = ['rain', 'stardust', 'signs', 'pulse', 'bloom', 'glow', 'grid', 'scanline', 'noise'];
  var ATMO_LABEL = {
    rain: '数字雨', stardust: '星尘', signs: '霓虹招牌', pulse: '脉冲扫掠',
    bloom: '光溢出', glow: '光晕', grid: '透视网格', scanline: '扫描线', noise: '噪点'
  };

  var LOCK_KEY = 'neon_atmo_lock';
  var FPS_MIN = 45;        /* 低于它算"坏样本" */
  /* ⚠ v5.7.0（P1 硬化）：原来的 3000/4 = 「连续 12 秒不达标才降**一层**」，
     而 downgrade() 每次只摘一层 ⇒ 最坏要 9×12 ≈ 108 秒才关到不卡。
     实测体感就是"先卡十几秒，机器才开始自救"，且自救速度远跟不上。
     现在：1 秒采样 + 2 个坏样本即触发（≈2 秒），且**一次连降多层**（CASCADE_LIMIT）。
     收敛上限 ≈ ceil(9/CASCADE_LIMIT)×2 秒 —— 取 2 层 ⇒ 最坏 ~10 秒关完，而不是 108 秒。
     ⚠ 为什么还要 COOLDOWN：降档会让帧率回升，若此刻继续按"坏样本"猛降，
       会在阈值附近把层数反复抖掉（用户看到氛围一闪一闪地消失）。
       冷却期只重置计数、不重算帧率，等于"给画面 2 秒稳定时间再判"。 */
  var BAD_LIMIT = 2;       /* 连续坏样本数（1s 一个 ⇒ 约 2s）才降档 */
  var SAMPLE_MS = 1000;
  var CASCADE_LIMIT = 2;   /* 一次触发最多连降几层（1 = 旧行为） */
  var COOLDOWN_MS = 2000;  /* 降档后多久内不再触发下一轮（防抖） */
  var lastDowngradeAt = 0;

  function root() { return document.documentElement; }
  function activeLayers() {
    return (root().getAttribute('data-atmo') || '').split(/\s+/).filter(Boolean);
  }
  function isLocked() {
    try { return window.localStorage.getItem(LOCK_KEY) === '1'; } catch (e) { return false; }
  }
  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* 自足 toast（复用 #toast-wrap 与 .toast 样式；不依赖 app.js 的内部函数） */
  function toast(msg) {
    try {
      var wrap = document.getElementById('toast-wrap');
      if (!wrap) return;
      var el = document.createElement('div');
      el.className = 'toast';
      el.textContent = '▸ ' + msg;
      wrap.appendChild(el);
      setTimeout(function () {
        el.classList.add('hide');
        setTimeout(function () { el.remove(); }, 350);
      }, 3600);
    } catch (e) { /* 提示失败不影响主流程 */ }
  }

  /* ================= ① 数字雨 ================= */
  var rain = null; /* { layer, cols, churn, resizeTimer, onResize } */
  var GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789';

  /* ---- v4.4.1 渲染参数（"明显降低拖尾"的四个旋钮都在这里）----
     旧法（Canvas + destination-out 半透明擦除）的拖尾是"擦不干净"的副产品：
     长度随帧率漂移、残余逐帧累积（用户反馈：过长、过密、残留严重）。
     新法把拖尾**画出来** —— 以下参数就是它的全部： */
  var COL_W = 58;      /* 列间距 px —— 26 → 34 → 46 → 58：三轮"去密"。
                          合成层纪律：每列是一个独立合成层，列数直接决定合成器压力。
                          ⚠ v4.4.1 收尾实测（2026-09-30，滚动帧率，基线"去雨"=162.6）：
                            COL_W=46（28 列）→ 148.5（**−8.7%**，不可接受）
                            COL_W=56（23 列）→ 160.8（−1.1%）
                            COL_W=64（20 列）→ 164.1（**+0.9%**，等于无损耗）
                            COL_W=80（16 列）→ 164.6（+1.2%）
                          **拐点在 56~64**：取 58 兼顾密度与零损耗。
                          结论：COL_W 是唯一有效的主旋钮（试过"父层统一 will-change +
                          contain:strict"，反而恶化到 −9.8%，已回退）。 */
  var TAIL_MIN = 4;    /* 拖尾长度（字符数）—— 旧法不可控（实测常见 10+），现精确 4~7 */
  var TAIL_MAX = 7;
  var DUR_MIN = 7;     /* 单列落屏时长 s —— 更慢更稳 */
  var DUR_MAX = 13;
  var CHURN_MS = 180;  /* 字符流变间隔 —— 旧法每帧全列重绘，新法每 tick 只动 5 列 */

  function rainWanted() {
    return activeLayers().indexOf('rain') !== -1 && !reducedMotion();
  }

  function glyph() {
    return GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
  }

  /* 建列：列数 = 视口宽 / 列距；每列内联 left / duration / delay（负延迟错峰，
     进场即满天，不会"一波齐落"）。亮度梯度在 CSS 用 nth-last-child 做（头亮尾暗）。 */
  function buildColumns(layer) {
    var w = layer.clientWidth || window.innerWidth || 1024;
    var count = Math.ceil(w / COL_W);
    var frag = document.createDocumentFragment();
    var cols = [];
    for (var i = 0; i < count; i++) {
      var col = document.createElement('i');
      col.className = 'rain-col';
      var tail = TAIL_MIN + Math.floor(Math.random() * (TAIL_MAX - TAIL_MIN + 1));
      var buf = '';
      for (var j = 0; j < tail; j++) buf += '<b>' + glyph() + '</b>';
      col.innerHTML = buf;
      col.style.left = Math.round(i * COL_W + 6 + Math.random() * 5) + 'px';
      col.style.animationDuration = (DUR_MIN + Math.random() * (DUR_MAX - DUR_MIN)).toFixed(2) + 's';
      col.style.animationDelay = (-Math.random() * DUR_MAX).toFixed(2) + 's';
      frag.appendChild(col);
      cols.push(col);
    }
    layer.textContent = '';
    layer.appendChild(frag);
    return cols;
  }

  /* 字符流变：每 tick 只换 5 列的"头字符"（偶发连换头前一个，让闪烁更活）。
     相比旧法（每帧给全部列画新字符），主线程占用降一个数量级。 */
  function churnRain() {
    if (!rain || document.hidden) return;
    var cols = rain.cols;
    if (!cols.length) return;
    for (var k = 0; k < 5; k++) {
      var col = cols[(Math.random() * cols.length) | 0];
      var head = col.lastElementChild;
      if (head) head.textContent = glyph();
      if (Math.random() < 0.35 && head && head.previousElementSibling) {
        head.previousElementSibling.textContent = glyph();
      }
    }
  }

  function startRain(layer) {
    if (rain && rain.layer === layer) return;
    stopRain();
    /* 层缺失（极端时序）时静默跳过 —— 氛围坏了不能拖累路由 */
    if (!layer) return;
    rain = {
      layer: layer,
      cols: buildColumns(layer),
      churn: 0,
      resizeTimer: 0,
      onResize: null
    };
    rain.churn = setInterval(churnRain, CHURN_MS);
    /* 视口变化后重建列（去抖 350ms；列数/left 都随宽度算） */
    rain.onResize = function () {
      if (!rain) return;
      clearTimeout(rain.resizeTimer);
      rain.resizeTimer = setTimeout(function () {
        if (rain && rain.layer) rain.cols = buildColumns(rain.layer);
      }, 350);
    };
    window.addEventListener('resize', rain.onResize);
  }

  function stopRain() {
    if (!rain) return;
    if (rain.churn) clearInterval(rain.churn);
    if (rain.onResize) window.removeEventListener('resize', rain.onResize);
    if (rain.resizeTimer) clearTimeout(rain.resizeTimer);
    try { rain.layer.textContent = ''; } catch (e) { /* 已被移除 */ }
    rain = null;
  }

  /* v4.4.1：页面隐藏 = 给层挂 .is-paused（CSS animation-play-state: paused）——
     旧法停 rAF；新法把合成器动画也停住（后台 tab 零消耗）。 */
  function setRainPaused(paused) {
    if (!rain || !rain.layer) return;
    rain.layer.classList.toggle('is-paused', !!paused);
  }

  function syncRain() {
    var layer = document.querySelector('.atmo-layer[data-layer="rain"]');
    if (!layer) { stopRain(); return; }
    if (rainWanted()) {
      if (!rain) startRain(layer);
      else if (rain.layer !== layer) { stopRain(); startRain(layer); }
    } else {
      stopRain();
    }
  }

  /* ================= ② 帧率保底（探针 + 自动降档） ================= */
  var probe = { raf: 0, last: 0, frames: 0, acc: 0, bad: 0, timer: 0 };

  function probeNeeded() {
    if (isLocked()) return false;
    if (reducedMotion()) return false;
    if (document.hidden) return false;
    return activeLayers().length >= 2;
  }

  function probeLoop(ts) {
    if (probe.last) { probe.acc += ts - probe.last; probe.frames++; }
    probe.last = ts;
    probe.raf = requestAnimationFrame(probeLoop);
  }

  function startProbe() {
    if (probe.raf) return;
    probe.last = 0; probe.frames = 0; probe.acc = 0; probe.bad = 0;
    lastDowngradeAt = 0;
    /* 采样间隔可由测试覆盖（默认 SAMPLE_MS）—— 1 秒级的真实节奏没法在门禁里等，
       但语义完全一致：改的只是"多久量一次"，不是"量到什么才降档"，
       所以 R211f 那条源码契约断言仍然钉着真实值。 */
    var sampleMs = (typeof window !== 'undefined' && window.__NEON_ATMO_SAMPLE_MS)
      ? Number(window.__NEON_ATMO_SAMPLE_MS) : SAMPLE_MS;
    if (!isFinite(sampleMs) || sampleMs <= 0) sampleMs = SAMPLE_MS;
    probe.raf = requestAnimationFrame(probeLoop);
    probe.timer = setInterval(function () {
      if (document.hidden) { probe.acc = 0; probe.frames = 0; return; }
      if (!probe.frames) return;
      var fps = 1000 / (probe.acc / probe.frames);
      probe.acc = 0; probe.frames = 0;
      probe.last = 0;
      var now = Date.now();
      /* 冷却期内只重置计数（给画面稳定的时间），不判降档 —— 防"一降就回升、
         回升又降"的抖动把氛围一层层抖没 */
      if (lastDowngradeAt && (now - lastDowngradeAt) < COOLDOWN_MS) { probe.bad = 0; return; }
      probe.bad = fps < FPS_MIN ? probe.bad + 1 : 0;
      if (probe.bad >= BAD_LIMIT) {
        /* v5.7.0：一次触发连降多层（最多 CASCADE_LIMIT）——
           光把采样调密只能把"12 秒降一层"变成"2 秒降一层"，最坏仍要 18 秒；
           连降才是把收敛时间真正压下来的那一步。 */
        var dropped = 0;
        while (dropped < CASCADE_LIMIT && downgrade()) dropped++;
        if (dropped) {
          probe.bad = 0;
          lastDowngradeAt = Date.now();
          sync();
        } else {
          stopProbe(); /* 已无可降：不是氛围的锅，停止折腾 */
        }
      }
    }, sampleMs);
  }

  function stopProbe() {
    if (probe.raf) cancelAnimationFrame(probe.raf);
    if (probe.timer) clearInterval(probe.timer);
    probe.raf = 0; probe.timer = 0; probe.bad = 0;
  }

  /* 降一层档：从 DOWNGRADE_ORDER 里找当前开着的最重层，移除之 */
  function downgrade() {
    var cur = activeLayers();
    for (var i = 0; i < DOWNGRADE_ORDER.length; i++) {
      var id = DOWNGRADE_ORDER[i];
      var idx = cur.indexOf(id);
      if (idx !== -1) {
        cur.splice(idx, 1);
        root().setAttribute('data-atmo', cur.join(' '));
        syncRain();
        toast('氛围自动降档（保帧率）：已关闭「' + (ATMO_LABEL[id] || id) + '」');
        return true;
      }
    }
    return false;
  }

  /* ================= 对外接口 ================= */
  function sync() {
    syncRain();
    if (probeNeeded()) startProbe(); else stopProbe();
  }

  window.NEONAtmo = {
    sync: sync,
    downgrade: downgrade,
    stopRain: stopRain,
    isLocked: isLocked,
    ATMO_LABEL: ATMO_LABEL, /* v4.3 B4：装置面板的层名单一来源（app.js 惰性取用） */
    _rain: function () { return rain; }, /* 供测试探针读取状态 */
    _probe: probe
  };

  /* ================= 全局事件 ================= */
  /* 首屏：DOM 就绪后同步一次（defer 脚本执行时 DOM 已解析完） */
  sync();

  try {
    var rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (rmq && rmq.addEventListener) {
      rmq.addEventListener('change', function () { sync(); });
    }
  } catch (e) { /* 老浏览器：忽略 */ }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopProbe(); setRainPaused(true); }
    else { setRainPaused(false); sync(); }
  });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      /* 尺寸变化后 rain 的列布局要重算；探针无需动 */
      if (rain) sizeRain();
    }, 200);
  });
})();
