#!/usr/bin/env node
/* ============================================================
   export-cloud-full.js — NEON://DIARY 云端全量导出（迁移专用）

   为什么需要它
   ------------------------------------------------------------
   tools/export-static.js 导的是「站点运行所需的**已发布**内容」；
   本脚本导的是「**重建数据库所需的全部数据**」——用途不同：
     · export-static.js → data/   （站点快照，给只读环境跑）
     · 本脚本          → db/seed/ （种子数据，给新后端灌库用）

   导出通道与 export-static.js 相同：匿名 REST（PostgREST）+ anon key。
   ⚠ 迁移到 Supabase 后，本脚本的定位变了：它当初是"从旧平台抢救数据"用的，
     现在旧平台的数据已经在 db/seed/ 里了；留着它是为了**在新库上重跑**——
     比如你后来加了几篇文章，想把它们也收进 seed 备份。
   实测（2026-09-30，旧平台）匿名可读的边界：
     ✅ posts 表：全部「已发布」文章（RLS 放行 published）
     ✅ public_images 视图：全部图片（含未被引用的，如已删文章的残留图）
     ✅ public_radio  视图：全部曲目（含 data 本体）
     ❌ 草稿：RLS 拦（需登录态，本通道拿不到 —— 这是平台边界，非本脚本缺陷）
     ❌ error_logs：RLS 拦（仅本人可读，匿名读返回空）
     ❌ post_images 基表：401 已收回（设计如此，读走视图）

   产出（默认写到 db/seed/）
   ------------------------------------------------------------
     posts.json            全部已发布文章（原始行，含正文 content）
     images/<id>.<ext>     全部图片（base64 解码落地）
     images-index.json     图片清单：元数据 + sha256 + 与 app/data 快照的一致性
     radio/<id>.<ext>      曲目（仅当与 app/data/radio 不一致或缺席时落地）
     radio-index.json      曲目清单：元数据 + sha256 + 实体文件位置
     EXPORT-REPORT.md      导出报告（人读：条数 / 校验 / 引用覆盖）

   地址解析顺序（--app 参数 > 默认相对位置）
   ------------------------------------------------------------
     1) --app <路径>/js/cloud.js 里的 endpoint + publishableKey（单一来源）
     2) 默认 --app = <本脚本>/../../app（bundle 内布局）

   用法
   ------------------------------------------------------------
     node db/tools/export-cloud-full.js
     node db/tools/export-cloud-full.js --app ../app --out ../seed
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
function argOf(name, dft) {
  const i = argv.indexOf(name);
  return (i >= 0 && argv[i + 1]) ? argv[i + 1] : dft;
}
const ROOT = path.join(__dirname, '..', '..');                    // bundle 根
const APP = path.resolve(argOf('--app', path.join(ROOT, 'app')));
const OUT = path.resolve(argOf('--out', path.join(ROOT, 'db', 'seed')));
const APP_DATA = path.join(APP, 'data');                          // 站点快照（用于一致性比对）

/* ---------- 从 app/js/cloud.js 读配置（单一来源） ---------- */
function readCloudConfig() {
  const src = fs.readFileSync(path.join(APP, 'js', 'cloud.js'), 'utf8');
  const ep = /endpoint:\s*'([^']+)'/.exec(src);
  const key = /publishableKey:\s*'([^']+)'/.exec(src);
  if (!ep || !key) throw new Error('无法从 js/cloud.js 解析 endpoint / publishableKey');
  return { endpoint: ep[1].replace(/\/$/, ''), key: key[1] };
}
const { endpoint: ENDPOINT, key: KEY } = readCloudConfig();
/* Supabase PostgREST 数据面（查询串语法与旧平台同源，故各处 ?select= / eq. 一律照旧） */
const REST = ENDPOINT + '/rest/v1';

/* ---------- 工具 ---------- */
async function rest(pathAndQuery, tries) {
  tries = tries || 3;
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(REST + pathAndQuery, {
        headers: {
          apikey: KEY,                       /* Supabase 约定：项目识别用 apikey */
          Authorization: 'Bearer ' + KEY,    /* PostgREST 据此以 anon 角色执行，RLS 决定可见范围 */
          Accept: 'application/json'
        }
      });
      if (!res.ok) throw new Error('REST ' + res.status + ' ' + pathAndQuery + ' → ' + (await res.text()).slice(0, 200));
      const data = await res.json();
      if (data && !Array.isArray(data) && data.code) throw new Error('REST 错误 ' + data.code + ': ' + data.message);
      return data;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
/* data 字段兼容两种形态：纯 base64（图片）或 data URL（电台）。
   base64 字符集不含逗号，故 indexOf('base64,') 命中即 URL 形态。 */
function stripDataUrl(s) {
  s = String(s || '');
  const i = s.indexOf('base64,');
  return i >= 0 ? s.slice(i + 7) : s;
}

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const AUDIO_EXT_BY_MIME = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/webm': 'webm'
};
/* 从文章正文/摘要/封面里抠 cloudimg://N 引用（与 export-static.js 同口径） */
const CLOUDIMG_RE = /cloudimg:\/\/(\d+)/g;
function collectImageIds(posts) {
  const used = new Set();
  posts.forEach(p => {
    [p.content, p.summary, p.cover_ref].forEach(s => {
      if (!s) return;
      CLOUDIMG_RE.lastIndex = 0;
      let m;
      while ((m = CLOUDIMG_RE.exec(s))) used.add(+m[1]);
    });
  });
  return used;
}

let failures = [];

/* 行结构存档：把「大数据字段以外的全部字段」原样留下（data/thumb 换成占位符）。
   用途：新平台重建时，按它写 INSERT 语句模板，字段名/类型/示例值一眼可见。
   为什么不存完整行：base64 大字段（单条 1~3MB / 音频 12MB）会让存档爆成几十 MB，
   而它们的内容**已经**以解码后的文件形式落在 images/ 与 radio/ 里，重复无益。 */
function truncRow(row, bigKeys) {
  const out = {};
  Object.keys(row).forEach(function (k) {
    if (bigKeys.indexOf(k) >= 0 && row[k]) {
      out[k] = '<base64 omitted: ' + String(row[k]).length + ' chars>';
    } else {
      out[k] = row[k];
    }
  });
  return out;
}
const imageRowsStore = [];
const radioRowsStore = [];

async function main() {
  console.log('\nNEON://DIARY 云端全量导出（迁移种子）');
  console.log('  端点  ' + ENDPOINT);
  console.log('  应用  ' + APP);
  console.log('  产出  ' + OUT);

  fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'radio'), { recursive: true });

  /* ---------- 1) 文章 ---------- */
  console.log('\n[1/3] 文章 posts …');
  const posts = await rest('/posts?select=*&order=id.asc');
  const postsDoc = {
    exportedAt: new Date().toISOString(),
    source: ENDPOINT,
    note: '匿名通道导出：仅含 RLS 放行的已发布文章。草稿需登录态导出。',
    count: posts.length,
    posts
  };
  fs.writeFileSync(path.join(OUT, 'posts.json'), JSON.stringify(postsDoc, null, 2), 'utf8');
  const usedImgIds = collectImageIds(posts);
  console.log('  已导出 ' + posts.length + ' 篇：' + posts.map(p => '#' + p.id).join(' '));
  console.log('  正文引用图片 id：' + (usedImgIds.size ? Array.from(usedImgIds).sort((a, b) => a - b).join(' ') : '（无）'));

  /* ---------- 2) 图片（public_images 全量） ---------- */
  console.log('\n[2/3] 图片 public_images …');
  const imgIds = (await rest('/public_images?select=id&order=id.asc')).map(r => r.id);
  const imagesIndex = [];
  for (const id of imgIds) {
    try {
      const rows = await rest('/public_images?id=eq.' + id);
      if (!rows.length) { failures.push('image #' + id + ': 行不存在'); continue; }
      const row = rows[0];
      const buf = Buffer.from(stripDataUrl(row.data), 'base64');
      const ext = EXT_BY_MIME[row.content_type] || 'bin';
      const fname = id + '.' + ext;
      fs.writeFileSync(path.join(OUT, 'images', fname), buf);
      const sha = sha256(buf);
      const appFile = path.join(APP_DATA, 'images', fname);
      const identical = fs.existsSync(appFile) && sha256(fs.readFileSync(appFile)) === sha;

      let thumbFile = null;
      if (row.thumb) {
        const tbuf = Buffer.from(stripDataUrl(row.thumb), 'base64');
        thumbFile = id + '.thumb.' + ext;
        fs.writeFileSync(path.join(OUT, 'images', thumbFile), tbuf);
      }
      imagesIndex.push({
        id: row.id,
        file: fname,
        content_type: row.content_type || null,
        size_bytes: row.size_bytes != null ? row.size_bytes : buf.length,
        width: row.width != null ? row.width : null,
        height: row.height != null ? row.height : null,
        sha256: sha,
        thumb_file: thumbFile,
        referenced_by_published: usedImgIds.has(+row.id),
        identical_with_app_snapshot: identical
      });
      imageRowsStore.push(truncRow(row, ['data', 'thumb']));
      console.log('  #' + id + '  ' + (row.content_type || '?') + '  ' + fmtBytes(buf.length) +
        (row.width ? '  ' + row.width + 'x' + row.height : '') +
        (identical ? '  ≡ app/data 快照一致' : '  （app/data 无此图或不同）'));
    } catch (e) {
      failures.push('image #' + id + ': ' + e.message);
      console.log('  #' + id + '  失败: ' + e.message);
    }
  }
  fs.writeFileSync(path.join(OUT, 'images-index.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), source: ENDPOINT, count: imagesIndex.length, images: imagesIndex }, null, 2), 'utf8');

  /* ---------- 3) 电台（public_radio 全量） ---------- */
  console.log('\n[3/3] 电台 public_radio …');
  const radioIds = (await rest('/public_radio?select=id&order=id.asc')).map(r => r.id);
  const radioIndex = [];
  for (const id of radioIds) {
    try {
      const rows = await rest('/public_radio?id=eq.' + id);
      if (!rows.length) { failures.push('radio #' + id + ': 行不存在'); continue; }
      const row = rows[0];
      const mime = row.mime || 'audio/mpeg';
      const ext = AUDIO_EXT_BY_MIME[mime] || 'mp3';
      const fname = id + '.' + ext;
      let file = null, sha = null, bytes = null, identical = false, copiedHere = false;

      if (row.data) {
        const buf = Buffer.from(stripDataUrl(row.data), 'base64');
        bytes = buf.length;
        sha = sha256(buf);
        /* 与 app/data/radio 的同名文件比对：一致则不再重复落地（快照即本体） */
        const appFile = path.join(APP_DATA, 'radio', fname);
        if (fs.existsSync(appFile) && sha256(fs.readFileSync(appFile)) === sha) {
          identical = true;
          file = '../app/data/radio/' + fname;   /* 相对 db/seed/ 的引用 */
        } else {
          fs.writeFileSync(path.join(OUT, 'radio', fname), buf);
          copiedHere = true;
          file = 'radio/' + fname;
        }
      }
      radioIndex.push({
        id: row.id,
        title: row.title || null,
        artist: row.artist || null,
        album: row.album || null,
        mime,
        duration_sec: row.duration_sec != null ? row.duration_sec : null,
        size_bytes: row.size_bytes != null ? row.size_bytes : bytes,
        sort_order: row.sort_order != null ? row.sort_order : null,
        has_data: !!row.data,
        sha256: sha,
        file,
        identical_with_app_snapshot: identical,
        file_copied_into_seed: copiedHere
      });
      radioRowsStore.push(truncRow(row, ['data']));
      console.log('  #' + id + '  ' + (row.title || '(无题)') + '  ' + (bytes ? fmtBytes(bytes) : '无数据') +
        (identical ? '  ≡ app/data/radio/' + fname : (copiedHere ? '  → 已落地 db/seed/radio/' + fname : '')));
    } catch (e) {
      failures.push('radio #' + id + ': ' + e.message);
      console.log('  #' + id + '  失败: ' + e.message);
    }
  }
  fs.writeFileSync(path.join(OUT, 'radio-index.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), source: ENDPOINT, count: radioIndex.length, tracks: radioIndex }, null, 2), 'utf8');

  /* 行结构存档（大字段已截断占位，见 truncRow 注释） */
  fs.writeFileSync(path.join(OUT, 'images-rows.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), note: '原始行结构（data/thumb 已截断占位）；供新平台重建时写 INSERT 模板', rows: imageRowsStore }, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'radio-rows.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), note: '原始行结构（data 已截断占位）；供新平台重建时写 INSERT 模板', rows: radioRowsStore }, null, 2), 'utf8');

  /* ---------- 报告 ---------- */
  const missingRefs = Array.from(usedImgIds).filter(id => !imagesIndex.some(i => i.id === id));
  const report = [
    '# 云端导出报告（db/seed）',
    '',
    '> 由 `db/tools/export-cloud-full.js` 生成，勿手改。',
    '',
    '- 导出时间：' + new Date().toISOString(),
    '- 云端点：' + ENDPOINT,
    '- 通道：匿名 REST（publishableKey），仅 RLS 放行的公开数据',
    '',
    '## 条数',
    '',
    '| 数据 | 条数 | 说明 |',
    '|---|---|---|',
    '| 已发布文章 | ' + posts.length + ' | posts.json（原始行） |',
    '| 图片 | ' + imagesIndex.length + ' | images/（base64 已解码落地） |',
    '| 电台曲目 | ' + radioIndex.length + ' | 实体见 radio-index.json 的 file 字段 |',
    '',
    '## 校验',
    '',
    '- 文章引用的图片 id：' + (usedImgIds.size ? Array.from(usedImgIds).sort((a, b) => a - b).join(', ') : '（无）'),
    '- 引用缺失：' + (missingRefs.length ? '❌ ' + missingRefs.join(', ') + '（云端没有这些 id！）' : '✅ 全部命中所导出图片集'),
    '- 与 app/data 快照一致性：' +
      '图片 ' + imagesIndex.filter(i => i.identical_with_app_snapshot).length + '/' + imagesIndex.length + '；' +
      '电台 ' + radioIndex.filter(t => t.identical_with_app_snapshot).length + '/' + radioIndex.length,
    '',
    '## 失败项',
    '',
    failures.length ? failures.map(f => '- ❌ ' + f).join('\n') : '（无）',
    '',
    '## ⚠ 本通道拿不到的内容（须登录态另行导出）',
    '',
    '- 草稿文章（posts.status = draft）',
    '- error_logs（仅作者本人可读）',
    '- 云存储对象（blog/images、blog/attachments 目录，需登录 + 签名 URL）',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'EXPORT-REPORT.md'), report, 'utf8');
  console.log('\n报告已写入 db/seed/EXPORT-REPORT.md');
  if (failures.length) {
    console.log('⚠ 存在 ' + failures.length + ' 个失败项，详见报告。');
    process.exitCode = 1;
  } else {
    console.log('✅ 全部导出成功。');
  }
}

main().catch(e => { console.error('\n❌ 导出失败：' + e.message); process.exit(1); });
