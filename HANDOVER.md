# NEON://DIARY — 交接文档

> **给接手的人**：这份文档假设你对这个项目**一无所知**。读完前两节你就能改代码、跑验证、发版本。
> 想深入，看第 6 节指向的三份笔记 —— 那里面是真正的经验（尤其"踩过的坑"）。

**交接日期**：2026-09-30 ｜ **版本**：v5.7.2（**数据层已迁到 Supabase；全站零外部脚本；收藏为账号功能；审计 ①~⑤+D 清完 + 全项目精简化**） ｜ **门禁**：343/343 全绿（298 回归 + 27 故障注入 + 18 沙箱） ｜ **线上**：本地预览与 GitHub Pages 均在跑

> **v4.8.0 迁移要点（接手先看这段）**
> - **后端换成 Supabase**（项目 ref `taxrgizbmgwzxnvlxudq`，区域 ap-southeast-1）。
>   配置在 `js/cloud.js` 顶部 `PUBLIC_CONFIG`：`endpoint` = 项目 URL **基址**（别带 `/rest/v1/`），
>   `publishableKey` = `sb_publishable_…`（新版公开键，非 JWT）。
> - **改动面只有 SDK 边界**：`init()` 建 `supabase.createClient`，`makeAuthAdapter()` 抹平 auth 三处差异
>   （发码 / 验码 / 改密）。其余约 1200 行（快照回退、图片压缩、电台、脱敏）**一行未动**。
> - **发码的真实机制**（踩过才写下来）：Supabase 没有 `sendOtp`，且出于防枚举不回话 ——
>   适配器先用 `shouldCreateUser:false` 探一次，报 `otp_disabled / Signups not allowed for otp`
>   即判为新用户，再补一次 `shouldCreateUser:true` 真发码。**已与真服务逐字核对过**（52 号用例 + 真项目实测）。
> - **邮件模板必须含 `{{ .Token }}`**：站点用 `signInWithOtp`，Supabase 发的是 **Magic Link 模板**；
>   默认模板只有 `{{ .ConfirmationURL }}`（一个链接），**收不到 6 位验证码**就是这个原因。
>   另外 `mailer_otp_length` 默认 8，已改成 6 与前端文案一致。
> - **`?v=` 缓存教训再现**：改了 `js/` 却忘了 bump，浏览器复用旧 `cloud.js`（指向旧后端）→
>   登录报 `Failed to fetch`。**改完立刻 bump，并 Ctrl+F5 硬刷新一次**
>   （`index.html` 自己没有版本号可击穿；docs/MIGRATION.md §0 记了这次事故）。
> - **电台已退役**（站长决定"不做歌曲部分"）：3 首商业歌曲（27MB）移出仓库与快照，不导入新库；
>   表结构与界面保留（未登录访客看不到空播放器，站长登录后仍有上传入口）。
> - **免费档边界**：直连域名 `db.<ref>.supabase.co` 只有 AAAA（IPv6），IPv4 环境要用 Session pooler；
>   建库/灌数据可走 Management API（PAT）或 SQL Editor 粘 `db/bootstrap-*.sql`。

---

## 1. 这是什么

一个**单页前端博客**（赛博朋克终端风格），纯静态，无构建步骤。

- **技术**：原生 JS（无框架）+ CSS + 原生 DOM，`index.html` 是唯一入口，hash 路由（`#/post/1`）
- **数据**：WorkBuddy 云端（见第 4 节）。文章、图片、标签、歌单都在云数据库里
- **Markdown**：`marked` + `DOMPurify`（**v4.8.1 起本地托管**，见 `js/vendor/README.md`；不再走 CDN）
- **线上地址**：`https://cyberpunk-blog.app.workbuddy.host/cyberpunk-blog/`
  ⚠ **必须带 `/cyberpunk-blog/` 子目录**；根路径 `/` 是**停在 2.3.0 的遗留快照**，平台不清理，别拿它当线上

---

## 2. 五分钟上手

```bash
cd cyberpunk-blog

npm run gate        # ★ 全量门禁（v5.7.2 起 343 条；裁剪后只留 18 个核心 case）。改任何东西之后都跑它
npm run baseline    # 增删断言后更新基线（**新增 case 必须手动登记进 tests/cases/manifest.json**）
npm run build       # = gate + 生成 feed.xml
```

**发布**：通过 WorkBuddy 的发布能力（`workbuddy_sites_deploy`），参数必须是
`directory: C:/Users/liu/WorkBuddy/2026-09-28-00-18-42`（**父目录**，不是 cyberpunk-blog）、
`entryHtml: cyberpunk-blog/index.html`、`language: "static"`（⚠ **必传**）。

**改完代码的三步**：
1. `npm run gate` 全绿
2. bump 版本号（见下）
3. 发布 → **线上验证**（用 GET 请求，逐文件比对 md5）

---

## 3. 项目结构

```
cyberpunk-blog/
├── index.html          单页入口（含 CSP meta）
├── css/style.css       ★ 全部样式（约 5300 行，含大量"为什么这么做"的注释）
├── js/
│   ├── app.js          ★ 主逻辑（路由、视图装配、编辑器、主题、装置面板、NEONControls 导出）
│   ├── views.js        视图层（返回 HTML 字符串，全部经 esc() 转义；含字标组装与街区）
│   ├── cloud.js        云端封装（数据表访问、图片压缩、条目读写）
│   ├── keys.js         快捷键（含 Ctrl+` 唤起终端、Esc 优先级链）
│   ├── theme-boot.js   ★ 首绘前脚本（主题/色相/氛围三件都在这里定，必须独立不能依赖 app.js）
│   ├── scene.js        ★ 4.0 场景框架（路由→场景→氛围层集；手动优先链；reapply）
│   ├── atmo.js         ★ 4.0 氛围运行时（数字雨 DOM 列法 + 帧率保底与自动降档）
│   ├── boot.js         4.0 开场序列（首访终端自检；CSS failsafe 兜底自退场）
│   ├── tap.js          4.0 点击反馈（三档；hover + reduce 双闸）
│   ├── console.js      ★ 4.0 命令终端（Ctrl+`；八命令 + 彩蛋；DOM 惰性构建）
│   ├── wordmark-paths.js  4.0 霓虹字标字形数据（**生成物**——字体转曲，勿手改）
│   └── version.js      版本号 + 完整版本演进 LOG（**改代码必须同步 bump**）
├── tests/
│   ├── run-all.js      门禁入口
│   ├── cases/          18 个核心用例 + manifest.json（★ 新增 case 必须登记；完整版见标签 pre-trim）
│   └── fault-matrix.js / sandbox-p2.js / regress.js
├── tools/
│   ├── bump.js          版本号提升脚本
│   ├── gen-feed.js      RSS 生成
│   ├── export-static.js 静态快照导出（workflow 每 6 小时跑）
│   └── audit-all.js    ★ 全项目审计（剥注释再扫，命中即真信号）
└── docs/handover-notes/   ← 本交接包附带的深度笔记快照（见第 6 节）
```

**代码规模参考**：`app.js` 约 3400 行、`views.js` 约 1300 行、`style.css` 约 5400 行。
`bindEditor` 是唯一超过 300 行的函数（334 行），重构它属于已知技术债。

---

## 4. 后端资源（关键）

**当前：Supabase**（v4.8.0 起）

| 项 | 值 |
|---|---|
| 项目 ref | `taxrgizbmgwzxnvlxudq`（区域 ap-southeast-1 / 新加坡） |
| 项目 URL | `https://taxrgizbmgwzxnvlxudq.supabase.co`（写进 `cloud.js` 的 `endpoint`，**只填基址**） |
| 公开键 | `sb_publishable_…`（写进 `publishableKey`；设计上随前端公开，权限由 RLS 管） |
| 数据表 | `posts`（文章）、`post_images`（图片）、`radio_tracks`（电台，**已退役、0 行**）、`error_logs`（前端错误上报）、`bookmarks`（**收藏，账号功能**：未登录连表都碰不到） |
| 读视图 | `public_images`（匿名读图，不含 owner_id）、`public_radio`（匿名读电台） |
| 认证 | 匿名可读已发布内容；写入需登录（`ACCESS` 入口）。**发码走邮件验证码**（`signInWithOtp` + `verifyOtp`） |
| 读者功能 | **收藏**（v4.9.0）：只有登录后才能收藏，未登录只能浏览；数据在 `bookmarks` 表、跟账号走 |
| 建库资料 | `db/schema.sql`（DDL）+ `db/bootstrap-1-schema-posts.sql` / `bootstrap-2-image.sql`（粘 SQL Editor 即可建库） |
| 建库/灌数据脚本 | `db/tools/import-to-supabase.js`（直连）、`db/tools/verify-supabase.js`（真后端验收） |

⚠ **三个必须知道的怪点**（前两个是历史取舍，第三个是 Supabase 特性）：

1. **图片以 base64 存在数据库里**，不走对象存储。原平台的对象存储只服务登录用户，而博客图片必须匿名可读。
   后果：表行有长度上限（`data` ≤ 3.6M 字符），所以上传管线会**自动压缩**（`cloud.js` 的 `compressImage`）。
   （Supabase 的 Storage 支持公开桶，将来若想改成对象存储，这是一次独立改动。）
2. **读视图与写基表的字段不能混用** —— `has_data` 是视图算出来的列，写路径引用它会报 42703
   （v2.9.2 事故，判据已收进 `js/version.js` 的历史事故索引）。
3. **直连 Postgres 的域名只有 IPv6**：`db.<ref>.supabase.co` 无 A 记录，IPv4 环境要用 Session pooler
   （`aws-0-ap-southeast-1.pooler.supabase.com`，用户名 `postgres.<ref>`）。
   建库/灌数据更省事的通道是 **Management API**（个人访问令牌 PAT）——`POST /v1/projects/{ref}/database/query`。

### 历史后端（WorkBuddy，2026-09-30 之前）

| 项 | 当时的值 |
|---|---|
| resourceId | `wbcs_asyuRz8PhuNwUVq3nDDomM`（原账号内） |
| 主站 | `https://cyberpunk-blog.app.workbuddy.host/cyberpunk-blog/`（可登录发文；随云服务停用而失效） |

旧平台的权限是「Origin 白名单 + RLS」两层，所以 `*.github.io` 一律 403；**Supabase 不设这道闸**，
放开 CSP 的 `connect-src` 之后 GitHub Pages 也能直连数据库 —— 于是 `data/` 快照从"唯一出路"退化为"兜底"。

---

## 5.0 ⚠ 门禁政策（v5.7.2 起，站长明确要求）

**门禁只守核心，其他没必要加。** 现役 **18 个 core case / 298 条断言**（+27 故障注入 +18 沙箱 = 343）。
清单（`app/tests/cases/`）：

| 类别 | case |
|---|---|
| 主流程 | `01` 正常启动 / `02` 文章详情 / `03` 首页列表 |
| 安全与版本 | `05` 供应链（本地托管 + 哈希 + 零外部脚本）/ `07` 版本一致 / `13` CSP |
| 后端与回退（命脉） | `51` 快照回退 / `52` Supabase 适配 |
| 配色（成对） | `20` 色标对比度 / `39` tokens |
| 无障碍与用户可感知行为 | `23` 减少动效 / `53` 收藏 |
| 契约与结构 | `45` 氛围 / `48` 终端设备 / `49` 结构终审（含 CSS 括号配平） |
| 性能硬化 | `55` 出网超时 / `56` 降档收敛 / `57` 低端档 |

**纪律：**
1. **不为"辅助功能"新增 case** —— 如折叠组件、阅读进度、OG 卡片、编辑器文本、
   图片收口、暗色优先、防白屏、装饰层、uptime、历史批次收尾等，一律**不加门禁**。
2. **只为"坏了会出事且不易察觉"的东西加** —— 且优先**行为断言**（真跑一遍看结果），
   不写字面断言（`indexOf`/正则匹配源码文本），因为注释能满足它（本项目踩过 4 次）。
3. **改门禁必须同步 `manifest.json` 并跑 `tools/baseline-cases.js`**，否则对账报红。
4. **删除的用例不必留档**（`pre-trim` 标签留了完整版），但**不要**再往门外加回历史批次。

⚠ 这条政策与"每个改动都要有断言"的旧习惯冲突时，**以本条为准**：宁可少一条断言，也不要把门禁做回 1000+ 条。

## 5. 必须知道的纪律（都是踩过的坑）

### 发布与版本

- ⚠ **`?v=` 是唯一的缓存击穿手段**。改了 `js/` 或 `css/` **必须 bump 版本号**，否则用户拿到旧文件。
  `--refresh-id` 只刷新 BUILD_ID，**对缓存零作用**。
- ⚠ **bump 的 `--title` / `--item` 里一律用「」，不要用双引号** —— 嵌套双引号会让 shell 提前闭合引号、
  参数错乱、**bump 静默失败**（版本号没变）→ 此时发布 = `?v=` 未变 = 缓存击不穿。**bump 后必须校验 `BUILD`**。
- ⚠ **发布后验证必须用 GET**（禁用 `curl -I`），并带 `--compressed`；`verified: true` ≠ 已传播，
  **必须核对 `?v=` 与 BUILD_ID**。
- ⚠ 发布返回的 `shareLink` 是**根路径的遗留快照**，不要原样转给用户 —— 正确地址永远带 `/cyberpunk-blog/`。

### 电台「外链音源」与它的两个坑（v4.9.5）

- **能力**：曲目音源二选一 —— `data`（base64 内链）或 `source_url`（https 直链外链）。
  `playUrl` 遇到外链直接返回地址、**不碰 base64**；没有外链时仍走原路（老曲目不受影响）。
- ⚠ **CSP 是有意放宽的**：`media-src` 加了 `https:` —— 不加的话浏览器会直接拦掉外链音频。
  它只管 `<audio>/<video>`，不涉及脚本与样式。想收紧就把 `https:` 换成你固定的域名。
- ⚠ **测试脚手架与 `radio.js`**（历史，v5.6.3 收尾）：`bootDom` 曾经漏装 `radio.js`
  （真实 `index.html` 有它），后来靠 `bootDom({ radio: true })` 按需装载。
  **现在这一段已整体撤下** —— 内核文件本身已删除（见第 6 节的精简化说明），
  电台界面也不再依赖任何本脚本，断言直接看渲染出的 DOM。
- ⚠ **`create or replace view` 不能改列序**：给视图加列必须追加到 SELECT 末尾，
  否则 `42P16: cannot change name of view column …`（实测踩到）。

### v5.3.0：启动加速（把"详情页才需要的库"移出关键路径）

- ⚠ **defer 的隐藏代价**：defer 脚本**全部执行完**才触发 DOMContentLoaded，而本站启动挂在那个事件上。
  于是"只有文章详情才需要的 43KB 代码高亮库"会把**首页首绘**一起拖住（冷启动实测该请求 19 秒）。
- 改法：marked / DOMPurify / highlight 三个库**按需注入**（`loadVendors()`），加载完自动重渲染；
  另加三条 `rel="prefetch"` 空闲预取（同时让供应链断言 R16 继续成立 —— 它的引用形式判据已放宽为 script 或 link）。
- 电台条目改为 `requestIdleCallback` 之后拉（访客多半没开电台，不该为首屏多等一次跨区往返）。
- `preconnect` 到 Supabase 用 **// 形式**：R36 会把 index.html 里每个 `https://` 域名当成"被引用"并要求 CSP 逐字包含它。
- ⚠ `bump.js` 失败时**只在末尾回显一行"改号"帮助**，很容易被当成成功 —— 判据永远是：看
  `js/version.js` 的 BUILD、`index.html` 的 `?v=` 分布、`package.json` 三者是否同值。

### v5.2.0：旧小条已拆 + 一条改测试的教训（⚠ 电台已于 v5.7.2 整体删除；本条只留经验）

- 旧 `#radio-dock` 与 `js/radio.js`（`<audio>` 内核）已移除 —— 新电台用官方 iframe 播放器。
  旧入口函数（`paintDock`/`bindRadioDock`/`openRadioPanel`）**保留空实现而非删除**：
  `paintDock` 有 6 处调用点，删函数会连锁 ReferenceError。
- ⚠ **改测试的正确姿势（实锤两轮）**：想"把断言里的旧容器名换成新容器名"时，
  **不要全局替换** —— 同一个词往往同时出现在与容器无关的断言里（这次 11 条 CSS 断言被误伤）。
  正解：**先从远端取回未改动的原文件，再做最小范围替换**（甚至只改那一条断言的括号块内部）。
- 容器位置（**已随电台删除，此条只作历史**）：`#radio-stage` 曾放在 `<main id="app">` 之前。
  ⚠ 留下的教训：**"位置在 #app 之外"这类结构性要求，一旦功能删除，对应断言必须一起退役**，
  否则就会变成 R150b 那种假绿（见下条）。

### ⚠ v5.7.2：注释盲断言 = 永久假绿（R150b 实锤，第 4 次同类坑）

- **事故**：`35` 号有一条 `R150b「radio.js 在 app.js 之前加载」`，判据是
  `html.indexOf('js/radio.js') > 0 && … < html.indexOf('js/app.js')`。
  而 `js/radio.js` 自 v5.2.0 就撤下了引用、v5.6.3 连文件都删了 ——
  它命中的是 `index.html` 里那段**注释**（"v2.8.0：电台播放器内核。必须在 app.js 之前…"），
  于是这条断言在"**没有任何 radio.js 加载**"的情况下**永远判绿**。
- **规律**：凡是 `indexOf` / 正则匹配源码文本的判据，都可能被**注释**满足。JS 注释、CSS 注释、
  **HTML 注释**全都算 —— 本项目已踩 4 次（35 号 R143/R146b、48 号 R230b、05 号 R16e、本次 R150b）。
- **纪律**：① 断言前先 `stripComments()`（HTML 用 `/<!--[\s\S]*?-->/g`）；
  ② 更要紧的是**尽量别写字面断言** —— 改成行为断言（真跑一遍看结果）。
- **本次的升级范例**：退役 `R150b`，换成 `R150c「index.html 引用的每个本地 script/link 目标都必须真的存在」`。
  它守的是"删了文件忘删引用 / 改名忘改引用"这一整类 bug，而**字面顺序断言永远抓不到**这类问题
  （判据从"某个字符串出现过"升级为"引用的东西真的在"）。
- 反向验证：基线 PASS → 插入 `js/radio.js` 假引用 → **FAIL（缺失引用: js/radio.js?v=5.7.1）**
  → 恢复 PASS 且字节一致。

### v5.1.0：电台的常驻控制台（⚠ 功能已于 v5.7.2 删除；本条价值在"切页不断播放"的通用技法）

- 官方播放器 iframe 曾挂在 **#app 之外**（index.html 的 `#radio-stage`）。要点很通用：
  iframe 一旦位于会被路由重绘的区域里，切页面就重载、歌就断（参考博客专门写过这个坑）。
- `paintStage()` **只在目标地址变化时**重建 iframe；地址不变则什么都不做（否则等于手动断歌）。
- `data-mode` 由路由在 `mini`（右下小条）/ `full`（电台页大控制台）间切换 —— 同一台机器、两种体型，
  **不搬动 DOM**（搬动 iframe 有重载风险）。
- ⚠ 三个坑：① 本项目**没有 askConfirm**，确认框是 `openModal(title, html, actions)`；
  ② 启动调用必须放在所有 var 赋值之后（var 提升会给你 undefined，启动直接 TypeError）；
  ③ 降级用例会跑在**没有 document** 的环境里 —— 电台相关函数一律加 `typeof document === 'undefined'` 守卫。

### v5.0.0：电台重做（网易云条目）

- **模型**：`radio_tracks` = 网易云条目（`kind` song/playlist + `netease_id` + 规范化 outchain 地址）。
  **已删除** `data`/`storage_path`/`duration_sec`/`size_bytes`/`mime`/`cover_url` —— base64 自建播放器时代的产物。
- ⚠ **改视图/删列的两条硬规矩**（都实锤过）：
  1. 要删列，**必须先 drop 掉依赖它的视图**（否则 2BP01: cannot drop column … because view depends on it）
  2. 视图重建后**必须补回 GRANT**（`grant select on public_radio to anon, authenticated`）—— 忘了就是"匿名访客读不到、电台全空"
- **播放**：单曲 `type=2&height=66`；歌单 `type=0&height=430`（官方给的正是这两个值）。
- ✅ **已办（v5.0/v5.1）**：独立页面 `#/radio` + 常驻官方播放器（挂在 `#app` 之外，切页面不断歌）。
- ✅ **已办（v5.6.1 / v5.6.3）**：base64 时代遗留方法已清空；旧 `js/radio.js`（`<audio>` 内核）
  整个文件已删除 —— 它不再被 `index.html` 加载，运行时也无人调用。

### 网易云官方外链播放器（v4.9.9）

- **形态**：它不是"一条音频地址"，而是**一整个官方 iframe 播放器** —— 所以
  ① 入库前**不做音频校验**（<audio> 当然加载不了它，不特判会被误判成坏链接）
  ② 播放时**不碰 <audio>**，由界面直接把行里的 `source_url` 渲染成 iframe
     （`app.js` 的 `paintStage`；v5.6.3 前那层 `radio.js` 内核已删除）
- **CSP 两次放宽的边界**：`media-src … https:`（v4.9.5 外链音源）+ `frame-src https://music.163.com`（v4.9.9）。
  脚本/样式/图片来源一律没动。想收紧就换成你实际用到的那一个域。
- **贴法**：歌曲页 `/#/song?id=…`、`/song/…`、outchain 页 `/#/outchain/2/<id>/…`、裸 id 都认，
  统一规范化成 outchain 地址后入库（库里只有一种形态，判断逻辑才简单）。
- ⚠ 网易云播放器只给**试听**（完整版通常要登录/会员），且它自带品牌与广告 —— 那是人家的播放器，
  不要试图改它的样式（既做不到，也不合适）。

### 音频播放失败怎么查（v4.9.6 实锤）

- ⚠ **CSP 拦截**与**地址本身不可播**会给浏览器**同一句**文案（"The element has no supported sources."）——
  别猜，分开取证：① 页面里听 `securitypolicyviolation`（有 = CSP 拦的）
  ② 直连那条 URL 看 `Content-Type`（`text/html` = 贴的是网页而不是音频文件）。
- ⚠ **网页地址能顺利入库**（https 合法、URL 结构也合法），直到播放才炸 ——
  所以外链入库前必须用 `probeSourceUrl` 试听校验一次（用 `<audio>` 亲口问，不用 fetch：
  防盗链与同源策略会让 fetch 拿到不同结果，`.m3u8` 之类又常是 text/plain 却照样能播）。
- ⚠ 用 CDP 驱动 Edge 验真实播放很有效：`--remote-debugging-port` + `Runtime.evaluate`
  可在**线上站的真实 CSP 下**跑 `new Audio()` 探针，比 file:// 页面可靠得多
  （本机 headless 对 file:// 返回空 DOM）。

### 引入第三方素材 / 组件的规矩 · 现行（2026-10-01 站长二次放宽）

- **旧规作废**：不再需要"先报备、等点头"。
- **新规**：**对方开源 → 可以照抄代码，只需"说一声"**（来源 + 许可 + 抄了哪一段）。
  仍要做：源码里**就地署名**；以及别引入与"零构建纯静态"不兼容的东西
  （React/Vue 组件跑不起来，那是技术限制）。
- **颜色不再死守主题变量**：视觉表现可以自由用色；只有需要跟换肤/换色相联动的元素才挂变量。

### （历史）引入第三方素材 / 组件的规矩（2026-10-01 站长更新）

- ⚠ **旧约定已取消**：v2.9.4 起流传的「**只借技法、不搬组件**」**不再有效**。
  现在改为：**要搬，就先报备；站长同意后再落地。**
- 报备要说清四件事，缺一不可：
  1. **来源 URL**（哪个站点 / 仓库 / 作者）
  2. **许可** —— MIT / CC0 / Apache-2.0 / **无声明**。⚠ 无声明的一律**默认不搬**（版权状态不明，风险兜不住）
  3. **会改动什么** —— 配色 / 几何 / 交互 / 文案。本站颜色一律走 `--hue` 与既有变量
     （`--cyan` / `--magenta` / `--yellow`…），硬编码色值搬进来等于埋一颗"换主题就露馅"的雷
  4. **体积与依赖** —— 本站**零外部脚本**，CSP 只放行 `'self'`：React / Tailwind / framer-motion / gsap
     这类整包依赖**直接出局**；纯 CSS 片段、或能自绘的图形才现实
- 同意之后按既有供应链纪律落地：
  - **代码文件** → 进 `js/vendor/`，在 `js/vendor/README.md` 记来源 / 版本 / sha256 / sha384 / 大小
    （05 号用例会校验档案与文件一致）
  - **纯 CSS 片段** → 在样式表里就地注明「借自 <来源>」+ 改动了哪些值（v2.9.4 / v2.9.5 那几处就是范例）
  - **自己照风格画的**（如 v4.9.1 的霓虹锁）→ 注明"参考了谁的意象"，并写清是自绘、无第三方代码
- ⚠ **徽标/图标别用 emoji**：emoji 是彩色位图字体，颜色不跟 CSS 变量走、各平台字形还不同，
  在全站由 `--hue` 驱动的配色体系里像贴纸。一律自绘 SVG + `currentColor`。
- ⚠ **图形实现的硬坑**（v4.9.1 实锤，静态断言查不出来，**只有截图能发现**）：
  **`<use>` 引用 `<symbol>` 时克隆内容在影子树里，类选择器进不去** —— `.mark-lock .lk-body`
  这类描边规则会全部失效，path 退回默认 `fill:#000`，渲染成一块**黑色实心疙瘩**，悬停动画也无从触发。
  → 需要 CSS 造型或动画的图形，一律**内联 SVG**，不要用 sprite + `<use>`。

### 4.0 时代的新坑（B1~B4 期间，2026-09-30 —— 都是实锤过的）

- ⚠⚠ **缓存是三层**（浏览器 / L1 边缘 / L2 父缓存），且 **HTML 本身没有版本号可击穿**：
  发布后**必须同时核"裸 URL"的 `?v=`**（那是用户的真实路径；只验带 cb 的源站会漏掉"用户拿到的还是旧页"——
  实锤：用户连报两次"看不到街区"，根因是裸 URL 拿到 1.8 小时前的旧 HTML）。
  应急通道：地址后加 `?cb=N`（换个数字）可绕开全部缓存；平台「设置—数据管理—应用」可手动刷新。
- ⚠ **DOM 探针 ≠ 人眼可见**。断言/探针只能证明"元素存在且参数正确"，**证明不了"看得见"**——
  可见度（尺寸/亮度/对比）必须用真实渲染验收。教训来源：街区首版发光竖杆 2px、母线 32% 透明度，
  "等于不存在"（补正后母线区霓虹像素 +816%）。
- ⚠ **钉调用点，不只钉函数定义**——"函数在、调用被删"的反向验证实锤过两次
  （`bindLineNumbers`、tap 的 reduce 双闸）。判据要钉**调用形态本身**。
- ⚠ **注释会命中判据**（第 N 次）：注释里带 `<g class="wordmark-echo">` 之类的代码字样，
  会让"删代码"变异**假绿** —— 涉及代码字样的断言一律跑在剥注释（`stripComments`）之后。
- ⚠ **氛围层列表有四个写入者**（theme-boot 首绘 / scene.apply 路由 / atmo 自动降档 / 装置面板手动）——
  改动任何一个都必须过 45 号 + 48 号的契约断言。优先级：`neon_atmo_manual`（手动）> `neon_atmo_mode`（三档）> 场景温差。
- ⚠ **宽度断点块 ≤16 个**（R202d 守）—— 新断点规则必须**并入既有块**，不能新开。
- ⚠ **reduce 块内单行写法**（R112e 数"不含 `}` 的行"）—— 新规则一行写完。
- ⚠ 嵌套 `try` 会**劫持**"截取到第一个 `} catch` 为止"的旧式体检（R175r 实锤：体检范围腰斩）——
  新断言用**花括号配平**提取。
- ⚠ `fnBody(views, '函数名')` 在函数改名后返回**空串**——"未出现 X"类否定断言会对空串**假绿**。
  迁移断言的铁律：先确认拿到的体非空。

### 测试

- 增删断言后**必须** `npm run baseline`；**新增 case 必须登记进 `tests/cases/manifest.json`**（漏登记 = 永不进门禁）。
- 反向验证（把修复摘掉 → 确认报红 → 恢复）**会污染源码**：变异若触发进程级错误，`finally` 不执行。
  防护：开场先写回 orig、结束用内容标记二次校验。
- 判据不要钉注释（会被正则命中造成假红）、不要钉"邻居"（`A, B { }` 里要求相邻，新增一个选择器就假红）。
- 四个"全假绿"机制：源码在 require 时读进内存 / `run()` 是 async（不 await 会被吞）/
  反向验证要连 case 文件自己的缓存一起清 / 带大窗口的懒匹配会跨出函数边界。

### CSS / 布局

- **全站只有一个滚动容器（body）**；辅助栏一律 `sticky` + 四件套
  （`top: calc(var(--topbar-h) + 24px)` / `align-self: start` / `max-height` / `overflow-y: auto`）—— 少一条会**静默失效**。
- **全站唯一允许 `position: fixed` 的**是 ≥1600px 的浮动目录。
- 改配色**必须同时跑** `tests/cases/39-v3-0-0-b1-tokens.js` 与 `20-o9-色标.js`（后者真算对比度）。
- ⚠ **派生变量必须既"走 `hsl(var(--hue))` 派生"又"确实被引用"** —— 曾经有两个变量只满足前者，
  零引用了整轮（改了毫无效果）才被审计发现。
- ⚠ **删一批元素时，要搜「选择器 + `{`」，不能只搜选择器名** —— 只按名字搜会把**注释里的提及**当成已清理，
  而**媒体查询内 / 分组选择器 / 带缩进**的规则最容易漏。复查用带 `\{` 的正则数一遍，**为 0 才算干净**。

### 安全

- **CSP 没有 `'unsafe-inline'`** ⇒ 严禁内联 `<script>` 与 `onclick=` 属性（全部走 `addEventListener`）。
- 用户数据进 `innerHTML` 前必须 `esc()` 或 `DOMPurify.sanitize()`；错误消息对外脱敏。
- 库字段有长度上限（`js/cloud.js` 顶部的常量）。

---

## 6. 深度资料在哪（★ 接手方最该看的）

三份笔记**已复制**到 `cyberpunk-blog/docs/handover-notes/`，**交接包自包含**：

| 文件 | 定位 |
|---|---|
| `MEMORY.md` | **索引 + 判据速查**（先看这个，10 分钟建立全局认知） |
| `PROJECT-NOTES.md` | **详情**：电台模块全貌、发布事故、架构与数据、3.0 改版全记录、待拍板项 |
| `TESTING-NOTES.md` | **测试写法**：源码提取、CSS/jsdom 工具链、浏览器自动化的坑 |

⚠ 若以后**继续在同一 WorkBuddy 环境里**做，**活文档在 `.workbuddy/memory/`**（项目根目录下），
`docs/handover-notes/` 只是 2026-09-30 的快照。**请以活文档为准**，或定期同步。

---

### 首页两栏改版（站长已拍板，待开工）

**站长的决定（2026-10-01）**：
- **左半侧**：二次元全息风 —— 大号赛博字体 + 全息网格 + 故障字（glitch）+ 扫描线，
  并**大改建站时间**（现在是 STATION UPTIME 那块：BOOT DATE / 天 / 时 / 分 / 秒）。
- **右半侧**：身份卡 —— ① 署名 **漓光** + 身份标签 ② **当前在播的网易云曲目**（与新电台联动）
  ③ **全息倾斜互动**（跟随鼠标倾斜 + 虹彩反光；触屏与 reduce 下自动不启用）。
- ⚠ 没选：文章数/建站天数/收藏数那组统计（站长没要）。

**已备好的素材出处（含许可）**：
- [alddesign/cyberpunk-css](https://github.com/alddesign/cyberpunk-css)（纯 CSS，切角/霓虹边框/故障字）
- [@laddtnov/cyberpunk-ui](https://classic.yarnpkg.com/en/package/@laddtnov/cyberpunk-ui)（纯 CSS 霓虹套件）
- Uiverse 卡片（页脚写明 **MIT**）：shy-cow-68 / brave-crab-21
- [DevCard 3D](https://dev.to/mehalogen/i-built-devcard-3d-turn-github-profiles-into-holographic-trading-cards-3pp2)（全息倾斜思路）

**实现约束（动手时必须守）**：
1. 零外部脚本 → 只用纯 CSS/SVG（React 组件一律用不了）；用到某段第三方 CSS 就**就地署名**
2. 颜色一律走 `--hue/--cyan/--magenta` 变量（硬编码色换主题就露馅）
3. 断点块不得新增 → 窄屏堆叠规则并进既有 `@media (max-width: 768px)` 块
4. 动效（glitch / 扫描线 / 倾斜）必须在 reduce 块里显式归零
5. 首页断言很多（45/46/48 号等）→ 改版后按"先取原文件、再最小范围改"的方式更新，**不要全局替换**

### 全项目审计结论（v5.6.0 立项 → ① ② 于 v5.6.1、③ ④ ⑤ + D 于 v5.6.2 全部清理完毕）

扫描脚本：`tools/audit-all.js`（扫事实，不猜；v5.6.3 起已**剥注释再扫**）。**已修**：页脚 POWERED BY WORKBUDDY CLOUD → SUPABASE。

> **v5.6.1 注记（① ② 已还）**：`js/cloud.js` 的 base64 时代旧电台 API、
> `app.js` + `views.js` 的旧「迷你条 dock + 弹出面板」整台机器都已删除。
> **v5.6.2 注记（③ ④ ⑤ + D 已还）**：旧 dock/panel 样式整段删除（约 410 行）、
> `export-static.js` 的电台导出块按 v5 重写、5 处 console.log 定性为"自证机制，保留"。
> 门禁 1194 → 1157（v5.6.1）→ **1153 全绿**（v5.6.2）。
> **这张表现在全绿 —— 没有遗留项了**，新的清理需求请重新跑一次审计脚本再开单。

| 项 | 证据 | 处理要点 |
|---|---|---|
| ~~① cloud.js 死 API~~ | ✅ **v5.6.1 完成** | 实际删的比清单更长：除列出的那些，还删了 `normalizeSourceUrl` / `StaticRadio.playUrl` 与只为它们存在的 `AUDIO_*` 常量、`RADIO_FIELDS` 之外的三个字段清单；`Radio` 现在只剩 `list / parseNetease / buildEmbedUrl / add / removeTrack / reorder` |
| ~~② app.js/views.js 死面板机器~~ | ✅ **v5.6.1 完成** | 活下来的只有 `canManageRadio`（新电台页与常驻控制台共用）；身份变化时的重取改成 `rcLoad()`，`boot` 里的 `initRadio()` 调用删除；`app.js` 那个 `tune` 分支是旧面板遗留的不可达分支，一并删了 |
| ~~③ 已删列的残留引用~~ | ✅ **随 ① ② 清零，v5.6.2 复核** | `js/` 下（**剥掉注释后**）已无任何一处。仍在提这几个名字的只剩 `version.js` 的历史日志；`app.js`/`cloud.js` 里那几处 `storage_path`/`size_bytes` 是**图片**那条活路的字段（同名列，不是已删的电台列） |
| ~~④ 旧 dock/panel CSS~~ | ✅ **v5.6.2 完成**（约 410 行） | 删了 `.radio-dock*` / `.radio-panel*` / `.radio-track*` / `.radio-btn*` / `.radio-now*` / `.radio-seek` / `.radio-volume` / `.radio-bar` / `.radio-time` / `.radio-ctrls` / `.radio-vol*` / `.radio-list*` / `.radio-empty*` / `.radio-embed*` / `.radio-drop` / `.radio-hint` / `.radio-err` / `.radio-mark` / `.radio-glyph`，外加 `@keyframes radio-pulse`/`radio-marquee`、`body.has-radio .wrap`、打印块里那两个隐藏项、reduce 块里为它们写的三条。判据：这些类名在 `views.js`/`app.js`/`index.html` 里**零标记**，逐个核实后才删 |
| ~~⑤ console.log~~ | ✅ **v5.6.2 定性：全部保留** | 5 处全在 `js/version.js` 的「自证」块里 —— 排查"页面是不是旧版/浏览器吃了缓存"的第一手证据（§5 那次 bump 忘改导致登录 `Failed to fetch` 的事故就是靠它定性的）。输出恒定 5 行、不含用户数据；理由已写进源码。**纪律是别新增**：审计脚本会把计数报出来 |
| ~~D 导出器电台块~~ | ✅ **v5.6.2 完成（选了"按 v5 重写"）** | 它原来 select `data/mime/duration_sec/size_bytes/cover_url/has_data` —— 这些列 v5 已从库与服务端删除，真去查会 42703 **整轮导不出快照**（之前没爆只因快照 `radio` 恒为空）。现在只导 v5 条目元数据，字段与 `cloud.js` 的 `RADIO_FIELDS` **逐字一致**（51 号 R253c 钉着这条）；`FORCE_AUDIO`/`AUDIO_EXT_BY_MIME`/`localFileSize`/`data/radio` 落地与清目录逻辑一并删除，空的 `app/data/radio/` 目录也删了 |

**④ 里必须记住的"别误删"清单**（下一轮再有人清 CSS 时照着对）：
   ⚠ v5.7.2：下面这串"电台页在用"的类名已随电台整体下线删除（`.radio-page-tip` /
   `.radio-board` / `.radio-card*` / `.radio-compose` / `.radio-field` / `.radio-select` /
   `.radio-src-head` / `.radio-form*` / `.radio-op*`），CSS 里已无对应规则。
常驻控制台在用 `.radio-console` / `.rc-*`（复古收音机材质走它自己的局部变量，刻意不跟主题翻）。

⚠ **过程教训（v5.6.0 立项时实锤）**：用"括号配平"批量退役断言时，**遇到内部含分号/嵌套括号的断言会配平失败**（当时 2 条失败并连带把 54 号改出运行时错）。
正解：断言退役要**一条一条**做，或者改用"整文件从远端取回 + 精确最小替换"的方式 —— 不要写通用批处理去啃它们。

⚠ **过程教训（v5.6.1 清理时新增两条，都是实测踩到的）**：
1. **"清理守卫"必须扫剥过注释的源码**。删了代码之后，源码注释里往往会写下被删的名字（本轮 `cloud.js` / `views.js` / `app.js` 都写了），
   于是 `!/playUrl/.test(cloud)` 这类断言会被自己写的注释判红 —— 改成 `stripJsLineComments(stripComments(cloud))` 后再扫。
   另外别写太宽的守卫：`!/\.select\([^)]*\bdata\b/` 会误伤图片那条活路（`Images.fetchMany` 正是 `.select('id,content_type,data,…')`），
   `!/signedUrl/` 会误伤附件下载（`Storage.signedUrl` 是另一条活路）。
2. **`cloudCode` 这类"给全块用的局部变量"必须在块首声明**。本轮把它写在了块的中途，于是块里靠前的断言撞 temporal dead zone，
   只有那一条报红（`Cannot access 'cloudCode' before initialization`）—— 症状像是断言写错了，其实是声明顺序。

⚠ **过程教训（v5.6.2 清 CSS 时新增三条）**：
1. **删"中间一段规则"比删"整块"危险得多**：本轮 reduce 块里是按行删两条规则，结果把**上一条规则的注释收尾 `*/` 一起吃掉** ——
   于是 `.topbar/.kbd-help` 那条 `backdrop-filter` 整条被吞进注释、块结构破损，而门禁**并没有红**（它只断言"某条规则还在不在"）。
   教训：删完必须独立复核结构（本轮用"注释开闭计数 + 括号配平 + 关键规则在不在"三条一起验），别只信测试全绿。
2. **审计脚本要注释感知，否则清干净了也报残留**：`audit-all.js` 原先按原文扫，于是刚删完的 20+ 个标识符因为"注释里写着它已删除"继续报命中，
   真信号被假阳性淹没。已改成剥注释后再扫（① ② ③ ④ ⑦ 项）。
3. **`export-static.js` 这类"平时不跑"的工具最容易烂掉**：它的电台查询写着早已删掉的列，只要真跑一次就整轮失败，
   但因为快照 `radio` 恒为空、CI 里也没单独校验它的查询字段，烂了很久没人发现。
   教训：给"生产快照的工具"配一条**跨文件字段一致性断言**（本轮 51 号 R253c 就是干这个的），比指望人记得强。

### 全项目精简化（v5.6.3，站长要求"没用的全删、极大精简"）

一次**全项目**级别的清点，判据一律是"**扫出来的事实**"，不靠感觉。做法与结果：

| 批次 | 删了什么 | 判据 / 证据 |
|---|---|---|
| A | **`js/radio.js` 整个文件**（17.7KB，旧 `<audio>` 播放内核）+ 35 号 30 条内核断言 + 控制台 `radio` 命令 | 它**没有被 index.html 加载**，运行时代码里 `window.NEONRadio` 只剩 console.js 一处引用（那处必然拿不到内核）；`audit-all.js` ⑤ 项直接报"js/radio.js ❌ index.html 里没有它" |
| B | 旧「全息面板」整段（`.holo-panel/-head/-live/-grid/-cell/-foot`、`@keyframes holo-blink`，72 行）+ print 块里三个 v3.6.0 就已从 DOM 移除的装饰层 | 这些类名在 `views.js`/`app.js`/`index.html` 里**零标记**（被 `.holo-hero`/`.holo-card` 取代） |
| C | `_ppt_assets/`（33MB 一次性 PPT 工作区）、根目录 PPT/PDF（7MB）、`_push/`（249 个一次性脚本，4.5MB）、`deps/`、`config/`、两个人工样张 HTML、`db/seed/removed-posts-archive/`（6.5MB）、`db/seed/radio-*.json` | 逐个查过引用：站点与脚本都不读；审计脚本先搬去 `tools/audit-all.js` 保住 |
| D | 顺带修掉两处**真实的 CSS 破损**（v3.6.0 留下的孤儿 `}`、v5.6.2 删 keyframes 时留下的半截片段） | 括号配平长期差 1~2，浏览器静默忽略，**所有既有断言照样全绿** —— 故新增结构性守卫（见下） |

**净效果**：项目目录 **71.1MB → 20.8MB**（其中 19MB 是 `node_modules`，
站点本体与文档合计约 1.5MB）；文件数 1873 → 1567；门禁 1153 → **1125 条全绿**。

⚠ **本轮新增的门禁守卫（49 号 R244 / R244b）**：CSS 括号配平 + 顶层无孤儿声明。
起因是上面 D 那两处 —— "删规则时只删到第一个 `}`"是本项目**唯一**能让"删一半"
还不被任何断言发现的删法（既有断言只查"某条规则在不在"）。有了这条，
以后再犯会当场报红。
4. **"过期检查"比死代码更坏**：死代码只是占地方，而过期的检查会**主动在界面上说假话**。
   本轮截图实锤：v5.3.0 把三个 Markdown 库改成"渲染正文时按需注入"之后，
   启动阶段那句"若 marked/DOMPurify/hljs 不存在就报 CDN 组件加载失败"就变成了
   必然触发的假警报（文案还停在 v4.8.1 之前的 CDN 时代），于是页面顶部常驻一条红条。
   **纪律**：改"加载时机"（同步 → 按需、defer → 懒加载）时，必须回头搜一遍所有
   `typeof X === 'undefined'` 的判定点 —— 它们默认假设"到这一步就该有了"。
5. **守卫自己会被自己的注释判红（本轮第 3 次踩）**：新加的 R16e 扫的是源码原文，
   而我在注释里写了那句要禁掉的过期文案做说明 → 守卫当场报红。
   凡是"禁止出现某字符串"的守卫，一律扫 `stripComments()` 之后的内容。


## 7. 未完成 / 待决定

- **内容**：线上只有 3 篇真文章。
  ⚠ **项目当前最大的短板不是代码，是内容** —— 机器已经够用，需要的是写东西。
- **4.0 改版后的剩余项**（方案 §5 勾掉 B1~B5 之后，按建议默认缓做的）：
  - **Hero 背景图**（待选素材）；**双视觉态**（静默/狂野两套皮肤，缓做）；
    **音景**（装置④的音景位仍是占位）
  - **性能实测报告待补**：B5 终审时浏览器自动化通道故障（os error 10060），
    三档帧率未能实测 —— 已产出**分层成本模型 + 保底机制说明**（见 `docs/handover-notes/` 或活文档），
    待通道恢复后补一次实测（探针脚本思路已成型：rAF 计帧 × 四档 × 静置/滚动双状态）。
- **已知技术债**（B1/B2 已还两项，剩余）：
  - ✅ ~~`--mono` 中文字形掉新宋体~~ → 已还（Sarasa Mono SC 子集自托管，v4.0.0）
  - ✅ ~~字号体系不规范（24 种含半像素）~~ → 已还（18 种，v4.0.0）
  - ⏳ `bindEditor` 334 行，建议按关注点拆 4~5 个函数
  - ✅ ~~首屏 Hero 无背景图~~ → 已由「霓虹字标 + 9 层氛围」取代（v4.1.0）
  - ✅ ~~审计清单 ①②：cloud.js 的 base64 旧电台 API 与 app.js/views.js 的旧面板机器~~ → 已还（v5.6.1；门禁 1194→1157，用例逐条退役见 §6）
  - ✅ ~~审计清单 ③④⑤ + D：残留列引用 / 旧 dock-panel CSS（约 410 行）/ console.log 定性 / 导出器电台块~~ → 已还（v5.6.2；门禁 1157→1153）
- **剩余项（审计清单全清完之后的新清单，按建议顺序）**：
  1. **内容**（最大短板，见本节第一条）：机器已经够用，需要的是写东西
  2. Hero 背景图（待选素材）；双视觉态（缓做）；音景（装置④仍是占位）
  3. 性能实测报告待补（见上一条）→ 通道恢复后补一次实测
  4. 想再清一轮死代码/不一致时：先跑 `node tools/audit-all.js`
     （注释感知，命中更接近真信号；① ② 项只在 `version.js` 的构建日志里命中，属预期）
- **SEO（架构性限制）**：SPA 的静态 HTML 里没有正文，非 JS 爬虫抓不到内容；`robots.txt` 与 `sitemap.xml` 未提供。
  `feed.xml` 是当前唯一的缓解手段。

---

## 8. 接手第一小时建议

1. 读 `docs/handover-notes/MEMORY.md`（建立全局认知）
2. 跑一次 `npm run gate`，确认 **343/343**（v5.7.2 起裁剪到 18 个核心 case；更早的文档写过 1155 / 1157 / 1156，那是裁剪前或更早的断言数）
3. 打开线上站点，把每个页面点一遍（首页 / 归档 / 标签 / 搜索 / 收藏 / 关于 / 详情页 / 编辑器），
   再按 **Ctrl+`** 玩玩命令终端（先 `help`）、点开右上角的**装置面板**（氛围九层开关在那儿）
4. **先别改代码** —— 先写一篇真文章，用下来哪里硌手，那才是真正值得改的地方

---

## 9. 交接清单（本次交接范围）

> **4.0 改版完成注记（v4.7.0）**：B1 地基重铸（场景+氛围+排版）→ B2 门廊（字标+开场+街区）→
> B3 阅读舱（阅读框+迷你地图+时间线）→ B4 控制台（终端+反馈+装置面板）→ B5 终审（性能/a11y/一致性）。
> 五个批次全部上线，门禁 948 → 1106。

### v4.7.0 修复：快照必须确定性
首次实测 workflow 就在 data/posts.json 上产出了一个**只有 exportedAt 变化**的提交
—— 也就是每 6 小时污染一次历史，正是 workflow 里那句「无变更不提交」想避免的。
修法：writeSnapshotIfChanged 比对时忽略 exportedAt，无实质变化就不碰文件。
时间戳的含义因此变成「最后一次真正变化的时间」。

### v4.7.0 追加：Pages 可以当「对外主站」

> ⚠ **本节是 v4.7.0（2026-09-30）当时的状态记录，其中两条已被后续版本推翻，别照着做：**
> · ❌「登录/发文/编辑/上传在 Pages 上**永远**不可用」—— v4.8.0 迁到 Supabase 后 Pages **能直连数据库**
>   （Supabase 不设 Origin 白名单 + CSP 已放行 supabase 域），**登录/发文/上传在 Pages 上可用**。
> · ❌「电台音频 27MB 落地 `data/radio/`」—— v4.8.0 起**电台已退役**，音频与曲目数据都已移除。
> 现行部署说明见下方 §10。

关键前提：**CORS 是浏览器才有的限制，服务器端没有。** 所以
`.github/workflows/sync-snapshot.yml`（每 6 小时）跑在 GitHub 的服务器上，
用 Node 能直接读云端；而 Pages 网页本身读不到（Origin 白名单 + CSP）。

⇒ 内容链路：**WorkBuddy 站写文 → 云端库 → Actions 定时导出 → 提交 → Pages 重建**。

⚠ 登录/发文/编辑/上传在 Pages 上**永远**不可用 —— 所以 WorkBuddy 站必须留作写作后台。
⚠ 电台音频（27MB）以文件落地在 `data/radio/`，**不进 JSON**（否则快照变 30MB）。
⚠ 换页面的可见性/域名等设置后，记得同步更新 README 与本节。

---

## 10. 部署与两套地址（v4.8.0 更新）

| | 本地 / 自建静态托管 | GitHub Pages |
|---|---|---|
| 地址 | `http://127.0.0.1:8898/`（本机预览，`dev serve`） | `https://1liiang.github.io/cyberpunk-blog/` |
| 仓库 | 无 | `github.com/1liiang/cyberpunk-blog`（公开） |
| 内容来源 | **Supabase（实时）** | **Supabase（实时）** —— 连不上时自动回退 `data/` 快照 |
| 登录/发文/上传 | ✅ | ✅（v4.8.0 起：Supabase 不设 Origin 白名单，CSP 已放行 `*.supabase.co`） |

⚠ **v4.8.0 的结论变化**：旧平台按 Origin 白名单放行（`*.github.io` → 403），所以 Pages 只能读
同源快照；**Supabase 不设这道闸**（浏览器直连是它的正常用法）。放开 CSP 的 `connect-src` 之后，
Pages 也能直连数据库 —— 于是 `data/` 快照从"唯一出路"退化为"**兜底**"
（免费档暂停、额度用尽、网络故障时站点照常能看）。`withFallback` 的机制完全保留。

静态快照仍由 `tools/export-static.js` 刷新（`.github/workflows/sync-snapshot.yml` 每 6 小时一次）：

```bash
node tools/export-static.js      # 刷新 data/ 快照（音频已退役，现在很轻）
git add -A && git commit -m "chore: 刷新静态快照" && git push
```

> ⚠ 该脚本已改为读 Supabase（PostgREST），并带**音频增量拉取**（本地同尺寸就跳过下载）——
> 否则每 6 小时全量拉一次音频会把免费档 5GB/月的额度吃光。

### v5.7.2 追加：仓库布局与发布流程（**今后照这个做，别再借道克隆**）

⚠ 先说清一件容易搞混的事：**本仓库（工作区）与 GitHub 远端（站点本体）不是同一层。**

| | 内容 |
|---|---|
| 本地仓库 `F:\个人网站` | **整个工作区**：`app/`（站点本体）+ `db/` `docs/` `dev.cmd` `接手报告.md` … |
| 远端 `1liiang/cyberpunk-blog` | **只有站点本体**：根就是 `index.html` / `js/` / `css/` / `data/` … |
| 对应关系 | 远端根 == 本地 `app/` 的内容（**一一对应，只差路径前缀**；实测唯一差异是一个文件的行尾 CRLF↔LF） |

所以远端**不能**直接收本地主线的合并 —— 那会让远端根同时出现 `js/` 和 `app/`，
线上多出一棵重复的站点树，还会把 `接手报告.md`、`db/seed/` 等工作区资料推到公开仓库。

**正解：`deploy` 分支。** 它的历史接在本地主线之后，但**根树直接取 `main:app` 的子树对象**
（不复制、不重写任何文件）：

```bash
# 发布（改完 app/ 并 bump 之后）
git update-ref refs/heads/deploy \
  "$(git commit-tree $(git rev-parse main:app) -p $(git rev-parse main) -m 'deploy: 发布基线')"
git push origin deploy:main
```

> 若 `deploy` 的父提交与远端 main 无共同祖先，push 会被拒（non-fast-forward）。
> 此时**不要强推** —— 造一个合并提交，让远端历史作为祖先保留、树取 deploy：
> `git commit-tree <deploy^{tree}> -p <origin/main> -p <deploy> -F msg` 再 `git push origin <sha>:refs/heads/main`。

#### ⚠ 行尾事故：`.gitattributes` 是必需的，别删

**症状**：本地门禁 5 项红 —— `R16c`（三处 vendor sha384）、`R18`、`R19` 全都报
「档案哈希不符」。文件明明没改过。

**根因**：仓库里曾有带 CRLF 的脚本，而 `.gitattributes` **不存在**，于是 Git 把
`js/vendor/*.min.js` 当**文本**处理，`checkout` 时把 LF 换成 CRLF —— 字节变了
（highlight 多出 1261 字节 = 1261 个 CRLF），记录在 `js/vendor/README.md` 的 sha384 自然对不上。

**关键判断：线上没受影响。** 已从线上逐文件取字节核对：四个 vendor 文件都是
**纯 LF、CRLF 计数 0**，sha384 与档案逐字符一致。因为发布走 `robocopy` 复制**原始字节**，
不经过 Git 的换行转换。（教训：**别只看本地门禁红就以为线上坏了** —— 先分别验字节。）

**修法**（已在仓库生效）：
- `.gitattributes`：`js/vendor/** -text`（发布物即其字节，禁一切转换）；
  图片/字体/压缩包 `binary`；`*.js/css/html/json/md/yml/sql` 统一 `eol=lf`；
  `*.cmd` `*.bat` 保持 `eol=crlf`（Batch 对 LF 兼容性不佳）
- 仓库级 `core.autocrlf=false` / `core.eol=lf`
- 工作区一次性规范化：16 个 CRLF 文件转 LF（15 转换 + `dev.cmd` 按规则跳过）

`R175t「源文件行尾统一为 LF」` 只覆盖 `app/js/*.js` 与 `app/css/*.css` ——
**Windows 批处理（`dev.cmd`）不在其列**，那里保持 CRLF 是刻意的。

#### 发布三步（照抄即可）

```bash
# ① 改完 app/ 并 bump + 跑门禁（必须 343/343）
cd app && node tools/bump.js <新版本> --title="…" --item="…" --yes && node tests/run-all.js

# ② 更新 deploy 分支（根 = main:app 的扁平内容；不碰工作区）
cd .. && git update-ref refs/heads/deploy \
  "$(git commit-tree $(git rev-parse main:app) -p $(git rev-parse main) -m 'deploy: 同步')"

# ③ 推 —— 若被拒（deploy 与远端 main 无共同祖先），改用合并提交：
#    tree 取 deploy，父 = [origin/main, deploy]，然后 push origin <sha>:refs/heads/main
git push origin deploy:main
```

⚠ **不要对远端强推**：远端 main 是 Pages 的发布源，强推会重写公开历史。
正确的做法始终是"造一个祖先包含 origin/main 的提交"（上面 ③ 的备注）。

**标签**（在远端）：`v5.7.1` / `v5.7.2` / `perf-hardening` / **`pre-trim`**。
`pre-trim` 是**裁剪前的完整门禁**（56 个 case / 1111 断言 + 完整电台功能），
取回被删用例只需：`git checkout pre-trim -- app/tests`。

### v5.7.2：电台彻底下线 + 门禁裁剪到核心

- **电台功能整体删除**（用户要求「旧电台也全删了」）：`cloud.js` 的 Radio 数据面与
  `RADIO_*` 常量、`views.js` 的 `radioView`、`app.js` 的常驻控制台与条目代理、
  `index.html` 的 `#radio-stage`、`css` 的复古收音机样式、快照与导出器的 `radio` 段，
  以及**为电台 iframe 放宽的 CSP `frame-src music.163.com`**（顺带收紧了安全面）。
  ⚠ 保住了 `SIGNED_TTL_*` 与 `clampTtl` —— 它们物理上夹在电台段中间，但属于**附件下载**。
- **门禁裁剪**：54 → **18 个核心 case**，断言 1031 → **298**，门禁 **343/343**。
  保留：主流程三件、供应链、版本一致、CSP、快照回退、Supabase 适配、配色与对比度、
  减少动效、收藏、氛围契约、终端设备契约、结构终审，以及 P0/P1/P2 三个硬化用例。
  ⚠ 被删的用例里有若干守的是**活功能**（键盘可达、折叠、阅读进度、编辑器文本、
  图片收口、草稿、OG 卡片…）—— 删它们是为了缩小门禁规模，不是"它们没用了"。
- **三次踩坑（都记在 §5）**：删 CSS 时把 `*/` 删掉却留着 `/*` → 未闭合注释吞掉后面
  2000+ 行（而括号配平仍显示 0，因为扫描器也跳过了注释）；删 `@media print` 里的
  `.radio-console,` 时连坐后面的选择器；切测试块时吃掉块的 `{` 留下孤立 `}`。

⚠ 仓库是**公开**的（用户 2026-09-30 确认「全部公开」），所以仓库里的一切
（含本交接文档）都对外可见。往里加东西前先想一下这一点。（历史审计报告已于 v5.6.3 清理。）

> ⚠ **一处已知的过时注释（待办）**：`.github/workflows/sync-snapshot.yml` 头部的说明
> 写的还是迁移前的架构（"Pages 读的是仓库里的 data/ 快照"、"Pages 网页读不到云端"）。
> **架构以上一节与本文件 §4 为准**：v4.8.1 起 Pages **直连 Supabase**，快照只是云端
> 不可达时的兜底；那个 workflow 现在的职责是**保持兜底新鲜**（行为一字未变，只是说明过时）。
> 更新那段注释需要 token 具备 **Workflows: Read and write** 权限 —— 只有 Contents 权限时，
> GitHub 会以 403 `Resource not accessible by personal access token` 拦下，
> **Git Data API 与 Contents API 都一样**（两条通道都实测过），或在 GitHub 网页上直接编辑该文件。

>
> **v4.5.0 出厂色相改为紫（285）**：站长在配色面板挑中「紫」并拍板定为全站出厂色相。
> ⚠ 手上有这个项目的人必须知道的**唯一**要点：改默认值 ≠ 改了所有人的观感 ——
> 老用户浏览器里存着 `neon_hue=184`（旧默认），与「真的挑了青」无法区分。
> 故有「旧默认值 184 + 无 `neon_hue_pick` 标记 ⇒ 视为从未选过」这套迁移，
> 且判据在 **theme-boot.js / app.js / views.js 三处必须同口径**（详见 50 号用例的头部注释）。
> 别只改 `--hue` 那一个数字就以为完事。收尾 v4.4.1 把数字雨从 Canvas 擦除法换成 **DOM 列法**
> （拖尾长度/强度/密度全面收紧，滚动损耗压到零）。⚠ v5.6.3：改版的完整设计文档
（原 `docs/archive/4.0-改版方案.md`）已随历史归档清理删除 —— 设计取向的结论都
留在本节的注记与各源码注释里，完整原文在 git 历史中可查。

| 项 | 状态 |
|---|---|
| 代码 | ✅ 项目目录完整保留 |
| 深度笔记 | ✅ 已附 `docs/handover-notes/`（快照） |
| 云端数据 | ⏸ **未转移**（仍在当前账号的云服务里，同环境继续用即可） |
| 部署 | ⏸ **未转移**（线上仍由当前账号发布） |
| 账号 / 域名 | ⏸ 未涉及 |

> 若以后需要**彻底移交**（对方带走数据与部署），额外要做：导出云端数据（`posts` / `post_images` / `tags` / `radio_tracks`
> 四张表，注意图片与音频是 base64 需一并导出）→ 对方重建自己的云服务 → 替换 `resourceId` →
> 重新发布（域名会变）。这部分工作**本交接包未包含**。
