/* tools/baseline-cases.js — 为 tests/cases/ 生成断言数基线
 *
 * 干什么：
 *   逐个跑 tests/cases/*.js，把每个 case 的【实测断言条数】写回
 *   tests/cases/manifest.json 的 expect 字段。
 *   编排层（tests/regress.js）随后逐一对账，断言被静默吞掉时判红。
 *
 * 为什么基线要"跑出来"而不是"数出来"：
 *   T() 有大量是循环生成的（如 need_.forEach），静态数 T( 只数到 427，
 *   实测 453 —— 拿静态数当基线会满屏误报。
 *
 * 什么时候跑：
 *   ① 拆分/新增 case 之后；② 有意增删断言之后。
 *   ⚠ 跑之前必须确认门禁全绿 —— 否则等于把 bug 固化成基线。
 *
 * 用法：node tools/baseline-cases.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'tests', 'cases');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

(async function () {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let total = 0;
  let red = 0;

  /* ⚠ 本脚本只遍历 manifest 里**已登记**的项 —— 它不会自己发现新 case 文件。
     于是"加了 case 却忘了登记"的后果是：该文件**永不进入全量门禁**，
     而它单独跑的时候是全绿的 —— 这是最隐蔽的一种假绿（2026-09-29 实际踩到：
     39 号地基用例写完、20 条全绿，却因为没登记而从未被 npm run build 覆盖）。
     所以这里主动比一次目录与清单的差集，把漏登记的当场喊出来。 */
  const onDisk = fs.readdirSync(OUT_DIR)
    .filter(function (f) { return /\.js$/.test(f) && !/^_/.test(f); });
  const listed = manifest.map(function (m) { return m.file; });
  const missing = onDisk.filter(function (f) { return listed.indexOf(f) === -1; });
  if (missing.length) {
    console.log('⚠ 以下 case 文件未登记进 manifest（全量门禁不会执行它们）：');
    missing.forEach(function (f) { console.log('    ' + f); });
    console.log('  → 请先补进 tests/cases/manifest.json 再跑基线。\n');
    process.exit(1);
  }

  for (const m of manifest) {
    const mod = require(path.join(OUT_DIR, m.file));
    let r;
    try {
      r = await mod.run();
    } catch (e) {
      console.log('✗ ' + m.file + '  跑挂了：' + e.message);
      red++;
      continue;
    }
    const n = r.results.length;
    const f = r.results.filter(x => !x.pass).length;
    total += n;
    if (f) red += f;
    const delta = (m.expect === null || m.expect === undefined) ? '' :
      (n === m.expect ? '' : '  （原基线 ' + m.expect + '）');
    m.expect = n;
    console.log(String(n).padStart(4) + ' 条  ' + (f ? f + ' 红  ' : '      ') + m.name + delta);
  }

  console.log('\n合计 ' + total + ' 条' + (red ? '，其中 ' + red + ' 条红 —— 基线未写入（先修红）' : '，全绿 ✓'));
  if (red) {
    // 红的情况下不写基线：把 bug 固化成基线比没有基线更糟
    console.log('⚠ 存在红项，已拒绝写入基线。');
    process.exit(1);
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('✓ 基线已写入 tests/cases/manifest.json');
  process.exit(0);
})();
