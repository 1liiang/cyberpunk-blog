'use strict';
/* ============================================================
   tests/cases/24-o13-键盘可达.js — O13 键盘可达
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L2005-2235
   独立运行：node tests/cases/24-o13-键盘可达.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments, stripJsLineComments, cssBlockAt } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ---- O13：C10 键盘可达 ---- */
  {
    const html = SRC.html || '';
    const cssBare = stripComments(SRC.css || '');
    const keysBare = stripComments(stripJsLineComments(SRC.keys || ''));

    /* --- 结构：跳转链接与帮助面板容器 --- */
    T('O13 键盘可达', 'R67 index.html 含「跳到主内容」跳转链接',
      /class="skip-link"[^>]*href="#app"/.test(html));
    T('O13 键盘可达', 'R67b 跳转链接是页面首个可聚焦元素（排在其他内容之前）',
      html.indexOf('skip-link') < html.indexOf('<header class="topbar"'));
    T('O13 键盘可达', 'R67c 主内容容器带 tabindex="-1"（可被编程聚焦）',
      /<main[^>]*id="app"[^>]*tabindex="-1"/.test(html));
    T('O13 键盘可达', 'R67d 顶部导航带 aria-label（读屏可识别为「主导航」）',
      /<nav[^>]*id="nav"[^>]*aria-label=/.test(html));
    T('O13 键盘可达', 'R67e 快捷键帮助面板容器为 role="dialog" + aria-modal',
      /id="kbd-help"[^>]*role="dialog"/.test(html) && /id="kbd-help"[^>]*aria-modal="true"/.test(html));

    /* --- CSS：焦点可见性 --- */
    /* ⚠ 这条断言踩过一次假绿（已修复，记在这里防回退）：
       最初写成 /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--cyan\)/，
       看似精确，实则会被**别处的** .search-input:focus-visible 等规则命中 ——
       把裸 :focus-visible 整条删掉，测试依然全绿。
       现在改为：先切出选择器恰好等于 ":focus-visible" 的那条规则体，再查它内部，
       保证守的是"全站兜底焦点环"这一条本身，而不是任何一条带 focus-visible 后缀的规则。 */
    const globalFocusRule = (function () {
      /* 裸 :focus-visible 规则：行首（允许前导空白）就是 ":focus-visible" 后跟 "{"。
         不能写成子串匹配 —— .search-input:focus-visible 也含该子串，
         会造成"改了兜底规则测试却仍绿"的假绿（实测验证过）。 */
      const m = /^[ \t]*:focus-visible\s*\{/m.exec(cssBare);
      /* D3：同上，配平逻辑统一走 common.js */
      return m ? cssBlockAt(cssBare, m.index) : '';
    })();

    T('O13 键盘可达', 'R68 CSS 定义了裸 :focus-visible 全站兜底焦点环',
      globalFocusRule !== '' && /outline:\s*2px solid var\(--cyan\)/.test(globalFocusRule),
      globalFocusRule ? '命中规则体' : '未找到裸 :focus-visible 规则');
    T('O13 键盘可达', 'R68a 兜底焦点环带 outline-offset（贴边元素也能看清）',
      /outline-offset:\s*\dpx/.test(globalFocusRule));
    /* 反向保护：绝不能"为了让焦点环更干净"而全局干掉 outline。
       这是无障碍最常见的破坏方式（去掉 outline 却不给替代）。 */
    T('O13 键盘可达', 'R68b CSS 未出现全局 outline:none（只在有替代方案的具体元素上）',
      !/\*\s*\{[^}]*outline:\s*none/.test(cssBare));
    T('O13 键盘可达', 'R68c 编辑器正文焦点环交由容器 :focus-within 承担',
      /#editor-textarea:focus-visible\s*\{\s*outline:\s*none/.test(cssBare) &&
      /\.editor-pane:focus-within/.test(cssBare));
    T('O13 键盘可达', 'R68d 跳转链接平时视觉隐藏、聚焦时显现',
      /\.skip-link\s*\{[^}]*left:\s*-9999px/.test(cssBare) &&
      /\.skip-link:focus\s*\{[^}]*left:\s*12px/.test(cssBare));

    /* --- 运行时：真派发 KeyboardEvent，验证行为而非源码字样 --- */
    const kc = bootDom({ captureConsole: true });
    await waitFor(() => !!kc.doc.getElementById('btn-theme'), 3000);
    await new Promise(r => setTimeout(r, 120));

    T('O13 键盘可达', 'R69 keys.js 已加载并暴露 NEONKeys',
      typeof kc.w.NEONKeys === 'object' && typeof kc.w.NEONKeys.handleKey === 'function');

    /* 派发键事件的助手：target 默认挂在 body 上（非输入态） */
    function press(key, opts) {
      opts = opts || {};
      const ev = new kc.w.KeyboardEvent('keydown', {
        key: key, bubbles: true, cancelable: true,
        shiftKey: !!opts.shift, ctrlKey: !!opts.ctrl, metaKey: !!opts.meta, altKey: !!opts.alt
      });
      const t = opts.target || kc.doc.body;
      t.dispatchEvent(ev);
      return ev;
    }

    /* Esc / 修饰键放行 */
    T('O13 键盘可达', 'R69b Ctrl/Cmd 组合键不被拦截（不抢浏览器快捷键）',
      kc.w.NEONKeys.handleKey({ key: 'k', ctrlKey: true, target: kc.doc.body }) === false &&
      kc.w.NEONKeys.handleKey({ key: 's', metaKey: true, target: kc.doc.body }) === false);
    T('O13 键盘可达', 'R69c Alt 组合键不被拦截',
      kc.w.NEONKeys.handleKey({ key: 'Tab', altKey: true, target: kc.doc.body }) === false);

    /* 输入态豁免 —— 这条最容易被实现者忽略，也最容易伤用户 */
    {
      const input = kc.doc.createElement('input');
      kc.doc.body.appendChild(input);
      T('O13 键盘可达', 'R69d 输入框内打 "/" 不被拦截（否则搜不了带斜杠的内容）',
        kc.w.NEONKeys.handleKey({ key: '/', target: input }) === false);
      T('O13 键盘可达', 'R69e 输入框内打 "?" 不被拦截（否则问号永远打不出）',
        kc.w.NEONKeys.handleKey({ key: '?', target: input }) === false &&
        !kc.w.NEONKeys.helpOpen());
      /* textarea 同样豁免 */
      const ta = kc.doc.createElement('textarea');
      kc.doc.body.appendChild(ta);
      T('O13 键盘可达', 'R69f textarea 内按键同样豁免',
        kc.w.NEONKeys.handleKey({ key: '/', target: ta }) === false);
      T('O13 键盘可达', 'R69g isTyping 正确识别 input/textarea',
        kc.w.NEONKeys.isTyping(input) === true && kc.w.NEONKeys.isTyping(ta) === true &&
        kc.w.NEONKeys.isTyping(kc.doc.body) === false);
      input.remove(); ta.remove();
    }

    /* "?" 唤起帮助面板 + Esc 关闭（端到端，走真实事件） */
    {
      press('?', { shift: true });
      await new Promise(r => setTimeout(r, 30));
      const helpEl = kc.doc.getElementById('kbd-help');
      T('O13 键盘可达', 'R69h 按 "?" 唤起快捷键帮助面板',
        !!helpEl && !helpEl.hidden, helpEl ? ('hidden=' + helpEl.hidden) : '无容器');
      T('O13 键盘可达', 'R69i 帮助面板渲染了快捷键清单（且与 KEYS 同源）',
        !!helpEl && helpEl.querySelectorAll('.kbd-help-row').length >= kc.w.NEONKeys.KEYS.length,
        helpEl ? helpEl.querySelectorAll('.kbd-help-row').length + ' 行 / KEYS ' + kc.w.NEONKeys.KEYS.length + ' 项' : '-');
      /* 每一项都必须被渲染出来 —— 防止"面板打开了但清单是空的"这种半成品 */
      T('O13 键盘可达', 'R69i2 KEYS 中每条快捷键都出现在面板里（无遗漏）',
        !!helpEl && kc.w.NEONKeys.KEYS.every(function (it) {
          return helpEl.textContent.indexOf(it.k) !== -1;
        }));

      press('Escape');
      await new Promise(r => setTimeout(r, 30));
      T('O13 键盘可达', 'R69j 按 Esc 关闭帮助面板',
        kc.doc.getElementById('kbd-help').hidden === true);
    }

    /* "g 前缀" 跳转 */
    {
      kc.w.location.hash = '#/';
      await new Promise(r => setTimeout(r, 60));
      press('g');
      press('a');
      await new Promise(r => setTimeout(r, 80));
      T('O13 键盘可达', 'R69k "g a" 跳转到归档页',
        kc.w.location.hash === '#/archive', kc.w.location.hash);

      press('g');
      press('t');
      await new Promise(r => setTimeout(r, 80));
      T('O13 键盘可达', 'R69l "g t" 跳转到标签页',
        kc.w.location.hash === '#/tags', kc.w.location.hash);

      /* 前缀超时/非法第二键：不应乱跳 */
      kc.w.location.hash = '#/about';
      await new Promise(r => setTimeout(r, 60));
      press('g');
      press('z'); /* 非法 */
      await new Promise(r => setTimeout(r, 60));
      T('O13 键盘可达', 'R69m "g" 后跟非法键不跳转（静默取消，不误动作）',
        kc.w.location.hash === '#/about', kc.w.location.hash);
    }

    /* "/" 聚焦搜索 */
    {
      kc.w.location.hash = '#/search';
      await new Promise(r => setTimeout(r, 200));
      const si = kc.doc.getElementById('search-input');
      T('O13 键盘可达', 'R69n 搜索页存在 #search-input', !!si);
      if (si) {
        kc.doc.body.focus();
        press('/');
        await new Promise(r => setTimeout(r, 60));
        T('O13 键盘可达', 'R69o 按 "/" 把焦点移到搜索框',
          kc.doc.activeElement === si,
          kc.doc.activeElement ? (kc.doc.activeElement.id || kc.doc.activeElement.tagName) : 'null');
      }
    }

    /* 模态焦点陷阱：真实打开一个模态，检查焦点落入 + Tab 循环 + 归还 */
    {
      const trigger = kc.doc.getElementById('btn-theme');
      if (trigger && trigger.focus) trigger.focus();
      const beforeFocus = kc.doc.activeElement;

      /* 通过 changelog 按钮打开模态（它调 openModal） */
      const logBtn = kc.doc.getElementById('btn-changelog');
      T('O13 键盘可达', 'R70 存在可打开模态的入口（工程日志按钮）', !!logBtn);
      if (logBtn) {
        logBtn.click();
        await new Promise(r => setTimeout(r, 80));
        const mask = kc.doc.getElementById('neon-modal');
        T('O13 键盘可达', 'R70b 模态已打开', !!mask);
        T('O13 键盘可达', 'R70c 模态带 role="dialog" + aria-modal（读屏可识别）',
          !!mask && mask.getAttribute('role') === 'dialog' && mask.getAttribute('aria-modal') === 'true');
        T('O13 键盘可达', 'R70d 打开后焦点被移入模态内（不会留在背景页）',
          !!mask && mask.contains(kc.doc.activeElement),
          kc.doc.activeElement ? (kc.doc.activeElement.className || kc.doc.activeElement.tagName) : 'null');

        /* Tab 循环：在最后一个可聚焦元素上按 Tab 应回到第一个 */
        if (mask) {
          const items = kc.w.NEONKeys.focusablesIn(mask);
          T('O13 键盘可达', 'R70e 模态内可识别出可聚焦元素', items.length > 0, items.length + ' 个');
          if (items.length > 1) {
            const last = items[items.length - 1];
            last.focus();
            const tabEv = new kc.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            /* 陷阱监听挂在容器上，故从容器内元素派发 */
            last.dispatchEvent(tabEv);
            T('O13 键盘可达', 'R70f 末位元素 Tab 后焦点回到首位（焦点被关在模态内）',
              kc.doc.activeElement === items[0],
              kc.doc.activeElement ? (kc.doc.activeElement.className || kc.doc.activeElement.tagName) : 'null');

            /* Shift+Tab 反向 */
            items[0].focus();
            const stabEv = new kc.w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
            items[0].dispatchEvent(stabEv);
            T('O13 键盘可达', 'R70g 首位元素 Shift+Tab 后焦点跳到末位（反向循环）',
              kc.doc.activeElement === last,
              kc.doc.activeElement ? (kc.doc.activeElement.className || kc.doc.activeElement.tagName) : 'null');
          }
        }

        /* Esc 关模态并归还焦点 */
        press('Escape');
        await new Promise(r => setTimeout(r, 80));
        T('O13 键盘可达', 'R70h Esc 关闭模态',
          !kc.doc.getElementById('neon-modal'));
        T('O13 键盘可达', 'R70i 关闭后焦点归还给触发元素（键盘用户不迷路）',
          kc.doc.activeElement === beforeFocus,
          kc.doc.activeElement === beforeFocus ? '已归还' :
            (kc.doc.activeElement ? (kc.doc.activeElement.id || kc.doc.activeElement.tagName) : 'null'));
      }
    }

    /* 静态守卫：keys.js 绝不能有内联事件 / 外域依赖（CSP 与供应链双约束） */
    T('O13 键盘可达', 'R71 keys.js 无内联 on* 事件属性写法',
      !/\bon(click|keydown|keyup|focus)\s*=\s*["']/.test(keysBare));
    T('O13 键盘可达', 'R71b keys.js 零外域请求',
      !/https?:\/\//.test(keysBare));
    T('O13 键盘可达', 'R71c keys.js 只在无修饰键或 Shift 场景工作（不抢 Ctrl/Alt/Meta）',
      /ctrlKey\s*\|\|\s*ev\.altKey\s*\|\|\s*ev\.metaKey/.test(keysBare));
    T('O13 键盘可达', 'R71d index.html 已引入 keys.js（带版本查询串）',
      /src="js\/keys\.js\?v=[0-9.]+"/.test(html));
    T('O13 键盘可达', 'R71e keys.js 排在 app.js 之前（app 的模态要用到它的 trapFocus）',
      html.indexOf('js/keys.js') !== -1 &&
      html.indexOf('js/keys.js') < html.indexOf('js/app.js'));

    kc.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O13 键盘可达" };

standalone(module, run);
