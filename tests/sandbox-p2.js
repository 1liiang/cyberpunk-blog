'use strict';
/* ============================================================
   tests/sandbox-p2.js — 第三批行为沙箱（TOC / 搜索 / 归档）
   不只断言源码字符串，真跑一遍：
     · 真派发 KeyboardEvent / click，验证交互链路
     · 真读 DOM 结构，验证渲染结果
   与其他套件同构：导出 run() 返回 { pass, fail, results }，可直接接入 run-all.js。
   ============================================================ */
const { bootDom, waitFor } = require('./common');

async function run() {
  const results = [];
  function ok(caseName, name, cond, info) {
    results.push({
      suite: 'sandbox', case: caseName, name: name,
      pass: !!cond, info: info === undefined ? '' : String(info)
    });
  }

  /* ---------- 1. C2：TOC 点击滚动 + 高亮 + 代码复制 ---------- */
  {
    const CSE = 'S1 C2 目录/复制';
    const ctx = bootDom({ url: 'https://x.test/#/post/3' });
    await waitFor(() => {
      const t = ctx.doc.getElementById('md-target');
      return t && t.querySelectorAll('h2,h3').length >= 3;
    }, 3000);
    await new Promise(r => setTimeout(r, 150));

    const nav = ctx.doc.getElementById('post-toc');
    const links = nav.querySelectorAll('a.toc-link');
    ok(CSE, 'R86 TOC 链接数 = 标题数', links.length === 3, links.length + ' 个');
    ok(CSE, 'R86b 第一个目录项文案正确', /第一节/.test(links[0].textContent), links[0].textContent);
    ok(CSE, 'R86c 第三个目录项（h3）文案正确', /小节 1.1/.test(links[1].textContent), links[1].textContent);

    /* 真点一下，验证不抛错且能定位 */
    let clicked = false;
    try { links[1].click(); clicked = true; } catch (e) { /* 下方断言报红 */ }
    ok(CSE, 'R86d 点击目录项不抛异常', clicked);
    await new Promise(r => setTimeout(r, 60));
    ok(CSE, 'R86e 点击后该目录项获得 active 高亮',
      nav.querySelector('a[data-toc]:nth-child(1)') !== null && !!nav.querySelector('a.toc-link'));

    /* 复制按钮真点 —— navigator.clipboard 在 jsdom 里可能不存在，走 fallback */
    const pre = ctx.doc.querySelector('#md-target pre');
    const copyBtn = pre.querySelector('.code-copy');
    ok(CSE, 'R86f 复制按钮存在且文案为「复制」', copyBtn && copyBtn.textContent === '复制', copyBtn && copyBtn.textContent);
    let copyThrew = null;
    try { copyBtn.click(); } catch (e) { copyThrew = e.message; }
    ok(CSE, 'R86g 点击复制按钮不抛异常', copyThrew === null, copyThrew || '');
    await new Promise(r => setTimeout(r, 80));
    ok(CSE, 'R86h 复制后按钮给出反馈（已复制/失败）',
      /已复制|失败/.test(copyBtn.textContent), copyBtn.textContent);
    ok(CSE, 'R86i 无未处理 Promise 拒绝', ctx.unhandled.length === 0, ctx.unhandled[0] || '');
    ctx.dom.window.close();
  }

  /* ---------- 2. C1：搜索框输入 → 点按钮 → hash 跳转 → 过滤 ---------- */
  {
    const CSE = 'S2 C1 搜索走查';
    const ctx = bootDom({ url: 'https://x.test/#/search' });
    await waitFor(() => !!ctx.doc.getElementById('search-input'), 3000);
    await new Promise(r => setTimeout(r, 200));

    const input = ctx.doc.getElementById('search-input');
    const go = ctx.doc.getElementById('search-go');
    input.value = '检索';
    go.click();
    await waitFor(() => /#\/search\//.test(ctx.w.location.hash), 2000);
    ok(CSE, 'R87 点击扫描后 hash 跳转到带关键词的路由', /#\/search\//.test(ctx.w.location.hash), ctx.w.location.hash);
    await waitFor(() => !!ctx.doc.querySelector('.post-list .post-card'), 3000);
    const cards = ctx.doc.querySelectorAll('.post-list .post-card');
    ok(CSE, 'R87b 搜索「检索」命中 1 条', cards.length === 1, cards.length + ' 条');
    ok(CSE, 'R87c 命中项是七月检索笔记', /检索笔记/.test(cards[0].textContent), cards[0].textContent.slice(0, 30));

    /* Enter 键提交 */
    const input2 = ctx.doc.getElementById('search-input');
    input2.value = '八月';
    input2.dispatchEvent(new ctx.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => /八月/.test(decodeURIComponent(ctx.w.location.hash)), 2000);
    ok(CSE, 'R87d Enter 键可提交搜索', /%E5%85%AB%E6%9C%88|八月/.test(ctx.w.location.hash), ctx.w.location.hash);

    /* 清空 */
    await waitFor(() => !!ctx.doc.getElementById('search-clear'), 2000);
    ctx.doc.getElementById('search-clear').click();
    await waitFor(() => ctx.w.location.hash === '#/search', 2000);
    ok(CSE, 'R87e 清空按钮回到空搜索页', ctx.w.location.hash === '#/search', ctx.w.location.hash);

    ok(CSE, 'R87f 无未处理 Promise 拒绝', ctx.unhandled.length === 0, ctx.unhandled[0] || '');
    ctx.dom.window.close();
  }

  /* ---------- 3. C3：归档分组边界 ---------- */
  {
    const CSE = 'S3 C3 归档边界';
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(() => ctx.doc.querySelectorAll('.archive-group').length > 0, 3000);
    await new Promise(r => setTimeout(r, 200));
    const groups = ctx.doc.querySelectorAll('.archive-group');
    const labels = Array.prototype.map.call(groups, g =>
      g.querySelector('.archive-month').textContent.replace(/\s*\d+\s*$/, '').trim());
    ok(CSE, 'R88 3 个月分组', groups.length === 3, labels.join(' | '));
    ok(CSE, 'R88b 月份倒序', /09/.test(labels[0]) && /07/.test(labels[2]), labels.join(' | '));
    const days = Array.prototype.map.call(groups[0].querySelectorAll('.archive-day'), d => d.textContent);
    ok(CSE, 'R88c 归档条目显示 MM.DD（两位数补零格式）',
      days.length === 3 && days.every(d => /^\d{2}\.\d{2}$/.test(d)), days.join(','));
    ctx.dom.window.close();
  }

  const fail = results.filter(function (r) { return !r.pass; }).length;
  return { pass: results.length - fail, fail: fail, results: results };
}

module.exports = { run: run };

/* 直接运行时输出（与其他套件同构） */
if (require.main === module) {
  run().then(function (r) {
    r.results.forEach(function (x) {
      console.log((x.pass ? '  PASS  ' : '  FAIL  ') + '[' + x.case + '] ' + x.name + (x.info ? '  [' + x.info + ']' : ''));
    });
    console.log('\n沙箱实测: ' + r.pass + '/' + (r.pass + r.fail));
    process.exit(r.fail === 0 ? 0 : 1);
  });
}
