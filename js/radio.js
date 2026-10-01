'use strict';
/* ============================================================
   js/radio.js — 电台播放器内核（v2.8.0）

   设计原则：
     · **纯逻辑、零 DOM 依赖** —— 只持有一个 HTMLAudioElement 与状态，
       界面由 views.js + app.js 订阅渲染。这样内核能在沙箱里被测。
     · **单例** —— 全站只有一个播放器，切页不重建（音频不中断）。
     · **取址与续签解耦** —— 播放地址由外部注入的取址函数提供
       （app.js → 数据层）。该函数可返回：
         · **字符串** —— 永久地址（如 `data:` URL），不存在过期，不续签；
         · **`{ url, ttl }`** —— 限时地址，到期前后台换源续签（用户无感）。
       v2.9.0 起电台音频存库、播的是 data URL，所以续签路径默认不启用；
       保留它是为了让「带 token 的公开直链」这类音源直接复用本内核。

   公开 API（NEONRadio）：
     init(opts)            初始化（注入 audio 元素与取列表/取地址的函数）
     load(rows)            载入曲目队列
     play() / pause() / toggle()
     next() / prev()
     seek(sec) / setVolume(v) / toggleMute()
     setRepeat(mode) / setShuffle(bool)
     on(evt, fn)           订阅事件：trackchange / statechange / timeupdate / error
     state()               只读快照（给 UI 渲染）
   ============================================================ */
(function () {
  /* ---------- 常量 ---------- */
  var REPEAT_MODES = ['off', 'all', 'one'];  /* 关闭 / 列表循环 / 单曲循环 */
  var DEFAULT_VOLUME = 0.8;
  var VOL_KEY = 'neon_radio_volume';         /* 音量本地记忆（刷新不炸耳朵） */
  var MODE_KEY = 'neon_radio_mode';          /* 随机 / 循环偏好 */
  var SIGN_RENEW_AHEAD = 300;                /* 到期前 5 分钟续签 */

  /* ---------- 工具 ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function readNum(key, dflt, lo, hi) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return dflt;
      var n = Number(raw);
      if (!isFinite(n)) return dflt;
      return clamp(n, lo, hi);
    } catch (e) { return dflt; }
  }

  function writeStr(key, val) {
    try { window.localStorage.setItem(key, String(val)); } catch (e) {}
  }

  function readStr(key, dflt) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? dflt : v;
    } catch (e) { return dflt; }
  }

  /* 秒 → m:ss（时长未知返回 --:--） */
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    var s = Math.floor(sec % 60);
    var m = Math.floor(sec / 60);
    if (m >= 60) {
      var h = Math.floor(m / 60);
      m = m % 60;
      return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------- 状态 ---------- */
  var audio = null;
  var rows = [];              /* 队列（原始行数据） */
  var order = [];             /* 播放顺序（下标数组；随机模式下是打乱的） */
  var pos = -1;               /* 当前在 order 里的位置 */
  var playing = false;
  var ready = false;
  var volume = DEFAULT_VOLUME;
  var muted = false;
  var repeat = 'all';
  var shuffle = false;
  var curTime = 0;
  var duration = 0;
  var loading = false;
  var errText = '';
  var signTimer = null;       /* 续签定时器 */
  var signAt = 0;             /* 当前地址的签发时刻 */
  var signTtlSec = 0;         /* 当前地址的有效期（0 = 永久，无续签概念） */
  var listeners = {};
  var urlFetcher = null;      /* function(row) -> Promise<string | {url, ttl}> */
  var errStreak = 0;          /* 连续加载失败计数（防"整队列都是坏文件"时无限重试） */
  /* v4.9.9：当前曲目若是「官方外链播放器」（网易云 outchain），这里是它的地址，否则空。
     ⚠ 必须显式声明：本文件是 'use strict'，给未声明的变量赋值会直接抛 ReferenceError，
       而且只在"切到那首歌"的瞬间才炸 —— 语法检查与静态断言都看不出来。 */
  var embedUrl = '';

  /* ---------- 事件 ---------- */
  function emit(evt, payload) {
    var fns = listeners[evt];
    if (!fns) return;
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](payload); } catch (e) {
        try { console.error('[NEON] radio 监听器异常：', e); } catch (e2) {}
      }
    }
  }

  function snapshot() {
    var cur = currentRow();
    return {
      ready: ready,
      /* v4.9.10：**每次快照都按当前曲目重算** —— 不缓存、不依赖副作用，
         这样无论从哪条路径切过来（设置列表 / playAt / next / 自动跳），界面都能拿到正确值 */
      embedUrl: isEmbedRow(cur) ? cur.source_url : '',
      count: rows.length,
      index: pos,
      current: cur || null,
      playing: playing,
      loading: loading,
      time: curTime,
      duration: duration,
      volume: volume,
      muted: muted,
      repeat: repeat,
      shuffle: shuffle,
      error: errText,
      queue: rows
    };
  }

  function pushState() { emit('statechange', snapshot()); }

  /* ---------- 播放地址 ---------- */
  /* 归一化取址函数的返回值：
     字符串 → 永久地址（ttl 0）；对象 → 限时地址（ttl 秒）。
     这样调用方想升级成「带 token 的限时直链」不用改内核。 */
  /* v4.9.10：这一行是不是「官方外链播放器」（网易云 outchain）。
     ⚠ 判定必须能**只看行**得出 —— 不能依赖"取地址那条路走没走到"：
       实测 playAt() 不经过 attachCurrent，靠副作用的 embedUrl 会一直是空，
       面板里就永远不出现官方播放器。 */
  function isEmbedRow(row) {
    return !!(row && typeof row.source_url === 'string' &&
      /^https:\/\/music\.163\.com\/outchain\/player/i.test(row.source_url));
  }

  function currentRow() {
    return (pos >= 0 && pos < order.length) ? rows[order[pos]] : null;
  }

  function normalizeSource(r) {
    if (!r) return null;
    if (typeof r === 'string') return { url: r, ttl: 0 };
    if (typeof r === 'object' && r.url) {
      var t = Number(r.ttl);
      return { url: String(r.url), ttl: (isFinite(t) && t > 0) ? Math.floor(t) : 0 };
    }
    return null;
  }

  /* 取当前曲目的播放地址并设为 src。
     ⚠ 每次播放都重新取地址（不复用上一轮拿到的 URL）—— 地址可能已过期；
       代价侧由数据层的 LRU 缓存兜住（命中即零成本）。 */
  async function attachCurrent(autoplay) {
    if (!audio) return;
    if (pos < 0 || pos >= order.length) {
      audio.removeAttribute('src');
      playing = false;
      pushState();
      return;
    }
    var row = rows[order[pos]];
    loading = true;
    errText = '';
    pushState();

    try {
      /* ⚠ 传**整行**（不是某一列）：地址来源已从「云存储签名 URL」换成
         「库内 data URL」（v2.9.0），内核不该知道存储细节，只管把行交给数据层。 */
      var got = normalizeSource(await urlFetcher(row));
      if (!got || !got.url) throw new Error('无法获取播放地址');

      /* v4.9.9：网易云官方外链播放器 —— 它不是给 <audio> 的地址，而是"一整个官方 iframe"。
         所以这里**不碰 audio**（设了 src 只会得到一句"无法播放"），
         只把地址交给状态，由界面渲染 iframe；本站自己的播放/进度对它无意义。 */
      if (/^https:\/\/music\.163\.com\/outchain\/player/i.test(got.url)) {
        try { audio.pause(); } catch (e) {}
        try { audio.removeAttribute('src'); } catch (e2) {}
        embedUrl = got.url;
        curTime = 0;
        playing = false;
        loading = false;
        errText = '';
        pushState();
        return;
      }
      embedUrl = '';   /* 换回普通曲目：清掉外链态（否则界面会一直挂着上一个 iframe） */
      signTtlSec = got.ttl;
      signAt = Date.now();

      /* 换源。⚠ 先 pause 再换 src：换 src 时部分浏览器会立刻开始缓冲，
         不 pause 会出现"上一首还没停、下一首已经在响"的双声道。 */
      try { audio.pause(); } catch (e) {}
      audio.src = got.url;
      audio.load();
      loading = false;
      errStreak = 0;
      pushState();

      /* 永久地址（如 data: URL）没有续签概念 —— 挂个定时器纯属白耗电 */
      if (signTtlSec > 0) scheduleRenew(signTtlSec); else clearRenew();
      if (autoplay) {
        await doPlay();
      } else {
        pushState();
      }
    } catch (e) {
      loading = false;
      errText = (e && e.message) ? e.message : '加载失败';
      pushState();
      emit('error', { message: errText, index: pos });
      /* 连续失败（如整队列文件都失效）时不自动跳，避免连环报错 —— 
         交给用户手动 next，或修好数据。最多自动跳过一次。 */
      if (errStreak < 1 && rows.length > 1) {
        errStreak++;
        setTimeout(function () { next(true); }, 800);
      }
    }
  }

  function clearRenew() {
    if (signTimer) { clearTimeout(signTimer); signTimer = null; }
  }

  /* 到期前主动续签：只换 src 不打断播放（仅在暂停态才安全）。
     播放中不动 src —— 那会中断声音。播放中若地址真的过期，浏览器报错，
     由 error 事件兜底重取。
     ⚠ TTL **完全由数据层下发**，内核不自带兜底常数（曾经这里写死 7200
       而平台上限是 3600 —— 两处各自为政必然会再次越界。教训：单一来源）。
     传入的 ttl 已由 cloud.js 的 clampTtl 夹到 1..3600，这里只做正数校验。 */
  function scheduleRenew(ttlSec) {
    clearRenew();
    var ttl = Number(ttlSec) > 0 ? Number(ttlSec) : signTtlSec;
    if (!(ttl > 0)) return;   /* 永久地址不需要续签 */
    var delay = Math.max(60000, ttl * 1000 - SIGN_RENEW_AHEAD * 1000);
    signTimer = setTimeout(function () {
      /* 暂停态才换源（不影响听感）；播放态留给 error 事件兜底 */
      if (!playing && pos >= 0) attachCurrent(false);
      else scheduleRenew(ttl);
    }, delay);
  }

  /* ---------- 播放控制 ---------- */
  /* 把 MediaError 码翻成**能指导下一步**的中文（v4.9.6）。
     ⚠ 为什么必须抽成一个函数、两处都用：实测踩到过 —— audio 的 error 事件里我写好了
       中文分档，但 `play()` 的 Promise 随后又 reject（同一个故障的第二条上报路径），
       于是把那句英文原文（"Failed to load because no supported source was found."）
       覆盖了上去，用户在界面上看到的还是英文。两处共用同一个映射才不会再打架。 */
  function mediaErrText(code) {
    if (code === 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */) {
      return '音源无法播放：这个地址不是可直接播放的音频文件（可能是网页链接 / 需要登录 / 防盗链）';
    }
    if (code === 3 /* MEDIA_ERR_DECODE */) return '音频解码失败：文件可能已损坏，或浏览器不支持这种编码';
    if (code === 2 /* MEDIA_ERR_NETWORK */) return '网络中断：音频没下完，检查网络或换个更稳的源';
    if (code === 1 /* MEDIA_ERR_ABORTED */) return '播放被中断（多为切换曲目或源地址失效）';
    return '音频加载失败（文件可能缺失或已损坏）';
  }

  async function doPlay() {
    if (!audio) return false;
    /* 外链曲目由官方播放器自己发声，本站的 play() 无事可做（也不该报错）。
       按 currentRow() 判定而不是缓存变量 —— 理由同 snapshot。 */
    if (isEmbedRow(currentRow())) { pushState(); return false; }
    if (pos < 0) {
      if (!order.length) return false;
      pos = 0;
      await attachCurrent(true);
      return true;
    }
    if (!audio.src) {
      await attachCurrent(true);
      return true;
    }
    try {
      await audio.play();
      playing = true;
      errText = '';
      pushState();
      return true;
    } catch (e) {
      /* ⚠ 浏览器的自动播放策略会 reject（NotAllowedError）——
         这**不是错误**，是需要用户手势。标记出来让 UI 提示"点一下播放"，
         而不是当成故障弹红。 */
      playing = false;
      var name = e && e.name;
      if (name === 'NotAllowedError') {
        errText = '浏览器拦截了自动播放，请点一下播放键';
      } else if (name === 'NotSupportedError') {
        /* ⚠ 实测这里才是坏音源的**主**上报路径：play() 拒绝时 audio.error 往往还没被填上，
           而 error 事件又常被"装载中"守卫挡掉 —— 只按 audio.error.code 判会漏，
           于是英文兜底那句就漏到了界面上（站长截图里那句正是这么来的）。 */
        errText = mediaErrText(4);
      } else if (audio.error && audio.error.code) {
        errText = mediaErrText(audio.error.code);
      } else {
        errText = (e && e.message) ? e.message : '播放失败';
      }
      pushState();
      return false;
    }
  }

  function doPause() {
    if (!audio) return;
    try { audio.pause(); } catch (e) {}
    playing = false;
    pushState();
  }

  /* 计算下一首的位置。wrap=false 用于"播完最后一首"的场景（不循环时停下） */
  function nextPos(wrap) {
    if (!order.length) return -1;
    if (shuffle) {
      if (order.length === 1) return repeat === 'one' ? pos : (wrap ? 0 : -1);
      var candidate;
      var guard = 0;
      do {
        candidate = Math.floor(Math.random() * order.length);
        guard++;
      } while (candidate === pos && guard < 50);
      return candidate;
    }
    var n = pos + 1;
    if (n >= order.length) return wrap ? 0 : -1;
    return n;
  }

  function prevPos() {
    if (!order.length) return -1;
    if (shuffle) return nextPos(true);
    var n = pos - 1;
    if (n < 0) return repeat === 'all' ? order.length - 1 : 0;
    return n;
  }

  function next(auto) {
    if (!order.length) return;
    /* auto=true（自动播完）时是否环绕取决于 repeat：
         repeat='all' → 环绕；repeat='one' 已在 ended 里处理，走不到这；
         repeat='off' → 不环绕，返回 -1 → 停止。
       手动点击（auto=false）时**总是**环绕 —— 用户点了就该有反应，
       不能因为"已是最后一首"而按了没动静。 */
    var wrap = (auto === true) ? (repeat === 'all') : true;
    var n = nextPos(wrap);
    if (n < 0) { doPause(); return; }
    pos = n;
    attachCurrent(true);
  }

  function prev() {
    if (!order.length) return;
    /* 播过 3 秒以上：先回到本曲开头（符合通用播放器习惯），而不是直接上一首 */
    if (audio && audio.currentTime > 3 && !shuffle) {
      try { audio.currentTime = 0; } catch (e) {}
      curTime = 0;
      pushState();
      return;
    }
    var n = prevPos();
    if (n < 0) return;
    pos = n;
    attachCurrent(true);
  }

  function seek(sec) {
    if (!audio) return;
    var d = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : duration;
    if (!isFinite(sec) || sec < 0) return;
    var target = d > 0 ? clamp(sec, 0, d) : sec;
    try { audio.currentTime = target; } catch (e) {}
    curTime = target;
    pushState();
  }

  function setVolume(v) {
    if (!isFinite(v)) return;
    volume = clamp(v, 0, 1);
    if (audio) {
      try { audio.volume = volume; } catch (e) {}
      /* 调音量顺带解除静音（符合直觉：用户主动调音量=想听） */
      if (volume > 0 && muted) {
        muted = false;
        try { audio.muted = false; } catch (e) {}
      }
    }
    writeStr(VOL_KEY, volume);
    pushState();
  }

  function toggleMute() {
    muted = !muted;
    if (audio) { try { audio.muted = muted; } catch (e) {} }
    pushState();
  }

  function setRepeat(mode) {
    if (REPEAT_MODES.indexOf(mode) < 0) return;
    repeat = mode;
    writeStr(MODE_KEY, repeat + ':' + (shuffle ? '1' : '0'));
    if (audio) audio.loop = (repeat === 'one');
    pushState();
  }

  function setShuffle(on) {
    shuffle = !!on;
    writeStr(MODE_KEY, repeat + ':' + (shuffle ? '1' : '0'));
    rebuildOrder();
    pushState();
  }

  /* 重建播放顺序。保持当前曲目的位置不丢 */
  function rebuildOrder() {
    var curRowId = (pos >= 0 && pos < order.length) ? rows[order[pos]].id : null;
    order = rows.map(function (_, i) { return i; });
    if (shuffle) {
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
    }
    if (curRowId !== null) {
      for (var k = 0; k < order.length; k++) {
        if (rows[order[k]].id === curRowId) { pos = k; break; }
      }
    }
  }

  function setList(list, keepCurrent) {
    var curId = (keepCurrent && pos >= 0 && pos < order.length) ? rows[order[pos]].id : null;
    rows = Array.isArray(list) ? list.slice() : [];
    order = rows.map(function (_, i) { return i; });
    if (shuffle) {
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
    }
    pos = -1;
    if (curId !== null) {
      for (var k = 0; k < order.length; k++) {
        if (rows[order[k]].id === curId) { pos = k; break; }
      }
    }
    pushState();
  }

  /* 直接跳到指定曲目（按行 id） */
  function playAt(id) {
    for (var k = 0; k < order.length; k++) {
      if (rows[order[k]].id === id) {
        pos = k;
        attachCurrent(true);
        return true;
      }
    }
    return false;
  }

  /* ---------- 初始化 ---------- */
  function init(opts) {
    opts = opts || {};
    if (ready) return true;

    audio = opts.audio || new window.Audio();
    urlFetcher = opts.fetchUrl || null;
    if (typeof urlFetcher !== 'function') {
      throw new Error('radio.init 需要一个取播放地址的函数');
    }
    audio.preload = 'metadata';
    audio.volume = volume;

    /* 偏好恢复 */
    var saved = readStr(MODE_KEY, 'all:0');
    var parts = String(saved).split(':');
    if (REPEAT_MODES.indexOf(parts[0]) >= 0) repeat = parts[0];
    shuffle = parts[1] === '1';
    volume = readNum(VOL_KEY, DEFAULT_VOLUME, 0, 1);
    audio.volume = volume;
    audio.loop = (repeat === 'one');

    audio.addEventListener('play', function () { playing = true; errText = ''; pushState(); });
    audio.addEventListener('pause', function () {
      /* pause 会在 load() 换源时触发，此时还在 loading 中，别误报"已暂停" */
      if (!loading) { playing = false; pushState(); }
    });
    audio.addEventListener('timeupdate', function () {
      curTime = audio.currentTime || 0;
      emit('timeupdate', { time: curTime, duration: duration });
    });
    audio.addEventListener('loadedmetadata', function () {
      duration = isFinite(audio.duration) ? audio.duration : 0;
      pushState();
    });
    audio.addEventListener('ended', function () {
      if (repeat === 'one') {
        try { audio.currentTime = 0; audio.play(); } catch (e) {}
        return;
      }
      var n = nextPos(repeat === 'all');
      if (n < 0) {
        /* 不循环 + 已到末尾：停下并把进度归零 */
        playing = false;
        curTime = 0;
        pushState();
        return;
      }
      pos = n;
      attachCurrent(true);
    });
    audio.addEventListener('error', function () {
      /* src 为空时的 error 是换源的正常噪声，忽略。
         v4.9.7：但"装载中 + 带具体错误码"是真故障（坏音源恰好发生在换源那一刻）——
         原来不分青红皂白地 return，把真错误也一起吞了，于是界面只剩英文兜底。 */
      if (!audio.src) return;
      if (loading && !(audio.error && audio.error.code)) return;
      /* v4.9.6：按 MediaError 码分档给**能指导下一步**的中文，而不是一句笼统的
         "文件可能缺失或已损坏"。最要紧的是 code 4 —— 实测站长第一次贴的是一条
         B 站**网页地址**，浏览器只会说 "The element has no supported sources."，
         那句话既像网络问题又像文件坏了，实际含义是"这压根不是音频文件"。
         ⚠ CSP 拦截与地址不可播会给出**同一句**浏览器文案，所以这里点名两种可能。 */
      var code = (audio.error && audio.error.code) || 0;
      errText = mediaErrText(code);
      emit('error', { message: errText, index: pos });
      pushState();
    });
    audio.addEventListener('volumechange', function () {
      volume = audio.volume;
      muted = audio.muted;
      pushState();
    });

    ready = true;
    pushState();
    return true;
  }

  /* 界面可见性变化：隐藏时降低续签频率，省电 */
  function onVisibility(fn) {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', function () {
      if (fn) fn(!document.hidden);
    });
  }

  /* 销毁：清掉续签定时器与音频源。
     ⚠ 必须有这个出口 —— 续签定时器长达 2 小时且自续，若测试或热重载
     需要释放播放器，没有它就永远挂着（Node 进程会因此不退出）。 */
  function destroy() {
    clearRenew();
    if (audio) {
      try { audio.pause(); } catch (e) {}
      try { audio.removeAttribute('src'); } catch (e) {}
      try { audio.load(); } catch (e) {}
    }
    playing = false;
    ready = false;
    listeners = {};
  }

  /* ---------- 对外 ---------- */
  window.NEONRadio = {
    init: init,
    destroy: destroy,
    setList: setList,
    load: setList,             /* 别名，语义更直白 */
    play: doPlay,
    pause: doPause,
    toggle: function () { return playing ? (doPause(), Promise.resolve(false)) : doPlay(); },
    next: function () { next(false); },
    prev: prev,
    seek: seek,
    setVolume: setVolume,
    toggleMute: toggleMute,
    setRepeat: setRepeat,
    setShuffle: setShuffle,
    playAt: playAt,
    state: snapshot,
    on: function (evt, fn) {
      if (typeof fn !== 'function') return;
      (listeners[evt] = listeners[evt] || []).push(fn);
    },
    off: function (evt, fn) {
      var fns = listeners[evt];
      if (!fns) return;
      var i = fns.indexOf(fn);
      if (i >= 0) fns.splice(i, 1);
    },
    onVisibility: onVisibility,
    fmtTime: fmtTime,
    REPEAT_MODES: REPEAT_MODES,
    _audio: function () { return audio; }   /* 仅供测试探针 */
  };
})();
