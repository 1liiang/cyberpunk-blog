'use strict';
/* ============================================================
   tests/cases/48-v4-3-0-console-devices.js — v4.3 B4「控制台」

   ① 命令终端（装置③）：命令表 / 接线（路由与 NEONControls）/ 历史 / 彩蛋
   ② 点击反馈（装置④）：三档强度 / hover+reduce 双闸 / 自清理
   ③ 装置面板：四组结构（明度/色相/氛围/装置）/ 九层开关 / 手动优先链
   ④ 无障碍：dialog 语义 / aria-live / 焦点归还 / Tab 循环

   ⚠ 手动优先链（本批核心数据流）：
     neon_atmo_manual（装置面板九层开关）> neon_atmo_mode（三档）> 场景温差。
     scene.js 的 effectiveLayers 与 theme-boot 的首绘都必须尊重它。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);
  const conSrc = SRC.console || '';
  const tapSrc = SRC.tap || '';
  const app = stripComments(SRC.app);
  const sceneSrc = stripComments(SRC.scene || '');

  /* ================= ① 命令终端 ================= */
  {
    const CN = 'v4.3 控制台';

    /* ⚠ v5.6.3：命令从九条变八条 —— `radio` 那条走的是 <audio> 内核（window.NEONRadio），
       而内核已成死代码并删除；电台播放由常驻控制台的网易云官方 iframe 承担。 */
    T(CN, 'R230 终端：八条命令 + 彩蛋表 + 历史键齐备',
      ['help', 'goto', 'search', 'hue', 'theme', 'atmo', 'whoami', 'clear']
        .every(function (k) { return new RegExp("'" + k + "'|" + k + ':').test(conSrc); }) &&
      /var EGGS = \{/.test(conSrc) &&
      /neon_console_hist/.test(conSrc) &&
      /window\.NEONConsole = \{/.test(conSrc),
      '命令或彩蛋表缺项');

    /* 接线：路由改 hash（走既有 parseHash）；hue/theme/atmo 走 NEONControls（惰性）
       ⚠ v5.6.3 改判：原先这条还钉 window.NEONRadio（<audio> 内核）。
       内核已成死代码并删除，radio 命令也一并撤下 —— 现在钉的是
"控制台不再引它"，防止有人又把死内核接回终端。 */
    /* ⚠ 必须扫**剥过注释**的源码：本文件上方那段说明里就写着 NEONRadio（留痕），
       用原文扫会自己把自己判红（与 35 号 R143 同一个坑）。 */
    const conCode = stripComments(conSrc);
    T(CN, 'R230b 接线全部走既有系统：hash 路由 + NEONControls 惰性（且不再依赖已删内核）',
      /location\.hash = GOTO_MAP\[key\]/.test(conCode) &&
      /'#\/search\/' \+ encodeURIComponent\(q\)/.test(conCode) &&
      /window\.NEONControls \|\| null/.test(conCode) &&
      /c\.setHue\(n\)/.test(conCode) && /c\.setTheme\(m\)/.test(conCode) && /c\.setAtmoMode\(m\)/.test(conCode) &&
      !/NEONRadio/.test(conCode),
      '接线缺项、未惰性，或把已删的电台内核接回来了');

    T(CN, 'R230c 无障碍三件：role=dialog / 输出区 role=log aria-live / 焦点归还',
      /role="dialog"/.test(conSrc) &&
      /role="log" aria-live="polite"/.test(conSrc) &&
      /lastFocus/.test(conSrc) && /lastFocus\.focus\(\)/.test(conSrc) &&
      /document\.contains\(lastFocus\)/.test(conSrc),
      '无障碍语义缺项');

    T(CN, 'R230d 键盘四键：Enter 执行 / ↑↓ 历史 / Esc 关闭 / Tab 面板内循环',
      /key === 'Enter'/.test(conSrc) &&
      /key === 'ArrowUp'/.test(conSrc) && /key === 'ArrowDown'/.test(conSrc) &&
      /key === 'Escape'/.test(conSrc) &&
      /ev\.shiftKey \? -1 : 1/.test(conSrc),
      '键盘处理缺项');

    /* keys.js：Ctrl+`（物理码）+ Esc 优先收终端 + 帮助条目 */
    T(CN, 'R230e 快捷键：Ctrl+` 在"放行 Ctrl 组合"之前特判（用 ev.code）',
      /ev\.code === 'Backquote'/.test(SRC.keys) &&
      /window\.NEONConsole\.toggle/.test(SRC.keys) &&
      /window\.NEONConsole\.isOpen/.test(SRC.keys) &&
      /Ctrl\+`/.test(SRC.keys),
      '快捷键接线缺项');
  }

  /* ================= ② 点击反馈 ================= */
  {
    const CN = 'v4.3 控制台';

    T(CN, 'R231 点击反馈：三档强度 + pointerdown + hover/reduce 双闸 + 自清理',
      /var MODES = \['off', 'normal', 'heavy'\]/.test(tapSrc) &&
      /'pointerdown'/.test(tapSrc) &&
      /* ⚠ 双闸必须钉"调用点"：只查 prefers-reduced-motion 字样会漏掉
         "函数在、调用被删"（反向验证实锤：删调用后本断言假绿）——
         与 B3 R220e 同款教训，此处直接钉调用形态。 */
      /if \(!hoverable\(\) \|\| reduced\(\)\) return;/.test(tapSrc) &&
      /animationend/.test(tapSrc) && /el\.remove\(\)/.test(tapSrc),
      '反馈逻辑缺项');

    T(CN, 'R231b 反馈样式：光环动画 + 重度档增强 + reduce 隐藏',
      /\.tap-ripple\s*\{[^}]*animation:\s*tap-ring/.test(css) &&
      /\.tap-ripple\.is-heavy/.test(css) &&
      /\.tap-ripple\s*\{\s*display:\s*none\s*!important/.test(css),
      '反馈样式缺项');
  }

  /* ================= ③ 装置面板 ================= */
  {
    const CN = 'v4.3 控制台';

    T(CN, 'R232 面板四组：氛围三档 + 旧偏好恢复入口 / 装置区三件',
      /function atmoModesHtml/.test(app) && !/function atmoLayersHtml/.test(app) &&
      /function deviceZoneHtml/.test(app) &&
      /data-atmo-val/.test(app) && /data-tap-val/.test(app) &&
      /id="atmo-reset"/.test(app) && /id="atmo-lock"/.test(app) && /id="replay-boot"/.test(app),
      '面板结构缺项');

    T(CN, 'R232b 三档使用直观文案并兼容原存储值',
      /n:\s*'静谧'/.test(app) && /n:\s*'标准'/.test(app) && /n:\s*'梦游'/.test(app) &&
      /v:\s*'pollution'/.test(app), '静谧 / 标准 / 梦游');

    /* 控制面：模式切换清手动 / 层开关从当前层集复制 / 恢复自动清键 */
    T(CN, 'R232c 控制面三则：切模式清手动 / 首扳从现状复制 / 恢复清键回落场景',
      /removeItem\(ATMO_MANUAL_KEY\)/.test(app) &&
      /getAttribute\('data-atmo'\) \|\| ''\)\.split\(' '\)/.test(app) &&
      /function resetAtmoManual/.test(app) && /function reapplyAtmo/.test(app),
      '控制面缺项');

    T(CN, 'R232d 旧手动偏好先迁移再过滤场景，reapply 不换路由',
      /function effectiveLayers/.test(sceneSrc) &&
      /function readManual/.test(sceneSrc) &&
      /function reapply/.test(sceneSrc) &&
      /manual !== null/.test(sceneSrc) && /allowed\.indexOf\(id\)/.test(sceneSrc),
      '优先链缺项');

    T(CN, 'R232e 首绘前同样尊重手动列表（theme-boot 的 data-atmo 写入）',
      /neon_atmo_manual/.test(SRC.themeBoot) &&
      /JSON\.parse\(window\.localStorage\.getItem\('neon_atmo_manual'\)\)/.test(SRC.themeBoot),
      '首绘未读手动列表');

    T(CN, 'R232f 面板控件样式齐：模式/恢复/装置按钮 + 面板限高滚动',
      /\.atmo-mode, \.tap-mode/.test(css) &&
      /\.atmo-reset/.test(css) &&
      /\.device-toggle\[aria-checked="true"\]/.test(css) &&
      /\.theme-menu\s*\{[^}]*max-height:/.test(css),
      '样式缺项');
  }

  /* ================= ④ 行为（jsdom 真渲染） ================= */
  {
    const CN = 'v4.3 控制台';
    const ctx = bootDom({ url: 'https://x.test/#/' });
    /* ⚠ 等 #theme-menu 而非 NEONConsole：后者在 console.js eval 时即定义（同步），
       而 panel 是 app.js 的 boot → renderNav 后才在 DOM 里 —— 等错对象会导致
       "menu 为 null"的崩溃（崩溃 ≠ 报红，两种失败要分清）。 */
    await waitFor(function () {
      return !!ctx.doc.getElementById('theme-menu') && !!ctx.w.NEONConsole;
    }, 5000);

    /* 终端开合 + 输出 */
    const C = ctx.w.NEONConsole;
    C.open();
    const panel = ctx.doc.getElementById('neon-console');
    T(CN, 'R233 终端开合：open 后可见且 isOpen=true',
      !!panel && !panel.hidden && C.isOpen() === true,
      'open 未生效');

    C.exec('help');
    const outText = (ctx.doc.getElementById('console-out') || {}).textContent || '';
    T(CN, 'R233b exec("help") 输出命令清单；未识别命令输出错误行',
      /goto/.test(outText) && /hue/.test(outText),
      '输出异常：' + outText.slice(0, 60));

    C.exec('nonsense-command');
    const out2 = (ctx.doc.getElementById('console-out') || {}).textContent || '';
    T(CN, 'R233c 未识别输入有明确反馈（不静默失败）',
      /未识别/.test(out2),
      '未报未识别');

    /* 彩蛋：非正式命令但有回应 */
    C.exec('42');
    const out3 = (ctx.doc.getElementById('console-out') || {}).textContent || '';
    T(CN, 'R233d 彩蛋命令有回应（42 → 终极答案梗）',
      /终极答案/.test(out3),
      '彩蛋无输出');

    /* hue 命令真的改色相（经 NEONControls → app 的 setHue） */
    C.exec('hue 280');
    const hueNow = ctx.doc.documentElement.style.getPropertyValue('--hue');
    T(CN, 'R233e exec("hue 280") 经 NEONControls 落地（--hue 变 280）',
      String(hueNow).trim() === '280',
      '--hue=' + hueNow);

    /* 历史写入 */
    T(CN, 'R233f 历史写入 sessionStorage（本会话 ↑↓ 可用）',
      ctx.w.sessionStorage.getItem('neon_console_hist') !== null &&
      /help/.test(ctx.w.sessionStorage.getItem('neon_console_hist') || ''),
      '历史未写入');

    /* 关闭 + 焦点归还（打开前记录的元素） */
    C.close();
    T(CN, 'R233g close 后 hidden=true 且 isOpen=false（焦点归还同路径）',
      panel.hidden === true && C.isOpen() === false,
      'close 未生效');

    /* 装置面板行为：点 silent → 层集清空；点层开关 → 手动写入 */
    const menu = ctx.doc.getElementById('theme-menu');
    const silentBtn = menu && menu.querySelector('[data-atmo-val="silent"]');
    if (silentBtn) silentBtn.click();
    const atmoNow = ctx.doc.documentElement.getAttribute('data-atmo');
    T(CN, 'R233h 点「静音」→ data-atmo 清空（scene.reapply 生效）',
      atmoNow === '',
      'atmo=[' + atmoNow + ']');

    ctx.w.localStorage.setItem('neon_atmo_manual', JSON.stringify(['bloom', 'noise', 'rain']));
    const standardBtn = menu.querySelector('[data-atmo-val="standard"]');
    if (standardBtn) standardBtn.click();
    const manualRaw = ctx.w.localStorage.getItem('neon_atmo_manual');
    const atmoAfter = ctx.doc.documentElement.getAttribute('data-atmo');
    T(CN, 'R233i 选择标准档清除旧手动设置并应用静态背景',
      manualRaw === null && atmoAfter === 'glow grid' && standardBtn.getAttribute('aria-checked') === 'true',
      'manual=' + manualRaw + ' / atmo=[' + atmoAfter + ']');
    T(CN, 'R233j 面板只显示三档氛围入口，不再铺九层开关',
      menu.querySelectorAll('[data-atmo-layer]').length === 0 &&
      menu.querySelectorAll('[data-atmo-val]').length === 3 &&
      menu.querySelectorAll('[data-tap-val]').length === 3,
      menu.querySelectorAll('[data-atmo-layer]').length + ' 独立开关');

    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v4.3 控制台：终端/反馈/装置面板" };

standalone(module, run);
