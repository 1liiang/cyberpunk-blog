# 云端导出报告（db/seed）

> 由 `db/tools/export-cloud-full.js` 生成，勿手改。

- 导出时间：2026-09-30T13:37:19.459Z
- 云端点：https://cyberpunk-blog.app.workbuddy.host
- 通道：匿名 REST（publishableKey），仅 RLS 放行的公开数据

## 条数

| 数据 | 条数 | 说明 |
|---|---|---|
| 已发布文章 | 4 | posts.json（原始行） |
| 图片 | 4 | images/（base64 已解码落地） |
| 电台曲目 | 3 | 实体见 radio-index.json 的 file 字段 |

## 校验

- 文章引用的图片 id：2
- 引用缺失：✅ 全部命中所导出图片集
- 与 app/data 快照一致性：图片 1/4；电台 3/3

## 失败项

（无）

## ⚠ 本通道拿不到的内容（须登录态另行导出）

- 草稿文章（posts.status = draft）
- error_logs（仅作者本人可读）
- 云存储对象（blog/images、blog/attachments 目录，需登录 + 签名 URL）
