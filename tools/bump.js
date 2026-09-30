#!/usr/bin/env node
/* ============================================================
   tools/bump.js — 版本号 bump 脚本（D2）

   背景：每次发版要手动改四处 ——
     ① js/version.js 的 VERSION.BUILD
     ② js/version.js 的 VERSION.LOG 最前面 unshift 一条
     ③ index.html 里所有本地资源的 ?v=x.y.z 引用
     ④ package.json 的 version（2.1.0 起纳入；门禁 R61h 要求与 BUILD 一致）
   四处手改迟早会忘一处，忘了就是「新 JS 配旧引用」的缓存事故，
   或是"门禁莫名报红、得手动补一处"的重复劳动。

   本脚本把它们合成一次原子操作，并在写盘前给出 diff 预览。

   用法：
     node tools/bump.js <新版本号> [选项]
       --title="日志标题"     新增 LOG 条目的标题（必需，除非 --no-log）
       --item="条目1"         日志条目，可重复传多次
       --date=YYYY-MM-DD      日志日期，默认取本地今天
       --build-id=<字符串>    BUILD_ID，默认自动生成（时间戳 + 随机短码）
       --no-log               只改 BUILD 与 ?v=，不新增日志条目
       --dry-run              只预览不写盘
       --yes                  跳过交互确认（CI / 脚本化场景）

   示例：
     node tools/bump.js 1.7.0 \
       --title="A3 库层收口" \
       --item="安全：post_images 视图只暴露非敏感字段" \
       --item="安全：content_type MIME 白名单"

   退出码：0 = 成功（含 dry-run）；1 = 参数/环境错误；2 = 用户取消
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const VERSION_JS = path.join(ROOT, 'js', 'version.js');
const INDEX_HTML = path.join(ROOT, 'index.html');
/* 2.1.0 新增：package.json 的 version 也是版本号的一处存放点，
   且门禁 R61h 会断言它与 version.js 的 BUILD 一致。
   此前 bump.js 不管它 → 每次 bump 后必然报红，得手动补一次。
   工具要么把该改的改全，要么明确不管 —— "改一半"是最差的形态。 */
const PKG_JSON = path.join(ROOT, 'package.json');

/* ---------- 参数解析 ---------- */
function parseArgs(argv) {
  const out = { items: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--no-log') out.noLog = true;
    else if (a === '--refresh-id') out.refreshId = true;
    else if (a === '--renumber') out.renumber = true;
    else if (a.startsWith('--published=')) out.published = a.slice(12);
    else if (a === '--published') out.published = argv[++i];
    else if (a.startsWith('--title=')) out.title = a.slice(8);
    else if (a === '--title') out.title = argv[++i];
    else if (a.startsWith('--item=')) out.items.push(a.slice(7));
    else if (a === '--item') out.items.push(argv[++i]);
    else if (a.startsWith('--date=')) out.date = a.slice(7);
    else if (a === '--date') out.date = argv[++i];
    else if (a.startsWith('--build-id=')) out.buildId = a.slice(11);
    else if (a === '--build-id') out.buildId = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('-')) { out.error = '未知选项：' + a; return out; }
    else if (!out.version) out.version = a;
    else { out.error = '多余的位置参数：' + a; return out; }
  }
  return out;
}

const USAGE = `
用法： node tools/bump.js <新版本号> [选项]

  --title="日志标题"    新增 LOG 条目的标题（不传 --no-log 时必需）
  --item="条目"         日志条目，可重复传多次
  --date=YYYY-MM-DD     日志日期，默认今天
  --build-id=<字符串>   BUILD_ID，默认自动生成
  --refresh-id          只刷新 BUILD_ID（版本号不变），不改 BUILD/?v=/LOG
  --renumber            改号模式：允许新号低于本地 BUILD，
                        但必须配 --published=<线上版本>、且新号须高于它
  --published=x.y.z     线上当前版本（改号模式的安全基准，用于判断新号是否用过）
  --no-log              只改 BUILD 与 ?v=，不新增日志条目
  --dry-run             只预览不写盘
  --yes, -y             跳过交互确认
  --help, -h            显示本帮助

示例：
  node tools/bump.js 1.7.0 --title="A3 库层收口" \\
    --item="安全：post_images 视图收口" --item="安全：MIME 白名单"

  改号（本地已 bump 但从未发布，想换成另一个未用过的号）：
  node tools/bump.js 2.0.2 --renumber --published=2.0.1 \\
    --title="..." --item="..."
`;

/* ---------- 工具函数 ---------- */
function pad(n) { return String(n).padStart(2, '0'); }

function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* BUILD_ID：本地时间戳 + 4 位随机短码，保证每次构建唯一可辨 */
function genBuildId(date) {
  const d = new Date();
  const stamp = date
    ? date.replace(/-/g, '').slice(0, 8)
    : String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());
  const tz = -d.getTimezoneOffset() / 60;
  const sign = tz >= 0 ? '+' : '-';
  const hhmm = pad(Math.floor(Math.abs(tz))) + pad(Math.round((Math.abs(tz) % 1) * 60));
  const rand = Math.random().toString(36).slice(2, 6);
  return stamp + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + sign + hhmm + '-build' + rand;
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(String(v || ''));
}

/* 比较语义化版本，返回 -1 / 0 / 1。
   缺失的段按 0 补齐（'1.7' ≡ '1.7.0'），避免 Number(undefined) = NaN
   导致比较结果不可预期——NaN 与任何数比较都是 false，会静默吞掉递增判断。 */
function cmpVer(a, b) {
  function parts(v) {
    const p = String(v).split('.').map(Number);
    return [0, 1, 2].map(function (i) { return Number.isFinite(p[i]) ? p[i] : 0; });
  }
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/* JS 单引号字符串转义 */
function jsStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/* ---------- 读取当前状态 ---------- */
function readCurrent() {
  if (!fs.existsSync(VERSION_JS)) throw new Error('找不到 js/version.js：' + VERSION_JS);
  if (!fs.existsSync(INDEX_HTML)) throw new Error('找不到 index.html：' + INDEX_HTML);
  const ver = fs.readFileSync(VERSION_JS, 'utf8');
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  const buildM = /BUILD:\s*'([^']+)'/.exec(ver);
  const idM = /BUILD_ID:\s*'([^']*)'/.exec(ver);
  const builtAtM = /BUILT_AT:\s*'([^']*)'/.exec(ver);
  const vRefs = html.match(/\?v=[0-9.]+/g) || [];
  const htmlVersions = Array.from(new Set(vRefs.map(function (s) { return s.slice(3); })));

  return {
    ver: ver, html: html,
    build: buildM ? buildM[1] : null,
    buildId: idM ? idM[1] : '',
    builtAt: builtAtM ? builtAtM[1] : '',
    vRefCount: vRefs.length,
    htmlVersions: htmlVersions
  };
}

/* ---------- 生成新内容 ---------- */
function buildNewVersionJs(src, opts) {
  /* ① BUILD */
  if (!/BUILD:\s*'[^']*'/.test(src)) throw new Error('version.js 中找不到 BUILD 字段');
  let out = src.replace(/BUILD:\s*'[^']*'/, "BUILD: '" + opts.version + "'");

  /* ② BUILD_ID */
  if (/BUILD_ID:\s*'[^']*'/.test(out)) {
    out = out.replace(/BUILD_ID:\s*'[^']*'/, "BUILD_ID: '" + jsStr(opts.buildId) + "'");
  }

  /* ③ BUILT_AT */
  if (/BUILT_AT:\s*'[^']*'/.test(out)) {
    out = out.replace(/BUILT_AT:\s*'[^']*'/, "BUILT_AT: '" + opts.date + "'");
  }

  /* ④ LOG unshift */
  if (!opts.noLog) {
    const items = (opts.items && opts.items.length ? opts.items : []).map(function (it) {
      return "          '" + jsStr(it) + "'";
    });
    if (items.length === 0) items.push("          ''");
    const entry =
      '      {\n' +
      "        version: '" + jsStr(opts.version) + "',\n" +
      "        date: '" + jsStr(opts.date) + "',\n" +
      "        title: '" + jsStr(opts.title || '') + "',\n" +
      '        items: [\n' + items.join(',\n') + '\n        ]\n' +
      '      },\n';

    const logM = /LOG:\s*\[\n/.exec(out);
    if (!logM) throw new Error('version.js 中找不到 LOG 数组');
    const at = logM.index + logM[0].length;
    out = out.slice(0, at) + entry + out.slice(at);
  }
  return out;
}

function buildNewHtml(src, opts) {
  const before = (src.match(/\?v=[0-9.]+/g) || []).length;
  const out = src.replace(/\?v=[0-9.]+/g, '?v=' + opts.version);
  return { html: out, replaced: before };
}

/* ---------- 简易 diff 预览（只展示发生变化的行） ---------- */
function diffLines(oldText, newText, label) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const lines = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const la = a[i], lb = b[i];
    if (la === lb) continue;
    if (la !== undefined && lb === undefined) { lines.push(['-', i + 1, la]); continue; }
    if (la === undefined && lb !== undefined) { lines.push(['+', i + 1, lb]); continue; }
    lines.push(['-', i + 1, la]);
    lines.push(['+', i + 1, lb]);
  }
  /* 变化行太多（LOG 插入会导致后续行整体位移）时收敛为摘要 */
  const changed = lines.length;
  const show = lines.slice(0, 24);
  const body = show.map(function (l) {
    const mark = l[0] === '+' ? '+' : '-';
    const color = l[0] === '+' ? '\x1b[32m' : '\x1b[31m';
    return '  ' + color + mark + '\x1b[0m ' + String(l[1]).padStart(4) + ' │ ' + l[2];
  }).join('\n');
  const tail = changed > show.length
    ? '\n  \x1b[2m… 另有 ' + (changed - show.length) + ' 行差异（LOG 插入引起的整体位移）\x1b[0m'
    : '';
  return '\x1b[1m' + label + '\x1b[0m\n' + (body || '  （无变化）') + tail;
}

/* ---------- 交互确认 ---------- */
function confirm(question) {
  return new Promise(function (resolve) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, function (ans) {
      rl.close();
      resolve(/^y(es)?$/i.test(String(ans).trim()));
    });
  });
}

/* ---------- 主流程 ---------- */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { process.stdout.write(USAGE); return 0; }
  if (args.error) { process.stderr.write('错误：' + args.error + '\n' + USAGE); return 1; }

  /* --refresh-id：只刷新 BUILD_ID，不动 BUILD / ?v= / LOG。
     用途：bump 之后又改了代码 —— 该版本尚未发布，?v= 缓存键在线上还不存在，
     版本号不必再动（递增校验也不该被绕过），但 BUILD_ID 应精确对应最终代码，
     否则线上「这个构建到底是哪一份」就成了谜。 */
  if (args.refreshId) {
    if (args.version) {
      process.stderr.write('错误：--refresh-id 不接受版本号参数（它只刷新 BUILD_ID）\n');
      return 1;
    }
    let newId;
    try {
      newId = args.buildId || genBuildId(args.date || todayLocal());
      const src = fs.readFileSync(VERSION_JS, 'utf8');
      const m = /BUILD_ID:\s*'([^']*)'/.exec(src);
      if (!m) { process.stderr.write('错误：version.js 里找不到 BUILD_ID\n'); return 1; }
      process.stdout.write('js/version.js\n');
      process.stdout.write('  -  BUILD_ID: \'' + m[1] + '\'\n');
      process.stdout.write('  +  BUILD_ID: \'' + newId + '\'\n\n');
      if (args.dryRun) { process.stdout.write('（--dry-run，未写盘）\n'); return 0; }
      fs.writeFileSync(VERSION_JS, src.replace(m[0], "BUILD_ID: '" + newId + "'"), 'utf8');
      process.stdout.write('✓ BUILD_ID 已刷新：' + newId + '\n');
      process.stdout.write('  版本号未变、?v= 未动、LOG 未动。\n');
      return 0;
    } catch (e) {
      process.stderr.write('错误：' + e.message + '\n');
      return 1;
    }
  }

  if (!args.version) { process.stderr.write('错误：缺少新版本号\n' + USAGE); return 1; }
  if (!isValidSemver(args.version)) {
    process.stderr.write('错误：版本号必须是 x.y.z 形式（收到 "' + args.version + '"）\n');
    return 1;
  }
  if (!args.noLog && !args.title) {
    process.stderr.write('错误：缺少 --title（或使用 --no-log 跳过日志条目）\n' + USAGE);
    return 1;
  }

  const date = args.date || todayLocal();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    process.stderr.write('错误：--date 必须是 YYYY-MM-DD 形式\n');
    return 1;
  }

  let cur;
  try { cur = readCurrent(); }
  catch (e) { process.stderr.write('错误：' + e.message + '\n'); return 1; }

  /* 版本必须递增，防止误回退 —— 但「递增」比对的基准要看清楚：

     ① 常规模式（默认）：与【本地 BUILD】比。本地版本是单调递增的，
        低于它就说明想回退已发布的版本，必须拦。

     ② --renumber 模式：与【已发布版本】比。
        场景：本地已 bump 到某号（如 2.1.0）但【从未发布】，
        此时想把它改号成另一个尚未用过的号（如 2.0.2）。
        与本地比会误拦这个合法操作（2.0.2 < 2.1.0），
        但缓存键安全性其实与本地号无关 —— 只要新号【在线上从未出现过】，
        ?v= 就是个全新键，发布必然生效。
        所以此模式要求显式传 --published=<线上当前版本>，
        只校验「新号 > 已发布版本」，基准更贴近这条校验真正想守的东西。

     两种模式都不允许选一个已发布过的号 —— 那才是真正危险的误用
     （缓存键不变、用户拿到旧文件却以为更新了）。 */
  const compareBase = args.renumber ? args.published : cur.build;
  if (!args.renumber && cur.build && cmpVer(args.version, cur.build) <= 0) {
    process.stderr.write(
      '错误：新版本号 ' + args.version + ' 未高于当前 BUILD ' + cur.build + '。\n' +
      '      版本号必须递增（否则 ?v= 缓存键不变，发布不会生效）。\n' +
      '      若这是一次「改号」（该版本尚未发布过），用 --renumber --published=<线上版本> 显式声明。\n');
    return 1;
  }
  if (args.renumber) {
    if (!args.published) {
      process.stderr.write(
        '错误：--renumber 必须同时给出 --published=<线上当前版本>。\n' +
        '      理由：改号的安全性取决于「新号在线上从未出现过」，\n' +
        '      脚本无法自行探测线上版本，必须由调用者声明。\n');
      return 1;
    }
    if (!isValidSemver(args.published)) {
      process.stderr.write('错误：--published 必须是 x.y.z 形式（收到 "' + args.published + '"）\n');
      return 1;
    }
    if (cmpVer(args.version, args.published) <= 0) {
      process.stderr.write(
        '错误：目标版本 ' + args.version + ' 未高于已发布版本 ' + args.published + '。\n' +
        '      改号也不允许用回已发布过的号 —— 那样 ?v= 缓存键不变，\n' +
        '      用户会拿到旧文件却以为已更新（这正是本校验要防的事）。\n');
      return 1;
    }
    process.stdout.write('\x1b[33m⚠ 改号模式：' + cur.build + ' → ' + args.version +
      '（未发布过的号，已发布版本为 ' + args.published + '）\x1b[0m\n\n');
  }

  /* ?v= 引用一致性自检（bump 前应全部同值，否则本脚本会统一覆盖） */
  if (cur.htmlVersions.length > 1) {
    process.stderr.write(
      '警告：index.html 中的 ?v= 引用当前不一致（' + cur.htmlVersions.join(' / ') + '）。\n' +
      '      本脚本会将它们统一为 ' + args.version + '。\n\n');
  }

  const opts = {
    version: args.version,
    title: args.title || '',
    items: args.items,
    date: date,
    buildId: args.buildId || genBuildId(date),
    noLog: !!args.noLog
  };

  let newVer, newHtmlRes;
  try {
    newVer = buildNewVersionJs(cur.ver, opts);
    newHtmlRes = buildNewHtml(cur.html, opts);
  } catch (e) {
    process.stderr.write('错误：' + e.message + '\n');
    return 1;
  }

  /* ---------- 预览 ---------- */
  process.stdout.write('\n\x1b[1mNEON://DIARY 版本 bump\x1b[0m\n');
  process.stdout.write('  \x1b[2m项目\x1b[0m      ' + ROOT + '\n');
  process.stdout.write('  \x1b[2m当前\x1b[0m      v' + cur.build + '   (BUILD_ID ' + (cur.buildId || '-') + ')\n');
  process.stdout.write('  \x1b[2m目标\x1b[0m      \x1b[36mv' + args.version + '\x1b[0m   (BUILD_ID ' + opts.buildId + ')\n');
  process.stdout.write('  \x1b[2m日志\x1b[0m      ' + (opts.noLog ? '\x1b[33m跳过（--no-log）\x1b[0m'
    : '"' + opts.title + '" + ' + opts.items.length + ' 条') + '\n');
  process.stdout.write('  \x1b[2m?v= 引用\x1b[0m  ' + newHtmlRes.replaced + ' 处 → ?v=' + args.version + '\n');
  process.stdout.write('\n');

  process.stdout.write(diffLines(cur.ver, newVer, 'js/version.js') + '\n\n');
  process.stdout.write(diffLines(cur.html, newHtmlRes.html, 'index.html') + '\n\n');

  if (args.dryRun) {
    process.stdout.write('\x1b[33m--dry-run：未写入任何文件。\x1b[0m\n\n');
    return 0;
  }

  if (!args.yes) {
    const tty = process.stdout.isTTY && process.stdin.isTTY;
    if (!tty) {
      process.stdout.write('\x1b[33m非交互环境且未传 --yes：已中止，未写入。\x1b[0m\n\n');
      return 2;
    }
    const ok = await confirm('确认写入以上改动？(y/N) ');
    if (!ok) { process.stdout.write('已取消，未写入任何文件。\n\n'); return 2; }
  }

  fs.writeFileSync(VERSION_JS, newVer, 'utf8');
  fs.writeFileSync(INDEX_HTML, newHtmlRes.html, 'utf8');

  /* 2.1.0：同步 package.json 的 version。
     门禁 R61h 断言它与 BUILD 一致 —— 不同步的话每次 bump 后必红，
     逼着人"改完再手补一处"，而手补这一处最容易忘。
     找不到 package.json 或其中没有 version 字段时【静默跳过】：
     本脚本的首要职责是改版本号，不该因为一个可选文件的缺失而失败。 */
  let pkgUpdated = false;
  try {
    if (fs.existsSync(PKG_JSON)) {
      const pkgSrc = fs.readFileSync(PKG_JSON, 'utf8');
      /* 只替换顶层 version 字段，避免误伤 dependencies 里的 "version" 字样 */
      const nextPkg = pkgSrc.replace(/("version"\s*:\s*)"[^"]*"/, '$1"' + args.version + '"');
      if (nextPkg !== pkgSrc) {
        fs.writeFileSync(PKG_JSON, nextPkg, 'utf8');
        pkgUpdated = true;
      }
    }
  } catch (e) { /* 忽略：package.json 不是发布必需项 */ }

  process.stdout.write('\x1b[32m✓ 已写入：\x1b[0m\n');
  process.stdout.write('    js/version.js   BUILD → ' + args.version + '\n');
  process.stdout.write('    index.html      ' + newHtmlRes.replaced + ' 处 ?v= → ' + args.version + '\n');
  if (pkgUpdated) {
    process.stdout.write('    package.json    version → ' + args.version + '（保持与 BUILD 一致，门禁 R61h）\n');
  }
  process.stdout.write('\n下一步：node tests/run-all.js 全绿后发布。\n\n');
  return 0;
}

main().then(function (code) {
  process.exit(code);
}).catch(function (e) {
  process.stderr.write('未预期的错误：' + (e && e.stack || e) + '\n');
  process.exit(1);
});
