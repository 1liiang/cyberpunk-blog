'use strict';
/* ============================================================
   tests/cases/08-h-长度约束.js — H 长度约束
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L179-214
   独立运行：node tests/cases/08-h-长度约束.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 H：A4 库层长度约束（源码 + 约定断言） ================= */
  {
    /* R26 原断言是 `SRC.cloud.indexOf('post_images') !== -1` ——
       近乎恒真（cloud.js 必然提到这张表），把整个文件删了才会红，等于摆设。
       改为守一条真实不变量：**非分页的取数路径必须有硬上限**。
       listMine 不走 range 分页，若没有 limit，文章上千时会一次拉爆。 */
    const listMineSeg = (function () {
      const i = SRC.cloud.indexOf('listMine:');
      const j = SRC.cloud.indexOf('create:', i);
      return i !== -1 ? SRC.cloud.slice(i, j === -1 ? i + 1200 : j) : '';
    })();
    T('H 长度约束', 'R26 listMine 非分页取数带硬上限（防一次拉爆）',
      /\.limit\(\s*\d+\s*\)/.test(listMineSeg),
      (listMineSeg.match(/\.limit\([^)]*\)/) || ['(无 limit，危险)'])[0]);
    /* 前端 maxlength 仅为体验，库层才是边界：断言编辑器已收窄到设计表值以内 */
    T('H 长度约束', 'R26b 标题 maxlength <= 200',
      /id="ed-title"[^>]*maxlength="(\d+)"/.test(SRC.views) &&
      Number(/id="ed-title"[^>]*maxlength="(\d+)"/.exec(SRC.views)[1]) <= 200,
      (function () { const m = /id="ed-title"[^>]*maxlength="(\d+)"/.exec(SRC.views); return m ? 'maxlength=' + m[1] : '未找到'; })());
    T('H 长度约束', 'R26c 摘要 maxlength <= 500',
      /id="ed-summary"[^>]*maxlength="(\d+)"/.test(SRC.views) &&
      Number(/id="ed-summary"[^>]*maxlength="(\d+)"/.exec(SRC.views)[1]) <= 500,
      (function () { const m = /id="ed-summary"[^>]*maxlength="(\d+)"/.exec(SRC.views); return m ? 'maxlength=' + m[1] : '未找到'; })());
    /* R26d 曾钉死在 split 正则上：v2.0.0 把分隔符扩成中英文分号、并抽出
       normalizeTags() 后该正则咬空，直接 TypeError 崩掉整轮。
       改为钉 TAG_MAX 常量 —— 这才是「标签上限」的真正单一数据源。 */
    const tagMaxM = /var\s+TAG_MAX\s*=\s*(\d+)\s*;/.exec(SRC.app);
    T('H 长度约束', 'R26d 标签上限 <= 10（TAG_MAX 常量）',
      !!tagMaxM && Number(tagMaxM[1]) <= 10,
      tagMaxM ? 'TAG_MAX=' + tagMaxM[1] : '未找到 TAG_MAX');
    T('H 长度约束', 'R26e 单标签长度 <= 50（TAG_LEN_MAX 常量）',
      (function () {
        const m = /var\s+TAG_LEN_MAX\s*=\s*(\d+)\s*;/.exec(SRC.app);
        return !!m && Number(m[1]) > 0 && Number(m[1]) <= 50;
      })(),
      (function () { const m = /var\s+TAG_LEN_MAX\s*=\s*(\d+)\s*;/.exec(SRC.app); return m ? 'TAG_LEN_MAX=' + m[1] : '未找到'; })());
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "H 长度约束" };

standalone(module, run);
