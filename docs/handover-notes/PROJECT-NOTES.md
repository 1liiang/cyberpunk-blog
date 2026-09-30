# 项目细节笔记（NEON://DIARY）

> `.workbuddy/memory/MEMORY.md` 的配套参考 —— 偏「需要时查」的细节。
> MEMORY.md 每次会话都注入（有长度上限），故只留索引与判据；**深度说明放这里，按需读**。
> 测试/源码提取/CSS/jsdom/工具链/浏览器细节另见 **`TESTING-NOTES.md`**。

## 一、电台模块（RADIO）全貌

- **入口**：左上角常驻迷你条（dock）→ 点击展开面板。**仅页面端，无移动适配（用户明确要求，别加回来）**。
- **权限**：所有人（含匿名）可听；仅作者（登录）可管理。
- **内核** `js/radio.js`：纯逻辑零 DOM 单例 `window.NEONRadio`；每推进一次进度 `emit('timeupdate',{time,duration})`。
  **取址契约：`fetchUrl(row)` 返回字符串（永久）或 `{url,ttl}`（ttl>0 才挂续签）**。
- **数据** `js/cloud.js` → `Radio`：`AUDIO_MAX=24MB`、`AUDIO_DATA_MAX=36000000`、MIME 白名单、LRU 双限缓存。
  **读走视图 `public_radio`；列表绝不带 `data`；播放按 id 单行取**。
- **界面** `js/views.js`：`radioDockView/radioPanelView/R_ICON`；动作统一 `data-radio-act`；`has_data===false` 的行禁用播放并提示；
  播放中两个时间格靠钩子定位：`[data-radio-time]`（当前）/ `[data-radio-dur]`（总长）。
- **接线** `js/app.js`：`RadioUI` + `paintDock/paintPanel/paintPanelProgress/open/closeRadioPanel/loadRadioTracks/radioQueue/bindRadio*/handleRadioAction/initRadio`；
  `radioQueue()` **按身份过滤**，`onAuthStateChange` 里重取。
- **样式/挂载**：`--topbar-h: 65px`（实测）；`.radio-dock`(fixed/left16/top `--topbar-h+14`/z60)、`.radio-panel`(z70)；
  `#radio-dock` 挂 **#app 之外**（路由重写不打断播放），`radio.js` 在 `app.js` **之前**加载。

### 1.1 音频为什么不能放云存储（v2.9.0 的根本原因）

**云存储只服务登录用户**。文档原文：「**Storage is for signed-in users. Public Bucket/public URL access is not exposed.**」
⇒ 匿名访客调 `createSignedUrl` 直接 `MISSING_CREDENTIALS`，与「所有人可听」**互斥、无解**。
⇒ 改为 **base64 存数据库**（图片一直如此，所以封面自古能匿名显示 —— 这就是分叉点）。
代价：base64 大 33%，**整首一次性传输**（非流式、无 Range）。故三条不可破：

1. **`list()` 绝不带 `data`** —— 否则「打开面板」=「下载整个曲库」。
2. 播放按 id **单行取** + **双限** LRU（条数 2 / 字符 40M）—— 单首最坏 33.5M 字符，只限条数会爆。
3. 文案里的 MB 数从 `NEON.AUDIO_MAX` 读，**别在视图里写死**。

**实测（curl 打 `/.cloud/database/rest/...`）**：匿名读 `public_radio` → 200 ✓；32MB 写 → 201/5.2s ✓；32MB 读回 → 200/1.44s（~22MB/s）✓。

**库侧**：表 `radio_tracks`（`data` text、`storage_path` 可空、`owner_id` **text**）
+ 视图 `public_radio`（含 `has_data`/`data`，**不含 owner_id/storage_path**）+ 4 道 RLS + GRANT SELECT 给 anon。
CHECK：`data ≤ 36000000`、`mime ≤ 120`、`title/artist/album ≤ 200`、`cover_url ≤ 2000`。

### 1.2 音频能播还有一道 CSP 前提（v2.9.1 —— 差点带着它上线）

**没有 `media-src` 会回落到 `default-src 'self'`** ⇒ `<audio src="data:…">` 被**静默拦下**，
元素只报 `code 4 / MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check` ——
**看起来像「文件损坏」，实际是策略没放行**（Blink 里就是 `HTMLMediaElement::LoadResource` → `AllowMediaFromSource`）。
必须 `media-src 'self' data: blob:`：**`data:`** 给曲目播放地址；**`blob:`** 给 `probeDuration` 的 `createObjectURL`。
（图片自古能显示，正是因为 `img-src` 挂了 `data:`；音频少了对应的那条。）
**教训：同一份"能匿名显示"的能力，换到另一种资源类型（img→media）就必须重新在 CSP 里显式放行。**
该约束的断言放在 `tests/cases/13-m-csp.js`（R35b），电台 case 里只留路标，避免同一正则两处写死。

### 1.3 读视图 / 写基表：字段清单绝不能混用（v2.9.2 事故）

`has_data` 是视图 `public_radio` 里**算出来**的列（`data IS NOT NULL`），**基表 `radio_tracks` 没有它**。
写路径若图省事复用 `RADIO_FIELDS`，PostgREST 会生成 `INSERT … RETURNING …, has_data` ⇒
**42703「column radio_tracks.has_data does not exist」→ 上传直接失败**；
而列表读取一切正常 —— 症状极具误导性（用户迎面看到的是一句裸的 SQL 报错）。
**做法**：`RADIO_VIEW_ONLY` 显式登记视图专有列，`RADIO_WRITE_FIELDS = RADIO_FIELDS − RADIO_VIEW_ONLY`
（**推导**而非手抄，后人再加算出来的列就不会漏）；入库返回行补 `has_data = true` 与列表行同形。
**通用教训：视图/基表一旦分家，读清单与写清单必须是两个常量，且写清单要由读清单推导出来。**

### 1.4 三条硬约束（都踩过）

1. **面板渲染绝不 `await` 网络** —— 先同步出骨架（`listLoading` → 「调频中」）再后台补数据（原实现网络慢时点了没反应）。
2. **dock 与面板同在左上角 ⇒ 必须互斥显示**（panel z70 > dock z60，同位置完全重叠）。
3. **fixed 浮层压住正文** → `body.has-radio .wrap { padding-top: 84px }`，class 由「电台可用」驱动，
   **不能**用 `dock.hidden`（否则开合时正文跳 84px）。

### 1.5 进度显示的订阅链（v2.9.3 修复）

内核**会** `emit('timeupdate',{time,duration})`，但 UI 侧原本**从没订阅它** ——
`paintPanelProgress` 只在**离散**的 `statechange`（播放/暂停/载入/切歌）里被捎带调一次，播放中不触发 statechange
⇒ 整首歌里进度不动；总时长更只在整面板重绘时渲染一次 ⇒ 切歌后长期停在**上一首**的值（实测：播 2:31 的曲子，标签显示 5:03）。
修复：`R.on('timeupdate', function (t) { paintPanelProgress(t); });`
+ `paintPanelProgress` 内**当场取** `[data-radio-dur]` 并回写 `fmtTime(st.duration || 0)` + `views.js` 加钩子。
⚠ 顺序坑（非 bug）：`statechange` 里「先 `paintDock`（刷进度）→ 再 `paintPanel`（整绘）」会重置进度，
切歌瞬间要等下一次 `timeupdate`（~0.25s）纠正。

## 二、发布与验证

- 根目录 `C:/Users/liu/WorkBuddy/2026-09-28-00-18-42`，`entryHtml: cyberpunk-blog/index.html`，
  `domainPrefix: cyberpunk-blog`，复用同一 applicationId 保住云服务 Origin 绑定。
  - ⚠ **必须显式传 `"language": "static"`**（否则报 `ENOENT: /workspace/package.json`）。
  - 发布前 `npm run build` 必须全绿（= 门禁 + `tools/gen-feed.js`，RSS 是构建期产物）。
    **bump 后又改代码：不动版本号，跑 `node tools/bump.js --refresh-id --yes`。**
  - 发布需用户**当轮**明确授权，配 `userAskedToPublish: true`（**不得沿用上一轮**）。
- **⚠ 根域名 `/` 是早期遗留旧快照**（停在 2.3.0，平台不会清理）。
  **正确分享地址永远是 `https://cyberpunk-blog.app.workbuddy.host/cyberpunk-blog/`**。
  **deploy 返回的 `shareLink` 就是根域名 `/`** —— 别原样转给用户，要手工拼上 `/cyberpunk-blog/`。
  用户报「还是旧版本」→ **先问他打开的是哪个地址**，别怀疑发布失败。
- **缓存分层**：浏览器 → L1 → L2 父缓存（TTL>50min）→ 源站。plain URL 旧、`?cb=1` 新 = L2 滞留，不是发布失败。急看新版用 `?diag=1`。
- **线上验证铁律**：绝不用 `curl -I`（HEAD/GET 分开缓存）→ **必须 GET**；v2.0.2 起带 gzip → **必须 `curl -s --compressed`**。
- **⚠ `verified:true` ≠ 内容已传播**：deploy 后必须核内容（grep `?v=` / BUILD_ID）。
  `Eo-Cache-Status: MISS` 但 `Last-Modified` 仍是旧文件的 mtime ⇒ 源站就是旧的，cache-buster 也救不了；
  处置：多次重发 + 累计等待（实测 3 次重发 + 8min 无效）→ 稍后重试或让用户在「设置—数据管理—应用」手动触发；
  **勿 unpublish 自救**（破坏性，需用户授权）。探测偶发失败要重试（边缘抖动，`size_download=0B` / `curl:(18)`）。
- **⚠ 直连数据 API**：`https://<域名>/.cloud/database/rest/<表或视图>?select=...`（**没有 `/v1`**），
  头 `x-wb-webapp-access-key: <publishableKey>`；缺头 → `401 invalid_client`。
  这是唯一能**脱离浏览器验证「匿名读写」**的手段。

### 2.1 ⚠⚠ 缓存滞留事故（v2.6.1 / v2.7）

「伪更新」保持版本号 ⇒ `?v=` 缓存键不变 ⇒ 老用户复用旧 `views.js`（缺 `marksView`）⇒ `V().xxx` undefined ⇒ TypeError。
**第二层真 bug**：`renderMarks()/renderTagAdmin()` 是 **async**，rejection 走 Promise，`safeRoute()` 的**同步 try 抓不到** ⇒ 永久停在占位态、无提示。
修复：① `safeRoute()` 补 `if (ret && typeof ret.then === 'function') ret.catch(...)`；② `V()` 用 `REQUIRED_VIEW_FNS` + `viewsUsable()`，缺任一即切 `buildViewFallback()`。

三条通用教训：**动过 `js/` 或 `css/` 就必须 bump 版本号**（`--refresh-id` 只改 BUILD_ID，不参与任何 URL，对缓存零作用）；
**async 的 rejection 逃过同步 try**（`try{fn()}catch` 若 `fn` 可能是 async 必须补 `.catch()`）；
**模块可用性必须用「必需函数清单」判定**。

## 三、版本与主题

- **版本单一数据源** `js/version.js` → `NEONVersion = { BUILD, BUILT_AT, BUILD_ID, LOG[] }`。
  `node tools/bump.js x.y.z --title="..." --item="..." --yes` 改四处：BUILD + LOG unshift + index.html 全部 `?v=` + package.json；
  `tools/check-version.js` 校验一致性（**在 tools/ 不在 tests/**）。`--refresh-id` 只刷 BUILD_ID；`--renumber --published=x.y.z` 给未发布号改号。
  **bump.js 安全设计别削弱**：版本必须递增；非交互未传 `--yes` 拒绝写盘；非 `x.y.z` 拒绝。
  ⚠ **`--item` 里写直双引号会被 shell 吃掉** → 用「」。
- **主题「暗色优先」，v2.7 起三档**：默认暗色不依赖系统设置；`html[data-theme="light"]` / `"warm"`。**已彻底移除 `@media (prefers-color-scheme: light)`，别加回来**。
  零闪烁靠 `js/theme-boot.js`：同源、同步、放 `<head>` 样式表**之前**（三禁：改内联 / 加 defer,async / 挪位）。`ALLOWED = ['dark','light','warm']` 白名单。
  **⚠ 新档变量表必须与既有档「结构 100% 对齐」** —— CSS 变量不继承另一档的值，漏写会**回落 `:root` 暗色值**（一片黑）。
- reduce 块**必须留在 CSS 文件末尾**（`@media` 不加特异性，靠文件顺序生效）；
  ⚠ **`@media print` 不在末尾**，提取它**必须按花括号配平** → 见 `TESTING-NOTES.md` §三。

## 四、架构与数据

- **云服务**：DB/存储/认证共用一个环境（`resourceId: wbcs_asyuRz8PhuNwUVq3nDDomM`）。
- **表**：`posts`、`post_images`（基表仅本人可读）、`public_images`（读取视图）、`error_logs`（只授 INSERT + 本人 SELECT）、`radio_tracks` + `public_radio`。
  A3 收口：读走视图（无 `owner_id`/`storage_path`）+ `safeMime()` 白名单；**例外**：封面选择器按 `owner_id` 过滤仍走基表（有意）。
  查表结构用 `information_schema.columns`（PostgREST 直查 `column_name` 报 42703）。
- **⚠ RLS 两道独立门**：先 `GRANT` 到 `authenticated/anon`，再 `CREATE POLICY`；漏 GRANT 得 42501。
  **`auth.uid()` 返回 text** ⇒ `owner_id` 必须 **text** 而非 uuid，否则 42883。
  ⚠ `CREATE OR REPLACE VIEW` **不能改列名/列序/插列** → 加列只能 `DROP VIEW` → `CREATE VIEW` → 补 GRANT。
- **Markdown 协议**：`cloudimg://<id>` 图片、`cloudfile://<path>` 附件。
- **图片标准（v2.2.1，单一来源 `cloud.js`）**：封面盒 `.card-cover` = **1046×190**；
  `IMAGE_MAX_DIM=2160`（2x 屏）/ `THUMB_MAX_DIM=1280`（1x 不放大）/ `DATA_MAX_BYTES=3400000` / `THUMB_MAX_BYTES=380000`。
  `encodeWithinBytes` 阶梯：降质量（仅 JPEG/WebP）→ 缩尺寸 → 转 JPEG，每档真编码再量长度。**thumb 的 MIME 跟主图 `content_type` 走**。
  存量图回填：id=2/6/7 的 256px thumb 已置 NULL（备份在库表 `_bak_thumb_221`）。
- **⚠ 库读写大 base64 的通道铁律**：`exec_sql` 的**参数和结果都过 LLM 对话** ——
  大字段（>100K 字符）读写都会爆上下文；PostgREST（`/.cloud/database/rest/v1/`）publishableKey=anon 无 GRANT（42501）、
  IDE tempToken 不被 Web 网关认（invalid_client）；云存储无公开 URL。
  → 大字段回填只能靠「应用自身流程」（用户重传）；小 SQL（置 NULL 等元数据操作）走 exec_sql 没问题。
  ✅ **造大字段做体积测试用 SQL 端生成**（如 `repeat('A', 33554432)`），不经过对话。
- 跨文件全局（NEON / NEONViews）一律惰性取用 + 降级实现（`NEON()`/`need()`/`errMsg()`/`V()`），**catch 分支绝不裸引用外部全局**。

## 五、安全基线

- 外域脚本锁**精确版本 + SRI**，禁浮动范围与漂移标签；CDN 依赖禁 `@dev/@latest`（云 SDK 本地托管 `js/vendor/`）。
- 库字段必须带长度上限（v1.6.0 落 6 条 CHECK：title≤200 / summary≤500 / content≤200000 / tags≤10 / data≤3600000 / thumb≤400000）。
  **阈值按真实数据最坏情况留余量；改客户端上限必须同步库 CHECK**。
- **CSP（index.html meta 版，9 条）**：`script-src` 无 `'unsafe-inline'` → **严禁内联 `<script>` 与 `onclick=`**；新增外域须同步加白名单。
  **注释里写被禁写法的字面形式也会被源码扫描断言判红**。
- 错误信息对外脱敏，原始错误只进 console。

## ⚠ 发布时 `directory` 必须传**父目录**（2026-09-29 v2.9.4 踩坑，会改变线上入口）

**正确参数**（与历史发布一致）：

```
directory  = C:/Users/liu/WorkBuddy/2026-09-28-00-18-42      ← 父目录
entryHtml  = cyberpunk-blog/index.html                        ← 相对父目录
language   = static
```

判据：**应用登记文件 `.wbapp_pQJvN8eWX3KFQyE3DVhDDj.genie` 在父目录里**。
父目录只有 `.workbuddy/` + `cyberpunk-blog/` + 那个 `.genie` —— 它才是应用目录。

**传错的后果**（实测）：把 `directory` 传成 `C:/.../cyberpunk-blog`（子目录）+
`entryHtml=cyberpunk-blog/index.html`（相对子目录**不存在** ⇒ 回退到目录根的 index.html）
⇒ 内容被映射到 **URL 根 `/`**，而 `/cyberpunk-blog/` 仍是一份旧快照。
表现：根变成 2.9.4、`/cyberpunk-blog/` 停在 2.9.3 —— 正是笔记里一直在防的那个坑，
只不过这次反过来了。

**补救**：用父目录重发一次即可（sandboxId 不变，还是同一个应用），
`/cyberpunk-blog/` 随即更新。

**验收时的读数陷阱**：刚发完立刻 curl，`/cyberpunk-blog/` 的 HTML 仍会显示旧 `?v=`（边缘缓存），
**但同路径的 js/version.js 已经是新的**（HTML 被缓存、JS 没有）。
⇒ 别据此判断"发布失败"。带 cache-buster 复检：
`curl -s --compressed ".../cyberpunk-blog/index.html?cb=$(date +%s)"`，
并与本地 `md5sum` 逐字节比对。实测等约 12 秒后 index.html 也就位了。

## 3.0 改版方案（待用户拍板，2026-09-29）

方案全文：`docs/archive/3.0-改版方案.md`。四维度结论速查：
- **页型**：混合型（首页 bento 半仪表盘 / 详情专注阅读 / 管理台仪表盘 / 其余轻列表）；侧栏**按页型授予**，非全站统一件
- **骨架**：单一滚动容器（body）；只 sticky 页头（`--topbar-h` = 64px）与辅助栏；**禁内部滚动、禁 fixed 侧栏**；移动端不渲染侧栏
- **栅格**：容器三档 `--w-read 760 / --w-page 1000 / --w-wide 1240`；断点收敛 5→4（**1280 / 1024 / 768 / 480**）
- **间距**：4px 基准九级 `--s1..--s9`；现状 12 种 gap 散值按 §6.1 映射表归位
- **落地**：P0 地基（视觉≈不变）→ P1 骨架 → P2 仪表盘化；每阶段独立版本可回滚
- **兼容策略（关键）**：新骨架一律**新增类名**（`.bento` / `.reading` / `.console`），旧类名（`.wrap` / `.page-head` / `.post-card`）保留为别名 —— 861 条断言大面积绑定旧选择器，重命名会引发批量红
- sticky 侧栏配方：`sticky` + `top: calc(var(--topbar-h) + 24px)` + `align-self: flex-start` + `max-height: calc(100vh - var(--topbar-h) - 48px)` + `overflow-y: auto`
- 待用户拍板**五项**（第 2 版起）：bento 模块取舍、TOC 位置、管理台导航形态、**首屏 Hero 是否要**、**中文衬线是否引入**

### 第 2 版补充（2026-09-29，并入用户指定参考 taozhiyy.top / GitHub `bistutzyy/taozhiyy`）
- **借**：章节编号系统（MODULE 01 / SIGNAL № 041 / FRAGMENT / TIER）、首屏 Hero + 滚动引导、多墨色分区、中文衬线第三字体角色、柔和圆角 ↔ 硬边切角**分工**、单字母强调排版、状态面板前置、移动优先断点写法、组件级 layout 测试
- **实测参数**：断点移动优先（768 主轴，31 次）；三套字体角色（sans / mono / 中文衬线书法）；圆角柔和为主（999px 胶囊 30 处、50% 圆 18 处）；`--moment-ink` 有 8 组墨色；仓库为 monorepo（main React+Vite+Tailwind+GSAP / build 建站日志 / blog Hexo+Butterfly / acg-api Go 后端 / shared 浮动 AI 助手）
- **不借**：GSAP（改用原生 `animation-timeline: view()` + 降级）、Tailwind/React/Vite、Go 后端与 AI 助手（超出布局范围，另开议题）
- **核心设计判断**：`--r-soft: 14px` 与 `--clip-corner: 14px` **取同值**（同尺度两性格：切角=系统、圆角=人）；墨色由 `color-mix(in srgb, var(--cyan) 12%, var(--bg-1))` 派生、不计入霓虹 15% 红线；衬线零依赖只用系统栈
- §7 已重构为 7.1~7.5（红线 / bento≤8 / **7.3 双层视觉语言** / 7.4 编号系统 / 7.5 单字母强调）；§8 的 P1 拆为 P1a 首屏 / P1b 网格 / P1c 辅助栏

### 第 3 版（2026-09-29，并入 sigrika.cc = Fuwari 系；三方融合 + 模块化 + **配色放开**）
> ⚠ 章节号已变：**§3 配色体系重构**、§4~§8 四维度、**§9 模块级实施清单**、§10 模块批次 B1~B4、§12 待拍板 8 项。
- **sigrika 四条关键实现**：① **单变量配色 `--hue`（0~360，localStorage，首绘前写入）** ② **双 TOC**（侧栏 TOC + `min-[1600px]` 浮动 TOC：外层 absolute + 内层 `fixed top-14`）③ **错峰入场**（navbar 0 / sidebar 50 / content `--content-delay` / footer 150ms）④ **Banner 系统**（`--banner-height(-home)`，按 innerHeight 算并**取 4 的倍数**保清晰）
- 其他：侧栏 17.5rem=280px；`#heatmap-grid`/`#calendar-grid`/`#music-nav-panel`；类名 `card-base`/`btn-plain`/`btn-regular`/`card-shadow`/`float-panel`；侧栏件可折叠；背景层 `#bg-box`
- **配色新体系（核心）**：**三层色彩 + 单个 `--hue` 旋钮** —— chrome 层随 hue 派生（`--primary`/`--primary-line`/`--primary-glow`/`--bg-1`）；content 层墨色盘 `--ink-1..5` 用 `calc(var(--hue) + N)` 色相偏移派生；**semantic 层固定不旋转**（品红/绿/黄）。闸门：**用户能调气质，不能调语义**
- 3 套主题 → **明度 3 × 色相 9**（青 187 默认 / 蓝 217 / 靛 250 / 紫 285 / 品红 330 / 桃 350 / 橙 25 / 琥珀 38 / 苔绿 145）；主题罗盘扩为二维（12 个 radio，无障碍契约与 33 条断言原地复用）；`--hue` 仍由 `theme-boot.js` 首绘前写入
- **红线修订**："霓虹 ≤ 15% 表面积" → 「**每屏只有一个实色霓虹焦点**，其余彩色走低饱和 chrome 派生」
- **模块批次**：B1 地基（tokens + 二维罗盘 → 3.0.0）→ B2 首页（Hero + 六模块 + 错峰入场 → 3.1.0）→ B3 阅读与列表（筛选条 + 编号化 + 双 TOC + 页脚 → 3.2.0）→ B4 管理台与侧栏件（→ 3.3.0）
- **不借**：Swup、看板娘 `PioMessageBox`、樱花 `SakuraEffect`、Tailwind/Astro/Svelte、CDN webfont（手写体默认不做）

### 3.0 B1 已实施（v3.0.0，2026-09-29）
> 代码已落地（868/868 全绿、反向验证 10/10、真机验收通过）。**B2 起开工前先读本节。**
- **配色旋钮**：`--hue`（默认 184 = 原青）+ `--hue-s/--hue-l/--vio-off/--vio-s/--vio-l` 派生参数；
  `--primary: hsl(var(--hue) …)`；**旧名保留别名**（`--cyan: var(--primary)`，line/glow/grid/head-glow 全改 hsl 派生）
  ⇒ 全站 800+ 处引用一行未改却随色相变色。**语义色（magenta/yellow/green/red）不旋转**。
  三档只覆盖参数：dark s100/l50、light s100/l24、warm s80/l25
  - ⚠ **light 的 24% 不能随手改**：原 #007a91 色相是 189，统一到 184 后同明度偏亮，收 4 点才与原观感 + WCAG 对比度持平（O9 真算 cyan 6.4 / violet 8.5）
- **二维罗盘**：`.theme-menu[role=group]` > 两个 `.theme-block` > `.theme-row[role=radiogroup]`（明度 3 + 色相 9）；
  色相色卡 `.theme-hue[data-hue-val=N] { --sw: N }` 九条单行规则；方向键按 `closest('[role=radiogroup]')` 组内隔离；
  **色相切换不关面板**（试色连续），明度切换关面板
- **theme-boot.js**：主题与色相同一 try 块写入（**原 early return 已删——它会让色相永远写不进去**）；
  `HUES` 与 app.js `HUE_STOPS` **必须逐值一致**（不一致 = "刷新瞬间变色随即跳回"）
- **tokens**：`--s1..--s9` / `--w-read 760`·`--w-page 1000`·`--w-wide 1240` / `--banner-h(-home)` /
  `--r-soft 14px`（**与 --clip-corner 同值**，勿单改一个）/ `--font-serif-cn`（系统栈）
- **测试**：新增 39 号（19 条，B1 地基）；36 号 33→40；20 号新增**派生色求解**（`toneRgb`：先字面值后退派生式）；
  基线 **868/868**（功能回归 824 + 故障注入 26 + 行为沙箱 18）
- ⚠ 改动配色时**必须同时跑** `tests/cases/39-*.js` 与 `tests/cases/20-o9-色标.js`（后者真算 WCAG 对比度）

### 3.0 B2 已实施（v3.1.0，2026-09-29）
> 首页已重做为 Hero + bento。**B3 起开工前先读本节。**
- **页型分流**：`homeView` 里 `if (!state.tagName)` → Hero + bento；**标签页保持连续列表**
  （`#/tag/x` 是"找东西"，不是"逛站台"）—— 少了这个 if，标签页会被一起 bento 化
- **Hero**：`min-height: min(calc(100vh - var(--topbar-h)), 720px)`（实测 501px @566 视口）；
  内部**复用 `.page-head`**（全站页头装饰 + 既有判据的挂载点，摘掉会同时丢装饰与判据）；
  品牌字标单字母强调 `.hl`（整屏一处）；滚动引导**绝不做 `#` 锚点**
  （hash 路由下 `#bento` 会被 parseHash 当路由 → 404 视图）
- **bento 12 列六模块**：01 精选 `span-12`（且**不套 `.post-list`** —— 保持唯一）、02 信号流 `span-8`、
  03 站台状态 / 04 标签频段 / 05 归档节奏 / 06 身份卡 各 `span-4`；容器 `--r-soft` 圆角（人味层），
  模块编号 `.bento-no` 走 `--clip-corner-sm`（系统层）
- **墨色盘** `--ink-1..6`：`hsl(calc(var(--hue) + 0/40/80/140/200/260) …)` 派生；**浅底/暖底档必须另行覆盖**为高明度版
- **数据零网络**：站台状态 / 标签 / 归档全部由**已加载 posts 本地聚合**（面板渲染绝不 await 网络）
- **错峰入场**：`bento-in` + 六条 `nth-child` delay；滚动引导 `animation-timeline: scroll(root)` + `@supports` 降级
- **测试**：40 号 28 条（首页 bento / 标签页仍列表）；基线 **915/915**（功能回归 871 + 26 + 18）
- ⚠ 两条判据写法教训：① 断言必须跑在 `stripComments` 之后（注释里解释"为什么不用 #bento / need()"会命中自己）
  ② 条件渲染的元素（如 `#btn-load-more`）不能写成无条件行为断言 —— 那是在测测试数据

### 3.0 B3 已实施（v3.2.0，2026-09-29）
> 阅读与列表批次已完成。**B4 起开工前先读本节。**
- **详情页阅读栅格**：`.post-full > .reading > ( .reading-main + #post-toc )`；`postTrail` 在栅格**之外**
  - **TOC 的 DOM 在正文之后**（视觉右侧第 2 列 ⇒ Tab 顺序天然正确，不靠 tabindex）
  - sticky 四件套：`sticky` + `top: calc(var(--topbar-h) + 24px)` + `align-self: start` + `max-height: calc(100vh - var(--topbar-h) - 48px)` + `overflow-y: auto`
  - `≤1024` 收起回文档流；`≥1600` 目录 `fixed` 浮视口右侧（**全站唯一允许 fixed 的元素**）；print 隐藏
  - 实测（1440 视口）：正文列 706 + gap 44 + 目录 240 = 990 ✓；滚动 900px 后 TOC y=89 = 65+24 ✓ 钉住
- **页脚三栏**（`.foot-grid` 三列 + `.foot-quote` 衬线名言）；**名言必须仍是 `.site-footer` 的直接子元素**（R70/R85c 钉着）
- **编号体系**：SECTOR 07~13（归档/标签/搜索/收藏/关于/管理台/标签管理），接首页 MODULE 01~06；
  编号标是 **h1 的兄弟节点**（页头文案断言不受影响）
- **搜索吸附 + 快捷频段**：`.search-bar` sticky（`top: var(--topbar-h)`，z-index 20 < 页头 100）；
  芯片数据取自 `state.source` 本地聚合（零请求），点击改 hash
- 基线 **942/942**（功能回归 898 + 26 + 18）
- ⚠ **本批三次踩到"假绿"，都靠反向验证当场抓出**：① 判据只查"名言后跟着 `</footer>`"⇒ 挪进网格也成立
  ② 判据只查 `closest(...)` 出现过 ⇒ 改成 `null && …` 也通过（**必须同时钉住赋值形式与使用**）
  ③ 变异没真改变被测关系（把 TOC 插到它本来就在的位置之后）⇒ **变异后必须确认关系真的变了**
  ④ div 配平从 `depth=0` 起会扫到第一个子元素的闭合就归零 ⇒ **必须从 1 起**
- ⚠ 判据别钉"邻居"：`.hero-bg` 与 `.hero-scroll` 要求相邻，往同规则插一个选择器就假红（R186h 已改顺序无关）

### 3.0 B4 已实施（v3.3.0，2026-09-29）
- **控制台仪表盘**：`.console`（220px 左导航 + 主区）；导航按 TIER 01/02 分组 + `aria-current="page"`（左侧实色边）；
  统计块四项（已广播 / 草稿 / 本月 / 频段）**全部本地聚合**；`.admin-item` / `.admin-title[data-edit]` / `#/edit/new` 全部保留
  ⇒ 控制台既有断言零红；1024 导航转横向 + 单列；print 隐藏 `.console-nav`
- **归档页热力图**：`.archive-grid`（时间线 + 260px 小工具，1024 单列）；`heatWidget(groups)` 固定 **12 格**（含空月，
  断更一眼可见）+ **0~4 级**亮度，色值全由 `--cyan` 派生（换色相整块跟着变）；`.widget` 是**通用小工具壳**，后续沿用
- **未做**：电台内嵌小工具 —— 已有常驻 dock，内嵌增益有限且会引入异步渲染复杂度（违反"面板渲染绝不 await 网络"）。
  若日后要做，须走"先渲染骨架再补数据"的路子
- 基线 **960/960**（功能回归 916 + 26 + 18）
- ⚠ 本批反向验证又抓到一处判据问题：**R196d 只查基类与 lv=4 变体** ⇒ 把 lv=2 改成硬编码会漏过（假绿）
  → 收紧为「所有 lv 变体都不许出现 hex」
- ⚠ 反面教材：变异脚本别用**多行长字符串**匹配（缩进/换行半格差异就报"目标未找到"）——
  用**单行锚点**或"只改第一个类名"这类等价变异

### 待拍板项 — 最新状态（2026-09-29，B1~B4 上线后盘点）
方案 §12 原本 8 项，其中 5 项已随 B1~B4 按建议落地（3 首页六模块 / 4 TOC 右栏+≥1600 浮动 / 5 管理台常驻左栏 / 8 首屏 Hero 确认要）。
**仍悬着的 3 项**：
1. **侧栏小工具**（§9.8）：B4 只做了「发文热力图」；**电台内嵌我主动跳过**（已有常驻 dock + 会引入异步渲染）；
   还差「可折叠」「标签云」未做。建议只补「可折叠」（成本极低、小工具变多后必需）。
2. **手写体**（霞鹜文楷）：未引入，用系统衬线替代。建议保持不要（中文字体子集化体积大、收益有限）。
3. **色相盘档位**：已按 9 档实现、无自由滑杆。建议保持 9 档（滑杆会调出未验证的配色）；若要更自由可扩到 12 档而非滑杆。
**另有实施中自主决定、用户未表态的项**（若他要改，逐条可调）：墨色按模块序号分配（方案原建议"按语义"，我按了序号）、
Hero 与身份卡文案、编号前缀用词（MODULE/SECTOR/TIER）、控制台统计块指标、搜索页快捷频段、归档热力图 12 格 0~4 级。

### A3 拍板项已实施（v3.4.0，2026-09-29）：色相自由滑杆
- 面板：原生 range（0~359）+ 度数 `<output>`；九档色卡保留为快捷档；**滑杆不进 radiogroup**
- 事件分离：`input` → applyHue（不写存储，保手感）；`change` → setHue（落存储）
- keydown 放行 `type === 'range'`（方向键归原生，防被组内换档劫持）
- 校验：`hueValid`（整数 0~359）+ theme-boot 的 HUE_MIN/HUE_MAX 两处一致
- ⚠ **`--vio-l` 亮档 28% / 暖档 32%**（原 40%/42%）—— 全色相扫描发现 violet 在 330°~45° 时漂进黄绿区，
  40% 下对比度仅 2.97。**改任何 hue 派生色都要跑 20 号 R59e（96 采样点）**
- ⚠ **Python 写源文件必须用二进制模式**：文本模式会把 LF 静默转 CRLF ⇒ 依赖 `\n` 的判据失配（R122h 实例）；
  已加 R175t 行尾健康检查
