'use strict';
/* ============================================================
   tests/cases/16-o16-auto-收口.js — O16 AUTO 收口
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L879-909
   独立运行：node tests/cases/16-o16-auto-收口.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ---- 2.1.0：AUTO 收口的兼容与归一化 ---- */
  {
    /* 存量 'auto' 值必须被归一化为 dark 并就地改写，不能：
       ① 崩掉  ② 显示成 AUTO（那个选项已不存在）  ③ 保持 auto 让语义含糊
       注意：storage 预置只在 themeBoot 分支里生效，故必须传 themeBoot:true，
       否则 storage 根本写不进去（会读到 null，断言全部失去意义）。 */
    const c = bootDom({ captureConsole: true, themeBoot: true, storage: { neon_theme: 'auto' } });
    await waitFor(() => !!c.doc.getElementById('btn-theme'), 3000);
    await new Promise(r => setTimeout(r, 150));
    const btn = c.doc.getElementById('btn-theme');
    T('O16 AUTO 收口', 'R77 源码中已无三态数组（auto 从循环里摘除）',
      !/\['dark',\s*'light',\s*'auto'\]/.test(SRC.app));
    T('O16 AUTO 收口', 'R77b THEME_ICON 不再含 auto 项',
      !/THEME_ICON\s*=\s*\{[^}]*auto:/.test(SRC.app));
    T('O16 AUTO 收口', 'R77c 按钮文案不含 AUTO（不会再出现无效选项）',
      !!btn && !/AUTO/.test(btn.textContent), btn ? btn.textContent : '无按钮');
    T('O16 AUTO 收口', 'R77d 存量 auto 用户看到暗色（归一化到默认值）',
      c.doc.documentElement.getAttribute('data-theme') === 'dark',
      String(c.doc.documentElement.getAttribute('data-theme')));
    T('O16 AUTO 收口', 'R77e 存量 auto 值被就地改写为 dark（下次启动无需再判断）',
      c.w.localStorage.getItem('neon_theme') === 'dark',
      String(c.w.localStorage.getItem('neon_theme')));

    /* v2.9.4：改为罗盘直选 —— 存量 auto 用户展开时，DARK 项应当已经是选中态
       （证明归一化后的 dark 与面板显示一致，没有"属性是 dark、面板却没选中"的漂移） */
    const menu = c.doc.getElementById('theme-menu');
    const darkOpt = menu && menu.querySelector('[data-theme-val="dark"]');
    T('O16 AUTO 收口', 'R77g 存量 auto 用户展开罗盘时 DARK 项已选中（归一化与显示一致）',
      !!darkOpt && darkOpt.getAttribute('aria-checked') === 'true',
      darkOpt ? String(darkOpt.getAttribute('aria-checked')) : '无 DARK 项');

    /* 直选 LIGHT（而不是"循环到下一档"）—— 应当直接生效，不经过任何中间态 */
    btn.click();
    await new Promise(r => setTimeout(r, 30));
    const lightOpt = menu && menu.querySelector('[data-theme-val="light"]');
    if (lightOpt) lightOpt.click();
    await new Promise(r => setTimeout(r, 60));
    T('O16 AUTO 收口', 'R77f auto 存量用户选 LIGHT 后直接生效（跳过已废弃的中间态）',
      c.doc.documentElement.getAttribute('data-theme') === 'light' &&
      c.w.localStorage.getItem('neon_theme') === 'light',
      c.doc.documentElement.getAttribute('data-theme'));
    c.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O16 AUTO 收口" };

standalone(module, run);
