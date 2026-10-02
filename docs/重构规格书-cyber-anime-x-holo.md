# 重构规格书：NEON://DIARY → cyber-anime × holo 双风格

> **交付对象**：执行改动的 agent
> **交付方**：WorkBuddy 会话 `2026-10-02-01-00-32`
> **生成时间**：2026-10-02 03:20 (GMT+8)
> **基线版本**：**v5.7.1**（若与 package.json 不符，说明已被改动，需重新核基线）
> **决策已定**（漓江 2026-10-02 拍板）：
> 1. **重构**（C 档，全套，非加砖）
> 2. **取消暖色档**（`warm`）→ 只保留 `dark` + `light` 两档
> 3. 本文档为**参考规格**，由执行 agent 落地

---

## ⚠️ 0. 开工前置条件（缺一不可）

| # | 前置条件 | 状态 | 说明 |
|---|---|---|---|
| 1 | **先 `git init` + 首次 commit** | ⚠ 未完成 | 当前 `F:\个人网站` **无 .git**，无任何回滚手段 |
| 2 | **确认另一个 agent 停工** | ⚠ 待确认 | 项目正被并发修改（55/56/57 号 case 为证） |
| 3 | **核基线版本 = v5.7.1** | 待执行 | 读 `package.json` |
| 4 | **依赖已装** | ✅ 已完成 | `app/node_modules`（jsdom） |
| 5 | **先跑一次 `npm run gate` 记录当前断言数** | 待执行 | 作为改动前基线，改完对比 |

> **铁律**：以上 1、2 未完成，**不许动任何文件**。

---

## 1. 改动范围总览

| 类别 | 内容 |
|---|---|
| **风格目标** | 从「纯 cyber-anime」→「**赛博全息 Cyber-Holo**」（漓江 2026-10-02 命名） |
| **风格画像** | 「战舰驾驶舱里浮着一张会流动的全息星图」——冷、准、硬几何，但所有表面发光且折射。骨架来自 cyber-anime（机甲切角/终端/快节奏），皮相来自 Y2K 全息（虹彩/镭射），点睛取 vaporwave 的粉青重影（微量，仅强调处） |
| **主题档位** | `dark` + `light`（**取消 `warm`**） |
| **视觉新增** | HUD 角框、双色辉光、六边形网格、全息虹彩反光 |
| **保持不动** | `--hue` 单旋钮机制、斜切角体系、动效三档、零构建、CSP |

---

## 2. 任务一：取消暖色档（影响面已实测，很小）

### 2.1 实测影响面（本单已核实，直接照做）

| 文件 | 位置 | 内容 |
|---|---|---|
| `css/style.css` | 3 处 `html[data-theme="warm"]` | 变量块 + scanline 浅底 + scrollbar |
| `js/theme-boot.js` | `ALLOWED = ['dark','light','warm']` | 白名单 |
| `js/app.js` | 847/848/851 行 | `THEME_ICON` / `THEME_ORDER` / `THEME_NAME` |
| `js/console.js` | 135/177 行 | `theme <档>` 命令的帮助与校验 |
| `tests/cases/39-v3-0-0-b1-tokens.js` | 8/50/123-130 行 | **断言了三档派生参数** |
| `tests/cases/20-o9-色标.js` | 400/404/437 行 | **断言了 warm 块的 `--hue-l:25%`** |

### 2.2 执行步骤

**Step 1 — CSS**：删除 `html[data-theme="warm"] { ... }` 整块（css 约 2970-3014 行区域），
并删除所有 `html[data-theme="warm"] xxx` 的组合选择器（scanline、scrollbar 两处）。

**Step 2 — theme-boot.js**：
```js
var ALLOWED = ['dark', 'light'];   // 移除 'warm'
```
⚠ 同时删除注释里对 warm 的说明（注释会被 `stripComments` 剥离后才扫，但保持整洁）。

**Step 3 — app.js**：
```js
var THEME_ICON  = { light: '☀ LIGHT', dark: '☾ DARK' };   // 删 warm
var THEME_ORDER = ['dark', 'light'];                      // 删 warm
var THEME_NAME  = { dark: 'DARK', light: 'LIGHT' };       // 删 warm
```
⚠ **注意**：app.js 819 行附近的注释写的是「两态：dark / light」，但实际是**三态**（含 warm）。
**取消 warm 后，代码与注释反而对上了**——顺手把这处注释复核一遍。

**Step 4 — console.js**：
```js
theme: { desc: 'theme <档>     dark / light' },                      // 135 行
if (['dark', 'light'].indexOf(m) === -1) { ... }                     // 177 行
```

**Step 5 — 测试断言退役**（⚠ 这是最容易出事的一步）：
- `39-v3-0-0-b1-tokens.js`：**逐条**删除 warm 相关断言（8/50/123~130 行）
- `20-o9-色标.js`：删除 400/404/437 行的 warm 块断言

⚠⚠ **铁律（HANDOVER §5 实锤教训）**：
- **不许全局替换**——"warm"这个词可能出现在无关断言里
- **断言退役要一条一条做**，不要写通用批处理（括号配平会失败）
- 改测试的**正确姿势**：先从 GitHub 取回未改动的原文件，再做**最小范围替换**

**Step 6 — 同步 manifest + 基线**：
```bash
npm run baseline    # 断言数变了，必须刷新基线
npm run gate        # 确认全绿
```
⚠ 若删除了整个 case 文件，需同步从 `tests/cases/manifest.json` 移除条目。

### 2.3 验收标准（取消 warm）

- [ ] 全项目 grep `warm` → **0 命中**（`js/`、`css/`，含注释）
- [ ] 主题切换按钮**只循环 dark ↔ light**
- [ ] 控制台命令 `theme warm` → 报错提示
- [ ] 老用户 localStorage 里存着 `warm` → **自动落到 dark**（theme-boot 白名单机制已保证）
- [ ] `npm run gate` 全绿

---

## 3. 任务二：风格重构（cyber-anime × holo）

### 3.1 新增视觉元素（4 项，全部纯 CSS）

#### ① HUD 角框（新类，不改老样式）

```css
/* 全息 HUD 角框：括号式边角，颜色走 hue 派生 */
.hud-frame { position: relative; }
.hud-frame::before,
.hud-frame::after {
  content: "";
  position: absolute;
  width: 14px; height: 14px;
  border: 1px solid var(--line-strong);
  pointer-events: none;
}
.hud-frame::before { top: -1px; left: -1px;  border-right: 0; border-bottom: 0; }
.hud-frame::after  { bottom: -1px; right: -1px; border-left: 0;  border-top: 0; }
.hud-frame:hover::before,
.hud-frame:hover::after { border-color: var(--primary); }
```

⚠ 若要四角全有，用第二个元素或 background 四角渐变实现，**不要新增 `@media` 块**。

#### ② 双色辉光（Vaporwave 精华，纯 CSS）

```css
/* 粉青双向散射，形成全息重影。注意 --magenta 是语义色（警示），
   仅用于强调性标题，不要全站铺开。 */
--glow-dual:
  -2px -2px 12px rgba(255, 42, 109, 0.55),
   2px  2px 12px hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.55),
       0 0  20px rgba(255, 42, 109, 0.25);
```

#### ③ 六边形网格（替换或新增氛围层纹理）

```css
.hex-grid {
  background-image:
    linear-gradient(30deg,  hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.06) 12%, transparent 12.5%, transparent 87%, hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.06) 87.5%),
    linear-gradient(150deg, hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.06) 12%, transparent 12.5%, transparent 87%, hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.06) 87.5%),
    linear-gradient(30deg,  hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.06) 12%, transparent 12.5%, transparent 87%, hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.06) 87.5%),
    linear-gradient(150deg, hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.06) 12%, transparent 12.5%, transparent 87%, hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.06) 87.5%),
    linear-gradient(60deg,  hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.04) 25%, transparent 25.5%, transparent 75%, hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.04) 75%);
  background-size: 40px 70px;
  background-position: 0 0, 0 0, 20px 35px, 20px 35px, 0 0;
}
```

⚠⚠ **必须给 `light` 档单独降低不透明度**（照抄现有 scanline 的做法：light 下砍半），
否则浅底上会像脏污。

#### ④ 全息虹彩反光（holo 核心）

```css
/* 虹彩渐变：适合卡片悬停时的反光扫过。走变量，别硬编码彩虹色。 */
.holo-sheen::after {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(115deg,
    transparent 30%,
    hsl(calc(var(--hue) + 60) var(--hue-s) var(--hue-l) / 0.12) 45%,
    hsl(calc(var(--hue) - 60) var(--hue-s) var(--hue-l) / 0.12) 55%,
    transparent 70%);
  opacity: 0;
  transition: opacity var(--t-normal) ease-out;
  pointer-events: none;
}
.holo-sheen:hover::after { opacity: 1; }
```

### 3.2 保留不动（重要）

| 保留项 | 原因 |
|---|---|
| `--hue` 单旋钮机制 | 全站换色能力，是一等公民 |
| `--clip-corner` 斜切角 | 机甲标识，**不要改成圆角** |
| `--t-fast/normal/slow` 三档 + reduce 归零 | 无障碍保护链，**不许引入硬编码时长** |
| 三档 → 两档后的 `--hue-s`/`--hue-l` 参数 | 只删 warm，dark/light 参数不动 |

---

## 4. 严禁事项（违反即回滚重做）

| # | 严禁 | 原因 |
|---|---|---|
| 1 | 引入 Tailwind / 任何构建工具 | 项目纪律：零构建 |
| 2 | 硬编码颜色（`#ff71ce` 等） | 必须走 `--hue` 派生，否则换肤露馅 |
| 3 | 改斜切角为圆角 | 破坏风格根基 |
| 4 | 引入 >400ms 的动效时长 | 会绕开 reduce 保护机制 |
| 5 | 新增 `@media (max-width: ...)` 断点块 | **R202d 守 ≤16 个，当前实测正好 16 个 —— 已满额**，新规则必须并入既有块（注：`@media (hover:hover)` 有 22 个，不属此限） |
| 6 | 全局替换改测试 | HANDOVER 实锤：曾误伤 11 条无关断言 |
| 7 | 用 emoji 做图标 | 全站自绘 SVG，R 系列有断言 |
| 8 | 忽略 `prefers-reduced-motion` | 新动效必须在 reduce 块里归零 |

---

## 5. 执行顺序（严格按此顺序）

```
0. git init + commit                ← 不完成不许进行下一步
1. 跑一次 gate，记录断言数基线
2. 取消 warm（任务一，§2）— CSS → JS → 测试 → baseline
3. 跑 gate 确认全绿             ← 第一个检查点
4. 加 HUD 角框（§3.1①）
5. 加六边形网格 + light 档降透明（§3.1③）
6. 加双色辉光（§3.1②）
7. 加全息虹彩反光（§3.1④）
8. light 档全量复验（新元素在浅底上的表现）
9. 跑 gate 全绿
10. bump 版本号（node tools/bump.js）
11. 发布 + 线上验证
```

⚠ **每个检查点（3、9）必须全绿才可继续。**

---

## 6. 铁律清单（抄自 HANDOVER，逐条遵守）

1. ⚠ **改 `css/`/`js/` 必须 bump 版本号**——`?v=` 是唯一缓存击穿手段
2. ⚠ **bump 的 `--title`/`--item` 用「」不用双引号**——嵌套双引号会让 bump **静默失败**
3. ⚠ **改配色必须同时跑** `39-v3-0-0-b1-tokens.js` 与 `20-o9-色标.js`（后者真算对比度）
4. ⚠ **断点块不得新增**——新规则并入既有 `@media` 块
5. ⚠ **reduce 块内单行写法**（R112e 数"不含 `}` 的行"）
6. ⚠ **改测试先取原文件再最小替换**，不要全局替换
7. ⚠ **断言退役一条一条做**，不要写批处理
8. ⚠ **新增 case 必须登记 `tests/cases/manifest.json`**
9. ⚠ **清理守卫必须扫剥过注释的源码**（`stripComments`）
10. ⚠ **发布后验证必须用 GET**（禁 `curl -I`），并核 `?v=` 与 BUILD_ID

---

## 7. 验收清单（全部通过才算完成）

### 功能
- [ ] 主题只在 dark ↔ light 间切换，warm 彻底消失
- [ ] 色相滑杆仍可 0~359 自由调，全站跟随变色
- [ ] 氛围九层开关正常
- [ ] 控制台 `theme` 命令只认 dark/light

### 视觉
- [ ] HUD 角框在主要容器上出现，悬停变亮
- [ ] 六边形网格在 **dark 与 light 两档**下观感都正常
- [ ] 双色辉光只在强调标题上，未泛滥
- [ ] 全息虹彩扫光只在悬停时出现

### 无障碍
- [ ] 所有新动效在 `prefers-reduced-motion` 下归零
- [ ] 新配色文字对比度 ≥ 4.5:1（**light 档必须实测**）
- [ ] 键盘可达性未被破坏

### 工程
- [ ] `npm run gate` 全绿
- [ ] 版本号已 bump，`?v=` 与 BUILD_ID 一致
- [ ] 无硬编码色值（grep `#[0-9a-f]{6}` 检查新增部分）
- [ ] 无新增 `@media` 断点块

---

## 8. 风险提示（交接方必须知道）

| 风险 | 等级 | 说明 |
|---|---|---|
| **无 git 兜底** | 🔴 高 | 改错无法回滚——**这是开工前必须解决的** |
| **并发修改** | 🔴 高 | 另一个 agent 可能同时改，会互相覆盖 |
| **暖色档存量数据** | 🟡 中 | 老用户 localStorage 存 `warm` → 已由白名单机制兜住 |
| **light 档验证不足** | 🟡 中 | 新元素（六边形/虹彩）在浅底上容易"像脏污"，必须实测 |
| **断言退役出错** | 🟡 中 | HANDOVER 有"全局替换误伤 11 条"的实锤教训 |
| **性能开销** | 🟡 中 | 新增动效会加重合成压力，低端设备 `data-tier="low"` 需验证 |

---

## 9. 参考文档索引

| 文档 | 路径 | 内容 |
|---|---|---|
| 权威交接 | `app/HANDOVER.md` | 纪律、坑、未完成项（**必读**） |
| 索引+判据 | `app/docs/handover-notes/MEMORY.md` | 10 分钟建立全局认知 |
| 测试写法 | `app/docs/handover-notes/TESTING-NOTES.md` | 源码提取、jsdom、浏览器自动化坑 |
| cyber-anime 翻译 | `F:\个人网站\StyleKit-cyber-anime-翻译件.md` | 色彩映射 + 冲突清单 |
| vaporwave 翻译 | `F:\个人网站\StyleKit-vaporwave-翻译件.md` | 配色对应 + 两处自相矛盾 |
