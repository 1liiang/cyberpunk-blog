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
    /* 数据层 SDK 本地托管：迁移到 Supabase 后，实际加载的是 supabase-js.js；
       原 WorkBuddy SDK 仍留在 vendor 目录作对照参考（下方 R18/R19 一并校验两者档案）。
       断言数不变 —— R17/R18/R19 各仍是一条。 */
    T('E 供应链', 'R17 数据层 SDK 本地托管（js/vendor/）', html.indexOf('js/vendor/supabase-js.js') !== -1);
    T('E 供应链', 'R17b 不再加载 @dev 漂移标签资源', !/src="[^"]*@dev/.test(html));

    const VENDORED = [
      { name: 'supabase-js', path: SRC.vendorPath.replace(/workbuddy-cloud-sdk\.js$/, 'supabase-js.js'), min: 100000 },
      { name: 'workbuddy-cloud-sdk', path: SRC.vendorPath, min: 10000 }
    ];
    const readme = fs.existsSync(SRC.vendorReadme) ? fs.readFileSync(SRC.vendorReadme, 'utf8') : '';
    const missing = [];
    VENDORED.forEach(function (v) {
      if (!fs.existsSync(v.path) || fs.statSync(v.path).size <= v.min) { missing.push(v.name + ':文件缺失或过小'); return; }
      const hash = crypto.createHash('sha384').update(fs.readFileSync(v.path)).digest('base64');
      if (readme.indexOf('sha384-' + hash) === -1 && readme.indexOf(hash) === -1) missing.push(v.name + ':README 哈希不符');
    });
    T('E 供应链', 'R18 vendor SDK 文件存在且非空（两个 SDK 各自成档）', missing.length === 0,
      missing.length ? missing.join(' / ') : VENDORED.map(function (v) { return v.name + '=' + fs.statSync(v.path).size; }).join(' '));
    T('E 供应链', 'R19 vendor README 哈希与文件一致', missing.filter(function (m) { return /README/.test(m); }).length === 0);
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "E 供应链" };

standalone(module, run);
