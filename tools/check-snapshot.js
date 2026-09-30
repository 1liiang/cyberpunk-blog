#!/usr/bin/env node
/* ============================================================
   check-snapshot.js — 静态快照自洽性检查（迁移包新增）

   为什么需要它
   ------------------------------------------------------------
   只读模式（GitHub Pages / 任意静态托管）下，站点的内容来源是
   data/ 快照。快照若不自洽（引用的图不存在 / 音频文件头坏了），
   站点表现为"界面在、内容缺"——本脚本把这类问题在迁移前后
   一分钟内查清，不依赖浏览器、不依赖云端。

   检查项
   ------------------------------------------------------------
     ① data/posts.json 可解析且 posts 非空
     ② 每篇（含 summary / cover_ref / content）引用的 cloudimg://N
        都在 images 索引中，且对应文件存在
     ③ 电台每条 file 字段指向的文件存在，且文件头是标准 MP3
        （ID3 魔数在偏移 0，或 0xFF 帧同步 —— 15 字节垃圾前缀即在此暴露）

   用法（在 app/ 目录下）
   ------------------------------------------------------------
     node tools/check-snapshot.js
     退出码：0 = 全部通过；1 = 有问题（详情打印）
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
let failed = 0;
function bad(msg) { failed++; console.log('  ❌ ' + msg); }
function ok(msg) { console.log('  ✅ ' + msg); }

try {
  /* ① posts.json */
  const snapPath = path.join(DATA, 'posts.json');
  if (!fs.existsSync(snapPath)) { bad('data/posts.json 不存在'); process.exit(1); }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  if (!Array.isArray(snap.posts) || !snap.posts.length) { bad('posts.json 的 posts 为空'); }
  else ok('posts.json 可解析：' + snap.posts.length + ' 篇文章');

  /* ② 图片引用 */
  const images = snap.images || {};
  const refRe = /cloudimg:\/\/(\d+)/g;
  let refTotal = 0;
  snap.posts.forEach(function (p) {
    [p.content, p.summary, p.cover_ref].forEach(function (s) {
      if (!s) return;
      refRe.lastIndex = 0;
      let m;
      while ((m = refRe.exec(s))) {
        refTotal++;
        const id = m[1];
        const meta = images[id];
        if (!meta) { bad('文章 #' + p.id + ' 引用图片 ' + id + '，但 images 索引中没有'); return; }
        const f = path.join(DATA, 'images', String(meta.file || '').replace(/^images\//, ''));
        if (!fs.existsSync(f)) bad('图片 ' + id + ' 的文件缺失：' + meta.file);
      }
    });
  });
  ok('图片引用检查：共 ' + refTotal + ' 处引用，无缺失' + (failed ? '（见上）' : ''));

  /* ③ 电台文件 */
  const radio = snap.radio || [];
  radio.forEach(function (t) {
    if (!t.file) { bad('曲目 #' + t.id + ' 没有 file 字段'); return; }
    const f = path.join(DATA, String(t.file).replace(/^data\//, ''));
    if (!fs.existsSync(f)) { bad('曲目 #' + t.id + ' 文件缺失：' + t.file); return; }
    const head = fs.readFileSync(f).subarray(0, 16);
    const isID3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;   /* 'ID3' */
    const isSync = head[0] === 0xFF && (head[1] & 0xE0) === 0xE0;            /* MPEG 帧同步 */
    const id3At = fs.readFileSync(f).indexOf('ID3', 0, 'utf8');
    if (!isID3 && !isSync) bad('曲目 #' + t.id + ' 文件头异常（非 MP3？）：' + t.file);
    else if (!isID3 && id3At > 0) bad('曲目 #' + t.id + ' 含前导垃圾（ID3 在偏移 ' + id3At + '，应为 0）：' + t.file);
    else ok('曲目 #' + t.id + ' ' + t.title + '  文件头正常（' + (isID3 ? 'ID3@0' : '帧同步') + '）');
  });

  console.log(failed ? '\n✗ 发现 ' + failed + ' 个问题' : '\n✓ 快照自洽，全部通过');
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error('✗ 检查失败：' + e.message);
  process.exit(1);
}
