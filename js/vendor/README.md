# vendor 依赖档案

本地托管的第三方脚本。改动或升级前必读本文件。

> **v4.8.1 起全站零外部脚本**：下面的库原先走 `cdn.jsdelivr.net`（按精确版本 + SRI 校验），
> 但该 CDN 在本机网络下时通时不通 —— 失败时的表现是 Markdown 不渲染、代码不高亮
> （站点有降级分支，不会白屏，但功能确实缺了）。改本地托管后 CSP 的 `script-src`
> 只需 `'self'`，也去掉了"CDN 上游漂移"这一整类风险。
> ⚠ 代价是**升级要手动**：下载 → 更新本文件 → 跑 `node tests/run-all.js` → 随版本发布。

## marked.min.js ★ 当前在用

| 项 | 值 |
| --- | --- |
| 包名 | `marked` |
| 版本 | `12.0.2`（精确版本） |
| 来源 | npm `marked@12.0.2` → 包根 `marked.min.js` |
| 下载日期 | 2026-10-01 |
| sha256 | `15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894` |
| sha384(SRI) | `sha384-/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi` |
| 大小 | 35479 bytes |

> 这个 sha384 与原先 index.html 里 CDN 标签上的 `integrity` **逐字节相同** ——
> 即本地托管的正是线上一直在加载的那份字节（迁移时逐库核对过）。

## dompurify.min.js ★ 当前在用

| 项 | 值 |
| --- | --- |
| 包名 | `dompurify` |
| 版本 | `3.4.16`（精确版本） |
| 来源 | npm `dompurify@3.4.16` → `dist/purify.min.js` |
| 下载日期 | 2026-10-01 |
| sha256 | `2c90a9b46d6463f26038a29b686e82bc91de01fdac9d5229e7cfe3b360134ea2` |
| sha384(SRI) | `sha384-a7SzOxErzJ3ZpQz0zJ32d67dSitNzPcbfybc/ykU9KJhMgZkwqfSxlhhdJRS+XGL` |
| 大小 | 28885 bytes |

> DOMPurify 是 Markdown 管线的安全闸：`renderMarkdownInto` 里 marked 的输出必须过它。
> 升级时务必把 `URI_REGEXP`（cloudimg:// / cloudfile:// 白名单）一起复核。

## highlight.min.js ★ 当前在用

| 项 | 值 |
| --- | --- |
| 包名 | `@highlightjs/cdn-assets` |
| 版本 | `11.12.0`（精确版本） |
| 来源 | npm `@highlightjs/cdn-assets@11.12.0` → `highlight.min.js`（含常用语言的打包版） |
| 下载日期 | 2026-10-01 |
| sha256 | `8ab71eb09c51f501e5e25157d9cff100e46cc29bcbfc744d0b746d451fca7f53` |
| sha384(SRI) | `sha384-wjfDDhOPPdjtva8vWBhWeVprSpmxisEu5aYT3q1JyACqXpdKpo3PWZTMVq24MBix` |
| 大小 | 129254 bytes |

> 代码高亮是**纯增强**：`hljs` 缺失时 `renderMarkdownInto` 会跳过高亮，正文照常显示。
> 体积（126KB）主要来自内置语言包；只想要少数语言的话可换自定义构建，但要同步更新哈希。

## supabase-js.js ★ 当前在用

| 项 | 值 |
| --- | --- |
| 包名 | `@supabase/supabase-js` |
| 版本 | `2.117.2`（精确版本，非 dist-tag） |
| 来源 | npm registry tarball `@supabase/supabase-js@2.117.2` → `package/dist/umd/supabase.js` |
| 下载日期 | 2026-09-30 |
| sha256 | `59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd` |
| sha384(SRI) | `sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok` |
| 大小 | 217945 bytes |

### 为什么从 npm tarball 取，而不是 jsdelivr

迁移当天实测：本机到 `cdn.jsdelivr.net`（Cloudflare）**连接超时**，而 npm registry 正常。
tarball 还有一个好处 —— 内容与 registry 的 `dist.integrity` 出自同一份字节，可复核。

### 为什么本地托管

与下面那份 WorkBuddy SDK 同理：CDN 的 dist-tag 是**可变**的，本地托管后脚本内容随仓库
版本控制，上游漂移影响不到本站。附带好处是 CSP 的 `script-src` 不必再放开一个域。

### 升级流程

1. 从 npm registry 确认目标版本（**精确版本号**，禁用 `@latest`）
2. 取 `dist/umd/supabase.js` 覆盖本文件，更新上表的 sha256 / sha384 / 大小
3. 跑 `node tests/run-all.js`，全绿后随版本发布
4. 更新本文件的上表

### 验证命令

```bash
openssl dgst -sha384 -binary js/vendor/supabase-js.js | openssl base64 -A
# 应输出上表的 sha384（去掉 sha384- 前缀）
```

## workbuddy-cloud-sdk.js —— **已于 v4.8.1 删除**

> 这是旧平台（WorkBuddy）的数据层 SDK。迁移到 Supabase 后 index.html 早就不加载它了，
> 只是作为"对照旧实现"的存档留在 vendor 里 —— 但它**会被发布到 Pages**，
> 等于把 60KB 死代码公开挂着。瘦身清理时删掉了，这里留个记号，免得后来者翻 git 历史时困惑。
>
> 想找回它：`git log --diff-filter=D -- js/vendor/workbuddy-cloud-sdk.js`，
> 或者从 npm 取 `@tencent-ai/workbuddy-cloud-sdk@0.1.2-dev.1b37f73.202609222026`
> （sha256 `64f437dcb30bec53a65cac36c4e0a38eb46b68e7ceee93662e3fa3cfb6fb5bde`，62057 bytes）。
> 旧实现"为什么那么写"的记录仍在 `docs/handover-notes/PROJECT-NOTES.md` 与 `安全审计报告.md`。
