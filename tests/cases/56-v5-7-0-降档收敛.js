'use strict';
/* 三类背景只剩星点持续动画：低帧率时停止它，标准档不为静态背景启动采样。 */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor } = require('../common');
const CASE = '全息背景运行时';
function installSlowClock(w) {
  let ts = 0;
  w.requestAnimationFrame = function (fn) { return w.setTimeout(function () { ts += 100; fn(ts); }, 1); };
  w.cancelAnimationFrame = function (id) { w.clearTimeout(id); };
}
function layers(ctx) { return ctx.doc.documentElement.getAttribute('data-atmo'); }
function dream() {
  const c = bootDom({ skipApp: true, atmoSampleMs: 120, storage: { neon_atmo_mode: 'pollution' } });
  installSlowClock(c.w);
  c.w.NEONScene.apply('home');
  return c;
}
async function run() {
  const S = makeSuite(); const T = S.T;
  {
    const c = dream(); const t0 = Date.now();
    const ok = await waitFor(function () { return layers(c) === 'glow grid'; }, 3000);
    T(CASE, 'R305 持续低帧率时 3 秒内停止动态星点', ok && Date.now() - t0 < 3000,
      Date.now() - t0 + 'ms / ' + layers(c));
    T(CASE, 'R305b 降档后立即释放 rAF 和采样计时器',
      !c.w.NEONAtmo._probe.raf && !c.w.NEONAtmo._probe.timer, JSON.stringify(c.w.NEONAtmo._probe));
    T(CASE, 'R305c 保留底光和空间纹理，不继续删除静态背景',
      layers(c) === 'glow grid' && c.w.NEONAtmo.downgrade() === false, layers(c));
    T(CASE, 'R305d 降档提示告诉用户仅关闭动态星点',
      /氛围自动降档/.test(c.doc.body.textContent) && /灵动星点/.test(c.doc.body.textContent), '可见提示');
    c.dom.window.close();
  }
  {
    const c = dream();
    c.w.localStorage.setItem('neon_atmo_lock', '1'); c.w.NEONAtmo.sync();
    const locked = !c.w.NEONAtmo._probe.raf && !c.w.NEONAtmo._probe.timer && c.w.NEONAtmo.downgrade() === false;
    await new Promise(function (r) { setTimeout(r, 300); });
    T(CASE, 'R305e 性能锁定停止探针且保留星点', locked && layers(c) === 'glow grid stardust', layers(c));
    c.w.localStorage.removeItem('neon_atmo_lock'); c.w.NEONAtmo.sync();
    Object.defineProperty(c.doc, 'hidden', { value: true, configurable: true });
    c.doc.dispatchEvent(new c.w.Event('visibilitychange'));
    T(CASE, 'R305f 页面进入后台立即停止采样并暂停 CSS 星点',
      !c.w.NEONAtmo._probe.raf && !c.w.NEONAtmo._probe.timer &&
      c.doc.documentElement.getAttribute('data-atmo-paused') === 'true', '后台暂停');
    c.dom.window.close();
  }
  {
    const sample = Number((/SAMPLE_MS\s*=\s*(\d+)/.exec(SRC.atmo) || [, '0'])[1]);
    const bad = Number((/BAD_LIMIT\s*=\s*(\d+)/.exec(SRC.atmo) || [, '0'])[1]);
    T(CASE, 'R306 生产参数触发窗口不超过 3 秒', sample > 0 && bad > 0 && sample * bad <= 3000, sample + '×' + bad);
    const c = bootDom({ skipApp: true }); c.w.NEONScene.apply('home');
    const standard = !c.w.NEONAtmo._probe.raf && !c.w.NEONAtmo._probe.timer;
    c.w.localStorage.setItem('neon_atmo_mode', 'silent'); c.w.NEONScene.reapply();
    T(CASE, 'R306b 标准与静谧都不启动任何背景采样循环',
      standard && !c.w.NEONAtmo._probe.raf && !c.w.NEONAtmo._probe.timer && layers(c) === '', '零采样循环');
    c.w.localStorage.setItem('neon_atmo_mode', 'pollution'); c.w.NEONScene.apply('home');
    const running = !!c.w.NEONAtmo._probe.raf;
    c.w.NEONScene.apply('post');
    T(CASE, 'R306c 从梦游首页进入阅读页立即释放动画采样',
      running && !c.w.NEONAtmo._probe.raf && !c.w.NEONAtmo._probe.timer && layers(c) === 'glow grid', layers(c));
    c.dom.window.close();
  }
  return { pass: S.results.filter(function (r) { return r.pass; }).length,
    fail: S.results.filter(function (r) { return !r.pass; }).length, results: S.results };
}
module.exports = { run: run, name: '全息背景运行时（低帧率与零循环）' };
standalone(module, run);
