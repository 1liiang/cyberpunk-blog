#!/usr/bin/env node
/* ============================================================
   tools/export-static.js — 静态快照导出（v4.6.0）

   为什么需要它
   ------------------------------------------------------------
   本站内容存在 Supabase（Postgres + PostgREST）。页面走云 SDK 取数，
   快照则服务两类场景：

     ① **兜底**：Supabase 连不上时（免费档长期无请求会被暂停、额度用尽、
        网络故障）站点自动改读 `data/`，界面与文章照常在。
     ② **零后端托管**：任何静态托管都能只靠 `data/` 把"能看能听"跑起来。

   ⚠ 迁移到 Supabase 后有一处结论变了：**旧平台按 Origin 白名单放行，
     *.github.io 一律 403；Supabase 不设这道闸**（浏览器直连是它的正常用法）。
     于是放开了 CSP 的 `connect-src` 之后，GitHub Pages 也能**直连** Supabase ——
     快照从"唯一出路"退化为"兜底"。两者并存，代价只是每 6 小时一次的增量同步。

   产出
   ------------------------------------------------------------
     data/posts.json          已发布文章全文 + 图片索引 + 电台条目元数据
     data/images/<id>.<ext>   被文章引用到的图片（原图）

   ⚠ v5.6.2（审计清单 D）：**电台音频不再落地** —— 曲目改成网易云条目后，
     播放地址是行里的 `source_url`（官方 outchain 播放器 iframe），站点侧没有音频本体。
     原来那套 base64 解码 + `data/radio/<id>.<ext>` + `--force-audio` 增量逻辑
     已整块删除；`data/radio/` 目录与清理逻辑也一并去掉
     （2026-09-30 站长已决定"不做歌曲部分"，3 首商业歌曲与其音频早已移出仓库）。

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
/* Supabase 的 PostgREST 数据面。查询串语法与旧平台同源（都是 PostgREST），
   所以 ?select= / eq. / order= / limit= 这些一律照旧 —— 换的只是前缀与鉴权头。 */
const REST = ENDPOINT + '/rest/v1';

async function rest(pathAndQuery) {
  const res = await fetch(REST + pathAndQuery, {
    headers: {
      /* anon key 走这两颗头（Supabase 的约定）：apikey 做项目识别，
         Authorization 让 PostgREST 以 anon 角色执行 —— RLS 决定能看到什么。 */
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      Accept: 'application/json'
    }
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

/* ⚠⚠ 快照必须是**确定性产物** —— 这条是被实测逼出来的：
   `exportedAt` 每次运行都变，原样写入的话，每次同步都会产生一个
   「内容其实没变」的提交。实测第一次 workflow 跑完就产出了这样一个提交
   （diff 只有 exportedAt 一行），也就是**每 6 小时污染一次提交历史** ——
   正是 workflow 里那句"无变更不提交"想避免的事，却被这里的时间戳废掉了。

   做法：比对时忽略 exportedAt；**没有实质变化就不碰文件**。
   于是那个时间戳的含义变成"最后一次真正变化的时间"，而不是"最后一次跑的时间"
   —— 后者没有价值，前者有。

   （data/radio 与 data/images 是逐字节写入，内容相同时 git 自然看不到差异，
     所以只有这个 JSON 需要这层保护。） */
const VOLATILE_LINE = /"exportedAt":\s*"[^"]*",?\n?/;

function writeSnapshotIfChanged(file, obj) {
  const next = JSON.stringify(obj, null, 2);
  let prev = null;
  try { prev = fs.readFileSync(file, 'utf8'); } catch (e) { /* 首次运行 */ }
  if (prev !== null && prev.replace(VOLATILE_LINE, '') === next.replace(VOLATILE_LINE, '')) {
    return false;
  }
  fs.writeFileSync(file, next, 'utf8');
  return true;
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

  /* ③ 电台：**只导条目元数据**（v5.6.2 重写，审计清单 D）。
     ⚠ 旧的音频落地那套（逐首拉 base64 → 剥前缀解码 → 写 data/radio/<id>.<ext>，
       以及靠「本地同尺寸就跳过下载」省额度的增量逻辑）已整块删除：
       v5 的条目播放地址就是行里的 source_url（网易云官方 outchain iframe），
       站点侧没有音频本体可落地 —— 原实现还 select 了 data/mime/size_bytes/has_data
       这些**服务端已删除的列**，一旦真去查询会整轮导不出快照。
     ⚠ 条目必须**照原字段导出**（含 kind / netease_id / source_url）——
       它们在云端不可达时是电台页与常驻控制台的唯一数据来源。 */
  const radioRows = await rest('/public_radio?select=' + RADIO_FIELDS +
    '&order=sort_order.asc,id.asc&limit=200');
  const radio = Array.isArray(radioRows) ? radioRows : [];
  if (radio.length) {
    console.log('\n  电台  ' + radio.length + ' 条：');
    radio.forEach(function (row) {
      console.log('        #' + String(row.id).padEnd(4) + ' ' +
        String(row.title || '').slice(0, 24).padEnd(26) +
        (row.kind === 'playlist' ? '歌单 ' : '单曲 ') + String(row.netease_id || ''));
    });
  } else {
    console.log('\n  电台  （无条目）');
  }


  /* ④ 组装快照 */
  const snapshot = {
    exportedAt: new Date().toISOString(),
    source: ENDPOINT,
    note: '由 tools/export-static.js 生成 —— 供云端不可达时（如 GitHub Pages）同源读取。勿手改。',
    posts: posts.map(slimPost),
    images: images,
  };
  const json = JSON.stringify(snapshot, null, 2);

  const totalImg = files.reduce(function (s, f) { return s + f.buf.length; }, 0);
  console.log('\n  产出  data/posts.json  ' + (Buffer.byteLength(json) / 1024).toFixed(0) + ' KB');
  console.log('        data/images/     ' + files.length + ' 个文件  ' + (totalImg / 1024).toFixed(0) + ' KB');
  /* ⚠ v5.6.2：不再打印 data/radio/ 那行 —— 音频落地已取消（条目只存元数据） */

  if (DRY) {
    console.log('\n  --dry-run：未写入任何文件。\n');
    return;
  }

  fs.mkdirSync(IMG_DIR, { recursive: true });
  /* 清掉旧图 —— 图片被文章取消引用后，残留文件会一直躺在仓库里 */
  fs.readdirSync(IMG_DIR).forEach(function (f) {
    if (/^\d+\.(png|jpg|gif|webp)$/.test(f)) {
      const keep = files.some(function (x) { return path.basename(x.path) === f; });
      if (!keep) {
        fs.unlinkSync(path.join(IMG_DIR, f));
        console.log('        清理旧图 ' + f);
      }
    }
  });
  /* ⚠ v5.6.2：电台那条"清理旧曲"已删除（不再落地音频）。
     若 data/radio/ 目录里还有历史残留文件，那是 2026-09-30 之前的东西，
     **不要**在本脚本里顺手删 —— 删仓库文件是独立的一次性动作，不该藏在快照导出里。 */
  files.forEach(function (f) { fs.writeFileSync(f.path, f.buf); });
  const snapChanged = writeSnapshotIfChanged(path.join(DATA_DIR, 'posts.json'), snapshot);
  console.log(snapChanged
    ? '  快照有实质变化 → 已更新'
    : '  快照无实质变化 → 保持原文件（时间戳不刷新，避免空提交）');

  /* ⚠ 末行必须**如实**反映发生了什么。
     原先无条件打印「✓ 快照已写入 data/」—— 排查幂等性时被它误导过一次：
     同一脚本连跑两次，第二次明明「无实质变化、未写盘」，日志看起来却像又写了一遍。
     （CI 每 6 小时跑它，日志是判断"到底提没提交"的第一依据，不能含糊。） */
  console.log(snapChanged
    ? '\n✓ 快照内容已更新并写入 data/\n'
    : '\n✓ data/ 已是最新，无需改动（文件未被触碰）\n');
}

main().catch(function (e) {
  console.error('\n✗ 导出失败：' + (e && e.message || e) + '\n');
  process.exit(1);
});
