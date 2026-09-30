# 测试与调试笔记（NEON://DIARY 项目）

> 本文件是 `.workbuddy/memory/MEMORY.md` 的配套参考 —— 内容偏「长尾经验」，
> 不需要每次会话都注入。碰测试/样式/浏览器自动化时**按需读本文件**。
> MEMORY.md 里只留「必须时刻记住」的判据。

## 一、测试架构

- `tests/cases/*.js`（35 个）+ 编排层 `tests/regress.js` + `tests/case-runner.js`
  （`makeSuite`/`checkDuplicateNames`/`checkCaseCounts`/`lintFloatingAsync`/`standalone`）
  + `tests/cases/manifest.json`（断言数基线）+ `tests/common.js`（`SRC`/`bootDom`/`stripComments`）。
- 每个 case 可 `node tests/cases/xx.js` 独立跑（`standalone` 只在 `require.main` 时自跑，
  所以也能被别的脚本安全 require）。
- **增删断言后必须 `npm run baseline`**（红项被拒写）。新增 case：手写文件 → manifest 加 `expect: null` → 跑 baseline。
- ⚠ `tools/split-regress.js` 是**一次性拆分器，重跑会覆盖**，别再跑
  （`regress.js` 头注释里那句"新增 case 跑 --write"是错的）。
- 门禁三套件：故障注入 `fault-matrix.js` / 功能回归 `regress.js` / 行为沙箱 `sandbox-p2.js`。

### 三大静默失联坑

1. 忘写 `module.exports = { name, run }` → 单跑静默 exit 0（看起来"全绿"）。
2. 不 `await`（见下）。
3. `makeSuite()` 只返回 `{T, results, BUILD}`，**没有 `pass`/`fail`** —— 必须自己
   `results.filter(r => r.pass).length` 算。

### ⚠⚠ 三个让测试「全假绿」的机制性陷阱

- **`tests/common.js` 的 `SRC` 是 require 时一次性读进内存的** ——
  反向验证改完磁盘源码后，**必须连 `common.js` / `case-runner.js` 的 require 缓存一起清**，
  否则测的还是旧源码，摘掉修复照样"全绿"。
- **⚠⚠⚠ 还必须清「case 文件自己」** —— 这条最隐蔽，2026-09-29 实测踩到：
  只清 `common`/`case-runner` 时，第 1 轮 `require(CASE)` 会把 case 模块**缓存**下来，
  它的闭包里攥着**第 1 轮那份源码**。于是第 2 轮起 `require(CASE)` 直接返回旧模块、
  `run()` 用的是**上一轮变异**的源码 ⇒ 命中原因完全错位（实测 4 条变异只报 1 条，
  另 3 条被第 1 轮的残留"救"成假绿 —— 差点据此写下错误结论）。
  **正确写法**（每轮变异前后都要调）：

  ```js
  function purge(CASE) {
    delete require.cache[require.resolve(CASE)];          // ← 关键，别漏
    Object.keys(require.cache).forEach(k => {
      if (/tests[\\/](common|case-runner)/.test(k)) delete require.cache[k];
    });
  }
  ```
- **`run()` 是 async** —— 必须 `await m.run()`。不 await 得到 `undefined`，
  调用方若不检查就**静默判「仍绿」**。

### 反向验证（每条防回归断言都要「摘掉修复 → 确认报红 → 恢复转绿」）

**推荐写法：一次性脚本 + `MUTATIONS` 表**，每条 `{ id, file, from, to, expect }`：

```js
// 1) 写盘改动
fs.writeFileSync(p, src.replace(m.from, m.to));
// 2) 清缓存（⚠ 关键：SRC 是 require 时读进内存的）
Object.keys(require.cache).forEach(k => { if (/tests[\\/](common|case-runner)/.test(k)) delete require.cache[k]; });
// 3) await 跑（⚠ run() 是 async）
const res = await require(CASE).run();
// 4) 立刻写回
fs.writeFileSync(p, src);
// 5) 断言：results 里存在 !pass && name.includes(expect)
```

- 实测一次可覆盖 16 条，远好于逐条手改；**脚本用完即删**（别进构建/版本库）。
- ⚠ **别用 `| head` 截断管道**（SIGPIPE 杀进程 → 可能停在"已改未恢复"中间态）。
- ⚠ **沙箱别用 `execSync`/`spawnSync`**（EBUSY）→ 用「清 require 缓存 + 进程内重跑」。
- ⚠ **变异点要选对**：只改函数体、不动签名，那么钉签名的断言不会红 ——
  会误判成「假绿」。先想清楚断言钉的是什么再设计变异。

## 二、假绿八形态

① 样本抽查漏边界；② 常量写死在测试侧；③ 断言太弱；④ 正则被注释/文档救活；
⑤ `hasOwnProperty` 穿 undefined；⑥ **贪婪匹配吞掉后续内容**；⑦ `indexOf('foo()')` 命中函数定义行；
⑧ **⚠⚠ 带大窗口的懒匹配跨出函数边界**（2026-09-29 实测，见下）。

### ⚠⚠ 形态⑧：`/function foo[\s\S]{0,900}?A[\s\S]{0,900}?B/` 这种"带窗口的懒匹配"必然跨界

**症状**：把 `foo()` 函数体内那行赋值**整行删掉**，断言**照样绿**（反向验证 3 条只命中 2 条）。

**病因**：懒匹配只在**「A 之后 900 字符内出现 B」**这个意义上最短，它**不知道函数在哪结束**。
删掉赋值行后 `A`（如 `[data-radio-dur]` 的取值行）仍在，窗口就一路蹭到**函数之外**别处的 `B`
（如另一个函数里的 `.textContent =`）⇒ 匹配成功 ⇒ 断言以为"两件事都在"，
**实际它俩早已不在同一个函数里** —— 断言钉的是"共存"，代码坏的是"绑定"。

**正解：先按花括号配平把函数体抠出来，再在体内断言。**范围被物理限制死：

```js
function fnBody(src, name) {
  const key = 'function ' + name;
  const i = src.indexOf(key);
  if (i < 0) return '';
  const b = src.indexOf('{', i);
  if (b < 0) return '';
  let d = 0, j = b;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) break; }
  }
  return src.slice(b + 1, j);
}
// 建议再拆成两半分别判，报错能说清是哪一半失守
const body = fnBody(code, 'paintPanelProgress');
const hasA = body.indexOf('[data-radio-dur]') >= 0;
const hasB = /\.textContent\s*=\s*[\s\S]{0,60}?fmtTime\(\s*st\.duration/.test(body);
T(name, hasA && hasB, '体内缺' + (hasA ? '' : ' 取值') + (hasB ? '' : ' 回写'));
```

⚠ `fnBody` 的花括号计数**不识别字符串/正则里的裸花括号** —— 用前确认目标函数体内没有这类字面量
（本项目 `paintPanelProgress` 体内就没有；有的话得先剥字符串）。

**通用判据**：只要断言里出现「函数名 ⋯ `{0,N}` ⋯ 关键字」这种形式，就要怀疑它会不会跨界。
**给匹配设"窗口"是权宜，给匹配设"边界"才是正确。**

## 三、提取源码块的高频事故

- **扫源码前必须剥注释**（注释常引用被禁写法 → 不剥会假红）。
  ⚠ `stripJsLineComments` **只剥 `//`，不剥块注释**。
- **⚠⚠ 贪婪匹配 `[\s\S]*` 到文件末尾**：`@media print` **不在 CSS 文件末尾**（后面还有电台样式），
  用 `/@media\s+print\s*\{[\s\S]*/` 提取会把后续样式一并吞进来 ⇒ 主样式里的
  `.radio-dock[hidden]{display:none}` 被当成"打印隐藏"命中 ⇒ **摘掉实现照样绿**。
  → **提取 `@media` 块必须按花括号配平**。
- **⚠ 正则捕获组只拿到「前导数字」**：`/AUDIO_MAX\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/`
  捕获的是 `24` 而不是 24MiB —— 拿它算 base64 长度会得出荒唐结果。**捕获后要自己乘回**。
- **⚠ 喂 `new Function` 的代码块要用 lookahead 收尾**：`[\s\S]*?(?=function xxx)`。
  若把 `function xxx` 本身吃进来，就留了个**没有函数体的声明** → `SyntaxError`。
- **⚠ 断言/源码注释里写正则含 `*/` 会提前闭合块注释 → SyntaxError**：描述请用文字，别写字面 `*/`。
- **⚠ `mediaBlocks` 子串匹配**：`/print/.test(c)` 会被 `@media printX` 命中 → 用 `/\bprint\b/`。
- **⚠ 标准属性 + `-webkit-` 前缀成对出现**：改一处必须改两处，断言必须**两条都钉**。

## 四、断言设计原则

- **先怀疑断言，再怀疑代码**。
- **异步断言必须 `await`**（`checkCaseCounts` + `lintFloatingAsync` 双防线守着）。
- **断言数只能跑出来，不能数出来**（静态数 427 vs 实测 453，差额来自循环生成的断言）。
- **钉语义不钉字面**（select 字符串全等比较过脆 → 改钉"含 data 列"）。
- **常量联动要"从一个推导另一个"**，别在测试里写死两边 ——
  如「库层上限 ≥ 单曲上限的 base64 最坏长度」，调大单曲上限却忘同步库层会被立刻抓住。
- **从「条数」这类弱约束升级为「行为」**：如缓存不能只断言"有 MAX 常量"，
  要真跑一遍淘汰逻辑，验证超限时丢最旧、最近使用仍命中。

## 五、CSS / 布局认知

- **加法光幕层四件套**：`position: fixed` + `inset: 0` + `pointer-events: none` + `z-index: 0`
  + `opacity: var(--deco-faint)`；颜色走 `color-mix(...)`，不硬编码霓虹色。
  **想「只提亮不变暗」用 `mix-blend-mode: screen`**；`overlay`/`soft-light` 会**双向作用**（也压暗）。
- **「看不见」两种病因要分清**：① **可见面积不足**（fixed 层盒高=视口，短页停在 mask 全透明顶端
  → 让短页撑满一屏）；② **可见强度不足**（层都在视野内但 alpha 太低 → 调参）。
  **先问「是看不见，还是看得见但太暗」**。
- `clip-path` 会裁掉元素**自身**的 `box-shadow`（外发光失效，需双层 wrapper）。
- `perspective` 有属性/函数两种等价写法（断言用 `/perspective\s*[:(]/`），
  且**作用于 `html`/`body` 会建立 3D 包含块、破坏内部 `position: fixed` 基准**。
- 顶层规则遍历器必须剥选择器内注释。
- **布局问题一律用 `getBoundingClientRect()` 量矩形相交**，别靠目测截图
  （抗锯齿/装饰层/缩放都会骗人）。判相交：`tr.right <= br.left || ...`，并输出 `gap` 正负。

## 六、jsdom / 沙箱坑

- jsdom 默认无 `IntersectionObserver`。
- jsdom 30 不把 `img.decoding` 反射成 attribute。
- jsdom 要 `runScripts:'outside-only'` 才能让 `w.eval` 里的 `window` 生效。
- **jsdom 无 Audio** —— 必须造桩，并观测 `setAttribute` 等**调用**而不是只读属性。
- 等待渲染要等**真实元素出现**，而不是 `innerHTML.length`。

## 七、工具链坑

- 抠源码正则别用 `node -e`（吞 `\s`）→ 用 Write 写脚本再跑。
- 切分 JS 用 **acorn AST**，别手写正则。
- 测试正则别写嵌套量词（灾难性回溯会挂死）。
- ⚠ **Git Bash 的 `/tmp` 就是 `C:\Users\liu\AppData\Local\Temp`**（2026-09-29 `pwd -W` 实测确认）。
  早前笔记里「bash 写 `/tmp/x` 落到 `C:\tmp`」的说法**是错的**，别再据此推路径。
  但仍有一个真实的跨工具坑：**Node 收到的 `/tmp/x` 会按「当前盘符的根」解析**（在 C 盘跑就是 `C:\tmp\x`），
  与 bash 的 `/tmp` 不是同一个地方 ⇒ Node 读 bash 写的 `/tmp/x` 会 ENOENT。
  **跨工具传文件一律写绝对 Windows 路径**（`C:/Users/liu/AppData/Local/Temp/...`）；
  需要 bash 侧路径的真实位置时用 `cd <dir> && pwd -W` 求出来，别猜。

## 八、浏览器自动化补充（配合 skill `agent-browser-windows`）

- **探针必须「每次重查 DOM」**：面板类交互会重渲染，复用旧引用会点到**游离节点**、
  事件不冒泡 → 误判「所有交互都挂了」（实测浪费一整轮）。
  写法：`function P(){ return document.querySelector('.radio-panel'); }`，每次 `P().querySelector(...)`。
- **量测遮挡用 `elementFromPoint` / `elementsFromPoint`**，比目测截图可靠。
- ⚠ **`nohup ... &` 起的后台作业会随该次工具调用结束被回收**（2026-09-29 实测）：
  只在这一种写法下成立 —— `nohup ... &` + `sleep` + `cat` **全在同一个工具调用里**。
  跨轮"起完就返回、下一轮再读日志"必然拿到**空日志 + 无 chrome 进程**，
  极易误判成"浏览器又坏了"。跨轮唯一可行做法：把整条会话写成 `.sh`，用**工具侧 `run_in_background: true`** 跑。
  本机 `agent-browser` 同样适用（旧笔记里"`nohup` 是唯一正解"的说法已过时）。
- ⚠ **本地起服 / 长任务一律用工具侧 `run_in_background: true`**，**别用 `nohup &`**
  （python/npm/agent-browser 都一样，会随上一轮 shell 结束被回收）。
  例：`python -m http.server 8899 --bind 127.0.0.1` 走 `run_in_background: true`。
- ⚠ **一次工具调用的总时长必须小于工具超时**（默认 120s）：别把「慢命令 + 长 sleep」堆在同一调用里
  （实测 `timeout 40 "$AB" close` + `sleep 90` 直接被 SIGTERM 掉，日志必失）。清理动作单独跑。
- ⚠ **本地打云服务必失败**（`TypeError: Failed to fetch`，网关拦 Origin，与功能无关）⇒
  **「匿名能否读写」这类验收只能在部署后于线上做**，或用 curl 直连数据 API。

## 九、反向验证（变异测试）怎么跑才不作假（2026-09-29 v2.9.4 实操）

### ⚠ 坑一：用子进程解析 stdout ⇒ 拿到「0 红」的全假结果

case 的 `standalone()` 走 `process.exit()`；stdout 是**管道**时异步写入会被截断，
`execFileSync` 拿到的 stdout 是空的 ⇒ 每个变异都显示"报红 0 项"，看起来像全假绿。

**正解：直接 `require` 跑，不要起子进程。**

```js
for (const k of Object.keys(require.cache)) {
  if (k.indexOf(path.join(ROOT, 'tests')) !== -1) delete require.cache[k];  // 连 case 自己一起清
}
const r = await require(casePath).run();      // run() 是 async，必须 await
r.results.forEach(x => { if (!x.pass) red.push(x.name); });
```

### ⚠ 坑二：断言扫全文件 ⇒ 命中自己写的注释（假红）

`!/<input[^>]*type="radio"/.test(SRC.app)` 会扫到 app.js **注释**里
"为什么不用原生 <input type=radio>"那句话 ⇒ 明明实现是对的却报红。
**结构断言一律限定到函数体**：用 `fnBody(src, name)` 抠出花括号配平的片段再断言。

### ⚠ 坑三：数"字面出现次数"会被共用声明骗到（假红）

`.theme-swap-ring::before, .theme-swap-ring::after { border: 1px dashed ... }` ——
一条声明服务两个伪元素，字面只有 2 处 dashed，视觉上是 3 层环。
**不能数出现次数，要钉结构**：本体环有 dashed + 两个伪元素各有 `inset` 且方向相反（内环/外环）。

### ⚠ 坑四：断言里链式取属性 ⇒ 变异时是"崩溃"不是"报红"

`menu.querySelector('[aria-checked="true"]').getAttribute('tabindex')`
在"没有选中项"时抛 TypeError，整个 case 跑挂。
两种失败要分清楚：**崩溃 ≠ 报红**。先取变量判空再断言。

### 两个既有的行数/字面型启发式（踩过）

- **R112e**（case 33）：不是"reduce 块在末尾"，而是
  「reduce 块起始处 → 文件结尾，匹配 `/^[.#@a-zA-Z*]/` 且不含 `}` 的行 **< 20**」。
  在块内加 3 行选择器会从 19 → 21 报红 ⇒ **新规则压成一行**。
- **R105**（case 32）用 `hoverBlk.match(/\.btn-magenta:hover:not\(:disabled\)\s*\{([^}]*)\}/)`
  按**字面选择器**匹配 ⇒ 改动 `.btn-magenta:hover` 时要保持这个精确写法，
  别改成 `:is()` 或换顺序。

## 十、CSS 断言补充（2026-09-29 v2.9.5）

- **`@property` 是顶层 at-rule**，`topLevelRules()` 会把它当普通选择器抓出来（selector=`@property --halo-spin`）。
  写涉及它的断言时要么专门匹配 `@property\s+--xxx\s*\{[^}]*syntax:`，
  要么确保其它规则的锚点选择器不会带 `@property` 前缀混淆。
- **裸时长写在 `animation` 里是三不管地带**：R66m 只扫 `transition:`、R72k 只认 `--t-*` 变量、
  reduce 块的 `*` 通配虽然会归零 animation-duration，但那是"兜底"不是"承诺"。
  ⇒ 凡是 `animation: xxx 7s ...` 这种，**必须在 reduce 块里显式补一条 `animation: none`**，
  并且在注释里写明"别指望兜底"。
- **R112e 预算为 0 时的写法**：reduce 块内新增规则一律压成**单行**（该启发式不统计含 `}` 的行）。
  多行规则每多一行选择器/声明就多计 1。
- **剥注释后再断言**：`backglitch` 这类"被拒绝的技法"如果只写在注释里说明，
  断言必须跑在 `stripComments()` 之后 —— 否则自己写的"我们没用 X"注释会让断言误报红。

## 十一、CSS 断言补充（2026-09-29 v2.9.10 数字上色）

### ⚠ 坑五：`-webkit-` 前缀会把标准属性断言骗过（假绿）

`/background-clip:/s*text/` 会被 `-webkit-background-clip: text` 的**子串**命中 ⇒
摘掉标准属性断言照样绿。**两个前缀必须分别断言**，且标准属性那条要加"非前缀边界"：

```js
/(?:^|[;\s])background-clip:/s*text/.test(body)   // ✓ `-webkit-...` 前面是 `-`，不匹配
/-webkit-background-clip:/s*text/.test(body)      // ✓ 单独一条
```

同类风险：`transition`/`animation`/`mask-image`/`backdrop-filter` 等有 `-webkit-` 变体的属性都适用。

### ⚠ 坑六：`@keyframes` 体内有嵌套 `}` ⇒ 懒匹配在第一个内层 `}` 截断

```js
/@keyframes uptime-breathe\s*\{([\s\S]*?)\n\}/.exec(css)   // ✗ 只拿到第一档（0%,100%），
                                                          //   /50%/ 永远不命中 → 假红
```
正解：**按花括号配平抠块**（`blockAfter(src, '@keyframes xxx')`，与 `fnBody` 同构）。
固定窗口（`slice(at, at+600)`）同样不行 —— 会跨出关键帧边界扫到邻居（与"大窗口懒匹配"同源）。

### 伪元素动画的 reduce 覆盖：`!important` 能跨特异性取胜

`.uptime-num b::before { animation: none !important; }`（0,1,1）可以压住
`.uptime-num b:hover::before { animation: uptime-burst … }`（0,2,1）——
作者样式内 `!important` 优先于非 `!important`，与特异性无关。
**所以 reduce 块只需一条选择器组，不必为每个 `:hover` 变体各写一条**（省 R112e 预算）。

### hover 铁律的判据写法：用「总数 = 块内数」反查

想把「新加的 hover 规则没漏出 `@media (hover: hover)`」变成断言，别用
`css.replace(hvBlk, '')` —— `hvBlk` 是**多个媒体块拼接**出来的串，不是 `css` 的子串，
replace 必然失配 ⇒ 断言恒假红。可靠写法：

```js
const total = (css.match(/\.uptime-num b:hover/g) || []).length;
const inBlk = (hvBlk.match(/\.uptime-num b:hover/g) || []).length;
// 断言 total > 0 && total === inBlk
```

### 渐变文字的三件套 + 与 text-shadow 互斥（实现知识）

`background-image: linear-gradient` + `background-clip: text`（含 `-webkit-`）+ `color: transparent`
三者缺一不可。**且必须去掉 `text-shadow`**：字形色为 `transparent` 后，
阴影成了可见主体，观感是一坨糊色块 ⇒ 光晕改 `filter: drop-shadow()`（作用于渲染后的不透明像素）。
`--glow-*` 是**两层阴影**的简写值，塞不进单层 `drop-shadow()`，用
`color-mix(in srgb, var(--cyan) 60%, transparent)` 现调。

### 呼吸的写法：动 `filter` 不动 `opacity`

`opacity` 会把字形一起变淡（那是闪烁不是呼吸）；`filter: drop-shadow(...) brightness(...)`
只让"光"起伏，字始终清晰。**一套 keyframes 服务两处语义**：色相经自定义属性注入
（`--breathe-c: var(--cyan)` / `var(--magenta)`），不必写两份呼吸动画。
`animation` 是简写 ⇒ hover 规则里必须把 `breathe` 一并写回，否则一悬停就"屏住呼吸"。
