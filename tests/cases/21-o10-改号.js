'use strict';
/* ============================================================
   tests/cases/21-o10-改号.js — O10 改号
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L1680-1741
   独立运行：node tests/cases/21-o10-改号.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  {
    const bumpSrc = SRC.bump || '';

    /* ⚠ 教训：这里最初写的是 /--renumber/.test(bumpSrc) ——
       看着像个断言，实际上是个摆设：用法说明、注释、错误提示里都含这个词，
       把选项解析那一行删掉它照样绿（实测确认）。
       断言必须钉【可执行结构】，不能钉【文本里出现过的词】。 */
    T('O10 改号', 'R61 --renumber / --published 已接进参数解析（不只是写了文档）',
      /a === '--renumber'\)\s*out\.renumber\s*=\s*true/.test(bumpSrc) &&
      /a\.startsWith\('--published='\)\)\s*out\.published\s*=\s*a\.slice/.test(bumpSrc),
      'renumber=' + /a === '--renumber'\)\s*out\.renumber\s*=\s*true/.test(bumpSrc) +
      ' published=' + /a\.startsWith\('--published='\)\)\s*out\.published\s*=\s*a\.slice/.test(bumpSrc));

    /* 同上：常规模式的守卫必须【仍然存在且未被改写为无条件分支】。
       写成精确匹配 + 反向排除「去掉 !args.renumber 前缀」的改写。 */
    T('O10 改号', 'R61b 常规模式守卫存在，且仍受 !args.renumber 约束',
      /if\s*\(\s*!args\.renumber\s*&&\s*cur\.build\s*&&\s*cmpVer\(args\.version,\s*cur\.build\)\s*<=\s*0\)/.test(bumpSrc) &&
      /'      版本号必须递增/.test(bumpSrc),
      '含 !args.renumber 前缀: ' + /if\s*\(\s*!args\.renumber\s*&&\s*cur\.build/.test(bumpSrc));

    T('O10 改号', 'R61c 改号模式以「已发布版本」为基准',
      /args\.renumber\s*\?\s*args\.published\s*:\s*cur\.build/.test(bumpSrc),
      (/const\s+compareBase[^;]*/.exec(bumpSrc) || [''])[0]);

    /* 三条拒绝路径必须都在：缺基准 / 基准格式错 / 新号未超过已发布版本 */
    T('O10 改号', 'R61d 改号缺 --published 时拒绝执行',
      /--renumber 必须同时给出 --published/.test(bumpSrc));
    T('O10 改号', 'R61e --published 格式非 x.y.z 时拒绝',
      /--published 必须是 x\.y\.z 形式/.test(bumpSrc));
    T('O10 改号', 'R61f 目标号未超过已发布版本时拒绝（防复用已用过的缓存键）',
      /cmpVer\(args\.version,\s*args\.published\)\s*<=\s*0/.test(bumpSrc) &&
      /改号也不允许用回已发布过的号/.test(bumpSrc));

    /* 拒绝路径必须发生在写盘之前 —— 否则会留下改了一半的文件 */
    const writeIdx = bumpSrc.indexOf('fs.writeFileSync(VERSION_JS, newVer');
    const guardIdx = bumpSrc.indexOf('args.renumber ? args.published : cur.build');
    T('O10 改号', 'R61g 全部校验都在写盘之前（不产生半成品文件）',
      guardIdx !== -1 && writeIdx !== -1 && guardIdx < writeIdx,
      'guard@' + guardIdx + ' < write@' + writeIdx);

    /* 版本单一数据源：package.json 的 version 不许长期漂移 */
    const pkgM = /"version"\s*:\s*"([^"]+)"/.exec(SRC.pkg || '');
    const buildM = /BUILD:\s*'([^']+)'/.exec(SRC.ver || '');
    T('O10 改号', 'R61h package.json 版本与 version.js 的 BUILD 一致',
      !!pkgM && !!buildM && pkgM[1] === buildM[1],
      'package.json=' + (pkgM ? pkgM[1] : '?') + ' vs BUILD=' + (buildM ? buildM[1] : '?'));
    /* 2.1.0：bump.js 现在负责同步 package.json。
       否则每次 bump 后必然踩 R61h 报红、得手动补一处 —— 
       工具的职责是"把该改的改全"，不是"改一半剩下的让人记"。 */
    T('O10 改号', 'R61j bump.js 会把 package.json 的 version 一并同步',
      /PKG_JSON/.test(SRC.bump || '') &&
      /package\.json/.test(SRC.bump || '') &&
      /writeFileSync\(PKG_JSON/.test(SRC.bump || ''));

    /* 已发布的号不许出现在 LOG 里两次（改号若忘了删旧条目就会重复） */
    const logVersions = (SRC.ver.match(/version:\s*'([^']+)'/g) || []).map(function (s) {
      return s.replace(/version:\s*'/, '').replace(/'$/, '');
    });
    const dupLog = logVersions.filter(function (v, i) { return logVersions.indexOf(v) !== i; });
    T('O10 改号', 'R61i 工程日志无重复版本号（改号后旧条目已清理）',
      dupLog.length === 0, dupLog.join(',') || '无重复');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O10 改号" };

standalone(module, run);
