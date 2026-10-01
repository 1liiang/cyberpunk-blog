'use strict';
/* ============================================================
   tests/cases/02-b-文章详情.js — B 文章详情
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L58-74
   独立运行：node tests/cases/02-b-文章详情.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { bootDom, waitFor } = require('../common');

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
    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "B 文章详情" };

standalone(module, run);
