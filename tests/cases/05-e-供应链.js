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
    /* v4.8.1：三个库从 CDN 改为**本地托管**（js/vendor/）。
       判据随之从「CDN 精确版本 + SRI + crossorigin」改为「本地引用 + 不再走 CDN + 档案哈希」——
       每库仍 3 条断言，另新增 1 条"全站零外部脚本"（故本 case 由 13 条变 14 条，已重刷基线）。
       供应链加固的**意图**没变：版本锁死、字节可校验。 */
    const LIBS = [
      { name: 'marked', file: 'js/vendor/marked.min.js', pkg: 'marked@12.0.2', min: 20000 },
      { name: 'dompurify', file: 'js/vendor/dompurify.min.js', pkg: 'dompurify@3.4.16', min: 15000 },
      { name: 'highlight.js', file: 'js/vendor/highlight.min.js', pkg: 'cdn-assets@11.12.0', min: 80000 }
    ];
    const readmeSrc = fs.existsSync(SRC.vendorReadme) ? fs.readFileSync(SRC.vendorReadme, 'utf8') : '';
    LIBS.forEach(function (lib) {
      const localTag = new RegExp('<script[^>]*src="' + lib.file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\?v=[0-9.]+"').test(html);
      T('E 供应链', 'R16 ' + lib.name + ' 本地托管（js/vendor/ 带版本查询串）', localTag,
        localTag ? lib.file : '未引用本地文件');

      const stillCdn = html.indexOf('cdn.jsdelivr.net/npm/' + lib.pkg) !== -1;
      T('E 供应链', 'R16b ' + lib.name + ' 不再从 CDN 加载（无 jsdelivr 引用）', !stillCdn);

      const p = require('path').join(require('../common').ROOT, lib.file);
      let okSize = false, hashOk = false, size = 0;
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        size = buf.length;
        okSize = size > lib.min;
        hashOk = readmeSrc.indexOf('sha384-' + crypto.createHash('sha384').update(buf).digest('base64')) !== -1;
      }
      T('E 供应链', 'R16c ' + lib.name + ' 文件非空且 sha384 与 vendor 档案一致', okSize && hashOk,
        (size / 1024).toFixed(0) + 'KB' + (hashOk ? '' : '（档案哈希不符！）'));
    });
    T('E 供应链', 'R16d 全站零外部脚本（CSP script-src 不必再放开任何 CDN 域）',
      !/src="https:\/\//.test(html),
      /src="https:\/\//.test(html) ? '仍有外部 <script src>' : '全部本地');
    T('E 供应链', 'R17 数据层 SDK 本地托管（js/vendor/）', html.indexOf('js/vendor/supabase-js.js') !== -1);
    T('E 供应链', 'R17b 不再加载 @dev 漂移标签资源', !/src="[^"]*@dev/.test(html));

    const VENDORED = [
      { name: 'supabase-js', path: SRC.vendorPath, min: 100000 },
      { name: 'marked', path: require('path').join(require('../common').ROOT, 'js/vendor/marked.min.js'), min: 20000 },
      { name: 'dompurify', path: require('path').join(require('../common').ROOT, 'js/vendor/dompurify.min.js'), min: 15000 },
      { name: 'highlight.js', path: require('path').join(require('../common').ROOT, 'js/vendor/highlight.min.js'), min: 80000 }
    ];
    const readme = fs.existsSync(SRC.vendorReadme) ? fs.readFileSync(SRC.vendorReadme, 'utf8') : '';
    const missing = [];
    VENDORED.forEach(function (v) {
      if (!fs.existsSync(v.path) || fs.statSync(v.path).size <= v.min) { missing.push(v.name + ':文件缺失或过小'); return; }
      const hash = crypto.createHash('sha384').update(fs.readFileSync(v.path)).digest('base64');
      if (readme.indexOf('sha384-' + hash) === -1 && readme.indexOf(hash) === -1) missing.push(v.name + ':README 哈希不符');
    });
    T('E 供应链', 'R18 vendor 文件存在且非空（数据层 SDK + 三个渲染库各自成档）', missing.length === 0,
      missing.length ? missing.join(' / ') : VENDORED.map(function (v) { return v.name + '=' + fs.statSync(v.path).size; }).join(' '));
    T('E 供应链', 'R19 vendor README 哈希与文件一致', missing.filter(function (m) { return /README/.test(m); }).length === 0);
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "E 供应链" };

standalone(module, run);
