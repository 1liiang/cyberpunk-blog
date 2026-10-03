/* 三类氛围的轻量运行时。动画由 CSS 承担；仅动态星点开启时采样帧率。 */
(function () {
  'use strict';
  var DOWNGRADE_ORDER = ['stardust'];
  var ATMO_LABEL = { glow: '环境底光', grid: '空间纹理', stardust: '灵动星点' };
  var LOCK_KEY = 'neon_atmo_lock';
  var FPS_MIN = 45;
  var BAD_LIMIT = 2;
  var SAMPLE_MS = 1000;
  var probe = { raf: 0, last: 0, frames: 0, acc: 0, bad: 0, timer: 0 };
  function root() { return document.documentElement; }
  function activeLayers() {
    return (root().getAttribute('data-atmo') || '').split(/\s+/).filter(Boolean);
  }
  function isLocked() {
    try { return window.localStorage.getItem(LOCK_KEY) === '1'; } catch (e) { return false; }
  }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function probeNeeded() {
    if (isLocked() || reducedMotion() || document.hidden) return false;
    if (root().getAttribute('data-tier') === 'low') return false;
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return false;
    var scene = document.body.getAttribute('data-scene');
    if (scene !== 'tower' && scene !== 'idcard') return false;
    return activeLayers().indexOf('stardust') !== -1 &&
      !!document.querySelector('.atmo-layer[data-layer="stardust"]');
  }
  function stopProbe() {
    if (probe.raf) cancelAnimationFrame(probe.raf);
    if (probe.timer) clearInterval(probe.timer);
    probe.raf = 0; probe.timer = 0; probe.last = 0; probe.frames = 0; probe.acc = 0; probe.bad = 0;
  }
  function probeLoop(ts) {
    if (probe.last) { probe.acc += ts - probe.last; probe.frames++; }
    probe.last = ts;
    probe.raf = requestAnimationFrame(probeLoop);
  }
  function startProbe() {
    if (probe.raf) return;
    var sampleMs = Number(window.__NEON_ATMO_SAMPLE_MS) || SAMPLE_MS;
    if (!isFinite(sampleMs) || sampleMs <= 0) sampleMs = SAMPLE_MS;
    probe.raf = requestAnimationFrame(probeLoop);
    probe.timer = setInterval(function () {
      if (!probeNeeded()) { stopProbe(); return; }
      if (!probe.frames) return;
      var fps = 1000 / (probe.acc / probe.frames);
      probe.acc = 0; probe.frames = 0; probe.last = 0;
      probe.bad = fps < FPS_MIN ? probe.bad + 1 : 0;
      if (probe.bad >= BAD_LIMIT) downgrade();
    }, sampleMs);
  }
  /* 静态底光/纹理不参与降档；关闭唯一动画后同时释放帧率探针。 */
  function downgrade() {
    if (isLocked()) return false;
    var cur = activeLayers();
    var idx = cur.indexOf(DOWNGRADE_ORDER[0]);
    if (idx === -1) return false;
    cur.splice(idx, 1);
    root().setAttribute('data-atmo', cur.join(' '));
    stopProbe();
    try {
      var wrap = document.getElementById('toast-wrap');
      if (wrap) {
        var el = document.createElement('div');
        el.className = 'toast';
        el.textContent = '▸ 氛围自动降档：已关闭「灵动星点」，保留静态背景';
        wrap.appendChild(el);
        setTimeout(function () { el.remove(); }, 3600);
      }
    } catch (e) { /* 提示失败不影响内容 */ }
    return true;
  }
  function sync() {
    root().setAttribute('data-atmo-paused', document.hidden ? 'true' : 'false');
    if (probeNeeded()) startProbe(); else stopProbe();
  }
  function refreshScene() {
    if (window.NEONScene && window.NEONScene.reapply) window.NEONScene.reapply();
    else sync();
  }
  window.NEONAtmo = { sync: sync, downgrade: downgrade, isLocked: isLocked,
    ATMO_LABEL: ATMO_LABEL, _probe: probe };
  sync();
  try {
    ['(prefers-reduced-motion: reduce)', '(max-width: 768px)'].forEach(function (query) {
      var media = window.matchMedia(query);
      if (media && media.addEventListener) media.addEventListener('change', refreshScene);
    });
  } catch (e) { /* 不支持媒体监听的浏览器由 CSS 兜底 */ }
  document.addEventListener('visibilitychange', sync);
})();
