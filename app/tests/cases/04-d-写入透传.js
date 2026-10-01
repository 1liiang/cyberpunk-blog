'use strict';
/* ============================================================
   tests/cases/04-d-写入透传.js — D 写入透传
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L108-126
   独立运行：node tests/cases/04-d-写入透传.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { bootDom } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 D：图片写入透传（cloud.js 插件层） ================= */
  {
    const ctx = bootDom({ skipApp: true });
    let captured = null;
    const NEON = ctx.w.NEON;
    /* 拦截 insert 落库前的 payload：直接调用 Images.insert，桩已记录 */
    let err = null;
    try {
      await NEON.Images.insert({
        content_type: 'image/png', data: 'FULLB64X', thumb: 'THUMBX',
        width: 1280, height: 720, size_bytes: 100, storage_path: null
      });
    } catch (e) { err = e; }
    const ins = ctx.queries.filter(function (q) { return q.table === 'post_images' && q.kind === 'insert'; });
    captured = ins.length ? ins[0].payload : null;
    T('D 写入透传', 'R23 Images.insert 透传 thumb 字段',
      !err && captured && captured.thumb === 'THUMBX' && captured.data === 'FULLB64X',
      err ? String(err) : (captured ? 'thumb=' + captured.thumb : '无 insert 记录'));
    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "D 写入透传" };

standalone(module, run);
