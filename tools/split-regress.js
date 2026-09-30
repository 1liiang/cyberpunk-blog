/* tools/split-regress.js — 把 tests/regress.js 按 case 拆成 tests/cases/*.js
 *
 * 为什么用 AST 而不是花括号计数：
 *   源码里有大量 `'{'`、正则 `/\{/`、模板串、注释，朴素计数会数错（已踩过）。
 *   改用 acorn 解析真实语法树，块边界是语法保证的。
 *
 * 原理：run() 体内每个 case 都是一个顶层 `{ ... }`（BlockStatement）。
 *   切块 → 看块内 T() 第一个参数（case 名）→ 同名块归到一个文件。
 *
 * ⚠ 这是一次性工具，已经跑完了。
 *   现在的 tests/regress.js 是【编排层】（100 行），不再是单体；
 *   单体原件留档在 tools/archive/regress-monolith-2.1.2.js。
 *   重新 --write 会【覆盖】tests/cases/ 下所有文件，
 *   也就是说会冲掉拆分后对这些文件做的任何手工修改 —— 默认别再跑。
 *   新增 case 请直接手写 tests/cases/xx-yyy.js（照现有文件抄结构），
 *   再跑 npm run baseline 补基线。
 *
 * 用法：
 *   node tools/split-regress.js          # 预演：只打印分块报告，不写盘
 *   node tools/split-regress.js --write  # 生成 tests/cases/*.js（危险：覆盖）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const SRC_FILE = path.join(__dirname, 'archive', 'regress-monolith-2.1.2.js');
const OUT_DIR = path.join(ROOT, 'tests', 'cases');
const WRITE = process.argv.indexOf('--write') !== -1;

const code = fs.readFileSync(SRC_FILE, 'utf8');
const lines = code.split(/\r?\n/);

/* ---------- 1. 解析 ---------- */
const ast = acorn.parse(code, { ecmaVersion: 2022, locations: true, sourceType: 'script' });

let runFn = null;
ast.body.forEach(n => {
  if (n.type === 'FunctionDeclaration' && n.id && n.id.name === 'run') runFn = n;
});
if (!runFn) throw new Error('找不到 function run()');

/* ---------- 2. 递归找 T() 调用的第一个字符串实参 ---------- */
function collectTCalls(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => collectTCalls(n, out)); return; }
  if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier'
      && node.callee.name === 'T' && node.arguments.length
      && node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string') {
    out.push(node.arguments[0].value);
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'parent') continue;
    collectTCalls(node[k], out);
  }
}

/* ---------- 3. 收集标识符（用于生成 require） ---------- */
function collectIdents(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => collectIdents(n, out)); return; }
  if (node.type === 'Identifier') out.add(node.name);
  for (const k of Object.keys(node)) {
    if (k === 'loc') continue;
    collectIdents(node[k], out);
  }
}

/* ---------- 4. 切块 ---------- */
const stmts = runFn.body.body;
const blocks = [];      // { from, to(1-based inclusive), names, idents }
const freeStmts = [];   // 非块的顶层语句

stmts.forEach(st => {
  if (st.type === 'BlockStatement') {
    const names = [];
    collectTCalls(st, names);
    const idents = new Set();
    collectIdents(st, idents);
    blocks.push({
      from: st.loc.start.line,
      to: st.loc.end.line,
      names: [...new Set(names)],   // 去重后的 case 名（判归属用）
      count: names.length,          // 原始 T() 条数（统计用）
      idents: idents
    });
  } else {
    freeStmts.push({ type: st.type, from: st.loc.start.line, to: st.loc.end.line });
  }
});

/* ---------- 5. 预演报告 ---------- */
console.log('run() 顶层语句：' + stmts.length + ' 条，其中块 ' + blocks.length + ' 个、游离语句 ' + freeStmts.length + ' 条\n');

let problems = 0;
blocks.forEach(b => {
  if (b.names.length === 0) {
    problems++;
    console.log('⚠ L' + b.from + '–L' + b.to + '  块内无 T() 调用（纯 setup？需人工判断归属）');
  } else if (b.names.length > 1) {
    problems++;
    console.log('⚠ L' + b.from + '–L' + b.to + '  混合多个 case：' + b.names.join(' / ') + '（无法机械拆分）');
  }
});
if (!problems) console.log('✓ 所有块都是单 case 归属，可机械拆分\n');

const caseBlocks = new Map();
blocks.forEach(b => {
  if (b.names.length !== 1) return;
  const n = b.names[0];
  if (!caseBlocks.has(n)) caseBlocks.set(n, []);
  caseBlocks.get(n).push(b);
});

console.log('=== 分块结果（按首次出现顺序） ===');
let tot = 0;
[...caseBlocks.entries()].forEach(([name, arr]) => {
  const n = arr.reduce((a, b) => a + b.count, 0);
  tot += n;
  console.log(String(arr.length).padStart(2) + ' 块  ' + String(n).padStart(3) + ' 条  ' + name);
});
console.log('---- 覆盖 T() 文字调用：' + tot + '（scan-cases 扫到 426，差额应来自上述告警块）');

if (freeStmts.length) {
  console.log('\n=== 游离语句（不在块内的 run() 顶层语句） ===');
  freeStmts.forEach(s => console.log('  L' + s.from + '–L' + s.to + '  ' + s.type));
}

if (!WRITE) {
  console.log('\n（预演模式，未写盘。加 --write 真正生成）');
  process.exit(0);
}

/* ---------- 6. 写盘 ---------- */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const COMMON_EXPORTS = ['SRC', 'FIXTURES', 'bootDom', 'waitFor', 'stripComments',
  'stripJsLineComments', 'parseBuild', 'cssBlockAt', 'cssRuleBody', 'hasCssRule'];
const BUILTINS = ['fs', 'crypto', 'path', 'child_process', 'os'];

const MANIFEST = [];
let seq = 0;
const pathFixes = [];

[...caseBlocks.entries()].forEach(([name, arr]) => {
  seq++;
  const file = String(seq).padStart(2, '0') + '-' + slug(name) + '.js';

  let body = arr.map(b => {
    const head = headComment(b.from);
    return (head.length ? head.join('\n') + '\n' : '') + lines.slice(b.from - 1, b.to).join('\n');
  }).join('\n\n');

  /* 路径修正：tests/regress.js 在 tests/ 下，tests/cases/*.js 深一层 */
  const before = body;
  body = body
    .replace(/join\(__dirname,\s*'\.\.'/g, "join(__dirname, '..', '..'")
    .replace(/require\('\.\.\/tools\//g, "require('../../tools/")
    .replace(/require\('\.\/common'\)/g, "require('../common')");
  if (body !== before) pathFixes.push(file);

  /* 按需 require */
  const idents = new Set();
  arr.forEach(b => b.idents.forEach(x => idents.add(x)));
  const needCommon = COMMON_EXPORTS.filter(e => idents.has(e));
  const needBuiltin = BUILTINS.filter(e => idents.has(e));

  const reqs = [];
  if (needCommon.length) reqs.push("const { " + needCommon.join(', ') + " } = require('../common');");
  needBuiltin.forEach(m => {
    reqs.push('const ' + (m === 'child_process' ? 'child_process' : m) + " = require('" + m + "');");
  });

  const out = [
    "'use strict';",
    '/* ============================================================',
    '   tests/cases/' + file + ' — ' + name,
    '   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。',
    '   原行号：' + arr.map(b => 'L' + b.from + '-' + b.to).join(', '),
    '   独立运行：node tests/cases/' + file,
    '   ============================================================ */',
    "const { makeSuite, standalone } = require('../case-runner');",
    ...reqs,
    '',
    'async function run() {',
    '  const S = makeSuite();',
    '  const T = S.T;',
    '  const results = S.results;',
    '  const BUILD = S.BUILD;',
    '',
    body,
    '',
    '  return { pass: results.filter(function (r) { return r.pass; }).length,',
    '          fail: results.filter(function (r) { return !r.pass; }).length,',
    '          results: results };',
    '}',
    '',
    'module.exports = { run: run, name: ' + JSON.stringify(name) + ' };',
    '',
    'standalone(module, run);',
    ''
  ].join('\n');

  fs.writeFileSync(path.join(OUT_DIR, file), out, 'utf8');
  MANIFEST.push({
    file: file,
    name: name,
    blocks: arr.length,
    /* 基线留空，由 tools/baseline-cases.js 跑一遍填实测值。
       不用 T() 文字调用数：循环生成的断言（如 need_.forEach）计数不到，
       拿它当基线会满屏误报。 */
    expect: null
  });
});

console.log('\n✓ 已生成 ' + seq + ' 个文件到 tests/cases/');
if (pathFixes.length) console.log('✓ 已做路径修正的文件：' + pathFixes.join(', '));
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(MANIFEST, null, 2), 'utf8');
console.log('✓ manifest.json');

/* 取块【上方】紧邻的注释行。
   为什么要带：/* ==== 场景 X ==== *\/ 这类注释写明「这个 case 为什么存在」，
   是防假绿的关键知识（后人改断言时靠它判断意图）。块本身不含这些行，
   不带走就等于把注释全删了 —— 拆分不能拆掉注释。 */
function headComment(fromLine) {
  const head = [];
  let i = fromLine - 2;                       // 0-based：块起始行的上一行
  while (i >= 0) {
    const t = lines[i].trim();
    if (t === '') { head.unshift(lines[i]); i--; continue; }   // 空行：接续
    if (/^(\/\*|\*|\/\/)/.test(t)) { head.unshift(lines[i]); i--; continue; }
    break;                                     // 碰到代码，停
  }
  // 头部若全是空行则丢掉，避免每个块前面挂一串空行
  while (head.length && head[0].trim() === '') head.shift();
  return head;
}

function slug(name) {
  return (name
    .replace(/[^\w一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'case');
}
