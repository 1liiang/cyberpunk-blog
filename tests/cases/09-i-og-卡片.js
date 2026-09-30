'use strict';
/* ============================================================
   tests/cases/09-i-og-卡片.js — I OG 卡片
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L217-240
   独立运行：node tests/cases/09-i-og-卡片.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');
const fs = require('fs');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 I：C5 OG 分享卡片 ================= */
  {
    const need_ = [
      ['og:type', /<meta\s+property="og:type"\s+content="[^"]+"/],
      ['og:title', /<meta\s+property="og:title"\s+content="[^"]+"/],
      ['og:description', /<meta\s+property="og:description"\s+content="[^"]+"/],
      ['og:image', /<meta\s+property="og:image"\s+content="https:\/\/[^"]+"/],
      ['og:url', /<meta\s+property="og:url"\s+content="https:\/\/[^"]+"/],
      ['twitter:card', /<meta\s+name="twitter:card"\s+content="summary_large_image"/]
    ];
    need_.forEach(function (pair) {
      const m = pair[1].exec(SRC.html);
      T('I OG 卡片', 'R27 ' + pair[0] + ' 已声明', !!m, m ? 'ok' : '缺失');
    });
    /* og:image 必须指向真实存在的本地资源 */
    const imgM = /<meta\s+property="og:image"\s+content="https:\/\/[^"]+\/([^"\/]+)"/.exec(SRC.html);
    const imgName = imgM ? imgM[1] : null;
    const imgPath = imgName ? require('path').join(require('../common').ROOT, 'assets', imgName) : null;
    const imgExists = imgPath ? fs.existsSync(imgPath) : false;
    T('I OG 卡片', 'R27b og:image 指向的本地文件存在', imgExists, imgName || '未解析');
    if (imgExists) {
      const sz = fs.statSync(imgPath).size;
      T('I OG 卡片', 'R27c og:image 体积 < 400KB（利于抓取）', sz < 400 * 1024, Math.round(sz / 1024) + 'KB');
    }
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "I OG 卡片" };

standalone(module, run);
