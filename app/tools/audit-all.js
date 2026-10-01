'use strict';
/* 全项目审计：扫"死代码 / 前后不一致 / 失效引用"的可疑点，输出事实清单（不猜、不自动改）

   ⚠ v5.6.2 改进：**注释里的名字不算数**。
   清理完代码后，源码注释里通常还会写着"某某已删除"（这是有意的留痕），
   但本脚本原先按原文扫描 —— 于是刚清干净的项目照样报"还残留"，
   把真信号淹没在假阳性里（实测：① ② 清完后仍有 20+ 条命中，全是注释）。
   现在 ① ② ③ ④ ⑦ 各项一律先剥注释（JS 块/行注释 + HTML 注释）再扫。
   ⚠ 只有 **④ 的 index.html 那一列**例外 —— 它问的就是"页面上还挂着这个标记吗"，
     所以用原文；注释里写"某某已移除"不算标记（⑦ 项按这个口径）。
   ⚠ 版本日志（version.js）不在扫描范围内 —— "留痕写在 LOG 里"照旧，
     不会触发误报；反过来说，若某项只有 version.js 命中，那就是**已清干净**。

   ⚠ v5.6.2 重跑才浮出来的剩余真问题：
     radio.js 整个文件已成死代码 —— index.html 不再加载它，运行时代码里
     `window.NEONRadio` 只剩 console.js 的 cmdRadio() 一处引用（那处必然拿不到内核）。
     它没被算进当初那份清单，因为清单是按"能搜到的名字"列的，而它的问题在
     "**没人加载这个文件**"（⑤ 项会报："js/radio.js ❌ index.html 里没有它"）。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = ROOT;

function readAll(dir, exts, skip) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = d + '/' + e.name;
      if (skip && skip.test(p)) continue;
      if (e.isDirectory()) walk(p);
      else if (exts.test(e.name)) out.push(p);
    }
  })(dir);
  return out;
}

/* 剥掉注释：JS/CSS 的块注释 + 行注释，**以及 HTML 注释**。
   ⚠ HTML 注释必须一起剥：index.html 里那句「v5.2.0：旧电台小条（#radio-dock）已移除」
   就是一条 HTML 注释，只剥 JS 风格的话 ④/⑦ 项仍会误报它。 */
function stripComments(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const jsFiles = readAll(APP + '/js', /\.js$/, /vendor|node_modules/);
/* ⚠ 两份内容：raw 用于查"文件里有没有"，code 用于查"代码里有没有" */
const allSrc = jsFiles.map(f => {
  const raw = fs.readFileSync(f, 'utf8');
  return { f, t: raw, c: stripComments(raw) };
});
const views = allSrc.find(x => /views\.js$/.test(x.f));
const app = allSrc.find(x => /app\.js$/.test(x.f));
const cloud = allSrc.find(x => /cloud\.js$/.test(x.f));
const cssRaw = fs.readFileSync(APP + '/css/style.css', 'utf8');
const css = stripComments(cssRaw);
/* index.html 也要两份：raw 用于查"标记到底在不在"（④ 项问的就是"还在不在页面上"），
   code 用于查"代码标记"（⑦ 项 —— 注释里写一句"某某已移除"不该算标记） */
const htmlRaw = fs.readFileSync(APP + '/index.html', 'utf8');
const html = stripComments(htmlRaw);

/* 谁引用了某个标识符（剥注释后统计；注释里的留痕不算数） */
function refs(name) {
  const hits = [];
  const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  for (const x of allSrc) if (re.test(x.c)) hits.push(path.basename(x.f) + '×' + (x.c.match(new RegExp(re.source, 'g')) || []).length);
  return hits;
}
function line(title) { console.log('\n── ' + title + ' ' + '─'.repeat(Math.max(2, 46 - title.length))); }

/* ① 旧电台（base64 时代）遗留 API：还在 cloud.js 里，但还有谁调用？ */
line('① 旧电台 API 是否已成死代码');
for (const n of ['readAudio', 'probeDuration', 'trackData', 'addTrack', 'probeSourceUrl', 'neteaseEmbedUrl', 'isEmbedUrl', 'addByUrl', 'normalizeSourceUrl', 'RADIO_DATA_FIELDS', 'radioCache', 'RADIO_VIEW_ONLY', 'RADIO_WRITE_FIELDS']) {
  const r = refs(n);
  const onlyCloud = r.length === 1 && /cloud\.js/.test(r[0]);
  console.log('  ' + n.padEnd(20) + (r.length ? r.join(' ') : '（无引用）') + (onlyCloud ? '   ← 只在 cloud.js 内部，疑似死代码' : ''));
}

/* ② 旧面板/小条机器：容器已删，逻辑是否还在被调用 */
line('② 旧面板/小条遗留（容器已移除）');
for (const n of ['paintDock', 'bindRadioDock', 'openRadioPanel', 'closeRadioPanel', 'paintPanel', 'paintPanelProgress', 'bindRadioPanel', 'loadRadioTracks', 'radioQueue', 'canManageRadio', 'RadioUI', 'submitAddTrack', 'showAddForm', 'formDraft', 'askRemoveTrack', 'moveTrack', 'restoreFormDraft', 'radioDockView']) {
  const r = refs(n);
  console.log('  ' + n.padEnd(20) + (r.length ? r.join(' ') : '（无引用）'));
}

/* ③ 已删除的库表列，在代码里是否还有引用（剥注释 —— "注释里写着它已删除"不算引用） */
line('③ 已从库里删掉的列，代码里是否还提');
for (const n of ['has_data', 'storage_path', 'duration_sec', 'size_bytes', 'cover_url', 'RADIO_WRITE_TABLE', 'public_radio']) {
  const hits = [];
  for (const x of allSrc) {
    const c = (x.c.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
    if (c) hits.push(path.basename(x.f) + '×' + c);
  }
  console.log('  ' + n.padEnd(18) + (hits.length ? hits.join(' ') : '（无）'));
}

/* ④ 已下线的东西是否还有引用（代码侧剥注释；index.html 侧照原文查 —— 它是标记不是注释） */
line('④ 已下线/已迁移的东西');
for (const n of ['radio.js', 'radio-dock', 'radio-stage', 'workbuddy', 'WorkBuddy', 'holoHero', 'injectHoloHero', 'SITE_BORN', 'uptime-hud']) {
  const inHtml = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(htmlRaw);
  const r = refs(n);
  console.log('  ' + n.padEnd(18) + 'index.html=' + (inHtml ? '有' : '无') + '   代码引用: ' + (r.length ? r.join(' ') : '无'));
}

/* ⑤ 文件层面：仓库里有没有"没人引用"的文件 */
line('⑤ 文件层面：疑似无引用的文件');
const vendor = fs.readdirSync(APP + '/js/vendor').filter(f => /\.js$/.test(f));
for (const f of vendor) {
  const used = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html) || new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(app.t);
  console.log('  js/vendor/' + f.padEnd(24) + (used ? '被引用' : '❌ 无人引用'));
}
for (const f of fs.readdirSync(APP + '/js').filter(f => /\.js$/.test(f))) {
  const used = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html);
  if (!used) console.log('  js/' + f.padEnd(30) + '❌ index.html 里没有它');
}

/* ⑥ 明显的重复与不一致 */
line('⑥ 重复 / 不一致');
const a1 = fs.readFileSync(ROOT + '/db/schema.sql', 'utf8');
const a2 = fs.readFileSync(APP + '/db/schema.sql', 'utf8');
console.log('  db/schema.sql vs app/db/schema.sql: ' + (a1 === a2 ? '一致' : '❌ 不一致（两份会漂移）'));
const born = (app.t.match(/2026-09-28T00:18:00\+08:00/g) || []).length + (views.t.match(/2026-09-28T00:18:00\+08:00/g) || []).length;
console.log('  建站时刻字面量出现次数（app.js+views.js）: ' + born + (born > 1 ? '   ← 应只有 1 处（views.js 的 SITE_BORN）' : ''));
console.log('  console.log 残留: ' + allSrc.reduce((a, x) => a + ((x.t.match(/console\.log\(/g) || []).length), 0) + ' 处');

/* ⑦ CSS 里定义了但没人用的类（只查这批新老交替的；**两侧都剥注释**：
      "注释里提到某个类"既不算 CSS 有、也不算标记有，否则清干净了还会报"只有一边"） */
line('⑦ CSS 类是否有对应标记');
for (const cls of ['holo-hero', 'holo-card', 'holo-radar', 'holo-bars', 'holo-now', 'radio-dock', 'radio-panel', 'radio-track', 'radio-board', 'radio-compose', 'radio-console', 'uptime-hud', 'uptime-grid']) {
  const inCss = new RegExp('\\.' + cls + '(?=[\\s{,:.\\[]|$)').test(css);
  const inJs = new RegExp(cls).test(views.c) || new RegExp(cls).test(app.c) || new RegExp(cls).test(html);
  console.log('  ' + cls.padEnd(16) + 'CSS=' + (inCss ? '有' : '无') + '  标记=' + (inJs ? '有' : '无') + ((inCss !== inJs) ? '   ← 只有一边' : ''));
}
