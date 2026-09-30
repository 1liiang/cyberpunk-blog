#!/usr/bin/env node
'use strict';
/* ============================================================
   tools/check-version.js — 版本三处一致性自检
   BUILD（version.js） / LOG 首条（version.js） / 全部 ?v=（index.html）
   任一处不一致就非零退出，供 npm run version:check 与 preversion 使用。

   v2.0.0 重构：核心逻辑抽成 check()，可直接 require 调用。
   原因：测试里用 execSync 起子进程在部分环境（Windows 沙箱）会 EBUSY，
   而「校验版本」这种纯 IO 逻辑根本不需要子进程 —— 进程内调用更快也更可靠。
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function check(root) {
  root = root || ROOT;
  const ver = fs.readFileSync(path.join(root, 'js/version.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  const buildM = /BUILD:\s*'([^']+)'/.exec(ver);
  const logM = /LOG:\s*\[[\s\S]{0,200}?version:\s*'([^']+)'/.exec(ver);
  const refs = html.match(/\?v=([\d.]+)/g) || [];

  const problems = [];
  if (!buildM) problems.push('version.js 里找不到 BUILD');
  if (!logM) problems.push('version.js 里找不到 LOG 首条 version');

  const build = buildM && buildM[1];
  const logHead = logM && logM[1];
  if (build && logHead && build !== logHead) {
    problems.push('BUILD(' + build + ') 与 LOG 首条(' + logHead + ') 不一致');
  }

  const uniq = Array.from(new Set(refs));
  if (refs.length === 0) problems.push('index.html 里没有任何 ?v= 引用');
  if (uniq.length > 1) problems.push('index.html 的 ?v= 版本不统一：' + uniq.join(', '));
  if (build && uniq.length === 1 && uniq[0] !== '?v=' + build) {
    problems.push('index.html 的 ' + uniq[0] + ' 与 BUILD(' + build + ') 不一致');
  }

  return { ok: problems.length === 0, build: build, refs: refs, problems: problems };
}

module.exports = { check: check };

if (require.main === module) {
  const r = check();
  if (!r.ok) {
    console.error('✗ 版本一致性自检未通过：');
    r.problems.forEach(p => console.error('  - ' + p));
    process.exit(1);
  }
  console.log('✓ 版本一致：v' + r.build + '（' + r.refs.length + ' 处 ?v= 引用）');
}
