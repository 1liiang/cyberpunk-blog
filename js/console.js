/* ============================================================
   console.js — 命令终端（v4.3 B4 / 装置③）
   ------------------------------------------------------------
   Ctrl+` 唤起/收起。命令：help / goto / search / hue / theme / atmo /
   radio / whoami / clear，另有彩蛋（不进帮助）。
   · 历史 ↑↓（sessionStorage 记本会话）
   · 接线：路由直接改 location.hash（走现有 parseHash）；
     hue/theme/atmo 走 window.NEONControls（app.js 导出，惰性取用）；
     radio 走 window.NEONRadio —— 全部沿用既有系统，终端不重写任何逻辑。
   · 无障碍：role=dialog + 输出区 role=log aria-live=polite（读屏播报）；
     焦点管理：打开记 lastFocus、关闭归还；Tab 在面板内三件（输入/清屏/关闭）循环；
     reduce 下动效由 CSS 归零。
   · DOM 惰性构建：首次唤起才建（不拖首屏）。
   ============================================================ */
(function () {
  'use strict';

  var HIST_KEY = 'neon_console_hist';
  var HIST_MAX = 40;

  var panel = null, out = null, input = null;
  var lastFocus = null;
  var isOpen = false;
  var hist = [];
  var histIdx = -1;

  /* ---------- DOM ---------- */
  function lazyDom() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'neon-console';
    panel.className = 'console-wrap';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="console-mask" data-console-close="1"></div>' +
      '<section class="console-panel" role="dialog" aria-label="命令终端" aria-modal="true">' +
        '<header class="console-head">' +
          '<span class="console-title">▤ NEON://CONSOLE</span>' +
          '<button type="button" class="console-btn" data-console-clear="1">清屏</button>' +
          '<button type="button" class="console-btn" data-console-close="1">关闭</button>' +
        '</header>' +
        '<div class="console-out" id="console-out" role="log" aria-live="polite" aria-label="终端输出"></div>' +
        '<div class="console-in-row">' +
          '<span class="console-caret" aria-hidden="true">▸</span>' +
          '<input type="text" id="console-in" class="console-in" autocomplete="off"' +
            ' spellcheck="false" aria-label="输入命令" placeholder="help 查看命令…">' +
        '</div>' +
      '</section>';
    document.body.appendChild(panel);
    out = panel.querySelector('#console-out');
    input = panel.querySelector('#console-in');

    /* 面板内点击：清屏 / 关闭（事件委托，与全站一致） */
    panel.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-console-close],[data-console-clear]') : null;
      if (!t) return;
      if (t.hasAttribute('data-console-close')) closeConsole();
      else { out.innerHTML = ''; input.focus(); }
    });

    /* 键盘：Enter 执行 / ↑↓ 历史 / Esc 关闭 / Tab 面板内循环 */
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        var v = input.value;
        input.value = '';
        execute(v);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (histIdx < hist.length - 1) { histIdx++; input.value = hist[histIdx] || ''; }
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (histIdx > 0) { histIdx--; input.value = hist[histIdx] || ''; }
        else { histIdx = -1; input.value = ''; }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        closeConsole();
      } else if (ev.key === 'Tab') {
        /* 轻量焦点陷阱：终端只有三件可聚焦（输入/清屏/关闭），Tab 循环在内 */
        ev.preventDefault();
        var items = [input].concat(Array.prototype.slice.call(
          panel.querySelectorAll('.console-btn')));
        var idx = items.indexOf(document.activeElement);
        var next = items[(idx + (ev.shiftKey ? -1 : 1) + items.length) % items.length];
        if (next) next.focus();
      }
    });
  }

  /* ---------- 输出 ---------- */
  function print(text, cls) {
    if (!out) return;
    var line = document.createElement('div');
    line.className = 'console-line' + (cls ? ' ' + cls : '');
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
    /* 输出区上限：超长的会话不该无限涨（留最近 200 行） */
    while (out.childNodes.length > 200) out.removeChild(out.firstChild);
  }

  /* ---------- 历史 ---------- */
  function addHist(line) {
    if (hist[0] === line) return;
    hist.unshift(line);
    if (hist.length > HIST_MAX) hist.pop();
    histIdx = -1;
    try { window.sessionStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch (e) { /* 隐私模式 */ }
  }
  function loadHist() {
    try {
      var raw = window.sessionStorage.getItem(HIST_KEY);
      var arr = raw ? JSON.parse(raw) : null;
      if (Object.prototype.toString.call(arr) === '[object Array]') {
        hist = arr.filter(function (x) { return typeof x === 'string'; }).slice(0, HIST_MAX);
      }
    } catch (e) { hist = []; }
  }

  /* ---------- 命令 ---------- */
  function ctl() { return window.NEONControls || null; }

  var GOTO_MAP = {
    home: '#/', archive: '#/archive', tags: '#/tags', marks: '#/marks',
    about: '#/about', search: '#/search/', login: '#/login'
  };

  var CMDS = {
    help: { desc: 'goto <页>     跳转：home / archive / tags / marks / about / search / login' },
    search: { desc: 'search <词>    扫描全部广播（写进路由，可分享可回退）' },
    hue: { desc: 'hue <0-359>    换色相（例：hue 280）' },
    theme: { desc: 'theme <档>     dark / light / warm' },
    atmo: { desc: 'atmo <模式>    pollution / standard / silent' },
    radio: { desc: 'radio          电台 播放 / 暂停' },
    whoami: { desc: 'whoami         当前身份' },
    clear: { desc: 'clear          清屏' }
  };

  function cmdHelp() {
    print('可用命令：', 'dim');
    Object.keys(CMDS).forEach(function (k) { print('  ' + CMDS[k].desc); });
    print('（↑↓ 历史 · Esc 收起 · 彩蛋不在此列）', 'dim');
  }

  function cmdGoto(arg) {
    var key = String(arg || '').trim().toLowerCase();
    if (!GOTO_MAP[key]) {
      print('未知目的地：' + (key || '(空)') + '。可选：' + Object.keys(GOTO_MAP).join(' / '), 'err');
      return;
    }
    location.hash = GOTO_MAP[key];
    print('▸ 已跳转 → ' + key, 'ok');
    closeConsole();
  }

  function cmdSearch(arg) {
    var q = String(arg || '').trim();
    if (!q) { print('用法：search <关键词>', 'err'); return; }
    location.hash = '#/search/' + encodeURIComponent(q);
    print('▸ 正在扫描：' + q, 'ok');
    closeConsole();
  }

  function cmdHue(arg) {
    var n = parseInt(arg, 10);
    if (!isFinite(n) || n < 0 || n > 359) { print('色相要 0~359 的整数（例：hue 280）', 'err'); return; }
    var c = ctl();
    if (!c || typeof c.setHue !== 'function') { print('色相控制暂不可用（app 未就绪）', 'err'); return; }
    c.setHue(n);
    print('▸ 色相 → ' + n + '°', 'ok');
  }

  function cmdTheme(arg) {
    var m = String(arg || '').trim().toLowerCase();
    if (['dark', 'light', 'warm'].indexOf(m) === -1) { print('档位：dark / light / warm', 'err'); return; }
    var c = ctl();
    if (!c || typeof c.setTheme !== 'function') { print('主题控制暂不可用（app 未就绪）', 'err'); return; }
    c.setTheme(m);
    print('▸ 明度档 → ' + m, 'ok');
  }

  function cmdAtmo(arg) {
    var m = String(arg || '').trim().toLowerCase();
    if (['pollution', 'standard', 'silent'].indexOf(m) === -1) {
      print('模式：pollution（光污染）/ standard（标准）/ silent（静音）', 'err');
      return;
    }
    var c = ctl();
    if (!c || typeof c.setAtmoMode !== 'function') { print('氛围控制暂不可用（app 未就绪）', 'err'); return; }
    c.setAtmoMode(m);
    var n = (document.documentElement.getAttribute('data-atmo') || '').split(' ').filter(Boolean).length;
    print('▸ 氛围模式 → ' + m + '（当前 ' + n + ' 层）', 'ok');
  }

  function cmdRadio() {
    var R = window.NEONRadio;
    if (!R || typeof R.toggle !== 'function') { print('电台模块未加载', 'err'); return; }
    R.toggle();
    var st = (typeof R.state === 'function') ? R.state() : null;
    print('▸ 电台 ' + (st && st.playing ? '▶ 播放中' : '⏸ 已暂停'), 'ok');
  }

  function cmdWhoami() {
    var scene = document.body.getAttribute('data-scene') || 'unknown';
    print('◈ 访客 VISITOR');
    print('  频道 NEON://DIARY · 当前站台 ' + scene);
    print('  「信号从城市边缘来，往深夜里去。」', 'dim');
  }

  /* 彩蛋：不进 help。命中即输出，不参与命令表 */
  var EGGS = {
    sudo: function () {
      print('权限不足。你只是访客 ——', 'dim');
      print('不过每个访客都值得一句：夜色很好，信号也很好。', 'dim');
    },
    '42': function () {
      print('宇宙、生命以及一切的终极答案。', 'ok');
      print('但这座塔只广播到 41 —— 第 42 条，留给还没写的那一篇。', 'dim');
    },
    hello: function () {
      print('◈ 开发者留言：', 'ok');
      print('  如果你翻到了这里，说明信号没有衰减。', 'dim');
      print('  写下去。—— 漓江', 'dim');
    },
    coffee: function () {
      print('☕ 咖啡因模块未安装。', 'dim');
      print('  建议：离开屏幕五分钟，回来信号会更清楚。', 'dim');
    }
  };
  /* rm -rf / 这类带参数的彩蛋 */
  var EGG_PREFIX = {
    'rm': function () {
      print('拒绝执行。这里的一切都还要留着。', 'err');
    }
  };

  function execute(raw) {
    var line = String(raw || '').trim();
    if (!line) return;
    addHist(line);
    print('▸ ' + line, 'cmd');
    var parts = line.split(/\s+/);
    var name = parts[0].toLowerCase();
    var rest = line.slice(parts[0].length).trim();

    /* 彩蛋优先于"未识别"（但让位于正式命令） */
    if (!CMDS[name] && Object.prototype.hasOwnProperty.call(EGGS, name)) {
      EGGS[name](rest);
      return;
    }
    if (!CMDS[name] && Object.prototype.hasOwnProperty.call(EGG_PREFIX, name)) {
      EGG_PREFIX[name](rest);
      return;
    }
    switch (name) {
      case 'help': return cmdHelp();
      case 'goto': return cmdGoto(rest);
      case 'search': return cmdSearch(rest);
      case 'hue': return cmdHue(rest);
      case 'theme': return cmdTheme(rest);
      case 'atmo': return cmdAtmo(rest);
      case 'radio': return cmdRadio();
      case 'whoami': return cmdWhoami();
      case 'clear': out.innerHTML = ''; return;
      default:
        print('未识别：' + name + ' —— 试试 help', 'err');
    }
  }

  /* ---------- 开关 ---------- */
  function openConsole() {
    lazyDom();
    if (isOpen) return;
    isOpen = true;
    lastFocus = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement : null;
    panel.hidden = false;
    /* 进场动画之后聚焦（等面板可见，避免焦点落在 hidden 元素上） */
    input.focus();
    if (!out.childNodes.length) {
      print('NEON://CONSOLE v4.3 · 输入 help 查看命令', 'dim');
    }
  }

  function closeConsole() {
    if (!isOpen || !panel) return;
    isOpen = false;
    panel.hidden = true;
    if (lastFocus && document.contains(lastFocus) && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  function toggleConsole() {
    if (isOpen) closeConsole(); else openConsole();
  }

  /* ---------- 对外接口 ---------- */
  window.NEONConsole = {
    toggle: toggleConsole,
    open: openConsole,
    close: closeConsole,
    isOpen: function () { return isOpen; },
    /** 供测试/调试直接执行一条命令（返回 undefined；输出走输出区） */
    exec: execute
  };

  loadHist();
})();
