# vendor 依赖档案

本地托管的第三方脚本。改动或升级前必读本文件。

## workbuddy-cloud-sdk.js

| 项 | 值 |
| --- | --- |
| 包名 | `@tencent-ai/workbuddy-cloud-sdk` |
| 版本 | `0.1.2-dev.1b37f73.202609222026` |
| 来源 | https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@0.1.2-dev.1b37f73.202609222026/lib/index.global.js |
| 下载日期 | 2026-09-28 |
| sha256 | `64f437dcb30bec53a65cac36c4e0a38eb46b68e7ceee93662e3fa3cfb6fb5bde` |
| sha384(SRI) | `sha384-z77MUA3IAqENYJOfGtmBKISLXkWlqVx8VWWQn9qxPwllJp6t43aKUFFMei2TYJWM` |
| 大小 | 62057 bytes |

### 为什么本地托管

原先 index.html 用 `@dev` 标签从 jsdelivr 动态加载。`@dev` 是**可变 dist-tag**——任何能向该包发布新 dev 版本的人，都能直接向你线上的数据库通道注入代码（安全审计 H-1）。本地托管后，脚本内容随仓库版本控制，CDN 上游再怎么漂移也影响不到本站。

### 升级流程

1. 从 npm registry 确认目标版本（用精确版本号，禁用 `@dev` / `@latest`）
2. 下载 `lib/index.global.js` 覆盖本文件同名条目的 sha256 / sha384 / 大小
3. 跑 `node tests/run-all.js`，全绿后随版本发布
4. 更新本文件的上表

### 验证命令

```bash
openssl dgst -sha384 -binary js/vendor/workbuddy-cloud-sdk.js | openssl base64 -A
# 应输出上表的 sha384（去掉 sha384- 前缀）
```
