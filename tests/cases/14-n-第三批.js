'use strict';
/* ============================================================
   tests/cases/14-n-第三批.js — N 第三批
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L452-504, L507-546, L549-597, L600-628, L631-661, L664-687
   独立运行：node tests/cases/14-n-第三批.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, FIXTURES, bootDom, waitFor } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 N：第三批 P2（C2 目录/复制 · C1 搜索 · C3 归档） ================= */

  /* ---- N1：C2 详情页 TOC 抽取 + 滚动高亮 + 代码复制按钮 ---- */
  {
    const ctx = bootDom({ url: 'https://x.test/#/post/3' });
    await waitFor(function () {
      const t = ctx.doc.getElementById('md-target');
      return t && t.querySelectorAll('h2,h3').length >= 3;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });

    const nav = ctx.doc.getElementById('post-toc');
    const heads = ctx.doc.querySelectorAll('#md-target h2, #md-target h3');
    T('N 第三批', 'R37 详情页给出 TOC 容器', !!nav);
    T('N 第三批', 'R37b 从正文抽出 h2/h3 且数量匹配', !!nav && nav.querySelectorAll('a.toc-link').length === heads.length,
      nav ? nav.querySelectorAll('a.toc-link').length + ' / ' + heads.length : '无容器');
    T('N 第三批', 'R37c 每条标题都被补上 id 锚点',
      heads.length > 0 && Array.prototype.every.call(heads, function (h) { return !!h.id; }));
    const links = nav ? nav.querySelectorAll('a.toc-link') : [];
    T('N 第三批', 'R37d 目录链接指向真实存在的锚点',
      links.length > 0 && Array.prototype.every.call(links, function (a) {
        const id = a.getAttribute('data-toc');
        return id && !!ctx.doc.getElementById(id);
      }));
    T('N 第三批', 'R37e h3 条目带层级类名 toc-lv3',
      nav && nav.querySelectorAll('.toc-item.toc-lv3').length >= 1,
      nav && nav.querySelectorAll('.toc-item.toc-lv3').length);
    T('N 第三批', 'R37f 目录默认可见（标题数 >= 2）', nav && !nav.hidden);

    /* 代码块复制按钮 */
    const pres = ctx.doc.querySelectorAll('#md-target pre');
    T('N 第三批', 'R38 代码块被注入复制按钮',
      pres.length >= 1 && Array.prototype.every.call(pres, function (p) { return !!p.querySelector('.code-copy'); }),
      pres.length + ' 个 pre');
    T('N 第三批', 'R38b 复制按钮为 <button type=button>（非链接）',
      Array.prototype.every.call(pres, function (p) {
        const b = p.querySelector('.code-copy');
        return b && b.tagName === 'BUTTON' && b.getAttribute('type') === 'button';
      }));
    T('N 第三批', 'R38c pre 带 has-copy 类以避让 ::before 角标',
      Array.prototype.every.call(pres, function (p) { return p.classList.contains('has-copy'); }));
    T('N 第三批', 'R38d 无内联 onclick 依赖（走 addEventListener）',
      !/\.onclick\s*=/.test(SRC.app));

    /* 少于 2 个标题时不显示空目录 */
    const ctx2 = bootDom({ url: 'https://x.test/#/post/2' });
    await waitFor(function () {
      const t = ctx2.doc.getElementById('md-target');
      return t && t.innerHTML.length > 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });
    const nav2 = ctx2.doc.getElementById('post-toc');
    T('N 第三批', 'R37g 标题不足 2 个时目录隐藏（不留空框）', !!nav2 && nav2.hidden === true, nav2 && nav2.hidden);
    ctx.dom.window.close();
    ctx2.dom.window.close();
  }

  /* ---- N1b：TOC 生命周期（切页必须释放，否则每进一次详情页泄漏一份） ---- */
  {
    /* 强制走 scroll 降级路径（无 IntersectionObserver），这是泄漏最严重的分支：
       window 上的监听器永不自动回收，会跨页累积。 */
    const ctx = bootDom({ url: 'https://x.test/#/post/3' });
    await waitFor(function () {
      const t = ctx.doc.getElementById('md-target');
      return t && t.querySelectorAll('h2,h3').length >= 3;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });

    /* jsdom 无 IntersectionObserver → 走 scroll 降级分支（泄漏风险最高的那条路） */
    const after1 = ctx.w.__scrollListeners;
    /* C9 之后基线由 1 变为 2：详情页有两条独立的 scroll 监听 ——
         ① TOC 滚动高亮（降级路径，随页面生命周期存在）
         ② C9 阅读进度条/回顶（全局一个，initScrollUI 幂等安装）
       这里不再硬编码"必须等于 1"（那样每加一处全局监听都要改测试，
       而且改完就失去了对泄漏的约束力），改为断言"= TOC 1 + 全局 1"，
       并显式区分来源，避免将来有人把它当成可以随意增长的计数。 */
    T('N 第三批', 'R37h-0 详情页注册 scroll 监听 = TOC 降级 1 + C9 全局 1',
      after1 === 2, 'count=' + after1 + '（期望 2：TOC 1 + C9 全局 1）');

    /* 反复进出详情页：若 releaseToc 生效，监听器数量不应随次数增长 */
    for (let i = 0; i < 5; i++) {
      ctx.w.location.hash = '#/';
      await new Promise(function (r) { setTimeout(r, 60); });
      ctx.w.location.hash = '#/post/3';
      await new Promise(function (r) { setTimeout(r, 90); });
    }
    await new Promise(function (r) { setTimeout(r, 200); });
    const after = ctx.w.__scrollListeners;
    /* 关键：断言的是"没有随进出次数增长"这一性质，
       而非某个具体数字 —— 数字会随功能增加而变，性质不会。
       6 次进出若不释放，count 会涨到 6+；现在应稳定在 2。 */
    T('N 第三批', 'R37h 反复进出详情页 6 次后 scroll 监听不累积',
      after === after1, '6 次进出后 count=' + after + '（进入时 ' + after1 + '；不修复会涨到 6+）');
    T('N 第三批', 'R37i 源码存在 releaseToc 释放函数', /function releaseToc\s*\(/.test(SRC.app));
    T('N 第三批', 'R37j 路由入口调用 releaseToc（切页即释放）',
      /function route\(\)[\s\S]{0,500}releaseToc\(\)/.test(SRC.app));
    ctx.dom.window.close();
  }

  /* ---- N2：C1 搜索（#/search） ---- */
  {
    const ctx = bootDom({ url: 'https://x.test/#/search' });
    await waitFor(function () { return !!ctx.doc.getElementById('search-input'); }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    T('N 第三批', 'R39 #/search 路由渲染出搜索框', !!ctx.doc.getElementById('search-input'));
    T('N 第三批', 'R39b 空查询时提示索已就绪、不列结果',
      !ctx.doc.querySelector('.post-list') && /READY|索引/.test(ctx.doc.body.textContent || ''));

    /* 直接跳到带关键词的 hash，验证过滤结果 */
    ctx.w.location.hash = '#/search/NEON';
    await waitFor(function () {
      const list = ctx.doc.querySelector('.post-list');
      return list && list.querySelectorAll('.post-card').length > 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });
    const cards = ctx.doc.querySelectorAll('.post-list .post-card');
    T('N 第三批', 'R39c 搜索命中标题（#/search/NEON → 1 条）', cards.length === 1, cards.length + ' 条');
    T('N 第三批', 'R39d 命中项标题正确',
      cards.length === 1 && /NEON/.test(cards[0].textContent));

    /* 按标签命中 */
    ctx.w.location.hash = '#/search/search';
    await waitFor(function () {
      const list = ctx.doc.querySelector('.post-list');
      return list && list.querySelectorAll('.post-card').length > 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 120); });
    const tagCards = ctx.doc.querySelectorAll('.post-list .post-card');
    T('N 第三批', 'R39e 按 tag 命中（#/search/search → 1 条）', tagCards.length === 1, tagCards.length + ' 条');

    /* 无命中 */
    ctx.w.location.hash = '#/search/zzz-not-exist';
    await waitFor(function () { return /NO MATCH/.test(ctx.doc.body.textContent || ''); }, 3000);
    T('N 第三批', 'R39f 无命中时给出 NO MATCH 空状态',
      /NO MATCH/.test(ctx.doc.body.textContent || ''));

    /* 草稿不该出现在公开搜索里 */
    ctx.w.location.hash = '#/search/未公开';
    await waitFor(function () { return /NO MATCH|post-list/.test(ctx.doc.body.textContent || ''); }, 3000);
    await new Promise(function (r) { setTimeout(r, 120); });
    T('N 第三批', 'R39g 草稿不进公开搜索索引',
      !ctx.doc.querySelector('.post-list .post-card'));

    /* 导航栏入口 */
    const navSearch = ctx.doc.querySelector('#nav a[data-nav="search"]');
    T('N 第三批', 'R39h 导航栏存在 SEARCH 入口', !!navSearch);
    ctx.dom.window.close();
  }

  /* ---- N3：C3 归档（#/archive，按月分组倒序） ---- */
  {
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return ctx.doc.querySelectorAll('.archive-group').length > 0; }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    const groups = ctx.doc.querySelectorAll('.archive-group');
    const months = Array.prototype.map.call(groups, function (g) {
      return g.querySelector('.archive-month').textContent.replace(/\d+$/, '').trim();
    });
    T('N 第三批', 'R40 归档页按月分组', groups.length === 3, groups.length + ' 个月');
    T('N 第三批', 'R40b 分组月份倒序（09 → 08 → 07）',
      months.length === 3 && /09/.test(months[0]) && /08/.test(months[1]) && /07/.test(months[2]),
      months.join(' | '));
    T('N 第三批', 'R40c 每月条数标注正确（9月 3 条）',
      groups.length > 0 && /3/.test(groups[0].querySelector('.archive-count').textContent),
      groups[0] && groups[0].querySelector('.archive-count').textContent);
    const totalItems = ctx.doc.querySelectorAll('.archive-item').length;
    T('N 第三批', 'R40d 归档条目总数 == 已发布文章数（5）', totalItems === 5, totalItems + ' 条');
    T('N 第三批', 'R40e 草稿不进归档', !/未公开草稿/.test(ctx.doc.body.textContent || ''));
    const firstLink = ctx.doc.querySelector('.archive-link');
    T('N 第三批', 'R40f 归档条目链接到详情页',
      !!firstLink && /^#\/post\/\d+$/.test(firstLink.getAttribute('href')),
      firstLink && firstLink.getAttribute('href'));
    const navArc = ctx.doc.querySelector('#nav a[data-nav="archive"]');
    T('N 第三批', 'R40g 导航栏存在 ARCHIVE 入口', !!navArc);
    T('N 第三批', 'R40h 未截断时不显示 partial-note（诚实提示不噪音）',
      !ctx.doc.querySelector('.partial-note'));
    ctx.dom.window.close();
  }

  /* ---- N3b：截断时必须诚实告知（否则「共 233 条」实为「只扫了 200 条」） ---- */
  {
    /* 造一个 total 大于实际返回行数的数据源：桩返回 2 行但声称 total=99 */
    const fx = JSON.parse(JSON.stringify(FIXTURES));
    fx.posts = fx.posts.filter(function (p) { return p.status === 'published'; });
    const ctx = bootDom({ url: 'https://x.test/#/archive', fixtures: fx });
    await waitFor(function () { return ctx.doc.querySelectorAll('.archive-group').length > 0; }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    /* 本桩的 total 就是返回行数，跑不出截断场景 —— 故直接对视图层求值。
       抠片段时要连 partialNote 一起带上（它定义在 archiveView 之前，漏了会 ReferenceError）。 */
    const archiveFn = (function () {
      /* 从文件头的 esc 起抠，把 archiveView 依赖的工具函数一并带上 */
      const from = SRC.views.indexOf('function esc');
      const to = SRC.views.indexOf('/* ---------- 文章详情');
      const seg = SRC.views.slice(from, to);
      return new Function(seg + '\nreturn archiveView;')();
    })();
    const htmlTruncated = archiveFn({
      loading: false, error: null, total: 99, scanned: 2,
      groups: [{ key: 'k', label: '2026 年 09 月', posts: [] }]
    });
    T('N 第三批', 'R40i total 大于已扫描量时给出截断提示',
      /partial-note/.test(htmlTruncated) && /仅覆盖最近 2 条/.test(htmlTruncated),
      /partial-note/.test(htmlTruncated) ? '已提示' : '未提示');
    const htmlFull = archiveFn({
      loading: false, error: null, total: 2, scanned: 2,
      groups: [{ key: 'k', label: '2026 年 09 月', posts: [] }]
    });
    T('N 第三批', 'R40j 未截断（total<=scanned）时不提示', !/partial-note/.test(htmlFull));
    ctx.dom.window.close();
  }

  /* ---- N4：第三批不越界（不改 A2 CSP / 不放宽既有约定） ---- */
  {
    /* 从 CSP meta 里精确取出 script-src 这一段再判断。
       注意不能对整份 html 直接查 unsafe-inline —— style-src 本来就合法保留了它。 */
    const cspM = /Content-Security-Policy"\s+content="([^"]+)"/.exec(SRC.html);
    const csp = cspM ? cspM[1] : '';
    const scriptSrc = (/script-src([^;]*)/.exec(csp) || [])[1] || '';
    T('N 第三批', 'R41 CSP meta 仍存在且未被放宽', !!cspM);
    T('N 第三批', 'R41b CSP script-src 仍不含 unsafe-inline',
      /'self'/.test(scriptSrc) && !/unsafe-inline/.test(scriptSrc),
      scriptSrc.trim());
    T('N 第三批', 'R41c 搜索/归档未引入库层全文检索（仍走 listPublished）',
      /renderSearch[\s\S]{0,600}listPublished/.test(SRC.app) &&
      /renderArchive[\s\S]{0,600}listPublished/.test(SRC.app));
    /* 只统计真正作为资源地址出现的外域（…"https://host/ 或 …="https://host"），
       不要用宽松正则扫到 CSP 策略文本里的 https:// 字样。 */
    const origins = {};
    (SRC.html.match(/["'(]https:\/\/([a-z0-9.-]+)/gi) || []).forEach(function (raw) {
      const host = raw.replace(/^["'(]https:\/\//i, '').replace(/[;'")\s].*$/, '');
      if (host && host.indexOf('www.w3.org') === -1) origins[host] = 1;
    });
    T('N 第三批', 'R41d 未新增外部依赖域（仅 jsdelivr + 自身域名）',
      Object.keys(origins).length === 2 && !!origins['cdn.jsdelivr.net'],
      Object.keys(origins).join(', '));
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "N 第三批" };

standalone(module, run);
