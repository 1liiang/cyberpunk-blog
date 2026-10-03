'use strict';
/* ============================================================
   tests/cases/02-b-文章详情.js — B 文章详情
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L58-74
   独立运行：node tests/cases/02-b-文章详情.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { bootDom, waitFor, FIXTURES, ROOT } = require('../common');
const fs = require('fs');
const path = require('path');

function pendingVendors(ctx) {
  return Array.from(ctx.doc.querySelectorAll('script[src*="js/vendor/"]'))
    .filter(function (script) { return typeof script.onload === 'function'; });
}

function finishVendors(ctx, scripts, fail) {
  scripts.forEach(function (script) {
    if (fail) script.onerror(new ctx.w.Event('error'));
    else {
      const file = script.getAttribute('src').split('?')[0];
      ctx.w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      script.onload(new ctx.w.Event('load'));
    }
  });
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 B：文章详情（full 图） ================= */
  {
    const ctx = bootDom({ url: 'https://x.test/#/post/1' });
    await waitFor(function () {
      return ctx.doc.querySelector('.post-cover') && ctx.doc.querySelector('#md-target img');
    }, 3000);
    const okFull = await waitFor(function () {
      const img = ctx.doc.querySelector('#md-target img');
      return img && /^data:image\/jpeg;base64,FULLB64JPEG2$/.test(img.getAttribute('src') || '');
    }, 3000);
    T('B 文章详情', 'R21 正文图使用原图 data URL', okFull);
    const okCover = await waitFor(function () {
      const cover = ctx.doc.querySelector('.post-cover');
      return cover && /FULLB64PNG1/.test(cover.style.backgroundImage || '');
    }, 3000);
    T('B 文章详情', 'R21b 详情页封面使用原图', okCover);
    const previewImage = ctx.doc.querySelector('#md-target img');
    previewImage.focus();
    previewImage.dispatchEvent(new ctx.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const preview = ctx.doc.querySelector('#neon-modal .image-preview img');
    if (preview) preview.click();
    T('B 文章详情', 'R21g 正文图片可由键盘打开并切换原始尺寸',
      !!preview && preview.src === previewImage.src && preview.classList.contains('is-original') &&
      preview.getAttribute('aria-pressed') === 'true');
    ctx.doc.dispatchEvent(new ctx.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    T('B 文章详情', 'R21h Escape关闭图片预览并归还焦点',
      !ctx.doc.getElementById('neon-modal') && ctx.doc.activeElement === previewImage);
    ctx.dom.window.close();
  }

  /* A → B → A：hash 再次相同也不能把第一轮 A 的数据写到第二轮。 */
  {
    const ctx = bootDom({ url: 'https://x.test/#/about' });
    await waitFor(function () { return ctx.doc.querySelector('.about-card'); }, 3000);
    const pending = [];
    ctx.w.NEON.Posts.get = function () {
      return new Promise(function (resolve) { pending.push(resolve); });
    };
    ctx.w.location.hash = '#/post/1';
    await waitFor(function () { return pending.length === 1; }, 1000);
    ctx.w.location.hash = '#/about';
    await waitFor(function () { return ctx.doc.querySelector('.about-card'); }, 1000);
    ctx.w.location.hash = '#/post/1';
    await waitFor(function () { return pending.length === 2; }, 1000);
    pending[1](Object.assign({}, FIXTURES.posts[0], { title: '当前文章响应' }));
    await waitFor(function () { return /当前文章响应/.test(ctx.doc.getElementById('app').textContent); }, 1000);
    pending[0](Object.assign({}, FIXTURES.posts[0], { title: '过期文章响应' }));
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
    const text = ctx.doc.getElementById('app').textContent;
    T('B 文章详情', 'R21c 返回同一文章时只采用最新一轮请求', /当前文章响应/.test(text) && !/过期文章响应/.test(text));
    ctx.dom.window.close();
  }

  /* 首次访问时真实库尚未加载：完成后必须把正文和工具写入当前页。 */
  {
    const ctx = bootDom({ url: 'https://x.test/#/post/3', noMarked: true, noPurify: true });
    await waitFor(function () { return pendingVendors(ctx).length >= 2; }, 1000);
    const scripts = pendingVendors(ctx);
    const sources = scripts.map(function (script) { return script.getAttribute('src'); });
    finishVendors(ctx, scripts, false);
    const rendered = await waitFor(function () {
      return ctx.doc.querySelector('#md-target h2') && ctx.doc.querySelector('#post-toc .toc-link') &&
        ctx.doc.querySelector('#md-target .code-copy');
    }, 1000);
    T('B 文章详情', 'R21d 首次载入真实Markdown库后显示正文目录和复制按钮并复用现有高亮库',
      rendered && scripts.length === 2 && sources.every(function (src) { return src.endsWith('?v=' + BUILD); }) &&
      !sources.some(function (src) { return /highlight/.test(src); }), sources.join(', '));
    ctx.dom.window.close();
  }

  {
    const raw = '<img id="untrusted-markup" src="x" onerror="alert(1)">';
    const fixtures = Object.assign({}, FIXTURES, { posts: FIXTURES.posts.map(function (post) {
      return post.id === 3 ? Object.assign({}, post, { content: raw }) : post;
    }) });
    const ctx = bootDom({ url: 'https://x.test/#/post/3', noMarked: true, noPurify: true, fixtures: fixtures });
    await waitFor(function () { return pendingVendors(ctx).length >= 2; }, 1000);
    finishVendors(ctx, pendingVendors(ctx), true);
    const fallback = await waitFor(function () {
      const target = ctx.doc.getElementById('md-target');
      return target && /仅显示纯文本/.test(target.textContent) && target.textContent.indexOf(raw) !== -1;
    }, 1000);
    T('B 文章详情', 'R21e Markdown库失败时展示转义后的纯文本', fallback && !ctx.doc.getElementById('untrusted-markup'));
    ctx.dom.window.close();
  }

  {
    const ctx = bootDom({ url: 'https://x.test/#/post/3', noMarked: true, noPurify: true });
    await waitFor(function () { return pendingVendors(ctx).length >= 2; }, 1000);
    const scripts = pendingVendors(ctx);
    ctx.w.location.hash = '#/about';
    await waitFor(function () { return ctx.doc.querySelector('.about-card'); }, 1000);
    const current = ctx.doc.querySelector('.about-card');
    finishVendors(ctx, scripts, false);
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
    T('B 文章详情', 'R21f Markdown加载期间切页不会被正文回填覆盖',
      !!current && ctx.doc.querySelector('.about-card') === current && !ctx.doc.getElementById('md-target'));
    ctx.dom.window.close();
  }

  /* 阅读偏好在本机保存；换文后恢复，默认正文不显示段落行号。 */
  {
    const ctx = bootDom({ url: 'https://x.test/#/post/3' });
    await waitFor(function () { return ctx.doc.getElementById('ln-toggle'); }, 1000);
    const line = ctx.doc.getElementById('ln-toggle');
    const defaults = line && line.getAttribute('aria-pressed') === 'false' &&
      ctx.doc.body.classList.contains('linenum-off');
    ctx.doc.querySelector('[data-reading-size="large"]').click();
    ctx.doc.querySelector('[data-reading-width="wide"]').click();
    line.click();
    ctx.w.location.hash = '#/about';
    await waitFor(function () { return ctx.doc.querySelector('.about-card'); }, 1000);
    ctx.w.location.hash = '#/post/3';
    await waitFor(function () { return ctx.doc.getElementById('ln-toggle'); }, 1000);
    T('B 文章详情', 'R21i 阅读默认无行号，字号宽度和显式行号选择换页后恢复',
      defaults && ctx.doc.body.getAttribute('data-reading-size') === 'large' &&
      ctx.doc.body.getAttribute('data-reading-width') === 'wide' &&
      !ctx.doc.body.classList.contains('linenum-off') &&
      ctx.doc.getElementById('ln-toggle').getAttribute('aria-pressed') === 'true' &&
      ctx.w.localStorage.getItem('neon_reading_size') === 'large' &&
      ctx.w.localStorage.getItem('neon_reading_width') === 'wide' &&
      ctx.w.localStorage.getItem('neon_linenum') === '1');
    ctx.dom.window.close();
  }

  /* 窄屏目录默认折叠，展开与选章不会把目录锚点当成站点路由。 */
  {
    const ctx = bootDom({ url: 'https://x.test/#/about' });
    await waitFor(function () { return ctx.doc.querySelector('.about-card'); }, 1000);
    ctx.w.matchMedia = function (query) {
      return { matches: query === '(max-width: 768px)', addEventListener: function () {},
        removeEventListener: function () {}, addListener: function () {}, removeListener: function () {} };
    };
    ctx.w.location.hash = '#/post/3';
    await waitFor(function () { return ctx.doc.querySelector('.toc-toggle'); }, 1000);
    const toggle = ctx.doc.querySelector('.toc-toggle');
    const list = ctx.doc.getElementById('post-toc-list');
    const initiallyClosed = toggle && toggle.getAttribute('aria-expanded') === 'false' && list.hidden;
    toggle.click();
    const opened = toggle.getAttribute('aria-expanded') === 'true' && !list.hidden;
    ctx.doc.querySelector('.toc-link').click();
    T('B 文章详情', 'R21j 手机目录可展开并在选章后收起，正文路由保持不变',
      initiallyClosed && opened && list.hidden && toggle.getAttribute('aria-expanded') === 'false' &&
      ctx.w.location.hash === '#/post/3' && !!ctx.doc.querySelector('.toc-link.active'));
    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "B 文章详情" };

standalone(module, run);
