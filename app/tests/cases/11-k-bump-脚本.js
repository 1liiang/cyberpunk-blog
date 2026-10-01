'use strict';
/* ============================================================
   tests/cases/11-k-bump-脚本.js — K bump 脚本
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L313-365
   独立运行：node tests/cases/11-k-bump-脚本.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');
const fs = require('fs');
const path = require('path');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 K：D2 版本 bump 脚本 ================= */
  {
    const path = require('path');
    const bumpPath = path.join(require('../common').ROOT, 'tools', 'bump.js');
    const bumpSrc = fs.existsSync(bumpPath) ? fs.readFileSync(bumpPath, 'utf8') : '';
    T('K bump 脚本', 'R30 tools/bump.js 存在且非空', bumpSrc.length > 1000, bumpSrc.length + 'B');
    /* 脚本必须同时覆盖三处改动点，缺一即是设计表担心的「忘一处」 */
    T('K bump 脚本', 'R30b 覆盖 version.js 的 BUILD',
      /BUILD:\\s\*'\[\^'\]\*'/.test(bumpSrc) && bumpSrc.indexOf('buildNewVersionJs') !== -1);
    T('K bump 脚本', 'R30c 覆盖 LOG unshift 插入', /LOG:\\s\*\\\[\\n/.test(bumpSrc) && bumpSrc.indexOf('items: [') !== -1);
    T('K bump 脚本', 'R30d 覆盖 index.html 全部 ?v= 引用',
      /\\\?v=\[0-9\.\]\+/.test(bumpSrc) && bumpSrc.indexOf('buildNewHtml') !== -1);
    T('K bump 脚本', 'R30e 支持 --dry-run 预览（不写盘）',
      bumpSrc.indexOf('--dry-run') !== -1 && bumpSrc.indexOf('dryRun') !== -1);
    T('K bump 脚本', 'R30f 拒绝版本号回退',
      bumpSrc.indexOf('cmpVer') !== -1 && /未高于当前 BUILD/.test(bumpSrc));
    T('K bump 脚本', 'R30g 拒绝非法 semver',
      bumpSrc.indexOf('isValidSemver') !== -1);

    /* 真跑一次 dry-run：确认脚本可执行且不改动文件 */
    const before = { ver: fs.readFileSync(path.join(require('../common').ROOT, 'js', 'version.js'), 'utf8'), html: SRC.html };
    let out = '', code = null;
    try {
      out = require('child_process').execSync(
        '"' + process.execPath + '" "' + bumpPath + '" 99.0.0 --title="t" --item="i" --dry-run',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }
      );
      code = 0;
    } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status; }
    T('K bump 脚本', 'R30h dry-run 可执行且退出码 0', code === 0, 'exit=' + code);
    T('K bump 脚本', 'R30i dry-run 输出版本预览', /1\.7\.0|99\.0\.0|目标/.test(out), out.split('\n').filter(function (l) { return /目标/.test(l); })[0] || '');
    const afterVer = fs.readFileSync(path.join(require('../common').ROOT, 'js', 'version.js'), 'utf8');
    T('K bump 脚本', 'R30j dry-run 不写盘（文件未变）',
      afterVer === before.ver, afterVer === before.ver ? 'unchanged' : '文件被改动！');
    /* v2.0.0 复查新增：--refresh-id 只刷 BUILD_ID（bump 后又改代码时的正规做法，
       避免为刷 ID 而强行递增版本号、绕过递增校验） */
    T('K bump 脚本', 'R30k 支持 --refresh-id 只刷 BUILD_ID',
      bumpSrc.indexOf('--refresh-id') !== -1 && bumpSrc.indexOf('refreshId') !== -1);
    T('K bump 脚本', 'R30l --refresh-id 拒绝版本号参数（防误用成 bump）',
      /--refresh-id 不接受版本号参数/.test(bumpSrc));
    let rOut = '', rCode = null;
    try {
      rOut = require('child_process').execSync(
        '"' + process.execPath + '" "' + bumpPath + '" --refresh-id --dry-run',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }
      );
      rCode = 0;
    } catch (e) { rOut = String(e.stdout || '') + String(e.stderr || ''); rCode = e.status; }
    T('K bump 脚本', 'R30m --refresh-id dry-run 可执行且不动版本号',
      rCode === 0 && /BUILD_ID/.test(rOut), 'exit=' + rCode);
    const afterRefresh = fs.readFileSync(path.join(require('../common').ROOT, 'js', 'version.js'), 'utf8');
    T('K bump 脚本', 'R30n --refresh-id dry-run 不写盘',
      afterRefresh === before.ver, afterRefresh === before.ver ? 'unchanged' : '文件被改动！');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "K bump 脚本" };

standalone(module, run);
