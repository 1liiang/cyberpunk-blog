# db/ — 数据库重建资料

> 本目录存放「换平台重建数据库」所需的全部资料：结构（schema.sql）、
> 数据（seed/）、以及一个可重复运行的导出工具（tools/）。

## 目录内容

| 路径 | 内容 | 说明 |
|---|---|---|
| `schema.sql` | 重建 DDL | 表 / 视图 / RLS / 索引 / GRANT。依据应用代码重建，见文件头声明 |
| `seed/posts.json` | 4 篇已发布文章 | 原始行数组（含正文），2026-09-30 实测导出 |
| `seed/images/*.png` | 4 张图片 | base64 已解码为原始文件；`8.thumb.png` 是缩略图 |
| `seed/images-index.json` | 图片清单 | 元数据 + sha256 + 是否被文章引用 + 与 app 快照的一致性 |
| `seed/images-rows.json` | 图片行结构 | data/thumb 截断占位；写 INSERT 模板用 |
| `seed/EXPORT-REPORT.md` | 导出报告 | 本次导出的条数 / 校验 / 失败项 |
| `tools/export-cloud-full.js` | 导出工具 | 云服务仍在时**可重跑**刷新 seed；也用于核对数据 |

### ⚠ 电台：已退役（2026-09-30 站长决定"不做歌曲部分"）

3 首商业歌曲（夜航星 / 孤勇者 / 苦昼短，27MB）的音频**已从仓库与快照中删除**，
GitHub Pages 上不再公开分发；新库也不导入电台。相关处理：

| 位置 | 现状 |
|---|---|
| `app/data/radio/*.mp3` | ❌ 已删除 —— 目录本身也已在 v5.6.2 移除（导出器不再建它，见下） |
| `app/data/posts.json` 的 `radio` | 条目数组（v5 起是**网易云条目**：id/title/artist/kind/netease_id/source_url/sort_order/created_at，不含任何音频字段） |
| `radio_tracks` 表 / `public_radio` 视图 | ✅ 结构保留（`schema.sql` 未动） |
| 界面 | ✅ 保留 —— 新电台页 `#/radio` + 常驻控制台 `#radio-stage`；站长可增删排序，访客只收听 |
| `seed/radio-index.json`、`seed/radio-rows.json` | ❌ **v5.6.3 已删除** —— base64 时代的历史记录，导入器早已不读，留着只会误导 |
| `seed/removed-posts-archive/` | ❌ **v5.6.3 已删除** —— 6.5MB 的已删测试文章与 3 张图备份，无任何脚本引用 |
| `tools/export-static.js` 的电台块 | ✅ v5.6.2 重写：**只导条目元数据**，不再拉 base64、不再写 `data/radio/` |

> 将来若要恢复自建音频：那批 27MB 商业歌曲**不要**导回来（版权 + 免费档流量，
> 每次播放约 12MB）。真要自建，按新的库结构重写导入与导出逻辑，别照着已删的
> base64 时代脚本改。
> 门禁用例 `51-v4-6-0-static-fallback.js` 的 R253 现在是这道决定的**守卫**：
> 快照里的电台条目**只许带 v5 那八个字段** —— 一旦有人把 `data` / `mime` / `file`
> 这类音频时代的东西塞回来，当场报红。

### 本通道拿不到的（平台边界）

- **草稿文章**：RLS 只放行 `status='published'`，匿名通道拿不到。做迁移前请先在原站登录，把草稿逐个发布或至少人工抄录。
- **error_logs**：仅作者本人可读，迁移价值低，建议放弃。
- **云存储对象**（`blog/images`、`blog/attachments`）：需登录 + 签名 URL 下载。若曾用过「附件」功能，见 docs/MIGRATION.md 的补充导出一节。

---

## 导入到新平台（以 Supabase 为例）

### 第 1 步：建结构

把 `schema.sql` 全文粘进 Supabase SQL Editor 执行（或 `psql -f schema.sql`）。

### 第 2 步：导入文章

`seed/posts.json` 的 `posts` 数组可直接映射。逐行 INSERT（示例）：

```sql
insert into posts (id, owner_id, owner_name, title, summary, content, tags, cover_ref, status, created_at, updated_at) values
  (1, 'system', 'SYSTEM.AI', '欢迎使用 NEON://DIARY', null, '……正文……', '["指南"]'::jsonb, null, 'published', '2026-09-28T00:22:32.220213+08:00', '2026-09-28T00:22:32.220213+08:00');
```

> ⚠ `owner_id` 是**原平台的用户 id**（如 `2104255212179951616`）。
> 换平台后账号体系不同：要么把 owner_id 统一改写成新平台你自己的 uid
> （这样登录后你能编辑这些文章），要么保留原文（只读、不可编辑）。

### 第 3 步：导入图片与电台

图片/音频需要把文件重新编码成 base64 再 INSERT。用 Node 生成 SQL 或直接走 SDK：

```js
// 图片（示例：2.png）——data 是**纯 base64**（无前缀）
const fs = require('fs');
const b64 = fs.readFileSync('db/seed/images/2.png').toString('base64');
// → INSERT INTO post_images (id, content_type, data, width, height, size_bytes, created_at)
//   VALUES (2, 'image/png', '<b64>', 1280, 720, 1543803, '2026-09-28T01:23:18.580824+08:00');

// 电台（示例：4.mp3）——data 是 **data URL 全文**（含前缀），别剥！
const b64 = fs.readFileSync('app/data/radio/4.mp3').toString('base64');
const dataUrl = 'data:audio/mpeg;base64,' + b64;
// → INSERT INTO radio_tracks (id, title, artist, mime, data, duration_sec, size_bytes, sort_order, created_at)
//   VALUES (4, '夜航星(Night Voyager)', '不才、三体宇宙', 'audio/mpeg', '<dataUrl>', 304, 12151050, 0, '2026-09-29T15:19:53.896361+08:00');
```

> 大小提醒：单条 SQL 会到几 MB。Supabase SQL Editor 对超长语句不友好时，
> 改用 Node 脚本走 PostgREST（`POST /rest/v1/post_images`）逐条推。

### 第 4 步：重置自增序列（**必做**，否则新文章主键冲突）

```sql
select setval(pg_get_serial_sequence('posts','id'),        (select max(id) from posts));
select setval(pg_get_serial_sequence('post_images','id'),  (select max(id) from post_images));
select setval(pg_get_serial_sequence('radio_tracks','id'), (select max(id) from radio_tracks));
```

### 第 5 步：改客户端配置并验证

把 `app/js/cloud.js` 顶部的 `PUBLIC_CONFIG` 换成新平台的 endpoint / publishableKey
（配置在 `app/js/cloud.js` 顶部 `PUBLIC_CONFIG` —— `config/` 那个说明目录
已在 v5.6.3 清理掉），然后按 `app/README.md` 与 `app/HANDOVER.md` 的清单过一遍。

---

## 重跑导出（云服务还在时）

```bash
node db/tools/export-cloud-full.js            # 默认读 ../app，写 ./seed
```

脚本会重新拉取云端并刷新 seed / 报告；若你已在 app 侧改动过文件，注意比对报告里的
`identical_with_app_snapshot` 标记。
