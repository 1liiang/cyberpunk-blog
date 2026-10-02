/* ============================================================
   theme-boot.js — 首绘前定主题 + 定色相（O11 暗色优先 / v3.0 B1 色相旋钮）
   ------------------------------------------------------------
   为什么必须有这么一个独立的小脚本：

     站点的默认身份是【暗色】，不依赖系统设置。未显式选择时，
     html 上不带 data-theme，:root 的兜底变量就是暗色 —— 这条路径零成本、零闪烁。

     但「用户之前手动选过亮色」这种情况，必须在**首绘之前**把
     data-theme="light" 打到 <html> 上，否则会先以暗色渲染一帧再跳亮，
     也就是那个"先暗后亮"的闪烁。

     v3.0 B1 加入色相旋钮后，同一条理由多了一个对象：
     「用户之前选过紫色」也必须在首绘前把 --hue 写到 <html> 的行内 style 上，
     否则会先以默认青色画一帧再跳紫。所以两者在同一时机、同一 try 块里完成 ——
     这也是本文件去掉了原来那句 early return 的原因（它会让色相永远写不进去）。

   ⚠ 为什么不用内联 <script>：
     CSP 的 script-src 不含 'unsafe-inline'，内联脚本会被浏览器直接拦死。
   ⚠ 为什么不用 defer 脚本（js/app.js 里那段）：
     defer 脚本要等文档解析完才执行，为时已晚 —— app.js 里的
     applyTheme() / applyHue() 是"补正"，不是"预防"，它们跑的时候首绘早发生了。
   ✅ 所以用这个【同源 + 同步 + 放在 <head> 末尾/body 之前】的外部脚本：
     它随文档解析而执行，早于 CSS 应用与首绘，又完全不碰 CSP 红线。

   本脚本刻意做得极小且零依赖：
     · 不引用任何全局（NEON / NEONViews / V() 都不存在，此刻它们还没加载）
     · 全程 try/catch —— 存储被禁用（隐私模式）时必须静默降级为暗色 + 默认色相，
       绝不能因为读不到偏好就抛错、把后面的启动流程带崩
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'neon_theme';

  /* 允许的档位：dark（默认）/ light。
     白名单写法而非"判断某个特定值" —— 这样将来再加档位只需改这一处，
     且脏数据天然落到 dark，不会把未知值透传到 data-theme 上，
     导致 CSS 里没有匹配规则、整站回落到无主题的裸样式。 */
  var ALLOWED = ['dark', 'light'];

  /* v3.4.0：色相已由「九档预设」放开为**自由滑杆**（0~359 任意整数）
     ⇒ 这里的校验从"白名单"升级为**范围校验**。
     ⚠ HUE_MIN / HUE_MAX 必须与 js/app.js 的同名常量一致：
       不一致 ⇒ 这里写进去的值会被运行时判成脏值、首绘后拉回默认色相，
       表现为"刷新一瞬是紫、随即跳回青"（最难查的那种闪色 bug）。
     为什么仍要校验：非法值会让所有 hsl() 派生色一起失效，整站配色塌掉。 */
  var HUE_KEY = 'neon_hue';
  var HUE_MIN = 0;
  var HUE_MAX = 359;

  /* v4.5.0：出厂色相 184（青）→ 285（紫）。
     ⚠ 存量迁移，判据必须与 js/app.js 的 getHue / js/views.js 的 hueReadout **三处同口径**：
          「值 = 旧默认 184  且  无显式挑选标记」 ⇒ 视为"从未选过" → 不写 --hue，
          让 CSS :root 的新默认（285）生效。
       若这里不同口径（例如无条件写回 184），会出现"首绘紫、app 补正后跳青"的闪色。
     为什么靠"显式标记"而不是一次性迁移：见 app.js 同一段注释（要让回头选青的人留住青）。 */
  var HUE_PICK_KEY = 'neon_hue_pick';
  var HUE_OLD_DEFAULT = 184;

  /* v4.0 B1：氛围模式（出厂 pollution = 光污染全开，2026-09-30 拍板）。
     data-atmo 是【层列表】（空格分隔）—— 与 js/scene.js 的 ATMO_ALL / ATMO_STATIC
     必须逐值一致：不一致 = "首绘的层"与"路由校正的层"打架，表现为丢层或闪变。
     这里写的是【全局兜底集】；路由就绪后由 scene.apply 按场景温差校正。
     之所以必须在这里也写一次：否则首绘那一帧是完全无氛围的（先裸后亮）。 */
  var ATMO_KEY = 'neon_atmo_mode';
  var ATMO_ALL = 'noise scanline grid glow bloom signs stardust pulse rain';
  var ATMO_STATIC = 'noise scanline grid glow bloom signs';

  /* ===== v5.7.0（P2）：低端设备判定 =====
     为什么要在**首绘之前**判：氛围层是"开着才付代价"的。等 atmo.js 的探针发现
     帧率不达标再降档（P1 已把窗口压到 ~2 秒）终究是"先卡一下再救"；低端机上更好的
     做法是**开局就少开几层** —— 反正那几层它本来也跑不动。
     判据（都不需要昂贵探测）：
       · 用户开了"减少动效" ⇒ 直接算低端（首绘就不该跑装饰动效）
       · deviceMemory ≤ 4GB（Chrome/Edge 有；Safari/Firefox 没有 ⇒ 缺省不判）
       · hardwareConcurrency ≤ 4 核
     ⚠ 只作"少开几层"的**初始值**，不锁死：用户仍可在装置面板里手动开回来
       （下面 neon_atmo_manual 的手动列表优先级高于这里）。 */
  function isLowEnd() {
    /* ⚠ 刻意不使用 try/catch —— 本文件里"第一处异常保护块"是主初始化块的锚点
       （39 号 R175r 按它切块），函数里再出现一个会把锚点抢走、
       让那条断言读到错误的块（实测踩到，且连注释里写出那两个词都会抢）。
       matchMedia 不存在时短路即可，无需捕获。 */
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    var mem = Number(navigator.deviceMemory);
    if (isFinite(mem) && mem > 0 && mem <= 4) return true;
    var cpu = Number(navigator.hardwareConcurrency);
    if (isFinite(cpu) && cpu > 0 && cpu <= 4) return true;
    return false;
  }

  /* 低端机开局砍掉最重的三层 —— 顺序必须与 js/atmo.js 的 DOWNGRADE_ORDER 开头一致
     （rain > stardust > signs）：那边是"运行时降档先摘谁"，这里是"开局就不开谁"，
     两处不同步就会出现"探针以为开着、其实没渲染"的错判。
     57 号用例钉着这条一致性。 */
  function lowEndAtmo(all) {
    var drop = ['rain', 'stardust', 'signs'];
    return all.split(/\s+/).filter(function (id) {
      return id && drop.indexOf(id) === -1;
    }).join(' ');
  }

  try {
    var v = window.localStorage.getItem(KEY);

    /* P2：先把设备档位写到根元素（CSS 挂在这里：低端机少付毛玻璃与重阴影）。
       写在最前面 —— 首绘第一帧就要生效，不能等 app.js。 */
    var lowEnd = isLowEnd();
    document.documentElement.setAttribute('data-tier', lowEnd ? 'low' : 'high');

    /* 显式选择过的档位：原样应用（首绘前定色，故无闪烁）；
       null（首访）/ 'auto'（已废弃存量）/ 脏数据 → 显式 dark。 */
    document.documentElement.setAttribute(
      'data-theme', ALLOWED.indexOf(v) !== -1 ? v : 'dark');

    /* 色相：与主题同一时机写入。范围外的值一律不写 ——
       写进非法 --hue 会让所有 hsl() 派生色一起失效，整站配色塌掉。
       v4.5.0：旧默认值（184）且用户从未显式选过 → 也**不写**，
       交给 CSS :root 的新默认（285）—— 这就是存量用户的迁移路径。 */
    var h = parseInt(window.localStorage.getItem(HUE_KEY), 10);
    var huePicked = false;
    try { huePicked = window.localStorage.getItem(HUE_PICK_KEY) === '1'; } catch (e4) { /* 忽略 */ }
    if (isFinite(h) && h >= HUE_MIN && h <= HUE_MAX && !(h === HUE_OLD_DEFAULT && !huePicked)) {
      document.documentElement.style.setProperty('--hue', String(h));
    }

    /* 氛围：手动层列表（装置面板）优先；否则 silent → 空列表 / standard → 静态层 /
       其余（含首访）→ pollution 全开。脏数据一律回落 pollution —— 与 scene.js 同一口径。 */
    var atmo = null;
    try {
      var mArr = JSON.parse(window.localStorage.getItem('neon_atmo_manual'));
      if (Object.prototype.toString.call(mArr) === '[object Array]') {
        var safe = mArr.filter(function (x) { return typeof x === 'string'; });
        if (safe.length) atmo = safe.join(' ');
      }
    } catch (e3) { /* 无手动列表 / 脏数据 —— 回落自动 */ }
    if (atmo === null) {
      var m = window.localStorage.getItem(ATMO_KEY);
      atmo = (m === 'silent') ? '' : (m === 'standard' ? ATMO_STATIC : ATMO_ALL);
      /* P2：只有走"自动"这条路时才按设备降级 —— 用户手动选过就尊重用户。 */
      if (lowEnd && atmo) atmo = lowEndAtmo(atmo);
    }
    document.documentElement.setAttribute('data-atmo', atmo);

    /* v4.1 B2：开场序列的首访标记（在首绘前打 class，防"先闪一帧内容再盖开机屏"）。
       条件：本会话未看过 + 落在首页 —— 开机仪式属于"门廊"（首页），
       深链直接进内页时不打断。boot.js 播放结束时清标记并写 sessionStorage。 */
    if (!window.sessionStorage.getItem('neon_boot_seen')) {
      var $hash = location.hash;
      if (!$hash || $hash === '#' || $hash === '#/') {
        document.documentElement.classList.add('boot-first');
      }
    }
  } catch (e) {
    /* 隐私模式 / 禁用存储：静默降级。刻意不 console.error，
       这属于预期内的降级，不是故障，不该污染控制台。
       降级时：data-theme 不打属性 —— :root 的暗色兜底仍然生效，
       视觉结果与显式 dark 一致；--hue 保持 CSS 里的默认值（现为 285 = 紫），
       与"用户显式选了紫"完全同观感。 */
  }
})();
