# NEON://DIARY

一座霓虹废墟里的日记本 —— 赛博朋克风格的**单页博客**。纯静态，零依赖，无构建步骤。

> **线上**
> - 主站（有后端，可登录发文）：<https://cyberpunk-blog.app.workbuddy.host/cyberpunk-blog/>
> - GitHub Pages（只读快照，见下）：<https://1liiang.github.io/cyberpunk-blog/>

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

# 全量门禁（1094 条断言）
npm run gate

# 生成 RSS
npm run build
```

## 两套部署，两种数据来源

这是本项目最容易踩坑的地方，单独说清楚。

| | 主站（WorkBuddy） | GitHub Pages |
|---|---|---|
| 内容来源 | 云数据库（实时） | `data/` 静态快照 |
| 登录 / 发文 / 上传 | ✅ 可用 | ❌ 无后端，必然失败 |
| 图片 | 云端按需取 | `data/images/` 同源文件 |

**为什么 GitHub Pages 不能直连云端？** 两道闸同时拦着：

1. **CSP** —— `connect-src 'self'`，跨源请求浏览器直接不发
2. **CORS** —— 云端点按 Origin 白名单放行，`*.github.io` 返 403

绕开它们的唯一办法是让内容也变成**同源资源**。所以有 `tools/export-static.js`：
把已发布文章与被引用的图片导出到 `data/`，`js/cloud.js` 在云端不可达时自动改读它。

```bash
# 内容更新后刷新快照（GitHub Pages 上的内容随之更新）
node tools/export-static.js
```

> ⚠ **GitHub Pages 是只读快照，不会自动跟随云端更新。** 要让它显示最新文章，
> 得跑一次上面的命令并提交。这一点是有意为之 —— 没有后端就没有实时性。

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
│   ├── console.js        命令终端
│   └── ...
├── data/                 ★ 静态快照（GitHub Pages 的内容来源，勿手改）
├── tests/                门禁用例（50 个 case，1094 条断言）
└── tools/                导出 / 构建 / 版本脚本
```

## 门禁

改任何东西之后都跑 `npm run gate`。它不只是"跑测试"——还包含：

- **故障注入**（26 条）：存储被禁、SDK 缺失、CDN 全挂等降级路径
- **断言数对账**：每个 case 的断言条数与 `tests/cases/manifest.json` 基线核对，
  防止"异步断言没 await 被吞掉"这类静默缩水
- **行为沙箱**：真实 DOM 交互走查

> 新增用例**必须**手动登记进 `tests/cases/manifest.json`，否则对账会报红。

## 技术取舍

几个刻意的决定，都写在对应源码的注释里：

- **零构建**：没有打包器、没有转译。改完直接刷新。
- **`?v=` 是唯一的缓存击穿手段**：动 `js/` 或 `css/` 必须 bump 版本号，
  否则用户拿到的还是旧文件（`tools/bump.js` 把四处版本号合成一次原子操作）。
- **首绘前的事必须在 `theme-boot.js` 做**：它是同步脚本，早于 CSS 应用；
  `app.js` 里的同名逻辑只是"补正"，跑的时候首绘早发生了。
- **回退包在导出边界，不改内部逻辑**：云端可用时行为逐字不变，
  详见 `js/cloud.js` 里 `withFallback` 的注释。

## 许可

个人项目，代码供参考。文章内容版权归作者所有。
