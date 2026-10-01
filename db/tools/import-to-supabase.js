#!/usr/bin/env node
/* ============================================================
   db/tools/import-to-supabase.js — 把 seed 灌进 Supabase（直连 Postgres）

   为什么走直连而不是 PostgREST：
     · 建表是 **DDL**，PostgREST（数据面）没有执行任意 SQL 的入口
     · 电台音频单条 ~16MB（base64），走直连没有请求体上限的顾虑
   凭证从环境变量读，**不落盘**：
     SUPABASE_DB_URL   形如 postgresql://postgres.<ref>:<pwd>@...:5432/postgres （Session pooler）
     NEON_OWNER_ID     可选，写入 owner_id；默认 'legacy-import'（谁都不能改，等站长注册后 --claim）

   用法（在 F:\个人网站 下；依赖 pg，见本文件末尾「依赖」）：
     node db/tools/import-to-supabase.js --dry          只看会写什么，不连库
     node db/tools/import-to-supabase.js --reset        先 DROP 再重建（全新项目走这个）
     node db/tools/import-to-supabase.js                建表（若还没建）+ 灌种子 + 回验
     node db/tools/import-to-supabase.js --verify-only  只回验，不写
     node db/tools/import-to-supabase.js --claim <uid>  把 legacy 数据改归你的账号（注册后跑）

   幂等性：数据用 ON CONFLICT (id) DO UPDATE 覆盖，可反复跑；
           DDL 用 --reset（drop cascade 后重建）或先由 SQL Editor 建好再 --skip-schema。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app');
const DB = path.join(ROOT, 'db');
const SEED = path.join(DB, 'seed');
const SCHEMA = path.join(DB, 'schema.sql');

const args = process.argv.slice(2);
const has = function (f) { return args.indexOf(f) !== -1; };
const valueOf = function (f) { var i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const DB_URL = process.env.SUPABASE_DB_URL || '';
const OWNER = (process.env.NEON_OWNER_ID || 'legacy-import').trim();
const DRY = has('--dry');
const RESET = has('--reset');
const SKIP_SCHEMA = has('--skip-schema');
const VERIFY_ONLY = has('--verify-only');
const CLAIM_UID = valueOf('--claim');

let pg = null;
function requirePg() {
  if (!pg) {
    try { pg = require('pg'); }
    catch (e) {
      console.error('缺少依赖 pg。装法（不进站点依赖，只在工作区装一次）：');
      console.error('  node <DSH>/pnpm.mjs add pg --dir F:\\个人网站\\_push\\tools');
      console.error('  再以 NODE_PATH=F:\\个人网站\\_push\\tools\\node_modules 运行本脚本');
      process.exit(1);
    }
  }
  return pg;
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

/* ---------- 1) 组装待写入的行 ---------- */
function buildRows() {
  const postsSeed = readJson(path.join(SEED, 'posts.json'));
  const imgIndex = readJson(path.join(SEED, 'images-index.json'));
  /* 注：db/seed/radio-index.json 仍在库里作为历史记录，但**不再被本脚本读取** ——
     电台已退役（见下方 radio 处），读它只会留下一条"文件删了脚本就崩"的暗线。 */

  const posts = postsSeed.posts.map(function (p) {
    return {
      id: p.id,
      /* ⚠ 统一归导入者（默认 'legacy-import'），**不要**保留旧平台的 owner_id。
         旧 id（如 '2104255212179951616'）在 Supabase 上不存在对应账号 ——
         留着的结果是这 4 篇变成"谁都不能编辑"的孤儿，而且后面 --claim
         （按 owner_id = OWNER 改归属）会一行都匹配不到、静默无效。
         原始 owner_id 并未丢失：db/seed/posts.json 里完整保留着。
         （这条是 PGlite 全链路测试抓出来的：verify 报 legacy-import=0。） */
      owner_id: OWNER,
      owner_name: p.owner_name || null,
      title: p.title,
      summary: p.summary || null,
      content: p.content || '',
      tags: p.tags || [],
      cover_ref: p.cover_ref || null,
      status: p.status || 'published',
      created_at: p.created_at,
      updated_at: p.updated_at || p.created_at
    };
  });

  const images = imgIndex.images.map(function (m) {
    /* ⚠ 图片文件优先从 seed 取，找不到就回退到**仓库快照** data/images/。
       为什么要有这个回退：2026-10-01 瘦身时删掉了 db/seed/images/2.png
       （它与 app/data/images/2.png 逐字节相同，属重复存储），
       而快照那份是进仓库、随版本走的权威副本。
       两份都在时以 seed 为准（迁移期它才是"原始种子"）。 */
    const seedFile = path.join(SEED, 'images', m.file);
    const snapFile = path.join(__dirname, '..', '..', 'app', 'data', 'images', m.file);
    const src = fs.existsSync(seedFile) ? seedFile : snapFile;
    if (!fs.existsSync(src)) throw new Error('图片文件缺失：' + m.file + '（找过 ' + seedFile + ' 与 ' + snapFile + '）');
    const buf = fs.readFileSync(src);
    const row = {
      id: m.id,
      owner_id: OWNER,
      content_type: m.content_type || 'image/png',
      data: buf.toString('base64'),           /* 基表存**纯 base64**（无 data: 前缀） */
      thumb: null,
      width: m.width || null,
      height: m.height || null,
      size_bytes: m.size_bytes || buf.length,
      created_at: '2026-09-30T05:37:17.202Z'
    };
    /* 校验：文件 sha256 必须与索引一致，否则灌进去的是坏图 */
    const got = sha256(buf);
    if (m.sha256 && got !== m.sha256) throw new Error('图片 ' + m.file + ' sha256 与索引不符：' + got);
    if (m.thumb_file) {
      const tb = fs.readFileSync(path.join(SEED, 'images', m.thumb_file));
      row.thumb = tb.toString('base64');
    }
    return row;
  });

  /* ⚠ 电台已退役（2026-09-30 站长决定：不做歌曲部分）。
     三首商业歌曲的音频已从仓库与快照中移除，也不导入新库 ——
     故此处不再组装 radio 行。radio_tracks 表结构保留（schema.sql 未动），
     界面也保留（点开是空态）；将来要恢复的话，把下面这段按 radio-index.json 还原即可，
     但请同时确认版权与仓库体积（这批音频 27MB）。
  const radio = radioIndex.tracks.map(function (t) { ... });
  */
  const radio = [];

  return { posts: posts, images: images, radio: radio };
}

/* ---------- 2) 写库 ---------- */
async function importAll(client, rows) {
  /* 文章 */
  for (const p of rows.posts) {
    await client.query(
      `insert into posts (id, owner_id, owner_name, title, summary, content, tags, cover_ref, status, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
       on conflict (id) do update set
         owner_id = excluded.owner_id, owner_name = excluded.owner_name, title = excluded.title,
         summary = excluded.summary, content = excluded.content, tags = excluded.tags,
         cover_ref = excluded.cover_ref, status = excluded.status,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
      [p.id, p.owner_id, p.owner_name, p.title, p.summary, p.content,
       JSON.stringify(p.tags), p.cover_ref, p.status, p.created_at, p.updated_at]
    );
  }
  console.log('  文章  ' + rows.posts.length + ' 篇 ✅');

  /* 图片（base64 很大，逐条走参数化查询；表上有长度 CHECK，超限会当场报错而不是静默截断） */
  for (const im of rows.images) {
    await client.query(
      `insert into post_images (id, owner_id, content_type, data, thumb, width, height, size_bytes, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set
         owner_id = excluded.owner_id, content_type = excluded.content_type, data = excluded.data,
         thumb = excluded.thumb, width = excluded.width, height = excluded.height,
         size_bytes = excluded.size_bytes, created_at = excluded.created_at`,
      [im.id, im.owner_id, im.content_type, im.data, im.thumb, im.width, im.height, im.size_bytes, im.created_at]
    );
    console.log('  图片 #' + im.id + '  ' + (im.data.length / 1024).toFixed(0) + ' KB base64' +
      (im.thumb ? ' + 缩略图' : '') + ' ✅');
  }

  /* 电台 */
  for (const r of rows.radio) {
    await client.query(
      `insert into radio_tracks (id, owner_id, title, artist, album, mime, data, duration_sec, size_bytes, sort_order, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set
         owner_id = excluded.owner_id, title = excluded.title, artist = excluded.artist, album = excluded.album,
         mime = excluded.mime, data = excluded.data, duration_sec = excluded.duration_sec,
         size_bytes = excluded.size_bytes, sort_order = excluded.sort_order, created_at = excluded.created_at`,
      [r.id, r.owner_id, r.title, r.artist, r.album, r.mime, r.data, r.duration_sec, r.size_bytes, r.sort_order, r.created_at]
    );
    console.log('  电台 #' + r.id + ' ' + r.title + '  ' + (r.size_bytes / 1048576).toFixed(1) + ' MB ✅');
  }

  /* 自增序列：不重置的话，站长发的第一篇新文会撞主键 */
  for (const t of ['posts', 'post_images', 'radio_tracks', 'error_logs']) {
    await client.query(
      `select setval(pg_get_serial_sequence('${t}','id'), coalesce((select max(id) from ${t}), 1))`
    );
  }
  console.log('  自增序列已重置 ✅');
}

/* ---------- 3) 回验 ---------- */
async function verify(client, rows) {
  let bad = 0;
  const fail = function (m) { bad++; console.log('  ❌ ' + m); };
  const ok = function (m) { console.log('  ✅ ' + m); };

  const c = await client.query(`select
    (select count(*) from posts where status = 'published') as posts,
    (select count(*) from post_images) as images,
    (select count(*) from radio_tracks) as radio`);
  const r = c.rows[0];
  console.log('  条数：已发布文章 ' + r.posts + ' / 图片 ' + r.images + ' / 电台 ' + r.radio);
  if (+r.posts !== rows.posts.length) fail('文章条数不符（期望 ' + rows.posts.length + '）');
  if (+r.images !== rows.images.length) fail('图片条数不符（期望 ' + rows.images.length + '）');
  if (+r.radio !== rows.radio.length) fail('电台条数不符（期望 ' + rows.radio.length + '）');

  /* 归属自检：所有种子行都该挂在导入者名下。
     这条专门盯"owner_id 忘了改写"—— 那会让文章变成无人可编辑的孤儿，
     且后续 --claim 静默失效（PGlite 全链路测试抓到过）。 */
  for (const t of ['posts', 'post_images', 'radio_tracks']) {
    const q = await client.query('select count(*)::int as n from ' + t + ' where owner_id = $1', [OWNER]);
    const want = t === 'posts' ? rows.posts.length : (t === 'post_images' ? rows.images.length : rows.radio.length);
    if (q.rows[0].n !== want) fail(t + ' 里有 ' + (want - q.rows[0].n) + ' 行不属于 ' + OWNER + '（--claim 会漏改）');
    else ok(t + ' 全部 ' + want + ' 行归属 ' + OWNER);
  }

  /* 音频：从库里取回来解码，验 ID3 与 sha256 —— 防"灌进去了但是坏数据"。
     ⚠ 电台已退役（2026-09-30）：rows.radio 为空，这个循环自然不跑；
        但仍然保留它 —— 将来若恢复歌曲，这段校验不用重写。 */
  for (const t of rows.radio) {
    const q = await client.query('select data from radio_tracks where id = $1', [t.id]);
    const dataUrl = q.rows[0] && q.rows[0].data;
    if (!dataUrl) { fail('曲目 #' + t.id + ' 的 data 为空'); continue; }
    const b64 = String(dataUrl).replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(b64, 'base64');
    const id3 = buf.indexOf(Buffer.from('ID3'));
    const local = fs.readFileSync(path.join(APP, 'data', 'radio', t.id + '.mp3'));
    if (id3 !== 0) fail('曲目 #' + t.id + ' 解码后 ID3@' + id3 + '（应为 0）');
    else if (sha256(buf) !== sha256(local)) fail('曲目 #' + t.id + ' 与本地文件 sha256 不一致');
    else ok('曲目 #' + t.id + ' ID3@0 且与本地逐字节一致');
  }
  if (!rows.radio.length) {
    ok('电台：0 首（2026-09-30 起不做歌曲部分，音频已从仓库移除）');
  }

  /* 图片：data 解 base64 后 sha256 应等于索引里的 sha256 */
  const idx = readJson(path.join(SEED, 'images-index.json'));
  for (const m of idx.images) {
    const q = await client.query('select data, width, height from post_images where id = $1', [m.id]);
    const row = q.rows[0];
    if (!row) { fail('图片 #' + m.id + ' 不存在'); continue; }
    const buf = Buffer.from(row.data, 'base64');
    if (sha256(buf) !== m.sha256) fail('图片 #' + m.id + ' sha256 不符');
    else ok('图片 #' + m.id + ' sha256 一致（' + row.width + '×' + row.height + '）');
  }

  /* 读视图：匿名通道（anon 角色）必须能读到已发布内容与图片；电台视图仍在（可能为空） */
  const pub = await client.query(`select count(*)::int as n from public_images`);
  ok('视图 public_images 可见 ' + pub.rows[0].n + ' 张');
  const pr = await client.query(`select count(*)::int as n, count(has_data)::int as playable from public_radio`);
  ok('视图 public_radio 可见 ' + pr.rows[0].n + ' 首（其中 ' + pr.rows[0].playable + ' 首带音频）');

  return bad;
}

/* ---------- 主流程 ----------
   ⚠ 只在「直接运行本文件」时连库执行；被 require 时只导出上面那几个函数。
   为什么要这样切：用 PGlite（WASM 版真 Postgres）可以在**没有 Supabase 项目**时
   把 schema.sql 与本文件的 SQL 真跑一遍（见 _push/tools/test-schema-pglite.js），
   而 PGlite 的 client 没有连接串 —— 它只是个对象，`query(sql, params)` 形状相同。 */
async function main() {
  console.log('=== seed → Supabase ===');
  console.log('  owner_id: ' + OWNER + (CLAIM_UID ? '（本次执行 --claim）' : ''));
  const rows = buildRows();
  console.log('  待写入：' + rows.posts.length + ' 篇文章 / ' + rows.images.length + ' 张图 / ' + rows.radio.length + ' 首电台');
  if (DRY) { console.log('\n[dry] 只组装与校验本地数据，未连库。'); return; }

  if (!DB_URL) { console.error('\n缺少 SUPABASE_DB_URL（数据库连接串）'); process.exit(1); }
  const { Client } = requirePg();
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },   /* Supabase 用平台证书，本地不装 CA 时这样最省事 */
    statement_timeout: 120000
  });
  await client.connect();
  console.log('  已连接 Postgres ✅');

  try {
    if (CLAIM_UID) {
      for (const t of ['posts', 'post_images', 'radio_tracks']) {
        const res = await client.query('update ' + t + ' set owner_id = $1 where owner_id = $2', [CLAIM_UID, OWNER]);
        console.log('  ' + t + ' 归属改写 ' + res.rowCount + ' 行 → ' + CLAIM_UID);
      }
      return;
    }

    if (RESET) {
      console.log('\n[1/4] --reset：先清空旧结构');
      await client.query('drop table if exists posts, post_images, radio_tracks, error_logs cascade');
      await client.query('drop view if exists public_images, public_radio cascade');
      console.log('  已 drop（cascade）✅');
    } else {
      console.log('\n[1/4] 跳过 --reset（保留既有结构）');
    }

    if (!SKIP_SCHEMA && !VERIFY_ONLY) {
      console.log('\n[2/4] 执行 db/schema.sql');
      const sql = fs.readFileSync(SCHEMA, 'utf8');
      await client.query(sql);
      console.log('  表 / 视图 / RLS / 索引 / GRANT 已就位 ✅');
    } else {
      console.log('\n[2/4] 跳过 schema');
    }

    if (!VERIFY_ONLY) {
      console.log('\n[3/4] 灌种子数据');
      await importAll(client, rows);
    } else {
      console.log('\n[3/4] --verify-only：不写数据');
    }

    console.log('\n[4/4] 回验');
    const bad = await verify(client, rows);
    console.log(bad ? '\n✗ 有 ' + bad + ' 项未通过' : '\n✓ 全部通过');
    process.exitCode = bad ? 1 : 0;
  } finally {
    await client.end();
  }
}

module.exports = {
  buildRows: buildRows,
  importAll: importAll,
  verify: verify,
  SCHEMA: SCHEMA,
  main: main
};

if (require.main === module) {
  main().catch(function (e) {
    console.error('\n导入失败：' + (e && e.message || e));
    process.exit(1);
  });
}
