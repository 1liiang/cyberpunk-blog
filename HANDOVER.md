# NEON://DIARY — 交接文档

> **给接手的人**：这份文档假设你对这个项目**一无所知**。读完前两节你就能改代码、跑验证、发版本。
> 想深入，看第 6 节指向的三份笔记 —— 那里面是真正的经验（尤其"踩过的坑"）。

**交接日期**：2026-09-30 ｜ **版本**：v4.8.0（**数据层已从 WorkBuddy 云迁到 Supabase**） ｜ **门禁**：1135/1135 全绿 ｜ **线上**：本地预览与 GitHub Pages 均在跑

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
- **Markdown**：`marked` + `DOMPurify`（CDN 引入，带 SRI）
- **线上地址**：`https://cyberpunk-blog.app.workbuddy.host/cyberpunk-blog/`
  ⚠ **必须带 `/cyberpunk-blog/` 子目录**；根路径 `/` 是**停在 2.3.0 的遗留快照**，平台不清理，别拿它当线上

---

## 2. 五分钟上手

```bash
cd cyberpunk-blog

npm run gate        # ★ 全量门禁（1106 条断言）。改任何东西之后都跑它
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
│   ├── cloud.js        云端封装（数据表访问、图片压缩、音频）
│   ├── radio.js        电台播放器
│   ├── keys.js         快捷键（含 Ctrl+` 唤起终端、Esc 优先级链）
│   ├── theme-boot.js   ★ 首绘前脚本（主题/色相/氛围三件都在这里定，必须独立不能依赖 app.js）
│   ├── scene.js        ★ 4.0 场景框架（路由→场景→氛围层集；手动优先链；reapply）
│   ├── atmo.js         ★ 4.0 氛围运行时（数字雨 DOM 列法 + 帧率保底与自动降档）
│   ├── boot.js         4.0 开场序列（首访终端自检；CSS failsafe 兜底自退场）
│   ├── tap.js          4.0 点击反馈（三档；hover + reduce 双闸）
│   ├── console.js      ★ 4.0 命令终端（Ctrl+`；九命令 + 彩蛋；DOM 惰性构建）
│   ├── wordmark-paths.js  4.0 霓虹字标字形数据（**生成物**——字体转曲，勿手改）
│   └── version.js      版本号 + 完整版本演进 LOG（**改代码必须同步 bump**）
├── tests/
│   ├── run-all.js      门禁入口
│   ├── cases/          47 个用例 + manifest.json（★ 新增 case 必须登记）
│   └── fault-matrix.js / sandbox-p2.js / regress.js
├── tools/
│   ├── bump.js         版本号提升脚本
│   └── gen-feed.js     RSS 生成
└── docs/handover-notes/   ← 本交接包附带的深度笔记快照（见第 6 节）
```

**代码规模参考**：`app.js` 约 3700 行、`views.js` 约 1500 行、`style.css` 约 5300 行。
`bindEditor` 是唯一超过 300 行的函数（334 行），重构它属于已知技术债。

---

## 4. 后端资源（关键）

**当前：Supabase**（v4.8.0 起）

| 项 | 值 |
|---|---|
| 项目 ref | `taxrgizbmgwzxnvlxudq`（区域 ap-southeast-1 / 新加坡） |
| 项目 URL | `https://taxrgizbmgwzxnvlxudq.supabase.co`（写进 `cloud.js` 的 `endpoint`，**只填基址**） |
| 公开键 | `sb_publishable_…`（写进 `publishableKey`；设计上随前端公开，权限由 RLS 管） |
| 数据表 | `posts`（文章）、`post_images`（图片）、`radio_tracks`（电台，**已退役、0 行**）、`error_logs`（前端错误上报） |
| 读视图 | `public_images`（匿名读图，不含 owner_id）、`public_radio`（匿名读电台） |
| 认证 | 匿名可读已发布内容；写入需登录（`ACCESS` 入口）。**发码走邮件验证码**（`signInWithOtp` + `verifyOtp`） |
| 建库资料 | `db/schema.sql`（DDL）+ `db/bootstrap-1-schema-posts.sql` / `bootstrap-2-image.sql`（粘 SQL Editor 即可建库） |
| 建库/灌数据脚本 | `db/tools/import-to-supabase.js`（直连）、`db/tools/verify-supabase.js`（真后端验收） |

⚠ **三个必须知道的怪点**（前两个是历史取舍，第三个是 Supabase 特性）：

1. **图片以 base64 存在数据库里**，不走对象存储。原平台的对象存储只服务登录用户，而博客图片必须匿名可读。
   后果：表行有长度上限（`data` ≤ 3.6M 字符），所以上传管线会**自动压缩**（`cloud.js` 的 `compressImage`）。
   （Supabase 的 Storage 支持公开桶，将来若想改成对象存储，这是一次独立改动。）
2. **读视图与写基表的字段不能混用** —— `has_data` 是视图算出来的列，写路径引用它会报 42703
   （v2.9.2 事故，详见 `PROJECT-NOTES.md` §1.3）。
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

## 5. 必须知道的纪律（都是踩过的坑）

### 发布与版本

- ⚠ **`?v=` 是唯一的缓存击穿手段**。改了 `js/` 或 `css/` **必须 bump 版本号**，否则用户拿到旧文件。
  `--refresh-id` 只刷新 BUILD_ID，**对缓存零作用**。
- ⚠ **bump 的 `--title` / `--item` 里一律用「」，不要用双引号** —— 嵌套双引号会让 shell 提前闭合引号、
  参数错乱、**bump 静默失败**（版本号没变）→ 此时发布 = `?v=` 未变 = 缓存击不穿。**bump 后必须校验 `BUILD`**。
- ⚠ **发布后验证必须用 GET**（禁用 `curl -I`），并带 `--compressed`；`verified: true` ≠ 已传播，
  **必须核对 `?v=` 与 BUILD_ID**。
- ⚠ 发布返回的 `shareLink` 是**根路径的遗留快照**，不要原样转给用户 —— 正确地址永远带 `/cyberpunk-blog/`。

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
- **SEO（架构性限制）**：SPA 的静态 HTML 里没有正文，非 JS 爬虫抓不到内容；`robots.txt` 与 `sitemap.xml` 未提供。
  `feed.xml` 是当前唯一的缓解手段。

---

## 8. 接手第一小时建议

1. 读 `docs/handover-notes/MEMORY.md`（建立全局认知）
2. 跑一次 `npm run gate`，确认 1135/1135
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

⚠ 仓库是**公开**的（用户 2026-09-30 确认「全部公开」），所以仓库里的一切
（含安全审计报告、本交接文档）都对外可见。往里加东西前先想一下这一点。

>
> **v4.5.0 出厂色相改为紫（285）**：站长在配色面板挑中「紫」并拍板定为全站出厂色相。
> ⚠ 手上有这个项目的人必须知道的**唯一**要点：改默认值 ≠ 改了所有人的观感 ——
> 老用户浏览器里存着 `neon_hue=184`（旧默认），与「真的挑了青」无法区分。
> 故有「旧默认值 184 + 无 `neon_hue_pick` 标记 ⇒ 视为从未选过」这套迁移，
> 且判据在 **theme-boot.js / app.js / views.js 三处必须同口径**（详见 50 号用例的头部注释）。
> 别只改 `--hue` 那一个数字就以为完事。收尾 v4.4.1 把数字雨从 Canvas 擦除法换成 **DOM 列法**
> （拖尾长度/强度/密度全面收紧，滚动损耗压到零）。改版的完整设计文档在 `4.0-改版方案.md`。

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
