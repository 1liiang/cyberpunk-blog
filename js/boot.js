/* ============================================================
   boot.js — 开场序列（v4.1 B2「门廊」）
   ------------------------------------------------------------
   首访首页的终端开机自检（约 1.7s）。四个状态：
     · 首访 + 首页   → 播放（theme-boot 已在首绘前打了 .boot-first）
     · 回访（本会话看过）→ 静默清理，不播
     · 深链（直接进内页）→ 不播（开机仪式属于"门廊"，不打断内页访问）
     · reduce 偏好   → 不播（CSS 侧也不显示 —— 双保险）
   退出：自动 / 点击 / 任意键，三者都立即完成；加 .is-done 淡出后移除节点。
   ⚠ CSS 里有 boot-failsafe 动画兜底（~3.2s 自动淡出）——即使本脚本
     未加载或求值异常，开机屏也不会卡住页面。
   ============================================================ */
(function () {
  'use strict';

  var SEEN_KEY = 'neon_boot_seen';
  var LINE_STEP = 240;   /* 每行点亮间隔（ms）—— 5 行 ≈ 1.2s */
  var HOLD = 520;        /* 末行出现后的停留 */
  var FADE = 500;        /* 与 CSS 的 .is-done 过渡时长对齐 */

  function reduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  function markSeen() {
    try { window.sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 隐私模式 */ }
  }

  function run() {
    var root = document.documentElement;
    var screen = document.getElementById('boot-screen');
    var lines = screen ? screen.querySelectorAll('.boot-line') : [];
    var barFill = document.getElementById('boot-bar-fill');
    var isFirst = root.classList.contains('boot-first');
    var done = false;
    var timers = [];

    function clearTimers() {
      timers.forEach(function (t) { clearTimeout(t); });
      timers = [];
    }

    function finish() {
      if (done) return;
      done = true;
      clearTimers();
      markSeen();
      document.removeEventListener('keydown', onAny, true);
      document.removeEventListener('click', onAny, true);
      if (!screen) { root.classList.remove('boot-first'); return; }
      screen.classList.add('is-done');
      timers.push(setTimeout(function () {
        try { screen.remove(); } catch (e) { /* 已被移除 */ }
        root.classList.remove('boot-first');
      }, FADE));
    }

    function onAny() { finish(); }

    /* 三条"不播"的路径：非首访 / 无容器无行 / reduce —— 静默清理现场 */
    if (!isFirst || !lines.length || reduced()) {
      markSeen();
      root.classList.remove('boot-first');
      return;
    }

    /* 播放：逐行点亮（内容已静态写在 HTML 里，这里只控制 .is-on 与进度条） */
    lines.forEach(function (el, i) {
      timers.push(setTimeout(function () { el.classList.add('is-on'); }, 120 + i * LINE_STEP));
      if (barFill) {
        timers.push(setTimeout(function () {
          barFill.style.width = Math.round(((i + 1) / lines.length) * 100) + '%';
        }, 120 + i * LINE_STEP));
      }
    });
    timers.push(setTimeout(finish, 120 + (lines.length - 1) * LINE_STEP + HOLD));

    /* 跳过：任意键 / 点击（capture 捕获，boot 屏自身吃下所有指针事件） */
    document.addEventListener('keydown', onAny, true);
    document.addEventListener('click', onAny, true);
  }

  run();
})();
