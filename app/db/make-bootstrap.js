#!/usr/bin/env node
/* ============================================================
   db/make-bootstrap.js — 生成"粘进 SQL Editor 就能建库"的自包含 SQL

   为什么需要它：后端结构在 `schema.sql` 里，但**数据**在 `data/` 快照里
   （文章、图片 base64、电台元数据）。新环境重建时，把两者拼成可直接执行的
   文件最省事 —— 不必去翻 seed、也不必手工把 base64 粘出来。

   产出（写到本目录）：
     bootstrap-1-schema-posts.sql   结构 + 已发布文章 + 序列重置（约 16KB）
     bootstrap-2-images.sql         被文章引用到的图片（base64，可能几 MB）
   ⚠ 第 2 个文件体积取决于图片，故**不进版本库**（.gitignore 已排除，见 README）。

   用法：node db/make-bootstrap.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const DB = __dirname;
const ROOT = path.join(DB, '..');
const DATA = path.join(ROOT, 'data');
const OWNER = process.env.NEON_OWNER_ID || 'legacy-import';
const TAG = '$neon$';                     /* 美元引用：正文里的引号/换行/反斜杠都不用转义 */
const q = s => TAG + String(s == null ? '' : s) + TAG;

const snap = JSON.parse(fs.readFileSync(path.join(DATA, 'posts.json'), 'utf8'));
const schema = fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8');

/* ---------- 1) 结构 + 文章 ---------- */
const head = [
  '-- ============================================================',
  '-- NEON://DIARY — 建库第 1 步：结构 + 文章（由 db/make-bootstrap.js 生成）',
  '-- ------------------------------------------------------------',
  '-- 用法：Supabase → SQL Editor → New query → 全文粘贴 → Run',
  '-- 幂等：文章用 on conflict (id) do update；但 schema 里的 create policy 不幂等，',
  '--       重复执行会报 "policy ... already exists"（正常，说明结构已建好）。',
  '-- 第 2 步：再跑 bootstrap-2-images.sql',
  '-- ============================================================',
  '',
  '-- ==== 第 1 段：结构（db/schema.sql 原文）====',
  schema.trim(),
  '',
  '-- ==== 第 2 段：已发布文章 ====',
  '-- owner_id 统一写 ' + OWNER + '（站长注册后用 --claim 或一句 UPDATE 改归自己）',
  ''
].join('\n');

const postSql = (snap.posts || []).map(p => [
  'insert into posts (id, owner_id, owner_name, title, summary, content, tags, cover_ref, status, created_at, updated_at) values (',
  '  ' + p.id + ', ' + q(OWNER) + ', ' + (p.owner_name ? q(p.owner_name) : 'null') + ',',
  '  ' + q(p.title) + ',',
  '  ' + (p.summary ? q(p.summary) : 'null') + ',',
  '  ' + q(p.content || '') + ',',
  '  ' + q(JSON.stringify(p.tags || [])) + '::jsonb,',
  '  ' + (p.cover_ref ? q(p.cover_ref) : 'null') + ', ' + q(p.status || 'published') + ',',
  '  ' + q(p.created_at) + '::timestamptz, ' + q(p.updated_at || p.created_at) + '::timestamptz',
  ') on conflict (id) do update set owner_id = excluded.owner_id, owner_name = excluded.owner_name,',
  '  title = excluded.title, summary = excluded.summary, content = excluded.content, tags = excluded.tags,',
  '  cover_ref = excluded.cover_ref, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at;',
  ''
].join('\n')).join('\n');

const tail = [
  '',
  '-- ==== 第 3 段：自增序列（不重置的话，发的第一篇新文会撞主键）====',
  "select setval(pg_get_serial_sequence('posts','id'),        coalesce((select max(id) from posts), 1));",
  "select setval(pg_get_serial_sequence('post_images','id'),  coalesce((select max(id) from post_images), 1));",
  "select setval(pg_get_serial_sequence('radio_tracks','id'), coalesce((select max(id) from radio_tracks), 1));",
  '',
  "select 'posts=' || (select count(*) from posts) || ' published=' || (select count(*) from posts where status='published') as 结果;",
  ''
].join('\n');
fs.writeFileSync(path.join(DB, 'bootstrap-1-schema-posts.sql'), head + postSql + tail);
console.log('  bootstrap-1-schema-posts.sql  ' + ((head + postSql + tail).length / 1024).toFixed(1) + ' KB  ' +
  (snap.posts || []).length + ' 篇文章');

/* ---------- 2) 图片（只导被引用到的） ---------- */
const refRe = /cloudimg:\/\/(\d+)/g;
const referenced = new Set();
(snap.posts || []).forEach(p => {
  [p.content, p.summary, p.cover_ref].forEach(s => {
    if (!s) return;
    refRe.lastIndex = 0;
    let m; while ((m = refRe.exec(s))) referenced.add(m[1]);
  });
});

const out = [
  '-- ============================================================',
  '-- NEON://DIARY — 建库第 2 步：图片（由 db/make-bootstrap.js 生成）',
  '-- ------------------------------------------------------------',
  '-- 只含**被文章引用到**的图片：' + [...referenced].map(i => '#' + i).join(', ') || '（无）',
  '-- ⚠ 本文件较大（base64），故不进版本库；换环境时现跑生成器即可。',
  '-- ============================================================',
  ''
];
let bytes = 0;
[...referenced].forEach(id => {
  const meta = (snap.images || {})[id];
  if (!meta || !meta.file) { out.push('-- ⚠ 图片 ' + id + ' 在快照索引里没有，跳过'); return; }
  const file = path.join(DATA, String(meta.file).replace(/^data\//, ''));
  if (!fs.existsSync(file)) { out.push('-- ⚠ 图片文件缺失：' + meta.file + '，跳过'); return; }
  const buf = fs.readFileSync(file);
  bytes += buf.length;
  out.push('-- #' + id + '  ' + (meta.type || 'image/png') + '  ' + (meta.w || '?') + 'x' + (meta.h || '?') + '  ' + (buf.length / 1024).toFixed(0) + ' KB');
  out.push('insert into post_images (id, owner_id, content_type, data, thumb, width, height, size_bytes, created_at) values (');
  out.push('  ' + id + ', ' + q(OWNER) + ', ' + q(meta.type || 'image/png') + ',');
  out.push('  ' + q(buf.toString('base64')) + ',');
  out.push('  null, ' + (meta.w || 'null') + ', ' + (meta.h || 'null') + ', ' + buf.length + ', ' + q('2026-09-28T01:23:18.580824+08:00') + '::timestamptz');
  out.push(') on conflict (id) do update set owner_id = excluded.owner_id, content_type = excluded.content_type,');
  out.push('  data = excluded.data, thumb = excluded.thumb, width = excluded.width, height = excluded.height,');
  out.push('  size_bytes = excluded.size_bytes, created_at = excluded.created_at;');
  out.push('');
});
out.push("select setval(pg_get_serial_sequence('post_images','id'), coalesce((select max(id) from post_images), 1));");
out.push("select '文章 ' || (select count(*) from posts) || ' 篇 / 图片 ' || (select count(*) from public_images) || ' 张' as 建库结果;");
const body = out.join('\n');
fs.writeFileSync(path.join(DB, 'bootstrap-2-images.sql'), body);
console.log('  bootstrap-2-images.sql        ' + (body.length / 1024 / 1024).toFixed(2) + ' MB  ' +
  referenced.size + ' 张图（原始 ' + (bytes / 1024 / 1024).toFixed(2) + ' MB）');
console.log('\n用法见 db/README.md（也可以走 Management API 自动跑，见仓库外的 _push/tools/mgmt-run.js）');
