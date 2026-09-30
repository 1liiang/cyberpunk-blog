#!/usr/bin/env node
/* ============================================================
   tools/export-static.js — 静态快照导出（v4.6.0）

   为什么需要它
   ------------------------------------------------------------
   本站内容存在 WorkBuddy 云数据库里，页面靠云 SDK 取数。
   一旦把站点搬到**没有该云端点的环境**（GitHub Pages 等），
   取数会被两道闸同时拦住：

     ① CSP   `connect-src 'self'`  —— 跨源请求直接不发
     ② CORS  云端点按 Origin 白名单放行（只认自己的域名 + localhost，
              *.github.io 一律 403）

   结果就是"界面在、文章全没有"的空壳。绕开这两道闸的唯一办法是
   **让内容也变成同源资源** —— 这就是本脚本的产出：把已发布文章与
   被引用的图片导出到 `data/`，由 js/cloud.js 在云端不可达时自动改读它们。

   产出
   ------------------------------------------------------------
     data/posts.json          已发布文章全文 + 图片索引
     data/images/<id>.<ext>   被文章引用到的图片（原图）

   设计取舍
   ------------------------------------------------------------
   · **只导出被引用的图片**：public_images 里可能有未被任何已发布文章
     引用的图（草稿用图）。全量导出会让仓库白白膨胀，且把未发布素材
     一并公开 —— 那是内容泄露，不只是体积问题。
   · **0 篇时拒绝写入**：接口抖动返回空数组时若无脑覆盖，会把好快照
     擦成空文件。宁可报错让人重跑，也不静默毁数据。
   · **配置从 js/cloud.js 读**：端点与公钥那里已是单一来源，
     这里再抄一份必然会漂移（gen-feed.js 那处重复已是前车之鉴）。

   用法
   ------------------------------------------------------------
     node tools/export-static.js              导出/刷新快照
     node tools/export-static.js --dry-run    只打印不写盘
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLOUD_JS = path.join(ROOT, 'js', 'cloud.js');
const DATA_DIR = path.join(ROOT, 'data');
const IMG_DIR = path.join(DATA_DIR, 'images');

const DRY = process.argv.includes('--dry-run');

/* ---------- 从 js/cloud.js 读端点与公钥（单一来源） ---------- */
function readCloudConfig() {
  const src = fs.readFileSync(CLOUD_JS, 'utf8');
  const ep = /endpoint:\s*'([^']+)'/.exec(src);
  const key = /publishableKey:\s*'([^']+)'/.exec(src);
  if (!ep || !key) throw new Error('无法从 js/cloud.js 解析 endpoint / publishableKey');
  return { endpoint: ep[1].replace(/\/$/, ''), key: key[1] };
}

const { endpoint: ENDPOINT, key: KEY } = readCloudConfig();
const REST = ENDPOINT + '/.cloud/database/rest';

async function rest(pathAndQuery) {
  const res = await fetch(REST + pathAndQuery, {
    headers: { 'x-wb-webapp-access-key': KEY, 'Accept': 'application/json' }
  });
  if (!res.ok) {
    throw new Error('REST ' + res.status + ' ' + pathAndQuery + ' → ' + (await res.text()).slice(0, 200));
  }
  const data = await res.json();
  if (data && !Array.isArray(data) && data.code) {
    throw new Error('REST 错误 ' + data.code + ': ' + data.message);
  }
  return data;
}

/* 从文章正文与封面里抠出所有 cloudimg://N 引用 */
const CLOUDIMG_RE = /cloudimg:\/\/(\d+)/g;
function collectImageIds(posts) {
  const ids = new Set();
  posts.forEach(function (p) {
    [p.content, p.summary, p.cover_ref].forEach(function (s) {
      if (!s) return;
      CLOUDIMG_RE.lastIndex = 0;
      let m;
      while ((m = CLOUDIMG_RE.exec(s))) ids.add(+m[1]);
    });
  });
  return Array.from(ids).sort(function (a, b) { return a - b; });
}

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/* 快照里**不该带**的字段：owner_id 只在登录后的编辑鉴权里用
   （app.js 的 "这条信号不属于你" 判断），公开渲染一律走 owner_name。
   快照是给"没有后端的只读环境"用的 —— 那里根本不存在编辑路径，
   带上它只是白白把一个云端用户 ID 连同文章一起公开出去。
   原则：导出只带**渲染所需**的字段，不照搬整行。 */
const STRIP_FIELDS = ['owner_id'];

function slimPost(p) {
  const out = {};
  Object.keys(p).forEach(function (k) {
    if (STRIP_FIELDS.indexOf(k) === -1) out[k] = p[k];
  });
  return out;
}

/* 与 app.js 的 safeName 同一保守口径：只留字母数字与点 */
function safeExt(contentType, id) {
  const m = EXT_BY_MIME[String(contentType || '').toLowerCase()];
  if (m) return m;
  throw new Error('图片 ' + id + ' 的 MIME 不受支持：' + contentType);
}

async function main() {
  console.log('\nNEON://DIARY 静态快照导出');
  console.log('  端点  ' + ENDPOINT);
  console.log('  模式  ' + (DRY ? 'dry-run（不写盘）' : '写入') + '\n');

  /* ① 已发布文章（全文，字段与 Posts.get 的 select('*') 对齐） */
  const posts = await rest('/posts?select=*&status=eq.published&order=created_at.desc&limit=200');
  if (!Array.isArray(posts)) throw new Error('posts 返回的不是数组：' + JSON.stringify(posts).slice(0, 200));
  if (posts.length === 0) {
    /* 不静默覆盖 —— 空快照比旧快照更糟（旧快照至少还能看） */
    throw new Error('云端返回 0 篇已发布文章。为避免把好快照擦成空文件，本次不写入。');
  }
  console.log('  文章  ' + posts.length + ' 篇');
  posts.forEach(function (p) {
    console.log('        #' + String(p.id).padEnd(4) + ' ' + p.title);
  });

  /* ② 只取被引用到的图片 */
  const imgIds = collectImageIds(posts);
  console.log('\n  图片  引用 ' + imgIds.length + ' 张：' + (imgIds.join(', ') || '（无）'));

  const images = {};
  const files = [];
  for (const id of imgIds) {
    const rows = await rest('/public_images?select=id,content_type,data,width,height&id=eq.' + id + '&limit=1');
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.data) {
      console.warn('        ⚠ 图片 ' + id + ' 取不到，跳过（文章里会显示 [图片丢失]）');
      continue;
    }
    const ext = safeExt(row.content_type, id);
    const file = 'images/' + id + '.' + ext;
    const buf = Buffer.from(row.data, 'base64');
    images[String(id)] = { file: file, w: row.width || null, h: row.height || null, type: row.content_type };
    files.push({ path: path.join(DATA_DIR, file), buf: buf });
    console.log('        #' + String(id).padEnd(4) + ' ' + row.content_type + '  ' +
      (buf.length / 1024).toFixed(0) + ' KB  ' +
      (row.width && row.height ? row.width + 'x' + row.height : '尺寸未知'));
  }

  /* ③ 组装快照 */
  const snapshot = {
    exportedAt: new Date().toISOString(),
    source: ENDPOINT,
    note: '由 tools/export-static.js 生成 —— 供云端不可达时（如 GitHub Pages）同源读取。勿手改。',
    posts: posts.map(slimPost),
    images: images
  };
  const json = JSON.stringify(snapshot, null, 2);

  const totalImg = files.reduce(function (s, f) { return s + f.buf.length; }, 0);
  console.log('\n  产出  data/posts.json  ' + (Buffer.byteLength(json) / 1024).toFixed(0) + ' KB');
  console.log('        data/images/     ' + files.length + ' 个文件  ' + (totalImg / 1024).toFixed(0) + ' KB');

  if (DRY) {
    console.log('\n  --dry-run：未写入任何文件。\n');
    return;
  }

  fs.mkdirSync(IMG_DIR, { recursive: true });
  /* 先清掉旧图 —— 图片被文章取消引用后，残留文件会一直躺在仓库里 */
  fs.readdirSync(IMG_DIR).forEach(function (f) {
    if (/^\d+\.(png|jpg|gif|webp)$/.test(f)) {
      const keep = files.some(function (x) { return path.basename(x.path) === f; });
      if (!keep) {
        fs.unlinkSync(path.join(IMG_DIR, f));
        console.log('        清理旧图 ' + f);
      }
    }
  });
  files.forEach(function (f) { fs.writeFileSync(f.path, f.buf); });
  fs.writeFileSync(path.join(DATA_DIR, 'posts.json'), json, 'utf8');

  console.log('\n✓ 快照已写入 data/\n');
}

main().catch(function (e) {
  console.error('\n✗ 导出失败：' + (e && e.message || e) + '\n');
  process.exit(1);
});
