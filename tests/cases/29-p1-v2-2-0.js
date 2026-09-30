'use strict';
/* ============================================================
   tests/cases/29-p1-v2-2-0.js — P1 v2.2.0（C8 / B3 / C11）

   对应《优化方案-v2.1规划.md》里 v2.2.0（P1 内容项）三条：
     · C8  404 页面包屑
     · B3  图片尺寸占位（防 CLS）
     · C11 编辑体验增强（状态反馈 + 快捷键）

   写法原则（同 D3 守则）：
     · 能跑真实行为的就不钉源码字面（行为 > 字样）
     · 必须钉源码的，钉【语义】而不是字符串全等
     · 每条断言都能反向验证：把修复摘掉它必须报红
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor, stripComments, stripJsLineComments, cssRuleBody } = require('../common');

/* 取面包屑末段：<div class="crumb">…▸ <b>XXX</b></div> */
function crumbTail(html) {
  const m = /<div class="crumb">[\s\S]*?<b>([^<]*)<\/b>/.exec(String(html || ''));
  return m ? m[1] : null;
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;

  /* ================= C8：404 页面包屑 ================= */
  {
    const ctx = bootDom({ skipApp: true });
    const Vv = ctx.w.NEONViews;
    const full = {
      id: 1, title: '拇指测试', summary: 's', tags: ['test'], cover_ref: null,
      status: 'published', owner_name: '漓江',
      created_at: '2026-09-27T10:00:00+08:00', content: 'x'
    };

    /* 直接调视图函数而不是等 DOM —— loading 态在真实流程里一闪而过，
       端到端根本抓不稳，而"loading 会不会误显示 404 文案"恰恰是最容易写错的一点。 */
    T('C8 404 面包屑', 'R91 无文章时面包屑末段为「信号丢失」',
      crumbTail(Vv.postView({ post: null, loading: false })) === '信号丢失',
      '"' + crumbTail(Vv.postView({ post: null, loading: false })) + '"');
    T('C8 404 面包屑', 'R91b 有文章时仍为「详情」',
      crumbTail(Vv.postView({ post: full, loading: false })) === '详情',
      '"' + crumbTail(Vv.postView({ post: full, loading: false })) + '"');
    T('C8 404 面包屑', 'R91c loading 保持中性「详情」（不先闪一下"信号丢失"）',
      crumbTail(Vv.postView({ post: null, loading: true })) === '详情',
      '"' + crumbTail(Vv.postView({ post: null, loading: true })) + '"');
    ctx.dom.window.close();
  }
  /* 端到端：真走一遍不存在的 id，确认落进 DOM 的是「信号丢失」而不是模板残留 */
  await (async function () {
    const ctx = bootDom({ url: 'https://x.test/#/post/999' });
    const ok = await waitFor(function () {
      const b = ctx.doc.querySelector('.crumb b');
      return b && b.textContent.trim() === '信号丢失';
    }, 3000);
    const b = ctx.doc.querySelector('.crumb b');
    T('C8 404 面包屑', 'R91d 真实 404 路由渲染出「信号丢失」', ok,
      b ? '"' + b.textContent.trim() + '"' : '未渲染');
    ctx.dom.window.close();
  })();

  /* ================= B3：图片尺寸占位 ================= */
  {
    /* 钉语义：凡是"取图"的查询（取 data 或 thumb），必须连尺寸一起取回来。
       不钉 select 字符串全等 —— R22b 已经因为加列红过一次，那是过脆断言。 */
    const c = stripComments(SRC.cloud);
    const sels = [];
    const re = /\.select\(\s*(?:'([^']*)'|"([^"]*)")/g;
    let mm;
    while ((mm = re.exec(c))) sels.push(mm[1] || mm[2]);
    const imgSels = sels.filter(function (s) { return /(^|,)(data|thumb)(,|$)/.test(s); });
    T('B3 图片占位', 'R92 取图查询都一并取回 width/height',
      imgSels.length >= 2 && imgSels.every(function (s) {
        return /(^|,)width(,|$)/.test(s) && /(^|,)height(,|$)/.test(s);
      }), imgSels.join(' | '));

    const body = cssRuleBody(stripComments(SRC.css), '.md-body img');
    /* 补了 width/height 却没有 height:auto 的话，max-width 收窄宽度而 height
       仍按属性原值生效 —— 图片会被拉变形。这条跟占位是一对，缺一不可。 */
    T('B3 图片占位', 'R92b .md-body img 有 height:auto（配占位防变形）',
      body !== null && /height\s*:\s*auto/.test(body),
      body === null ? '未找到规则' : 'ok');
  }
  await (async function () {
    /* 尺寸缓存：取到的要能查到，没取过的不能瞎编 */
    const ctx = bootDom({ skipApp: true });
    await ctx.w.NEON.Images.fetchMany([1, 2]);
    const d1 = ctx.w.NEON.Images.dims(1);
    T('B3 图片占位', 'R92c 取图后能查到真实尺寸',
      !!d1 && d1.width === 1280 && d1.height === 720, JSON.stringify(d1));
    T('B3 图片占位', 'R92d 未取过的图返回 null（宁缺勿错，不伪造尺寸）',
      ctx.w.NEON.Images.dims(404) === null, String(ctx.w.NEON.Images.dims(404)));
    ctx.dom.window.close();
  })();
  await (async function () {
    /* 端到端：post 1 正文是 ![](cloudimg://2)，图上应带 800×600 占位 */
    const ctx = bootDom({ url: 'https://x.test/#/post/1' });
    const ok = await waitFor(function () {
      const img = ctx.doc.querySelector('#md-target img');
      return img && img.getAttribute('width') === '800' && img.getAttribute('height') === '600';
    }, 3000);
    const img = ctx.doc.querySelector('#md-target img');
    T('B3 图片占位', 'R92e 正文 <img> 落地时带 width/height 占位', ok,
      img ? img.getAttribute('width') + '×' + img.getAttribute('height') : '无图');
    /* 读 IDL 属性而不是 getAttribute：规范里 decoding 是反射属性，真实浏览器
       两边都有；但 jsdom 30 只实现了 IDL 属性、没做反射（实测 prop=async /
       attr=null）。读属性在两种环境都成立，读 attribute 会在 jsdom 上假红。 */
    T('B3 图片占位', 'R92f 正文 <img> 设了 async 解码（解码不阻塞主线程）',
      !!img && img.decoding === 'async',
      img ? '"' + img.decoding + '"' : '无图');
    ctx.dom.window.close();
  })();

  /* ================= C11：编辑体验 ================= */
  {
    const h = bootDom({ skipApp: true }).w.NEONViews.editView({ postId: null, post: null });
    const m = /<span[^>]*id="ed-status"[^>]*>/.exec(String(h || ''));
    T('C11 编辑体验', 'R93 编辑器带状态位且有无障碍属性（role=status / aria-live）',
      !!m && /role="status"/.test(m[0]) && /aria-live="polite"/.test(m[0]),
      m ? m[0] : '未渲染 #ed-status');

    const a = stripJsLineComments(stripComments(SRC.app));
    /* 为什么必须挂在 textarea 上：keys.js 对任何 Ctrl/Alt/Meta 组合一律放行、
       输入态下除 Esc 外全部放手（C10 硬约束）。挂到 document/keys.js 上就
       等于抢了浏览器与系统的快捷键。改一个字即红，防的是"顺手挪到全局"。 */
    T('C11 编辑体验', 'R93b 编辑器快捷键挂在 textarea 上（不进全局键盘层）',
      /ta\.addEventListener\('keydown'/.test(a));
    const k = stripJsLineComments(stripComments(SRC.keys));
    T('C11 编辑体验', 'R93c 全局键盘层仍对修饰键组合一律放行',
      /ctrlKey\s*\|\|[\s\S]{0,40}altKey\s*\|\|[\s\S]{0,40}metaKey/.test(k));
  }
  await (async function () {
    /* 进编辑页需要会话 —— 桩默认匿名，这里给 Auth 打补丁再 eval app.js，
       走的是与线上完全一致的 renderEdit 路径（不是重写一份编辑器逻辑）。 */
    const ctx = bootDom({ url: 'https://x.test/#/edit', skipApp: true });
    ctx.w.NEON.Auth.getSession = async function () {
      return { data: { user: { id: 'u1', email: 'u1@x.test' } }, error: null };
    };
    ctx.w.eval(SRC.app);

    const ready = await waitFor(function () {
      return !!ctx.doc.getElementById('editor-textarea');
    }, 3000);
    T('C11 编辑体验', 'R93d 带会话可进入编辑器', ready);
    if (!ready) { ctx.dom.window.close(); return; }

    const ta = ctx.doc.getElementById('editor-textarea');
    const st = ctx.doc.getElementById('ed-status');

    /* 钉完整文案而不是"含 字符" —— 只测含字符的话，字数算错、上限写错都照样绿 */
    T('C11 编辑体验', 'R93e 进页即显示字数（不等第一次输入）',
      !!st && st.textContent === '0 / 200,000 字符',
      st ? '"' + st.textContent + '"' : '无状态位');

    function input(v) {
      ta.value = v;
      ta.dispatchEvent(new ctx.w.Event('input', { bubbles: true }));
    }
    /* 90% 起预警：原来是超限才报错，那时正文已经写完了 */
    input('x'.repeat(180000));
    T('C11 编辑体验', 'R93f 达 90% 时进入预警态（near-limit）',
      !!st && st.classList.contains('near-limit') && !st.classList.contains('over-limit'),
      st ? st.className : '');
    input('x'.repeat(200001));
    T('C11 编辑体验', 'R93g 超过上限时进入超限态（over-limit）',
      !!st && st.classList.contains('over-limit'), st ? st.className : '');

    function key(k, opts) {
      opts = opts || {};
      ta.dispatchEvent(new ctx.w.KeyboardEvent('keydown', {
        key: k, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
        bubbles: true, cancelable: true
      }));
    }
    ta.value = 'hello';
    ta.selectionStart = 0;
    ta.selectionEnd = 5;
    key('k', { ctrl: true });
    T('C11 编辑体验', 'R93h Ctrl/Cmd+K 包裹成链接',
      ta.value === '[hello](https://)', ta.value);

    ta.value = '';
    ta.selectionStart = ta.selectionEnd = 0;
    key('c', { ctrl: true, shift: true });
    T('C11 编辑体验', 'R93i Ctrl/Cmd+Shift+C 插入围栏代码块',
      /```[\s\S]*```/.test(ta.value), JSON.stringify(ta.value));

    /* 复制键绝不能被抢 —— 这是 C10「不抢浏览器快捷键」里代价最大的一条。
       少了 `&& e.shiftKey` 这个判据，Ctrl+C 就会把正文替换成代码块。 */
    ta.value = 'keepme';
    ta.selectionStart = ta.selectionEnd = 0;
    key('c', { ctrl: true });
    T('C11 编辑体验', 'R93j Ctrl/Cmd+C（不带 Shift）不改动正文（复制键未被抢）',
      ta.value === 'keepme', JSON.stringify(ta.value));

    ctx.dom.window.close();
  })();

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "P1 v2.2.0" };

standalone(module, run);
