# StyleKit「cyber-anime」→ NEON://DIARY 翻译件

> **性质**：把 StyleKit 的 Cyber Anime 规范，**翻译成本项目（原生 CSS + `--hue` 变量体系 + 零构建）**
> 可直接落地的写法。**本文档只是翻译，未改动任何站点文件。**
> 生成时间：2026-10-02 03:16 (GMT+8) ｜ 目标版本：v5.7.1

---

## 0. 翻译总原则（三条铁律）

1. **保留它的"形"，使用你的"骨"**：视觉语言（HUD 角框 / 扫描线 / 斜切角 / 多层霓虹）照搬；
   但**一切颜色必须走 `--hue` 派生**，绝不可硬编码它的紫 `#7c3aed` / 青 `#06d6a0` / 粉 `#ff006e`。
2. **不引入任何构建工具**：不用 Tailwind、不用 CDN。项目纪律是"纯静态 + 零构建"。
3. **不碰三档主题体系**：它禁止亮色背景，而本站有 `dark/light/warm` 三档（B1 地基重铸的成果）。
   **三档全保留**，翻译后的样式必须三档都成立。

---

## 1. 色彩翻译表（最关键的映射）

| StyleKit（硬编码） | 本项目写法 | 说明 |
|---|---|---|
| `#0f0f1a`（背景） | `var(--bg-0)` / `var(--panel)` | 已有 `#04060d`~`#101830` 四级 |
| `#7c3aed`（主紫） | `var(--primary)` → `hsl(var(--hue) var(--hue-s) var(--hue-l))` | **本站默认 `--hue: 285` 恰好就是紫**，天然对上 |
| `#06d6a0`（青绿强调） | `var(--green)` = `#05ffa1` | 本站语义色：**绿=在线**，不随 hue 旋转 |
| `#ff006e`（亮粉警示） | `var(--magenta)` = `#ff2a6d` | 本站语义色：**品红=流逝/警示**，不随 hue 旋转 |
| `#38bdf8`（天蓝） | `var(--violet)` 或 `hsl(calc(var(--hue) + var(--vio-off)) ...)` | 本站用"辅助紫偏移 96°"做副色 |
| `#e0e0ff`（浅文字） | `var(--text-bright)` = `#eaf4ff` | 已有，且对比度验过 |
| `text-[#e0e0ff]/80` | `var(--text)` = `#c9d6e8` | 已有 |
| `text-[#e0e0ff]/50` | `var(--text-dim)` = `#657a9a` | 已有，**4.65:1 过 AA**（v3.5.1 提过的） |

> ⚠ **它的 `border-[#7c3aed]/30` → 本站对应 `var(--line)`**（= `hsl(var(--hue) ... / 0.22)`），
> `/50` → `var(--line-strong)`（`/0.55`）。**这两个变量已存在，直接用。**

---

## 2. 组件翻译

### 2.1 HUD 角框装饰（它的"必须"之一）→ 本站写法

**它要的**：`Use HUD corner frame decorations on major containers (angled bracket corners)`

**本站已有基础**：`--clip-corner`（14px 斜切角）、`--clip-corner-sm`（9px）。

**可新增的纯 CSS 实现（不引入任何依赖）**：

```css
/* HUD 角框：四个括号式边角，颜色走 hue 派生，随换色/换肤联动 */
.hud-frame { position: relative; }

.hud-frame::before,
.hud-frame::after {
  content: "";
  position: absolute;
  width: 14px; height: 14px;
  border: 1px solid var(--line-strong);
  pointer-events: none;              /* 不挡点击 */
}
.hud-frame::before { top: -1px; left: -1px;  border-right: 0; border-bottom: 0; }
.hud-frame::after  { bottom: -1px; right: -1px; border-left: 0;  border-top: 0; }

/* 如需四角全有：再挂两个子元素 .hud-frame > i 补右上/左下，或改用 background 四角渐变法 */

/* 悬停时角框变亮（呼应它的"更亮的边角括号线"） */
.hud-frame:hover::before,
.hud-frame:hover::after { border-color: var(--primary); }

/* ⚠ reduce 块里无需处理（角框是静态装饰，非动效） */
```

### 2.2 机甲斜切角（它的"必须"之一）→ **本站早已实现**

**它要的**：`Use mecha-style angled corners via clip-path on panel borders`

**本站现状**：`--clip-corner` / `--clip-corner-sm` 已在 `.post-card`、编辑器等处使用
（`clip-path: var(--clip-corner)`）。**这条不用翻译——你已经超标完成了。**
StyleKit 只是"提出要求"，你是"已经落地 + 分了大小两档"。

### 2.3 纵向扫描线（它的"必须"之一）→ **本站早已实现**

**它要的**：`Layer vertical scan line overlays on holographic panels`

**本站现状**：`.atmo-layer[data-layer="scanline"]` 已用 `repeating-linear-gradient` 实现，
**且额外做了浅底档减半**（`light`/`warm` 主题下从 0.16 降到 0.07）——
**这是 StyleKit 完全没考虑的细节**（它只有暗色一档）。

**结论**：本条也不用翻译。**你是它的超集。**

### 2.4 多层霓虹发光（它的"必须"之一）→ 本站已做，可参考其层数

**它要的**：`multi-layer neon glow (2-3 shadow layers with decreasing opacity)`

**本站现状**：已有 `--glow-cyan` / `--glow-magenta` / `--glow-yellow`，**都是两层**
（`0 0 6px ... /0.75` + `0 0 18px ... /0.35`）。

**它的要求是 2~3 层。** 若要照做，可把 `--glow-cyan` 扩成三层：

```css
/* 参考它的"递减透明度"思路，但色值走 hue 派生 */
--glow-cyan: 0 0 6px  hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.75),
             0 0 18px hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.35),
             0 0 36px hsl(var(--hue) var(--hue-s) var(--hue-l) / 0.15);
```

⚠ **注意**：加层 = 加合成开销。本站已有 84 处 blur/shadow，
**在三档主题 × 低端设备 `data-tier="low"` 下要验证帧率**（见 HANDOVER 的性能保底纪律）。

### 2.5 六边形网格（它的"独有元素"）→ **这是唯一值得真搬的东西**

**它要的**：`Use hexagonal grid background pattern instead of square grid`

**本站现状**：氛围层有 `data-layer="grid"`（透视网格）。**但本站的网格是不是方形，需复核。**

**纯 CSS 六边形网格（可搬，无依赖）**：

```css
/* 六边形网格底纹：用 conic/linear 渐变拼格。色走 hue 派生。 */
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

⚠ **必须同时给 `light`/`warm` 档降低不透明度**（照抄本站 scanline 的处理方式），
否则浅色主题下会像脏污。

### 2.6 终端风格数据读数 → 本站早已实现

**它要的**：`Include terminal/data readout style text with monospace font`

**本站现状**：`--mono` 栈（Cascadia Code → Sarasa Mono SC，**专为中文补了字形**），
`.holo-radar` / `.holo-bars` / `.holo-gauge` 等元件全是终端读数风。

**结论**：本条也不用翻译。**你的中文等宽字体栈是它的盲区。**

### 2.7 动效手感（160~280ms ease-out）→ 与本项目三档对齐

**它要的**：`fast hover lift, active press, glow amplification within 180-280ms`

**本站现状**（C13 收敛的三档）：
```css
--t-fast:   0.15s;   /* 150ms — 瞬时反馈：hover 变色、按钮按下 */
--t-normal: 0.2s;    /* 200ms — 常规过渡：边框、阴影、位移 */
--t-slow:   0.3s;    /* 300ms — 较大位移：滑轨、吐司进出 */
```

**对齐建议**：它的 180~280ms 正好落在本站 `--t-normal`(200ms)~`--t-slow`(300ms) 之间。
**本站的三档设计更清晰，建议保持不动**；若要收敛，把 hover 类反馈统一挂 `--t-fast` 即可。

⚠ **它的禁忌"不许超过 400ms"** → 本站 `--t-slow` 300ms **天然不违规**。✅

---

## 3. 冲突清单（它的规则 vs 本站现实）

| # | 它的规则 | 本站现实 | 处置 |
|---|---|---|---|
| 1 | 全用 Tailwind class | 原生 CSS，零构建 | ❌ **不采纳**，全部翻译成 CSS |
| 2 | 禁亮色背景 | 有 `light`/`warm` 两档主题 | ❌ **不采纳**，三档保留 |
| 3 | 硬编码紫/青/粉 | `--hue` 单旋钮派生 | ❌ **不采纳**，走变量 |
| 4 | 禁 `border-2` | 本站用 1px + `--line` | ✅ 本就一致 |
| 5 | 禁 `rounded-full` | 本站全斜切角 | ✅ 本就一致 |
| 6 | 禁 `font-serif` | 本站无衬线 + 等宽 | ✅ 本就一致 |
| 7 | 禁 `shadow-sm/md/lg` | 本站只有霓虹发光 | ✅ 本就一致 |
| 8 | 六边形网格 | 本站是方形/透视网格 | 🟡 **值得搬**（见 2.5） |
| 9 | HUD 角框 | 本站只有斜切角，无括号角框 | 🟡 **值得加**（见 2.1） |
| 10 | 多层霓虹（2-3 层） | 本站两层 | 🟡 **可扩到三层**（见 2.4，需验帧率） |
| 11 | 扫描线叠加 | 本站已做，且**多了浅底减半** | ✅ 本站更优 |
| 12 | 终端等宽读数 | 本站已做，且**中文有字形** | ✅ 本站更优 |

**统计：❌ 不采纳 3 条（都是它的环境假设错误）｜✅ 本就一致 5 条｜🟡 值得搬 3 条。**

---

## 4. 落地建议（若漓江要动手）

**优先级排序（收益/风险比）：**

| 优先级 | 做什么 | 改动量 | 风险 |
|---|---|---|---|
| **P1** | 加 `.hud-frame` 角框（纯 CSS，~20 行） | 极小 | 低（新增类，不碰老样式） |
| **P2** | 六边形网格底纹（替换/新增氛围层纹理） | 小 | 低-中（需验证三档主题下观感） |
| **P3** | 霓虹发光扩到三层 | 极小（改变量值） | **中**（增合成开销，需实测帧率） |

**必须遵守的项目纪律（11 条，见 HANDOVER §5）：**
1. 改 `css/` → **必须 bump 版本号**（`?v=` 是唯一缓存击穿手段）
2. bump 的 `--title`/`--item` 用「」不用双引号
   > ⚠ **2026-10-02 实测更正**（由后续 agent 追加，原文未改）：这条说法不准确。
   > `bump.js` 的解析是 `--title=` 之后**取全部**，所以取决于 shell 怎么剥引号：
   > `--title="简单标题"` → 收到 `简单标题` ✅；`--title=「测试标题」` → 收到 `「测试标题」` ❌（括号成了内容）；
   > 真正的坑是**嵌套** ASCII 双引号（`--title="他说\"你好\""` → 内层被吞）。
   > 正确做法：用引号包住值；值里含双引号时用**外层单引号** `--title='他说"你好"'`。
3. 改配色 → **必须同时跑** `39-v3-0-0-b1-tokens.js` 与 `20-o9-色标.js`（真算对比度）
4. 断点块不得新增（R202d 守 ≤16 个）—— 新规则并入既有 `@media` 块
5. reduce 块内**单行写法**（R112e）
6. 新增样式若涉及颜色，必须**三档主题都验**（dark/light/warm）
7. 改完 `npm run gate` 全绿才允许发布

⚠ **前置条件**：本项目**当前没有 git**，且**正被另一个 agent 并发修改**（55/56/57 号 case）。
**动手前必须先建 git + 确认对方停工。**

---

## 5. 一句话总结

> **这份 StyleKit 的"视觉要求"，你本站已经完成了 5/12，且有 3 条做得比它更好**
> （扫描线含浅底减半、中文等宽字形、斜切角分大小两档）。
> **真正值得搬的只有 3 条：HUD 角框、六边形网格、霓虹加一层。**
> **它教不了你怎么"套用"——只能给你"几块砖"。**
