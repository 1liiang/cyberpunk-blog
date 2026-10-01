'use strict';
/* ============================================================
   C10：键盘可达层 —— 全局快捷键 + 模态焦点陷阱
   ------------------------------------------------------------
   独立成文件（而非塞进 app.js）的理由：
     ① app.js 已 1777 行，再塞一段键盘逻辑会让它更难维护；
     ② 本模块边界清晰、依赖极少，可被测试单独加载与断言行为
        （jsdom 里直接派发 KeyboardEvent，验证真实响应，
         而不是断言"源码里有 keydown 字样"这种假绿写法）；
     ③ 后续 C14（命令面板）会复用同一套「前缀键」状态机。

   ★ 设计约束（不可削弱）：
     ① 不劫持浏览器保留键。Ctrl/Cmd 组合、F5、Ctrl+T 等一律放行。
        本模块只在【无修饰键】或【Shift+?】的场景下工作。
     ② 输入态豁免。焦点在 input / textarea / contenteditable 内时，
        除 Esc 外一律不响应 —— 否则用户打不出 "?" 和 "/" 这两个常见字符。
        这是快捷键实现最经典的坑：拦了按键，用户在搜索框里就搜不了带斜杠的内容。
     ③ 不猜、不静默失败。所有动作都走显式注册表，没有匹配就彻底放手。
     ④ 一切 DOM 操作都判空。本模块可能在任何页面状态下被调用。

   对外接口（window.NEONKeys）：
     · init(opts)          装全局 keydown 监听（幂等，重复调用只装一次）
     · handleKey(ev, ctx)  纯函数式的按键处理，返回 true 表示已消费
     · trapFocus(container) 给模态挂焦点陷阱，返回释放函数
     · KEYS                 快捷键清单（供帮助面板渲染，单一数据源）
   ============================================================ */
(function () {
  var doc = document;

  /* 快捷键清单 —— 帮助面板与实现共用这一份，避免"写在两处、改漏一处"。
     显示文案里刻意用 <kbd> 包裹按键，方便排版。 */
  var KEYS = [
    { k: '/', desc: '聚焦搜索框' },
    { k: 'Esc', desc: '关闭弹窗 / 清空搜索' },
    { k: 'Ctrl+`', desc: '唤起命令终端' },
    { k: 'g h', desc: '跳转首页' },
    { k: 'g t', desc: '跳转标签' },
    { k: 'g a', desc: '跳转归档' },
    { k: 'g b', desc: '跳转关于' },
    { k: '?', desc: '显示本帮助' }
  ];

  /* ---- 输入态判定：焦点在可编辑元素内 ---- */
  function isTyping(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    /* 元素可能已被移除（modal 关闭后焦点还挂在旧节点上） */
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  /* ---- g 前缀状态：按下 g 后短暂等待第二个键 ---- */
  var gTimer = null;
  var gPending = false;
  var G_WINDOW = 1200; /* ms */

  function clearPendingG() {
    if (gTimer) { clearTimeout(gTimer); gTimer = null; }
    gPending = false;
  }

  function armPendingG() {
    clearPendingG();
    gPending = true;
    gTimer = setTimeout(function () { gPending = false; gTimer = null; }, G_WINDOW);
  }

  /* 全局跳转表 —— g 后的第二个键 → hash */
  var GOTO = { h: '#/', t: '#/tags', a: '#/archive', b: '#/about' };

  /* ---- 模态焦点陷阱 ---- */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusablesIn(container) {
    if (!container || !container.querySelectorAll) return [];
    var list = container.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (isVisible(list[i])) out.push(list[i]);
    }
    return out;
  }

  /* 可见性判定 —— 这里踩过一个真实会发作的坑：
     最初用的是 `el.offsetParent === null`，它在两种情况下会误判：
       ① **position:fixed 的元素**，浏览器规范里 offsetParent 恒为 null，
          而本项目模态遮罩 .modal-mask 正是 position:fixed ——
          也就是说真实浏览器上模态内的全部按钮都会被误判为"不可见"，
          焦点陷阱直接把焦点扔回背景页，功能等于没做。
       ② jsdom 无布局引擎，所有元素 offsetParent 都是 null，测试环境全灭。
     改用 getClientRects()：它对 fixed 元素正常返回，且能反映真实布局结果；
     再叠加内联样式上的 display/visibility 显式否决（覆盖 jsdom 无布局的缺口）。 */
  function isVisible(el) {
    if (!el) return false;
    /* 显式否决：内联 display:none / visibility:hidden */
    var st = el.style;
    if (st) {
      if (st.display === 'none') return false;
      if (st.visibility === 'hidden') return false;
    }
    /* hidden 属性（如 <div hidden>）—— 元素确实不该被 Tab 到 */
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    /* 布局层面：无任何盒子则不可聚焦。
       注意 getClientRects 在 jsdom 中恒返回空列表，故下面还有兜底。 */
    if (el.getClientRects) {
      var rects = el.getClientRects();
      if (rects && rects.length > 0) return true;
    }
    /* jsdom / 无布局环境：退化为"属性层面未隐藏"即视为可见。
       getComputedStyle 在 jsdom 里可用，配合上面的内联否决足够区分
       "作者故意隐藏"与"引擎没有布局能力"这两件事。 */
    try {
      var cs = el.ownerDocument.defaultView.getComputedStyle(el);
      if (cs) {
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
    } catch (e) { /* 忽略 */ }
    return true;
  }

  /* 给模态挂焦点陷阱。返回释放函数（幂等）。
     行为：
       · 打开时把焦点移入第一个可聚焦元素（否则焦点仍留在页面上，Tab 会跑出去）
       · Tab / Shift+Tab 在首尾之间循环
       · 记录打开前的焦点，关闭时归还（键盘用户回到触发点，不会"迷路"） */
  function trapFocus(container) {
    if (!container) return function () {};
    var prev = doc.activeElement;
    var released = false;

    function onKeyDown(ev) {
      if (ev.key !== 'Tab') return;
      var items = focusablesIn(container);
      if (items.length === 0) {
        /* 没有任何可聚焦项：把焦点钉在容器上，别让它跑回页面 */
        ev.preventDefault();
        if (container.focus) container.focus();
        return;
      }
      var first = items[0];
      var last = items[items.length - 1];
      var active = doc.activeElement;

      if (ev.shiftKey) {
        if (active === first || !container.contains(active)) {
          ev.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container.contains(active)) {
          ev.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener('keydown', onKeyDown);

    /* 初始聚焦：优先第一个可聚焦元素，退而求其次聚焦容器本身 */
    var items0 = focusablesIn(container);
    if (items0.length > 0) {
      try { items0[0].focus(); } catch (e) { /* 忽略 */ }
    } else if (container.focus) {
      try { container.focus(); } catch (e) { /* 忽略 */ }
    }

    return function release() {
      if (released) return;
      released = true;
      container.removeEventListener('keydown', onKeyDown);
      /* 焦点归还：仅当它还在陷阱内时才归还，避免抢走用户已经移动的焦点 */
      try {
        if (prev && prev.focus && (!doc.activeElement || container.contains(doc.activeElement))) {
          prev.focus();
        }
      } catch (e) { /* 旧节点可能已销毁，忽略 */ }
    };
  }

  /* ---- 帮助面板 ---- */
  function renderHelpHtml() {
    var rows = KEYS.map(function (it) {
      return '<div class="kbd-help-row"><span>' + it.desc + '</span><kbd>' + it.k + '</kbd></div>';
    }).join('');
    return '<div class="kbd-help-inner" tabindex="-1" role="dialog" aria-label="键盘快捷键">' +
      '<h3>⌨ 键盘快捷键</h3>' + rows +
      '<div class="kbd-help-row" style="margin-top:10px;color:var(--text-dim)">' +
      '<span>关闭</span><kbd>Esc</kbd></div></div>';
  }

  var helpTrap = null;

  function openHelp() {
    var el = doc.getElementById('kbd-help');
    if (!el || !el.hidden) return;
    el.innerHTML = renderHelpHtml();
    el.hidden = false;
    var inner = el.querySelector('.kbd-help-inner');
    helpTrap = trapFocus(inner || el);
  }

  function closeHelp() {
    var el = doc.getElementById('kbd-help');
    if (!el || el.hidden) return;
    if (helpTrap) { helpTrap(); helpTrap = null; }
    el.hidden = true;
    el.innerHTML = '';
  }

  function helpOpen() {
    var el = doc.getElementById('kbd-help');
    return !!el && !el.hidden;
  }

  /* ---- 动作表 ---- */
  function focusSearch() {
    /* 若不在搜索页，先跳过去；hash 变更触发的渲染是异步的，
       故跳转后短暂等待再聚焦。 */
    var input = doc.getElementById('search-input');
    if (!input) {
      if (location.hash !== '#/search') {
        location.hash = '#/search';
        setTimeout(function () {
          var el = doc.getElementById('search-input');
          if (el && el.focus) el.focus();
        }, 120);
      }
      return true;
    }
    try { input.focus(); } catch (e) { /* 忽略 */ }
    return true;
  }

  function clearSearch() {
    var input = doc.getElementById('search-input');
    if (input && input.value) {
      input.value = '';
      /* 清空后回到搜索页根（不带查询词），走既有单一渲染入口 */
      if (location.hash.indexOf('#/search/') === 0) location.hash = '#/search';
      return true;
    }
    return false;
  }

  function hasModal() {
    return !!doc.getElementById('neon-modal');
  }

  function closeTopLayer() {
    if (helpOpen()) { closeHelp(); return true; }
    if (hasModal()) {
      /* 直接点遮罩走的是 app.js 的 closeModal；这里派发一次等价点击，
         避免本模块反向依赖 app.js 内部函数（保持模块边界单向）。 */
      var mask = doc.getElementById('neon-modal');
      if (mask) {
        var ev;
        try {
          ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        } catch (e) {
          ev = doc.createEvent('MouseEvents');
          ev.initEvent('click', true, true);
        }
        /* 用 target = mask 自身触发 openModal 里 `e.target === mask` 的关闭分支 */
        mask.dispatchEvent(ev);
        return true;
      }
    }
    return false;
  }

  /* ---- 核心：按键处理 ----
     返回 true = 已消费（调用方应 preventDefault）。
     纯函数式（除 g 前缀状态与 help 开关外无副作用），便于测试。 */
  function handleKey(ev, opts) {
    if (!ev) return false;
    opts = opts || {};
    var key = ev.key;

    /* v4.3 B4：Ctrl+` 唤起/收起命令终端（装置③）——
       必须在下面"放行所有 Ctrl 组合"之前特判，否则会被让给浏览器。
       用 ev.code（物理键 Backquote）：中文输入态/不同键盘布局下 key 值不可靠。 */
    if (ev.ctrlKey && !ev.altKey && !ev.metaKey &&
        (ev.code === 'Backquote' || key === '`' || key === '~')) {
      ev.preventDefault();
      if (window.NEONConsole && typeof window.NEONConsole.toggle === 'function') {
        window.NEONConsole.toggle();
      }
      return true;
    }

    /* 任何插入了 Ctrl/Alt/Meta 的组合都放行 —— 不抢浏览器与系统快捷键。
       （注意：Shift 不在此列，因为 "?" 本身就需要 Shift。） */
    if (ev.ctrlKey || ev.altKey || ev.metaKey) { clearPendingG(); return false; }

    /* Esc 优先级最高：无论焦点在哪都要能关掉顶层浮层。
       这也是唯一在输入态下仍然响应的键。 */
    if (key === 'Escape' || key === 'Esc') {
      if (opts.onEscape) { if (opts.onEscape(ev)) return true; }
      /* v4.3 B4：命令终端开着时，它是"最上层"——Esc 先收终端 */
      if (window.NEONConsole && typeof window.NEONConsole.isOpen === 'function' &&
          window.NEONConsole.isOpen()) {
        window.NEONConsole.close();
        return true;
      }
      if (closeTopLayer()) return true;
      /* 没有浮层可关时，清空搜索框；也没有则放手 */
      if (clearSearch()) return true;
      clearPendingG();
      return false;
    }

    /* 输入态豁免：在输入框里打字时，除 Esc 外一概不拦。
       否则用户无法在搜索框输入 "/" 与 "?" 这两个常见字符。 */
    if (isTyping(ev.target)) { clearPendingG(); return false; }

    /* g 前缀进行中 */
    if (gPending) {
      var gk = String(key || '').toLowerCase();
      clearPendingG();
      if (GOTO[gk]) {
        location.hash = GOTO[gk];
        return true;
      }
      /* 非法第二键：静默取消，不弹错、不跳转 */
      return false;
    }

    if (key === 'g' || key === 'G') { armPendingG(); return false; }

    if (key === '/') { ev.preventDefault(); return focusSearch(); }

    /* "?" 在不同键盘布局上是 Shift+/，判断 key 即可（不自算 code） */
    if (key === '?') {
      if (helpOpen()) { closeHelp(); return true; }
      openHelp();
      return true;
    }

    return false;
  }

  /* ---- 安装 ---- */
  var installed = false;
  function init(opts) {
    if (installed) return;
    installed = true;
    opts = opts || {};
    doc.addEventListener('keydown', function (ev) {
      var consumed = false;
      try {
        consumed = handleKey(ev, opts);
      } catch (e) {
        /* 本模块自己出错绝不能拖垮页面 —— 静默并放手 */
        try { console.error('[NEON] 快捷键处理失败：', e); } catch (e2) {}
        consumed = false;
      }
      /* 只有确认消费了才阻止默认行为：
         preventDefault 必须发生在同一事件循环内，故放在这里而非 handleKey 里
         （除 "/" 分支需要立即阻止，那里已单独处理）。 */
      if (consumed && ev.cancelable && !ev.defaultPrevented) ev.preventDefault();
    });
  }

  window.NEONKeys = {
    init: init,
    handleKey: handleKey,
    trapFocus: trapFocus,
    focusablesIn: focusablesIn,
    isTyping: isTyping,
    openHelp: openHelp,
    closeHelp: closeHelp,
    helpOpen: helpOpen,
    KEYS: KEYS
  };
})();
