'use strict';
/* ============================================================
   tests/cases/22-o11-暗色优先.js — O11 暗色优先
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L1744-1881
   独立运行：node tests/cases/22-o11-暗色优先.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments, stripJsLineComments } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ---- O11：暗色优先（默认暗色 + 首绘前定色 + 不依赖系统） ---- */
  {
    const css = SRC.css || '';
    const html = SRC.html || '';
    const tboot = SRC.themeBoot || '';
    /* 同上：源码注释里会引用被移除的写法与"NEON 还没加载"的说明，
       扫之前一律先剥注释，否则说明文字会把断言判红。 */
    const cssBare = stripComments(css);
    const tbootBare = stripComments(stripJsLineComments(tboot));

    /* ---- 静态结构 ---- */
    T('O11 暗色优先', 'R62 CSS 中已无任何 prefers-color-scheme 分支（不再跟随系统）',
      !/prefers-color-scheme/.test(cssBare),
      (cssBare.match(/prefers-color-scheme/g) || []).length + ' 处');
    T('O11 暗色优先', 'R62b 亮色变量表仍在（手动切换没被误删）',
      /html\[data-theme="light"\]\s*\{[\s\S]*?--bg-0:\s*#eef2f8/.test(cssBare));
    T('O11 暗色优先', 'R62c 暗色是 :root 默认（无属性即暗色，无需额外规则）',
      /:root\s*\{[\s\S]*?--bg-0:\s*#04060d/.test(cssBare));

    /* 引导脚本必须【同步】且【在样式表之前】，否则会先暗后亮闪一帧 */
    const bootIdx = html.indexOf('js/theme-boot.js');
    const cssIdx = html.indexOf('css/style.css');
    const bootTag = /<script(?![^>]*\b(?:defer|async)\b)[^>]*src="js\/theme-boot\.js[^"]*"[^>]*>/.exec(html);
    T('O11 暗色优先', 'R63 index.html 引入了 theme-boot.js', bootIdx !== -1);
    T('O11 暗色优先', 'R63b 引导脚本是【同步】脚本（无 defer/async）—— 否则赶不上首绘',
      !!bootTag, bootTag ? '命中同步标签' : (/(theme-boot\.js)/.test(html) ? '存在但带 defer/async' : '未引入'));
    T('O11 暗色优先', 'R63c 引导脚本排在样式表之前（CSS 生效前已定色）',
      bootIdx !== -1 && cssIdx !== -1 && bootIdx < cssIdx,
      'boot@' + bootIdx + ' css@' + cssIdx);
    T('O11 暗色优先', 'R63d 引导脚本带版本查询串（跟 ?v= 一起失效缓存）',
      /src="js\/theme-boot\.js\?v=[0-9.]+"/.test(html));
    /* CSP 硬约束：script-src 无 'unsafe-inline'，引导脚本绝不能是内联的 */
    T('O11 暗色优先', 'R63e 引导脚本是外部文件而非内联（CSP 会拦死内联）',
      /<script(?![^>]*src=)[^>]*>[\s\S]*?neon_theme[\s\S]*?<\/script>/.test(html) === false);
    T('O11 暗色优先', 'R63f 引导脚本零依赖（不引用 NEON/NEONViews/V() 等尚未加载的全局）',
      !/\bwindow\.NEON\b|\bNEONViews\b|\bNEON\(\)/.test(tbootBare));
    /* ⚠ 此处原本有一条 R63g「引导脚本有 try/catch 结构」，已在 D3 批次【删除】。
       它是典型的弱断言：把 catch 体改成 `if (false) {}` 照样绿，
       甚至把 catch 整段删掉、只留 try 也绿 —— 因为它只数"文本里有没有这两个词"。
       真正守行为的是下面 R64f/R64g：真让 localStorage 抛错，再看 <html> 落成什么。
       （已反向验证：把 theme-boot.js 的 try/catch 整段去掉，R64f 立刻报红。）
       留此注释是防止后人把它当作"漏测"又加回来 —— 加回来只会稀释断言强度。 */
    T('O11 暗色优先', 'R63h 引导脚本只用 same-origin 相对路径（无外域请求）',
      !/https?:\/\//.test(tbootBare));

    /* ---- 运行时：真跑 theme-boot.js（不是重写一份逻辑） ---- */
    /* 场景①：从未选择过 → 首绘瞬间就该是暗色。
       2.1.0 起引导脚本对"默认"也【显式】打 data-theme="dark"
       （此前是不打属性、靠 :root 兜底）。视觉结果一致，
       但显式态可被直接读取断言 —— 首绘定色不该依赖"某属性恰好没被设置"。 */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64 无存储记录时首绘前即为暗色',
        attr === 'dark' || attr === null, String(attr));
      c.dom.window.close();
    }
    /* 场景②：曾手动选亮色 → 首绘前就必须打上 light（这一条就是"零闪烁"的本质） */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'light' } });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64b 存了 light 时首绘前即打上 data-theme="light"（无先暗后亮）',
        attr === 'light', String(attr));
      c.dom.window.close();
    }
    /* 场景③：曾手动选暗色 → 明确打上 dark */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'dark' } });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64c 存了 dark 时首绘前即打上 data-theme="dark"',
        attr === 'dark', String(attr));
      c.dom.window.close();
    }
    /* 场景④：脏数据 → 不能崩，也不该错判成亮色。
       2.1.0 起显式落成 dark，故允许 dark 或无属性（都是暗色语义）。 */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'BLUE' } });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64d 存储值非法时按暗色处理（不误判为亮色）',
        attr === null || attr === 'dark', String(attr));
      c.dom.window.close();
    }
    /* 场景⑤：'auto' 是已废弃的存量值（2.1.0 两态收口）。
       它必须落成暗色 —— 既不能崩、也不能因"曾经有效"而错判成亮色。
       归一化的完整行为由 O16 的 R77 系列覆盖，这里只守"不亮"。 */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'auto' } });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64e 存量 auto 值不崩、不误判为亮色（auto 已收口为暗色）',
        attr === null || attr === 'dark', String(attr));
      c.dom.window.close();
    }
    /* 场景⑥：存储被禁用（隐私模式）—— 引导脚本必须静默降级为暗色。
       ⚠ 这条是「行为」断言而非「源码里有 try/catch」那种结构断言：
         结构断言会被 `if (false)` 之类的等价改写骗过（实测过），
         必须真让 localStorage 抛错、再看 <html> 落成什么。 */
    {
      let threw = null, attr = '?';
      try {
        const c = bootDom({ themeBoot: true, themeBootOnly: true, breakStorage: true });
        attr = c.doc.documentElement.getAttribute('data-theme');
        c.dom.window.close();
      } catch (e) { threw = e; }
      T('O11 暗色优先', 'R64f 存储被禁用时不抛异常（隐私模式下不崩）',
        threw === null, threw ? String(threw.message) : '未抛错');
      T('O11 暗色优先', 'R64g 存储被禁用时降级为暗色（不带属性 = :root 兜底）',
        attr === null || attr === 'dark', String(attr));
    }

    /* ---- 端到端：整站启动后仍是暗色，且手动切换 + 持久化不被破坏 ---- */
    {
      const c = bootDom({ captureConsole: true });
      await waitFor(() => !!c.doc.getElementById('btn-theme'), 3000);
      await new Promise(r => setTimeout(r, 120));
      const btn2 = c.doc.getElementById('btn-theme');
      T('O11 暗色优先', 'R65 整站启动后仍是暗色（默认未被系统或存储改写）',
        c.doc.documentElement.getAttribute('data-theme') === 'dark',
        String(c.doc.documentElement.getAttribute('data-theme')));

      /* 手动选亮色 → 属性生效（v2.9.4：罗盘直选，点 LIGHT 项） */
      const menu2 = c.doc.getElementById('theme-menu');
      btn2.click();
      await new Promise(r => setTimeout(r, 30));
      const lo = menu2 && menu2.querySelector('[data-theme-val="light"]');
      if (lo) lo.click();
      await new Promise(r => setTimeout(r, 60));
      T('O11 暗色优先', 'R65b 手动选到亮色后属性变为 light',
        c.doc.documentElement.getAttribute('data-theme') === 'light',
        String(c.doc.documentElement.getAttribute('data-theme')));
      T('O11 暗色优先', 'R65c 用户选择已持久化到 localStorage',
        c.w.localStorage.getItem('neon_theme') === 'light',
        String(c.w.localStorage.getItem('neon_theme')));

      /* 关键回归：此时「重新打开页面」（新 dom + 预置同一存储）应直接是亮色，
         而不是先暗一帧 —— 这正是 R64b 覆盖的路径，这里从端到端再确认一次。 */
      const c2 = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'light' } });
      T('O11 暗色优先', 'R65d 重开后首绘前即恢复用户选择的亮色（偏好持久化生效）',
        c2.doc.documentElement.getAttribute('data-theme') === 'light',
        String(c2.doc.documentElement.getAttribute('data-theme')));
      c2.dom.window.close();
      c.dom.window.close();
    }
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O11 暗色优先" };

standalone(module, run);
