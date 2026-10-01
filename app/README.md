# NEON://DIARY

一座霓虹废墟里的日记本 —— 赛博朋克风格的**单页博客**。纯静态、无构建步骤、**零外部脚本依赖**（第三方库全部本地托管在 `js/vendor/`）。

> **线上**
> - 本站（Supabase 后端，可登录发文）：GitHub Pages <https://1liiang.github.io/cyberpunk-blog/>
> - 本地预览：`http://127.0.0.1:8898/`（`dev serve`）
> - 旧主站（WorkBuddy，v4.6.0 停在旧代码，将随云服务停用而失效）：
>   <https://cyberpunk-blog.app.workbuddy.host/cyberpunk-blog/>

---

## 这是什么

原生 JS（无框架）+ CSS + DOM 的 SPA，hash 路由，`index.html` 是唯一入口。

- **场景系统**：11 个路由场景，各自带一套氛围层温差
- **氛围系统**：九层可叠加的全屏效果（噪声 / 扫描线 / 网格 / 辉光 / 泛光 / 招牌 / 星尘 / 脉冲 / 数字雨），带 45fps 探针与九级自动降档
- **装置**：开场自检序列、霓虹字标、命令终端（<kbd>Ctrl</kbd>+<kbd>`</kbd>）、点击反馈、彩蛋
- **配色**：`--hue` 一个变量驱动全站配色，九档快捷色 + 自由滑杆
- **无障碍**：可访问名 / 地标 / 焦点管理 / `prefers-reduced-motion` 全量守卫

## 快速开始

```bash
# 本地预览（零依赖，随便一个静态服务器都行）
python -m http.server 8898 --bind 127.0.0.1
# 然后打开 http://127.0.0.1:8898/

# 全量门禁（v5.7.0 起 1138 条断言）
npm run gate

# 生成 RSS
npm run build
```

## 数据来源：Supabase（实时）+ 静态快照（兜底）

**v4.8.0 起后端是 Supabase**（配置在 `js/cloud.js` 顶部 `PUBLIC_CONFIG`）。
关键结论与旧平台不同：

| | 说明 |
|---|---|
| 浏览器直连 | ✅ **可以** —— Supabase 不设 Origin 白名单（旧平台按白名单放行，`*.github.io` 一律 403） |
| 前提 | `index.html` 的 CSP `connect-src` 放行 `*.supabase.co`（已放行） |
| 因此 | 登录 / 发文 / 上传在 Pages 上**也能用**；不再受"没有后端"限制 |
| 快照的角色 | 从"唯一出路"退化为**兜底**：Supabase 不可达（免费档暂停、额度用尽、断网）时，`js/cloud.js` 自动改读 `data/` |

快照由 `tools/export-static.js` 生成（workflow 每 6 小时刷一次）。
⚠ v5.6.2 起它**只导条目元数据** —— 曲目是网易云条目（播放地址就是行里的
`source_url`），站点侧没有音频本体可落地，旧那套 base64 解码 / `data/radio/`
增量拉取逻辑已整块删除：

```bash
node tools/export-static.js      # 刷新 data/ 快照
```

> ⚠ 动过 `js/` 或 `css/` **必须 bump 版本号**（`?v=` 是唯一的缓存击穿手段）。
> 忘记 bump 的真实症状：浏览器复用旧 `cloud.js`（指向旧后端）→ 登录报 `Failed to fetch`。
> 另外 `index.html` 自己没有版本号可击穿 —— 大改动后请 Ctrl+F5 硬刷新一次。

## 目录结构

```
cyberpunk-blog/
├── index.html            单页入口（含 CSP）
├── css/style.css         全部样式（含大量"为什么这么做"的注释）
├── js/
│   ├── app.js            主逻辑（路由、视图装配、编辑器、装置面板）
│   ├── views.js          视图层（返回 HTML 字符串，全部经 esc() 转义）
│   ├── cloud.js          数据层（云端访问 + 静态快照回退）
│   ├── theme-boot.js     首绘前脚本（主题 / 色相 / 氛围三件必须在这里定）
│   ├── scene.js          场景框架（路由 → 场景 → 氛围层集）
│   ├── atmo.js           氛围运行时（数字雨 + 帧率保底）
│   ├── console.js        命令终端（八条命令 + 彩蛋）
│   └── ...
│   ⚠ v5.6.3：`radio.js`（旧 `<audio>` 播放内核）已删除 —— index.html 不再加载它，
│     运行时代码也无人调用；电台播放由网易云官方 iframe 承担。
├── data/                 ★ 静态快照（GitHub Pages 的内容来源，勿手改）
├── docs/
│   └── handover-notes/   长期维护的经验沉淀（MEMORY / PROJECT-NOTES / TESTING-NOTES）
│       ⚠ v5.6.3：历史方案与报告（`archive/`，16 份 322KB）已按需清理删除
├── db/                   后端结构（schema.sql + 建库 SQL 生成器）
├── tests/                门禁用例（55 个 case，1138 条断言）
└── tools/                导出 / 构建 / 版本脚本 / 全项目审计（audit-all.js）
```

## 门禁

改任何东西之后都跑 `npm run gate`。它不只是"跑测试"——还包含：

- **故障注入**（27 条）：存储被禁、SDK 缺失、本地库缺失等降级路径
- **断言数对账**：每个 case 的断言条数与 `tests/cases/manifest.json` 基线核对，
  防止"异步断言没 await 被吞掉"这类静默缩水
- **行为沙箱**：真实 DOM 交互走查
- **结构性守卫**：CSS 括号配平 + 顶层无孤儿声明。清代码时「只删到第一个右花括号」
  会留下浏览器静默忽略的半截规则，普通断言抓不到 —— 见 49 号 R244 / R244b。

> 新增用例**必须**手动登记进 `tests/cases/manifest.json`，否则对账会报红。

## 技术取舍

几个刻意的决定，都写在对应源码的注释里：

- **零构建**：没有打包器、没有转译。改完直接刷新。
- **`?v=` 是唯一的缓存击穿手段**：动 `js/` 或 `css/` 必须 bump 版本号，
  否则用户拿到的还是旧文件（`tools/bump.js` 把四处版本号合成一次原子操作）。
- **首绘前的事必须在 `theme-boot.js` 做**：它是同步脚本，早于 CSS 应用；
  `app.js` 里的同名逻辑只是"补正"，跑的时候首绘早发生了。
- **想再清一轮死代码**：`node tools/audit-all.js`（它剥掉注释再扫，命中即真信号；
  只有 `version.js` 的构建日志会被 ① ② 项命中，那是预期的留痕）。
- **回退包在导出边界，不改内部逻辑**：云端可用时行为逐字不变，
  详见 `js/cloud.js` 里 `withFallback` 的注释。

## 许可

个人项目，代码供参考。文章内容版权归作者所有。
