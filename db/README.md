# db/ — 后端结构（Supabase）

> 这个目录让**只看仓库的人也能重建后端**。内容存在 Supabase
> （项目 ref `taxrgizbmgwzxnvlxudq`，配置在 `js/cloud.js` 顶部 `PUBLIC_CONFIG`）。

## 文件

| 文件 | 进仓库 | 说明 |
|---|---|---|
| `schema.sql` | ✅ | **权威 DDL**：表 / 视图 / RLS 策略 / 索引 / GRANT。依据应用代码重建，含逐条"为什么这么设计"的注释 |
| `make-bootstrap.js` | ✅ | 生成"粘进 SQL Editor 就能建库"的自包含 SQL（结构 + 数据） |
| `bootstrap-1-schema-posts.sql` | ❌ 生成物 | 结构 + 已发布文章 + 序列重置（约 16KB） |
| `bootstrap-2-images.sql` | ❌ 生成物 | 被文章引用到的图片（base64，约 2MB） |

> 后两个是 `make-bootstrap.js` 的产物，已加进 `.gitignore` —— 它们的内容
> （`schema.sql` 的 DDL、`data/posts.json` 的文章、`data/images/*` 的图片）
> 都已在仓库里，提交生成物只会带来"源头改了、副本没跟上"的风险。

## 从零重建后端（三步）

```bash
# ① 生成可粘贴的 SQL（读 data/ 快照 + 本目录的 schema.sql）
node db/make-bootstrap.js

# ② 到 Supabase → SQL Editor → New query，把 bootstrap-1 全文粘进去 → Run
#    期望输出：posts=4 published=4
# ③ 再 New query，把 bootstrap-2 全文粘进去 → Run
#    期望输出：文章 4 篇 / 图片 1 张
```

**更省事的通道**（如果你有 Supabase 个人访问令牌 PAT）：用 Management API
`POST /v1/projects/{ref}/database/query` 直接跑这两个文件，连粘贴都省了。
大 base64 可能撞请求体上限，按 300KB 分片"先插占位、再追加"即可。

## 几条必须知道的边界

1. **`auth.uid()` 与 `anon` / `authenticated` 角色是 Supabase 预置的**，`schema.sql` 直接用。
   换到自建 Postgres 要自己补：`auth` schema + `auth.uid()`（读 `request.jwt.claim.sub`）、
   两个角色，以及 `public` 下新建表的默认授权（Supabase 默认给这两个角色授权，RLS 才是闸）。
2. **图片以 base64 存库**（`post_images.data` ≤ 3.6M 字符，客户端上传管线会自动压缩）。
   历史原因：原平台的对象存储只服务登录用户，而博客图片必须匿名可读。
3. **读走视图、写走基表**：`public_images` / `public_radio` 是匿名读通道，不暴露 `owner_id`；
   基表 `post_images` 对匿名返回 0 行（RLS 默认拒绝）。
4. **电台（`radio_tracks` / `public_radio`）已退役**：表与视图结构保留、当前 0 行，
   界面也保留（未登录访客看不到空播放器，站长登录后仍有上传入口）。
5. 直连 Postgres 的域名 `db.<ref>.supabase.co` **只有 IPv6（AAAA）**；IPv4 环境要用
   Session pooler（`aws-0-ap-southeast-1.pooler.supabase.com`，用户名 `postgres.<ref>`）。

## 验证方式

- `node db/make-bootstrap.js` 之后，两个产物都可在**真 Postgres** 上整篇跑通
  （PGlite / Postgres 18 实测：4 篇文章 + 1 张图入库、视图可读、序列正确）
- 线上验收：`db/tools/verify-supabase.js` 那类脚本（对真项目打 PostgREST，验匿名与登录两条通道）
