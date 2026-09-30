(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fps(ms) {
    return new Promise(function (res) {
      var n = 0, t0 = performance.now();
      function tick(t) { n++; if (t - t0 < ms) requestAnimationFrame(tick); else res(+(n * 1000 / (t - t0)).toFixed(1)); }
      requestAnimationFrame(tick);
    });
  }
  function scrollFps(ms) {
    return new Promise(function (res) {
      var n = 0, t0 = performance.now();
      var timer = setInterval(function () { window.scrollBy(0, 160); }, 16);
      function tick(t) {
        n++;
        if (t - t0 < ms) { requestAnimationFrame(tick); }
        else { clearInterval(timer); res(+(n * 1000 / (t - t0)).toFixed(1)); }
      }
      requestAnimationFrame(tick);
    });
  }

  var out = { href: location.href };

  /* 1. 确保全氛围层开（含 rain） */
  try {
    localStorage.setItem('neon_atmo_mode', 'pollution');
    localStorage.removeItem('neon_atmo_manual');
    if (window.NEONScene && NEONScene.reapply) NEONScene.reapply();
    if (window.NEONAtmo && NEONAtmo.sync) NEONAtmo.sync();
  } catch (e) {}
  await sleep(900);

  /* 2. 结构核对 */
  var layer = document.querySelector('.atmo-layer[data-layer="rain"]');
  var cols = layer ? layer.querySelectorAll('.rain-col') : [];
  out.cols = cols.length;
  out.canvases = document.querySelectorAll('canvas').length;
  if (cols.length) {
    var c0 = cols[0];
    var bs = c0.querySelectorAll('b');
    out.tailSample = bs.length;
    out.headColor = getComputedStyle(bs[bs.length - 1]).color;
    out.tailColor = getComputedStyle(bs[0]).color;
    out.headShadow = getComputedStyle(bs[bs.length - 1]).textShadow;
    out.colContain = getComputedStyle(c0).contain;
    out.colWillChange = getComputedStyle(c0).willChange;
    out.layerWillChange = getComputedStyle(layer).willChange;
    out.layerContain = getComputedStyle(layer).contain;
  }

  /* 3. 性能：静置 */
  window.scrollTo(0, 0);
  await sleep(600);
  out.idleFps = await fps(1200);

  /* 4. 性能：滚动 */
  window.scrollTo(0, 0);
  await sleep(400);
  out.scrollFps = await scrollFps(2000);
  window.scrollTo(0, 0);

  if (performance.memory) out.memMB = Math.round(performance.memory.usedJSHeapSize / 1048576);

  return JSON.stringify(out);
})()
