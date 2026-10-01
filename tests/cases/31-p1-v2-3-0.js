'use strict';
/* ============================================================
   tests/cases/31-p1-v2-3-0.js — P1 v2.3.0（C1 / F1 / E1 / E2 / A3 / E3）

   对应 v2.3.0 的 P1 批次六项（原《UI优化建议.md》已随历史归档清理）：
     · C1  全局字号 15→16 / 15.5→16.5 / 摘要 14→14.5
     · F1  卡片键盘可达（tabindex+role+aria-label + Enter/Space 代理）
     · E1  强 hover 包 @media(hover:hover)（12 组，原地包裹）
     · E2  触控热区（tag-chip padding 微增 + 移动端 nav padding）
     · A3  窄屏编辑器「输入/预览」切换（.ed-switch + data-ed-view）
     · E3  load-more 等待态（.loading + ▚ LOADING + disabled）

   写法原则（同 29/30 号 D3 守则）：行为 > 语义 > 字面；每条可反向验证。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments, stripJsLineComments, cssRuleBody } = require('../common');

/* 顶层规则遍历器：返回 [{sel, body}]（与 30 号同一实现） */
function topLevelRules(css) {
  const out = [];
  const re = /(^|\})\s*([^{}]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const open = re.lastIndex;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    out.push([m[2], css.slice(open, close)]);
    re.lastIndex = close;
  }
  return out;
}

/* @media 块提取：[{cond, body}]（支持嵌套 { 计数） */
function mediaBlocks(css, cond) {
  const re = /@media([^{]*)\{/g;
  const out = [];
  let m;
  while ((m = re.exec(css))) {
    if (cond && !cond(m[1])) { continue; }
    let depth = 1, i = re.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push({ cond: m[1].trim(), body: css.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);

  /* ================= C1：全局字号 ================= */
  {
    const bodyRule = topLevelRules(css).filter(function (r) {
      return /(^|[\s,])body(?![\w-])/.test(r[0]) && /font-size/.test(r[1]);
    });
    T('C1 全局字号', 'R98 body 15→16px（全站基字号上探一档）',
      bodyRule.some(function (r) { return /font-size\s*:\s*16px/.test(r[1]); }),
      bodyRule.map(function (r) { return r[1].match(/font-size\s*:\s*[^;]+/); }).join(' | '));

    const mdb = cssRuleBody(css, '.md-body');
    T('C1 全局字号', 'R98b .md-body 15.5→16.5px 且 A1 限宽仍在（同批回归）',
      mdb !== null && /font-size\s*:\s*16\.5px/.test(mdb) &&
      /max-width\s*:\s*(760px|var\(--w-read\))/.test(mdb) &&
      /--w-read\s*:\s*760px/.test(css),
      mdb === null ? '未找到 .md-body' : 'ok');

    const sum = cssRuleBody(css, '.post-card .card-summary');
    T('C1 全局字号', 'R98c 卡片摘要 14→14.5px',
      sum !== null && /font-size\s*:\s*14\.5px/.test(sum),
      sum === null ? '未找到 .card-summary' : 'ok');
  }

  /* ================= F1：卡片键盘可达（行为） ================= */
  {
    const html = bootDom({ skipApp: true }).w.NEONViews.homeView({
      posts: [{ id: 7, title: '键盘可达<m>测试', summary: 's', tags: [], cover_ref: null,
        status: 'published', created_at: '2026-09-28T10:00:00+08:00' }],
      total: 1, hasMore: false
    });
    T('F1 卡片键盘可达', 'R99 卡片带 tabindex=0 / role=link / aria-label（标题经 esc 转义）',
      /<article class="post-card"[^>]*tabindex="0"[^>]*role="link"[^>]*aria-label="阅读：键盘可达&lt;m&gt;测试"/.test(String(html)) ||
      /<article class="post-card"[^>]*aria-label="阅读：键盘可达&lt;m&gt;测试"[^>]*tabindex="0"/.test(String(html)),
      '未命中可访问性三件套');

    const a = stripJsLineComments(stripComments(SRC.app));
    T('F1 卡片键盘可达', 'R99b keydown 代理有 e.target !== card 守卫（不抢卡内 <a> 的原生导航）',
      /key\s*!==\s*'Enter'\s*&&\s*e\.key\s*!==\s*' '/.test(a) &&
      /e\.target\s*!==\s*card/.test(a) &&
      /#\/post\/' \+ card\.getAttribute\('data-id'\)/.test(a),
      'keydown 代理结构未命中');
  }
  await (async function () {
    /* 端到端：真渲染首页 → 卡片上派发 Enter → hash 应跳到对应文章 */
    const ctx = bootDom({ url: 'https://x.test/#/' });
    const ok = await waitFor(function () {
      return !!ctx.doc.querySelector('.post-card');
    }, 3000);
    if (!ok) {
      T('F1 卡片键盘可达', 'R99c 端到端：Enter 激活卡片跳转', false, '首页未渲染出卡片');
      ctx.dom.window.close();
    } else {
      const card = ctx.doc.querySelector('.post-card');
      const id = card.getAttribute('data-id');
      card.dispatchEvent(new ctx.w.KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true
      }));
      const jumped = await waitFor(function () {
        return ctx.w.location.hash === '#/post/' + id;
      }, 3000);
      T('F1 卡片键盘可达', 'R99c 端到端：Enter 激活卡片跳转（与点击同路由）',
        jumped, 'hash="' + ctx.w.location.hash + '" 期望 "#/post/' + id + '"');
      ctx.dom.window.close();
    }
  })();

  /* ================= E1：强 hover 隔离触屏 ================= */
  {
    const hoverBlocks = mediaBlocks(css, function (c) { return /hover:\s*hover/.test(c); });
    T('E1 hover 隔离', 'R100 @media(hover:hover) 块 ≥12 组（强 hover 全部入媒体）',
      hoverBlocks.length >= 12, '实际 ' + hoverBlocks.length + ' 组');

    const joined = hoverBlocks.map(function (b) { return b.body; }).join('\n');
    T('E1 hover 隔离', 'R100b 三大核心位移/发光/动画都在媒体内（卡片上浮 / logo 故障 / 按钮辉光）',
      /translateY\(-3px\)/.test(joined) && /glitch-skew/.test(joined) && /var\(--glow-cyan\)/.test(joined),
      '核心规则有裸露在媒体外者');

    /* 去掉所有 media 块体后，强 hover 规则不得残留（原地包裹，没有复制粘贴的裸副本）。
       特征串必须带 animation:/transform: 前缀 —— @keyframes glitch-skew 的
       【定义】永远在媒体块外，裸钉 "glitch-skew" 会永远误报。 */
    let rest = css;
    hoverBlocks.concat(mediaBlocks(css)).forEach(function (b) { rest = rest.split(b.body).join(''); });
    T('E1 hover 隔离', 'R100c 强 hover 规则无裸露副本（translateY(-3px)/glitch 动画引用只存在于媒体内）',
      !/transform:\s*translateY\(-3px\)/.test(rest) && !/animation:\s*glitch-skew/.test(rest),
      '媒体外仍有裸露强 hover');

    /* 键盘焦点态必须留在媒体外 —— E1 不得误伤 :focus-within */
    T('E1 hover 隔离', 'R100d .post-card:focus-within 角标提亮仍在媒体外（键盘可达性不受 E1 影响）',
      /@media[^{]*\{[^{]*$/.test('') || topLevelRules(css).some(function (r) {
        return /focus-within/.test(r[0]) && /opacity:\s*0\.65/.test(r[1]);
      }), 'focus-within 规则缺失或被误包');
  }

  /* ================= E2：触控热区 ================= */
  {
    const chip = cssRuleBody(css, '.tag-chip');
    T('E2 触控热区', 'R101 .tag-chip padding 4.5px 12px（clip-path 裁掉伪元素外扩，热区只能靠本体）',
      chip !== null && /padding\s*:\s*4\.5px\s+12px/.test(chip),
      chip === null ? '未找到 .tag-chip' : (chip.match(/padding[^;]+;/) || ['?'])[0]);

    /* v3.5.0：断点收敛（720→768），采样跟着改 —— 判据本身不变 */
    const navMobile = mediaBlocks(css, function (c) { return /max-width:\s*768px/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    T('E2 触控热区', 'R101b 移动端 .nav a padding 8px 12px（原 6px 8px ≈ 26px 高）',
      /\.nav a\s*\{[^}]*padding\s*:\s*8px\s+12px/.test(navMobile), '768px 媒体块内未命中');
  }

  /* ================= A3：窄屏编辑器「输入/预览」切换 ================= */
  {
    const html = String(bootDom({ skipApp: true }).w.NEONViews.editView({ postId: null, post: null }));
    T('A3 编辑器切换', 'R102 editView 带 ed-switch（tablist + 输入/预览两 tab）且 grid 默认 data-ed-view="input"',
      /id="ed-switch"[^>]*role="tablist"/.test(html) &&
      /data-ed-view="input"/.test(html) && /data-ed-view="preview"/.test(html) &&
      /class="editor-grid" data-ed-view="input"|<div class="editor-grid" data-ed-view="input">/.test(html),
      'ed-switch 结构未命中');

    /* v3.5.0：断点收敛（1000→1024） */
    const mNarrow = mediaBlocks(css, function (c) { return /max-width:\s*1024px/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    T('A3 编辑器切换', 'R102b CSS：.ed-switch 桌面隐藏、媒体内显示 + 双 pane 显隐规则齐备',
      topLevelRules(css).some(function (r) {
        return /(^|[\s,])\.ed-switch(?![\w-])/.test(r[0]) && /display:\s*none/.test(r[1]);
      }) && /display:\s*flex/.test(mNarrow) &&
      /data-ed-view="input"/.test(mNarrow) && /data-ed-view="preview"/.test(mNarrow),
      'CSS 显隐规则未命中');
  }
  await (async function () {
    /* 端到端：进编辑页 → 点「预览」tab → grid 属性 + active/aria-selected 联动 */
    const ctx = bootDom({ url: 'https://x.test/#/edit', skipApp: true });
    ctx.w.NEON.Auth.getSession = async function () {
      return { data: { user: { id: 'u1', email: 'u1@x.test' } }, error: null };
    };
    ctx.w.eval(SRC.app);
    const ready = await waitFor(function () {
      return !!ctx.doc.getElementById('editor-textarea');
    }, 3000);
    if (!ready) {
      T('A3 编辑器切换', 'R102c 端到端：点「预览」切换 pane', false, '编辑页未进入');
      ctx.dom.window.close();
      return;
    }
    const grid = ctx.doc.querySelector('.editor-grid');
    const btns = ctx.doc.querySelectorAll('#ed-switch button[data-ed-view]');
    const previewBtn = Array.prototype.filter.call(btns, function (b) {
      return b.getAttribute('data-ed-view') === 'preview';
    })[0];
    previewBtn.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true }));
    const activeBtn = Array.prototype.filter.call(btns, function (b) { return b.classList.contains('active'); })[0];
    T('A3 编辑器切换', 'R102c 端到端：点「预览」→ grid 转 preview + active/aria-selected 联动',
      grid.getAttribute('data-ed-view') === 'preview' &&
        activeBtn === previewBtn && previewBtn.getAttribute('aria-selected') === 'true',
      'grid=' + grid.getAttribute('data-ed-view'));
    ctx.dom.window.close();
  })();

  /* ================= E3：load-more 等待态 ================= */
  {
    const lm = cssRuleBody(css, '.btn.loading');
    T('E3 等待态', 'R103 .btn.loading 等待态样式（置灰 + 不可点 + wait 光标）',
      lm !== null && /opacity/.test(lm) && /pointer-events:\s*none/.test(lm) && /cursor:\s*wait/.test(lm),
      lm === null ? '未找到 .btn.loading' : 'ok');

    const app = stripJsLineComments(stripComments(SRC.app));
    T('E3 等待态', 'R103b 点击处理含防重入守卫 + ▚ LOADING 文字 + disabled（重建后自动恢复）',
      /contains\('loading'\)\s*\)\s*return/.test(app) &&
      /'▚ LOADING'/.test(app) && /lm\.disabled\s*=\s*true/.test(app),
      'loading 处理结构未命中');
  }
  await (async function () {
    /* 端到端：委托监听在 document，body 里自造按钮派发 click ——
       同步段应立即置等待态（真实请求在后台走桩，完成后 innerHTML 重建恢复） */
    const ctx = bootDom({ url: 'https://x.test/#/' });
    await waitFor(function () { return ctx.doc.querySelector('.post-list, .empty-state'); }, 3000);
    const btn = ctx.doc.createElement('button');
    btn.className = 'btn';
    btn.id = 'btn-load-more';
    btn.textContent = '加载更多信号 ▾';
    ctx.doc.body.appendChild(btn);
    btn.dispatchEvent(new ctx.w.Event('click', { bubbles: true }));
    T('E3 等待态', 'R103c 端到端：点击后同步进入等待态（▚ LOADING + disabled + .loading）',
      btn.classList.contains('loading') && btn.disabled === true && btn.textContent === '▚ LOADING',
      'loading="' + btn.classList.contains('loading') + '" text="' + btn.textContent + '"');
    /* 关窗前必须先等在途的 loadHome(true) 落地。
       jsdom 的 window.close() 会把 window.document 置为 undefined，
       而这次点击触发的 loadHome(true) 是 async：续段（append 分支的
       document.querySelector('.post-list')）在关窗后才恢复执行 ⇒
       TypeError 逃逸成【未处理 Promise 拒绝】⇒ Node 默认策略直接终止进程，
       整条门禁 exit 1（断言数却照样 1106/1106，极具迷惑性）。
       桩数据全部走 Promise.resolve，一个宏任务边界足以排空整条微任务链。 */
    await new Promise(function (r) { setTimeout(r, 0); });
    ctx.dom.window.close();
  })();

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "P1 v2.3.0" };

standalone(module, run);
