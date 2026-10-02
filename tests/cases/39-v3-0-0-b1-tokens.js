'use strict';
/* ============================================================
   tests/cases/39-v3-0-0-b1-tokens.js — v3.0.0 B1 地基

   B1 做的是"看不见但处处生效"的一层：
     ① 配色旋钮：--hue 单变量派生体系（chrome 层）
     ② 语义色固定不旋转（品红/绿/黄/红 —— "能调气质，不能调语义"）
     ③ 两档派生参数（dark / light 各自的 --hue-s / --hue-l）
     ④ 间距九级刻度 + 容器三档 + Banner / 人味层圆角 / 衬线 tokens
     ⑤ 断点体系登记（1280 / 1024 / 768 / 480）
     ⑥ 首绘前引导脚本与运行时的色相白名单逐值一致

   ⚠ 本 case 的两个特有风险：
     · 变量断言必须落在**正确的档位块**里 —— 全局 grep '--hue-l' 会先命中 :root，
       于是"亮色档是否压暗"永远为真（假绿）。故按块切片后再测。
     · "两处白名单一致"是跨文件的**协同判据**：单独看哪一份都正常，
       不一致才会在真机上表现为"刷新一瞬间变回默认色"。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');

/* 取某个选择器块的声明体（花括号配平；块内无嵌套时等价于首尾配对） */
function blockOf(css, sel) {
  const at = css.indexOf(sel);
  if (at === -1) return '';
  const open = css.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(open, i + 1); }
  }
  return '';
}

function readFile(rel) {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8'); }
  catch (e) { return ''; }
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = SRC.css;
  const rootBlk = blockOf(css, ':root {');
  const lightBlk = blockOf(css, 'html[data-theme="light"]');
  const bootSrc = readFile('js/theme-boot.js');
  const appSrc = SRC.app;

  /* ================= ① 配色旋钮（chrome 层派生） ================= */
  {
    const CN = 'B1 地基';

    T(CN, 'R175 配色旋钮在场：--hue 默认 285（紫，v4.5.0 起的出厂色相）',
      /--hue:\s*285\s*;/.test(rootBlk),
      (/--hue:\s*\d+/.exec(rootBlk) || ['未找到 --hue'])[0]);

    T(CN, 'R175b --primary 由 hsl(var(--hue) …) 派生（单一旋钮的落点）',
      /--primary:\s*hsl\(var\(--hue\)/.test(rootBlk),
      '未找到派生式 --primary');

    /* 旧名保留为别名，是"全站 800+ 处引用一行不改却能整体变色"的关键 */
    T(CN, 'R175c 旧变量名保留为别名（--cyan → var(--primary)）',
      /--cyan:\s*var\(--primary\)/.test(rootBlk),
      '--cyan 未指向 --primary');

    /* v3.6.0：--grid-line 随氛围层移除 ⇒ 从本清单去掉（它已不存在，不是"派生失效"） */
    const derived = ['--line', '--line-strong', '--glow-cyan', '--head-glow'];
    const missing = derived.filter(function (v) {
      const re = new RegExp(v + ':[^;]*hsl\\(var\\(--hue\\)');
      return !re.test(rootBlk);
    });
    /* ⚠ v3.4.2 批 B 补：光查"变量定义走派生"是不够的 —— 批 B 之前 `--grid-line` 与
       `--head-glow` 就是这么躺在定义里零引用的（改了它们毫无效果）。
       所以这里同时钉住"**它们真的被引用**"：定义与使用两件事都要成立，
       否则"换色相它们一起变"这句承诺只在纸面上成立。 */
    const notUsed = derived.filter(function (v) {
      return (css.match(new RegExp('var\\(\\s*' + v + '\\s*[,)]', 'g')) || []).length === 0;
    });
    T(CN, 'R175d 线 / 辉光 / 网格 / 头顶光晕走 hsl 派生**且确实被引用**（换色相它们一起变）',
      missing.length === 0 && notUsed.length === 0,
      (missing.length ? '未派生：' + missing.join(' ') : '') +
      (notUsed.length ? ' | 零引用：' + notUsed.join(' ') : '') || '五项齐备且均被使用');

    T(CN, 'R175e 辅助紫按色相偏移派生（calc(var(--hue) + --vio-off)）',
      /--violet:\s*hsl\(calc\(var\(--hue\)\s*\+\s*var\(--vio-off\)\)/.test(rootBlk),
      '未找到偏移式 --violet');
  }

  /* ================= ② 语义色固定不旋转 ================= */
  {
    const CN = 'B1 地基';
    /* 这是本批最重要的一条红线：色即信号 ——
       品红=流逝/警示、绿=在线、黄=高亮。若它们跟着 --hue 走，
       用户换个色相就会把"警示"变成"在线色"，语义直接崩掉。 */
    const sem = ['--magenta', '--green', '--yellow', '--red'];
    const leaked = sem.filter(function (v) {
      const m = new RegExp(v + ':([^;]*)').exec(rootBlk);
      return !m || /var\(--hue\)/.test(m[1]);
    });
    T(CN, 'R175f 语义色四条均不引用 --hue（能调气质，不能调语义）',
      leaked.length === 0,
      leaked.length ? '被色相污染：' + leaked.join(' ') : '四条语义色固定');

    T(CN, 'R175g 语义色仍被显式声明（不是被顺手删掉）',
      sem.every(function (v) { return new RegExp(v + ':').test(rootBlk); }),
      '缺项');
  }

  /* ================= ③ 两档派生参数 ================= */
  {
    const CN = 'B1 地基';
    T(CN, 'R175h 亮色档覆盖压暗参数（--hue-l ≤ 35%）',
      lightBlk.length > 0 && /--hue-l:\s*(\d+)%/.test(lightBlk) &&
      parseInt(/--hue-l:\s*(\d+)%/.exec(lightBlk)[1], 10) <= 35,
      lightBlk ? (/--hue-l:\s*\d+%/.exec(lightBlk) || ['无'])[0] : '未找到亮色块');


    /* ⚠ v5.7.3 改判：原为「三档齐备（暗/亮/暖）」—— 暖色档 warm 已删除，
       判据相应收到**两档**（dark 的 :root + light 覆盖块）。
       守的东西没变：每个档位都必须自带一套紫派生参数，否则该档下辅助紫会失真。 */
    T(CN, 'R175j 紫的派生参数两档齐备（暗/亮各有一套 --vio-s/--vio-l）',
      /--vio-s:/.test(rootBlk) && /--vio-s:/.test(lightBlk) &&
      /--vio-l:/.test(lightBlk),
      '某档缺紫参数');
  }

  /* ================= ④ 间距 / 容器 / Banner / 人味层 ================= */
  {
    const CN = 'B1 地基';
    const want = { '--s1': 4, '--s2': 8, '--s3': 12, '--s4': 16, '--s5': 20, '--s6': 24, '--s7': 32, '--s8': 48, '--s9': 64 };
    const bad = Object.keys(want).filter(function (k) {
      const m = new RegExp(k + ':\\s*(\\d+)px').exec(rootBlk);
      return !m || parseInt(m[1], 10) !== want[k];
    });
    T(CN, 'R175k 间距九级刻度齐备（4px 基准：4/8/12/16/20/24/32/48/64）',
      bad.length === 0, bad.length ? '不符：' + bad.join(' ') : '九级齐备');

    /* v3.4.2 批 B：--w-page 已删除 —— 它是 --w-read + 240 + 44 的**派生量**，
       做成 :root 旋钮会让人误以为调它能动详情页外壳宽度（实则改任一分量它就失真）。
       判据从"三档齐备"改为"两档齐备 + 派生量不得回流"。 */
    T(CN, 'R175l 容器两档（--w-read 760 / --w-wide 1240），派生量 --w-page 已移除',
      /--w-read:\s*760px/.test(rootBlk) && /--w-wide:\s*1240px/.test(rootBlk) &&
      !/--w-page\s*:/.test(css),
      /--w-page\s*:/.test(css) ? '--w-page 回流' : '两档齐备');

    T(CN, 'R175m Banner 高度成对定义（--banner-h / --banner-h-home）',
      /--banner-h:\s*\d+px/.test(rootBlk) && /--banner-h-home:\s*\d+px/.test(rootBlk),
      'Banner 变量缺失');

    /* ★ 设计意图判据：人味层圆角与系统层切角**同值**（14px）——
       同尺度、两种性格。改了一个忘了另一个，这条会红。 */
    const rSoft = /--r-soft:\s*(\d+)px/.exec(rootBlk);
    const clip = /--clip-corner:\s*polygon\(([^)]*)\)/.exec(rootBlk);
    T(CN, 'R175n 人味层圆角与系统层切角同值（--r-soft == --clip-corner 的切角尺寸）',
      !!rSoft && !!clip && clip[1].indexOf(rSoft[1] + 'px') !== -1,
      'r-soft=' + (rSoft ? rSoft[1] : '?') + 'px / clip 内含 ' + (clip ? clip[1].slice(0, 40) : '?'));

    /* v4.0 迁移：v3.0 时代的判据是"全站零 @font-face"；4.0 起 --mono 引入了
       自托管的中文补丁（Sarasa Mono SC 子集，修"中文掉新宋体"的技术债 ——
       见 assets/fonts/README.md）。判据升级为两条硬约束（不是放松）：
         ① 衬线栈（--font-serif-cn）必须仍是纯系统栈，点名里不得出现自托管字体；
         ② 每个 @font-face 必须白名单化：只允许 "Sarasa Mono SC"，
            任何别的自托管字体族出现即红（新增必须走显式迁移）。 */
    const faceBlocks = css.match(/@font-face\s*\{[^}]*\}/g) || [];
    const serifStack = (/--font-serif-cn:\s*([^;]+);/.exec(rootBlk) || [, ''])[1];
    const faceOk = faceBlocks.every(function (f) {
      return /font-family:\s*"Sarasa Mono SC"\s*;/.test(f);
    });
    T(CN, 'R175o 衬线走系统字体栈；@font-face 白名单化（仅 --mono 的 Sarasa 中文补丁）',
      /--font-serif-cn:\s*["']/.test(rootBlk) &&
      serifStack.indexOf('Sarasa') === -1 &&
      faceOk,
      faceBlocks.length + ' 个 @font-face' +
        (faceOk ? '' : '（含白名单外的字体族）') +
        (serifStack.indexOf('Sarasa') !== -1 ? '；衬线栈被污染' : ''));
  }

  /* ================= ⑤ 断点体系登记 ================= */
  {
    const CN = 'B1 地基';
    const hits = ['1280', '1024', '768', '480'].filter(function (n) {
      return rootBlk.indexOf(n) !== -1;
    });
    T(CN, 'R175p 断点体系四值已在 tokens 处登记（1280 / 1024 / 768 / 480）',
      hits.length === 4,
      '登记到 ' + hits.length + ' 个');
  }

  /* ================= ⑥ 跨文件协同：色相校验 ================= */
  {
    const CN = 'B1 地基';
    /* v3.4.0：色相由「九档白名单」放开为自由滑杆（0~359）
       ⇒ 这条判据从"清单逐值一致"升级为"**范围一致**"。
       这才是现在真正会出问题的耦合点 —— 范围不一致同样会让
       首绘写进去的值被运行时判成脏值，表现为"刷新一瞬变色、随即跳回"。 */
    const bootMin = /var HUE_MIN = (\d+)/.exec(bootSrc);
    const bootMax = /var HUE_MAX = (\d+)/.exec(bootSrc);
    const appMin = /var HUE_MIN = (\d+)/.exec(appSrc);
    const appMax = /var HUE_MAX = (\d+)/.exec(appSrc);
    T(CN, 'R175q 引导脚本与运行时的色相**范围**一致（0~359，防「刷新闪回默认色」）',
      !!bootMin && !!bootMax && !!appMin && !!appMax &&
      bootMin[1] === appMin[1] && bootMax[1] === appMax[1] &&
      appMin[1] === '0' && appMax[1] === '359',
      'boot=[' + (bootMin && bootMin[1]) + ',' + (bootMax && bootMax[1]) +
        '] app=[' + (appMin && appMin[1]) + ',' + (appMax && appMax[1]) + ']');

    /* 原来的 early return 会让"选过主题色的用户"永远拿不到自己的色相。
       ⚠ v4.3 修截取缺陷：原实现用 indexOf('} catch') 截取 —— 函数内一旦出现
       嵌套 try（B4 的 manual 解析），第一个 '} catch' 就被嵌套 catch 劫持，
       体检范围腰斩（后半段全漏检）。改为**花括号配平**提取外层 try 块全文；
       同时把 return 判据收紧到"行首"——判据本意是"顶层 early return"
       （会打断色相写入的那种），而函数表达式里的 return（如 filter 回调）
       被误伤过一次（实锤：B4 的 manual 解析代码）。 */
    const tryBlk = (function () {
      const at = bootSrc.indexOf('try {');
      const open = bootSrc.indexOf('{', at);
      if (at === -1 || open === -1) return '';
      let depth = 0;
      for (let i = open; i < bootSrc.length; i++) {
        if (bootSrc[i] === '{') depth++;
        else if (bootSrc[i] === '}') { depth--; if (depth === 0) return bootSrc.slice(open, i + 1); }
      }
      return '';
    })();
    T(CN, 'R175r 引导脚本在同一时机写完主题与色相（try 块内无顶层 early return 打断）',
      /setAttribute\(/.test(tryBlk) && /setProperty\('--hue'/.test(tryBlk) &&
      !/^\s*return\b/m.test(tryBlk),
      /setProperty\('--hue'/.test(tryBlk) ? (/^\s*return\b/m.test(tryBlk) ? '仍有 return' : '同块完成') : '未写色相');

    /* ⚠ 不能只查"hueValid 函数还在" —— 把三处调用改回白名单后函数定义照样在场
       （B3 学过的老坑：**必须同时钉住"定义"与"它的使用"**）。
       校验点应有四处：函数定义 1 处 + getHue / applyHue / setHue 各 1 处。 */
    T(CN, 'R175s 两处都做范围校验，且运行时**真的在用**它（脏色相不得进入 --hue）',
      /isFinite\(h\) && h >= HUE_MIN/.test(bootSrc) &&
      /function hueValid/.test(appSrc) &&
      /v >= HUE_MIN && v <= HUE_MAX/.test(appSrc) &&
      (appSrc.match(/hueValid\(/g) || []).length >= 4,
      '范围校验缺失或未被使用（hueValid 出现 ' +
        (appSrc.match(/hueValid\(/g) || []).length + ' 次）');

    /* ★ 源文件行尾健康检查（v3.4.0 加）——
       反面教材：用 Python 以**文本模式**写回源文件时，Windows 默认把 \n 翻成 \r\n，
       整个文件的行尾会静默变成 CRLF。它不影响运行，却会让所有依赖 '\n' 精确匹配的
       判据失配（R122h 就是这么红的：`indexOf('safeRoute();\n  }')` 永远找不到）。
       这类破坏"看不见、只在别处报错"，所以单独钉一条。
       ⚠ Node 以 utf8 读文件**不做**行尾归一化，故这里能如实检出。 */
    const eolBad = [];
    ['js', 'css'].forEach(function (dir) {
      const abs = path.join(__dirname, '..', '..', dir);
      let names = [];
      try { names = fs.readdirSync(abs); } catch (e) { return; }
      names.filter(function (n) { return /\.(js|css)$/.test(n); }).forEach(function (n) {
        if (readFile(dir + '/' + n).indexOf('\r\n') !== -1) eolBad.push(dir + '/' + n);
      });
    });
    T(CN, 'R175t 源文件行尾统一为 LF（Python 文本模式写回会静默转成 CRLF，破坏依赖 \\n 的判据）',
      eolBad.length === 0,
      eolBad.length ? 'CRLF：' + eolBad.join(' ') : '全部 LF');

    /* ⚠ P0-3（2026-09-29 审计）：存储键名是**跨文件的口头约定** ——
       theme-boot.js 必须独立（不能引用 app.js），所以 neon_theme / neon_hue
       在两个文件里各硬编码一次。改键名时漏掉一处，后果是：
       首绘前读不到偏好 → 每次刷新先以默认配色画一帧再跳回用户选择
       （"刷新闪回"，而且完全不报错）。范围一致已有断言守着，键名维度补在这里。 */
    const bootThemeKey = (/var KEY = '([^']+)'/.exec(bootSrc) || [, null])[1];
    const bootHueKey = (/var HUE_KEY = '([^']+)'/.exec(bootSrc) || [, null])[1];
    const appThemeKey = (/var THEME_KEY = '([^']+)'/.exec(appSrc) || [, null])[1];
    const appHueKey = (/var HUE_KEY = '([^']+)'/.exec(appSrc) || [, null])[1];
    T(CN, 'R175u 引导脚本与运行时的存储键名一致（防「键名漏改 → 刷新闪回默认配色」）',
      !!bootThemeKey && bootThemeKey === appThemeKey &&
      !!bootHueKey && bootHueKey === appHueKey,
      'boot=' + bootThemeKey + '/' + bootHueKey + ' app=' + appThemeKey + '/' + appHueKey);

    /* v3.4.0 批 A（代码审计清理）：把"已清理的死代码"变成**被守卫的事实** ——
       否则下一次有人（或某个旧分支合并）把它们加回来，无人察觉。
       只钉已逐个核实过"零引用"的这 5 个名字，不做宽泛的"禁止新增类"
       （那会误伤正常的样式演进）。`.loading-bar` 的回流守卫在 23 号 R66d。 */
    const cleanedNames = ['.btn-yellow', '.tag-badge-hot', '--deco-line',
      '.radio-form-msg.is-ok', '.radio-form-msg.is-err'];
    const backflow = cleanedNames.filter(function (n) { return css.indexOf(n) !== -1; });
    T(CN, 'R175v 批 A 清理过的死代码不得回流（零引用样式与未用变量）',
      backflow.length === 0,
      backflow.length ? '回流：' + backflow.join(' ') : '保持干净');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v3.0.0 B1 地基" };

standalone(module, run);
