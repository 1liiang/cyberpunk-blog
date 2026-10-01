/* ============================================================
   scene.js — 场景框架（v4.0 B1「地基重铸」）
   ------------------------------------------------------------
   每个路由 = 一个「场景」。本文件是路由（app.js）与视觉（style.css）
   之间的一层中介：告诉 CSS"现在在哪个场景"、告诉氛围运行时"这个场景
   该亮哪些层"。

   为什么单独成文件：
     · "某页该有哪些氛围"这种配置若散落在路由函数与 CSS 里，两处都会慢慢
       腐化；集中成注册表后，改场景温差只动这一处。
     · theme-boot.js 负责【首绘前】写全局模式对应的层集（防闪烁）；
       本文件负责【路由切换时】按场景温差校正 —— 两者职责分明。

   状态消费（两个真实消费点，都是活的）：
     1. body[data-scene="archive"]  → CSS 场景级样式
     2. html[data-atmo="noise glow …"] → 氛围层开关（style.css 的逐层规则）

   ⚠ 三个一致性契约（改动时必须同步）：
     · ATMO_ALL / ATMO_STATIC 与 js/theme-boot.js 的同名常量逐值一致
     · 模式存储键 neon_atmo_mode 与 theme-boot.js / 装置面板（B4）一致
     · 场景名集合与 app.js parseHash() 的路由名集合一致（多出的路由名
       会落到 "lost" 场景 —— 这是有意的兜底，不是遗漏）
   ============================================================ */
(function () {
  'use strict';

  /* 9 层全集：材质 3（noise/scanline/grid）+ 光 6（glow/bloom/signs/stardust/pulse/rain） */
  var ATMO_ALL = ['noise', 'scanline', 'grid', 'glow', 'bloom', 'signs', 'stardust', 'pulse', 'rain'];
  /* 「标准」档的集合：材质 + 静态光（无动画层） */
  var ATMO_STATIC = ['noise', 'scanline', 'grid', 'glow', 'bloom', 'signs'];

  /* 场景注册表：场景名 → { atmo: 该场景允许的层集 }。
     出厂「光污染」模式下全开集合按这里过滤 ⇒ 场景温差。
     塔台（首页）最满；阅读舱 / 装配间为「专注档」（静态光 + 噪点，
     无动画层）—— 正文可读性是红线；B4 装置面板会给手动拉满的开关。 */
  var SCENES = {
    tower:    { atmo: ATMO_ALL },
    archive:  { atmo: ['noise', 'scanline', 'grid', 'glow', 'bloom'] },
    bands:    { atmo: ['noise', 'grid', 'glow', 'bloom', 'stardust'] },
    scanner:  { atmo: ['noise', 'scanline', 'glow', 'bloom', 'pulse'] },
    stash:    { atmo: ['noise', 'glow', 'bloom', 'stardust'] },
    idcard:   { atmo: ['noise', 'glow', 'bloom', 'signs'] },
    reading:  { atmo: ['noise', 'glow'] },
    console:  { atmo: ['noise', 'scanline', 'grid', 'glow', 'bloom', 'pulse'] },
    gate:     { atmo: ['noise', 'glow', 'pulse'] },
    workshop: { atmo: ['noise', 'glow'] },
    lost:     { atmo: ['noise', 'scanline', 'glow'] }
  };

  /* 路由名（app.js parseHash 的 r.name）→ 场景名。
     tagadmin 并入 console（同一族的管理工具）；未列出的路由名 → lost。 */
  var ROUTE_MAP = {
    home: 'tower', archive: 'archive', tags: 'bands', search: 'scanner',
    marks: 'stash', about: 'idcard', post: 'reading', admin: 'console',
    tagadmin: 'console', login: 'gate', edit: 'workshop'
  };

  var MODE_KEY = 'neon_atmo_mode';
  /* v4.3 B4：手动层列表（装置面板的九层开关）—— JSON 数组字符串。
     存在且非空时压过"模式 × 场景"的自动温差；"恢复场景自动"即删除本键。 */
  var MANUAL_KEY = 'neon_atmo_manual';

  /* 读全局氛围模式（与 theme-boot.js 同一个键）。
     出厂 = pollution（光污染，2026-09-30 拍板）；脏数据一律回落 pollution。 */
  function readMode() {
    try {
      var m = window.localStorage.getItem(MODE_KEY);
      return (m === 'standard' || m === 'silent') ? m : 'pollution';
    } catch (e) { return 'pollution'; }
  }

  /* 读手动层列表：非法项过滤、空列表视为无手动（回落自动） */
  function readManual() {
    try {
      var arr = JSON.parse(window.localStorage.getItem(MANUAL_KEY));
      if (Object.prototype.toString.call(arr) !== '[object Array]') return null;
      var list = arr.filter(function (id) { return ATMO_ALL.indexOf(id) !== -1; });
      return list.length ? list : null;
    } catch (e) { return null; }
  }

  /* 纯函数：场景 + 模式 → 应开的层集。
     pollution：按场景集全开（场景温差）；standard：只留静态层；
     silent：全关。 */
  function layersFor(scene, mode) {
    var def = SCENES[scene] || SCENES.lost;
    if (mode === 'silent') return [];
    if (mode === 'standard') {
      return def.atmo.filter(function (id) { return ATMO_STATIC.indexOf(id) !== -1; });
    }
    return def.atmo.slice();
  }

  /* v5.7.0（P2）：低端设备开局少开最重的三层。
     ⚠ 顺序必须与 atmo.js 的 DOWNGRADE_ORDER 开头一致（rain > stardust > signs）：
       theme-boot.js 首绘前砍谁、atmo 运行时先摘谁，必须是同一批，
       否则会出现"探针以为开着、其实没渲染"的错判。57 号用例钉着这条。
     ⚠ 只在**自动**模式下生效 —— 用户手动勾选的层集不降级。 */
  var LOW_END_DROP = ['rain', 'stardust', 'signs'];
  function lowEndTier() {
    try {
      if (document.documentElement.getAttribute('data-tier') === 'low') return true;
      /* theme-boot.js 若因异常没跑到，这里补判一次（两个脚本可能各自被缓存击穿） */
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
      var mem = Number(navigator.deviceMemory);
      if (isFinite(mem) && mem > 0 && mem <= 4) return true;
      var cpu = Number(navigator.hardwareConcurrency);
      if (isFinite(cpu) && cpu > 0 && cpu <= 4) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }
  function trimForTier(list) {
    if (!lowEndTier()) return list;
    return list.filter(function (id) { return LOW_END_DROP.indexOf(id) === -1; });
  }

  /* 该场景应生效的层集：手动列表优先；否则「模式 × 场景」的自动温差 */
  function effectiveLayers(scene) {
    var manual = readManual();
    if (manual) return manual;                 /* 手动：尊重用户，不降级 */
    return trimForTier(layersFor(scene, readMode()));
  }

  /* 把层集写进 DOM 并通知氛围运行时（惰性取用 + 降级 ——
     atmo.js 缺失时属性照写，只是没有 rain/探针，渲染不受影响）。 */
  function applyLayers(scene) {
    document.documentElement.setAttribute('data-atmo', effectiveLayers(scene).join(' '));
    try {
      var A = window.NEONAtmo;
      if (A && typeof A.sync === 'function') A.sync();
    } catch (e) { /* 氛围运行时异常不拖累路由 */ }
  }

  /* 应用路由场景：写 body[data-scene] + 按场景/模式/手动三层优先级算层集 */
  function apply(routeName) {
    var scene = ROUTE_MAP[routeName] || 'lost';
    document.body.setAttribute('data-scene', scene);
    applyLayers(scene);
    return scene;
  }

  /* v4.3 B4：不改路由、按当前场景重算层集 ——
     装置面板与命令终端改完氛围设置后调用（存储已经写好，这里只负责落地）。 */
  function reapply() {
    var scene = document.body.getAttribute('data-scene') || 'lost';
    applyLayers(scene);
    return scene;
  }

  window.NEONScene = {
    SCENES: SCENES,
    ROUTE_MAP: ROUTE_MAP,
    ATMO_ALL: ATMO_ALL,
    ATMO_STATIC: ATMO_STATIC,
    MODE_KEY: MODE_KEY,
    MANUAL_KEY: MANUAL_KEY,
    readMode: readMode,
    readManual: readManual,
    layersFor: layersFor,
    effectiveLayers: effectiveLayers,
    apply: apply,
    reapply: reapply
  };
})();
