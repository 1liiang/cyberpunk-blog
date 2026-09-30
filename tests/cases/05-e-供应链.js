'use strict';
/* ============================================================
   tests/cases/05-e-供应链.js — E 供应链
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L129-160
   独立运行：node tests/cases/05-e-供应链.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');
const fs = require('fs');
const crypto = require('crypto');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 E：A1 供应链加固（静态断言） ================= */
  {
    const html = SRC.html;
    const LIBS = [
      { name: 'marked', url: 'marked@12.0.2/marked.min.js' },
      { name: 'dompurify', url: 'dompurify@3.4.16/dist/purify.min.js' },
      { name: 'highlight.js', url: 'cdn-assets@11.12.0/highlight.min.js' }
    ];
    LIBS.forEach(function (lib) {
      const re = new RegExp('<script[^>]*src="https://cdn\\.jsdelivr\\.net/npm/[^"]*' +
        lib.url.replace(/[@/.]/g, '\\$&') + '"[^>]*></script>');
      const m = re.exec(html);
      const tag = m ? m[0] : '';
      T('E 供应链', 'R16 ' + lib.name + ' 锁定精确版本', !!m, lib.url);
      T('E 供应链', 'R16b ' + lib.name + ' 带 SRI integrity', /integrity="sha384-[A-Za-z0-9+/=]{40,}"/.test(tag));
      T('E 供应链', 'R16c ' + lib.name + ' 带 crossorigin', /crossorigin="anonymous"/.test(tag));
    });
    T('E 供应链', 'R17 云 SDK 本地托管（js/vendor/）', html.indexOf('js/vendor/workbuddy-cloud-sdk.js') !== -1);
    T('E 供应链', 'R17b 不再加载 @dev 漂移标签资源', !/src="[^"]*@dev/.test(html));

    const vendorExists = fs.existsSync(SRC.vendorPath);
    let vendorSize = 0, readmeOk = false, readmeInfo = '';
    if (vendorExists) {
      vendorSize = fs.statSync(SRC.vendorPath).size;
      const buf = fs.readFileSync(SRC.vendorPath);
      const hash = crypto.createHash('sha384').update(buf).digest('base64');
      const readme = fs.existsSync(SRC.vendorReadme) ? fs.readFileSync(SRC.vendorReadme, 'utf8') : '';
      readmeOk = readme.indexOf('sha384-' + hash) !== -1 || readme.indexOf(hash) !== -1;
      readmeInfo = 'size=' + vendorSize;
    }
    T('E 供应链', 'R18 vendor SDK 文件存在且非空', vendorExists && vendorSize > 10000, readmeInfo);
    T('E 供应链', 'R19 vendor README 哈希与文件一致', readmeOk);
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "E 供应链" };

standalone(module, run);
