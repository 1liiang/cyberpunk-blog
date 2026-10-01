> ⚠ **v5.6.3 清理说明**：本文多处引用 `_push/tools/*.js`、`_push/README.md`（一次性部署与排障脚本）。
> 那个目录已整体删除（249 个文件，4.5MB）—— 本文里的引用作为**历史取证记录**保留，
> 不要再去找那些脚本；仍然有用的那一个（全项目审计）已移到 `app/tools/audit-all.js`。

# Supabase 建项目 + 交接清单

> 这份是给**站长**看的操作清单。你在 Supabase 点几下、把两样东西给我，
> 后面的建表、灌数据、验证都由我来做（脚本已写好：`db/tools/import-to-supabase.js`）。
>
> 目标：让站点恢复 **登录 / 发文 / 图片上传 / 电台管理**，同时保持"没后端也能看"的只读快照模式。

---

## 0. 先明确一件事：为什么是「连接串」而不是 service_role key

你之前选的是"给我 service_role key，我自动建库+导入"。实际动手时发现一个硬边界：

- **service_role key 只能走 PostgREST（数据面）** —— 它能读写表，但**建表（DDL）不是数据面能力**，
  PostgREST 没有"执行任意 SQL"的入口。
- 建表只有两条路：① 你在网页的 SQL Editor 里粘一遍 `db/schema.sql`；② 给我**数据库连接串**（直连 Postgres）。

**推荐②**：一条通道全包（建表 + 灌 45MB 数据 + 回验），而且 27MB 的电台音频走直连最稳
（PostgREST 塞 16MB 的 JSON 请求体容易撞平台请求体上限）。

代价：连接串里有数据库密码，属于敏感信息。**用完你立刻在 Supabase 改一次数据库密码即可作废它。**

---

## 1. 建项目（约 3 分钟）

1. 打开 <https://supabase.com/dashboard>，用 GitHub 或邮箱登录
2. **New project**
   - **Name**：`neon-diary`（随意）
   - **Database Password**：点 **Generate a password**，**先复制存好**（第 3 步要用）
   - **Region**：选离你近的 —— 国内建议 `Southeast Asia (Singapore)` 或 `Northeast Asia (Tokyo)`
   - **Plan**：Free 就够（本站数据约 45MB，免费档 500MB 库 + 5GB/月流量）
3. 等 1~2 分钟，项目状态变成 **Active**

> 💡 流量：**电台已退役，这块不再有压力** —— 原先 3 首音频以 base64 存库，
> 每播放一次要传约 12MB（5GB/月免费额度 ≈ 400 次播放）。现在站点只剩文章与图片
> （图片走缩略图，单页几百 KB 量级），日常使用离额度上限很远。
> 哪天要把歌曲加回来，再评估"音频改走 Storage 公开桶"（支持流式与 Range 拖动）。

---

## 2. 认证设置（约 2 分钟）

左侧 **Authentication**：

1. **Providers → Email**：确认是 **Enabled**
2. **Confirm email**：
   - 自测阶段建议**先关掉**（`Authentication → Sign In / Providers → Email → Confirm email` 关）
     —— 否则每次注册都要去邮箱点确认链接才能登录
   - 站点正式对外时再打开（更安全）
3. **Email Templates → Reset Password**（重要）：
   本站的"找回密码"流程是**邮件里的 6 位码 + 新密码**，不是点链接跳回来。
   请把模板正文里的 `{{ .ConfirmationURL }}` 换成 `{{ .Token }}`，例如：

   ```html
   <h2>重置你的接入密钥</h2>
   <p>验证码：<strong>{{ .Token }}</strong></p>
   <p>把上面这 6 位数字填进站点的「忘记密码」页即可重设密码。</p>
   ```

   （同理，**Magic Link** 模板若被用到，也建议带上 `{{ .Token }}`。本站只用到验证码登录与重置。）

---

## 3. 建库与灌数据 —— ✅ **已完成（2026-09-30）**

> **这一节你不需要再做了。** 接手方用你给的 **Supabase PAT** 走 Management API 直接跑完了：
> 结构 + 4 篇文章（`posts=4 published=4`）+ 图片（2MB，拆 7 片追加，拼回后 sha256 与本地原件一致）。
> 随后做了三层验证：外部完整性、真后端验收（`db/tools/verify-supabase.js` 全绿）、真浏览器确认
> `NEON.isSnapshot() === false` 且图片来自库内 base64。详见 `MIGRATION.md` §0。

### 3.1 已经就位的

| 东西 | 状态 |
|---|---|
| Project URL | ✅ 已填进 `app/js/cloud.js`（`https://taxrgizbmgwzxnvlxudq.supabase.co`，末尾 `/rest/v1/` 已剥掉） |
| publishable key（`sb_publishable_…`） | ✅ 已填进 `publishableKey`；实测被 REST 接受 |
| 数据库结构 + 种子数据 | ✅ 已建（4 篇文章 / 1 张被引用的图 / 0 首电台） |
| Auth 通道 | ✅ 实测：陌生邮箱探测返回 `otp_disabled / Signups not allowed for otp`（正是适配器判"新用户"的依据）；`Confirm email` 当前是**关**的 |

### 3.2 备用通道：两个 bootstrap SQL（本次没用上，留作以后换项目时用）

若将来换到新项目，或需要**不交出任何凭据**地建库，就粘这两个文件（各一次 Run）：

1. `db/bootstrap-1-schema-posts.sql`（16 KB）= 结构 + 4 篇文章 + 序列重置 → 期望 `posts=4 published=4`
2. `db/bootstrap-2-image.sql`（2 MB）= 被引用的那张图 → 期望 `文章 4 篇（已发布 4） / 图片 1 张 / 电台 0 首（已退役）`
   ⚠ 2MB 粘贴若卡顿，可把图重编码成 WebP（约 150 KB）再给一版

两个文件都在**真 Postgres（PGlite 18.3）**上整篇验过；重复执行安全（只报一句 `policy ... already exists`）。
若用 SQL Editor 跑不动大文件，也可以用 **Management API**（PAT）跑 —— 见 `_push/tools/mgmt-run.js`。

### 3.3 为什么不用数据库密码（两条硬证据）

① 直连域名 `db.<ref>.supabase.co` **只有 AAAA（IPv6）记录**，IPv4 网络连不上（实测 `ENOTFOUND`）；
② Session pooler（`aws-0-ap-southeast-1`，项目在新加坡）能认到租户、进到密码校验，但报 `28P01 密码认证失败`。
Supabase 的库密码**只在建项目或点 Reset 时显示一次**，之后仪表盘不再显示原文 —— 拿不到很正常，
而**建库根本不需要它**。

---

## 4. 我拿到之后会自动做完这些（不需要你操作）

1. `db/schema.sql` 建表 / 视图 / RLS / 索引（含"已发布内容匿名可读"的读视图）
2. 灌 seed：**4 篇文章 / 4 张图（含 1 张缩略图）/ 0 首电台**
   （原始时间戳保留，首页顺序不变；**电台已按你的要求退役**，音频不进新库）
3. 重置自增序列（否则你发新文会主键冲突）
4. 回验：条数、图片 sha256、**归属自检**（防"owner_id 忘了改写"）
5. 填好 `cloud.js` 的 URL / anon key，本地跑一遍全链路：
   **列表 → 详情 → 图片 → 注册 → 登录 → 发文 → 图片上传 → 退出**
6. 跑 `dev gate`（1135 条）确认没砸坏任何东西

> **这些已经在一台"真 Postgres"上预演过了**（PGlite / Postgres 18.3，纯内存实例）：
> `schema.sql` 整篇可执行、导入器把 45MB 种子全灌进去并回验通过、
> RLS 的"匿名能看什么 / 登录后能改什么"逐条验过、库层 CHECK 也会真拦住超限数据。
> 预演还抓出并修掉了一个真 bug（导入器保留旧平台 owner_id → 你注册后那步改归属会静默失效）。
> 所以这一步在真项目上应当是"照剧本走一遍"，而不是"试试看"。取证脚本：`_push/tools/test-schema-pglite.js`。

## 5. 之后**只剩你做两步**

1. 在站点上**注册你自己的账号**（ACCESS → 注册：邮箱 + 昵称 + 密码 + 邮件验证码）
2. 告诉我一声 —— 我把 4 篇旧文章的 `owner_id` 从 `legacy-import` 改成你的 uid，
   这样**你登录后就能直接编辑这 4 篇**（不改的话它们只读，你只能发新文）

---

## 6. 已知边界（先说清楚，免得做完才发现）

| 项 | 说明 |
|---|---|
| 旧账号密码 | WorkBuddy 平台托管，任何通道都拿不到 → 你需要在 Supabase 重新注册 |
| 旧主站 | `cyberpunk-blog.app.workbuddy.host` 继续存在（它有自己的库），迁移后它与新站是两套数据 |
| GitHub Pages | 只读快照模式照旧（无后端），CSP 仍只放行同源 + `*.supabase.co` |
| 音频流量 | 见第 1 节的 5GB/月提示 |
| 免费档休眠 | Supabase 免费项目**长期无请求会暂停**（一般 7 天）；被暂停后首次访问会失败，去仪表盘点一下即可恢复 |
| 自建 Postgres 的话 | `schema.sql` 依赖两样 Supabase 预置的东西：**`auth.uid()` 函数**与 **`anon` / `authenticated` 角色**，另外 Supabase 对 `public` 下新建的表默认就把权限授给了这两个角色（RLS 才是真正的闸），所以脚本里没重复 GRANT。换到自建库要自己补这三样（预演脚本 `_push/tools/test-schema-pglite.js` 里就有现成的补法） |
