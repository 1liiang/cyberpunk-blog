'use strict';
/* ============================================================
   tests/cases/20-o9-色标.js — O9 色标
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L1304-1668
   独立运行：node tests/cases/20-o9-色标.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  {
    const cssTxt = SRC.css || '';
    const viewsTxt = SRC.views || '';

    /* v4.0：取 :root 规则体（按 ":root {" 定位 + 花括号配平）。
       此前两处用的是「从文件头到第一个 \n}」的启发式 —— 文件顶部一旦新增
       规则（v4.0 加了 @font-face），第一个 \n} 就落在新规则上，取到的是
       "假 :root"（没有任何 tokens），色相读数全为 -1、灰字档数缺一。
       教训与项目既有纪律一致：判据别钉"文件里第一个出现的 }"这类位置假设。 */
    function rootBlock() {
      const at = cssTxt.indexOf(':root {');
      if (at === -1) return '';
      let depth = 0;
      for (let i = cssTxt.indexOf('{', at); i < cssTxt.length; i++) {
        if (cssTxt[i] === '{') depth++;
        else if (cssTxt[i] === '}') { depth--; if (depth === 0) return cssTxt.slice(at, i + 1); }
      }
      return '';
    }

    /* ---- O9-A：色号推导函数（在真实沙箱里执行，不只对源码做断行字符串匹配） ---- */
    const box = { NEONViews: null };
    try {
      new Function('window', 'document', 'console', viewsTxt)(
        box, { getElementById: function () { return null; } },
        { log: function () {}, warn: function () {}, error: function () {} });
    } catch (e) { /* 求值失败时 box.NEONViews 保持 null，下方断言会如实报红 */ }
    const V2 = box.NEONViews;

    /* 样本取自真实的线上标签（指南/代码/随笔/小说/检索）加上夹具里的英文标签。
       色号分布经实测为 {0:..,1:..,2:..,3:..}，覆盖 4 个频段。 */
    const TONE_SAMPLES = ['指南', '代码', '随笔', '小说', '检索',
      'test', 'legacy', 'draft', 'code', 'guide', 'essay', 'search'];

    T('O9 色标', 'R57 标签配色模块已导出', !!(V2 && typeof V2.tagTone === 'function' &&
      typeof V2.tagGlyph === 'function' && typeof V2.tagBadges === 'function'));

    if (V2 && typeof V2.tagTone === 'function') {
      /* 色号范围：必须落在 0..4。越界（如 t5）会让 data-tone 指向不存在的 CSS 规则，
         徽章静默褪成无色 —— 不报错、只是"看不出区别"，是最难被发现的一类坏。

         ⚠ 不能只抽查一批样本就完事：曾实测「色号 +1」这种越界写法，
           12 个样本恰好没有一个落到 4，抽样断言照样全绿（漏检！）。
           所以改为「程序化穷举 + 数学性质」双管齐下：
             ① 穷举 0..TAG_TONES-1 必须全部可达（保证不会少给）
             ② 穷举 0..TAG_TONES+20 必须一个都不出现（保证不会多给）
           输入空间按 TONE_SAMPLES 组合，只要实现里出现 %N 之外的算术偏移，
           总有一个输入会暴露。 */
      const rangeProbe = [];
      TONE_SAMPLES.forEach(function (a) {
        TONE_SAMPLES.forEach(function (b) {
          rangeProbe.push(a, a + b, b + a, a + '#' + b, String(a).repeat(3));
        });
      });
      const probeTones = rangeProbe.map(V2.tagTone);
      const outOfRange = probeTones.filter(function (t) {
        return !Number.isInteger(t) || t < 0 || t > 4;
      });
      T('O9 色标', 'R57b 色号恒落在 0..4（穷举 ' + rangeProbe.length + ' 个输入验证）',
        outOfRange.length === 0,
        outOfRange.length ? '越界 ' + outOfRange.slice(0, 5).join(',') : '全部合法');

      /* 5 个色号都必须真的可达 —— 若实现写成 %3，t3/t4 永远拿不到，
         等于 2 个频段形同虚设，而上面的"不越界"检查完全看不出来。 */
      const reachable = new Set(probeTones);
      T('O9 色标', 'R57b2 5 个色号全部可达（无死频段）',
        reachable.size === 5,
        '可达 ' + Array.from(reachable).sort().join(','));

      /* 稳定性的两种破坏方式都要挡住：
         ① 每次调用结果不同（用了随机数 / Date.now）
         ② 依赖调用顺序（用了全局计数器或"上次结果"） */
      let stable = true;
      const firstPass = TONE_SAMPLES.map(V2.tagTone);
      for (let round = 0; round < 50; round++) {
        TONE_SAMPLES.forEach(function (t, i) { if (V2.tagTone(t) !== firstPass[i]) stable = false; });
      }
      T('O9 色标', 'R57c 同一标签恒得同一色号（50 轮复算不漂移）', stable);

      /* 顺序无关：换个顺序问，答案必须一样 ——
         这正是「不用 出现顺序%5」的理由，也是最容易被写错的破口（见 R57n 的反向验证） */
      const orderFree = TONE_SAMPLES.slice().reverse().every(function (t) {
        return V2.tagTone(t) === firstPass[TONE_SAMPLES.indexOf(t)];
      });
      T('O9 色标', 'R57d 色号与调用顺序无关（反序询问结果不变）', orderFree);

      /* 色号必须有区分力：全挤在一个色号上等于没区分 */
      const spread = new Set(firstPass);
      T('O9 色标', 'R57e 样本标签覆盖到多个频段（不是全同色）',
        spread.size >= 3, '命中 ' + spread.size + ' / 5 个频段');

      /* 图标与色号必须同源：否则色盲用户拿到的图标和颜色说的不是同一件事。
         判据是"色号相同 ⟺ 图标相同"这个双向蕴含，不是简单比对长度。 */
      const glyphs = TONE_SAMPLES.map(V2.tagGlyph);
      const glyphByTone = {};
      let glyphConsistent = true;
      TONE_SAMPLES.forEach(function (t, i) {
        const k = firstPass[i];
        if (glyphByTone[k] === undefined) glyphByTone[k] = glyphs[i];
        else if (glyphByTone[k] !== glyphs[i]) glyphConsistent = false;
      });
      T('O9 色标', 'R57f 图标与色号同源（同色号必同图标）', glyphConsistent);

      /* 图标不能是空串 —— 空图标等于把「非色彩通道」这条线悄悄抽掉 */
      T('O9 色标', 'R57g 每个频段都有非空图标（色彩之外的识别通道）',
        glyphs.every(function (g) { return typeof g === 'string' && g.trim().length > 0; }),
        glyphs.join(' '));

      /* ---- O9-B：徽章渲染 ---- */
      const multi = V2.tagBadges(['code', 'guide']);
      T('O9 色标', 'R57h 徽章输出 data-tone 供 CSS 取色',
        (multi.match(/data-tone="t[0-4]"/g) || []).length === 2,
        multi.slice(0, 80));
      T('O9 色标', 'R57i 徽章是指向标签筛选页的链接',
        /<a class="tag-badge"[^>]*href="#\/tag\/code"/.test(multi));

      /* 空标签必须显式给身份（线上 id=4 的文章 tags 就是 []） */
      const none = V2.tagBadges([]);
      T('O9 色标', 'R57j 空标签渲染为「未分类」（不留白）',
        /tag-badge-none/.test(none) && /未分类/.test(none), none);
      T('O9 色标', 'R57k 未分类不占用任一频段编号（它没有频段）',
        !/data-tone/.test(none));
      T('O9 色标', 'R57l null / undefined / 纯空白标签同样归入未分类',
        /未分类/.test(V2.tagBadges(null)) && /未分类/.test(V2.tagBadges(undefined)) &&
        /未分类/.test(V2.tagBadges(['', '  '])));
      T('O9 色标', 'R57m 脏数据（字符串而非数组）不抛错（否则整页白掉）',
        (function () {
          try { return /data-tone/.test(V2.tagBadges('code')); } catch (e) { return false; }
        })());

      /* 同容器消歧：一条卡片挂两个撞号标签时，不得显示成同一个颜色
         —— 否则读者会以为它们是同一类。 */
      const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'];
      const byTone = {};
      pool.forEach(function (t) { (byTone[V2.tagTone(t)] = byTone[V2.tagTone(t)] || []).push(t); });
      const clash = Object.keys(byTone).filter(function (k) { return byTone[k].length >= 3; })[0];
      const clashTags = clash ? byTone[clash].slice(0, 3) : [];
      const clashHtml = V2.tagBadges(clashTags);
      const clashTones = (clashHtml.match(/data-tone="t([0-4])"/g) || []);
      T('O9 色标', 'R57n 同一条目内撞号标签自动顺延（颜色互不相同）',
        clashTags.length === 3 && new Set(clashTones).size === 3,
        clashTags.join('/') + ' → ' + clashTones.join(','));
      T('O9 色标', 'R57o 消歧只在容器内生效，不污染标签自身的恒定色',
        V2.tagBadges([clashTags[0]]).indexOf('t' + V2.tagTone(clashTags[0]) + '"') !== -1);

      /* XSS：标签名来自用户输入，必须转义后才进 HTML */
      const evil = V2.tagBadges(['<img src=x onerror=alert(1)>']);
      T('O9 色标', 'R57p 标签名转义后才进 HTML（无原始尖括号）',
        !/<img/.test(evil) && /&lt;img/.test(evil));

      /* ---- O9-C：标签总览按热度排名分配色号 ---- */
      const stats = { code: 5, guide: 3, essay: 3, search: 2, test: 1, legacy: 1, draft: 1 };
      const rm = V2.rankedTones(stats);
      T('O9 色标', 'R57q 热度最高者拿 t0',
        rm.code === 0, 'code → t' + rm.code);
      T('O9 色标', 'R57r 前 5 名色号互不重复',
        new Set([rm.code, rm.guide, rm.essay, rm.search, rm.draft]).size === 5,
        JSON.stringify(rm));
      T('O9 色标', 'R57s 排名分配是确定性的（同数据两次结果一致）',
        JSON.stringify(V2.rankedTones(stats)) === JSON.stringify(rm));
      T('O9 色标', 'R57t 超出 5 名者退回稳定哈希（不声称热度，但仍恒定）',
        rm.test === V2.tagTone('test') && rm.legacy === V2.tagTone('legacy'));
    } else {
      T('O9 色标', 'R57b-t 色号推导函数不可用（已由 R57 报红）', false, '跳过');
    }

    /* ---- O9-D：CSS 侧（颜色只定义一次，且全走变量） ---- */
    const badgeM = /\.tag-badge\s*\{([\s\S]*?)\}/.exec(cssTxt);
    T('O9 色标', 'R58 .tag-badge 规则存在', !!badgeM);
    T('O9 色标', 'R58b 5 个频段色号各有对应规则（t0..t4 齐全）',
      [0, 1, 2, 3, 4].every(function (i) {
        return new RegExp('\\.tag-badge\\[data-tone="t' + i + '"\\]').test(cssTxt);
      }));
    T('O9 色标', 'R58c 频段色号全部映射到站点既有变量（不引入新色相）',
      [0, 1, 2, 3, 4].every(function (i) {
        const m = new RegExp('\\.tag-badge\\[data-tone="t' + i + '"\\]\\s*\\{\\s*--tone:\\s*var\\(--(cyan|magenta|yellow|violet|green)\\)').exec(cssTxt);
        return !!m;
      }));
    /* 关键补强：光断言"每个 tN 都解析到某个合法变量"不够 ——
       把 t4 也写成 var(--cyan) 照样全绿，但 t0 与 t4 就变成同一个颜色，
       5 个频段实际只剩 4 个可区分（实测这个写法确实骗过了初版断言）。
       所以必须断言「5 个 tN 映射到 5 个互不相同的变量」。 */
    const badgeVarMap = [0, 1, 2, 3, 4].map(function (i) {
      const m = new RegExp('\\.tag-badge\\[data-tone="t' + i + '"\\]\\s*\\{\\s*--tone:\\s*var\\((--[\\w-]+)\\)').exec(cssTxt);
      return m ? m[1] : null;
    });
    T('O9 色标', 'R58c2 5 个频段映射到 5 个互不相同的变量（无撞色）',
      badgeVarMap.every(function (v) { return v !== null; }) &&
      new Set(badgeVarMap).size === 5,
      badgeVarMap.join(' '));
    /* 关键：不得硬编码霓虹色 —— 硬编码的 rgba/hex 不随主题变，亮色下刺眼 */
    const badgeHard = badgeM ? (badgeM[1].match(/#[0-9a-f]{3,8}|rgba?\(\s*\d/gi) || []) : [];
    T('O9 色标', 'R58d 色标本体无硬编码颜色（全走 --tone 变量）',
      badgeHard.length === 0, badgeHard.join(',') || '无');
    /* 色相之外的第二通道：图标 + 底边下划线（色盲/灰度下仍可区分） */
    T('O9 色标', 'R58e 色标含图标与底部下划线（非纯色彩编码）',
      !!badgeM && /\.tag-badge\s+\.tag-glyph/.test(cssTxt) &&
      /border-bottom\s*:\s*2px\s+solid\s+var\(--tone\)/.test(badgeM[1]));
    /* 未分类中性灰：必须也走变量，不能写死 #888 */
    const noneM = /\.tag-badge-none\s*\{([\s\S]*?)\}/.exec(cssTxt);
    T('O9 色标', 'R58f 未分类用中性灰变量（不占用 5 个频段）',
      !!noneM && /--tone:\s*var\(--text-dim\)/.test(noneM[1]));
    /* 归档条目级色标 */
    const itemM = /\.archive-item\s*\{([\s\S]*?)\}/.exec(cssTxt);
    T('O9 色标', 'R58g 归档条目有左侧色条（.archive-item::before + --tone）',
      /\.archive-item::before\s*\{[\s\S]*?background\s*:\s*var\(--tone\)/.test(cssTxt));
    T('O9 色标', 'R58h 归档条目 hover 底纹随频段色（不是写死的青）',
      !!itemM === false || /\.archive-item:hover\s*\{\s*background:\s*color-mix\(in srgb,\s*var\(--tone\)/.test(cssTxt),
      (/\.archive-item:hover\s*\{([^}]*)\}/.exec(cssTxt) || [, ''])[1].trim());
    /* 卡片标签也带频段色 —— 首页与归档页必须是同一套分类视觉 */
    T('O9 色标', 'R58i 卡片 .tag-chip 同样支持 data-tone（跨页一致）',
      [0, 1, 2, 3, 4].every(function (i) {
        return new RegExp('\\.tag-chip\\[data-tone="t' + i + '"\\]').test(cssTxt);
      }));
    T('O9 色标', 'R58j 无 data-tone 时回落幽紫（关于页装饰标签观感不变）',
      /\.tag-chip\s*\{[\s\S]*?--tone:\s*var\(--violet\)/.test(cssTxt));
    /* 标签总览 */
    T('O9 色标', 'R58k 标签总览 .tag-item 支持 data-tone（5 色频段）',
      [0, 1, 2, 3, 4].every(function (i) {
        return new RegExp('\\.tag-cloud \\.tag-item\\[data-tone="t' + i + '"\\]').test(cssTxt);
      }));
    T('O9 色标', 'R58l 标签总览已去掉写死的紫色 rgba(181,55,242)',
      !/\.tag-cloud \.tag-item\s*\{[\s\S]{0,400}?rgba\(181,\s*55,\s*242/.test(cssTxt));

    /* ---- O9-E：亮色主题适配（用户明确要求浅色背景下同样清晰可辨） ----
       这里不能只断言"变量块里有这 5 个名字" —— 那太弱：
       色值再暗一个数量级也照样通过。真正要守的是可读性，所以要真算对比度。 */
    function hexToRgb(h) {
      const m = /^#([0-9a-f]{6})$/i.exec(String(h).trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function relLum(rgb) {
      const f = rgb.map(function (v) {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    }
    function contrast(a, b) {
      const la = relLum(a), lb = relLum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    /* v3.0 B1：主色与辅助紫改由 hsl(var(--hue) …) 派生之后，
       变量块里**不再有 #rrggbb 字面值** —— 上面那套"抓 hex"的读法会读到 null，
       表现为 --cyan / --violet 双双"缺失"。补一条**按块内参数求解派生色**的路径：
         --cyan   → hsl(--hue, --hue-s, --hue-l)
         --violet → hsl(--hue + --vio-off, --vio-s, --vio-l)
       语义色（品红 / 黄 / 绿）仍是字面值，照旧走原路。
       ⚠ 色相取 :root 的默认值：那是"用户没调过色相"的基准，
         也正是可访问性断言该守的基准（用户自选色相另有护栏）。 */
    function hslToRgb(h, s, l) {
      h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;
      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; }
      else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; }
      else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; }
      else { r = c; b = x; }
      return [r, g, b].map(function (v) { return Math.round((v + m) * 255); });
    }
    function derivedRgb(blk, v, hueOverride) {
      const pct = function (name) {
        const m = new RegExp(name + ':\\s*([\\d.]+)%').exec(blk);
        return m ? parseFloat(m[1]) : null;
      };
      /* v3.4.0：色相放开为自由滑杆后，需要能"按指定色相求色"来做全色相扫描，
         故加一个可选覆盖值；不传时行为与从前完全一致（取 :root 的默认色相）。 */
      const rootHue = (hueOverride != null)
        ? hueOverride
        : parseFloat((/--hue:\s*(\d+)/.exec(cssTxt) || [, '285'])[1]);
      if (v === '--cyan') {
        const s = pct('--hue-s'), l = pct('--hue-l');
        return (s === null || l === null) ? null : hslToRgb(rootHue, s, l);
      }
      if (v === '--violet') {
        const off = parseFloat((/--vio-off:\s*(\d+)/.exec(cssTxt) || [, '96'])[1]);
        const s = pct('--vio-s'), l = pct('--vio-l');
        return (s === null || l === null) ? null : hslToRgb(rootHue + off, s, l);
      }
      return null;
    }
    /* 统一取色：先认字面值，再退到派生式 —— 两类变量共用一条读法 */
    function toneRgb(blk, v) {
      const hex = (new RegExp(v + '\\s*:\\s*(#[0-9a-f]{6})', 'i').exec(blk) || [, null])[1];
      return hex ? hexToRgb(hex) : derivedRgb(blk, v);
    }

    /* O11 起，亮色变量表【只剩一份】（html[data-theme="light"]）。
       原先还有一份挂在 @media (prefers-color-scheme: light) 里，随"默认暗色"
       的改造被移除 —— 见 style.css 里的说明：那个 media 块本身就是 bug。
       这里保留数组结构（rather than 直接删一项），是为了让"少了一份"这件事
       被显式记录：若将来有人误加回媒体查询版本，下面 every() 的守门依然成立。 */
    const lightBlocks = [
      (/html\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(cssTxt) || [, ''])[1]
    ];
    const TONE_VARS = ['--cyan', '--magenta', '--yellow', '--violet', '--green'];

    /* 对每份亮色变量表，逐个频段算「色标文字色 vs 页面底色」的对比度。
       文字色不是 --tone 本身，而是 CSS 里的 --tone-ink：
         color-mix(in srgb, var(--tone) <比例>%, var(--text-bright))
       ⚠ 比例必须【从 CSS 里读】而不是在测试里写死常量 ——
         写死的话，有人把 CSS 的 82% 改成 100%（=直接用 --tone，青色掉到 4.46）
         这条断言照样全绿，等于白测。这是"钉常量"教训在相反方向的又一次复现：
         该钉的常量是 TAG_TONES 那种真·单一数据源，
         而"公式里掺多少"属于实现细节，必须现读现算。
       页面底色取 --bg-0（色标的 9% 同色底很淡，可近似为页面底色）。
       阈值取 WCAG AA 正文级 4.5:1。 */
    const inkMixM = /--tone-ink:\s*color-mix\(in srgb,\s*var\(--tone\)\s*([\d.]+)%,\s*var\(--text-bright\)\)/.exec(cssTxt);
    const inkPct = inkMixM ? parseFloat(inkMixM[1]) / 100 : NaN;
    function mixInk(toneRgb, inkRgb) {
      return toneRgb.map(function (v, i) {
        return Math.round(v * inkPct + inkRgb[i] * (1 - inkPct));
      });
    }

    const contrastReport = [];
    let contrastOk = !isNaN(inkPct);
    let worst = 99;
    if (isNaN(inkPct)) contrastReport.push('--tone-ink 公式缺失');
    lightBlocks.forEach(function (blk) {
      const bgHex = (/--bg-0\s*:\s*(#[0-9a-f]{6})/i.exec(blk) || [, null])[1];
      const inkHex = (/--text-bright\s*:\s*(#[0-9a-f]{6})/i.exec(blk) || [, null])[1];
      const bg = bgHex ? hexToRgb(bgHex) : null;
      const ink = inkHex ? hexToRgb(inkHex) : null;
      if (!bg || !ink) { contrastOk = false; return; }
      TONE_VARS.forEach(function (v) {
        const rgb = toneRgb(blk, v);
        if (!rgb) { contrastOk = false; contrastReport.push(v + '=缺失'); return; }
        const c = contrast(bg, mixInk(rgb, ink));
        if (c < worst) worst = c;
        if (c < 4.5) { contrastOk = false; contrastReport.push(v + '=' + c.toFixed(2)); }
        else contrastReport.push(v + '=' + c.toFixed(1));
      });
    });
    const lightBg = (/--bg-0\s*:\s*(#[0-9a-f]{6})/i.exec(lightBlocks[0]) || [, '?'])[1];
    T('O9 色标', 'R59 亮色主题下 5 个频段墨色对底色对比度均 ≥ 4.5:1（WCAG AA）',
      contrastOk && lightBlocks.every(function (b) { return b.length > 0; }),
      '底色 ' + lightBg + ' · 掺入 ' + (isNaN(inkPct) ? '?' : Math.round(inkPct * 100) + '%') +
      ' · 最差 ' + (worst === 99 ? '?' : worst.toFixed(2)) + ' · ' + contrastReport.join(' '));

    /* 反向守门：若把 --tone-ink 改回直接用 --tone，青色会掉到 4.46 而失守。
       这条断言保证「公式本身」在 CSS 里存在，而不只是测试里算得漂亮。 */
    T('O9 色标', 'R59d 三处色标都用同一套墨色公式（--tone-ink 掺主体文字色）',
      (cssTxt.match(/--tone-ink:\s*color-mix\(in srgb,\s*var\(--tone\)\s*\d+%,\s*var\(--text-bright\)\)/g) || []).length >= 3,
      '出现 ' + ((cssTxt.match(/--tone-ink:/g) || []).length) + ' 处');

    /* color-mix 是派生半透明的唯一手段 —— 硬编码 rgba 不随主题变。
       注意排除 fallback 与注释干扰，只认规则体里真的用到的。 */
    const mixUses = (cssTxt.match(/color-mix\(in srgb,\s*var\(--tone\)/g) || []).length;
    T('O9 色标', 'R59b 色标的底色/边框由 --tone 派生（color-mix，随主题变）',
      mixUses >= 4, 'color-mix 使用 ' + mixUses + ' 处');

    /* 色相的判定：5 个频段必须是 5 个可分辨的色相，不能有两个是同一个色
       （比如把 --green 也写成青，肉眼就分不出来了）。
       v3.0 B1：取色改走 toneRgb（字面值 → 派生式），故 --cyan / --violet
       即便已经变成 hsl 派生，色相判据照旧成立。 */
    const rootBlkForHue = rootBlock();
    const darkHues = TONE_VARS.map(function (v) {
      const rgb = toneRgb(rootBlkForHue, v);
      if (!rgb) return -1;
      const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d === 0) return 0;
      let h;
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return Math.round(h * 60 + 360) % 360;
    });
    T('O9 色标', 'R59c 5 个频段色相彼此不同（不是同色重复）',
      new Set(darkHues).size === 5 && darkHues.every(function (h) { return h >= 0; }),
      darkHues.join('°'));

    /* v3.4.0 护栏：色相放开为**自由滑杆**后，"任意色相都可用"必须被证明 ——
       只验九个预设档不够了（用户现在能拖到任何一度）。
       这里对 0~359 每 15° 采样，逐点算亮色档与暖色档的频段墨色对比度。
       它成立的前提是「明度锁死」（light 24%）——
       所以这条断言同时守着"别把 --hue-l 放开"这条设计纪律。 */
    /* ⚠ v5.7.3：暖色档 warm 已删除 —— 这里原为 light + warm 两块，现只剩 light 一块。
       守的东西没变：**非暗色档**（浅底）下任意色相的频段墨色仍须过 AA。 */
    const scanBlocks = [
      (/html\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(cssTxt) || [, ''])[1]
    ].filter(function (b) { return b.length > 0; });
    const scanFails = [];
    let scanPoints = 0;
    scanBlocks.forEach(function (blk) {
      const bg = hexToRgb((/--bg-0\s*:\s*(#[0-9a-f]{6})/i.exec(blk) || [, ''])[1] || '');
      const ink = hexToRgb((/--text-bright\s*:\s*(#[0-9a-f]{6})/i.exec(blk) || [, ''])[1] || '');
      if (!bg || !ink) return;
      for (let hh = 0; hh < 360; hh += 15) {
        TONE_VARS.forEach(function (v) {
          const rgb = derivedRgb(blk, v, hh);
          if (!rgb) return;
          scanPoints++;
          const c = contrast(bg, mixInk(rgb, ink));
          if (c < 4.5) scanFails.push(hh + '°' + v + '=' + c.toFixed(2));
        });
      }
    });
    T('O9 色标', 'R59e 任意色相下（每 15° 采样）亮档的频段墨色对比度仍 ≥ 4.5:1',
      scanPoints > 0 && scanFails.length === 0,
      scanPoints + ' 个采样点 · ' +
        (scanFails.length ? '失守：' + scanFails.slice(0, 4).join(' ') : '全部达标'));

    /* v3.5.1（外部评审 P5 类）：补上对比度测试的**盲区** ——
       R59 / R59e 一直在测「频段墨色」（那是我自己设计的色标体系），
       却从未测过全站最常用的灰字 `--text-dim`（74 处引用）。
       评审实测：深色档 4.19:1、浅色档 4.08:1，都低于 AA 的 4.5；暖色档 4.52 也只是刚过线。
       现在三档统一提到 ≥4.6（留余量），这条断言负责守住它不再掉下去。
       ⚠ 另一处易被忽略的叠加：`.foot-col-label` 曾额外叠 `opacity: 0.75`，
         会把提上去的对比度打回约 3.4 —— 已一并移除。 */
    const dimBlocks = [
      rootBlock(),
      (/html\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(cssTxt) || [, ''])[1]
    ].filter(function (b) { return b && /--bg-0/.test(b) && /--text-dim/.test(b); });
    const dimFails = [];
    dimBlocks.forEach(function (blk) {
      const bg = hexToRgb((/--bg-0\s*:\s*(#[0-9a-f]{6})/i.exec(blk) || [, ''])[1] || '');
      const dim = hexToRgb((/--text-dim\s*:\s*(#[0-9a-f]{6})/i.exec(blk) || [, ''])[1] || '');
      if (!bg || !dim) return;
      const c = contrast(dim, bg);
      if (c < 4.5) dimFails.push(c.toFixed(2));
    });
    T('O9 色标', 'R59f 灰字 --text-dim 各档对比度 ≥ 4.5:1（AA；此前只测色标、漏了最常用的灰字）',
      dimBlocks.length >= 2 && dimFails.length === 0,
      dimBlocks.length + ' 档 · ' + (dimFails.length ? '不达标：' + dimFails.join(' ') : '全部达标'));

    /* v3.5.1（外部评审）：中文排版的"两条正路"必须走其中一条 ——
       ① text-indent 2em + 段间距近 0；② 零缩进 + 段间距 ≥ 1em。
       这里走 ②（与科技感更搭、对中英混排更友好），所以段间距必须真的 ≥ 1em。
       此前是 0.7em = 11.55px，而行高 31.35px ⇒ 换段只比换行多 1/3 行高，段落分不开。 */
    /* ⚠ 判据只看 `.md-body p` 规则体本身有没有 text-indent ——
       不能扫全站：我自己在 CSS 注释里解释"两条正路"时就写了 text-indent 这个词。 */
    const pRule = (/\.md-body p\s*\{([\s\S]*?)\}/.exec(cssTxt) || [, ''])[1];
    const pMargin = parseFloat((/margin\s*:\s*([\d.]+)em/.exec(pRule) || [, '0'])[1]);
    T('O9 色标', 'R59g 正文段落间距 ≥ 1em（走"零缩进 + 大间距"这条路）',
      pMargin >= 1 && !/text-indent/.test(pRule),
      'margin=' + pMargin + 'em' + (/text-indent/.test(pRule) ? '，且段落有 text-indent（两条路都走了）' : ''));

    /* v3.5.1：灰字**不得再叠 opacity** —— `.foot-col-label` 就是这么被坑的：
       它 color 用 --text-dim、又额外 opacity: 0.75，把 4.65:1 打回约 3.4:1。
       提对比度只做了一半（改色值）而没查叠加，等于白改。
       ⚠ 豁免禁用态（.is-dead / :disabled）—— 那里的低对比度是有意为之，WCAG 也豁免。 */
    /* ⚠ 正确做法是**先剥注释再扫**（不是"跳过含注释的匹配"）：
       注释里会写到 "opacity: 0.75" 这个词本身 ⇒ 不剥会假红；
       但"含注释就跳过"又太粗暴 —— 规则体里本来就可能带说明注释，
       那样会把**真的叠加**也漏掉（反向验证当场证明了这个版本的失效）。
       剥掉注释后两边都干净。 */
    const cssNoComment = cssTxt.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const dimOpacityRules = [];
    const opRe = /([^{}]+)\{([^{}]*var\(--text-dim\)[^{}]*)\}/g;
    let opM;
    while ((opM = opRe.exec(cssNoComment))) {
      if (/opacity/.test(opM[2]) && !/is-dead|disabled/.test(opM[1])) {
        dimOpacityRules.push(opM[1].trim().replace(/\s+/g, ' ').slice(-44));
      }
    }
    T('O9 色标', 'R59h 灰字规则不得额外叠 opacity（会把提上去的对比度打回；禁用态豁免）',
      dimOpacityRules.length === 0,
      dimOpacityRules.length ? '叠加 opacity：' + dimOpacityRules.join(' | ') : '无叠加');

    /* ---- O9-F：端到端 —— 真实归档页每条都有可区分的标识 ---- */
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return ctx.doc.querySelectorAll('.archive-item').length > 0; }, 3000);

    const items = Array.prototype.slice.call(ctx.doc.querySelectorAll('.archive-item'));
    T('O9 色标', 'R60 归档页每条都有频段标识（不再只有标题+日期）',
      items.length > 0 && items.every(function (li) {
        return !!li.querySelector('.archive-badges .tag-badge, .archive-badges .tag-badge-none');
      }), items.length + ' 条');
    T('O9 色标', 'R60b 每条条目都带 data-tone（驱动左侧色条）',
      items.length > 0 && items.every(function (li) { return /^t[0-4]$/.test(li.getAttribute('data-tone') || ''); }),
      items.map(function (li) { return li.getAttribute('data-tone'); }).join(','));

    /* 这些是用户可见的文字必须真的在页面上（不是只在源码里） */
    const bodyTxt = ctx.doc.body.textContent || '';
    T('O9 色标', 'R60c 标签文字已渲染到页面', /code/.test(bodyTxt) && /guide/.test(bodyTxt));
    T('O9 色标', 'R60d 图标已渲染到页面（非色彩识别通道真的存在）',
      items.length > 0 && items.every(function (li) {
        const g = li.querySelector('.tag-badge .tag-glyph');
        return g && g.textContent.trim().length > 0;
      }));

    /* 关键回归：同一条目内不得出现两个同色徽章（否则读不出"这两个是不同类"） */
    const dupInItem = items.filter(function (li) {
      const ts = Array.prototype.map.call(li.querySelectorAll('.tag-badge[data-tone]'), function (b) {
        return b.getAttribute('data-tone');
      });
      return new Set(ts).size !== ts.length;
    });
    T('O9 色标', 'R60e 页面上同一条目内无重复色号',
      dupInItem.length === 0, dupInItem.length + ' 条冲突');

    /* 跨条目稳定：同一标签在页面任何位置都是同一色号。
       这是整个方案的地基 —— 也是唯一能挡住"按顺序取色"实现的断言。 */
    const toneByTag = {};
    let crossStable = true;
    Array.prototype.forEach.call(ctx.doc.querySelectorAll('.tag-cloud .tag-item[data-tone], .tag-badge[data-tone]'), function (el) {
      const name = (el.textContent || '').replace(/[◆▲■⬢●◇×\d\s#]/g, '');
      const tone = el.getAttribute('data-tone');
      if (!name) return;
      if (toneByTag[name] === undefined) toneByTag[name] = tone;
      else if (toneByTag[name] !== tone) crossStable = false;
    });
    T('O9 色标', 'R60f 同一标签跨条目/跨组件恒为同一色号',
      crossStable, Object.keys(toneByTag).map(function (k) { return k + '=' + toneByTag[k]; }).join(' '));

    /* CSP：零内联事件属性 —— 色标是链接，不得中途改用 onclick */
    T('O9 色标', 'R60g 色标不含内联事件属性（CSP 下会被直接拦死）',
      !/tag-badge[^>]*\son[a-z]+=/i.test(SRC.views));
    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O9 色标" };

standalone(module, run);
