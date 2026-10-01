'use strict';
/* ============================================================
   tests/cases/49-v4-4-0-final-audit.js — v4.4 B5「终审」

   把 B5 的三份审计**固化为永久守卫**（一次性报告会腐烂，断言不会）：

   ① 无障碍审计：可访问名 / 地标 / h1 唯一 / tabindex / 表单 label / dialogs 语义
   ② 一致性矩阵：11 路由 → 场景映射 + 场景层集符合注册表
   ③ 性能纪律：重成本层的静态契约（Canvas 唯一性 / 动画走合成器友好属性）
   ④ 文档守卫：HANDOVER 的 4.4.1 更新 + 方案文件在位

   ⚠ 性能的"实测"部分（三档帧率）在 B5 当日因浏览器自动化通道故障未采到，
     已于 v4.4.1 收尾补齐（数字雨 DOM 列法 + COL_W 拐点扫描 + 三轮 A/B 对照），
     结论见 js/atmo.js 的 COL_W 注释与 HANDOVER §7。本文件仍守**静态契约层**
     （"全站零 Canvas"这条断言本身就是 v4.4.1 换实现后才真正成立的）。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments } = require('../common');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../common');

/* 收集某文档里的 a11y 快照。
   ⚠ 可访问名的三种合法来源都要算：aria-label / aria-labelledby（指向真实存在的元素）/
   可见文本 / title。B5 首跑时漏了 aria-labelledby，把 hue-slider 误报成"无名字"
   ——审计工具自己也要被审。 */
function accessibleName(doc, el) {
  var direct = (el.getAttribute('aria-label') || '').trim() ||
    (el.textContent || '').trim() ||
    (el.getAttribute('title') || '').trim();
  if (direct) return direct;
  var by = el.getAttribute('aria-labelledby');
  if (by) {
    var ok = by.split(/\s+/).some(function (id) {
      var ref = doc.getElementById(id);
      return ref && (ref.textContent || '').trim();
    });
    if (ok) return '(labelledby)';
  }
  return '';
}

function a11ySnapshot(doc) {
  var bad = [];
  var nodes = doc.querySelectorAll('a, button, [role="button"], input, select, textarea');
  Array.prototype.forEach.call(nodes, function (el) {
    if (el.closest('[aria-hidden="true"]')) return;
    if (!accessibleName(doc, el)) {
      bad.push(el.tagName + '.' + String(el.className || '').split(' ')[0]);
    }
  });
  var posTab = [];
  Array.prototype.forEach.call(doc.querySelectorAll('[tabindex]'), function (el) {
    if (parseInt(el.getAttribute('tabindex'), 10) > 0) posTab.push(el.tagName);
  });
  return {
    interactive: nodes.length,
    noName: bad,
    positiveTabindex: posTab,
    h1: doc.querySelectorAll('h1').length,
    header: doc.querySelectorAll('header').length,
    main: doc.querySelectorAll('main, [role="main"]').length,
    footer: doc.querySelectorAll('footer').length,
    lang: doc.documentElement.getAttribute('lang')
  };
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);
  const app = stripComments(SRC.app);

  /* ================= ① 无障碍审计（jsdom 真渲染） ================= */
  {
    const CN = 'v4.4 终审';
    const ctx = bootDom({ url: 'https://x.test/#/' });
    await waitFor(function () { return !!ctx.doc.querySelector('.district'); }, 5000);
    await new Promise(function (r) { setTimeout(r, 200); });

    const a = a11ySnapshot(ctx.doc);
    T(CN, 'R240 首页交互元素全部有可访问名（装饰容器内的除外）',
      a.noName.length === 0,
      a.interactive + ' 个交互元素，无名字 ' + a.noName.length +
        (a.noName.length ? '：' + a.noName.slice(0, 5).join(',') : ''));

    T(CN, 'R240b 地标三件 + 基础项（header/main/footer + lang + skip-link + 恰一个 h1）',
      a.header >= 1 && a.main >= 1 && a.footer >= 1 &&
      (a.lang || '').toLowerCase().indexOf('zh') === 0 &&
      !!ctx.doc.querySelector('.skip-link') &&
      a.h1 === 1,
      'header=' + a.header + ' main=' + a.main + ' footer=' + a.footer +
        ' h1=' + a.h1 + ' lang=' + a.lang);

    T(CN, 'R240c 全站无正数 tabindex（允许 0 与 -1 的 roving 模式）',
      a.positiveTabindex.length === 0,
      a.positiveTabindex.join(',') || '无');

    /* 装饰层一律 aria-hidden（氛围 / 字标 / 背景 / 各类粒子） */
    T(CN, 'R240d 装饰层 aria-hidden：氛围双层 / 字标 / hero 背景 / 街区母线',
      /class="atmo atmo-under" aria-hidden="true"/.test(SRC.html) &&
      /class="atmo atmo-over" aria-hidden="true"/.test(SRC.html) &&
      /class="wordmark"[^>]*aria-hidden="true"/.test(SRC.views) &&
      /class="hero-bg" aria-hidden="true"/.test(SRC.views) &&
      /class="district-line" aria-hidden="true"/.test(SRC.views),
      '装饰层语义缺项');

    /* 对话框/浮层的语义三件：组 / 对话框 / 日志区 */
    T(CN, 'R240e 浮层语义：装置面板 role=group / 终端 dialog / 输出区 log+aria-live',
      /role="group" aria-label="配色"/.test(app) &&
      /role="dialog" aria-label="命令终端"/.test(SRC.console) &&
      /role="log" aria-live="polite"/.test(SRC.console),
      '浮层语义缺项');

    ctx.dom.window.close();
  }

  /* 登录页表单 label 关联（另一批元素） */
  {
    const CN = 'v4.4 终审';
    const ctx = bootDom({ url: 'https://x.test/#/login' });
    await waitFor(function () { return !!ctx.doc.querySelector('input'); }, 5000);
    var badLabels = [];
    Array.prototype.forEach.call(
      ctx.doc.querySelectorAll('input:not([type="hidden"]), select, textarea'),
      function (el) {
        var has = !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby') ||
          (el.id && ctx.doc.querySelector('label[for="' + el.id + '"]')) ||
          el.closest('label');
        if (!has) badLabels.push(el.id || el.type || '?');
      }
    );
    T(CN, 'R240f 登录页表单控件全部有 label 关联',
      badLabels.length === 0,
      badLabels.join(',') || '全部关联');
    ctx.dom.window.close();
  }

  /* ================= ② 一致性矩阵（11 路由 → 场景） ================= */
  {
    const CN = 'v4.4 终审';
    const ctx = bootDom({ url: 'https://x.test/#/' });
    await waitFor(function () { return !!ctx.doc.querySelector('.district'); }, 5000);

    /* 直连路由（不需要登录的九条）—— 每条切 hash 后核对场景与层集 */
    const routes = [
      ['#/', 'tower', 9],
      ['#/archive', 'archive', 5],
      ['#/tags', 'bands', 5],
      ['#/search/test', 'scanner', 5],
      ['#/marks', 'stash', 4],
      ['#/about', 'idcard', 4],
      ['#/post/1', 'reading', 2],
      ['#/login', 'gate', 3],
      ['#/', 'tower', 9]
    ];
    var lines = [];
    var allOk = true;
    for (var i = 0; i < routes.length; i++) {
      ctx.w.location.hash = routes[i][0];
      await new Promise(function (r) { setTimeout(r, 120); });
      var scene = ctx.doc.body.getAttribute('data-scene');
      var n = (ctx.doc.documentElement.getAttribute('data-atmo') || '').split(' ').filter(Boolean).length;
      var ok = scene === routes[i][1] && n === routes[i][2];
      if (!ok) allOk = false;
      lines.push(routes[i][0] + '→' + scene + '(' + n + ')');
    }
    T(CN, 'R241 一致性矩阵：九条直连路由的场景与层集全部符合注册表',
      allOk,
      lines.join(' '));

    /* 需登录的两条：未登录必须落到 gate（设计行为，不是 bug） */
    ctx.w.location.hash = '#/admin';
    await new Promise(function (r) { setTimeout(r, 120); });
    var adminScene = ctx.doc.body.getAttribute('data-scene');
    T(CN, 'R241b 管理/编辑路由未登录时重定向到 gate（设计行为）',
      adminScene === 'gate',
      'admin → ' + adminScene);

    ctx.dom.window.close();
  }

  /* ================= ③ 性能纪律（静态契约） ================= */
  {
    const CN = 'v4.4 终审';

    /* 重成本纪律（v4.4.1 升级版）：**全站零 Canvas** ——
       数字雨改 DOM 列实现后，连"唯一的画布"也不存在了：
       所有氛围渲染都落在合成器可优化的属性上（transform / opacity）。
       断言从"只有雨能用 Canvas"反转为"谁都不许用"（更强的纪律）。 */
    var anyCanvas = ['atmo', 'views', 'app', 'console', 'tap', 'boot', 'scene', 'radio']
      .filter(function (k) { return /createElement\('canvas'\)|getContext\('2d'\)/.test(SRC[k] || ''); });

    T(CN, 'R242 重成本纪律：全站零 Canvas（雨已为 DOM 列实现）',
      anyCanvas.length === 0,
      anyCanvas.join(',') || '零画布');

    T(CN, 'R242b 保底机制在位：45fps 阈值探针 + 降档序 + 用户锁定',
      /FPS_MIN = 45/.test(SRC.atmo) &&
      /DOWNGRADE_ORDER/.test(SRC.atmo) &&
      /neon_atmo_lock/.test(SRC.atmo),
      '保底缺项');

    /* 关键入场动画只用 transform/opacity（合成器友好）——v4.4.1 起含数字雨 */
    var kfOk = ['block-in', 'block-light', 'console-in', 'rain-fall'].every(function (name) {
      var m = new RegExp('@keyframes ' + name + '\\s*\\{([\\s\\S]*?)\\n\\}').exec(css);
      if (!m) return false;
      /* 帧内不得出现会触发布局的属性 */
      return !/(width|height|top|left|margin|padding)\s*:/.test(m[1]);
    });
    T(CN, 'R242c 入场/下落动画只动 transform/opacity（不触发逐帧布局）',
      kfOk,
      kfOk ? '四组关键帧合规' : '存在布局属性动画');
  }

  /* ================= ④ 文档守卫 ================= */
  {
    const CN = 'v4.4 终审';
    var handover = '';
    try { handover = fs.readFileSync(path.join(ROOT, 'HANDOVER.md'), 'utf8'); } catch (e) { handover = ''; }

    T(CN, 'R243 HANDOVER 已更新到 5.7.2（版本 / 门禁数 / 新文件树 / 新坑块）',
      /* ⚠ 版本号要钉**头部那一行**的格式：文件别处（如第 9/10 节注记）也会有 "v4.x.x"
         字样 —— 只查"全文出现过"会让"头部版本没改"的变异假绿（反向验证实锤）。
         ⚠ 每次 bump 都要同步改这里（v4.8.0 门禁 1106→1135、v5.6.1 1194→1157、
            v5.6.2 1157→1153、v5.6.3 1153→1125、v5.6.5 1125→1127、v5.7.0 1127→1156、v5.7.2 裁剪到 343）—— 文档更新后不同步断言，就会像这次一样在门禁上当场报红。
           这条断言故意把"版本"与"门禁数"绑在一起：断言总数一变就必须回头改文档。 */
      /* ⚠ 正则写成 [*][*] 而不是反斜杠星号星号：两个星号紧跟斜杠会**提前闭合注释**，
         实测把整个文件带成语法错误、报错行还指向 20 行之外（很难查）。
         这条注释本身也刻意不写出那两个字符的连写。 */
      /[*][*]版本[*][*]：v5\.7\.2/.test(handover) &&
      /343\/343/.test(handover) &&
      /scene\.js/.test(handover) && /console\.js/.test(handover) &&
      /4\.0 时代的新坑/.test(handover),
      handover ? '缺项或头部版本未更新' : 'HANDOVER 缺失');

    /* v5.6.3 改判：原先这条读 `docs/archive/4.0-改版方案.md` 并断言里面写着 B1~B5。
       那份归档（15 份历史方案/报告，290KB）已按"只留当前需要的"整体删除，
       于是改判为**守现在真正的记录处**：HANDOVER 的 4.0 完成注记里必须仍然
       写清五个批次（B1 地基重铸 → B5 终审）—— 那是接手者能查到的唯一出处。 */
    T(CN, 'R243b 4.0 五批定义仍记在 HANDOVER（归档方案已删，记录不能跟着丢）',
      /B1 地基重铸/.test(handover) && /B4 控制台/.test(handover) && /B5 终审/.test(handover),
      handover ? '五批注记在位' : 'HANDOVER 缺失');
  }

  /* ================= ⑤ CSS 结构性守卫（v5.6.3 新增） =================
     为什么单独立一条：清代码时"只删到第一个 }"是**最隐蔽**的删法 —— 剩下的半截
     规则浏览器会静默忽略，**所有既有断言照样全绿**（它们只查"某条规则在不在"）。
     本轮实测两次：v3.6.0 删氛围层留下一个孤儿 `}`；v5.6.2 删 @keyframes radio-pulse
     留下 `50% { … }` + `}` 两行。两次都让整份样式的括号配平长期差 1~2，没人发现。
     这条守卫直接盯**结构本身**：括号必须配平，且顶层不许出现裸声明
     （depth 0 处出现 `prop: value;` = 某条规则的壳被删了、身子留下了）。 */
  {
    const CN = 'v5.6.3 结构守卫';
    const cssRaw = require('fs').readFileSync(require('path').join(ROOT, 'css/style.css'), 'utf8');
    /* 逐字符扫描：跳过块注释与引号字符串，只统计代码区的花括号。
       ⚠ 刻意**不用正则**剥注释 —— 这条守卫本身要检查的就是括号配平，
         用正则处理「注释里出现花括号」这种情况反而容易把自己绕进去。 */
    let depth = 0;
    let firstBadLine = 0;
    const orphans = [];
    let line = 1;
    let cur = '';
    for (let i = 0; i < cssRaw.length; i++) {
      const ch = cssRaw[i];
      if (ch === '\n') {
        /* 顶层出现 prop: value; ⇒ 孤儿声明（@ 开头的 at-rule 除外） */
        const t = cur.trim();
        if (depth === 0 && /^[a-z-]+\s*:\s*[^;{]+;$/i.test(t) && !/^@/.test(t)) {
          orphans.push('行' + line + '：' + t.slice(0, 48));
        }
        cur = '';
        line++;
        continue;
      }
      if (ch === '/' && cssRaw[i + 1] === '*') {          /* 跳过块注释 */
        const end = cssRaw.indexOf('*/', i + 2);
        const stop = end === -1 ? cssRaw.length : end + 2;
        for (let k = i; k < stop; k++) if (cssRaw[k] === '\n') line++;
        i = stop - 1;
        cur = '';
        continue;
      }
      if (ch === '"' || ch === "'") {                     /* 跳过字符串 */
        let k = i + 1;
        while (k < cssRaw.length && cssRaw[k] !== ch) {
          if (cssRaw[k] === '\\') k++;
          k++;
        }
        i = k;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth < 0 && !firstBadLine) firstBadLine = line; }
      cur += ch;
    }
    T(CN, 'R244 CSS 括号配平（删规则时只删到第一个 } 会留下孤儿片段）',
      depth === 0 && firstBadLine === 0,
      depth === 0 ? '配平' : ('depth=' + depth + (firstBadLine ? '，首次负深度在行 ' + firstBadLine : '')));
    T(CN, 'R244b CSS 顶层无孤儿声明（规则的壳被删掉、身子留下）',
      orphans.length === 0,
      orphans.length ? orphans.join(' | ') : '干净');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "v4.4 终审：a11y/一致性/性能/文档" };

standalone(module, run);
