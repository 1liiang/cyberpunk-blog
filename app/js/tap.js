/* ============================================================
   tap.js — 点击反馈（v4.3 B4 / 装置④）
   ------------------------------------------------------------
   点击处扩散一圈霓虹光环。三档强度（off / normal / heavy，出厂 normal），
   存 neon_tap；仅鼠标类设备（@media (hover: hover)）；reduce 直通（不生成）。
   · pointerdown 而非 click：更跟手（按下即反馈，不等抬起）
   · 元素自清理：动画结束即移除（不累积 DOM）
   · 与终端/交互无耦合：纯视觉层，任何点击都不受影响
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'neon_tap';
  var MODES = ['off', 'normal', 'heavy'];

  function mode() {
    try {
      var m = window.localStorage.getItem(KEY);
      return MODES.indexOf(m) !== -1 ? m : 'normal';
    } catch (e) { return 'normal'; }
  }

  function setMode(m) {
    var v = MODES.indexOf(m) !== -1 ? m : 'normal';
    try { window.localStorage.setItem(KEY, v); } catch (e) { /* 隐私模式 */ }
    return v;
  }

  function reduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  function hoverable() {
    try {
      return !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
    } catch (e) { return false; }
  }

  function spawn(x, y) {
    var m = mode();
    if (m === 'off') return;
    var el = document.createElement('i');
    el.className = 'tap-ripple' + (m === 'heavy' ? ' is-heavy' : '');
    el.setAttribute('aria-hidden', 'true');
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    document.body.appendChild(el);
    /* 动画结束自清理；alt 用 setTimeout 兜底（动画被 reduce/CSS 移除时不悬挂） */
    var gone = false;
    function drop() {
      if (gone) return;
      gone = true;
      try { el.remove(); } catch (e) { /* 已移除 */ }
    }
    el.addEventListener('animationend', drop);
    setTimeout(drop, 900);
  }

  /* 一次性绑定（capture 无关；passive —— 反馈层绝不拦事件） */
  document.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0) return;              /* 只对左键/单指 */
    if (!hoverable() || reduced()) return;    /* 触屏与 reduce：不生成 */
    spawn(ev.clientX, ev.clientY);
  }, { passive: true });

  window.NEONTap = { mode: mode, setMode: setMode, MODES: MODES };
})();
