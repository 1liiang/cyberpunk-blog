'use strict';
/* ============================================================
   tests/cases/12-l-图片收口.js — L 图片收口
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L368-406
   独立运行：node tests/cases/12-l-图片收口.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 L：A3 post_images 收口 ================= */
  {
    /* 读走视图、写走基表 —— 这是 A3 的核心接口约定 */
    T('L 图片收口', 'R31 读取通道指向视图 public_images',
      SRC.cloud.indexOf("IMAGE_READ_TABLE = 'public_images'") !== -1);
    T('L 图片收口', 'R31b 写入通道仍为基表 post_images',
      SRC.cloud.indexOf("IMAGE_WRITE_TABLE = 'post_images'") !== -1);
    /* 视图不得暴露 owner_id / storage_path */
    T('L 图片收口', 'R32 读取不 select owner_id',
      !/IMAGE_READ_TABLE\)[\s\S]{0,120}?owner_id/.test(SRC.cloud));
    T('L 图片收口', 'R32b 读取不 select storage_path',
      !/IMAGE_READ_TABLE\)[\s\S]{0,120}?storage_path/.test(SRC.cloud));
    /* MIME 纵深防御：前端不信任库内 content_type */
    T('L 图片收口', 'R33 前端 MIME 白名单校验存在',
      SRC.cloud.indexOf('SAFE_MIME') !== -1 && /image\\\/\(jpeg\|png\|gif\|webp\)/.test(SRC.cloud));
    T('L 图片收口', 'R33b toDataUrl 经 safeMime 过滤',
      /function toDataUrl[\s\S]{0,200}?safeMime\(/.test(SRC.cloud));
    T('L 图片收口', 'R33c 封面选择器同样做 MIME 白名单',
      /SAFE_MIME[\s\S]{0,300}?content_type/.test(SRC.app));

    /* 行为验证：视图桩不含 owner_id，前端若误读会拿到 undefined
       ⚠ D3 拆分暴露的隐性缺陷：这个 IIFE 原先【没有 await】，两条断言（R34/R34b）
       是靠「后面还有一堆慢 case，微任务赶在 return 前跑完」才碰巧落进 results 的。
       一旦拆成独立文件（run() 立刻返回），它们就被静默丢掉 —— 453 变 451。
       凡异步断言必须 await，不能赌时序。 */
    await (async function () {
      const ctx = bootDom({ skipApp: true });
      const NEON = ctx.w.NEON;
      const m = await NEON.Images.fetchMany([1, 2]);
      T('L 图片收口', 'R34 经视图正常取到图片 data URL',
        m.size === 2 && /^data:image\/png;base64,THUMBB64PNG|^data:image\/png;base64,FULLB64PNG1/.test(m.get(1) || ''),
        'size=' + m.size + ' id1=' + String(m.get(1)).slice(0, 28));
      const q = ctx.queries.filter(function (x) { return x.table === 'public_images'; });
      T('L 图片收口', 'R34b 查询确实打到视图而非基表',
        q.length > 0 && ctx.queries.every(function (x) {
          return x.table !== 'post_images' || x.kind === 'insert';
        }), '视图查询 ' + q.length + ' 次');
      ctx.dom.window.close();
    })();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "L 图片收口" };

standalone(module, run);
