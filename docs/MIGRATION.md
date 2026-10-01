> ⚠ **v5.6.3 清理说明**：本文多处引用 `_push/tools/*.js`、`_push/README.md`（一次性部署与排障脚本）。
> 那个目录已整体删除（249 个文件，4.5MB）—— 本文里的引用作为**历史取证记录**保留，
> 不要再去找那些脚本；仍然有用的那一个（全项目审计）已移到 `app/tools/audit-all.js`。

# docs/MIGRATION.md — 迁移指南

### 三首歌曲的处置（2026-10-01，已收口）

- **已做**：当前树删除（Pages 404）→ 电台数据置空 → 本机副本随瘦身清理删除 →
  **历史重写**（`data/radio/**` 从全部 12 个提交移除）→ 强推（远端 HEAD `07b4884`）。
  仓库侧核对：**0 tag、0 release、只有 main 分支、Pages 全 404**。
- **残余（站长的决定：不再处理）**：GitHub 是内容寻址存储，重写只让旧对象**不可达**，
  并未销毁 —— 按旧 SHA 仍可经 *blob API* 与 *旧提交的 codeload tar.gz* 取到那三个文件
  （实测 200）。这两条路都**要求先知道旧 SHA**，而旧 SHA 未写入仓库、也未出现在任何公开索引里；
  GitHub 会在某个时点 GC 掉不可达对象（无 SLA）。
- **若日后要彻底销毁**（两条路都随时可走，材料还在 `F:\neon-rw\repo`）：
  **A** 删库重建（需 token 有 Administration + Pages + Workflows 权限，停机几分钟，URL 不变）；
  **B** 请 GitHub Support 清除不可达对象（不停机，等几天）。

> ⚠ **2026-10-01 历史重写**：为彻底删除仓库历史里的 3 首商业歌曲，用 `git filter-branch`
> 重写了全部历史并强推（`data/radio/**` 从**所有**提交中移除，仓库 32 MB → 5 MB，12 个提交结构与提交信息不变）。
> **代价：所有提交 SHA 都变了** —— 本文档此前引用的旧号已失效，映射见 `_push/README.md`。

> 写给「接手这个迁移包的人或 agent」。先读根目录 `README.md` 了解包结构，
> 本文回答**下一步去哪、怎么去、路上有什么坑**。

## 0. 本轮进展（2026-09-30，路线 B 实施中）

| 阶段 | 状态 | 说明 |
|---|---|---|
| SDK 边界替换 | ✅ 完成 | `js/cloud.js` 的 `init()` + `makeAuthAdapter()`；业务逻辑未动 |
| 电台退役 | ✅ 完成 | 2026-09-30 站长决定**不做歌曲部分**：3 首商业歌曲（27MB）的音频已从仓库与快照删除、不导入新库；`radio_tracks` 表结构与界面保留（访客看不到空播放器，站长登录后仍有上传入口）。快照 `radio` 置空，R253 改成**决策锁**（再出现曲目即报红） |
| 依赖托管 | ✅ 完成 | `js/vendor/supabase-js.js`（2.117.2，sha256 见 `js/vendor/README.md`） |
| CSP | ✅ 完成 | `connect-src` 加 `*.supabase.co` |
| 测试桩与供应链断言 | ✅ 完成 | 桩改成 Supabase 形状；两个 SDK 各自成档；**新增 52 号用例**（auth 适配 28 条） |
| 工具链改写 | ✅ 完成 | `export-static.js` / `export-cloud-full.js` 指向 PostgREST；前者已用 mock PostgREST 端到端实证（含增量拉音频，省额度） |
| 回归网 | ✅ 完成 | 门禁 **1135/1135 全绿**（52 号 28 条 + CSP connect-src 1 条）；52 号做过**反向验证**（摘掉修复 → 4 条报红 → 还原 sha256 逐字节一致） |
| 本地真库预演 | ✅ 完成 | 用 **PGlite（WASM 版真 Postgres 18.3）** 把 `schema.sql` + 导入器 + RLS 全跑了一遍 —— 见下方「预演抓到的 bug」 |
| 建库 + 灌种子 | ✅ **完成** | 项目 `taxrgizbmgwzxnvlxudq`（ap-southeast-1）。**Management API（PAT）**跑 `db/bootstrap-1-schema-posts.sql` → 返回 `posts=4 published=4`；图片 2MB 超大 → 拆 7 片追加（`_push/tools/mgmt-run.js`），拼回后 **sha256 与本地原件逐字节一致** |
| 全链路实测 | ✅ **完成** | ① 外部完整性：图片 sha256 一致 / 4 篇字段完好 / owner_id 不外泄 / 匿名读不到草稿与基表；② `db/tools/verify-supabase.js` 全绿：注册→草稿→图片→发布→匿名可见，且**改不到别人的、草稿对匿名不可见**；③ 真浏览器：首页 4 卡从库里出图、详情页正文图是 `data:image/…`、`NEON.isSnapshot() === false`；④ **应用层端到端**（`_push/tools/test-app-e2e.js`）：在 jsdom 里跑**站点真实的 cloud.js**，走它自己的 `NEON.Auth.sendOtp → 邮件取码 → verifyOtp（含设密码）→ Posts.create/update/listPublished → Images.insert/fetchMany/dims`，全绿并清理干净 |
| 版本 bump | ✅ **完成** | **4.7.0 → 4.8.0**（LOG 8 条 + 15 处 `?v=` + package.json 同步；门禁仍 1135/1135） |
| 文档同步 | ✅ 完成 | `HANDOVER.md`（新增"v4.8.0 迁移要点"+ 后端章节重写 + 部署章节更新）、`README.md`（数据来源章节重写）、`config/README.md`、`docs/SUPABASE-SETUP.md` |
| 推送到 GitHub | ✅ **完成** | 提交 `5172313`（23 个 tree 条目：新增 2 / 修改 18 / 删除 3）。回验：本地 120 个文件与远端**逐字节一致**；**Pages 约 15 秒重建完成，线上已是 v4.8.0**；三个 mp3 在仓库与 Pages 上均已 **404**；真浏览器实测线上站**直连 Supabase**（详情页正文图是库内 base64，快照路径 0 次命中） |
| 跟进批：本地托管 + db/ | ✅ **完成** | 提交 `58b0998`（新增 6 / 修改 13 / 跳过 1）。**v4.8.1**：marked / DOMPurify / highlight.js 三个库收回本地（`js/vendor/`），CSP 收窄为 `script-src 'self'` ⇒ **全站零外部脚本域**；`db/`（schema.sql + 生成器 + 说明）进仓库。回验：本地 128 个文件与远端逐字节一致；线上已是 **v4.8.1**、三个 vendor 文件 HTTP 200；真浏览器实测线上 `#/post/1` 代码块 `class="language-js hljs language-javascript"`（**本地 hljs 生效**）、无降级提示、无白屏面板 |
| 文档同步 | ✅ 完成 | `HANDOVER.md`（新增"v4.8.0 迁移要点"+ 后端章节重写 + 部署章节更新）、`README.md`（数据来源章节重写）、`config/README.md`、`docs/SUPABASE-SETUP.md`、`feed.xml` 重新生成、`index.html` 分享卡片改指线上站、`db/README.md` |
| 瘦身清理 | ✅ **完成** | 提交 `66fb96b`（删 5 个文件 / 改 6 个）+ `33a84b3`（B 档搬迁）+ `ed6fa7a`（README 目录树）。工作区 **72.02 → 37.48 MB**；仓库 `app/` **6.99 → 4.78 MB**（不含 node_modules，129 → 124 个文件）。详见 `_push/README.md` 的"瘦身清理"一节。⚠ **本迁移包所在的源目录（`C:\Users\liu\WorkBuddy\2026-09-30-21-07-55`）已按站长指示删除** —— 上面提到的"迁移包里有什么"现在是历史描述，如需原件只能从仓库 `66fb96b` 之前的提交或 App 的导出功能取 |
| 历史文档归档 | ✅ **完成**（后于 v5.6.3 **整体删除**）| 当年把 15 个历史文档（319.7 KB）从 `app/` 根目录移入 `app/docs/archive/`。⚠ **v5.6.3 按"只留当前需要的"把整个 archive/ 删除了**（16 份 322KB）——它们记录的是已退役架构（CDN 时代、2.x 规划、base64 音频）与过期发布说明；有复发风险的教训已收进 `js/version.js` 的**历史事故索引**，设计取向的结论留在 HANDOVER 与源码注释里，完整原文在 git 历史中可查。49 号 R243b 相应改判为"守 HANDOVER 里的四批注记"|
| v4.9.0 收藏改账号功能 | ✅ **完成并上线** | 站长规则：**只有登录了才能收藏，未登录只能浏览**。收藏从 `localStorage` 搬到 `bookmarks` 表（跟账号走）；旧版本机收藏在首次登录时自动并入。库层：主键去重 + 外键级联 + 三条 RLS 策略 + **显式 revoke 掉 anon**。顺带修掉一个老 bug：卡片收藏按钮走冒泡委托会被卡片跳转处理器抢先（点收藏顺带打开文章），改捕获阶段。测试新增 **53 号用例 19 条行为断言**，门禁 1136 → **1155**。建表用 Management API 完成（提交 `07b4884` 推送）：`has_table_privilege` 核对 **anon 全 false / authenticated 全 true**、RLS 已启用、外键 cascade；真后端验收全绿（含 6 条收藏断言：匿名 permission denied、本人可收藏、重复幂等、**他人读不到我的**、可取消）。线上已是 **v4.9.0**，真浏览器实测访客 4 张卡的收藏按钮均为锁定态（🔒 + 「登录后可收藏」） |

> ⚠ **歌曲仍在 GitHub 历史里**：`data/radio/{4,5,6}.mp3` 已从当前树删除（仓库与 Pages 都 404 了），
> 但**提交历史里还在**（`git log --diff-filter=D` 或旧提交的 raw 链接仍可取到）。
> 要彻底抹掉得重写历史（`git filter-repo` / BFG）并强推，或请 GitHub Support 处理 —— 属于独立决定，
> 本次瘦身**没有**动历史。另：本机那三份副本（迁移包/旧站副本/云端备份里各一套）已随 D 档删除，
> 所以现在唯一的残留就是 GitHub 历史。

> ⚠ 一处**未推**的小改动：`.github/workflows/sync-snapshot.yml` 的头部注释（说明已从"Pages 读不到云端"
> 更新为"快照现在是兜底"）。原因：**改 workflow 文件需要额外的 Workflows 权限**，只有 Contents 权限的
> fine-grained token 会被 GitHub 以 403 `Resource not accessible by personal access token` 拦下。
> 这次做了**干净的对照实验**钉死根因：同一 base tree 上，只含该 workflow 文件的 tree → **403**，
> 只含 `db/README.md` 的 tree → **201**（与批次里其它文件无关）。
> 该文件**行为未变**（cron / dispatch / 写权限 / 空提交保护全都没动），只是注释。
> 想要它上去：给 token 勾上 **Workflows: Read and write** 再推一次（一条命令），或在 GitHub 网页上手动改。

### 一次真实事故（值得记住）

迁移期间我改了 `js/cloud.js`（指向 Supabase）却**按计划把版本 bump 押后**了 ——
结果站长打开的是迁移前就开着的页面，浏览器里跑的还是旧 `cloud.js`（指向 WorkBuddy 旧后端），
而新 CSP 不放行那个域 ⇒ 登录时浏览器直接掐断请求，报 **`Failed to fetch`**。

这正是本项目文档里反复警告的那条（`?v=` 是唯一缓存击穿手段；`index.html` 自己无版本号可击穿）——
**我踩在了自己写的规则上**。修正：立刻 bump 到 4.8.0 + 让站长 Ctrl+F5 硬刷新一次。
教训：**"验证通过再 bump"这条自定策略会制造"用户拿到半成品旧文件"的窗口**，
迁移这种改后端配置的批次，应当与版本号同批发。

### 本地真库预演（2026-09-30，取证见 `_push/tools/test-schema-pglite.js`）

`db/schema.sql` 一直是"按应用代码重建"的 DDL，**从未在任何真库上执行过**。用 PGlite
（编译成 WASM 的真 Postgres，纯内存、无需守护进程）补上了这一步，全部通过：

- **DDL**：整篇执行成功；4 张表 / 2 个视图 / 15 条 RLS 策略 / 4 张表均启用 RLS / 9 个索引（含 tags 的 GIN）
- **导入**：4 篇文章 + 4 张图（含 1 缩略图）+ 3 首电台（含 16MB base64）全部入库；
  图片 sha256、音频 ID3@0 与逐字节一致；自增序列已重置
- **RLS 行为**：匿名可读已发布文章 / 图片视图 / 电台视图（含音频本体），
  读不到草稿、**读不到图片基表**（返回 0 行，owner_id 不外泄）、读不到 error_logs，
  且写不进 posts / radio_tracks / post_images（唯独 error_logs 刻意对匿名开放）；
  作者能看见并改自己的草稿，**改不到、删不掉别人的**（影响 0 行）；
  他人看不到别人的草稿
- **库层 CHECK**：图片 data/thumb 与电台 data 的超限插入、posts.status 非法值，全部被拒

#### 预演抓到的 bug（已修）

导入器的 `owner_id` 写成 `p.owner_id || OWNER` —— 而种子数据里每篇都带旧平台 id，
所以**实际保留了旧 id**，与它自己的注释（"统一归导入者"）不符。后果很实在：
那些文章在 Supabase 上无人能用（谁都不能编辑），后面的 `--claim`（按 `owner_id = legacy-import`
改归属）会**一行都匹配不到、静默无效**。现在改为一律写 `OWNER`，并在 `verify()` 里加了
归属自检（任何一行不属于导入者就报红），原始 owner_id 仍完整保留在 `db/seed/posts.json`。

#### 一个测试侧的坑（记下来免得再踩）

测 RLS 必须用**简单查询协议**（PGlite 的 `exec`），不能用预备语句式的 `query()`：
同一句 SQL 在导入/回验阶段以超级用户跑过之后，PGlite 会复用那份旧计划，
于是"匿名直读基表"会**假绿成可读**。实测：同一个查询 `query()` 返回 4 行、`exec` 返回 0 行。
| 全链路实测 | ⏳ 待建库后 | 登录 / 发文 / 上传 / 电台管理 |
| 版本 bump + 文档收尾 | ⏳ 待全链路通过 | 动了 `js/` 按纪律要 bump，故意押后到验证通过时一次性做 |

**要你做的**：建 Supabase 项目并把三样东西交给接手方 —— 步骤见 `SUPABASE-SETUP.md`。

⚠ 一条重要结论变了：旧平台按 Origin 白名单放行（`*.github.io` → 403），
**Supabase 不设这道闸**。所以放开 CSP 后 GitHub Pages 也能直连数据库，
`data/` 快照从"唯一出路"退化为"兜底"（云端连不上时站点照常能看）。

## 1. 现状快照（2026-09-30）

| 面 | 现状 |
|---|---|
| 数据源 | WorkBuddy 云服务（endpoint / key 见 `config/README.md`），资源 id `wbcs_asyuRz8PhuNwUVq3nDDomM` |
| 线上主站 | `https://cyberpunk-blog.app.workbuddy.host/cyberpunk-blog/`（可登录发文，停用云服务后失效） |
| GitHub Pages | `https://1liiang.github.io/cyberpunk-blog/`（只读快照，仓库 `1liiang/cyberpunk-blog`） |
| 自动同步 | `.github/workflows/sync-snapshot.yml` 每 6 小时拉云端刷快照（**依赖云端，停用后会失败**） |
| 数据 | 4 篇文章 / 4 张图 / 3 首电台 / 0 草稿（实测，2026-09-30） |

## 2. 两条迁移路线

| | 路线 A：纯静态（只读） | 路线 B：接新后端（全功能） |
|---|---|---|
| 目标 | 保留"能看能听"的博客 | 保留 登录 / 发文 / 上传 / 电台管理 |
| 工作量 | **几乎为零**（机制现成） | 中等（建库 + 导数据 + 换 SDK 层） |
| 成本 | 免费（GitHub Pages / 任意静态托管） | 新后端平台的费用（Supabase 免费档够用） |
| 内容更新 | 手动（改快照 + 提交）或自建脚本 | 实时 |

建议：**先做路线 A 保底**（当天可用），需要发文时再上路线 B。

---

## 3. 路线 A：纯静态（推荐先做）

现状已完全支持——`app/js/cloud.js` 在云端不可达时自动回退读 `app/data/` 快照：

1. 在云服务停用**之前**，最后刷一次快照并提交：
   ```bash
   cd app
   node tools/export-static.js        # 拉取最新文章/图/电台 → data/
   git add -A && git commit -m "chore: 最终快照"
   git push                            # GitHub Pages 随仓库更新
   ```
2. **停用云服务后**（收尾动作）：
   - 禁用 `.github/workflows/sync-snapshot.yml`（它拉不到云端，会每 6 小时失败）
   - `npm run feed` 同样依赖云端 → feed.xml 停在上次产物；如要长期维护，
     改 `tools/gen-feed.js` 改为从 `data/posts.json` 生成（数据结构见该文件注释）
   - 旧主站地址失效，若有外链散布，建议在 Pages 项目页/README 里注明新地址
3. 静态托管不限于 GitHub Pages：`app/` 整个目录丢给任意静态服务器即可
   （注意 `index.html` 的 CSP 是 `connect-src 'self'`，只读模式下正合适）。

> 路线 A 的边界：登录/发文/上传**必然失败**（无后端），这是设计使然而非故障。

---

## 4. 路线 B：接新后端（以 Supabase 为例）

### 4.1 建库 + 导数据

按 `db/README.md` 五步走：执行 `db/schema.sql` → 导文章 → 导图片/电台 → 重置序列 → 改配置。

### 4.2 换数据层（`app/js/cloud.js`）

该文件对 SDK 的调用是**薄封装**，接口面如下（WorkBuddy SDK 与 Supabase SDK 同构度极高）：

| 现调用（WorkBuddy SDK） | 新后端（Supabase SDK） | 备注 |
|---|---|---|
| `WorkBuddyCloud.createWorkBuddyCloud({ endpoint, publishableKey })` | `createClient(url, anonKey)` | 初始化（cloud.js 顶部 `init()`） |
| `cloud.auth.getSession / getUser / signOut / onAuthStateChange` | `supabase.auth.*` | 同名同形 |
| `cloud.auth.signInWithPassword({email,password})` | `supabase.auth.signInWithPassword` | 同形 |
| `cloud.auth.sendOtp({email})` / `verifyOtp(opts)` | `supabase.auth.signInWithOtp` / `verifyOtp` | 语义接近，参数名略有差异 |
| `cloud.auth.resetPasswordForEmail(email)` | `supabase.auth.resetPasswordForEmail` | 同形 |
| `cloud.database.from(t).select/insert/update/delete` + `.eq/.in/.contains/.order/.range/.limit/.single/.maybeSingle` | `supabase.from(t)` 全链式 | **两家都是 PostgREST**，查询链几乎逐字可搬 |
| `cloud.storage.upload(path, file)` / `.createSignedUrl(path, ttl)` | `supabase.storage.from(bucket).upload / createSignedUrl` | 附件功能（本项目基本未用，但保留接口） |

改造点集中在 `cloud.js` 的 `init()` 与各 `ensure()` 调用处——**页面层（app.js/views.js）不需要动**。

### 4.3 其他必改项

- `app/index.html` 的 CSP `connect-src`：加入新后端域名
- CDN 脚本引用（marked / DOMPurify / SDK）：若新平台换 SDK，统一更新三处（index.html、vendor 对照）
- `js/vendor/workbuddy-cloud-sdk.js`：保留作参考，新实现不依赖它

### 4.4 验证清单（迁移后逐项过）

- [ ] 首页文章列表：4 篇（#1/#4/#10/#11），按时间倒序
- [ ] 文章详情 `#/post/4`：正文渲染 + `cloudimg://2` 解析为图片（1280×720）
- [ ] 电台面板：3 首可列、可播、进度推进（`data/radio/*.mp3` 或新后端 data 字段）
- [ ] 注册/登录：新平台账号体系走通（旧账号密码**不可能**迁移，见下）
- [ ] 发文：新建草稿 → 发布 → 首页可见
- [ ] 图片上传：压缩入库 → 正文引用显示
- [ ] `npm run gate` 全绿（测试不依赖具体后端）

---

## 5. 已知限制（平台边界，无法绕过）

| 项 | 说明 | 处置建议 |
|---|---|---|
| **用户密码** | 哈希由平台托管，任何导出通道都拿不到 | 用户在新平台重新注册 / 走密码重置 |
| **注册邮箱列表** | 只能从原云服务管理面板人工查看，无导出 API | 如有真实读者，人工记录后通知 |
| **草稿** | RLS 不放行匿名读；本包导出时云端无草稿 | 若还有草稿，停用前登录原站把内容留一份 |
| **owner_id** | 数据里是原平台 uid（text/uuid 混用，见 schema.sql 注释） | 重建时统一改写为新平台自己的 uid（换取可编辑），或原样保留（只读） |
| **云存储附件** | `blog/images`、`blog/attachments` 需登录+签名 URL | 若曾上传附件，停用前在原站逐一下载 |
| **旧域名/链接** | 主站地址停用即失效 | 外部引用处更新为 Pages 或新域名 |
| **error_logs** | 仅作者可读，迁移价值低 | 放弃（保留结构即可，见 schema.sql） |

## 6. 本包内的数据来源说明

- `db/seed/` 全部由 `db/tools/export-cloud-full.js` 于 2026-09-30 从云端匿名通道实测导出，
  报告见 `db/seed/EXPORT-REPORT.md`（含 sha256 校验与一致性标记）。
- 快照文件（`app/data/`）最后一次刷新于 2026-09-30（本包生成时重新导出，内容与云端一致）。
- 电台 3 首的实体在两处**同源**：`app/data/radio/*.mp3`（站点用）＝ `db/seed/radio-index.json`
  所引用的实体；sha256 已核对一致，不重复存放。
