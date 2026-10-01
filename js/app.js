/* ============================================================
   app.js — 路由 / 认证 / Markdown 渲染管线 / 编辑器
   ============================================================ */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var navEl = document.getElementById('nav');
  /* 控制台列表的委托监听只装一次（挂在下方的 #app 元素上，该节点常驻不重建） */
  var adminDelegated = false;

  /* ---------- 视图层取用（带降级）----------
     背景：views.js 与 app.js 都是 defer 脚本，理论上按序执行；
     但一旦 views.js 加载失败（网络抖动 / CDN 拦截 / 缓存损坏 / 扩展干扰），
     原先的 `var V = window.NEONViews` 会得到 undefined，
     随后 route() -> renderHome() 调用 V().homeView() 抛未捕获异常，
     导致整个页面白屏、且版本号也渲染不出来。

     这里改为惰性取用 + 降级实现：
       · 正常情况：直接返回真正的 NEONViews
       · 缺失时  ：返回一个安全替身，保证 esc/toast 等基础能力仍可用，
                   页面能显示明确错误提示，而不是白屏。 */
  var VIEW_FALLBACK = null;

  /* app.js 依赖的视图函数清单（单一来源）。
     ⚠ 用于识别「半新半旧」：app.js 已更新但浏览器复用了旧缓存的 views.js。
     若只看 esc 是否存在就认账，会出现「app 里有 renderMarks，views 里没有 marksView」
     → V().marksView 是 undefined → 调用即 TypeError → 异步 rejection 逃过同步 try
     → #/marks 永久停在 BOOTING TERMINAL（2026-09-29 真实事故）。
     这里显式列出必需项：任一缺失即判定视图层不可用，切降级视图给可读提示，
     而不是让某个路由单独炸成白屏。 */
  var REQUIRED_VIEW_FNS = [
    'esc', 'fmtDate', 'homeView', 'postView', 'tagsView', 'searchView',
    'archiveView', 'aboutView', 'loginView', 'adminView', 'editView',
    'marksView', 'tagAdminView', 'postTrail', 'readingLabel', 'radioView'
  ];

  function viewsUsable(real) {
    if (!real) return false;
    for (var i = 0; i < REQUIRED_VIEW_FNS.length; i++) {
      if (typeof real[REQUIRED_VIEW_FNS[i]] !== 'function') return false;
    }
    return true;
  }

  function buildViewFallback() {
    var esc = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    var warn = function () {
      return '<div class="empty-state"><span class="empty-glyph">⚠</span>' +
        '<span class="empty-code">VIEW LAYER MISSING</span>' +
        '<span class="empty-hint">界面模块（views.js）未能加载或版本过旧，请强制刷新（Ctrl+Shift+R）</span></div>';
    };
    var noop = function () { return warn(); };
    return {
      esc: esc,
      fmtDate: function () { return '----.--.--'; },
      fmtSize: function (b) { return b == null ? '' : b + ' B'; },
      readingMinutes: function () { return 1; },
      readingLabel: function () { return '约 1 分钟'; },
      postTrail: function () { return ''; },
      homeView: noop, tagsView: noop, searchView: noop, archiveView: noop,
      postView: noop, aboutView: noop,
      loginView: noop, adminView: noop, editView: noop,
      marksView: noop, tagAdminView: noop, radioView: noop,
      __isFallback: true
    };
  }

  function V() {
    var real = window.NEONViews;
    /* 不再只查 esc —— 半新半旧的 views.js 会让新路由炸成白屏（见上方说明） */
    if (viewsUsable(real)) return real;
    if (!VIEW_FALLBACK) {
      VIEW_FALLBACK = buildViewFallback();
      try {
        console.error('[NEON] views.js 未加载、不可用或版本过旧（缺少 ' +
          REQUIRED_VIEW_FNS.filter(function (k) {
            return !window.NEONViews || typeof window.NEONViews[k] !== 'function';
          }).join('/') +
          '），已切换到降级视图。请强制刷新（Ctrl+Shift+R）；若反复出现，请检查网络或浏览器扩展拦截。');
      } catch (e) { /* 忽略 */ }
    }
    return VIEW_FALLBACK;
  }

  /* 便捷取用（避免每处都写 V().xxx） */
  function esc(s) { return V().esc(s); }

  /* 控制台/编辑器列表项点击（事件委托）。
     原先每个条目各自 addEventListener，渲染 N 条就挂 N 个监听；
     改用 app 根节点上唯一一个委托监听，重渲染不会叠加、也不会随条目数增长。
     判断目标是否落在 [data-edit] 上：条目内还嵌着「编辑」按钮，点它同样命中。 */
  function bindEditDelegation() {
    if (adminDelegated) return;
    adminDelegated = true;
    app.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-edit]') : null;
      if (!el || !app.contains(el)) return;
      location.hash = '#/edit/' + el.getAttribute('data-edit');
    });
  }

  /* ---------- 数据层取用（带降级）----------
     背景：cloud.js 定义全局 NEON。若它加载失败（CDN 拦截 / 网络抖动 / 缓存损坏），
     任何裸写 `NEON.xxx` 都会抛 ReferenceError。

     最阴险的一处：`catch (e) { s.error = errMsg(e, '...') }` ——
     错误处理分支自己引用了不存在的 NEON，于是「处理错误」这件事本身崩了，
     异常继续向外冒泡，而它发生在 await 之后，boot() 的同步 try/catch 抓不到，
     最终表现为整页白屏。这是典型的 "error handler throws" 反模式。

     对策：
       1. NEON()    —— 安全取用数据层，缺失时返回 null（不抛错）
       2. errMsg()  —— 本地降级实现，永不抛错，任何情况下都能给出一句人话错误
       3. 所有调用点改为防御式写法（见下方批量替换） */
  function NEON() {
    try {
      var g = window.NEON;
      return (g && typeof g === 'object') ? g : null;
    } catch (e) { return null; }
  }

  /* 本地错误信息提取（与 cloud.js 的 NEON.errMsg 语义一致，但绝不依赖它存在） */
  function errMsg(err, fallback) {
    try {
      var n = NEON();
      if (n && typeof n.errMsg === 'function') return n.errMsg(err, fallback);
    } catch (e) { /* 数据层 errMsg 自身出错 —— 继续走本地降级 */ }
    var m = '';
    try {
      if (err && typeof err === 'object') m = err.message || err.error_description || err.msg || '';
      else if (typeof err === 'string') m = err;
    } catch (e2) { m = ''; }
    return m ? String(m) : (fallback || '未知错误');
  }

  /* 取数据层子模块；缺失时抛出一个可读错误（由调用方 catch 后交给 errMsg 渲染） */
  function need(name) {
    var n = NEON();
    if (!n || !n[name]) {
      throw new Error('数据层（cloud.js）未就绪：缺少 ' + name);
    }
    return n[name];
  }

  /* ============ B2：并行取数（allSettled 语义 + 逐个降级）============
     背景：首屏与详情页此前是**串行 await**，两个互不依赖的请求
     只能排队跑，网络往返白白翻倍。改成并行后首屏能明显变快。

     ★ 为什么不能用 Promise.all：
       Promise.all 是"一损俱损" —— 只要标签统计挂了（比如新加的 RPC
       还没部署、或某个 tag 数据脏），整个 Promise 立即 reject，
       连带把**已经成功拿到的文章列表**一起丢掉。
       结果就是"统计挂了，连文章都看不到" —— 这比慢一点严重得多。

       正确的语义是 allSettled：每个请求各自成败，成功的照常用，
       失败的只在它自己那块区域显示降级提示。错误范围必须与
       数据范围一致 —— 一个接口的失败不该污染另一个接口的结果。

     实现要点：
       · 用 Promise.allSettled（Node 12.9+ / 现代浏览器基线）。
         对更老的环境做能力探测，缺失时退化为 all + 包裹式 catch，
         保证"每个任务永不 reject"这一前提在任何环境下成立。
       · 返回 [{ok, value, reason}]，调用方按索引取用，
         不需要 try/catch —— 异常已经在内部消化成 ok:false。 */
  function settled(promise) {
    return Promise.resolve(promise).then(
      function (v) { return { ok: true, value: v, reason: null }; },
      function (e) { return { ok: false, value: null, reason: e }; }
    );
  }

  function parallelSafe(tasks) {
    var list = (tasks || []).map(function (t) {
      /* 任务本身可能同步抛错（例如 need() 在数据层缺失时抛）——
         必须包一层，否则还没进 Promises 就炸了，并行化反而更脆。 */
      try {
        return settled(typeof t === 'function' ? t() : t);
      } catch (e) {
        return settled(Promise.reject(e));
      }
    });
    return Promise.all(list);
  }

  /* ============ 全局状态 ============ */
  var State = {
    session: null,
    nickname: localStorage.getItem('neon_nickname') || '',
    loginTab: 'password',
    pendingOtp: null,          /* {email, verificationId, isExistingUser} */
    home: { page: 1, pageSize: 8, posts: [], total: 0, loading: true, error: null, tagName: null, hasMore: false },
    lastHash: null
  };

  /* ============ C19：收藏（v4.9.0 起跟账号走） ============
     规则（站长定）：**只有登录了才能收藏，未登录只能浏览**。

     为什么从 localStorage 搬到数据库：v4.9.0 之前收藏存在本机（键 neon_bookmarks），
     理由是"读者无需登录"。现在既然收藏绑定了登录态，再存本机就会出现
     "登录了、收藏却只在这台设备上"的错位 —— 所以跟账号走（表见 db/schema.sql §5）。

     ⚠ 渲染路径必须保持**同步**：postCard 渲染时读 `_marked`，若每张卡都 await
     一次云端，列表会被拆成 N 次重绘。所以登录后把 id 列表取回内存（State.marks 是个 Set），
     渲染只读内存。缓存的刷新点只有三处：启动（若已有会话）、SIGNED_IN、SIGNED_OUT。 */
  var LEGACY_MARK_KEY = 'neon_bookmarks';   /* v4.9.0 之前的本机键（只用于一次性迁移） */
  var marksLoaded = false;                  /* 是否已从云端取过一次（区分"空"与"还没取"） */

  /* v4.9.1：锁定态用的霓虹锁 —— **内联 SVG**，与 views.js 的 lockSvg() 字面一致。
     ⚠ 不能用 sprite + <use>：克隆内容在影子树里，类选择器进不去 —— 描边会失效、
       渲染成黑色实心块（实测截图才发现），扫描线动画也无从触发。
     图元造型与配色全在 css/style.css 的 .mark-lock 里，靠 currentColor 跟随按钮，
     所以换主题 / 换色相不用改这里一行。 */
  var LOCK_SVG = '<svg class="mark-lock" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path class="lk-shackle" d="M8.4 10.6V8.2a3.6 3.6 0 0 1 7.2 0v2.4"/>' +
    '<path class="lk-body" d="M6.6 10.6h10.8l1.6 1.6v6.6l-1.6 1.6H6.6L5 18.8v-6.6z"/>' +
    '<circle class="lk-hole" cx="12" cy="14.5" r="1.5"/>' +
    '<path class="lk-hole" d="M12 15.9v2.4"/>' +
    '<path class="lk-scan" d="M5.4 12.4h13.2"/>' +
    '</svg>';

  function isLoggedIn() {
    return !!(State.session && State.session.user);
  }

  function markSet() {
    if (!State.marks) State.marks = new Set();
    return State.marks;
  }

  function isMarked(id) {
    return markSet().has(parseInt(id, 10));
  }

  /* 从云端刷新内存缓存。未登录 → 清空（收藏是账号功能，访客没有收藏）。 */
  async function refreshMarks() {
    if (!isLoggedIn()) {
      State.marks = new Set();
      marksLoaded = true;
      return;
    }
    var ids = [];
    try { ids = await need('Bookmarks').list(); } catch (e) { ids = []; }
    var set = new Set();
    (ids || []).forEach(function (n) {
      var v = parseInt(n, 10);
      if (isFinite(v) && v > 0) set.add(v);   /* 云端按"最近收藏在前"返回 ⇒ Set 保留该顺序 */
    });
    State.marks = set;
    marksLoaded = true;
  }

  /* v4.9.0 一次性迁移：把旧版存在本机的收藏并进账号，然后删掉旧键。
     只在登录后跑一次；单条失败不阻断其余（下次登录还会再试）。
     ⚠ 旧键里可能有已删除文章的 id —— 云端有外键，插不进去就跳过，不报错。 */
  async function migrateLegacyMarks() {
    var raw = null;
    try { raw = localStorage.getItem(LEGACY_MARK_KEY); } catch (e) { return; }
    if (!raw) return;
    var arr = [];
    try { arr = JSON.parse(raw); } catch (e) { arr = []; }
    if (!Array.isArray(arr) || !arr.length) {
      try { localStorage.removeItem(LEGACY_MARK_KEY); } catch (e) {}
      return;
    }
    var B = need('Bookmarks');
    var ok = 0;
    for (var i = 0; i < arr.length; i++) {
      var id = parseInt(arr[i], 10);
      if (!isFinite(id) || id <= 0) continue;
      try { await B.add(id); ok++; } catch (e) { /* 文章已删/权限问题：跳过这一条 */ }
    }
    try { localStorage.removeItem(LEGACY_MARK_KEY); } catch (e) {}
    if (ok) toast('已把 ' + ok + ' 条本机收藏并入你的账号', 'ok');
  }

  /* 把收藏态盖到一批文章上（渲染前调用，供 postCard 读 _marked）
     v4.9.0：顺带盖上 _markLocked（未登录 → 按钮显示锁定态） */
  function applyMarks(posts) {
    var set = markSet();
    var locked = !isLoggedIn();
    (posts || []).forEach(function (p) {
      if (p && p.id != null) {
        p._marked = set.has(parseInt(p.id, 10));
        p._markLocked = locked;
      }
    });
    return posts;
  }

  /* 按状态重画一个收藏按钮（图标 / 类名 / aria / 文案 / title 一处收口）
     三态：locked（未登录，显示霓虹锁）｜on（已收藏 ◈）｜off（未收藏 ◇） */
  function paintMark(btn, on, locked) {
    if (!btn) return;
    locked = !!locked;
    var active = !locked && !!on;
    btn.classList.toggle('is-on', active);
    btn.classList.toggle('is-locked', locked);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    var glyph = btn.querySelector('.mark-glyph');
    if (glyph) {
      /* v4.9.1：锁是 SVG（innerHTML）、收藏态是文字字形（textContent）——
         两者互斥，切换时必须显式覆盖，否则会留下上一次的残留节点。
         ⚠ 这段结构必须与 views.js 的 lockSvg() 字面一致（卡片版与详情页版
           渲染出不同的锁，正是本项目踩过的"半新半旧"那类事故）。 */
      if (locked) glyph.innerHTML = LOCK_SVG;
      else glyph.textContent = active ? '◈' : '◇';
    }
    btn.setAttribute('title', locked ? '登录后可收藏' : (active ? '取消收藏' : '收藏这条信号'));
    /* 详情页那个是带文字的大按钮，文案要跟着变（只替换尾部文本节点） */
    if (btn.id === 'post-mark') {
      btn.childNodes.forEach(function (n) {
        if (n.nodeType === 3) n.textContent = locked ? '登录后可收藏' : (active ? '已收藏' : '收藏');
      });
    }
  }

  /* 身份变化后就地重画所有可见的收藏按钮。
     ⚠ 为什么不能只靠重渲染：route() 有「同 hash 不重绘」的短路
       （State.lastHash 守卫，见 route 开头），登录/退出后停在原页时
       不会自动重新渲染 —— 按钮会停在旧状态（实测：退出登录后仍亮着）。 */
  function repaintMarks() {
    var locked = !isLoggedIn();
    var set = markSet();
    var nodes = document.querySelectorAll('[data-mark]');
    Array.prototype.forEach.call(nodes, function (btn) {
      paintMark(btn, set.has(parseInt(btn.getAttribute('data-mark'), 10)), locked);
    });
  }

  /* 委托绑定：卡片与详情页共用一套（.card-mark / #post-mark 都带 data-mark）。
     放在 document 上而非各渲染函数里 —— 因为列表会被 innerHTML 反复重建，
     逐次绑监听会累积泄漏，委托一次即可。

     ⚠ **必须用捕获阶段（第三参 true）**，这是 v4.9.0 修掉的一个真 bug：
       卡片的"点整卡进文章"处理器挂在更深的 app 上，冒泡时它**先于** document 跑完，
       等我们这里 stopPropagation 已经来不及 —— 点一下 ◇ 会顺带跳进文章。
       捕获阶段从 document 往下走，我们最早拿到事件，才拦得住。
       （症状实测：点收藏后 location.hash 变成 #/post/N，列表被重建、按钮节点被换掉。） */
  function bindMarkDelegation() {
    document.addEventListener('click', async function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-mark]') : null;
      if (!btn) return;
      /* 卡片整卡是 role=link + data-id，点收藏绝不能顺带跳进文章 */
      ev.preventDefault();
      ev.stopPropagation();
      var id = parseInt(btn.getAttribute('data-mark'), 10);
      if (!isFinite(id) || id <= 0) return;

      /* ★★ 门槛：未登录只能浏览（站长规则）。
         不去静默失败，而是明确告知 + 给入口 —— 与"标签管理""附件下载"同一套处理。 */
      if (!isLoggedIn()) {
        State.pendingMark = id;                 /* 记下意图，登录后回来接着收 */
        toast('收藏需要先登录（ACCESS）', 'warn');
        location.hash = '#/login';
        return;
      }

      var wasOn = isMarked(id);
      paintMark(btn, !wasOn);                   /* 乐观更新：点下去立刻有反馈 */
      try {
        if (wasOn) {
          await need('Bookmarks').remove(id);
          markSet().delete(id);
        } else {
          await need('Bookmarks').add(id);
          markSet().add(id);
        }
        toast(wasOn ? '已取消收藏' : '已收藏（跟随账号）', wasOn ? null : 'ok');
        /* 收藏页里取消收藏 → 该条目应即时消失（否则页面与数据不一致） */
        if (parseHash().name === 'marks' && wasOn) {
          var card = btn.closest('.post-card');
          if (card) card.remove();
          var left = document.querySelectorAll('.post-list .post-card').length;
          if (left === 0) route();
        }
      } catch (e) {
        paintMark(btn, wasOn);                  /* 写失败就回滚，不留假状态 */
        toast(errMsg(e, '操作失败'), 'error');
      }
    }, true);   /* ← 捕获阶段：必须早于卡片自身的跳转处理器（见上方注释） */
  }

  /* ============ 工具 ============ */
  /* E4 类型前缀符号：toast 四态原本只靠边框/文字色区分，色盲/灰度场景下
     error 与 ok 不可辨 —— 颜色不能是唯一信息通道（与 O9 色标同哲学）。
     纯文本拼接进 textContent，不动 DOM 结构；查表未命中（含不传 type）
     一律走默认 '▸ '，与 toast 默认青色态对应。 */
  var TOAST_MARK = { error: '✕ ', ok: '✓ ', warn: '⚠ ' };
  function toast(msg, type) {
    var wrap = document.getElementById('toast-wrap');
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = (TOAST_MARK[type] || '▸ ') + msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('hide');
      setTimeout(function () { el.remove(); }, 350);
    }, 3600);
  }

  function isLocalPreview() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '';
  }

  /* ---------- 统一用户名解析 ----------
     三条登录路径（密码 / 验证码 / 注册）都走这里，保证昵称不会漏读。
     优先级：显式传入 > localStorage(用户显式设置) > State.nickname > 邮箱前缀 > OPERATOR
     注意：localStorage 排在 State.nickname 之前——后者可能被上一次登录污染。
     邮箱前缀只作为兜底，避免把整封邮箱显示在欢迎语里。 */
  function displayName(source) {
    if (source && typeof source === 'object' && source.nickname) {
      var n = String(source.nickname).trim();
      if (n) return n;
    }
    var cached = '';
    try { cached = localStorage.getItem('neon_nickname') || ''; } catch (e) { cached = ''; }
    if (cached.trim()) return cached.trim();
    if (State.nickname && String(State.nickname).trim()) return String(State.nickname).trim();
    var email = '';
    if (source && typeof source === 'object' && source.email) email = String(source.email);
    else if (typeof source === 'string') email = source;
    else if (State.session && State.session.user && State.session.user.email) email = State.session.user.email;
    if (email.indexOf('@') > 0) return email.split('@')[0];
    return 'OPERATOR';
  }

  /* 欢迎提示（统一出口，避免各处拼接不一致）
     注意：toast() 内部用 textContent 赋值，本身已是文本安全。
     此处不要再做 HTML 转义，否则名字里的 & < > 会被双重转义显示成实体。 */
  function welcomeBack(source) {
    toast('欢迎 ' + displayName(source) + ' 回来', 'ok');
  }

  /* 从会话/user 元数据中尽力捞出昵称，捞不到就退回邮箱前缀。
     已登录用户如果本地缓存被清了，靠这个能自动补齐。
     优先级说明：localStorage 里的昵称是用户在注册时显式设置的，可信度高于
     可能被上一次登录污染的 State.nickname，因此先读 localStorage。 */
  function syncNicknameFromSession(session) {
    /* ① 用户显式设置过的昵称（最高优先） */
    var cached = '';
    try { cached = localStorage.getItem('neon_nickname') || ''; } catch (e) { cached = ''; }
    if (cached && cached.trim()) {
      State.nickname = cached.trim();
      return State.nickname;
    }
    /* ② 已在内存中的昵称 */
    if (State.nickname && String(State.nickname).trim()) {
      return String(State.nickname).trim();
    }
    /* ③ 从 user 元数据里找 */
    var user = (session && session.user) ||
      (State.session && State.session.user) || null;
    var meta = (user && (user.user_metadata || user.userMetadata)) || null;
    var fromMeta = meta && (meta.nickname || meta.name);
    if (fromMeta && String(fromMeta).trim()) {
      State.nickname = String(fromMeta).trim();
    } else if (user && user.email && user.email.indexOf('@') > 0) {
      /* ④ 最后兜底：邮箱前缀（不落库，避免把兜底值当作用户偏好固化下来） */
      return user.email.split('@')[0];
    }
    return State.nickname || '';
  }

  /* C10：模态焦点陷阱的释放句柄。
     模态是"必须处理"的中断态，若不加陷阱，Tab 会跑回被遮住的页面上，
     键盘用户会陷入"看得见的点不到、点得到的看不见"的困局。 */
  var modalTrap = null;

  function openModal(title, bodyHtml, actions, extraCls) {
    closeModal();
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.id = 'neon-modal';
    /* C10：语义化 —— 读屏软件据此宣告"这是一个对话框"，
       并在打开时把上下文切进来（配合 aria-modal 屏蔽背后的内容）。 */
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-label', title || '对话框');
    var btns = (actions || []).map(function (a, i) {
      return '<button class="btn ' + (a.cls || '') + '" data-mact="' + i + '">' + V().esc(a.label) + '</button>';
    }).join('');
    mask.innerHTML = '<div class="modal' + (extraCls ? ' ' + extraCls : '') + '"><h3>' + V().esc(title) + '</h3><div class="modal-body">' + bodyHtml + '</div><div class="modal-actions">' + btns + '</div></div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) {
      if (e.target === mask) closeModal();
      var b = e.target.closest('[data-mact]');
      if (b) {
        var act = actions[+b.getAttribute('data-mact')];
        closeModal();
        if (act && act.onClick) act.onClick();
      }
    });
    /* C10：焦点陷阱。keys.js 未加载时静默跳过 —— 焦点可见性（CSS）仍在，
       只是失去 Tab 循环这一层，属于优雅降级。 */
    try {
      if (window.NEONKeys && typeof window.NEONKeys.trapFocus === 'function') {
        modalTrap = window.NEONKeys.trapFocus(mask);
      }
    } catch (e) { /* 忽略 */ }
  }
  function closeModal() {
    var m = document.getElementById('neon-modal');
    if (!m) return;
    /* C10：先释放陷阱（它负责把焦点归还给打开模态的那个元素），再移除节点。
       顺序反了的话 activeElement 已被移除，归还目标就丢了。 */
    if (modalTrap) {
      try { modalTrap(); } catch (e) { /* 忽略 */ }
      modalTrap = null;
    }
    m.remove();
  }

  /* ============ Markdown 渲染管线 ============ */
  var URI_REGEXP = /^(?:(?:(?:ftp|https?|mailto|tel|callto|cid|xmpp|cloudimg|cloudfile):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))|data:image\/[a-z0-9.+-]+;base64,)/i;
  var CLOUDIMG_RE = /^cloudimg:\/\/(\d+)$/;

  /* ---------- v5.3.0：第三方库按需加载 ----------
     为什么：这三个库只在"渲染文章正文"时用得到，却因为 defer 阻塞了首页首绘。
     现在按需注入 + 加载完**自动重渲染**（容器还在 DOM 里，直接填进去）。
     ⚠ 加载失败仍走原来的降级提示 —— 只是"失败"现在真的是失败，不再是"还没来得及加载"。 */
  var VENDOR_SRC = {
    marked: 'js/vendor/marked.min.js',
    dompurify: 'js/vendor/dompurify.min.js',
    highlight: 'js/vendor/highlight.min.js'
  };
  var vendorLoading = {};
  function loadVendors(names) {
    var todo = names.filter(function (n) {
      var g = (n === 'dompurify') ? window.DOMPurify : window[n];
      return !g && VENDOR_SRC[n];
    });
    return Promise.all(todo.map(function (n) {
      if (vendorLoading[n]) return vendorLoading[n];
      vendorLoading[n] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = VENDOR_SRC[n] + '?v=' + ((window.BUILD && window.BUILD.id) || Date.now());
        s.onload = function () { resolve(true); };
        s.onerror = function () { vendorLoading[n] = null; reject(new Error(n + ' 加载失败')); };
        document.head.appendChild(s);
      });
      return vendorLoading[n];
    }));
  }

  function renderMarkdownInto(container, mdText) {
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      /* 首次渲染：先把提示放上去，库到位后自动重渲染（用户无需再点一次） */
      container.innerHTML = '<div class="notice-banner">正在装载 Markdown 引擎…</div>';
      loadVendors(['marked', 'dompurify', 'highlight']).then(function () {
        renderMarkdownInto(container, mdText);
      }, function () {
        container.innerHTML = '<div class="notice-banner">Markdown 引擎加载失败，仅显示纯文本</div><pre style="white-space:pre-wrap">' + V().esc(mdText || '') + '</pre>';
      });
      return;
    }
    var raw = marked.parse(mdText || '', { breaks: true, gfm: true });
    var clean = DOMPurify.sanitize(raw, {
      ALLOWED_URI_REGEXP: URI_REGEXP,
      ADD_ATTR: ['target']
    });
    container.innerHTML = clean;

    /* 外链安全 */
    container.querySelectorAll('a[href^="http"]').forEach(function (a) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });

    /* 附件链接 → 下载按钮 */
    container.querySelectorAll('a[href^="cloudfile://"]').forEach(function (a) {
      var rawPath = a.getAttribute('href').slice('cloudfile://'.length);
      var label = a.textContent || '附件';
      var span = document.createElement('a');
      span.className = 'md-attach';
      span.setAttribute('data-attach-path', rawPath);
      span.innerHTML = '📎 <span>' + V().esc(label) + '</span> ⤓';
      a.replaceWith(span);
    });

    /* 代码高亮 */
    if (typeof hljs !== 'undefined') {
      container.querySelectorAll('pre code').forEach(function (block) {
        try { hljs.highlightElement(block); } catch (e) { /* 忽略单块高亮失败 */ }
      });
    }

    /* 图片引用解析（异步批量） */
    hydrateImages(container);
  }

  /* 容器内 cloudimg:// 引用 → data URL；同时处理 data-cover 背景元素
     B1 重构：
     · opts.thumb = true → 列表页封面，走缩略图（无缩略图的旧图自动回退原图）
     · 默认 → 详情页正文 / 编辑器预览，走完整图
     · 视口懒加载：有 IntersectionObserver 时只请求即将进入视口的图；
       无 IO（老浏览器 / 测试环境）或容器未挂载时立即全量请求，行为与旧版一致
     · activeImageIO 槽位：每次 hydrate 断开上一个观察器，防止反复重渲染累积泄漏 */
  var activeImageIO = null;

  function hydrateImages(scope, opts) {
    var scopeEl = scope || document;
    var wantThumb = !!(opts && opts.thumb);
    var jobs = [];
    scopeEl.querySelectorAll('img[src^="cloudimg://"]').forEach(function (img) {
      var m = CLOUDIMG_RE.exec(img.getAttribute('src'));
      if (!m) { img.remove(); return; }
      jobs.push({ el: img, id: +m[1], kind: 'img' });
    });
    scopeEl.querySelectorAll('[data-cover]').forEach(function (el) {
      var m = CLOUDIMG_RE.exec(el.getAttribute('data-cover') || '');
      if (m) jobs.push({ el: el, id: +m[1], kind: 'cover' });
    });
    if (jobs.length === 0) return;

    if (activeImageIO) {
      try { activeImageIO.disconnect(); } catch (e) { /* 已失效 */ }
      activeImageIO = null;
    }

    function apply(batch) {
      var ids = batch.map(function (j) { return j.id; });
      need('Images').fetchMany(ids, { thumb: wantThumb }).then(function (map) {
        batch.forEach(function (j) {
          var url = map.get(j.id);
          if (!url) {
            if (j.kind === 'img') { j.el.alt = j.el.alt || '[图片丢失]'; j.el.removeAttribute('src'); }
            return;
          }
          if (j.kind === 'img') {
            j.el.src = url;
            j.el.loading = 'lazy';
            /* B3：解码不阻塞主线程 */
            j.el.decoding = 'async';
            /* B3：补 width/height 占位 —— 浏览器据此推出 aspect-ratio 预留空间，
               图片落地时不再跳动（CLS）。拿不到尺寸就不设，宁缺勿错。 */
            var d = need('Images').dims(j.id);
            if (d) { j.el.width = d.width; j.el.height = d.height; }
          }
          else { j.el.style.backgroundImage = 'url("' + url + '")'; j.el.removeAttribute('data-cover'); }
        });
      }).catch(function () { /* 静默：图片加载失败不阻塞阅读 */ });
    }

    /* 容器未挂到文档（如渲染前的临时 div）或环境无 IO → 立即全量 */
    var connected = (scopeEl === document) || (scopeEl.isConnected === true);
    if (!connected || typeof IntersectionObserver === 'undefined') {
      apply(jobs);
      return;
    }

    var batch = [];
    var timer = null;
    var remaining = jobs.length;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        for (var i = 0; i < jobs.length; i++) {
          if (jobs[i].el === en.target) { batch.push(jobs[i]); break; }
        }
        remaining--;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          if (batch.length) { apply(batch); batch = []; }
          if (remaining === 0) {
            try { io.disconnect(); } catch (e) { /* 忽略 */ }
            if (activeImageIO === io) activeImageIO = null;
          }
        }, 120);
      });
    }, { rootMargin: '300px' });
    activeImageIO = io;
    jobs.forEach(function (j) { io.observe(j.el); });
  }

  /* ============ 版本号 & 工程日志 ============ */
  function getVersionInfo() {
    return (typeof window.NEONVersion === 'object' && window.NEONVersion) || null;
  }

  /* 页脚版本号
     注意：version.js 会先自己写一次（不依赖 app.js，保证 app.js 崩溃时也能看到版本）。
     这里正常情况下应当读到同样的值并重写一遍（结果一致，无副作用）。
     只有在 version.js 确实没生效时，才降级显示 v? 并报错。 */
  function renderVersion() {
    var el = document.getElementById('foot-version');
    if (!el) return;
    var info = getVersionInfo();
    if (info && info.BUILD) {
      el.textContent = 'v' + info.BUILD;
      el.title = (info.BUILT_AT ? '构建于 ' + info.BUILT_AT + ' · ' : '') +
        'BUILD_ID=' + (info.BUILD_ID || '(无)');
      el.style.color = '';
      el.setAttribute('data-painted-by', 'app.js');
      return;
    }
    /* version.js 未生效：若它已经自己画过，就不要覆盖 */
    var painted = el.getAttribute('data-painted-by');
    if (painted === 'version.js' && /^v\d/.test(el.textContent || '')) return;
    el.textContent = 'v?';
    el.title = 'version.js 未加载成功，请强制刷新（Ctrl+Shift+R）';
    el.style.color = 'var(--yellow)';
    try {
      console.error('[NEON] 版本信息不可用：window.NEONVersion 未定义。' +
        '通常意味着 version.js 未加载或被浏览器缓存阻断，请强制刷新。');
    } catch (e) { /* 忽略 */ }
  }

  /* 诊断横幅：在 ?diag=1 时额外显示「加载自哪个文件」的硬证据。
     与 version.js 自身的横幅配合，可判断 app.js 与 version.js 版本是否一致。 */
  function diagBanner() {
    if (!/[?&]diag=1/.test(location.search)) return;
    var info = getVersionInfo();
    var errs = [];
    if (typeof marked === 'undefined') errs.push('marked');
    if (typeof DOMPurify === 'undefined') errs.push('DOMPurify');
    if (typeof hljs === 'undefined') errs.push('highlight.js');
    if (typeof WorkBuddyCloud === 'undefined') errs.push('CloudSDK');
    var line = document.createElement('div');
    line.id = 'neon-diag-app';
    line.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99998;' +
      'background:#0b1120;color:#00f0ff;font:12px/1.8 monospace;padding:6px 14px;text-align:center';
    line.textContent = 'DIAG/app.js · app 侧读到版本 = ' +
      (info && info.BUILD ? 'v' + info.BUILD : '【读取失败 version.js 未生效】') +
      ' · 依赖缺失: ' + (errs.length ? errs.join(', ') : '无');
    if (document.body) document.body.appendChild(line);
  }

  /* 工程日志内容（纯 HTML，数据全部来自 version.js，已做转义） */
  function changelogHtml() {
    var info = getVersionInfo();
    if (!info || !Array.isArray(info.LOG) || info.LOG.length === 0) {
      return '<div class="log-timeline"><div class="empty-state" style="padding:20px 0">' +
        '<span class="empty-glyph">∅</span><span class="empty-hint">暂无变更记录</span></div></div>';
    }
    var entries = info.LOG.map(function (e, i) {
      var items = (e.items || []).map(function (t) {
        return '<li>' + V().esc(t) + '</li>';
      }).join('');
      return '<div class="log-entry">' +
        '<div class="log-head">' +
          '<span class="log-ver">v' + V().esc(e.version) + '</span>' +
          '<span class="log-date">' + V().esc(e.date) + '</span>' +
          (i === 0 ? '<span class="log-badge">最新</span>' : '') +
        '</div>' +
        '<div class="log-title">' + V().esc(e.title) + '</div>' +
        '<ul class="log-items">' + items + '</ul>' +
      '</div>';
    }).join('');
    return '<div class="log-timeline">' + entries + '</div>';
  }

  function openChangelog() {
    var info = getVersionInfo();
    var current = info && info.BUILD ? 'v' + info.BUILD : '----';
    openModal(
      'ENGINEERING LOG // 工程日志',
      changelogHtml() +
      '<div class="crumb" style="font-family:var(--mono);font-size:11px;color:var(--text-dim)">' +
        '当前构建 <b style="color:var(--green)">' + V().esc(current) + '</b> · 共 ' +
        ((info && info.LOG && info.LOG.length) || 0) + ' 个版本记录' +
      '</div>',
      [{ label: '关闭', cls: 'btn-ghost' }],
      'modal-log'
    );
  }

  /* ============ CRUD 边界规则（字段规范化） ============ */
  /* 集中在这里，便于测试直接抠出来跑；规则与库层 CHECK 对齐（更严不更松）：
       · 去空白、去空串
       · 去重（保持首次出现顺序，避免存档后顺序跳变）
       · 单个标签长度上限 24
       · 总个数上限 8（库层 posts_tags_len 允许 10，前端留 2 个余量）
     返回全新数组，不修改入参。 */
  var TAG_MAX = 8;
  var TAG_LEN_MAX = 24;
  /* 与库层 posts_content_len 对齐（CHECK ≤ 200000）。
     前端不拦的话，用户写完一篇超长文点保存，会撞上冰冷的
     "23514 ... check constraint is violated" —— 而且是在内容全写完、
     最不想看到报错的时候。宁可提前给一句人话。 */
  var CONTENT_MAX = 200000;

  function normalizeTags(raw) {
    var seen = {};
    var out = [];
    String(raw == null ? '' : raw)
      .split(/[,，;；]/)
      .forEach(function (s) {
        var t = String(s || '').trim();
        if (!t) return;                       /* 空值：丢弃而不是存空串 */
        t = t.slice(0, TAG_LEN_MAX);
        if (!t) return;
        var key = t.toLowerCase();            /* 去重按小写归一，保留原始大小写 */
        if (seen[key]) return;
        seen[key] = 1;
        out.push(t);
      });
    return out.slice(0, TAG_MAX);
  }

  /* ============ C6：亮色主题 ／ O11：暗色优先 ／ 2.1.0：两态收口 ============ */
  /* 两态：'dark'（暗色，默认） / 'light'（亮色）。持久化到 localStorage，键 neon_theme。

     ★ v2.1.0 的关键变更：移除 'auto'（跟随系统）。

     为什么删：
       'auto' 在 O11 之后已经**名存实亡**。
       O11 为了让"默认暗色"成立，删掉了 CSS 里唯一的
       @media (prefers-color-scheme: light) 块 —— 那是 auto 唯一的实现方式。
       删掉之后，auto 的唯一效果是 applyTheme('auto') 走了
       `root.removeAttribute('data-theme')` 分支，
       也就是"什么都不设" = 等于 dark（:root 兜底就是暗色）。
       于是按钮上写着 ◐ AUTO，看起来是个"跟随系统"选项，
       点下去却什么都没发生 —— 一个"看起来有、实际无效"的开关，
       比没有这个开关更糟：用户会以为站点的自动跟随坏了。

     为什么不保留 auto 并恢复 media 查询：
       那会与本站的立场冲突。站点本就是暗色设计，O11 明确选择了
       "配色只由用户显式意愿决定，系统偏好不参与"。
       为了一个选项把这个立场拆掉，是本末倒置。

     兼容存量数据：
       老用户 localStorage 里可能存着 'auto'。getTheme() 对它做归一化
       （见到 'auto' 按 THEME_DEFAULT 处理），并顺手把该键改写成 'dark'，
       避免每次读取都要判断一次。这样"存量 auto 用户"的体验是：
       打开看到暗色 + 按钮显示 ☾ DARK，语义与实际一致。 */
  var THEME_KEY = 'neon_theme';
  var THEME_DEFAULT = 'dark';
  /* C12：三档配色。图标兼作"当前所处档位"的读数 —— 按钮上直接显示，不用点开才知道。 */
  var THEME_ICON = { light: '☀ LIGHT', dark: '☾ DARK', warm: '◐ WARM' };
  var THEME_ORDER = ['dark', 'light', 'warm'];
  /* v2.9.4：罗盘面板里的档位名（不带图标 —— 图标由 CSS 的虚线环承担）。
     与 THEME_ICON 分开存，避免为了拿纯名字去正则切字符串。 */
  var THEME_NAME = { dark: 'DARK', light: 'LIGHT', warm: 'WARM' };

  /* ---------- v3.0 B1：配色的第二个维度 —— 色相旋钮 ----------
     --hue 写进 <html> 的行内 style 后，CSS 里所有由 hsl(var(--hue) …) 派生的
     颜色（主色 / 线 / 辉光 / 网格线 / 辅助紫）会一起变；而语义色
     （品红=流逝·警示 / 绿=在线 / 黄=高亮）固定不动 ——「能调气质，不能调语义」。
     ⚠ HUE_STOPS 必须与 theme-boot.js 里的 HUES **逐值一致**：
       否则启动时写进 --hue 的值会被 applyHue 判成脏值，首绘后又被拉回默认色相，
       表现为"明明选了紫，刷新一瞬是紫、随即跳回青"。 */
  var HUE_KEY = 'neon_hue';
  /* v4.5.0：出厂色相由 184（青）改为 285（紫）。
     ------------------------------------------------------------
     为什么需要"HUE_OLD_DEFAULT + 显式标记"这套迁移：
       老用户浏览器里存着 `neon_hue=184` —— 那是**旧默认值**，
       与"用户真的动手挑了青"在存储里长得一模一样。
       若只改 HUE_DEFAULT 而不处理存量：所有人（包括站长的浏览器）
       打开还是青，改了个寂寞。
       故把「值恰好 = 旧默认 且 从无显式选择标记」视为**从未选过** → 落回新默认。
     为什么用"显式标记"而不是"一次性迁移标记"：
       一次性标记能解决存量，但解决不了**之后**真去点青的人 ——
       他的 184 会在下次开站时又被判成"没选过"、静默弹回紫。
       显式标记只由 setHue（用户亲手点击/拖动）写入，于是"回头选青"能真正留住。
     ⚠ HUE_PICK_KEY 的判定必须与 theme-boot.js / views.js 三处同口径，
       否则会出现"首绘紫、补正后跳青"的闪色（最难查的那类）。 */
  var HUE_PICK_KEY = 'neon_hue_pick';
  var HUE_DEFAULT = 285;   /* 紫 */
  var HUE_OLD_DEFAULT = 184;   /* 旧出厂色相（青）—— 迁移判据，勿删 */
  /* v3.4.0：色相由「九档预设」放开为**自由滑杆**（0~359 任意整数）。
     HUE_STOPS 仍保留 —— 但它们从"取值白名单"降级为滑杆下方的**快捷档**
     （一键跳到常用色相，点完滑杆同步），校验则升级为**范围校验**。
     ⚠ 范围值必须与 theme-boot.js 的 HUE_MIN/HUE_MAX 一致（不一致 ⇒ 首刷闪回默认）。 */
  var HUE_STOPS = [184, 217, 250, 285, 330, 350, 25, 38, 145];
  var HUE_MIN = 0;
  var HUE_MAX = 359;

  /* 用户是否"亲手选过"色相。只有 setHue（点击色卡 / 拖动滑杆 / 终端 hue 命令）
     会置位；启动补正走的 applyHue 不写 —— 补正是"读"，不是"选"。 */
  function huePicked() {
    try { return localStorage.getItem(HUE_PICK_KEY) === '1'; } catch (e) { return false; }
  }

  function hueValid(v) {
    return typeof v === 'number' && isFinite(v) && v === Math.round(v) &&
      v >= HUE_MIN && v <= HUE_MAX;
  }
  var HUE_NAME = {
    184: '青', 217: '电蓝', 250: '靛', 285: '紫', 330: '品红',
    350: '桃', 25: '橙', 38: '琥珀', 145: '苔绿'
  };

  function getTheme() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      /* 存量 'auto' 归一化：它是已废弃态，按默认值处理并就地改写，
         避免"读到就不能用的值"在每次启动时反复出现。 */
      if (v === 'auto') {
        try { localStorage.setItem(THEME_KEY, THEME_DEFAULT); } catch (e2) { /* 忽略 */ }
        return THEME_DEFAULT;
      }
      if (THEME_ORDER.indexOf(v) !== -1) return v;
    } catch (e) { /* 隐私模式下 localStorage 可能不可用 */ }
    return THEME_DEFAULT;
  }

  function applyTheme(mode) {
    var root = document.documentElement;
    /* 三态：显式写 data-theme（dark/light/warm 都会落到属性上）。
       不再有 removeAttribute 分支 —— 那正是 auto 时代的残留，
       它会让 <html> 处于"无属性"态，虽然 :root 兜底也是暗色，
       但显式设 dark 更利于调试（一眼看出是应用决定的，不是漏设）。 */
    if (THEME_ORDER.indexOf(mode) === -1) mode = THEME_DEFAULT;
    root.setAttribute('data-theme', mode);
    var btn = document.getElementById('btn-theme');
    if (btn) {
      var label = THEME_ICON[mode] || THEME_ICON[THEME_DEFAULT];
      btn.textContent = label;
      btn.setAttribute('title', '配色：' + label + '（点击选择档位）');
      btn.setAttribute('aria-label', '配色，当前 ' + label);
    }
    syncThemeMenu(mode);
  }

  /* v2.9.4：面板内三项跟随当前档位。
     三件事一起做，避免出现"看着选中了、读屏说没选中"的漂移：
       · aria-checked —— 读屏的选中态（role=radio 的唯一真值来源）
       · is-on 类     —— 视觉选中态（环转起来 + 换档位色）
       · roving tabindex —— 整组只留一个可 Tab 到的项，组内移动交给方向键。
         这是 WAI-ARIA 对 radiogroup 的标准做法；若三项都 tabindex=0，
         键盘用户要按三次 Tab 才能穿过一个配色开关。 */
  /* ⚠ hue 参数是"待应用的色相"，不是"已存储的色相"：
     applyHue 写变量 → 回头同步面板，此刻存储可能还没写（启动补正路径），
     若在这里自行 getHue() 就会读到旧值，面板亮着旧色点 —— 故显式传入。 */
  function syncThemeMenu(mode, hue) {
    var menu = document.getElementById('theme-menu');
    if (!menu) return;
    menu.querySelectorAll('[data-theme-val]').forEach(function (el) {
      var on = el.getAttribute('data-theme-val') === mode;
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      el.classList.toggle('is-on', on);
      el.setAttribute('tabindex', on ? '0' : '-1');
    });

    /* v3.0 B1：色相组同款三件套（aria-checked / is-on / roving tabindex）。
       两组各自 roving —— 每组都必须恰有一个 tabindex=0，
       否则键盘用户按 Tab 直接跳过整组（那是"选项存在但够不着"）。 */
    if (hue == null) hue = getHue();
    var hueItems = menu.querySelectorAll('[data-hue-val]');
    var anyOn = false;
    hueItems.forEach(function (el) {
      var on = parseInt(el.getAttribute('data-hue-val'), 10) === hue;
      if (on) anyOn = true;
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      el.classList.toggle('is-on', on);
      el.setAttribute('tabindex', on ? '0' : '-1');
    });
    /* 兜底：若当前 hue 不在白名单里（存量脏数据），保证首项仍可 Tab 到 */
    if (!anyOn && hueItems.length) hueItems[0].setAttribute('tabindex', '0');

    /* v3.4.0：滑杆与读数同步 —— 三个来源（点快捷档 / 拖滑杆 / 启动补正）
       都会走到这里，所以同步写在这一处就够了。
       ⚠ 比较后再赋值：拖动时 value 已经是新值，无条件赋值会打断拖拽手感。 */
    var slider = document.getElementById('hue-slider');
    var readout = document.getElementById('hue-readout');
    if (slider && slider.value !== String(hue)) slider.value = String(hue);
    if (slider) slider.setAttribute('aria-valuetext', hue + ' 度');
    if (readout) readout.textContent = hue + '°';
  }

  /* v2.9.4：三档直选（取代 cycleTheme 的"点一下转到下一档"）。
     盲转的问题是用户不知道下一档是什么，也不知道一共几档 —— 三档之后尤其明显，
     想从 warm 回 dark 要连点两次。改成可见的三选一，一次点到。
     THEME_ORDER 仍是唯一白名单来源：新增档位只改那一处，此处与校验共用。 */
  function setTheme(mode) {
    if (THEME_ORDER.indexOf(mode) === -1) mode = THEME_DEFAULT;
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) { /* 隐私模式 */ }
    applyTheme(mode);
    return mode;
  }

  /* ---- v3.0 B1：色相读写（与主题同一套纪律：白名单 + 静默降级） ---- */
  function getHue() {
    try {
      var v = parseInt(localStorage.getItem(HUE_KEY), 10);
      /* v4.5.0 迁移：值 = 旧默认 且 无显式挑选标记 ⇒ 视为"从未选过"，落回新默认。
         判据与 theme-boot.js 首绘前那次完全同口径（见那边的同一段注释）。 */
      if (hueValid(v) && !(v === HUE_OLD_DEFAULT && !huePicked())) return v;
    } catch (e) { /* 隐私模式下 localStorage 可能不可用 */ }
    return HUE_DEFAULT;
  }

  /* 只写 CSS 变量，不写存储 —— 供启动时的补正与 setHue 共用。
     ⚠ 应用后要回头同步面板选中态：色相变了、面板却还亮着旧色点，
       就是"看着选中了、其实没生效"的漂移（与 syncThemeMenu 同一诉求）。 */
  function applyHue(hue) {
    if (!hueValid(hue)) hue = HUE_DEFAULT;
    document.documentElement.style.setProperty('--hue', String(hue));
    syncThemeMenu(getTheme(), hue);
    return hue;
  }

  function setHue(hue) {
    if (!hueValid(hue)) hue = HUE_DEFAULT;
    try {
      localStorage.setItem(HUE_KEY, String(hue));
      /* 显式挑选标记：这是"用户亲手选的"唯一证据。
         写了它，日后即使选到 184 也不会再被当成"没选过"而弹回默认（见 getHue）。 */
      localStorage.setItem(HUE_PICK_KEY, '1');
    } catch (e) { /* 隐私模式 */ }
    return applyHue(hue);
  }

  /* ============ v4.3 B4：装置面板与命令终端共用的控制面 ============
     面板（罗盘三区）与终端（console.js）都经由这里改站点状态 ——
     单一入口，避免两条路径各写各的存储键。console.js 惰性读 window.NEONControls。 */
  var ATMO_MODE_KEY = 'neon_atmo_mode';      /* 与 theme-boot.js / scene.js 同一键 */
  var ATMO_MANUAL_KEY = 'neon_atmo_manual';  /* 手动层列表（JSON 数组字符串） */
  var TAP_KEY = 'neon_tap';

  function atmoOrder() {
    var S = window.NEONScene;
    return (S && S.ATMO_ALL) ? S.ATMO_ALL.slice()
      : ['noise', 'scanline', 'grid', 'glow', 'bloom', 'signs', 'stardust', 'pulse', 'rain'];
  }
  function readAtmoManual() {
    try {
      var arr = JSON.parse(localStorage.getItem(ATMO_MANUAL_KEY));
      if (Object.prototype.toString.call(arr) !== '[object Array]') return null;
      var order = atmoOrder();
      var list = arr.filter(function (id) { return order.indexOf(id) !== -1; });
      return list.length ? list : null;
    } catch (e) { return null; }
  }
  function currentAtmoMode() {
    try {
      var m = localStorage.getItem(ATMO_MODE_KEY);
      return (m === 'standard' || m === 'silent') ? m : 'pollution';
    } catch (e) { return 'pollution'; }
  }
  function reapplyAtmo() {
    var S = window.NEONScene;
    if (S && typeof S.reapply === 'function') S.reapply();
    syncAtmoPanel();
  }
  function setAtmoMode(mode) {
    if (['pollution', 'standard', 'silent'].indexOf(mode) === -1) return;
    try { localStorage.setItem(ATMO_MODE_KEY, mode); } catch (e) { /* 隐私模式 */ }
    /* 模式切换 = 交还自动：清掉手动层列表（否则手动会一直压过模式） */
    try { localStorage.removeItem(ATMO_MANUAL_KEY); } catch (e) { /* 忽略 */ }
    reapplyAtmo();
  }
  function setAtmoLayer(id, on) {
    if (atmoOrder().indexOf(id) === -1) return;
    var cur = readAtmoManual();
    if (!cur) {
      /* 首次手动：从"当前生效层集"复制，扳一个开关不会把其它层全关掉 */
      cur = (document.documentElement.getAttribute('data-atmo') || '').split(' ').filter(Boolean);
    }
    var idx = cur.indexOf(id);
    if (on && idx === -1) cur.push(id);
    if (!on && idx !== -1) cur.splice(idx, 1);
    var order = atmoOrder();
    cur = order.filter(function (x) { return cur.indexOf(x) !== -1; });
    try { localStorage.setItem(ATMO_MANUAL_KEY, JSON.stringify(cur)); } catch (e) { /* 忽略 */ }
    reapplyAtmo();
  }
  function resetAtmoManual() {
    try { localStorage.removeItem(ATMO_MANUAL_KEY); } catch (e) { /* 忽略 */ }
    reapplyAtmo();
  }
  /* 面板勾选态同步（面板不在 DOM 时静默返回） */
  function syncAtmoPanel() {
    var menu = document.getElementById('theme-menu');
    if (!menu) return;
    var mode = currentAtmoMode();
    var manual = readAtmoManual();
    var active = (document.documentElement.getAttribute('data-atmo') || '').split(' ').filter(Boolean);

    Array.prototype.forEach.call(menu.querySelectorAll('[data-atmo-val]'), function (b) {
      var on = b.getAttribute('data-atmo-val') === mode && !manual;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    /* 手动模式下没有任何"选中档" —— roving 需要一个 tab 入口，
       否则键盘用户按 Tab 会整组跳过氛围区（"选项存在但够不着"）。 */
    if (manual) {
      var firstMode = menu.querySelector('[data-atmo-val]');
      if (firstMode) firstMode.tabIndex = 0;
    }
    Array.prototype.forEach.call(menu.querySelectorAll('[data-atmo-layer]'), function (b) {
      var id = b.getAttribute('data-atmo-layer');
      b.setAttribute('aria-pressed', active.indexOf(id) !== -1 ? 'true' : 'false');
    });
    var reset = menu.querySelector('#atmo-reset');
    if (reset) reset.hidden = !manual;
    var tapWrap = menu.querySelector('#tap-mode-row');
    if (tapWrap) {
      var tm = 'normal';
      try {
        var raw = localStorage.getItem(TAP_KEY);
        if (raw === 'off' || raw === 'heavy') tm = raw;
      } catch (e) { /* 隐私模式 */ }
      Array.prototype.forEach.call(tapWrap.querySelectorAll('[data-tap-val]'), function (b) {
        var on = b.getAttribute('data-tap-val') === tm;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
    }
    var lock = menu.querySelector('#atmo-lock');
    if (lock) {
      var locked = false;
      try { locked = localStorage.getItem('neon_atmo_lock') === '1'; } catch (e) { /* 忽略 */ }
      lock.setAttribute('aria-checked', locked ? 'true' : 'false');
    }
  }

  /* ---- 面板开合（与电台面板同一套范式） ---- */
  function themeMenuOpen() {
    var menu = document.getElementById('theme-menu');
    return !!menu && !menu.hasAttribute('hidden');
  }

  function openThemeMenu() {
    var menu = document.getElementById('theme-menu');
    if (!menu) return;
    menu.removeAttribute('hidden');
    var btn = document.getElementById('btn-theme');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    /* 焦点直接落在当前档位上 —— 方向键即可左右换档，不必先 Tab 找位置 */
    var cur = menu.querySelector('[data-theme-val="' + getTheme() + '"]');
    if (cur) { try { cur.focus(); } catch (e) { /* 忽略 */ } }
  }

  function closeThemeMenu(refocus) {
    var menu = document.getElementById('theme-menu');
    if (!menu || menu.hasAttribute('hidden')) return;
    menu.setAttribute('hidden', '');
    var btn = document.getElementById('btn-theme');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    /* Escape / 外部点击关闭时把焦点还给触发器，否则焦点会掉到 body 上 */
    if (refocus && btn) { try { btn.focus(); } catch (e) { /* 忽略 */ } }
  }

  function toggleThemeMenu() {
    if (themeMenuOpen()) closeThemeMenu(true); else openThemeMenu();
  }

  /* ============ 导航栏 ============ */
  function renderNav() {
    var links = '<a href="#/" data-nav="home">首页</a>' +
      '<a href="#/archive" data-nav="archive">归档</a>' +
      '<a href="#/search" data-nav="search">搜索</a>' +
      '<a href="#/tags" data-nav="tags">标签</a>' +
      '<a href="#/marks" data-nav="marks">收藏</a>' +
      '<a href="#/about" data-nav="about">关于</a>';
    if (State.session && State.session.user) {
      var email = State.session.user.email || '';
      links += '<span class="nav-user" title="' + V().esc(email) + '">' + V().esc(State.nickname || email.split('@')[0] || 'OPERATOR') + '</span>' +
        '<a href="#/admin" data-nav="admin">控制台</a>' +
        '<a href="#/tagadmin" data-nav="tagadmin">标签管理</a>' +
        '<a href="#" id="nav-logout" style="color:var(--magenta)">退出</a>';
    } else {
      links += '<a href="#/login" data-nav="login" style="color:var(--yellow)">登录 ▸</a>';
    }
    /* C6：主题控点（无 href，非导航项，故不带 data-nav）
       真实偏好由 applyTheme 立即补正，首绘前那一瞬间由 theme-boot.js 定好，不会闪。

       v2.9.4：由「单按钮循环」升级为「三档罗盘单选」。
         · #btn-theme 退化为 disclosure 触发器（仍必须是 <button>：R49b 守着）
         · #theme-menu 是 role=radiogroup 面板，三项用 <button role=radio>
       ⚠ 为什么不用原生 <input type="radio">：
           ① 本站点击一律走 e.target.closest() 委托，原生 radio 需要 <label>
              包裹才能样式化，而 label 会改变 e.target，委托要另写一套判定；
           ② CSP 无 'unsafe-inline' → onchange 不可用，还得额外补一份 JS 绑定；
           ③ role=radio + aria-checked 能达到完全相同的读屏语义。 */
    links += '<button type="button" id="btn-theme" class="theme-toggle"' +
      ' aria-haspopup="true" aria-expanded="false" aria-controls="theme-menu"' +
      ' aria-label="配色，当前 ☾ DARK">☾ DARK</button>' +
      /* v3.0 B1：面板升级为二维（明度 × 色相）。
         外层从 radiogroup 改为 group —— 单选语义下沉到两个 .theme-row，
         因为一个 radiogroup 只能承载一组单选，12 项混装会让读屏把
         "明度"和"色相"念成一个九选一。 */
      '<div class="theme-menu" id="theme-menu" role="group" aria-label="配色" hidden>' +
      themeMenuHtml() +
      '</div>';
    navEl.innerHTML = links;
    /* 面板是 innerHTML 重建出来的，aria-checked 必须当场按当前档位落定 ——
       否则登录/登出触发 renderNav 后，选中态会全部退回初始值。 */
    syncThemeMenu(getTheme());
    /* v4.3 B4：同样按当前状态落定氛围/装置区（模式/层开关/点击反馈/锁定） */
    syncAtmoPanel();
  }

  /* 罗盘三项。aria-checked 初值一律 false，真值由 syncThemeMenu 统一写 ——
     单一来源，避免"模板里写死 true"与运行态不一致。 */
  function themeSwapsHtml() {
    return THEME_ORDER.map(function (m) {
      return '<button type="button" class="theme-swap" role="radio"' +
        ' data-theme-val="' + m + '" aria-checked="false" tabindex="-1"' +
        ' title="' + (THEME_ICON[m] || m) + '">' +
        '<span class="theme-swap-ring" aria-hidden="true"></span>' +
        '<span class="theme-swap-label">' + (THEME_NAME[m] || m) + '</span>' +
        '</button>';
    }).join('');
  }

  /* v3.0 B1：面板总装 —— 两块（明度 / 色相），各自一个 radiogroup。
     用 aria-labelledby 把组和它的可见标签绑起来：读屏念到组时能说出
     "这是一个明度/色相的单选组"，而不是一串孤立的按钮。

     v4.3 B4：罗盘 → 装置面板（三区：外观＝明度+色相 / 氛围 / 装置）。
     氛围区的九层开关是 aria-pressed 的 toggle 组（不是 radio —— 它们可多选，
     语义上就是"一组独立开关"）；"恢复场景自动"在手动模式外隐藏（无意义不显示）。 */
  function atmoModesHtml() {
    var MODES = [
      { v: 'pollution', n: '光污染', t: '九层全开（出厂）' },
      { v: 'standard', n: '标准', t: '只留静态层（噪点/扫描线/网格/光晕/光溢/招牌）' },
      { v: 'silent', n: '静音', t: '全部关闭' }
    ];
    return MODES.map(function (m) {
      return '<button type="button" class="atmo-mode" role="radio"' +
        ' data-atmo-val="' + m.v + '" aria-checked="false" tabindex="-1"' +
        ' title="' + m.t + '">' + m.n + '</button>';
    }).join('');
  }

  function atmoLayersHtml() {
    /* 名字的单一来源：atmo.js 的 ATMO_LABEL（惰性取用，缺失回落 id 原文） */
    var label = (window.NEONAtmo && window.NEONAtmo.ATMO_LABEL) || {};
    return atmoOrder().map(function (id) {
      return '<button type="button" class="atmo-layer-btn" data-atmo-layer="' + id + '"' +
        ' aria-pressed="false" title="' + id + '">' + (label[id] || id) + '</button>';
    }).join('');
  }

  function deviceZoneHtml() {
    var TAPS = [
      { v: 'off', n: '关' },
      { v: 'normal', n: '标准' },
      { v: 'heavy', n: '重度' }
    ];
    return '<span class="devices-sub">点击反馈</span>' +
      '<div class="theme-row" id="tap-mode-row" role="radiogroup" aria-label="点击反馈强度">' +
      TAPS.map(function (t) {
        return '<button type="button" class="tap-mode" role="radio"' +
          ' data-tap-val="' + t.v + '" aria-checked="false" tabindex="-1">' + t.n + '</button>';
      }).join('') +
      '</div>';
  }

  function themeMenuHtml() {
    return '<div class="theme-block">' +
        '<span class="theme-block-label" id="theme-modes-label">明度</span>' +
        '<div class="theme-row" role="radiogroup" aria-labelledby="theme-modes-label">' +
        themeSwapsHtml() +
        '</div>' +
      '</div>' +
      '<div class="theme-block">' +
        '<span class="theme-block-label" id="theme-hues-label">色相</span>' +
        /* v3.4.0：自由滑杆 + 下方九档快捷。
           ⚠ 滑杆刻意**不放进** role=radiogroup 里 —— 它是 slider 语义（原生 range 自带），
             与"单选"是两回事；混进 radiogroup 会让读屏把它当成第 10 个单选项。
           ⚠ 用原生 input[type=range]：键盘方向键、Home/End、读屏的增减全部白送，
             自定义 div 滑杆要把这些重写一遍。 */
        '<div class="hue-slider-row">' +
          '<input type="range" id="hue-slider" class="hue-slider" min="0" max="359" step="1"' +
            ' value="' + HUE_DEFAULT + '" aria-labelledby="theme-hues-label" aria-describedby="hue-readout"' +
            ' aria-valuetext="' + HUE_DEFAULT + ' 度">' +
          '<output class="hue-readout" id="hue-readout" for="hue-slider">' + HUE_DEFAULT + '°</output>' +
        '</div>' +
        '<div class="theme-row" role="radiogroup" aria-labelledby="theme-hues-label">' +
        themeHuesHtml() +
        '</div>' +
      '</div>' +
      /* 氛围区（v4.3 B4）：三档模式 + 九层手动开关 */
      '<div class="theme-block">' +
        '<span class="theme-block-label" id="atmo-modes-label">氛围</span>' +
        '<div class="theme-row" role="radiogroup" aria-labelledby="atmo-modes-label">' +
        atmoModesHtml() +
        '</div>' +
        '<div class="atmo-layers" role="group" aria-label="氛围层开关（手动微调）">' +
        atmoLayersHtml() +
        '</div>' +
        '<button type="button" class="atmo-reset" id="atmo-reset" hidden>↺ 恢复场景自动</button>' +
      '</div>' +
      /* 装置区（v4.3 B4）：点击反馈 + 性能锁定 + 重播开机 */
      '<div class="theme-block">' +
        '<span class="theme-block-label" id="devices-label">装置</span>' +
        deviceZoneHtml() +
        '<button type="button" class="device-toggle" id="atmo-lock" role="switch" aria-checked="false">' +
          '性能锁定（不自动降档）</button>' +
        '<button type="button" class="device-action" id="replay-boot">↻ 重播开机序列</button>' +
      '</div>';
  }

  /* 九档色相色卡。档位值一并用于 CSS（.theme-hue[data-hue-val="N"] { --sw: N }）——
     JS 只输出档位，不输出颜色，配色仍由 CSS 单一来源决定。 */
  function themeHuesHtml() {
    return HUE_STOPS.map(function (h) {
      var name = HUE_NAME[h] || String(h);
      return '<button type="button" class="theme-hue" role="radio"' +
        ' data-hue-val="' + h + '" aria-checked="false" tabindex="-1"' +
        ' title="色相 · ' + name + '" aria-label="色相 ' + name + '">' +
        '<span class="theme-hue-dot" aria-hidden="true"></span>' +
        '</button>';
    }).join('');
  }

  function setActiveNav(key) {
    navEl.querySelectorAll('a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === key);
    });
  }

  /* ============ 路由 ============ */
  /* 安全审计 L-3：畸形 URI 编码（如 #/% 、#/%E0%A4%A）会让 decodeURIComponent 抛
     URIError。路由层崩了会被 safeRoute 兜住不白屏，但用户看到的是空白页 —— 一样是故障。
     故逐段安全解码，坏段保持原样而不是中断整个路由。 */
  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function parseHash() {
    var h = location.hash || '#/';
    var path = h.replace(/^#\/?/, '');
    var parts = path.split('/').filter(Boolean).map(safeDecode);
    if (parts.length === 0) return { name: 'home' };
    if (parts[0] === 'post' && parts[1]) return { name: 'post', id: parseInt(parts[1], 10) };
    if (parts[0] === 'tags') return { name: 'tags' };
    if (parts[0] === 'search') return { name: 'search', q: parts[1] || '' };
    if (parts[0] === 'archive') return { name: 'archive' };
    if (parts[0] === 'tag' && parts[1]) return { name: 'home', tag: parts[1] };
    if (parts[0] === 'marks') return { name: 'marks' };
  if (parts[0] === 'radio') return { name: 'radio' };
    if (parts[0] === 'tagadmin') return { name: 'tagadmin' };
    if (parts[0] === 'about') return { name: 'about' };
    if (parts[0] === 'login') return { name: 'login' };
    if (parts[0] === 'admin') return { name: 'admin' };
    if (parts[0] === 'edit') {
      if (parts[1] === 'new' || !parts[1]) return { name: 'edit', id: null };
      return { name: 'edit', id: parseInt(parts[1], 10) };
    }
    return { name: 'home' };
  }

  /* v4.0 B1：场景应用（惰性取用 + 降级 —— scene.js 缺失/异常时路由不受影响）。
     跨文件全局一律惰性取用是本项目纪律，catch 分支绝不裸引用外部全局。 */
  function applyScene(name) {
    try {
      var S = window.NEONScene;
      if (S && typeof S.apply === 'function') S.apply(name);
    } catch (e) { /* 场景框架异常不拖累渲染 */ }
  }

  /* ---------- v5.4.0：首页两栏（左全息读数 / 右身份卡） ----------
     ⚠ 在 app.js 注入而不是改 homeView：homeView 结构被多处断言钉着，前置注入是**纯加法**。
     ⚠ 读数沿用既有 id 与 class/data-born，所以"建站时间单一来源"那套契约不变（只是搬了位置）。 */
  var holoTickTimer = null;
  /* ⚠ v5.4.0：**不许在这里写日期字面量** —— 单一来源是 views.js 的 SITE_BORN，
     运行时优先从 DOM 的 data-born 读（这正是既有那套"读数不重复日期"的契约）。 */
  function holoBorn() {
    var el = document.querySelector('[data-born]');
    if (el && el.getAttribute('data-born')) return el.getAttribute('data-born');
    return (V() && V().SITE_BORN) || '';
  }
  function holoParts() {
    var d = Math.max(0, Date.now() - new Date(holoBorn()).getTime());
    var s = Math.floor(d / 1000);
    return { days: Math.floor(s / 86400), hours: Math.floor(s % 86400 / 3600),
             mins: Math.floor(s % 3600 / 60), secs: s % 60,
             date: holoBorn().slice(0, 10).replace(/-/g, '.') };
  }
  function holoPad(n) { return (n < 10 ? '0' : '') + n; }
  function holoText(p) { return p.days + 'D ' + holoPad(p.hours) + ':' + holoPad(p.mins) + ':' + holoPad(p.secs); }
  function holoPaint() {
    var p = holoParts();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set('uptime-days', p.days); set('uptime-hours', holoPad(p.hours));
    set('uptime-min', holoPad(p.mins)); set('uptime-sec', holoPad(p.secs));
    var big = document.querySelector('[data-holo-uptime]');
    if (big) { var txt = holoText(p); big.textContent = txt; big.setAttribute('data-text', txt); }
  }
  function holoNowPaint() {
    var cur = null;
    try { cur = rcCurrent(); } catch (e) { cur = null; }
    var tEl = document.querySelector('[data-holo-now]');
    var sEl = document.querySelector('[data-holo-now-sub]');
    /* ⚠ 站长选了"诚实版"：网易云是跨域 iframe，真实播放态**读不到**（同源策略所限）——
       所以这里只说"当前条目"，绝不写"正在播放"。 */
    if (tEl) tEl.textContent = cur ? (cur.title || '未命名') : '电台待命';
    if (sEl) sEl.textContent = cur ? ((cur.artist || '') + (cur.kind === 'playlist' ? ' · 歌单' : ' · 单曲') + ' · 当前条目') : '还没有条目';
  }
  function injectHoloHero() {
    if (typeof document === 'undefined') return;
    var app = document.getElementById('app');
    if (!app || !V().holoHero) return;
    if (app.querySelector('.holo-hero')) { holoPaint(); holoNowPaint(); return; }
    var p = holoParts();
    app.insertAdjacentHTML('afterbegin', V().holoHero({
      days: p.days, hours: p.hours, mins: p.mins, secs: p.secs, bootDate: p.date,
      uptimeText: holoText(p), nickname: State.nickname || '漓光', tags: ['站长', '作者']
    }));
    holoPaint(); holoNowPaint();
    if (holoTickTimer) clearInterval(holoTickTimer);
    holoTickTimer = setInterval(function () {
      if (!document.querySelector('.holo-hero')) { clearInterval(holoTickTimer); holoTickTimer = null; return; }
      holoPaint();
    }, 1000);
  }

  /* ---------- v5.1.0：电台页与常驻控制台 ---------- */
  var RC_KEY = 'neon_radio_current';   /* 当前选中条目（本机记住，切页面不丢） */
  var RC_STATE = { items: [], curId: '', error: '', loaded: false, mounted: '' };

  function rcCurrentId() {
    if (RC_STATE.curId) return String(RC_STATE.curId);
    var v = '';
    try { v = localStorage.getItem(RC_KEY) || ''; } catch (e) { v = ''; }
    return v;
  }

  function rcSetCurrent(id) {
    RC_STATE.curId = id ? String(id) : '';
    try { if (RC_STATE.curId) localStorage.setItem(RC_KEY, RC_STATE.curId); } catch (e) {}
  }

  function rcCurrent() {
    var id = rcCurrentId();
    for (var i = 0; i < RC_STATE.items.length; i++) {
      if (String(RC_STATE.items[i].id) === id) return RC_STATE.items[i];
    }
    return null;
  }

  /* 把官方播放器挂进常驻控制台。
     ⚠ **只在目标地址变化时重建 iframe** —— 重建 = 重新加载 = 歌断掉。
       所以这一步绝不能在路由切换时无条件调用（这是整个重做的核心）。 */
  function paintStage() {
    if (typeof document === 'undefined') return;   /* 降级环境没有 DOM：直接退出（实测踩到） */
    var stage = document.getElementById('radio-stage');
    if (!stage) return;
    var host = stage.querySelector('[data-rc-slot]');
    var titleEl = stage.querySelector('[data-rc-title]');
    var subEl = stage.querySelector('[data-rc-sub]');
    var freqEl = stage.querySelector('[data-rc-freq]');
    var cur = rcCurrent();
    var url = cur ? cur.source_url : '';
    var isFull = (location.hash.replace(/^#\/?/, '').split('/')[0] || '') === 'radio';
    stage.hidden = !url;                       /* 没条目就整块隐藏（访客也不该看到空壳） */
    stage.setAttribute('data-mode', isFull ? 'full' : 'mini');
    if (titleEl) titleEl.textContent = cur ? (cur.title || '未命名') : '电台待命';
    if (subEl) subEl.textContent = cur ? ((cur.artist || '') + (cur.kind === 'playlist' ? ' · 歌单' : ' · 单曲')) : '网易云官方外链播放器';
    if (freqEl) freqEl.textContent = cur && cur.netease_id ? String(cur.netease_id).slice(0, 7) : '--';
    if (!host || !url) { if (host) host.innerHTML = ''; RC_STATE.mounted = ''; return; }
    if (RC_STATE.mounted === url) return;      /* 同一个地址：什么都不做（歌继续放） */
    host.innerHTML = '<iframe class="rc-frame" src="' + V().esc(url) + '" width="330" height="' +
      (/type=0/.test(url) ? '430' : '66') + '" frameborder="0" allow="autoplay" title="网易云音乐外链播放器"></iframe>' +
      '<a class="rc-fallback" href="' + V().esc(url) + '" target="_blank" rel="noopener noreferrer">播放器加载不出来？在新窗口打开 ↗</a>';
    RC_STATE.mounted = url;
  }

  async function rcLoad() {
    if (typeof document === 'undefined') { RC_STATE.loaded = true; return; }
    try {
      var rows = await need('Radio').list();
      RC_STATE.items = rows || [];
      RC_STATE.error = '';
      /* 没有选中过 / 选中的已被删 → 落到第一条 */
      if (!rcCurrent()) rcSetCurrent(RC_STATE.items.length ? RC_STATE.items[0].id : '');
    } catch (e) {
      RC_STATE.items = [];
      RC_STATE.error = errMsg(e, '条目读取失败');
    }
    RC_STATE.loaded = true;
    paintStage();
  }

  function renderRadio() {
    if (typeof document === 'undefined') return;
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = V().radioView({ items: RC_STATE.items, curId: rcCurrentId(), canManage: canManageRadio(), error: RC_STATE.error });
    paintStage();
    if (!RC_STATE.loaded) rcLoad().then(function () {
      /* 数据回来重绘列表（当前页已是电台时才重绘，避免白跑） */
      if ((location.hash.replace(/^#\/?/, '').split('/')[0] || '') === 'radio') renderRadio();
    }, function () {});
  }

  /* 电台页的点击代理（播放 / 删除 / 上下移 / 新增）—— 只绑一次 */
  var rcPageBound = false;
  function bindRadioPageOnce() {
    if (rcPageBound) return;
    rcPageBound = true;
    bindRadioPage();
  }

  function bindRadioPage() {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-radio-act]') : null;
      if (!el) return;
      var act = el.getAttribute('data-radio-act');
      var id = el.getAttribute('data-id');
      if (act === 'tune') { location.hash = '#/radio'; ev.preventDefault(); return; }
      if (act === 'playitem') {
        rcSetCurrent(id);
        paintStage();
        if ((location.hash.replace(/^#\/?/, '').split('/')[0] || '') !== 'radio') location.hash = '#/radio';
        else renderRadio();
        ev.preventDefault();
        return;
      }
      if (act === 'del') {
        /* ⚠ 项目里没有 askConfirm 这个助手（第一版我凭印象写了，会直接抛错）。
           现成的确认框是 openModal(title, html, actions)。 */
        openModal('删除条目', '<p>从电台移除这条记录。<b>不影响网易云上的内容</b>，随时可以再加回来。</p>', [
          { label: '取消', cls: 'btn-ghost', onClick: closeModal },
          { label: '确认删除', cls: 'btn-magenta', onClick: async function () {
            closeModal();
            try { await need('Radio').remove({ id: Number(id) }); await rcLoad(); renderRadio(); toast('已删除', 'ok'); }
            catch (e2) { toast(errMsg(e2, '删除失败'), 'error'); }
          } }
        ]);
        ev.preventDefault();
        return;
      }
      if (act === 'up' || act === 'down') {
        (async function () {
          var list = RC_STATE.items.slice();
          var i = list.findIndex(function (r) { return String(r.id) === String(id); });
          var j = act === 'up' ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= list.length) return;
          var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
          try {
            await need('Radio').reorder(list.map(function (r, k) { return { id: r.id, sort_order: k }; }));
            await rcLoad(); renderRadio();
          } catch (e2) { toast(errMsg(e2, '排序失败'), 'error'); }
        })();
        ev.preventDefault();
        return;
      }
      if (act === 'additem') {
        var box = document.querySelector('[data-radio-compose]');
        if (!box) return;
        var tEl = box.querySelector('[data-radio-field="title"]');
        var aEl = box.querySelector('[data-radio-field="artist"]');
        var uEl = box.querySelector('[data-radio-field="url"]');
        var kEl = box.querySelector('[data-radio-field="kind"]');
        var msg = box.querySelector('[data-radio-msg]');
        function say(s, kind) { if (msg) { msg.hidden = false; msg.textContent = s; msg.className = 'radio-form-msg' + (kind ? ' is-' + kind : ''); } }
        var uid = State.session && State.session.user && State.session.user.id;
        if (!uid) { say('请先登录', 'err'); return; }
        var url = (uEl && uEl.value || '').trim();
        var title = (tEl && tEl.value || '').trim();
        if (!url || !title) { say('名称与链接都要填', 'err'); return; }
        (async function () {
          try {
            say('正在写入…');
            var row = await need('Radio').add(url, { title: title, artist: (aEl && aEl.value || '').trim(), kind: (kEl && kEl.value) || 'auto', id: url }, uid);
            rcSetCurrent(row && row.id ? row.id : rcCurrentId());
            await rcLoad();
            renderRadio();
            toast('已加入电台：' + title, 'ok');
          } catch (e2) { say(errMsg(e2, '加入失败'), 'err'); }
        })();
        ev.preventDefault();
        return;
      }
    }, true);
  }

  /* 启动即拉一次条目并绑好代理：控制台要据此决定显不显示、摆哪一条。
     ⚠ 必须放在**所有 var 赋值之后** —— 第一版插在 RC_STATE = {...} 之前，
       var 提升给了 undefined，启动直接 TypeError（实测）。 */
  /* ⚠ 必须有守卫：某个降级用例跑在没有 document 的环境里 ——
     在顶层直接碰 document 会 TypeError，整套门禁当场挂掉（实测两次）。 */
  if (typeof document !== 'undefined') {
    bindRadioPageOnce();
    /* v5.3.0：电台条目**不再在首屏同步拉** —— 访客多半没开电台，却要为此等一次跨区往返
       （实测 0.7~1.2s）。改成首绘之后再拉，控制台随之出现。 */
    if (window.requestIdleCallback) requestIdleCallback(function () { rcLoad(); }, { timeout: 2500 });
    else setTimeout(function () { rcLoad(); }, 1200);
    /* ⚠ 路由一变就重算控制台体型（mini ↔ full）—— 只改 data-mode，**不动 iframe**，
       这正是"切页面不断歌"的实现方式。
       第一版只在电台交互时重算，于是离开电台页后控制台还赖在大体型上（线上验收发现）。 */
    window.addEventListener('hashchange', function () { paintStage(); });
  }

function route() {
    var h = location.hash || '#/';
    if (h === State.lastHash) return;
    State.lastHash = h;
    closeModal();
    releaseToc(); /* C2：离开当前页前释放上一页目录的滚动监听，避免跨页累积 */
    stopUptimeTicker(); /* v2.9.9：同理，离开 ABOUT 页就停掉在线时长计时器 */
    var r = parseHash();
    applyScene(r.name); /* v4.0 B1：场景框架（写 data-scene / data-atmo；惰性降级） */
    var titles = {
      home: 'SIGNAL LOG', post: 'SIGNAL', tags: 'TAG MATRIX',
      search: '搜索', archive: '归档', marks: '收藏',
      tagadmin: 'TAG CONTROL',
      about: '关于', login: 'ACCESS', admin: 'CONSOLE', edit: 'EDITOR'
    };
    document.title = 'NEON://DIARY — ' + (titles[r.name] || '');
    setActiveNav(r.name === 'home' && r.tag ? 'tags' : r.name);

    /* C9：切页后内容高度完全变了，进度条/回顶按钮必须按新页面重算，
       否则会残留上一页的进度与按钮可见性。
       此处只重置到"本页起点"状态，真正的量算交给各渲染函数结束后的
       scheduleScrollUI（内容落地才有正确高度）。 */
    try { updateScrollUI(); } catch (e) { /* 忽略 */ }

    if (r.name === 'home') return renderHome(r.tag || null);
    if (r.name === 'post') return renderPost(r.id);
    if (r.name === 'tags') return renderTags();
    if (r.name === 'search') return renderSearch(r.q || '');
    if (r.name === 'archive') return renderArchive();
    if (r.name === 'marks') return renderMarks();
  if (r.name === 'radio') return renderRadio();
    if (r.name === 'tagadmin') return renderTagAdmin();
    if (r.name === 'about') {
      app.innerHTML = V().aboutView();
      window.scrollTo(0, 0);
      startUptimeTicker();
      return;
    }
    if (r.name === 'login') return renderLogin();
    if (r.name === 'admin') return renderAdmin();
    if (r.name === 'edit') return renderEdit(r.id);
  }

  /* ============ 首页 / 标签过滤 ============ */
  /* ---------- v2.9.9 站点在线时长（ABOUT 页 HUD）----------
     为什么不用「每秒都跑的全局定时器」：那是拿"全站每个页面都付一点 CPU"
     换"ABOUT 页少写两行"——绝大多数时间用户根本不在 ABOUT 页。
     这里沿用 releaseToc() 的同一路子：进页开表、离页停表（route 顶部统一停）。
     建站时间从 DOM 的 data-born 读 —— 日期字面量只活在 views.js 一处。
     v2.9.9 读数口径（用户指正后修正）：天/时/分/秒 四段分解，
     时/分/秒各补零两位；v2.9.8 的「累计总秒数 + 千分位」读法退役。 */
  var uptimeTimer = null;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function uptimeTick() {
    var secEl = document.getElementById('uptime-sec');
    if (!secEl || !secEl.closest) return;   /* 不在 ABOUT 页，静默退出 */
    var hud = secEl.closest('.uptime-hud');
    var start = new Date(hud ? (hud.getAttribute('data-born') || '') : '').getTime();
    if (!isFinite(start)) return;           /* data-born 缺失/畸形，宁可显示 — 也别算错 */
    var s = Math.floor(Math.max(0, Date.now() - start) / 1000);
    var daysEl = document.getElementById('uptime-days');
    var hoursEl = document.getElementById('uptime-hours');
    var minEl = document.getElementById('uptime-min');
    if (daysEl) daysEl.textContent = String(Math.floor(s / 86400));
    if (hoursEl) hoursEl.textContent = pad2(Math.floor(s % 86400 / 3600));
    if (minEl) minEl.textContent = pad2(Math.floor(s % 3600 / 60));
    secEl.textContent = pad2(s % 60);
  }

  function startUptimeTicker() {
    stopUptimeTicker();
    uptimeTick();                           /* 先立刻画一帧，避免首秒停在「—」 */
    uptimeTimer = setInterval(uptimeTick, 1000);
  }

  function stopUptimeTicker() {
    if (uptimeTimer) { clearInterval(uptimeTimer); uptimeTimer = null; }
  }


  function renderHome(tag) {
    State.home = { page: 1, pageSize: 8, posts: [], total: 0, loading: true, error: null, tagName: tag, hasMore: false };
    app.innerHTML = V().homeView(State.home);
    injectHoloHero();
    window.scrollTo(0, 0);
    loadHome(false);
  }

  async function loadHome(append) {
    var s = State.home;
    if (!append) s.page = 1;
    s.loading = true;
    try {
      var r = await need('Posts').listPublished({ page: s.page, pageSize: s.pageSize, tag: s.tagName });
      /* C19：渲染前把本地收藏态盖到数据上（postCard 读 _marked） */
      applyMarks(r.posts || []);
      s.posts = append ? s.posts.concat(r.posts) : r.posts;
      s.total = r.total;
      s.hasMore = s.posts.length < r.total;
      s.error = null;
    } catch (e) {
      s.error = errMsg(e, '数据流连接失败，请稍后重试');
    }
    s.loading = false;
    app.innerHTML = V().homeView(s);
    injectHoloHero();
    /* 列表页封面：只要缩略图（B1），无缩略图的旧图由数据层自动回退 */
    hydrateImages(app, { thumb: true });
    if (append) {
      var list = document.querySelector('.post-list');
      if (list) window.scrollTo(0, document.body.scrollHeight - 600);
    }
    /* C9：内容换完，高度变了 —— 重算进度/回顶状态 */
    scheduleScrollUI();
  }

  /* ============ C19：收藏页（v4.9.0 起读云端） ============
     数据来源是**账号的收藏 id 列表**（内存缓存，登录后由 refreshMarks 取回）
     → 再去库层取这些文章的详情。

     ⚠ 门槛：未登录不渲染列表，改为明确的登录引导 ——
       与"标签管理"页同一处理（不能渲染一个点了没反应的界面）。

     取数策略：并发逐条 get，而不是"拉全量再筛" ——
     因为收藏通常是少数几条，拉全量（上限 200）只为筛出 3 条代价更大。
     用 parallelSafe 保证单条失败不影响其余（收藏的文章可能已被删除，
     这条失败是**正常情况**，必须静默跳过而不是整页报错）。 */
  async function renderMarks() {
    var state = { loading: true, posts: [], needLogin: false, offline: false };

    if (!isLoggedIn()) {
      state.loading = false;
      state.needLogin = true;
      app.innerHTML = V().marksView(state);
      bindMarksLogin();
      window.scrollTo(0, 0);
      scheduleScrollUI();
      return;
    }

    app.innerHTML = V().marksView(state);
    window.scrollTo(0, 0);

    if (!marksLoaded) await refreshMarks();
    /* 云端不可达时 list() 返回空表 —— 与"真的没有收藏"要分开说，
       否则用户会以为自己 5 条收藏丢了（靠 isSnapshot 判） */
    state.offline = !markSet().size && need('isSnapshot')();
    var ids = Array.from(markSet());
    if (!ids.length) {
      state.loading = false;
      app.innerHTML = V().marksView(state);
      scheduleScrollUI();
      return;
    }
    var tasks = ids.map(function (id) {
      return function () { return need('Posts').get(id); };
    });
    var res = await parallelSafe(tasks);
    var posts = [];
    res.forEach(function (r) {
      /* 只有公开可见的才展示：草稿/已删除在公开语义下等同于"不在"。 */
      if (r && r.ok && r.value && r.value.status === 'published') posts.push(r.value);
    });
    applyMarks(posts);
    /* 收藏里有已删除/已下架的文章 → 顺手清掉云端记录，别留僵尸条目 */
    if (posts.length !== ids.length) {
      var alive = {};
      posts.forEach(function (p) { alive[parseInt(p.id, 10)] = 1; });
      ids.forEach(function (id) {
        if (!alive[id]) { try { need('Bookmarks').remove(id); markSet().delete(id); } catch (e) {} }
      });
    }
    state.posts = posts;
    state.loading = false;
    app.innerHTML = V().marksView(state);
    hydrateImages(app, { thumb: true });
    bindMarksClear();
    scheduleScrollUI();
  }

  /* 未登录时的登录入口（收藏页空态里的按钮） */
  function bindMarksLogin() {
    var btn = document.getElementById('marks-login');
    if (!btn) return;
    btn.addEventListener('click', function () { location.hash = '#/login'; });
  }

  function bindMarksClear() {
    var btn = document.getElementById('marks-clear');
    if (!btn) return;
    btn.addEventListener('click', function () {
      openModal('清空收藏', '<p>将移除你账号下的全部收藏记录（不影响文章本身）。此操作不可撤销。</p>', [
        { label: '取消', cls: 'btn-ghost', onClick: closeModal },
        { label: '确认清空', cls: 'btn-magenta', onClick: async function () {
          closeModal();
          var ids = Array.from(markSet());
          var B = need('Bookmarks');
          var failed = 0;
          for (var i = 0; i < ids.length; i++) {
            try { await B.remove(ids[i]); } catch (e) { failed++; }
          }
          if (failed) { toast('有 ' + failed + ' 条没删掉，请重试', 'error'); }
          else { toast('收藏已清空', 'ok'); }
          await refreshMarks();
          route();
        } }
      ]);
    });
  }

  /* ============ v2.8.0：电台（RADIO） ============
     三块拼起来：内核（js/radio.js，纯逻辑）+ 视图（views.js 纯渲染）+ 这里（接线）。

     ★ 为什么播放器不放在 #app 里：路由每次渲染都会重写 #app.innerHTML，
       播放器若在内部会被反复重建 —— 音频会中断、状态会丢。
       它挂在 index.html 的 #radio-dock（#app 之外），与阅读进度条同理。

     ★ 为什么用事件代理而不是逐个绑定：面板是整块重渲染的（订阅 statechange），
       逐个绑定会在每次重渲染后失效、需要重绑。代理到容器上只绑一次，永久有效。 */
  var RadioUI = {
    rows: [],            /* 曲目缓存（避免每次开面板都请求） */
    loaded: false,
    panelOpen: false,
    busy: false          /* 上传中标志，防重复提交 */
  };

  var radioDockEl = document.getElementById('radio-dock');

  /* 是否具备管理权限（作者本人）。未登录或非作者 → 只读收听 */
  function canManageRadio() {
    return !!(State.session && State.session.user);
  }

  /* 渲染迷你条（只在状态变化时调用，不整页重绘） */
  /* v5.2.0：旧小条已移除。保留空实现是为了不动那 6 处调用点
     （删函数会连锁 ReferenceError；清空实现更安全，也让旧入口彻底失效）。
     ⚠ 真正的播放界面是 #app 之外的 #radio-stage（见 paintStage）。 */
  function paintDock() {
    return;
    /* eslint-disable no-unreachable */
    if (!radioDockEl) return;
    var st = window.NEONRadio ? window.NEONRadio.state() : null;
    if (!st) return;

    /* 即便下面要把 dock 藏起来，面板里的进度/时间也要同步（面板可能开着） */
    paintPanelProgress(st);

    /* 让主内容顶部为 dock 让位（CSS: body.has-radio .wrap）。
       ⚠ 判据用「电台可用」而非「dock 当前可见」—— 否则面板一开一关，
          class 跟着抖，正文会上下跳 84px。 */
    try {
      document.body.classList.toggle('has-radio', !!st.count || canManageRadio());
    } catch (e) { /* 忽略 */ }

    /* ⚠ 面板展开时收起迷你条：两者都定位在左上角同一处（left:16 /
       top:var(--topbar-h)+14），同时显示会**完全重叠**、面板盖住 dock
       （实测面板 z-index 70 > dock 60）。收起态 → 迷你条；展开态 → 面板。
       面板自带播放控制与收起按钮，因此不必两个同时在场。 */
    if (RadioUI.panelOpen) {
      radioDockEl.hidden = true;
      return;
    }

    /* ⚠ 空曲目时的显隐策略（易错点）：
       最初写成「没曲目就隐藏 dock」，结果作者也看不到入口 —— 无法上传第一首歌，
       形成死锁。正确逻辑：
         · 已登录（能管理）→ **始终显示**，空时 dock 文案引导「点开添加曲目」
         · 未登录（只能听）→ 空时隐藏，避免访客看到一个永远没内容的播放器 */
    if (!st.count && !canManageRadio()) {
      radioDockEl.hidden = true;
      return;
    }
    radioDockEl.hidden = false;
    radioDockEl.innerHTML = V().radioDockView(st);
  }

  /* 只更新面板里随时间变化的部位（进度条/时间），避免整面板重渲染抢焦点 */
  function paintPanelProgress(st) {
    var panel = document.querySelector('.radio-panel');
    if (!panel) return;
    var seek = panel.querySelector('.radio-seek');
    var cur = panel.querySelector('[data-radio-time]');
    /* ⚠ 总时长也要跟着更新：它只在整面板重绘时渲染一次，
       切歌后如果不在这里纠正，就会一直显示**上一首**的时长（实测踩到）。 */
    var dur = panel.querySelector('[data-radio-dur]');
    if (seek) {
      var d = st.duration || 0;
      var val = d > 0 ? Math.round((st.time / d) * 1000) : 0;
      /* ⚠ 用户正在拖动时不要回写 value —— 会跟手指打架、拖不动。
         用 document.activeElement 判断是否持有焦点（拖动中的 range 会获得焦点）。 */
      if (document.activeElement !== seek) seek.value = String(clamp01(val));
    }
    if (cur) cur.textContent = window.NEONRadio.fmtTime(st.time);
    if (dur) dur.textContent = window.NEONRadio.fmtTime(st.duration || 0);
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1000 ? 1000 : v); }

  /* 整面板渲染（打开、或曲目列表/模式变化时） */
  function paintPanel() {
    if (!RadioUI.panelOpen) {
      var old = document.querySelector('.radio-panel');
      if (old) old.remove();
      return;
    }
    var st = window.NEONRadio.state();
    st.canManage = canManageRadio();
    /* 列表尚未拉到（首次打开、尚未 loaded）→ 显示"调频中"骨架而非"没有曲目" */
    st.listLoading = !RadioUI.loaded;
    var host = document.getElementById('radio-panel-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'radio-panel-host';
      document.body.appendChild(host);
    }
    host.innerHTML = V().radioPanelView(st);
    /* 表单里已填的内容不因重渲染丢失：重渲染前记下、渲染后回填 */
    restoreFormDraft();
  }

  /* ---------- 面板开关 ----------
     ★ 必须"先开面板、后取数据"：
       面板渲染绝不能 await 网络 —— 否则网络慢/被阻断时点了没反应，
       用户以为按钮坏了（2026-09-29 真实浏览器实测：本地起服打云服务
       list() 3s 不返回，面板死活打不开）。
       正解：同步渲染骨架（loading 态）→ 立刻 bind → 后台补数据再重绘。 */
  function openRadioPanel() {
    /* v5.2.0：旧面板已废弃 —— 任何想"打开面板"的调用统一改成进电台页 */
    location.hash = '#/radio';
    return;
    /* eslint-disable no-unreachable */
    RadioUI.panelOpen = true;
    paintPanel();      /* 先出面板（此刻 RadioUI.rows 可能是旧值/空，先给骨架） */
    paintDock();
    bindRadioPanel();
    /* 首次打开才拉列表；已有缓存直接用（避免每次开面板都打网络）。
       loadRadioTracks 内部自带 catch，失败会 toast 并保持空态，不会静默。 */
    if (!RadioUI.loaded) {
      loadRadioTracks().then(function () {
        /* 数据回来后重绘（此时用户可能已关了面板，paintPanel 会自行判断） */
        paintPanel();
      }, function () { /* 错误已在内部消化 */ });
    }
  }

  function closeRadioPanel() {
    RadioUI.panelOpen = false;
    var host = document.getElementById('radio-panel-host');
    if (host) host.innerHTML = '';
    paintDock();
  }

  /* ---------- 拉曲目列表 ----------
     ⚠ 本函数**永不 reject**（内部已消化错误）：调用方（openRadioPanel）
     直接 .then 重绘即可，不需要再挂 catch。

     v4.9.1：**在途去重**。原先并发调用会各发一次请求 —— 实测首屏同一秒出现
     两个一模一样的 public_radio GET（两条路径都拉了列表），而本机到新加坡
     一次往返就要 ~1.2s，纯属白等。只在"在途"期间共享：请求一结束就清空，
     所以上传/删除之后仍然会真刷新。 */
  var radioLoadPromise = null;
  async function loadRadioTracks() {
    if (radioLoadPromise) return radioLoadPromise;
    radioLoadPromise = (async function () {
      try {
        var rows = await need('Radio').list();
        RadioUI.rows = rows || [];
        RadioUI.loaded = true;
        if (window.NEONRadio) window.NEONRadio.setList(radioQueue(), true);
      } catch (e) {
        /* 保持 loaded=false，下次开面板会重试（网络抖动自愈） */
        RadioUI.loaded = false;
        toast(errMsg(e, '曲目列表加载失败'), 'error');
      } finally {
        radioLoadPromise = null;
      }
    })();
    return radioLoadPromise;
  }

  /* 交给播放内核的队列。
     ⚠ 访客视角要摘掉「无音频本体」的旧记录（has_data=false，云存储时代的遗留）——
       它对访客永远播不了，留着只会让电台看起来是坏的；
       而作者必须看得到它们才能删除/重传，所以管理视角完整保留。
     ⚠ 判据依赖登录态 ⇒ 身份一变就必须重取（见 onAuthStateChange），
       否则作者会看不到那条待处理的旧记录。 */
  function radioQueue() {
    if (canManageRadio()) return RadioUI.rows;
    return RadioUI.rows.filter(function (r) { return r.has_data !== false; });
  }

  /* ---------- 事件绑定（代理，绑一次） ---------- */
  function bindRadioDock() {
    return;   /* v5.2.0：旧小条已移除（理由见 paintDock） */
    /* eslint-disable no-unreachable */
    if (!radioDockEl || radioDockEl._radioBound) return;
    radioDockEl._radioBound = true;

    radioDockEl.addEventListener('click', function (ev) {
      var actEl = ev.target.closest('[data-radio-act]');
      if (actEl) {
        var act = actEl.getAttribute('data-radio-act');
        /* dock 里只有 toggle（其余点击一律展开面板） */
        if (act === 'toggle') {
          ev.stopPropagation();
          ev.preventDefault();
          window.NEONRadio.toggle();
          return;
        }
      }
      /* v5.1.0：电台重做后不再有"展开小面板" —— 点小条直接进电台页
         （播放器是常驻的，切页面不会断歌）。 */
      ev.preventDefault();
      location.hash = '#/radio';
    });

    /* 键盘可达：Enter/Space 展开（dock 是 role=button） */
    radioDockEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        if (ev.target.closest('[data-radio-act]')) return;   /* 让按钮自己处理 */
        ev.preventDefault();
        openRadioPanel();
      }
    });
  }

  function bindRadioPanel() {
    var host = document.getElementById('radio-panel-host');
    if (!host || host._radioBound) return;
    host._radioBound = true;

    /* 点击面板外部 → 收起（在 mousedown 上判，避免与面板内点击冲突） */
    document.addEventListener('mousedown', function (ev) {
      if (!RadioUI.panelOpen) return;
      if (ev.target.closest('.radio-panel')) return;
      if (ev.target.closest('#radio-dock')) return;   /* 点 dock 由它自己处理 */
      closeRadioPanel();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && RadioUI.panelOpen) {
        closeRadioPanel();
      }
    });

    /* 统一 click 代理 */
    host.addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-radio-act]');
      if (!el) return;
      var act = el.getAttribute('data-radio-act');
      var id = el.getAttribute('data-id');
      handleRadioAction(act, id, el, ev);
    });

    /* range 输入：seek 与 volume（input 事件才能跟手实时响应） */
    host.addEventListener('input', function (ev) {
      var el = ev.target.closest('[data-radio-act]');
      if (!el) return;
      var act = el.getAttribute('data-radio-act');
      if (act === 'seek') {
        var d = window.NEONRadio.state().duration || 0;
        if (d > 0) window.NEONRadio.seek((Number(el.value) / 1000) * d);
      } else if (act === 'volume') {
        window.NEONRadio.setVolume(Number(el.value) / 100);
      }
    });

    /* 文件选择：选中后把文件名回填到「曲目名称」（用户多半想用文件名） */
    host.addEventListener('change', function (ev) {
      var el = ev.target;
      if (el && el.getAttribute && el.getAttribute('data-radio-field') === 'file') {
        var nameInput = host.querySelector('[data-radio-field="title"]');
        var f = el.files && el.files[0];
        if (nameInput && f && !nameInput.value.trim()) {
          nameInput.value = f.name.replace(/\.[^.]*$/, '').slice(0, 200);
        }
      }
    });
  }

  function handleRadioAction(act, id, el, ev) {
    var R = window.NEONRadio;
    switch (act) {
      case 'toggle': R.toggle(); break;
      case 'prev': R.prev(); break;
      case 'next': R.next(); break;
      case 'playat': {
        var numId = Number(id);
        var st = R.state();
        /* 点当前曲目 = 播放/暂停切换（符合通用播放器习惯） */
        if (st.current && st.current.id === numId) { R.toggle(); }
        else R.playAt(numId);
        break;
      }
      case 'mute': R.toggleMute(); break;
      case 'repeat': {
        var modes = R.REPEAT_MODES;
        var i = modes.indexOf(R.state().repeat);
        R.setRepeat(modes[(i + 1) % modes.length]);
        paintPanel();
        break;
      }
      case 'shuffle': R.setShuffle(!R.state().shuffle); paintPanel(); break;
      case 'close': closeRadioPanel(); break;
      case 'up': moveTrack(numIdOf(id), -1); break;
      case 'down': moveTrack(numIdOf(id), 1); break;
      case 'del': askRemoveTrack(numIdOf(id)); break;
      case 'add': showAddForm(true); break;
      case 'cancel-add': showAddForm(false); break;
      case 'submit-add': submitAddTrack(); break;
      default: break;
    }
    if (ev) ev.preventDefault();
  }

  function numIdOf(id) { return Number(id); }

  /* ---------- 上传表单 ---------- */
  var formDraft = { title: '', artist: '', album: '', url: '' };

  function showAddForm(on) {
    var host = document.getElementById('radio-panel-host');
    if (!host) return;
    var form = host.querySelector('[data-radio-form]');
    if (!form) return;
    form.hidden = !on;
    if (on) {
      var first = form.querySelector('[data-radio-field="title"]');
      if (first) first.focus();
    }
  }

  /* 重渲染后回填草稿（否则用户填一半、恰逢状态刷新就白填了） */
  function restoreFormDraft() {
    var host = document.getElementById('radio-panel-host');
    if (!host) return;
    var form = host.querySelector('[data-radio-form]');
    if (!form || form.hidden) return;
    ['title', 'artist', 'album', 'url'].forEach(function (k) {
      var el = form.querySelector('[data-radio-field="' + k + '"]');
      if (el && !el.value) el.value = formDraft[k] || '';
    });
  }

  function formMsg(text, kind) {
    var host = document.getElementById('radio-panel-host');
    if (!host) return;
    var el = host.querySelector('[data-radio-msg]');
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.className = 'radio-form-msg' + (kind ? ' is-' + kind : '');
  }

  async function submitAddTrack() {
    if (RadioUI.busy) return;
    var host = document.getElementById('radio-panel-host');
    if (!host) return;
    var form = host.querySelector('[data-radio-form]');
    if (!form) return;

    var titleEl = form.querySelector('[data-radio-field="title"]');
    var artistEl = form.querySelector('[data-radio-field="artist"]');
    var albumEl = form.querySelector('[data-radio-field="album"]');
    var fileEl = form.querySelector('[data-radio-field="file"]');
    var urlEl = form.querySelector('[data-radio-field="url"]');

    var title = (titleEl && titleEl.value || '').trim();
    var file = fileEl && fileEl.files && fileEl.files[0];
    var url = (urlEl && urlEl.value || '').trim();

    /* 校验在前，给具体原因（不做"上传失败"这种模糊提示） */
    if (file && url) { formMsg('音频文件与直链只能选一个', 'err'); return; }
    if (!file && !url) { formMsg('请选择音频文件，或填写 https 直链', 'err'); return; }
    if (!title) { formMsg('请填写曲目名称', 'err'); return; }
    if (title.length > 200) { formMsg('曲目名称不能超过 200 字', 'err'); return; }
    /* 直链的结构校验放在前面做（别等提交到库层才因为 CHECK 报错，
       那样用户拿到的是"曲目入库失败"，看不出是链接写错了） */
    if (url) {
      try { need('Radio').normalizeSourceUrl(url); }
      catch (e2) { formMsg(errMsg(e2, '音频直链不合法'), 'err'); return; }
    }

    var uid = State.session && State.session.user && State.session.user.id;
    if (!uid) { formMsg('请先登录', 'err'); return; }

    RadioUI.busy = true;
    formMsg(url ? '正在试听校验这条直链…' : '正在上传并写入云端库…（大文件需要一点时间）');

    try {
      /* v4.9.6：外链**先试听校验再入库**。
         ⚠ 教训实锤：站长第一次贴的是 B 站**网页地址**，它 https 合法、URL 结构也合法，
           于是顺利入库，直到播放时才报一句 "no supported sources" —— 用户根本看不出
           是自己贴错了。校验放在入库前，这类错就进不了库。 */
      /* v5.0.0：只剩一条路 —— 网易云条目。本地文件上传已按站长决定移除。 */
      var kindEl = form.querySelector('[data-radio-field="kind"]');
      var wantKind = (kindEl && kindEl.value) || 'auto';
      var row = await need('Radio').add(url, {
        title: title,
        artist: (artistEl && artistEl.value || '').trim(),
        kind: wantKind === 'auto' ? null : wantKind,
        id: url
      }, uid);

      /* 成功 → 刷新列表，清空表单 */
      formDraft = { title: '', artist: '', album: '', url: '' };
      await loadRadioTracks();
      RadioUI.loaded = true;
      paintPanel();
      showAddForm(false);
      toast('已加入频段：' + (row && row.title ? row.title : title), 'ok');
      formMsg('');
    } catch (e) {
      formMsg(errMsg(e, url ? '外链写入失败' : '上传失败'), 'err');
    } finally {
      RadioUI.busy = false;
    }
  }

  /* ---------- 删除 / 排序 ---------- */
  function askRemoveTrack(id) {
    var row = RadioUI.rows.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    openModal('删除曲目', '<p>将从频段移除「' + V().esc(row.title) + '」及其云端音频数据。此操作不可撤销。</p>', [
      { label: '取消', cls: 'btn-ghost', onClick: closeModal },
      { label: '确认删除', cls: 'btn-magenta', onClick: async function () {
        closeModal();
        try {
          await need('Radio').removeTrack(row);
          await loadRadioTracks();
          paintPanel();
          toast('已移除：' + row.title, 'ok');
        } catch (e) {
          toast(errMsg(e, '删除失败'), 'error');
        }
      } }
    ]);
  }

  /* 上移/下移：交换相邻两项的 sort_order，落库后重拉 */
  async function moveTrack(id, delta) {
    var rows = RadioUI.rows.slice();
    var i = -1;
    for (var k = 0; k < rows.length; k++) { if (rows[k].id === id) { i = k; break; } }
    if (i < 0) return;
    var j = i + delta;
    if (j < 0 || j >= rows.length) return;   /* 已在两端，静默不动 */

    /* 重排 sort_order：按新顺序重新编号（简单可靠，不怕历史值重复） */
    var swapped = rows.slice();
    var t = swapped[i]; swapped[i] = swapped[j]; swapped[j] = t;
    var payload = swapped.map(function (r, idx) { return { id: r.id, sort_order: idx }; });

    try {
      await need('Radio').reorder(payload);
      await loadRadioTracks();
      paintPanel();
    } catch (e) {
      toast(errMsg(e, '排序保存失败'), 'error');
    }
  }

  /* ---------- 初始化 ---------- */
  function initRadio() {
    if (!window.NEONRadio) return false;
    var R = window.NEONRadio;
    try {
      R.init({
        /* 播放地址取自库内音频数据（公开视图 public_radio，**匿名可读**）。
           ⚠ v2.9.0 起不再走云存储签名 URL —— 云存储只服务登录用户，
             未登录访客拿不到地址，与「所有人可听」互斥。
           入参是**整行**：内核不关心地址怎么来，只把它交给数据层。 */
        fetchUrl: function (row) { return need('Radio').playUrl(row); }
      });
    } catch (e) {
      try { console.error('[NEON] 电台初始化失败：', e); } catch (e2) {}
      return false;
    }

    /* 订阅状态 → 只重绘 dock；面板只在"结构性变化"时才整绘 */
    var lastPanelKey = '';
    R.on('statechange', function (st) {
      paintDock();
      /* 面板整绘的触发条件：曲目数/当前曲目/播放态中会改变按钮文案的部分 */
      var key = [st.count, st.current ? st.current.id : '-', st.playing ? 1 : 0,
        st.repeat, st.shuffle ? 1 : 0, st.muted ? 1 : 0,
        Math.round((st.volume || 0) * 100)].join('|');
      if (RadioUI.panelOpen && key !== lastPanelKey) {
        lastPanelKey = key;
        paintPanel();
      }
    });

    /* ⚠⚠ 必须订阅 timeupdate（内核每次播放进度推进都会发，带 time/duration）。
       当前进度条与两个时间标签**只有** paintPanelProgress 在维护，而上面那个
       statechange 只在「播放/暂停/载入/切歌」这类**离散**事件里触发，
       播放过程中根本不发 ⇒ 不订阅的话进度显示在整首歌里是**冻住的**，
       总时长更只在整面板重绘那一下渲染，于是长期停在上一首的值甚至 0:00。
       ⚠ 顺序坑（不是 bug，别误判）：statechange 里是「先 paintDock（刷进度）
         → 再 paintPanel（整绘）」，整绘会把刚刷的进度重置回渲染快照，
         所以切歌瞬间的进度要等**下一次 timeupdate** 才纠正（约 0.25s 内）。 */
    R.on('timeupdate', function (t) { paintPanelProgress(t); });

    R.on('error', function (p) {
      /* 首次错误提示一次即可（连环错误由内核限流，这里不重复骚扰） */
      if (p && p.message) toast(p.message, 'error');
    });

    bindRadioDock();

    /* 首次加载曲目列表：异步，不阻塞启动 */
    loadRadioTracks().then(function () {
      paintDock();
    });

    return true;
  }

  /* ============ C16：标签管理（重命名 / 合并） ============
     与标签总览页的区别：这里是**写操作入口**，只对已登录作者开放。
     未登录时给明确引导（跳登录），而不是渲染一个点了没反应的界面。

     影响范围预告：点「重命名」先弹一个带输入框的对话框，
     并告诉作者"这次会改动 N 篇"。执行后给出精确结果
     （成功几篇、失败几篇），不做"成功了"这种模糊反馈。 */
  async function renderTagAdmin() {
    if (!State.session) {
      app.innerHTML = '<div class="page-head"><h1>TAG CONTROL</h1>' +
        '<div class="crumb">频段管理 · <b>需要作者身份</b></div></div>' +
        '<div class="empty-state"><span class="empty-glyph empty-glyph-lock">' + LOCK_SVG + '</span><span class="empty-code">ACCESS DENIED</span>' +
        '<span class="empty-hint">标签管理是写操作，请先登录</span>' +
        '<div style="margin-top:22px"><a class="btn" href="#/login">接入系统 ▸</a></div></div>';
      window.scrollTo(0, 0);
      return;
    }
    var state = { loading: true, stats: {}, error: null };
    app.innerHTML = V().tagAdminView(state);
    window.scrollTo(0, 0);

    var res = await parallelSafe([function () { return need('Posts').tagStats(); }]);
    deapplyTags(state, res[0]);
    state.loading = false;
    app.innerHTML = V().tagAdminView(state);
    bindTagAdmin();
    scheduleScrollUI();
  }

  function bindTagAdmin() {
    var list = document.querySelector('.tagadmin-list');
    if (!list) return;
    list.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-rename]') : null;
      if (!btn) return;
      var from = btn.getAttribute('data-rename');
      var count = btn.getAttribute('data-count');
      promptRename(from, count);
    });
  }

  function promptRename(from, count) {
    var body = '' +
      '<p>把频段 <b>#' + V().esc(from) + '</b> 重命名为：</p>' +
      '<div class="field" style="margin:10px 0">' +
        '<input type="text" id="tg-new" maxlength="40" placeholder="新的频段名" value="' + V().esc(from) + '">' +
      '</div>' +
      '<p style="color:var(--text-dim);font-size:13px">' +
        '将有 <b>' + count + '</b> 篇文章受影响（含草稿）。' +
        '若新名字已存在，两个频段会被<b>合并</b>。</p>';
    openModal('重命名频段', body, [
      { label: '取消', cls: 'btn-ghost', onClick: closeModal },
      { label: '执行', cls: 'btn-magenta', onClick: function () { doRename(from); } }
    ]);
  }

  async function doRename(from) {
    var input = document.getElementById('tg-new');
    var to = input ? input.value.trim() : '';
    if (!to) { toast('新频段名不能为空', 'warn'); return; }
    if (to === from) { toast('新旧名称相同，无需改动', 'warn'); closeModal(); return; }
    closeModal();
    toast('正在更新频段…');
    try {
      var uid = State.session && State.session.user && State.session.user.id;
      var r = await need('Posts').renameTag(uid, from, to);
      if (r.changed === 0) {
        toast('没有文章包含该频段', 'warn');
      } else if (r.failed && r.failed.length) {
        /* 部分失败必须如实报告 —— 不能说"成功"，否则作者以为改完了 */
        toast('已更新 ' + r.changed + ' 篇，' + r.failed.length + ' 篇失败', 'warn');
      } else {
        toast('频段 #' + from + ' → #' + to + '（' + r.changed + ' 篇）', 'ok');
      }
    } catch (e) {
      toast(errMsg(e, '重命名失败'), 'error');
    }
    /* 重新拉统计，让列表反映最新状态 */
    renderTagAdmin();
  }

  /* ============ 标签总览 ============ */
  /* B2：本页只有 tagStats 一个请求，本身没有串行代价。
     这里改用 parallelSafe 的意义在于**统一错误语义**：
     它与首页、搜索页走同一条"每个任务各自成败"的通道，
     后续 C14（标签页加"该标签最新信号"）时直接往数组里加一项即可并行，
     不必再改错误处理结构 —— 这正是方案要求"为后续留好接口"的落点。
     语义上与原来一致：统计失败只让统计区降级，页面骨架照常渲染。 */
  async function renderTags() {
    var state = { loading: true, stats: {}, error: null };
    app.innerHTML = V().tagsView(state);
    window.scrollTo(0, 0);

    var res = await parallelSafe([function () { return need('Posts').tagStats(); }]);
    deapplyTags(state, res[0]);

    state.loading = false;
    app.innerHTML = V().tagsView(state);
    scheduleScrollUI(); /* C9：标签数量变化会改变页面高度 */
  }

  /* 把 parallelSafe 的单个结果应用到标签页状态。
     抽成函数是为了让"降级怎么写"只有一处，后续加任务时复用。 */
  function deapplyTags(state, r) {
    if (r && r.ok) {
      state.stats = r.value || {};
      state.error = null;
    } else {
      /* 统计失败是"这个区块的数据没拿到"，不是"页面坏了" */
      state.stats = {};
      state.error = errMsg(r && r.reason, '频段扫描失败');
    }
  }

  /* ============ C9：阅读进度条 + 回到顶部 ============ */
  /* 两者共用一个 scroll 监听（不是各挂一个）——
     滚动是高频事件，监听器数量要压到最少，且它们的计算都依赖
     同一份"当前滚动位置"，合并处理天然更省。

     ★ 关键设计（方案要求，不可简化）：
       ① 用 transform: scaleX() 而非 width —— width 触发重排，滚动必掉帧。
       ② 用 requestAnimationFrame 节流 —— scroll 每帧可触发多次，
          不节流会在一次滚动里连算几十次布局属性（getBoundingClientRect
          是强制同步布局的元凶）。rAF 保证每帧最多一次。
       ③ 不依赖 IntersectionObserver —— 用 scrollTop 阈值判断。
          理由：IO 在无布局引擎的环境（jsdom）里不存在，走降级分支会
          让"测试环境"和"真实浏览器"跑在不同的代码路径上，
          最容易出现"测试全绿、线上白屏"。用 scrollTop 则两条路一致。
       ④ 幂等安装 + 显式释放 —— 这里存下监听器引用，initScrollUI() 重复调用
          不会叠加（用 __scrollListeners 断言守住）。 */

  var scrollUI = { onScroll: null, rafId: 0, installed: false };

  /* 取当前滚动位置。用 (window.pageYOffset || documentElement.scrollTop || body.scrollTop)
     三路兜底：老浏览器/怪异模式下 property 支持不一，单个取法会拿到 undefined。 */
  function currentScrollTop() {
    var doc = document.documentElement || {};
    var body = document.body || {};
    return window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
  }

  /* 可滚动总高度（不含视口）。<=0 表示内容不足一屏 —— 此时两种 UI 都该隐藏。 */
  function scrollableHeight() {
    var doc = document.documentElement || {};
    var body = document.body || {};
    var full = Math.max(
      (doc.scrollHeight || 0),
      (body.scrollHeight || 0),
      (doc.offsetHeight || 0)
    );
    var view = window.innerHeight || doc.clientHeight || 0;
    return full - view;
  }

  function setProgressVisible(visible) {
    var wrap = document.getElementById('read-progress');
    if (!wrap) return;
    /* data-idle="1" = 隐藏。用属性而非直接改 style：
       视觉全部交给 CSS（含 C13 的减少动效下的过渡归零），JS 只管状态。 */
    wrap.setAttribute('data-idle', visible ? '0' : '1');
  }

  function setToTopVisible(visible) {
    var btn = document.getElementById('to-top');
    if (!btn) return;
    btn.setAttribute('data-visible', visible ? '1' : '0');
    /* 不加 tabindex="-1" 的切换：按钮始终在 tab 序内，
       但 visibility:hidden 时浏览器本就不会聚焦到它 —— 无需额外处理。 */
  }

  /* 单次刷新（由 rAF 调度） */
  function updateScrollUI() {
    scrollUI.rafId = 0;
    var top = currentScrollTop();
    var span = scrollableHeight();

    var bar = document.getElementById('read-progress-bar');
    if (bar) {
      if (span <= 0) {
        /* 内容不足一屏：没有"阅读进度"可言，隐藏而非显示 0% 的死线 */
        setProgressVisible(false);
      } else {
        var ratio = top / span;
        if (ratio < 0) ratio = 0;
        if (ratio > 1) ratio = 1;
        /* 显示条件：确实开始滚动、且尚未到底。
           两端都不显示 —— 顶边一条静止的线没有信息量，反而像渲染残留。 */
        setProgressVisible(ratio > 0 && ratio < 1);
        bar.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
      }
    }

    /* 回顶按钮：滚过一屏（视口高度）才出现 —— 短页面永不出现 */
    var view = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    setToTopVisible(view > 0 && top > view);
  }

  /* rAF 节流：同一帧内的多次 scroll 只算一次 */
  function scheduleScrollUI() {
    if (scrollUI.rafId) return; /* 本帧已排期 */
    if (typeof window.requestAnimationFrame === 'function') {
      scrollUI.rafId = window.requestAnimationFrame(function () {
        try { updateScrollUI(); } catch (e) {
          scrollUI.rafId = 0;
          try { console.error('[NEON] 滚动指示更新失败：', e); } catch (e2) {}
        }
      });
    } else {
      /* 无 rAF 的极老环境：退化为定时器，语义一致（去重 + 每帧一次） */
      scrollUI.rafId = setTimeout(function () {
        scrollUI.rafId = 0;
        try { updateScrollUI(); } catch (e) { /* 静默 */ }
      }, 16);
    }
  }

  function releaseScrollUI() {
    if (scrollUI.onScroll) {
      window.removeEventListener('scroll', scrollUI.onScroll);
      scrollUI.onScroll = null;
    }
    if (scrollUI.rafId) {
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(scrollUI.rafId);
      scrollUI.rafId = 0;
    }
    scrollUI.installed = false;
  }

  function initScrollUI() {
    /* 幂等：重复调用先释放旧的，保证监听器数恒为 1 */
    releaseScrollUI();
    scrollUI.onScroll = scheduleScrollUI;
    window.addEventListener('scroll', scrollUI.onScroll, { passive: true });
    scrollUI.installed = true;

    /* 回顶按钮：一次性绑定（按钮在 index.html 里是静态节点，不会被路由重渲染）。
       用标记位防重复绑定，避免 initScrollUI 多次调用时叠加 click 监听。 */
    var btn = document.getElementById('to-top');
    if (btn && !btn.__neonBound) {
      btn.__neonBound = true;
      btn.addEventListener('click', function () {
        /* 平滑滚动由 CSS 的 scroll-behavior 决定；
         C13 在减少动效偏好下把它改成 auto —— 用户偏好优先，无需在此判断。 */
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
          /* 老浏览器不支持 options 对象：退化为瞬时跳转 */
          try { window.scrollTo(0, 0); } catch (e2) { /* 忽略 */ }
        }
        /* 回顶后把焦点交给跳过链接 —— 键盘用户不会"滚上去了但焦点还在页尾"。
           用 skip-link 而非 body：它本就是页面第一个可聚焦元素，语义契合。 */
        try {
          var skip = document.querySelector('.skip-link');
          if (skip && skip.focus) skip.focus({ preventScroll: true });
        } catch (e) { /* 忽略 */ }
      });
    }

    /* 首帧同步算一次：直接进详情页（带 hash）时不会触发 scroll，
       不主动算一次的话进度条会停在初始态。 */
    updateScrollUI();
  }

  /* ============ 文章详情 ============ */
  /* B2：本页目前只有 get(id) 一个请求，没有真正的并行收益。
     接入 parallelSafe 是为了统一错误通道 + 为 C14 铺路
     （C14 要在详情页加"相关信号"，那时直接往数组里加一项即可并行）。
     语义与原来完全一致：失败时 post=null → 渲染 404 视图 + 弹错误提示。 */
  async function renderPost(id) {
    if (!id || isNaN(id)) { location.hash = '#/'; return; }
    var state = { loading: true, post: null, renderedMd: '', related: [], prev: null, next: null, marked: false };
    app.innerHTML = V().postView(state);
    window.scrollTo(0, 0);

    /* C14+：三件套的数据全在这里一次并行取回 ——
       ① get(id)      本文
       ② listPublished 邻居候选（上一篇/下一篇 + 相关信号的候选集）

       为什么邻居也用 listPublished 而不是专门的接口：
       时间相邻与标签重合都是**纯前端可算**的，多一个接口就多一个失败点。
       代价是只覆盖最近 SEARCH_FETCH_SIZE 篇 —— 对单作者博客足够，
       且 partialNote 的既有约定已经在说"只覆盖最近 N 条"。 */
    var res = await parallelSafe([
      function () { return need('Posts').get(id); },
      function () { return need('Posts').listPublished({ page: 1, pageSize: SEARCH_FETCH_SIZE }); }
    ]);
    var getS = res[0];
    var listS = res[1];
    var post = null;
    if (getS.ok) {
      post = getS.value;
      state.post = post;
    } else {
      state.post = null;
      toast(errMsg(getS.reason, '文章加载失败'), 'error');
    }

    state.loading = false;
    if (post) {
      var tmp = document.createElement('div');
      renderMarkdownInto(tmp, post.content);
      state.renderedMd = tmp.innerHTML;
      /* 邻居候选：列表取失败只影响三件套，不影响正文 —— 降级为空 */
      var pool = (listS.ok && listS.value && listS.value.posts) ? listS.value.posts : [];
      buildTrail(state, post, pool);
      state.marked = isMarked(post.id);
      state.markLocked = !isLoggedIn();   /* v4.9.0：未登录 → 收藏按钮显示锁定态 */
    }
    app.innerHTML = V().postView(state);
    if (post) hydrateImages(app); /* 详情页：完整图（正文 + 封面） */
    else renderMarkdownInto(document.getElementById('md-target') || document.createElement('div'), '');
    if (post) { buildToc(); bindCodeCopy(); bindLineNumbers(); } /* C2：DOM 落地后再挂，否则会被 innerHTML 清掉 */
    window.scrollTo(0, 0);
    scheduleScrollUI(); /* C9：详情页换文后重算（长文进度条依赖真实高度） */
  }

  /* C14+：算「读完之后」的三块数据。
     pool 是最近一批已发布文章（含本文），已按 created_at 倒序。

     prev / next 的方向约定（读者视角，不是数组下标视角）：
       · next = **更新**的一篇（列表里排在本文前面）
       · prev = **更早**的一篇（列表里排在本文后面）
     这个约定与「◂ 更早」「更新 ▸」的文案一致，别按下标直觉反过来。

     related 的排序：共同标签数降序 → 同分时按时间新的在前。
     排除自身；共同标签数为 0 的不进列表（否则"相关"名不副实）。 */
  function buildTrail(state, post, pool) {
    var myTags = (post.tags || []).filter(function (t) { return String(t || '').trim() !== ''; });
    var myIdx = -1;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i] && pool[i].id === post.id) { myIdx = i; break; }
    }
    /* 邻居：仅当本文出现在候选池里时才能定位（草稿不在公开列表里，此处自然为 null） */
    if (myIdx !== -1) {
      state.next = myIdx > 0 ? pool[myIdx - 1] : null;
      state.prev = myIdx < pool.length - 1 ? pool[myIdx + 1] : null;
    }
    /* 相关：按标签重合度 */
    if (myTags.length) {
      var scored = [];
      pool.forEach(function (p) {
        if (!p || p.id === post.id) return;
        var shared = (p.tags || []).filter(function (t) { return myTags.indexOf(t) !== -1; }).length;
        if (shared > 0) scored.push({ p: p, s: shared });
      });
      scored.sort(function (a, b) {
        if (b.s !== a.s) return b.s - a.s;
        /* 同分按时间新的在前（与列表页一致的时序直觉） */
        return String(b.p.created_at || '').localeCompare(String(a.p.created_at || ''));
      });
      state.related = scored.slice(0, 3).map(function (it) {
        /* 不污染原对象：复制一份再挂 _shared（原对象是列表池的引用） */
        var copy = {};
        for (var k in it.p) { if (Object.prototype.hasOwnProperty.call(it.p, k)) copy[k] = it.p[k]; }
        copy._shared = it.s;
        return copy;
      });
    }
  }

  /* ============ C2：文章目录（TOC） ============ */
  /* 从 #md-target 里抽 h2/h3，补 id 锚点，生成侧边目录并做滚动高亮。
     全程不写内联 on* 属性（CSP script-src 无 'unsafe-inline'），统一 addEventListener。

     生命周期：滚动高亮有两种实现（IntersectionObserver / scroll 降级），
     无论哪种都会持有本页标题元素的引用。切页时这些元素会随 innerHTML 一起销毁，
     若不显式释放，就会每进一次详情页泄漏一份。故统一由 releaseToc() 收口，
     在 buildToc() 开头与 route() 入口各调一次。 */
  var tocBinding = null;

  function releaseToc() {
    if (!tocBinding) return;
    if (tocBinding.observer) { tocBinding.observer.disconnect(); }
    if (tocBinding.onScroll) { window.removeEventListener('scroll', tocBinding.onScroll); }
    tocBinding = null;
  }

  function slugify(text, index) {
    var s = String(text || '').toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return 'toc-' + (s || 'sec') + '-' + index;
  }

  function buildToc() {
    releaseToc();
    var nav = document.getElementById('post-toc');
    var body = document.getElementById('md-target');
    if (!nav || !body) return;
    var heads = body.querySelectorAll('h2, h3');
    if (heads.length < 2) { nav.hidden = true; nav.innerHTML = ''; return; }

    var items = [];
    Array.prototype.forEach.call(heads, function (h, i) {
      if (!h.id) h.id = slugify(h.textContent, i);
      items.push({ id: h.id, text: h.textContent.trim(), level: h.tagName === 'H3' ? 3 : 2, el: h });
    });

    /* v4.2 B3：迷你地图 —— 各章节的"长度条"按它到下一章节的距离占全文比例计算。
       用 getBoundingClientRect 差值（而非 offsetTop）：不受 offsetParent 链影响。 */
    var bodyTopAbs = body.getBoundingClientRect().top + window.pageYOffset;
    var totalH = Math.max(1, body.offsetHeight);
    var tops = items.map(function (it) {
      return Math.max(0, it.el.getBoundingClientRect().top + window.pageYOffset - bodyTopAbs);
    });
    items.forEach(function (it, i) {
      var end = (i + 1 < items.length) ? tops[i + 1] : totalH;
      it.seg = Math.max(6, Math.min(100, Math.round(((end - tops[i]) / totalH) * 100)));
    });

    nav.innerHTML = '<div class="toc-head">▤ INDEX // 目录</div>' +
      /* 迷你地图游标：随当前章节移动到对应条目旁（CSS 负责视觉，JS 只写 top） */
      '<span class="toc-cursor" aria-hidden="true"></span>' +
      '<ul class="toc-list">' + items.map(function (it) {
        return '<li class="toc-item toc-lv' + it.level + '">' +
          '<a class="toc-link" href="#' + it.id + '" data-toc="' + it.id + '">' + V().esc(it.text) + '</a>' +
          '<span class="toc-bar" style="--seg:' + it.seg + '%" aria-hidden="true"></span>' +
        '</li>';
      }).join('') + '</ul>';
    nav.hidden = false;
    /* v4.2 B3：迷你地图游标（元素已在 innerHTML 里，此处取引用） */
    var cursor = nav.querySelector('.toc-cursor');

    /* 点击：锚点定位 + 高亮。nav 每次渲染都是全新元素，绑一次不会累积。 */
    nav.addEventListener('click', function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[data-toc]') : null;
      if (!a) return;
      ev.preventDefault();
      var target = document.getElementById(a.getAttribute('data-toc'));
      if (!target) return;
      var top = target.getBoundingClientRect().top + window.pageYOffset - 78;
      window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' });
      setTocActive(a.getAttribute('data-toc'));
    });

    /* 滚动高亮：IntersectionObserver 不可用时降级为滚动位置计算 */
    var links = {};
    items.forEach(function (it) { links[it.id] = nav.querySelector('a[data-toc="' + it.id + '"]'); });
    tocBinding = { observer: null, onScroll: null };

    if (typeof IntersectionObserver === 'function') {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) setTocActive(en.target.id);
        });
      }, { rootMargin: '-78px 0px -70% 0px', threshold: 0 });
      items.forEach(function (it) { observer.observe(it.el); });
      if (tocBinding) tocBinding.observer = observer;
      /* v4.2.1：初始把游标/高亮放到第一章 —— observer 只对"交叉变化"发事件，
         页面直达时若无元素进出视野，setTocActive 一次都不会被调用，
         游标会留在 CSS 默认位（top:0 与第一章位置有偏差）。
         降级路径的 onScroll 本就有初调，这里补齐增强路径的对称性。 */
      setTocActive(items[0].id);
    } else {
      var onScroll = function () {
        var cur = items[0] && items[0].id;
        for (var k = 0; k < items.length; k++) {
          if (items[k].el.getBoundingClientRect().top <= 90) cur = items[k].id;
        }
        setTocActive(cur);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      if (tocBinding) tocBinding.onScroll = onScroll;
      onScroll();
    }

    function setTocActive(id) {
      Object.keys(links).forEach(function (key) {
        var a = links[key];
        if (a) a.classList.toggle('active', key === id);
      });
      /* v4.2 B3：迷你地图游标随当前章节移动（相对 nav —— nav 在 CSS 里有 position: relative） */
      if (cursor && links[id] && links[id].parentNode) {
        cursor.style.top = (links[id].parentNode.offsetTop + 4) + 'px';
      }
    }
  }

  /* ============ v4.2 B3：终端阅读框的行号开关 ============
     状态存 localStorage（'0' = 关闭；其余/缺省 = 开启）。
     视觉全部交给 CSS（body.linenum-off 下的 .md-body 规则），JS 只切类与记忆。 */
  function bindLineNumbers() {
    var btn = document.getElementById('ln-toggle');
    if (!btn) return;
    var off = false;
    try { off = localStorage.getItem('neon_linenum') === '0'; } catch (e) { /* 隐私模式 */ }
    document.body.classList.toggle('linenum-off', off);
    btn.setAttribute('aria-pressed', off ? 'false' : 'true');
    btn.addEventListener('click', function () {
      off = !off;
      document.body.classList.toggle('linenum-off', off);
      btn.setAttribute('aria-pressed', off ? 'false' : 'true');
      try { localStorage.setItem('neon_linenum', off ? '0' : '1'); } catch (e) { /* 忽略 */ }
    });
  }

  /* ============ C2：代码块复制按钮 ============ */
  function copyText(text, onOk, onErr) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk, function () { fallbackCopy(text, onOk, onErr); });
      return;
    }
    fallbackCopy(text, onOk, onErr);
  }

  function fallbackCopy(text, onOk, onErr) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) onOk(); else onErr();
    } catch (e) { onErr(); }
  }

  function bindCodeCopy() {
    var body = document.getElementById('md-target');
    if (!body) return;
    var pres = body.querySelectorAll('pre');
    Array.prototype.forEach.call(pres, function (pre) {
      if (pre.querySelector('.code-copy')) return; /* 幂等，避免重复挂 */
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = '复制';
      btn.setAttribute('aria-label', '复制代码');
      btn.addEventListener('click', function () {
        var codeEl = pre.querySelector('code');
        var text = (codeEl ? codeEl.textContent : pre.textContent) || '';
        copyText(text, function () {
          btn.textContent = '已复制 ✓';
          btn.classList.add('copied');
          setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('copied'); }, 1600);
        }, function () {
          btn.textContent = '失败';
          setTimeout(function () { btn.textContent = '复制'; }, 1600);
          toast('复制失败，请手动选中复制', 'error');
        });
      });
      pre.appendChild(btn);
      pre.classList.add('has-copy');
    });
  }

  /* ============ C1：文章搜索（纯前端过滤） ============ */
  /* 候选集来自 listPublished 的首屏页（与首页同源），不做库层全文检索——
     设计表约定「文章过 50 篇再考虑库层检索」。 */
  var SEARCH_FETCH_SIZE = 200;

  async function renderSearch(q) {
    var state = { loading: true, q: q || '', hits: [], source: [], total: 0, error: null };
    app.innerHTML = V().searchView(state);
    window.scrollTo(0, 0);
    try {
      var r = await need('Posts').listPublished({ page: 1, pageSize: SEARCH_FETCH_SIZE });
      state.source = r.posts || [];
      state.total = r.total;
      state.scanned = state.source.length; /* 实际纳入检索的量，用于提示截断 */
      state.error = null;
    } catch (e) {
      state.error = errMsg(e, '数据流连接失败，请稍后重试');
    }
    state.loading = false;
    state.hits = filterPosts(state.source, state.q);
    applyMarks(state.hits); /* C19：搜索结果也带收藏态 */
    app.innerHTML = V().searchView(state);
    hydrateImages(app, { thumb: true });
    bindSearchBar();
    scheduleScrollUI(); /* C9：结果条数变化会改变页面高度 */
  }

  function matchPost(p, needle) {
    if (!needle) return true;
    var hay = [p.title || '', p.summary || '', (p.tags || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(needle) !== -1;
  }

  function filterPosts(posts, q) {
    var needle = String(q || '').trim().toLowerCase();
    if (!needle) return [];
    return (posts || []).filter(function (p) { return matchPost(p, needle); });
  }

  function bindSearchBar() {
    var input = document.getElementById('search-input');
    var go = document.getElementById('search-go');
    var clear = document.getElementById('search-clear');
    if (go) go.addEventListener('click', submitSearch);
    if (clear) clear.addEventListener('click', function () { location.hash = '#/search'; });
    if (input) {
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submitSearch(); });
      /* 只更新 URL（hash 变化会触发路由重渲染），不在本地重建 DOM —— 单一渲染入口 */
    }
  }

  function submitSearch() {
    var input = document.getElementById('search-input');
    var q = input ? input.value.trim() : '';
    if (!q) { location.hash = '#/search'; return; }
    location.hash = '#/search/' + encodeURIComponent(q);
  }

  /* ============ C3：归档页（按月分组） ============ */
  async function renderArchive() {
    var state = { loading: true, groups: [], total: 0, error: null };
    app.innerHTML = V().archiveView(state);
    window.scrollTo(0, 0);
    try {
      var r = await need('Posts').listPublished({ page: 1, pageSize: SEARCH_FETCH_SIZE });
      state.total = r.total;
      state.scanned = (r.posts || []).length;
      state.groups = groupByMonth(r.posts || []);
      state.error = null;
    } catch (e) {
      state.error = errMsg(e, '数据流连接失败，请稍后重试');
    }
    state.loading = false;
    app.innerHTML = V().archiveView(state);
    bindWidgetCollapse(); /* v3.7.0：小工具折叠 —— 恢复持久化状态 + 绑定交互 */
    scheduleScrollUI(); /* C9：归档页是最长的页面，进度条在此价值最高 */
  }

  /* ============ v3.7.0：小工具折叠（通用 .widget 壳能力） ============
     3.0 方案 §9.8 的遗留项。折叠状态按 data-widget 名持久化到 localStorage
     （形如 {"heat":true}）；恢复发生在渲染后同一同步块内 —— 浏览器只在 JS
     执行间隙外绘制，故不会出现"先展开后折叠"的闪烁。
     ⚠ 以后任何页面新增 .widget，渲染后都要调一次 bindWidgetCollapse()。 */
  var WIDGET_COLLAPSE_KEY = 'neon_widget_collapsed';

  function readWidgetCollapse() {
    try {
      var obj = JSON.parse(localStorage.getItem(WIDGET_COLLAPSE_KEY) || '{}');
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; /* 存储被禁 / 数据损坏：一律按"全部展开" */ }
  }

  function setWidgetCollapsed(widget, btn, collapsed) {
    widget.setAttribute('data-collapsed', collapsed ? '1' : '0');
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function persistWidgetCollapsed(name, collapsed) {
    if (!name) return;
    try {
      var obj = readWidgetCollapse();
      if (collapsed) obj[name] = true; else delete obj[name];
      localStorage.setItem(WIDGET_COLLAPSE_KEY, JSON.stringify(obj));
    } catch (e) { /* 隐私模式：本次会话内仍可折叠，仅不持久 */ }
  }

  function bindWidgetCollapse() {
    var saved = readWidgetCollapse();
    app.querySelectorAll('.widget[data-widget]').forEach(function (w) {
      var name = w.getAttribute('data-widget') || '';
      var btn = w.querySelector('[data-widget-toggle]');
      if (!btn) return;
      if (saved[name]) setWidgetCollapsed(w, btn, true); /* 恢复持久化状态 */
      btn.addEventListener('click', function () {
        var collapsed = w.getAttribute('data-collapsed') !== '1';
        setWidgetCollapsed(w, btn, collapsed);
        persistWidgetCollapsed(name, collapsed);
      });
    });
  }

  function groupByMonth(posts) {
    var map = {};
    var order = [];
    (posts || []).forEach(function (p) {
      var d = new Date(p.created_at);
      if (isNaN(d.getTime())) return;
      var key = d.getFullYear() + '-' + ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1);
      if (!map[key]) {
        map[key] = { key: key, label: d.getFullYear() + ' 年 ' + ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1) + ' 月', posts: [] };
        order.push(key);
      }
      map[key].posts.push(p);
    });
    order.sort(function (a, b) { return a < b ? 1 : (a > b ? -1 : 0); }); /* 月份倒序 */
    return order.map(function (k) { return map[k]; });
  }

  /* ============ 登录页 ============ */
  function renderLogin() {
    if (State.session) { location.hash = '#/admin'; return; }
    app.innerHTML = V().loginView({ tab: State.loginTab });
    window.scrollTo(0, 0);
    if (isLocalPreview()) {
      var banner = document.createElement('div');
      banner.className = 'notice-banner';
      banner.innerHTML = '◈ 本地预览模式：登录与云数据需要在 <b>正式发布域名</b> 下使用，本地仅供界面预览';
      app.prepend(banner);
    }
    bindLoginEvents();
  }

  function bindLoginEvents() {
    app.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        State.loginTab = b.getAttribute('data-tab');
        renderLogin();
      });
    });
    var sendBtn = document.getElementById('li-send');
    if (sendBtn) sendBtn.addEventListener('click', onSendOtp);
    var submit = document.getElementById('li-submit');
    if (submit) submit.addEventListener('click', onLoginSubmit);
  }

  function getEmail() {
    var el = document.getElementById('li-email');
    return el ? el.value.trim() : '';
  }

  async function onSendOtp() {
    var email = getEmail();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('请输入有效的邮箱地址', 'warn'); return; }
    var btn = document.getElementById('li-send');
    btn.disabled = true;
    btn.textContent = '发送中…';
    try {
      var r = await need('Auth').sendOtp(email);
      if (r.error) {
        btn.disabled = false; btn.textContent = '获取验证码';
        toast(r.error, 'error');
        return;
      }
      State.pendingOtp = { email: email, verificationId: r.verificationId, isExistingUser: r.isExistingUser };
      toast('验证码已发送，请查收邮箱', 'ok');
      startCountdown(btn, State.loginTab === 'reset' ? '发送重置邮件' : '获取验证码');
    } catch (e) {
      btn.disabled = false; btn.textContent = '获取验证码';
      toast(errMsg(e, '发送失败，请检查网络'), 'error');
    }
  }

  function startCountdown(btn, normalText) {
    var left = 60;
    btn.disabled = true;
    var timer = setInterval(function () {
      btn.textContent = '重发 (' + left + 's)';
      if (left-- <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = normalText;
      }
    }, 1000);
  }

  async function onLoginSubmit() {
    var t = State.loginTab;
    var email = getEmail();
    var btn = document.getElementById('li-submit');
    var passwordEl = document.getElementById('li-password');
    var codeEl = document.getElementById('li-code');
    var nickEl = document.getElementById('li-nickname');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('请输入有效的邮箱地址', 'warn'); return; }

    /* --- 密码登录 --- */
    if (t === 'password') {
      var pwd = passwordEl ? passwordEl.value : '';
      if (!pwd) { toast('请输入密码', 'warn'); return; }
      btn.disabled = true;
      var r = await need('Auth').signInWithPassword(email, pwd);
      btn.disabled = false;
      if (r.error) { toast(r.error, 'error'); return; }
      /* 密码登录不会写 State.nickname，这里主动同步，保证欢迎语能取到名字 */
      syncNicknameFromSession(r.session);
      welcomeBack(email);
      return;
    }

    /* --- 验证码登录 / 注册 --- */
    if (t === 'otp' || t === 'signup') {
      var pending = State.pendingOtp;
      if (!pending || pending.email !== email) {
        toast('请先为当前邮箱获取验证码', 'warn');
        return;
      }
      var code = codeEl ? codeEl.value.trim() : '';
      if (!code) { toast('请输入验证码', 'warn'); return; }

      if (t === 'signup') {
        var nickname = nickEl ? nickEl.value.trim() : '';
        if (!nickname) { toast('请填写昵称（你的作者代号）', 'warn'); return; }
        var newPwd = passwordEl ? passwordEl.value : '';
        if (!newPwd || newPwd.length < 6) { toast('密码至少 6 位', 'warn'); return; }
        if (pending.isExistingUser) {
          toast('该邮箱已拥有身份，请直接登录', 'warn');
          State.loginTab = 'otp';
          renderLogin();
          return;
        }
        btn.disabled = true;
        var r2 = await need('Auth').verifyOtp({
          email: pending.email,
          verificationId: pending.verificationId,
          isExistingUser: pending.isExistingUser,
          token: code,
          password: newPwd
        });
        btn.disabled = false;
        if (r2.error) { toast(r2.error, 'error'); return; }
        State.nickname = nickname;
        localStorage.setItem('neon_nickname', nickname);
        toast('身份创建成功，欢迎 ' + State.nickname + ' 加入', 'ok');
        return;
      }

      /* 验证码登录 */
      if (!pending.isExistingUser) {
        toast('该邮箱需要先完成注册（设置密码）', 'warn');
        return;
      }
      btn.disabled = true;
      var r3 = await need('Auth').verifyOtp({
        email: pending.email,
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: code
      });
      btn.disabled = false;
      if (r3.error) { toast(r3.error, 'error'); return; }
      syncNicknameFromSession(r3.session);
      welcomeBack(pending.email);
      return;
    }

    /* --- 忘记密码 --- */
    if (t === 'reset') {
      var r4 = await need('Auth').resetPasswordForEmail(email);
      if (r4.error) { toast(r4.error, 'error'); return; }
      var code2 = codeEl ? codeEl.value.trim() : '';
      var newPwd2 = passwordEl ? passwordEl.value : '';
      if (!code2) { toast('请输入邮件中的验证码', 'warn'); return; }
      if (!newPwd2 || newPwd2.length < 6) { toast('新密码至少 6 位', 'warn'); return; }
      btn.disabled = true;
      try {
        var completed = await r4.updateUser({ nonce: code2, password: newPwd2 });
        btn.disabled = false;
        if (completed.error) { toast(completed.error, 'error'); return; }
        toast('密钥已重写，即将进入控制台', 'ok');
      } catch (e) {
        btn.disabled = false;
        toast(errMsg(e, '重置失败'), 'error');
      }
    }
  }

  /* ============ 控制台 ============ */
  async function renderAdmin() {
    if (!State.session) {
      toast('请先接入系统', 'warn');
      location.hash = '#/login';
      return;
    }
    var state = { loading: true, posts: [] };
    app.innerHTML = V().adminView(state);
    window.scrollTo(0, 0);
    try {
      state.posts = await need('Posts').listMine(State.session.user.id);
    } catch (e) {
      state.error = errMsg(e, '档案读取失败');
    }
    state.loading = false;
    app.innerHTML = V().adminView(state);
    bindEditDelegation();
  }

  /* ============ 编辑器 ============ */
  async function renderEdit(postId) {
    if (!State.session) {
      toast('请先接入系统', 'warn');
      location.hash = '#/login';
      return;
    }
    var state = { postId: postId, post: null };
    if (postId) {
      try {
        var post = await need('Posts').get(postId);
        if (!post) { toast('文章不存在', 'error'); location.hash = '#/admin'; return; }
        if (post.owner_id !== State.session.user.id) { toast('这条信号不属于你', 'error'); location.hash = '#/admin'; return; }
        state.post = post;
      } catch (e) {
        toast(errMsg(e, '文章加载失败'), 'error');
        location.hash = '#/admin';
        return;
      }
    }
    app.innerHTML = V().editView(state);
    window.scrollTo(0, 0);
    bindEditor(state);
    /* C7：进入编辑器后检测未恢复的本地草稿（不阻塞编辑，弹窗询问） */
    try { offerDraftRestore(state); } catch (e) { console.warn('[NEON] 草稿检测失败：', e); }
  }

  /* ============ C7 草稿自动保存（localStorage 快照）============
     设计要点（对齐改进设计表 C7）：
       · 输入防抖 3s 写 localStorage，不落库（避免垃圾草稿行）
       · 单 key 上限约 5MB，超限截断正文并提示
       · 进编辑页检测未恢复草稿 → 询问是否恢复
       · 正式保存/发布成功后清除快照
     快照按「文章 ID」或「新建」分槽，互不覆盖。 */
  var DRAFT_PREFIX = 'neon_draft_';
  var DRAFT_LIMIT = 4 * 1024 * 1024;   /* 4MB 安全线，低于 5MB 浏览器上限 */

  function draftKey(postId) {
    return DRAFT_PREFIX + (postId ? 'p' + postId : 'new');
  }

  /* 读取快照（带损坏容错） */
  function readDraft(postId) {
    try {
      var raw = localStorage.getItem(draftKey(postId));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch (e) { return null; }
  }

  function clearDraft(postId) {
    try { localStorage.removeItem(draftKey(postId)); } catch (e) { /* 忽略 */ }
  }

  /* 写入快照：超限时截断正文（保留标题/摘要/标签），返回 {saved, truncated} */
  function writeDraft(postId, data) {
    var payload = {
      v: 1,
      postId: postId || null,
      title: data.title || '',
      summary: data.summary || '',
      tags: data.tags || '',
      cover: data.cover || '',
      content: data.content || '',
      truncated: false,
      at: new Date().toISOString()
    };
    var serialized = JSON.stringify(payload);
    if (serialized.length > DRAFT_LIMIT) {
      /* 按超出比例截断正文，留 1KB 余量 */
      var over = serialized.length - DRAFT_LIMIT + 1024;
      payload.content = payload.content.slice(0, Math.max(0, payload.content.length - over));
      payload.truncated = true;
      serialized = JSON.stringify(payload);
    }
    try {
      localStorage.setItem(draftKey(postId), serialized);
      return { saved: true, truncated: payload.truncated };
    } catch (e) {
      return { saved: false, truncated: false, error: e };
    }
  }

  /* 进编辑页：有未恢复快照则询问 */
  function offerDraftRestore(state) {
    /* 正在编辑已存在文章时，也检测它的快照（可能是上次没保存完的） */
    var snap = readDraft(state.postId);
    if (!snap) return;
    /* 快照与当前库内内容一致 → 没必要恢复，静默清掉 */
    var cur = state.post || {};
    var sameAsDb = (snap.title || '') === (cur.title || '') &&
      (snap.content || '') === (cur.content || '') &&
      (snap.tags || '') === ((cur.tags || []).join(','));
    if (sameAsDb) { clearDraft(state.postId); return; }

    var when = snap.at ? new Date(snap.at).toLocaleString() : '未知时间';
    var hint = snap.truncated ? '<br><span style="color:var(--yellow)">⚠ 草稿过长已截断，恢复后请检查正文结尾</span>' : '';
    openModal('发现未恢复的草稿',
      '检测到 <b>' + V().esc(when) + '</b> 的本地草稿快照（未保存到云端）。<br>是否恢复到编辑器？' + hint, [
        {
          label: '忽略并删除', cls: 'btn-ghost',
          onClick: function () { clearDraft(state.postId); }
        },
        {
          label: '恢复草稿', cls: 'btn-magenta',
          onClick: function () {
            var t = document.getElementById('ed-title');
            var s = document.getElementById('ed-summary');
            var g = document.getElementById('ed-tags');
            var c = document.getElementById('ed-cover');
            var ta = document.getElementById('editor-textarea');
            if (t) t.value = snap.title || '';
            if (s) s.value = snap.summary || '';
            if (g) g.value = snap.tags || '';
            if (c) c.value = snap.cover || '';
            if (ta) {
              ta.value = snap.content || '';
              ta.dispatchEvent(new Event('input', { bubbles: true })); /* 触发预览刷新 */
            }
            toast('草稿已恢复', 'ok');
          }
        }
      ]);
  }

  function bindEditor(state) {
    var ta = document.getElementById('editor-textarea');
    var preview = document.getElementById('ed-preview');
    var debounceTimer = null;

    /* ---- A3：窄屏「输入/预览」切换 ----
       ed-switch 桌面端 display:none（点了也不会有事件），绑一次无妨。
       切换只改 editor-grid 的 data-ed-view + 按钮 active/aria-selected，
       pane 显隐交给 CSS 媒体查询 —— JS 不感知屏宽，避免维护第二套断点。 */
    var edSwitch = document.getElementById('ed-switch');
    var edGrid = document.querySelector('.editor-grid');
    if (edSwitch && edGrid) {
      edSwitch.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-ed-view]') : null;
        if (!b) return;
        edGrid.setAttribute('data-ed-view', b.getAttribute('data-ed-view'));
        Array.prototype.forEach.call(edSwitch.querySelectorAll('button'), function (x) {
          var on = x === b;
          x.classList.toggle('active', on);
          x.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      });
    }

    /* ---- C7 草稿快照：防抖 3s 写 localStorage ---- */
    var draftTimer = null;
    var truncWarned = false;
    /* ---- C11：草稿状态与字数提示 ----
       反馈只写这一个函数，避免出现"两处各自拼字符串、文案不一致"的问题。 */
    var statusEl = document.getElementById('ed-status');
    var lastSavedAt = '';
    function fmtClock(d) {
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }
    function renderEditorStatus() {
      if (!statusEl) return;
      var n = ta.value.length;
      var parts = [];
      if (lastSavedAt) parts.push('已自动保存 · ' + lastSavedAt);
      parts.push(n.toLocaleString('zh-CN') + ' / ' + CONTENT_MAX.toLocaleString('zh-CN') + ' 字符');
      /* 用 textContent 而非 innerHTML —— 内容含用户不可控字符时不给自己找 XSS 麻烦 */
      statusEl.textContent = parts.join('　·　');
      /* 90% 起提前预警：现在是超限才报错，那时正文已经写完了 */
      statusEl.classList.toggle('near-limit', n >= CONTENT_MAX * 0.9);
      statusEl.classList.toggle('over-limit', n > CONTENT_MAX);
    }
    renderEditorStatus();   /* 进编辑页先显示一次当前字数，别等第一次输入才有反馈 */

    function snapshotNow() {
      var r = writeDraft(state.postId, {
        title: (document.getElementById('ed-title') || {}).value || '',
        summary: (document.getElementById('ed-summary') || {}).value || '',
        tags: (document.getElementById('ed-tags') || {}).value || '',
        cover: (document.getElementById('ed-cover') || {}).value || '',
        content: ta.value || ''
      });
      if (r.truncated && !truncWarned) {
        truncWarned = true;
        toast('草稿过长，本地快照已截断正文（云端保存不受影响）', 'warn');
      }
      lastSavedAt = fmtClock(new Date());
      renderEditorStatus();
    }
    function scheduleSnapshot() {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(snapshotNow, 3000);
    }
    /* 标题/摘要/标签/封面也纳入快照范围 */
    ['ed-title', 'ed-summary', 'ed-tags', 'ed-cover'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', scheduleSnapshot);
    });
    /* 离开编辑页时把最后一次改动落盘，避免防抖窗口内的内容丢失 */
    window.addEventListener('hashchange', function onLeave() {
      if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; snapshotNow(); }
      window.removeEventListener('hashchange', onLeave);
    });

    function refreshPreview() {
      renderMarkdownInto(preview, ta.value);
    }
    ta.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshPreview, 300);
      scheduleSnapshot();
      renderEditorStatus();
    });

    /* 快捷键
       ⚠ 为什么挂在这里而不是 keys.js：keys.js 对【任何】Ctrl/Alt/Meta 组合一律放行
       （不抢浏览器与系统快捷键），且在输入态下除 Esc 外全部放手 —— 这是 C10 定下的硬约束。
       所以编辑器快捷键只能在 textarea 上单独监听，天然满足"只在编辑器聚焦时生效"。 */
    ta.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrapSelection('**', '**'); }
      if (k === 'i') { e.preventDefault(); wrapSelection('*', '*'); }
      /* C11 补齐：链接与代码块（严格按方案给的四组，不擅自加） */
      if (k === 'k') { e.preventDefault(); wrapSelection('[', '](https://)'); }
      if (k === 'c' && e.shiftKey) { e.preventDefault(); insertAtCursor('\n```\n// code here\n```\n'); }
    });

    function insertAtCursor(text) {
      var start = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshPreview, 200);
    }
    function wrapSelection(before, after) {
      var start = ta.selectionStart, end = ta.selectionEnd;
      var sel = ta.value.slice(start, end);
      ta.value = ta.value.slice(0, start) + before + sel + after + ta.value.slice(end);
      ta.selectionStart = start + before.length;
      ta.selectionEnd = end + before.length;
      ta.focus();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshPreview, 200);
    }
    function linePrefix(prefix) {
      var start = ta.selectionStart;
      var lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
      ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
      ta.selectionStart = ta.selectionEnd = start + prefix.length;
      ta.focus();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshPreview, 200);
    }

    /* 工具栏 */
    app.querySelectorAll('[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tool = b.getAttribute('data-tool');
        if (tool === 'h2') linePrefix('## ');
        if (tool === 'bold') wrapSelection('**', '**');
        if (tool === 'italic') wrapSelection('*', '*');
        if (tool === 'code') wrapSelection('`', '`');
        if (tool === 'pre') insertAtCursor('\n```\n// code here\n```\n');
        if (tool === 'quote') linePrefix('> ');
        if (tool === 'link') wrapSelection('[', '](https://)');
        if (tool === 'hr') insertAtCursor('\n---\n');
      });
    });

    /* 图片上传 */
    var imgInput = document.getElementById('file-img');
    document.getElementById('ed-upload-img').addEventListener('click', function () { imgInput.click(); });
    imgInput.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(imgInput.files || []);
      imgInput.value = '';
      if (files.length === 0) return;
      var uid = State.session.user.id;
      var btn = document.getElementById('ed-upload-img');
      btn.disabled = true;
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        btn.textContent = '上传中 ' + (i + 1) + '/' + files.length + '…';
        try {
          /* 压缩与云端原始备份并行。
             v2.2.1：尺寸不再写死在调用处，统一取 cloud.js 的尺寸标准常量 ——
             「列表封面为什么糊」这件事的根源就是两处数字各自飘着，
             展示尺寸改了没人同步。钉成单一来源后，改一处即全站生效。 */
          var compressed = await need('compressImage')(
            f, need('IMAGE_MAX_DIM'), need('IMAGE_QUALITY'), need('DATA_MAX_BYTES'));
          /* 缩略图供【列表页封面】使用（.card-cover 展示宽 1046px）：
             旧标准只给 256px，会被 cover 放大 4.09 倍，直接糊成像素块；
             现在 1280px，1x 屏 1.22x 不放大（尺寸标准见 cloud.js，勿在此写死）。
             失败不阻断上传，仅少了缩略优化。 */
          var thumbB64 = null;
          try {
            var thumbRes = await need('compressImage')(
              f, need('THUMB_MAX_DIM'), need('THUMB_QUALITY'), need('THUMB_MAX_BYTES'));
            thumbB64 = thumbRes.base64;
          } catch (te) {
            try { console.warn('[NEON] 缩略图生成失败，列表页将回退原图：', te); } catch (e2) {}
          }
          var backupPath = null;
          try { backupPath = await need('Storage').uploadImage(f, uid); }
          catch (be) { toast(errMsg(be, '云端原始备份失败，展示版本仍会保存'), 'warn'); }
          var imgId = await need('Images').insert({
            content_type: compressed.content_type,
            data: compressed.base64,
            thumb: thumbB64,
            storage_path: backupPath,
            width: compressed.width,
            height: compressed.height,
            size_bytes: compressed.size_bytes
          });
          var alt = f.name.replace(/\.[^.]*$/, '').slice(0, 40) || 'image';
          insertAtCursor('\n![' + alt + '](cloudimg://' + imgId + ')\n');
        } catch (e) {
          toast(errMsg(e, '图片上传失败'), 'error');
        }
      }
      btn.disabled = false;
      btn.textContent = '🖼 图片';
    });

    /* 附件上传 */
    var attachInput = document.getElementById('file-attach');
    document.getElementById('ed-upload-attach').addEventListener('click', function () { attachInput.click(); });
    attachInput.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(attachInput.files || []);
      attachInput.value = '';
      if (files.length === 0) return;
      var uid = State.session.user.id;
      var btn = document.getElementById('ed-upload-attach');
      btn.disabled = true;
      for (var i = 0; i < files.length; i++) {
        btn.textContent = '上传中 ' + (i + 1) + '/' + files.length + '…';
        try {
          var up = await need('Storage').uploadAttachment(files[i], uid);
          insertAtCursor('[' + up.name + ' (' + V().fmtSize(up.size) + ')](cloudfile://' + up.path + ')');
        } catch (e) {
          toast(errMsg(e, '附件上传失败'), 'error');
        }
      }
      btn.disabled = false;
      btn.textContent = '📎 附件';
    });

    /* 封面选择 */
    document.getElementById('ed-cover-pick').addEventListener('click', openCoverPicker);

    /* 保存 / 发布 */
    function collectFields(status) {
      var title = document.getElementById('ed-title').value.trim();
      if (!title) { toast('标题不能为空', 'warn'); return null; }
      var tags = normalizeTags(document.getElementById('ed-tags').value);
      var cover = document.getElementById('ed-cover').value.trim();
      if (cover && !CLOUDIMG_RE.test(cover)) {
        toast('封面引用格式应为 cloudimg://ID', 'warn');
        return null;
      }
      var body = ta ? ta.value : '';
      if (body.length > CONTENT_MAX) {
        toast('正文超出上限（' + body.length + ' / ' + CONTENT_MAX + ' 字符），请拆分后再保存', 'warn');
        return null;
      }
      return {
        title: title,
        summary: document.getElementById('ed-summary').value.trim() || null,
        content: body,
        tags: tags,
        cover_ref: cover || null,
        status: status,
        owner_name: State.nickname || (State.session.user.email || 'OPERATOR').split('@')[0]
      };
    }

    var draftBtn = document.getElementById('ed-save-draft');
    var pubBtn = document.getElementById('ed-publish');
    draftBtn.addEventListener('click', async function () {
      var fields = collectFields('draft');
      if (!fields) return;
      draftBtn.disabled = true;
      try {
        if (state.postId) {
          await need('Posts').update(state.postId, Object.assign({ updated_at: new Date().toISOString() }, fields));
        } else {
          var created = await need('Posts').create(fields);
          state.postId = created.id;
        }
        clearDraft(state.postId);            /* C7：已落库，清掉本地快照 */
        clearDraft(null);                    /* 新建槽同步清理 */
        toast('草稿已保存', 'ok');
      } catch (e) {
        toast(errMsg(e, '保存失败'), 'error');
      }
      draftBtn.disabled = false;
    });

    pubBtn.addEventListener('click', async function () {
      var fields = collectFields('published');
      if (!fields) return;
      pubBtn.disabled = true;
      try {
        if (state.postId) {
          await need('Posts').update(state.postId, Object.assign({ updated_at: new Date().toISOString() }, fields));
        } else {
          var created = await need('Posts').create(fields);
          state.postId = created.id;
        }
        clearDraft(state.postId);            /* C7：已发布，清掉本地快照 */
        clearDraft(null);
        toast('广播已发布 // SIGNAL ONLINE', 'ok');
        location.hash = '#/admin';
      } catch (e) {
        toast(errMsg(e, '发布失败'), 'error');
        pubBtn.disabled = false;
      }
    });

    /* 转草稿 / 删除 */
    var toggleBtn = document.getElementById('ed-toggle-status');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', async function () {
        try {
          await need('Posts').update(state.postId, { status: 'draft', updated_at: new Date().toISOString() });
          toast('已转为草稿', 'ok');
          location.hash = '#/admin';
        } catch (e) {
          toast(errMsg(e, '操作失败'), 'error');
        }
      });
    }
    var delBtn = document.getElementById('ed-delete');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        openModal('删除信号', '确定要永久删除这篇文章吗？<br><span style="color:var(--red)">此操作不可恢复。</span>', [
          { label: '取消', cls: 'btn-ghost' },
          {
            label: '确认删除', cls: 'btn-magenta',
            onClick: async function () {
              try {
                await need('Posts').remove(state.postId);
                clearDraft(state.postId);   /* C7：文章已删，快照一并清 */
                toast('信号已删除', 'ok');
                location.hash = '#/admin';
              } catch (e) {
                toast(errMsg(e, '删除失败'), 'error');
              }
            }
          }
        ]);
      });
    }

    /* 已有文章：初始化预览 */
    if (state.post && state.post.content) refreshPreview();
  }

  /* 封面选择器
     A3：这里按 owner_id 过滤，故走基表 post_images（RLS 只放行本人行）。
     视图 public_images 不含 owner_id，不适用本场景。 */
  async function openCoverPicker() {
    if (!State.session) return;
    try {
      var r = await need('dbFrom')('post_images')
        .select('id,content_type,data,width,height,created_at')
        .eq('owner_id', State.session.user.id)
        .order('created_at', { ascending: false })
        .limit(12);
      if (r.error) throw new Error(errMsg(r.error, '图片库读取失败'));
      var imgs = r.data || [];
      if (imgs.length === 0) {
        openModal('选择封面', '你的图片库还是空的。先在编辑器里上传一张图片吧。', [{ label: '知道了', cls: 'btn-ghost' }]);
        return;
      }
      /* A3 纵深防御：不信任库内 content_type，白名单外一律按 jpeg 处理 */
      var SAFE_MIME = /^image\/(jpeg|png|gif|webp)$/i;
      var grid = imgs.map(function (im) {
        var mime = SAFE_MIME.test(String(im.content_type || '')) ? im.content_type : 'image/jpeg';
        return '<div data-cover-id="' + im.id + '" style="cursor:pointer;border:1px solid var(--line);padding:4px;background:#060a14">' +
          '<img src="data:' + mime + ';base64,' + im.data + '" style="width:100%;height:90px;object-fit:cover;display:block">' +
          '<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);text-align:center;padding-top:4px">#' + im.id + ' · ' + im.width + '×' + im.height + '</div></div>';
      }).join('');
      openModal('选择封面', '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">' + grid + '</div>', []);
      document.querySelectorAll('[data-cover-id]').forEach(function (el) {
        el.addEventListener('click', function () {
          document.getElementById('ed-cover').value = 'cloudimg://' + el.getAttribute('data-cover-id');
          closeModal();
          toast('封面已设置', 'ok');
        });
      });
    } catch (e) {
      toast(errMsg(e, '图片库读取失败'), 'error');
    }
  }

  /* ============ 全局事件 ============ */
  /* F1：卡片键盘可达 —— 卡片已带 tabindex=0（views.js），这里代理 Enter/Space
     触发与点击相同的跳转。不用 <a> 包整卡：卡内已有 <a> 标签，HTML 禁止 a 嵌套。
     e.target !== card 守卫：焦点在卡内 <a>（tag 链接）上按 Enter 必须放行原生
     导航，只有焦点直接落在卡片本身时才代理 —— 不能抢卡内链接的键盘行为。 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!e.target || !e.target.closest) return;
    var card = e.target.closest('.post-card');
    if (!card || e.target !== card) return;
    e.preventDefault();
    location.hash = '#/post/' + card.getAttribute('data-id');
  });

  /* ---------- v2.9.4 主题罗盘：外部点击收起 + Escape 收起 + 方向键换档 ----------
     与电台面板同一套范式（见 bindRadioPanel）。装在 document 上而非 renderNav 里：
     renderNav 会被反复调用（登录/登出/路由），逐次绑定会累积监听；
     委托一次即可，面板被 innerHTML 重建也不影响。 */
  document.addEventListener('mousedown', function (ev) {
    if (!themeMenuOpen()) return;
    if (!ev.target || !ev.target.closest) return;
    /* 点面板内 / 点触发器 → 交给各自的 click 处理，这里不插手 */
    if (ev.target.closest('#theme-menu')) return;
    if (ev.target.closest('#btn-theme')) return;
    closeThemeMenu(false);
  });

  document.addEventListener('keydown', function (ev) {
    if (!themeMenuOpen()) return;
    if (ev.key === 'Escape') { closeThemeMenu(true); return; }
    /* v3.4.0：滑杆上的方向键交给**原生行为**（增减 1 度）。
       不在这里放行的话，下面那段"组内换档"会把方向键抢走 ——
       滑杆就沦为只能鼠标拖的控件，键盘用户反而比改版前更差。
       Escape 仍由上面一行接管（滑杆上按 Esc 照样关面板）。 */
    if (ev.target && ev.target.type === 'range') return;
    /* radiogroup 标准键盘行为：方向键在组内移动并**立即选中**。
       不拦截 Enter/Space —— 那是 <button> 的原生行为，会走上面的 click 委托。 */
    var dir = (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') ? 1
      : (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') ? -1 : 0;
    if (!dir) return;
    var menu = document.getElementById('theme-menu');
    if (!menu) return;
    /* v3.0 B1：先在**焦点所在的那个组**内找项（明度组 3 项 / 色相组 9 项）。
       两组互不串门 —— 在明度组里按方向键，不该跳到色相档上去。 */
    var active = (ev.target && ev.target.closest)
      ? ev.target.closest('[data-theme-val],[data-hue-val]') : null;
    var group = (active && active.closest) ? active.closest('[role="radiogroup"]') : null;
    if (!group) group = menu.querySelector('[role="radiogroup"]');
    if (!group) return;
    var items = Array.prototype.slice.call(
      group.querySelectorAll('[data-theme-val],[data-hue-val]'));
    if (!items.length) return;
    ev.preventDefault();
    var idx = items.indexOf(active);
    if (idx === -1) {
      /* 焦点不在任何一项上（理论上不该发生）：退化为"从当前选中项出发" */
      for (var i = 0; i < items.length; i++) {
        if (items[i].getAttribute('aria-checked') === 'true') idx = i;
      }
    }
    var target = items[(idx + dir + items.length) % items.length];
    if (target.hasAttribute('data-hue-val')) {
      setHue(parseInt(target.getAttribute('data-hue-val'), 10));
    } else {
      setTheme(target.getAttribute('data-theme-val'));
    }
    try { target.focus(); } catch (e) { /* 忽略 */ }
  });

  /* ---------- v3.4.0：色相自由滑杆 ----------
     拖动中用 input（连续触发）只改 CSS 变量、**不写存储** ——
     localStorage 是同步写，逐帧写会把手感拖钝。
     松手用 change 落存储：于是"拖动轻、落点重"，也避免把半途值散落一地。
     ⚠ 两条路径都走同一套 hueValid 校验，越界值自动拉回合法区间；
       委托挂在 document 上只挂一次（面板会被 innerHTML 重建，不能逐次绑定）。 */
  document.addEventListener('input', function (ev) {
    if (!ev.target || ev.target.id !== 'hue-slider') return;
    applyHue(parseInt(ev.target.value, 10));
  });

  document.addEventListener('change', function (ev) {
    if (!ev.target || ev.target.id !== 'hue-slider') return;
    setHue(parseInt(ev.target.value, 10));
  });

  document.addEventListener('click', async function (e) {
    /* 文章卡片 → 详情 */
    var card = e.target.closest('.post-card');
    if (card && !e.target.closest('a')) {
      location.hash = '#/post/' + card.getAttribute('data-id');
      return;
    }
    /* v4.3 B4：装置面板控件 —— 氛围三档 / 九层开关 / 恢复自动 / 点击反馈 / 性能锁定 / 重播开机。
       全部走 data 属性委托（面板会被 innerHTML 重建，不能逐次绑定）。 */
    var atmoModeBtn = e.target.closest('[data-atmo-val]');
    if (atmoModeBtn) { setAtmoMode(atmoModeBtn.getAttribute('data-atmo-val')); return; }
    var atmoLayerBtn = e.target.closest('[data-atmo-layer]');
    if (atmoLayerBtn) {
      setAtmoLayer(atmoLayerBtn.getAttribute('data-atmo-layer'),
        atmoLayerBtn.getAttribute('aria-pressed') !== 'true');
      return;
    }
    if (e.target.id === 'atmo-reset') { resetAtmoManual(); return; }
    var tapBtn = e.target.closest('[data-tap-val]');
    if (tapBtn) {
      if (window.NEONTap && window.NEONTap.setMode) {
        window.NEONTap.setMode(tapBtn.getAttribute('data-tap-val'));
      }
      syncAtmoPanel();
      return;
    }
    if (e.target.id === 'atmo-lock') {
      var wasLocked = e.target.getAttribute('aria-checked') === 'true';
      try { localStorage.setItem('neon_atmo_lock', wasLocked ? '0' : '1'); } catch (err) { /* 忽略 */ }
      syncAtmoPanel();
      return;
    }
    if (e.target.id === 'replay-boot') {
      /* 重播开机序列：清会话标记 + 回首页 + 重载（只首页会播，故先回首页） */
      try { window.sessionStorage.removeItem('neon_boot_seen'); } catch (err) { /* 忽略 */ }
      location.hash = '#/';
      location.reload();
      return;
    }
    /* 加载更多 —— E3：请求期间给等待态（文字 ▚ LOADING + 置灰防连点），
       loadHome 完成后 innerHTML 重建按钮自动恢复原样；失败走错误态重渲染，
       同样自动恢复。loading 类再拦一次是防键盘触发（disabled 已挡鼠标）。 */
    if (e.target.id === 'btn-load-more') {
      var lm = e.target;
      if (lm.classList.contains('loading')) return;
      lm.classList.add('loading');
      lm.disabled = true;
      lm.textContent = '▚ LOADING';
      State.home.page += 1;
      loadHome(true);
      return;
    }
    /* v3.2.0 B3：筛选条的快捷频段 —— 改 hash 即触发搜索。
       刻意不复用"填入输入框再点扫描"那条路：改 hash 是搜索的唯一入口，
       用户从地址栏分享链接与从芯片点击进来的结果必然一致。 */
    var fillEl = e.target.closest('[data-search-fill]');
    if (fillEl) {
      e.preventDefault();
      location.hash = '#/search/' + encodeURIComponent(fillEl.getAttribute('data-search-fill'));
      return;
    }
    /* 附件下载 */
    var attach = e.target.closest('[data-attach-path]');
    if (attach) {
      e.preventDefault();
      if (!State.session) {
        toast('附件下载需要先登录（ACCESS）', 'warn');
        return;
      }
      var rawPath = attach.getAttribute('data-attach-path');
      var path = rawPath;
      try { path = decodeURIComponent(rawPath); } catch (err) { /* 保持原样 */ }
      attach.classList.add('locked');
      try {
        var url = await need('Storage').signedUrl(path, 1800);
        attach.classList.remove('locked');
        window.open(url, '_blank');
      } catch (err) {
        attach.classList.remove('locked');
        toast(errMsg(err, '获取下载链接失败'), 'error');
      }
      return;
    }
    /* 工程日志 */
    if (e.target.closest('#btn-changelog')) {
      e.preventDefault();
      openChangelog();
      return;
    }
    /* C6 / v2.9.4：主题三选一 —— 触发器只负责开合面板，不再循环切档 */
    if (e.target.closest('#btn-theme')) {
      e.preventDefault();
      toggleThemeMenu();
      return;
    }
    /* v3.0 B1：色相档 —— 与明度档相反，切换后**不关面板**：
       试色是"连着试几个"的行为，关掉再打开会打断比较。
       焦点留在色点上，方向键可继续换。 */
    var hueEl = e.target.closest('[data-hue-val]');
    if (hueEl) {
      e.preventDefault();
      var appliedHue = setHue(parseInt(hueEl.getAttribute('data-hue-val'), 10));
      try { hueEl.focus(); } catch (errHue) { /* 忽略 */ }
      toast('色相已切换：' + (HUE_NAME[appliedHue] || appliedHue), 'ok');
      return;
    }
    var swapEl = e.target.closest('[data-theme-val]');
    if (swapEl) {
      e.preventDefault();
      var applied = setTheme(swapEl.getAttribute('data-theme-val'));
      closeThemeMenu(true);
      toast('配色已切换：' + (THEME_ICON[applied] || applied), 'ok');
      return;
    }
    /* 退出登录 */
    if (e.target.id === 'nav-logout') {
      e.preventDefault();
      var r = await need('Auth').signOut();
      if (r.error) { toast(r.error, 'error'); return; }
      State.session = null;
      State.nickname = '';
      localStorage.removeItem('neon_nickname');
      toast('已断开连接', 'ok');
      location.hash = '#/';
      return;
    }
  });

  /* ============ E1：全局错误上报 ============ */
  /* 生产白屏时用户不会开 F12 —— 让错误自己回到库里。
     挂载原则：只负责「捕获 + 脱敏 + 上报」，任何失败都必须静默，
     上报通道自己绝不能成为新的错误源。 */
  function currentBuildTag() {
    var info = getVersionInfo();
    return info && info.BUILD ? 'v' + info.BUILD : 'unknown';
  }

  function reportError(kind, detail) {
    try {
      var payload = {
        build: currentBuildTag(),
        message: detail.message,
        source: detail.source,
        lineno: detail.lineno,
        colno: detail.colno,
        path: location.pathname + (location.hash || ''),
        ua: navigator.userAgent
      };
      /* 原始对象只进 console，不入库 —— 安全基线：对外脱敏 */
      console.error('[NEON] 捕获到未处理' + (kind === 'rejection' ? ' Promise 拒绝' : '异常') + '：', detail.raw || detail.message);
      var E = window.NEON && window.NEON.Errors;
      if (E && typeof E.report === 'function') E.report(kind, payload);
    } catch (e) { /* 静默 */ }
  }

  function installErrorHooks() {
    window.addEventListener('error', function (ev) {
      /* 只接 JS 运行时异常，拒收资源加载错误。
         <img>/<link>/<script> 加载失败同样会在 window 上触发 error 事件
         （冒泡到 window，ev.target 是那个元素），但它们的 ev.message 为空、
         ev.filename 为 undefined —— 上报上去就是一条「未知错误 @ undefined」的垃圾。
         更糟的是 ERR_BUDGET 只有 10 条：一旦页面有张图挂了（或被 CSP 拦了），
         资源错误会把配额吃光，真正的 JS 异常反而报不上来，上报机制等于废掉。
         判定依据：资源错误必有 ev.target 且无 ev.message。 */
      var isResourceError = ev.target && ev.target !== window &&
        !ev.message && (ev.target.tagName || ev.target.src || ev.target.href);
      if (isResourceError) return;
      /* 跨域脚本异常被浏览器脱敏为 "Script error."，此时没有堆栈也没有行号。
         仍然上报（能证明"某处崩了"本身有价值），但打标便于区分。 */
      var msg = ev.message || '未知错误';
      if (ev.filename) msg += ' @ ' + ev.filename;
      reportError('error', {
        message: msg,
        source: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        raw: ev.error
      });
    });
    window.addEventListener('unhandledrejection', function (ev) {
      var reason = ev.reason;
      var msg = (reason && reason.message) ? reason.message : String(reason || '未处理的 Promise 拒绝');
      reportError('rejection', { message: msg, raw: reason });
    });
  }

  /* ============ 启动 ============ */
  async function boot() {
    /* E1：错误钩子最先装 —— 之后任何启动阶段的崩溃都能被捕获上报 */
    try { installErrorHooks(); } catch (e) { /* 静默 */ }
    /* C6：主题尽早应用（defer 脚本在首绘前执行，可把闪烁压到最小） */
    try { applyTheme(getTheme()); } catch (e) { /* 忽略 */ }
    /* v3.0 B1：色相同一时机补正 —— 首绘前由 theme-boot.js 写入，
       这里是"补正"（存储被改 / 白名单变化时拉回合法值），与主题的职责分工一致。 */
    try { applyHue(getHue()); } catch (e) { /* 忽略 */ }
    /* C10：键盘快捷键。放在主题之后、路由之前 —— 装完监听再渲染首屏，
       避免"首屏已出现但快捷键还没生效"的窗口期。
       keys.js 缺失时静默跳过（CSS 的 :focus-visible 与 skip-link 仍独立生效）。 */
    try {
      if (window.NEONKeys && typeof window.NEONKeys.init === 'function') {
        window.NEONKeys.init({ onEscape: function () { return false; } });
      }
    } catch (e) { try { console.error('[NEON] 快捷键初始化失败：', e); } catch (e2) {} }
    /* 版本号（页脚）+ 诊断横幅 —— 用 try 包住，即使失败也不能影响后续启动 */
    try { renderVersion(); } catch (e) { try { console.error('[NEON] 版本号渲染失败：', e); } catch (e2) {} }
    try { diagBanner(); } catch (e) { /* 忽略 */ }
    /* C19：收藏按钮委托。装在 route 之前 —— 与快捷键同理：
       避免"首屏已出现但点了没反应"的窗口期。全站只装一次（委托到 document）。 */
    try { bindMarkDelegation(); } catch (e) { try { console.error('[NEON] 收藏委托失败：', e); } catch (e2) {} }
    /* v2.8.0：电台播放器。装在 route 之前 —— 与快捷键/收藏同理，
       避免"界面已出现但点了没反应"。radio.js 缺失时静默跳过，
       不影响其余功能（电台是增强项，不是启动必需件）。 */
    try { initRadio(); } catch (e) { try { console.error('[NEON] 电台初始化失败：', e); } catch (e2) {} }
    /* 编辑器离开提醒（全局仅挂载一次，实时读取当前编辑器内容） */
    window.addEventListener('beforeunload', function (e) {
      var ta = document.getElementById('editor-textarea');
      if (ta && ta.value.trim().length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    /* CDN 依赖检查 */
    var missing = [];
    if (typeof marked === 'undefined') missing.push('Markdown');
    if (typeof DOMPurify === 'undefined') missing.push('DOMPurify');
    if (typeof hljs === 'undefined') missing.push('highlight.js');
    if (missing.length > 0) {
      var b = document.createElement('div');
      b.className = 'notice-banner';
      b.innerHTML = '◈ 以下 CDN 组件加载失败：<b>' + missing.join('、') + '</b>。请检查网络后刷新。';
      /* 挂 body 而不是 #app：挂 #app 会被路由重渲染的 innerHTML 整个抹掉 */
      try { document.body.insertBefore(b, app); } catch (e) { app.prepend(b); }
    }
    /* SDK 初始化
       注意：必须在 try 内调用。若 cloud.js 整体加载失败，
       window.NEON 不存在，此处会抛 ReferenceError 并中断整个启动流程。 */
    var ok = false;
    try {
      if (typeof window.NEON === 'undefined' || typeof window.NEON.init !== 'function') {
        throw new Error('数据层（cloud.js）未加载');
      }
      ok = NEON().init();
    } catch (e) {
      ok = false;
      try { console.error('[NEON] 数据层初始化失败：', e); } catch (e2) {}
    }
    if (!ok) {
      var b2 = document.createElement('div');
      b2.className = 'notice-banner';
      b2.innerHTML = '◈ 云服务不可用：数据层（cloud.js）或 SDK 加载失败，文章数据将无法读取。请检查网络后强制刷新（Ctrl+Shift+R）。';
      /* 同上：挂 body，避免被路由重渲染抹掉 */
      try { document.body.insertBefore(b2, app); } catch (e) { app.prepend(b2); }
    } else {
      /* 会话恢复 */
      try {
        State.session = await need('Auth').getSession();
        if (State.session) syncNicknameFromSession(State.session);
      } catch (e) {
        State.session = null; /* 无会话 = 访客模式，正常 */
      }
      /* v4.9.0：把账号的收藏取回内存（渲染路径靠它保持同步）。
         v4.9.1：**改为不阻塞首屏** —— 实测 bookmarks 一个来回 ~350ms（收藏多时更久），
         `await` 在 route() 之前等于让用户多盯一会儿白屏。改成先渲染、后回填：
         数据回来时 repaintMarks() 会就地补上收藏态（它本来就是为"同 hash 不重绘"写的）。 */
      if (!isLoggedIn()) {
        State.marks = new Set();   /* 访客没有收藏可取，同步完成即可 */
        marksLoaded = true;
      } else {
        migrateLegacyMarks().then(refreshMarks).then(function () { repaintMarks(); }, function () {});
      }
      /* 认证状态监听 */
      try {
        need('Auth').onAuthStateChange(function (event, session) {
          State.session = session || null;
          if (event === 'SIGNED_IN') {
            syncNicknameFromSession(session);
            /* 登录后才谈得上收藏。v4.9.1：迁移 + 取回都放**后台**做 ——
               实测这两个往返合计 350ms 起（旧版本地收藏多时是 N 次写入），
               挡在跳转前面就是用户嘴里的"点了登录没反应"。
               先把界面交出去（此刻缓存是空的 → 按钮按锁定态画），
               数据回来再 repaintMarks() 补上已收藏的那些。
               ⚠ 若这次登录是"点收藏被拦下来"触发的，仍然要回收藏页 ——
                 否则用户会被扔进 CONSOLE，而他只是想收藏一篇文章。 */
            migrateLegacyMarks().then(refreshMarks).then(function () { repaintMarks(); }, function () {});
            var want = State.pendingMark;
            State.pendingMark = null;
            repaintMarks();
            safeRenderNav();
            safeRoute();
            location.hash = want ? '#/marks' : '#/admin';
          }
          if (event === 'SIGNED_OUT') {
            State.session = null;
            /* 收藏是账号数据：退出即清空内存缓存 + 就地重画按钮，
               别让下一个人在这个页面上看到上一个人的收藏 */
            State.marks = new Set();
            marksLoaded = false;
            repaintMarks();
            if (location.hash === '#/admin' || location.hash.indexOf('#/edit') === 0) location.hash = '#/';
          }
          safeRenderNav();
          safeRoute();
          /* 电台队列按身份过滤（访客不显示无音频本体的旧记录）⇒ 身份一变必须重取。
             失败不影响主流程：下次开面板会自动重试。 */
          try {
            if (window.NEONRadio) {
              loadRadioTracks().then(function () { paintDock(); paintPanel(); }, function () {});
            }
          } catch (e) { /* 忽略 */ }
        });
      } catch (e) { /* 监听失败不影响主流程 */ }
    }
    safeRenderNav();
    /* C9：阅读进度条 + 回到顶部。
       装在 route 之前 —— 否则首个渲染完毕但监听还没挂，用户一开始滚动没反应。 */
    try { initScrollUI(); } catch (e) { try { console.error('[NEON] 滚动指示初始化失败：', e); } catch (e2) {} }
    window.addEventListener('hashchange', safeRoute);
    safeRoute();
  }

  /* ---------- 安全包装：任何渲染异常都不允许白屏 ---------- */
  function fatalPanel(msg) {
    if (!app) return;
    app.innerHTML = '<div class="empty-state">' +
      '<span class="empty-glyph">⚠</span>' +
      '<span class="empty-code">RENDER FAULT</span>' +
      '<span class="empty-hint">' + esc(msg || '页面渲染异常') + '</span>' +
      '<div style="margin-top:22px"><a class="btn" href="#/">返回首页</a></div>' +
      '</div>';
  }

  function safeRenderNav() {
    try { renderNav(); } catch (e) {
      try { console.error('[NEON] 导航渲染失败：', e); } catch (e2) {}
    }
  }

  /* 路由安全包装。
     ⚠ 注意 route() 里【多数渲染函数是 async】（renderHome/renderPost/renderMarks/
     renderTagAdmin/renderSearch/renderArchive...），它们内部一旦抛错，错误走的是
     **Promise rejection**，`try { route() } catch` 这种同步 try **抓不到** ——
     结果是页面永远停在 index.html 的初始「BOOTING TERMINAL」占位，白屏无提示。
     这是 2026-09-29 真实事故的根因（旧缓存 views.js 缺 marksView 时 #/marks 永久空白）。
     故必须显式接住返回值里的 thenable。 */
  function safeRoute() {
    var ret;
    try {
      ret = route();
    } catch (e) {
      try { console.error('[NEON] 路由渲染失败：', e); } catch (e2) {}
      fatalPanel('页面加载异常：' + (e && e.message ? e.message : '未知错误'));
      return;
    }
    /* async 渲染函数的 rejection 同步 try 抓不到，必须在这里补一道 */
    if (ret && typeof ret.then === 'function') {
      ret.catch(function (e) {
        try { console.error('[NEON] 路由异步渲染失败：', e); } catch (e2) {}
        fatalPanel('页面加载异常：' + (e && e.message ? e.message : '未知错误'));
      });
    }
  }

  /* ============ v4.3 B4：受控外部接口（命令终端 console.js 使用）============
     只暴露"改状态"的方法（setHue/setTheme/setAtmoMode/setAtmoLayer），
     不暴露内部实现 —— console.js 惰性取用；缺了它终端只少几条命令，不崩。 */
  window.NEONControls = {
    setHue: setHue,
    setTheme: setTheme,
    setAtmoMode: setAtmoMode,
    setAtmoLayer: setAtmoLayer
  };

  /* ---------- 启动（整体兜底）---------- */
  function bootSafe() {
    try {
      boot();
    } catch (e) {
      try { console.error('[NEON] 启动失败：', e); } catch (e2) {}
      fatalPanel('启动异常：' + (e && e.message ? e.message : '未知错误'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSafe);
  } else {
    bootSafe();
  }
})();
