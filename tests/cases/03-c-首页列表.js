'use strict';
/* ============================================================
   tests/cases/03-c-首页列表.js — C 首页列表
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L77-105
   独立运行：node tests/cases/03-c-首页列表.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { bootDom, waitFor, FIXTURES } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 C：首页列表（B1 缩略图） ================= */
  {
    const ctx = bootDom({ url: 'https://x.test/#/' });
    await waitFor(function () { return ctx.doc.querySelectorAll('[data-cover]').length >= 2; }, 3000);
    const okThumb = await waitFor(function () {
      const covers = ctx.doc.querySelectorAll('.card-cover');
      return covers.length >= 2;
    }, 3000);
    /* 等 hydrate 完成（data-cover 属性被移除即完成） */
    await waitFor(function () {
      return ctx.doc.querySelectorAll('[data-cover]').length === 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 100); });

    /* A3：读通道应走视图 public_images（不含 owner_id），写通道仍为基表 */
    const imgQueries = ctx.queries.filter(function (q) { return q.table === 'public_images' && q.kind === 'select'; });
    const covers = ctx.doc.querySelectorAll('.card-cover');
    const bg = covers.length >= 2 ? covers[0].style.backgroundImage : '';
    const bg2 = covers.length >= 2 ? covers[1].style.backgroundImage : '';

    T('C 首页列表', 'R20 新图封面用缩略图数据', /THUMBB64PNG/.test(bg), bg.slice(0, 60));
    T('C 首页列表', 'R20b 图片查询 select 含 thumb 列',
      imgQueries.some(function (q) { return String(q.fields || '').indexOf('thumb') !== -1; }),
      imgQueries.map(function (q) { return q.fields; }).join(' | '));
    T('C 首页列表', 'R22 旧图无 thumb 回退原图', /FULLB64JPEG2/.test(bg2), bg2.slice(0, 60));
    /* 为什么钉"含 data 列"而不是钉 select 字面量：
       v2.2.0 B3 给完整图查询补了 width,height，原来是 `q.fields === 'id,content_type,data'`
       这种全等比较 —— 加一列就红，但它想守的是"回退确实走了取原图的查询"。
       语义是"取了 data 列"（缩略图查询取的是 thumb），钉这个才不会被无害的列变更打断。 */
    T('C 首页列表', 'R22b 回退走了完整图查询',
      imgQueries.some(function (q) { return /(^|,)data(,|$)/.test(String(q.fields || '')); }),
      imgQueries.map(function (q) { return q.fields; }).join(' | '));
    ctx.dom.window.close();
  }

  /* 首页异步首屏和加载更多只替换列表，保留正在使用的全息面板。 */
  {
    const ctx = bootDom({ url: 'https://x.test/#/about', storage: { neon_radio_pick: '2:2003621098' } });
    await waitFor(function () { return ctx.doc.querySelector('.about-card'); }, 3000);
    const pending = [];
    ctx.w.NEON.Posts.listPublished = function () {
      return new Promise(function (resolve) { pending.push(resolve); });
    };
    ctx.w.location.hash = '#/';
    await waitFor(function () { return pending.length === 1; }, 1000);
    const hero = ctx.doc.querySelector('.holo-hero');
    const iframe = ctx.doc.querySelector('[data-radio-shell] iframe');
    const frameWindow = iframe && iframe.contentWindow;
    /* 首批只有一篇无封面文章，追加带封面的文章也不能更换主卡。 */
    const firstPost = Object.assign({}, FIXTURES.posts[0], { cover_ref: null });
    pending[0]({ posts: [firstPost], total: 3 });
    await waitFor(function () { return ctx.doc.getElementById('btn-load-more'); }, 1000);
    const featuredId = ctx.doc.querySelector('.block-featured .post-card').getAttribute('data-id');
    const firstKept = hero === ctx.doc.querySelector('.holo-hero') && iframe === ctx.doc.querySelector('[data-radio-shell] iframe');
    ctx.doc.getElementById('btn-load-more').click();
    await waitFor(function () { return pending.length === 2; }, 1000);
    pending[1]({ posts: [FIXTURES.posts[1], FIXTURES.posts[2]], total: 3 });
    await waitFor(function () { return ctx.doc.querySelectorAll('#home-content .post-card').length === 3; }, 1000);
    T('C 首页列表', 'R22c 首页追加保留主卡、面板及播放器浏览上下文',
      firstKept && !!iframe && iframe.isConnected && hero === ctx.doc.querySelector('.holo-hero') &&
      iframe === ctx.doc.querySelector('[data-radio-shell] iframe') && iframe.contentWindow === frameWindow &&
      featuredId === String(firstPost.id) && ctx.doc.querySelector('.block-featured .post-card').getAttribute('data-id') === featuredId &&
      ctx.doc.querySelectorAll('#home-content .post-card').length === 3);
    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "C 首页列表" };

standalone(module, run);
