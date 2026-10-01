'use strict';
/* ============================================================
   tests/cases/17-o17-装饰层.js — O17 装饰层
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L912-1170
   独立运行：node tests/cases/17-o17-装饰层.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments, cssRuleBody, hasCssRule } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ---- O17：赛博朋克装饰层（符号 / 名言 / 花纹光效） ---- */
  {
    /* 先剥注释再扫源码 —— 本项目注释里大量出现"某写法已移除/不要用"之类
       的自我说明，不剥会把它们误判成真实规则（此坑已踩 4 次）。 */
    const css = SRC.css || '';
    const cssBare = stripComments(css);
    const htmlBare = (SRC.html || '').replace(/<!--[\s\S]*?-->/g, '');

    /* --- 1. 装饰选择器存在性（行首锚定，避免被别处同名规则骗过） ---
       为什么锚行首：`.post-card::before` 若只写 `/\.post-card::before/`，
       会被注释里那句"· 卡片 → 四角 L 形边框标记（.post-card::before/::after）"
       救活（注释在 stripComments 后已删，故这里更稳）；但仍需锚行首，
       防止 `xxx .post-card::before` 这类后代选择器造成误配。 */
    /* D3：判据上提到 common.js（hasCssRule / cssRuleBody），此处只保留语义化别名。
       原来这里各写一份 —— 拆分后若继续复制，会出现"改了别处的判据、这里仍按旧判据
       放行"的假绿。故一律走 common.js 的唯一实现。 */
    const hasRule = function (sel) { return hasCssRule(cssBare, sel); };

    /* v3.6.1：原 R78 / R78b（body::before 全息渐变晕斑、.wrap::before 星点符号）
       已随氛围层整体移除 ⇒ 从清单去掉。其余各项都是仍存在的**内容装饰**。 */
    const decoSelectors = [
      ['R78c .wrap::after 右侧竖排名言（名言文字）', '.wrap::after'],
      ['R78d .logo::after logo 扫描光泽（顶栏光效）', '.logo::after'],
      ['R78e .page-head h1::after 标题斜纹图案（标题区）', '.page-head h1::after'],
      ['R78f .post-card::before 卡片左上角标（卡片）', '.post-card::before'],
      ['R78g .post-card::after 卡片右下角标（卡片）', '.post-card::after'],
      ['R78h .post-full::before 文章左缘信号标尺（阅读面）', '.post-full::before'],
      ['R78i .about-card::after 关于卡角标花纹（卡片）', '.about-card::after'],
      ['R78j .site-footer::before 页脚全息分隔条（边框/分隔）', '.site-footer::before'],
      ['R78k .md-body blockquote::before 引用块装饰引号（名言）', '.md-body blockquote::before'],
      ['R78l .empty-state::before 空状态终端框（符号）', '.empty-state::before']
    ];
    decoSelectors.forEach(function (p) {
      T('O17 装饰层', p[0], hasRule(p[1]), hasRule(p[1]) ? 'OK' : '缺失：' + p[1]);
    });

    /* --- 2. 三类装饰元素齐备（用户明确要求：符号 / 名言 / 光效） --- */
    /* ⚠ 不能用注释里的"O17：赛博朋克装饰层"当锚点 —— stripComments 已把注释删了。
       改钉可执行结构：--deco-holo 的赋值（装饰块起点）
       → html[data-theme="light"]（装饰块终点，其后就是亮色变量表）。 */
    const decoStart = cssBare.indexOf('--deco-holo:');
    const decoEnd = cssBare.indexOf('html[data-theme="light"]');
    T('O17 装饰层', 'R79 装饰块在 CSS 中有明确分区（可定位）',
      decoStart !== -1 && decoEnd !== -1 && decoEnd > decoStart,
      'start=' + decoStart + ' end=' + decoEnd);
    const decoBlock = (decoStart !== -1 && decoEnd > decoStart) ? cssBare.slice(decoStart, decoEnd) : '';

    /* 名言文字：至少有一处 content 输出英文格言（竖排名言），
       且页脚名言容器有装饰（::before/::after 加 ◇ 引号符号）。 */
    T('O17 装饰层', 'R79b 含名言文字装饰（content 输出格言）',
      /content:\s*"[A-Z][A-Z0-9 ,'\-—–:;.!?]{20,}"/.test(decoBlock),
      (decoBlock.match(/content:\s*"[A-Z][^"]*"/) || ['(无)'])[0].slice(0, 60));
    T('O17 装饰层', 'R79c 页脚名言两侧加装饰符号（◇ 引号）',
      /\.site-footer\s*>\s*div:last-child::before[\s\S]{0,200}content:\s*"◇"/.test(decoBlock),
      /\.site-footer\s*>\s*div:last-child::before/.test(decoBlock) ? '已加' : '缺失');

    /* 光效：霓虹发光（text-shadow 走 --glow-*）+ 扫描线（已有 .scanlines 保留）
       + 全息渐变（--deco-holo 多色渐变）三类都应在装饰块中体现 */
    T('O17 装饰层', 'R79d 含全息渐变定义（--deco-holo 四色停靠）',
      /--deco-holo:\s*linear-gradient\(/.test(decoBlock) &&
      (decoBlock.match(/--deco-holo:[\s\S]*?;/) || [''])[0].split('color-mix').length >= 4);
    T('O17 装饰层', 'R79e 全息渐变由变量派生（至少 3 处 color-mix，无硬编码色）',
      (decoBlock.match(/color-mix\(/g) || []).length >= 3,
      'color-mix 出现 ' + (decoBlock.match(/color-mix\(/g) || []).length + ' 次');

    /* --- 3. 可读性红线：装饰必须是 pointer-events:none 的纯视觉层 ---
       所有装饰伪元素都不得接收鼠标事件（否则会挡住卡片点击、链接等）。 */
    const decoSels = [
      /* v3.6.0：body::before 与 .wrap::before 已随氛围层移除 ⇒ 从清单去掉；
         其余（.wrap::after 竖排名言 / .logo::after 等）都是仍在的内容装饰。 */
      '.wrap::after', '.logo::after',
      '.page-head h1::after', '.post-card::before', '.post-card::after',
      '.post-full::before', '.about-card::after', '.site-footer::before',
      '.md-body blockquote::before', '.empty-state::before', '.empty-state::after'
    ];
    /* ⚠ 不要用 `(?:[^{}]*,\s*)*` 这类嵌套量词 —— 它会在不匹配时
       引发灾难性回溯，直接挂死整轮测试（实测 7 分钟无输出）。
       改用「先按行定位选择器，再向后扫到最近的 { 取块体」的线性做法。
       D3：该实现已上提到 common.js 的 cssRuleBody（与 O12/O13 共用同一份）。 */
    const ruleBody = function (sel) { return cssRuleBody(cssBare, sel); };
    const missingPe = decoSels.filter(function (sel) {
      const body = ruleBody(sel);
      if (body === null) return true;          /* 找不到规则 = 有问题 */
      return !/pointer-events:\s*none/.test(body);
    });
    T('O17 装饰层', 'R80 全部装饰层 pointer-events:none（不挡任何交互）',
      missingPe.length === 0,
      missingPe.length ? '缺 pointer-events:none：' + missingPe.join(', ') : decoSels.length + ' 个全过');

    /* v3.6.0：原 R80b（守 body::before 的 z-index）已随氛围层一并作废 ——
       该层已不存在，"它不盖正文"这件事无需再守。仍在的内容装饰层
       （.wrap::after 等）由上面的 R80 用 pointer-events 统一覆盖。 */

    /* --- 4. 主题适配：装饰色必须走变量，禁止硬编码霓虹色 ---
       （v2.0.1 教训：硬编码 rgba(0,240,255) 在亮色主题下依然刺眼。） */
    const hardcoded = [];
    const reColor = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
    let cm;
    while ((cm = reColor.exec(decoBlock)) !== null) {
      const v = cm[0];
      /* 白名单：mask 用的纯黑/纯白；其余一律视为硬编码 */
      if (/^#(000|fff|000000|ffffff)$/i.test(v)) continue;
      if (/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(,\s*[\d.]+)?\s*\)$/.test(v)) continue;
      if (/^rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*[\d.]+)?\s*\)$/.test(v)) continue;
      hardcoded.push(v);
    }
    T('O17 装饰层', 'R81 装饰块无硬编码霓虹色（全部走变量/color-mix）',
      hardcoded.length === 0,
      hardcoded.length ? '硬编码：' + hardcoded.slice(0, 6).join(', ') : '0 处');

    /* 反向确认：装饰块里确实用了 color-mix 从变量派生（不是"没色所以没硬编码"） */
    T('O17 装饰层', 'R81b 装饰色确实由 CSS 变量派生（color-mix + var）',
      /color-mix\(in srgb,\s*var\(--/.test(decoBlock),
      (decoBlock.match(/color-mix\(in srgb,\s*var\(--[a-z-]+\)/g) || []).length + ' 处');

    /* --- 5. reduced-motion 覆盖：装饰动画必须可关 --- */
    const rmStart = cssBare.indexOf('prefers-reduced-motion');
    T('O17 装饰层', 'R82 reduced-motion 块存在（装饰动画有处可关）', rmStart !== -1);
    const rmSuffix = ' @media (prefers-reduced-motion: reduce) { ' + cssBare.slice(rmStart).replace(/^[^{]*\{/, '');
    /* 装饰层的位移动画（logo 扫描）与过渡（角标）必须在 reduce 块里被关掉 */
    const r82b = /\.logo:hover::after\s*\{\s*display:\s*none/.test(rmSuffix);
    T('O17 装饰层', 'R82b logo 扫描光泽在减少动效下被关闭', r82b,
      r82b ? '已覆盖' : '未覆盖');
    /* ⚠ info 必须与断言用同一个谓词，否则会出现「绿着却写着未覆盖」的自相矛盾。 */
    const r82c = /\.post-card::before[\s\S]{0,80}transition:\s*none/.test(rmSuffix);
    T('O17 装饰层', 'R82c 卡片角标的过渡在减少动效下被归零', r82c,
      r82c ? '已覆盖' : '未覆盖');

    /* --- 5b. P1 修复：竖排名言不得被硬裁切（72h/72i）---
       v2.1.1 的 .wrap::after 用 max-height: 62vh + overflow: hidden 约束一行
       61 字符的竖排文字：竖排总高 = 字符数 × (font-size + letter-spacing)，
       固定 10.5px + 4px 时约 885px，800~900px 高的常见窗口会被截掉 11%~44%，
       句子断在半句上。修复 = 字号随视口高度自适应 + 去掉硬裁切。
       这两条断言钉住"修复的两个必要条件"，任何一条回退都会报红：
         · 有 clamp(...vh...) 形式的字号（说明自适应生效）
         · 无 max-height 约束（说明硬裁切已去除） */
    const quoteBody = ruleBody('.wrap::after');
    /* 断言要钉"两条声明同时存在"：
       · 有 clamp(...vh...)：自适应生效（防截断的正面条件）
       · clamp 之前有 px fallback：旧浏览器拿到兜底字号，不会回落到继承的 16px
       只查前者会漏掉"clamp 不被支持 → 字号暴涨"这条降级路径。 */
    T('O17 装饰层', 'R72h 竖排名言字号随视口高度自适应（clamp + vh，防截断）',
      !!quoteBody && /font-size:\s*clamp\([^)]*\d+(\.\d+)?vh[^)]*\)/.test(quoteBody),
      quoteBody ? (/font-size:\s*(clamp\([^;]*\))/.exec(quoteBody) || [])[1] || '(无)' : '未找到规则');
    T('O17 装饰层', 'R72h2 clamp 前有 px 兜底（旧浏览器不致回落到 16px 撑爆视口）',
      !!quoteBody && /font-size:\s*[\d.]+px;\s*font-size:\s*clamp\(/.test(quoteBody),
      quoteBody && /font-size:\s*([\d.]+px);\s*font-size:\s*clamp/.test(quoteBody)
        ? '兜底 ' + (/font-size:\s*([\d.]+px);\s*font-size:\s*clamp/.exec(quoteBody) || [])[1]
        : '缺兜底声明');
    T('O17 装饰层', 'R72i 竖排名言已去除硬裁切（无 max-height 截断单行文字）',
      !!quoteBody && !/max-height\s*:/.test(quoteBody),
      quoteBody ? (/max-height\s*:[^;]*/.exec(quoteBody) || ['(无 max-height)'])[0] : '未找到规则');
    /* 第二道防线：极矮窗（<=640px）整体隐藏，避免缩到下限仍放不下。
       这是"边界兜底"，与 R83 的窄屏隐藏是不同维度（宽 × 高）。 */
    T('O17 装饰层', 'R72j 极矮窗（<=640px）隐藏竖排名言（字号下限兜底）',
      /@media\s*\(max-height:\s*640px\)\s*\{[\s\S]{0,120}\.wrap::after\s*\{\s*display:\s*none/.test(cssBare));

    /* --- 5c. P1 修复：装饰专用时长必须进 reduced-motion 归零名单（72k/72l）---
       v2.1.1 新增 --t-sweep: 0.55s 时漏进归零列表。当时无害纯属巧合
       （唯一使用者 .logo:hover::after 被 display:none 关掉了），
       但任何将来复用该变量的元素都会在"减少动效"下真的跑 0.55s → 违背无障碍承诺。
       这里钉的是**机制**而非清单：扫描全 CSS 里所有**取值为时长**的 `--t-*` 定义，
       断言每一个都出现在 reduce 块内。以后加 --t-reveal: 0.4s 之类会当场报红。

       ⚠ 只扫"时长度量"的变量，不能把 --t-bezier 也算进来 ——
       它是 cubic-bezier(0.4,0,0.2,1) 的**缓动曲线**（timing function），
       与"时长"是正交的两件事：减少动效下要归零的是"走多久"，
       而不是"用什么曲线走"（何况时长归零后曲线本就失去意义）。
       第一版断言用 `/--t-[a-z-]+\s*:/` 无差别匹配，把 --t-bezier 误判成
       "漏归零"而报红 —— 这是**断言假阳性**，不是代码缺陷。
       改为：只收「冒号后紧跟 <数字>s / <数字>ms」的变量。 */
    const allTVars = Array.from(new Set((cssBare.match(/--t-[a-z-]+\s*:\s*[\d.]+m?s\b/g) || [])
      .map(function (s) { return s.replace(/\s*:.*$/, ''); })));
    const rmBlockOnly = rmStart !== -1 ? cssBare.slice(rmStart) : '';
    const missingTVars = allTVars.filter(function (v) {
      /* reduce 块内的 :root 里必须有一条把该变量归零的声明 */
      return !new RegExp(v.replace(/[-]/g, '\\-') + '\\s*:\\s*0*\\.?0*0*1?ms').test(rmBlockOnly);
    });
    T('O17 装饰层', 'R72k 所有「时长型」--t-* 变量都在 reduced-motion 块内被归零',
      allTVars.length > 0 && missingTVars.length === 0,
      (missingTVars.length ? '漏归零：' + missingTVars.join(', ') : allTVars.length + ' 个全部归零')
      + ' [' + allTVars.join(' ') + ']');
    /* 反向确认：断言确实把 --t-bezier 这类非时长变量排除了
       （否则"只扫时长"这个修复本身没被验证，等于换了个假绿）。 */
    T('O17 装饰层', 'R72k2 缓动曲线变量（--t-bezier）不被误判为时长型',
      allTVars.indexOf('--t-bezier') === -1 && /--t-bezier\s*:\s*cubic-bezier/.test(cssBare),
      '扫得 ' + allTVars.length + ' 个时长变量，--t-bezier 已排除');
    T('O17 装饰层', 'R72l --t-sweep 已在减少动效下归零（消除时长逃逸）',
      /--t-sweep\s*:\s*0\.001ms/.test(rmBlockOnly));

    /* --- 5e. 顺序健壮性：reduce 块的归零不得依赖"本块排在最后"（72n）---
       查证过程发现的一类系统性隐患：reduce 块用 @media 包裹，但 @media
       **不增加特异性** —— 块内 `:root { --t-fast: ... }` 与文件开头定义
       `--t-fast: 0.15s` 的 `:root` 特异性完全相同（都是 0,1,0），
       最终取值只由"谁在文件里更靠后"决定。
       后果：有人把 reduce 块上移（或把新响应式块追加到文件末尾）→
       减少动效静默失效，页面看起来毫无变化，极难察觉。
       修复 = 给块内所有"与更早的基础声明竞争同一属性"的规则加 !important，
       把隐式顺序依赖换成显式优先级。
       本条断言块内两个关键归零点都带了 !important。 */
    const r72n = /--t-fast:\s*0\.001ms\s*!important/.test(rmBlockOnly) &&
                 /--t-sweep:\s*0\.001ms\s*!important/.test(rmBlockOnly);
    T('O17 装饰层', 'R72n 归零变量带 !important（不依赖"本块排最后"的隐式顺序）', r72n,
      r72n ? '已硬化' : '仍依赖文件顺序');

    /* --- 5d. P2 修复：全屏 blur 在减少动效下降级（72m/72m2）---
       body::before 是 position:fixed + inset:-20%（140% 视口面积）+ blur(90px)，
       滚动时持续参与合成、每帧重算模糊 —— 开销高于 topbar 的 backdrop-filter
       （后者已在本块关闭，前者当时漏了）。减少动效的诉求含"前庭不适 + 低端机降级"，
       故这里一并压掉硬模糊。

       ⚠ 必须断言 !important：body::before 同时被基础规则(blur 90px)与
       @media(max-width:768px)(blur 60px) 改写，三者特异性相同(0,1,0)，
       取值只由文件顺序决定 —— 不加 !important 就等于把正确性押在
       "reduce 块永远排在文件最后"这个隐式约定上；顺手挪动代码块就会静默失效。
       72m2 专门守住这一点，防止有人"清理掉多余的 !important"。 */
        /* v3.6.1：'R72m —— 其守卫对象（氛围层）已整体移除，断言作废。 */
        /* v3.6.1：'R72m2 —— 其守卫对象（氛围层）已整体移除，断言作废。 */

    /* --- 6. 响应式 / 触屏适配：窄屏与无 hover 设备上装饰收敛 --- */
    const r83 = /@media\s*\(max-width:\s*1400px\)\s*\{[\s\S]{0,120}\.wrap::after\s*\{\s*display:\s*none/.test(cssBare);
    T('O17 装饰层', 'R83 窄屏（<=1400px）隐藏右侧竖排名言（保可读性）', r83,
      r83 ? '已设' : '未设');
    const r83b = /@media\s*\(max-width:\s*768px\)\s*\{[^@]*?\.post-full::before\s*\{\s*display:\s*none/.test(cssBare);
    T('O17 装饰层', 'R83b 小屏（<=768px）隐藏文章左缘标尺（不挤正文）', r83b,
      r83b ? '已设' : '未设');
    T('O17 装饰层', 'R83c 无 hover 设备（触屏）关闭卡片角标 hover 增强',
      /@media\s*\(hover:\s*none\)/.test(cssBare) &&
      /@media\s*\(hover:\s*none\)\s*\{[\s\S]{0,200}\.post-card:hover::before/.test(cssBare));

    /* --- 7. CSP 合规：装饰纯 CSS，不得引入内联脚本/内联事件 ---
       （装饰若走 JS innerHTML 注入，就需要内联脚本，会被 CSP 拦死。） */
    T('O17 装饰层', 'R84 装饰层未引入内联 <script>（纯 CSS 实现）',
      !/<script(?![^>]*\bsrc=)[^>]*>/.test(htmlBare));

    /* --- 8. 真实渲染：启动页面确认装饰未破坏既有结构 ---
       ⚠ 等待条件必须是"卡片真的出现"，不能用 body.innerHTML.length > 500 ——
       那个阈值连 loading 占位块都能满足，会在首屏数据回来前就断言，
       导致 R85 系列看到 0 张卡片、假红。 */
    const c = bootDom({ url: 'https://x.test/#/' });
    let rendered = true;
    try {
      await waitFor(function () { return c.doc.querySelectorAll('.post-card').length > 0; }, 5000);
    } catch (e) { rendered = false; }
    T('O17 装饰层', 'R85 装饰样式加入后页面正常渲染（页头存在）',
      rendered && !!c.doc.querySelector('.page-head h1'),
      c.doc.querySelector('.page-head h1') ? c.doc.querySelector('.page-head h1').textContent : '(无)');
    T('O17 装饰层', 'R85b 装饰样式加入后卡片仍正常渲染',
      c.doc.querySelectorAll('.post-card').length > 0,
      c.doc.querySelectorAll('.post-card').length + ' 张');
    T('O17 装饰层', 'R85c 装饰样式加入后页脚名言仍在',
      !!c.doc.querySelector('.site-footer > div:last-child') &&
      /THE STREET FINDS ITS OWN USES/.test(c.doc.querySelector('.site-footer > div:last-child').textContent || ''));
    T('O17 装饰层', 'R85d 装饰样式加入后无未捕获异常',
      (c.unhandled || []).length === 0,
      (c.unhandled || []).length + ' 个');
    c.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O17 装饰层" };

standalone(module, run);
