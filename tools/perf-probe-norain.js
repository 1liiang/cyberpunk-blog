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

  /* 手动层集：全氛围层去掉 rain */
  try {
    var all = (window.NEONScene && NEONScene.ATMO_ALL) || [];
    var noRain = all.filter(function (x) { return x !== 'rain'; });
    localStorage.setItem('neon_atmo_manual', JSON.stringify(noRain));
    localStorage.removeItem('neon_atmo_mode');
    if (window.NEONScene && NEONScene.reapply) NEONScene.reapply();
    if (window.NEONAtmo && NEONAtmo.sync) NEONAtmo.sync();
  } catch (e) { out.err = String(e); }
  await sleep(900);

  var layer = document.querySelector('.atmo-layer[data-layer="rain"]');
  out.cols = layer ? layer.querySelectorAll('.rain-col').length : 0;
  out.layers = document.querySelectorAll('.atmo-layer').length;

  window.scrollTo(0, 0);
  await sleep(600);
  out.idleFps = await fps(1200);

  window.scrollTo(0, 0);
  await sleep(400);
  out.scrollFps = await scrollFps(2000);
  window.scrollTo(0, 0);

  /* 复原 */
  try { localStorage.removeItem('neon_atmo_manual'); localStorage.setItem('neon_atmo_mode', 'pollution'); } catch (e) {}

  if (performance.memory) out.memMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
  return JSON.stringify(out);
})()
