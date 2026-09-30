'use strict';
/* ============================================================
   tests/cases/15-o-2-0-收尾.js — O 2.0 收尾
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L692-711, L714-743, L746-783, L786-811, L814-876, L1173-1205
   独立运行：node tests/cases/15-o-2-0-收尾.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments } = require('../common');
const fs = require('fs');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 O：2.0 收尾批（E2 / E1 / C4 / C6 / CRUD） ================= */

  /* ---- O1：安全审计 L-3 闭环（parseHash 不再因畸形编码抛错） ---- */
  {
    const seg = SRC.app.slice(SRC.app.indexOf('function safeDecode'), SRC.app.indexOf('function route()'));
    const make = new Function('location', seg + '\nreturn parseHash;');
    const bad = ['#/%', '#/%E0%A4%A', '#/tag/%', '#/search/%zz', '#/%C3%28'];
    let threw = 0;
    bad.forEach(h => {
      try { make({ hash: h })(); } catch (e) { threw++; }
    });
    T('O 2.0 收尾', 'R42 畸形 URI 编码不再抛 URIError（L-3 闭环）', threw === 0,
      threw + '/' + bad.length + ' 抛错');
    /* 正常路由仍要能用，别为了健壮性把功能搞坏 */
    let okNormal = true;
    try {
      const a = make({ hash: '#/post/1' })();
      const b = make({ hash: '#/tag/代码' })();
      okNormal = a.name === 'post' && a.id === 1 && b.tag === '代码';
    } catch (e) { okNormal = false; }
    T('O 2.0 收尾', 'R42b 正常路由解析不受影响', okNormal);
    T('O 2.0 收尾', 'R42c 源码存在 safeDecode', /function safeDecode\s*\(/.test(SRC.app));
  }

  /* ---- O2：E2 构建流程 ---- */
  {
    const pkgPath = require('path').join(__dirname, '..', '..', 'package.json');
    const lockPath = require('path').join(__dirname, '..', '..', 'package-lock.json');
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) { /* 留 null */ }
    T('O 2.0 收尾', 'R43 package.json 存在且声明脚本', !!pkg && !!pkg.scripts);
    T('O 2.0 收尾', 'R43b 门禁脚本 gate 指向 run-all', !!pkg && /run-all/.test(pkg.scripts.gate || ''));
    T('O 2.0 收尾', 'R43c feed 脚本指向 gen-feed（C4 依赖它）', !!pkg && /gen-feed/.test(pkg.scripts.feed || ''));
    T('O 2.0 收尾', 'R43d build = gate + feed', !!pkg && /gate/.test(pkg.scripts.build || '') && /feed/.test(pkg.scripts.build || ''));
    T('O 2.0 收尾', 'R43e preversion 自动跑门禁（防带病发版）', !!pkg && /gate/.test(pkg.scripts.preversion || ''));
    let lockSize = 0;
    try { lockSize = fs.statSync(lockPath).size; } catch (e) { lockSize = 0; }
    T('O 2.0 收尾', 'R43f package-lock.json 已生成', lockSize > 1000, lockSize + 'B');
    /* 版本自检工具真跑一遍。
       不 fork 子进程（沙箱下 spawnSync 会 EBUSY），直接 require 调 check()。 */
    let checkOut = '', checkOk = false;
    try {
      const cv = require('../../tools/check-version.js');
      const r = cv.check();
      checkOk = r.ok === true;
      checkOut = r.ok
        ? '✓ 版本一致：v' + r.build + '（' + r.refs.length + ' 处 ?v= 引用）'
        : r.problems.join('; ');
    } catch (e) { checkOut = String(e && e.message); }
    T('O 2.0 收尾', 'R43g version:check 工具可执行且当前一致', checkOk, checkOut.slice(0, 60));
    /* 未引入打包器：本项目的价值就是"打开就能跑" */
    T('O 2.0 收尾', 'R43h 未引入打包器（devDependencies 仅 jsdom）',
      !!pkg && Object.keys(pkg.devDependencies || {}).every(k => /jsdom/.test(k)),
      pkg ? Object.keys(pkg.devDependencies || {}).join(',') || '(空)' : '');
  }

  /* ---- O3：E1 错误上报 ---- */
  {
    const ctx = bootDom({ captureConsole: true });
    await waitFor(() => ctx.doc.body.innerHTML.length > 600, 3000);
    await new Promise(r => setTimeout(r, 200));

    T('O 2.0 收尾', 'R44 NEON.Errors 已导出', !!(ctx.w.NEON && ctx.w.NEON.Errors));
    T('O 2.0 收尾', 'R44b report 与 listMine 存在',
      !!(ctx.w.NEON && typeof ctx.w.NEON.Errors.report === 'function' && typeof ctx.w.NEON.Errors.listMine === 'function'));

    /* 脱敏：URL / 邮箱 / 令牌必须被抹掉，这是安全基线 */
    const scrub = ctx.w.NEON.Errors._scrub;
    T('O 2.0 收尾', 'R45 脱敏抹掉 URL', !/https?:\/\//.test(scrub('访问 https://a.com/x?k=1 失败')),
      scrub('访问 https://a.com/x?k=1 失败'));
    T('O 2.0 收尾', 'R45b 脱敏抹掉邮箱', !/@/.test(scrub('用户 a@b.com 报错')), scrub('用户 a@b.com 报错'));
    T('O 2.0 收尾', 'R45c 脱敏抹掉平台 key（wbpk_）',
      !/wbpk_/.test(scrub('key=wbpk_abc123XYZ 无效')), scrub('key=wbpk_abc123XYZ 无效'));
    T('O 2.0 收尾', 'R45d 脱敏抹掉 JWT 片段（eyJ）',
      !/eyJ/.test(scrub('token eyJhbGciOi 过期')), scrub('token eyJhbGciOi 过期'));
    T('O 2.0 收尾', 'R45e 超长消息被裁到 1000 内', scrub('x'.repeat(5000)).length <= 1000,
      scrub('x'.repeat(5000)).length + ' 字符');

    /* 上报只写脱敏后的数据：原始 error 对象不入库 */
    const before = ctx.queries.length;
    ctx.w.dispatchEvent(new ctx.w.ErrorEvent('error', { message: 'boom https://x.com', filename: 'a.js', lineno: 1 }));
    await new Promise(r => setTimeout(r, 200));
    const errQ = ctx.queries.filter(q => q.table === 'error_logs');
    T('O 2.0 收尾', 'R46 未捕获异常触发写 error_logs', errQ.length > 0, errQ.length + ' 条');
    if (errQ.length) {
      const row = errQ[0].payload || {};
      T('O 2.0 收尾', 'R46b 入库的 message 已脱敏（不含原始 URL）',
        !/https?:\/\//.test(String(row.message || '')), String(row.message).slice(0, 40));
      T('O 2.0 收尾', 'R46c 带构建版本便于定位', !!row.build && /v?\d/.test(String(row.build)), String(row.build));
      T('O 2.0 收尾', 'R46d 只写 INSERT（日志不可改）', errQ[0].kind === 'insert', errQ[0].kind);
    }
    /* 会话内上报有上限，防死循环刷库 */
    T('O 2.0 收尾', 'R46e 源码含会话上报上限（防刷库）', /ERR_BUDGET/.test(SRC.cloud));
    ctx.dom.window.close();
  }

  /* ---- O4：C4 RSS ---- */
  {
    const feedPath = require('path').join(__dirname, '..', '..', 'feed.xml');
    let feed = '';
    try { feed = fs.readFileSync(feedPath, 'utf8'); } catch (e) { feed = ''; }
    T('O 2.0 收尾', 'R47 feed.xml 已生成', feed.length > 100, feed.length + 'B');
    T('O 2.0 收尾', 'R47b 是合法 RSS 2.0 结构',
      /^<\?xml/.test(feed) && /<rss version="2.0"/.test(feed) && /<\/rss>\s*$/.test(feed.trim()));
    T('O 2.0 收尾', 'R47c 声明 atom:self 自引用', /rel="self"/.test(feed));
    /* URL 必须带 /cyberpunk-blog/ 前缀 —— 少一层就是空壳。
       先剥掉 <rss ...> 开标签：里面的 xmlns 命名空间（w3.org）不是站点 URL，
       第一版没剥，把命名空间也算进去，5 个 URL 里 1 个假红。 */
    const feedBody = feed.replace(/<rss[^>]*>/, '');
    const hrefs = feedBody.match(/https?:\/\/[^"<]+/g) || [];
    T('O 2.0 收尾', 'R47d 所有 URL 带 /cyberpunk-blog/ 前缀（根域只是跳转页）',
      hrefs.length > 0 && hrefs.every(h => /\/cyberpunk-blog\//.test(h)),
      hrefs.length + ' 个 URL');
    T('O 2.0 收尾', 'R47e 无 XML 非法控制字符',
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(feed));
    /* 发现声明 */
    T('O 2.0 收尾', 'R47f index.html 有 RSS 发现声明',
      /<link[^>]+rel="alternate"[^>]+application\/rss\+xml/.test(SRC.html));
    /* 生成器存在且只输出 published */
    T('O 2.0 收尾', 'R47g gen-feed.js 存在且只取 status=published',
      fs.existsSync(require('path').join(__dirname, '..', '..', 'tools', 'gen-feed.js')) &&
      /status=eq\.published/.test(fs.readFileSync(require('path').join(__dirname, '..', '..', 'tools', 'gen-feed.js'), 'utf8')));
  }

  /* ---- O5：C6 亮色主题 ---- */
  {
    T('O 2.0 收尾', 'R48 CSS 定义亮色变量块', /html\[data-theme="light"\]/.test(SRC.css || ''));
    /* v3.0 B1：亮色档的霓虹不再逐个硬编码，改由**派生参数**统一压暗。
       判据随之从"某个 hex 值"升级为"亮色档确实覆盖了压暗参数"——
       这比原来的字面比对更强：原来只证明"青色被压暗"，
       现在证明整套主色（含线 / 辉光 / 网格）都被同一个参数压暗。 */
    const lightAt = (SRC.css || '').indexOf('html[data-theme="light"]');
    const lightBlk = lightAt === -1 ? '' : SRC.css.slice(
      SRC.css.indexOf('{', lightAt),
      SRC.css.indexOf('}', SRC.css.indexOf('{', lightAt)));
    const lightL = /--hue-l:\s*(\d+)%/.exec(lightBlk);
    T('O 2.0 收尾', 'R48b 亮色档用派生参数压暗主色（--hue-l ≤ 35%，暗色档为 50%）',
      !!lightL && parseInt(lightL[1], 10) <= 35,
      lightL ? '--hue-l: ' + lightL[1] + '%' : '未找到亮色档压暗参数');
    /* O11：扫之前必须剥注释 —— 本次改造的注释里**大量引用了**被移除的
       @media (prefers-color-scheme: light) 和 :not([data-theme="dark"])，
       不剥注释的话这些"说明性文字"会让下面三条断言全部假红。
       （同一坑 v1.7.0 的 CSP 断言也踩过。） */
    const cssBare = stripComments(SRC.css || '');
    T('O 2.0 收尾', 'R48c 默认暗色：不再跟随系统偏好（prefers-color-scheme 已移除）',
      !/@media\s*\(prefers-color-scheme/.test(cssBare),
      /@media\s*\(prefers-color-scheme/.test(cssBare) ? '仍存在媒体查询分支' : '已移除');
    /* R48d：原先守的是「别裸用 :not([data-theme="dark"])」。
       O11 之后这个选择器已彻底退场（它本就是配合"跟随系统"media 块用的），
       断言随之升级为更强的一条：**任何地方都不该再出现它**，
       也不必再区分"在 media 内还是外"。 */
    T('O 2.0 收尾', 'R48d 不再使用 :not([data-theme="dark"]) 这类否定式主题选择器',
      !/:not\(\s*\[data-theme="dark"\]\s*\)/.test(cssBare),
      (cssBare.match(/:not\(\[data-theme="dark"\]\)/g) || []).length + ' 处');
    /* O11 正面断言：暗色兜底必须真的存在 —— :root 默认变量就是暗色，
       且亮色只在显式属性下生效。这条替代了原来的 R48d2（它守的是 media 内的
       :not(...) 合法用法，该用法已随 media 块一起消失）。 */
    T('O 2.0 收尾', 'R48d2 亮色仅由显式 data-theme="light" 触发（媒体查询不参与）',
      /html\[data-theme="light"\]\s*\{/.test(cssBare) &&
      !/@media\s*\(prefers-color-scheme/.test(cssBare));
    T('O 2.0 收尾', 'R48e 代码块底色改用变量（非硬编码）',
      /background:\s*var\(--code-bg\)/.test(SRC.css || ''));

    /* 运行时：三态循环 + 持久化 */
    const ctx = bootDom({ captureConsole: true });
    await waitFor(() => !!ctx.doc.getElementById('btn-theme'), 3000);
    await new Promise(r => setTimeout(r, 150));
    const btn = ctx.doc.getElementById('btn-theme');
    T('O 2.0 收尾', 'R49 导航栏存在主题按钮', !!btn);
    T('O 2.0 收尾', 'R49b 按钮是 <button>（非内联 onclick）',
      !!btn && btn.tagName === 'BUTTON' && !btn.getAttribute('onclick'));
    /* O11 主断言：从未选择过的用户，看到的必须是暗色 —— 与系统设置无关。 */
    T('O 2.0 收尾', 'R49e 默认态是暗色（btn 文案 ☾ DARK，非 ◐ AUTO）',
      !!btn && /DARK/.test(btn.textContent) && !/AUTO/.test(btn.textContent),
      btn ? btn.textContent : '无按钮');
    T('O 2.0 收尾', 'R49f 默认态 data-theme="dark"（而非无属性/亮色）',
      ctx.doc.documentElement.getAttribute('data-theme') === 'dark',
      String(ctx.doc.documentElement.getAttribute('data-theme')));

    /* 2.1.0（P0 批）：AUTO 态收口 —— 循环 dark ⇄ light。
       AUTO 在 O11 之后已名存实亡（它唯一的实现方式 @media prefers-color-scheme
       被删掉了，点它等于"什么都不设" = 暗色）。保留一个看起来有效、
       实际无效的开关比没有更糟，故本批正式摘除。

       v2.7（C12）：由两态扩为**三态** dark → light → warm → dark。
       循环长度从 2 变 3，故断言须检查完整一圈（3 次点击回到起点）。
       v2.9.4：**循环**改为**罗盘单选**（点哪个就是哪个，不再盲转到下一档）。
       断言同步改写 —— 但"不出现无属性态"这条检查的意义不变，继续保留。

       ⚠ 反向验证要求：下面每条都必须能被"摘掉实现"打红。
         · R49h 若删掉 openThemeMenu()，click 后 hidden 仍在 → 红
         · R49c3 若 syncThemeMenu 不写 aria-checked → 全 false → 红
         · R49j  若 closeThemeMenu 不回写 aria-expanded → 红 */
    const menu = ctx.doc.getElementById('theme-menu');
    /* v3.0 B1：面板由一层 radiogroup 升级为"外层 group + 两个 radiogroup"
       （明度 3 项 / 色相 9 项）。单选语义必须分组承载 —— 12 项混装进一个
       radiogroup，读屏会把"明度"和"色相"念成一个九选一。
       v4.3 B4：装置面板三区化 —— 再添"氛围 3 项 / 装置 3 项"两组 ⇒ 四组。 */
    T('O 2.0 收尾', 'R49g 装置面板存在（外层 group + 四个 radiogroup；明度3/色相9/氛围3/装置3）',
      !!menu && menu.getAttribute('role') === 'group' &&
      menu.querySelectorAll('[role="radiogroup"]').length === 4 &&
      menu.querySelectorAll('[data-theme-val]').length === 3 &&
      menu.querySelectorAll('[data-hue-val]').length === 9 &&
      menu.querySelectorAll('[data-atmo-val]').length === 3 &&
      menu.querySelectorAll('[data-tap-val]').length === 3,
      menu ? ('组 ' + menu.querySelectorAll('[role="radiogroup"]').length +
        ' / 明度 ' + menu.querySelectorAll('[data-theme-val]').length +
        ' / 色相 ' + menu.querySelectorAll('[data-hue-val]').length) : '未找到 #theme-menu');
    T('O 2.0 收尾', 'R49h 默认收起，点触发器才展开（hidden 属性真实翻转）',
      !!menu && menu.hasAttribute('hidden') &&
      (btn.click(), !menu.hasAttribute('hidden')),
      menu ? String(menu.hasAttribute('hidden')) : '无面板');
    T('O 2.0 收尾', 'R49i 展开后 aria-expanded=true（读屏能感知开合）',
      btn.getAttribute('aria-expanded') === 'true', String(btn.getAttribute('aria-expanded')));

    const seq = [];
    const checked = [];
    for (const m of ['light', 'warm', 'dark']) {
      const opt = menu && menu.querySelector('[data-theme-val="' + m + '"]');
      if (!opt) { seq.push(null); checked.push(null); continue; }
      opt.click();
      await new Promise(r => setTimeout(r, 40));
      seq.push(ctx.doc.documentElement.getAttribute('data-theme'));
      checked.push(opt.getAttribute('aria-checked'));
    }
    T('O 2.0 收尾', 'R49c 罗盘三档可直选（点 light→light、点 warm→warm、点 dark→dark）',
      JSON.stringify(seq) === JSON.stringify(['light', 'warm', 'dark']), JSON.stringify(seq));
    T('O 2.0 收尾', 'R49c2 切档过程中不出现"无属性"态（AUTO 的残留表现）',
      seq.indexOf(null) === -1, JSON.stringify(seq));
    /* v3.0 B1：两组各自单选 ⇒ 全局面板里应当恰有 2 项 true（明度 1 + 色相 1）。
       判据落在**每组内部**，而不是全局面板 —— 那样才真的守住"单选"语义。 */
    const rgAll = menu.querySelectorAll('[role="radiogroup"]');
    const trueIn = function (i) {
      return rgAll[i] ? rgAll[i].querySelectorAll('[aria-checked="true"]').length : -1;
    };
    T('O 2.0 收尾', 'R49c3 被点的那项 aria-checked=true，且每组恰一项为 true（明度组 1 / 色相组 1）',
      checked.length === 3 && checked.every(function (v) { return v === 'true'; }) &&
      trueIn(0) === 1 && trueIn(1) === 1,
      checked.join(',') + ' / 明度组 true=' + trueIn(0) + ' 色相组 true=' + trueIn(1));
    T('O 2.0 收尾', 'R49j 选完自动收起且 aria-expanded 回写 false',
      menu.hasAttribute('hidden') && btn.getAttribute('aria-expanded') === 'false',
      'hidden=' + menu.hasAttribute('hidden') + ' expanded=' + btn.getAttribute('aria-expanded'));
    T('O 2.0 收尾', 'R49d 选择持久化到 localStorage',
      ['light', 'dark', 'warm'].indexOf(ctx.w.localStorage.getItem('neon_theme')) !== -1,
      ctx.w.localStorage.getItem('neon_theme'));
    ctx.dom.window.close();
  }

  /* ---- O6：CRUD 边界规则 ---- */
  {
    /* 从 app.js 抠出 normalizeTags 真跑（含全部依赖） */
    const from = SRC.app.indexOf('var TAG_MAX');
    const to = SRC.app.indexOf('/* ============ C6：亮色主题');
    const norm = new Function(SRC.app.slice(from, to) + '\nreturn normalizeTags;')();

    T('O 2.0 收尾', 'R50 标签去重（保持首次顺序）',
      JSON.stringify(norm('代码,随笔,代码')) === JSON.stringify(['代码', '随笔']),
      JSON.stringify(norm('代码,随笔,代码')));
    T('O 2.0 收尾', 'R50b 大小写重复按小写归一，保留原写法',
      JSON.stringify(norm('JS,js,JS')) === JSON.stringify(['JS']), JSON.stringify(norm('JS,js,JS')));
    T('O 2.0 收尾', 'R50c 空项被丢弃（不存空串）',
      JSON.stringify(norm('a,,b,  ,c')) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(norm('a,,b,  ,c')));
    T('O 2.0 收尾', 'R50d 支持中英文逗号与分号',
      JSON.stringify(norm('a，b;c；d,e')) === JSON.stringify(['a', 'b', 'c', 'd', 'e']),
      JSON.stringify(norm('a，b;c；d,e')));
    T('O 2.0 收尾', 'R50e 超 8 个截断', norm('1,2,3,4,5,6,7,8,9,10').length === 8,
      norm('1,2,3,4,5,6,7,8,9,10').length + ' 个');
    T('O 2.0 收尾', 'R50f 单标签超 24 字符截断', norm('x'.repeat(50)).length === 1 && norm('x'.repeat(50))[0].length === 24);
    T('O 2.0 收尾', 'R50g 空输入返回空数组', JSON.stringify(norm('')) === '[]' && JSON.stringify(norm(null)) === '[]');
    T('O 2.0 收尾', 'R50h 不修改入参（返回新数组）', (function () {
      const before = 'a,b';
      norm(before);
      return before === 'a,b';
    })());
    /* 删除必须是二次确认，且不可逆 */
    T('O 2.0 收尾', 'R51 删除走模态二次确认', /ed-delete[\s\S]{0,600}openModal|openModal[\s\S]{0,400}确认删除/.test(SRC.app));
    /* 未命中提示在 cloud.js（数据层知道 affected 行数），app.js 只做 toast 呈现。
       第一版只在 SRC.app 里找，必然找不到 —— 断言写错了位置，不是功能缺失。 */
    T('O 2.0 收尾', 'R51b 更新/删除未命中时明确报错（不静默成功）',
      /没有更新任何内容/.test(SRC.cloud) && /没有删除任何内容/.test(SRC.cloud),
      (SRC.cloud.match(/没有(更新|删除)任何内容/g) || []).join(' / ') || '未找到');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O 2.0 收尾" };

standalone(module, run);
