'use strict';
/* ============================================================
   tests/cases/51-v4-6-0-static-fallback.js — v4.6.0 静态快照回退

   为什么要这一层（背景）
   ------------------------------------------------------------
   把站点搬到非本站域名（GitHub Pages）时，云取数会被两道闸同时拦：
     ① CSP  connect-src 'self'  —— 跨源请求浏览器直接不发
     ② CORS 云端点按 Origin 白名单放行（*.github.io → 403）
   于是页面变成"界面在、文章全没有"的空壳。
   解法：tools/export-static.js 把已发布内容导出到同源 data/，
        cloud.js 在云端不可达时改读它。

   本 case 守四件事
   ------------------------------------------------------------
     ① 产出在位且同源：data/posts.json 存在、格式合规、图片文件真的存在
     ② 回退只在导出边界：不改 Posts/Images 内部逻辑（生产路径零改动）
     ③ 只包**读**路径：写路径（登录/发文/上传）不许被包 ——
        假成功比明确失败更糟（用户以为发出去了）
     ④ 快照也失败时抛**原始错误**：根因不能被后果盖掉
        （这条是被 noSDK / noAllCDN 两条既有断言逼出来的，见测试头部）
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, stripComments } = require('../common');
const { ROOT } = require('../common');
const fs = require('fs');
const path = require('path');

const SNAPSHOT = path.join(ROOT, 'data', 'posts.json');
const DATA_DIR = path.join(ROOT, 'data');

function readSnapshot() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')); } catch (e) { return null; }
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const cloud = stripComments(SRC.cloud);
  const exp = fs.existsSync(path.join(ROOT, 'tools', 'export-static.js'))
    ? fs.readFileSync(path.join(ROOT, 'tools', 'export-static.js'), 'utf8') : '';

  /* ================= ① 产出入库（快照文件真的在、且自洽） ================= */
  {
    const CN = 'v4.6 静态回退';
    const snap = readSnapshot();

    T(CN, 'R249 data/posts.json 在位且格式合规（posts 数组 + images 映射 + 来源记录）',
      !!snap && Array.isArray(snap.posts) && snap.images && typeof snap.images === 'object' &&
      typeof snap.exportedAt === 'string' && typeof snap.source === 'string',
      snap ? ('posts=' + snap.posts.length + ' images=' + Object.keys(snap.images).length +
        ' exportedAt=' + snap.exportedAt) : '快照文件缺失或不是合法 JSON');

    /* 空快照 = 白部署。这条防的是"导出脚本跑挂了但没报错就提交了" */
    T(CN, 'R249b 快照非空（0 篇会让 GitHub Pages 依旧是空壳）',
      !!snap && snap.posts.length > 0,
      snap ? snap.posts.length + ' 篇' : '-');

    /* 图片索引里的每个 file 都必须真的存在 —— 索引与文件不同步时，
       页面会指向 404，而快照本身"看起来"完全正常（最难查的那种） */
    const missing = [];
    if (snap && snap.images) {
      Object.keys(snap.images).forEach(function (id) {
        const f = snap.images[id].file;
        if (!f || !fs.existsSync(path.join(DATA_DIR, f))) missing.push(id + '→' + f);
      });
    }
    T(CN, 'R249c 图片索引与实际文件一致（无指向 404 的悬空引用）',
      missing.length === 0,
      missing.length ? ('悬空：' + missing.join(', ')) : '全部落地');

    /* 文章里引用的 cloudimg:// 必须在 images 里有对应项，否则详情页缺图 */
    const refs = new Set();
    if (snap && Array.isArray(snap.posts)) {
      const RE = /cloudimg:\/\/(\d+)/g;
      snap.posts.forEach(function (p) {
        [p.content, p.summary, p.cover_ref].forEach(function (s) {
          if (!s) return;
          RE.lastIndex = 0;
          let m;
          while ((m = RE.exec(s))) refs.add(m[1]);
        });
      });
    }
    const unresolved = Array.from(refs).filter(function (id) {
      return !snap.images || !snap.images[id];
    });
    T(CN, 'R249d 文章引用的每张图都已导出（详情页不会出现 [图片丢失]）',
      unresolved.length === 0,
      unresolved.length ? ('未导出：' + unresolved.join(', ')) : ('引用 ' + refs.size + ' 张，全部就位'));

    /* 快照是"给没有后端的只读环境"用的 —— 那里不存在编辑路径，
       所以 owner_id（只在登录后的编辑鉴权里用）不该随文章一起公开。
       导出只带渲染所需字段，不照搬整行。

       ⚠ 这里必须**同时**守产物与生产者：首版只查了产物（data/posts.json 里
       没有 owner_id），反向验证当场抓出假绿 —— 把脚本里的裁剪去掉，
       已有文件当然不会变，断言照样绿。
       生产者一侧用"真跑那个函数"而不是"查源码里有没有这个词"：
       从脚本抽出 slimPost 后求值，直接喂它一行含 owner_id 的行看结果。 */
    const hasOwnerId = !!(snap && Array.isArray(snap.posts) &&
      snap.posts.some(function (p) { return 'owner_id' in p; }));
    T(CN, 'R249e 快照产物已裁掉 owner_id（不公开云端用户 ID）',
      !hasOwnerId && !/owner_id/.test(fs.readFileSync(SNAPSHOT, 'utf8')),
      hasOwnerId ? '⚠ 仍含 owner_id' : '已裁掉');

    /* 生产者行为：把脚本里的 slimPost 抽出来真跑一遍 */
    let producerOk = false, producerHow = '';
    try {
      const block = /const STRIP_FIELDS = \[[^\]]*\];[\s\S]*?function slimPost\(p\)\s*\{[\s\S]*?\n\}/.exec(exp);
      if (!block) throw new Error('抽不到 slimPost 定义');
      /* eslint-disable no-new-func */
      const slimPost = new Function(block[0] + '\nreturn slimPost;')();
      const row = { id: 1, title: 't', owner_id: '1234567890', owner_name: '漓江' };
      const out = slimPost(row);
      producerOk = !('owner_id' in out) && out.owner_name === '漓江' && out.title === 't';
      producerHow = JSON.stringify(Object.keys(out));
      /* 原行不许被就地改写（slimPost 应当是纯函数，不动入参） */
      producerOk = producerOk && row.owner_id === '1234567890';
    } catch (e) {
      producerHow = '抽取失败：' + (e && e.message || e);
    }
    T(CN, 'R249f 导出脚本的 slimPost 真跑一遍：剥掉 owner_id、保留渲染字段、不改动入参',
      producerOk,
      producerHow);

    /* ⚠⚠ 必须**同时**钉调用点 —— 上面那条只证明"函数本身会剥"，
       证明不了"构建快照时真的调了它"。
       反向验证实锤：把 `posts.map(slimPost)` 改回 `posts`，
       R249f 照样绿（函数还在、还能跑，只是没人用）。
       这正是本项目反复踩过的"钉定义不钉调用"——第二次栽在同一个坑里。 */
    T(CN, 'R249g 快照构建**确实调用了** slimPost（钉调用点，不是钉函数定义）',
      /posts:\s*posts\.map\(slimPost\)/.test(exp),
      /posts:\s*posts\.map\(slimPost\)/.test(exp) ? '调用点在位' :
        (/posts:\s*posts[,}]/.test(exp) ? '⚠ 构建时直接用了原行（裁剪形同虚设）' : '未找到构建点'));
  }

  /* ================= ② 实现纪律（回退在边界，不动内部） ================= */
  {
    const CN = 'v4.6 回退纪律';

    T(CN, 'R250 cloud.js 提供回退包装 withFallback（先真身、抛错才落快照）',
      /function withFallback\(/.test(cloud) &&
      /real\[k\]\.apply\(real, arguments\)/.test(cloud) &&
      /backup\[k\]\.apply\(backup, arguments\)/.test(cloud),
      'withFallback 结构');

    T(CN, 'R250b 只包读路径：listPublished / get / tagStats / fetchMany 四个，写路径不被包',
      /withFallback\(Posts, StaticPosts, \['listPublished', 'get', 'tagStats'\]\)/.test(cloud) &&
      /withFallback\(Images, StaticImages, \['fetchMany'\]\)/.test(cloud) &&
      !/withFallback\(Auth/.test(cloud) &&
      !/withFallback\(Storage/.test(cloud) &&
      !/create|update|remove|insert/.test(
        (/withFallback\([^)]*\[([^\]]*)\]/.exec(cloud) || [, ''])[1]),
      '只读四路');

    /* ⚠ 这条是 v4.6.0 的核心设计决策：快照也失败要抛原始错误。
       它保护的是"降级提示文案不被静默改掉"（noSDK / noAllCDN 两条既有断言）。 */
    T(CN, 'R250c 快照也失败时抛**原始错误**（根因不被后果盖掉）',
      /catch \(e2\) \{\s*throw e;\s*\}/.test(cloud),
      /catch \(e2\)/.test(cloud) ? '已区分' : '未区分（会把根因盖成"快照不可用"）');

    /* 进入快照模式必须**确认可用之后**才置位 —— 否则一次网络抖动
       会把整个会话永久钉死在静态模式上（云明明已经恢复） */
    T(CN, 'R250d snapshotMode 在回退**成功之后**才置位（不在失败时抢跑）',
      /var r = await backup\[k\]\.apply\(backup, arguments\);\s*snapshotMode = true;/.test(cloud),
      '置位时机');

    T(CN, 'R250e 暴露 isSnapshot()/SNAPSHOT_URL 供应用层与测试观察',
      /isSnapshot: function \(\) \{ return snapshotMode; \}/.test(cloud) &&
      /SNAPSHOT_URL: SNAPSHOT_URL/.test(cloud),
      '导出项');

    /* 快照的排序/过滤口径必须与云端一致，否则分页结果会不同 */
    T(CN, 'R250f 快照列表沿用云端口径：created_at 倒序 + tags 过滤 + range 分页',
      /localeCompare\(String\(a\.created_at/.test(cloud) &&
      /indexOf\(tag\) !== -1/.test(cloud) &&
      /all\.slice\(from, from \+ pageSize\)/.test(cloud),
      '排序/过滤/分页');

    /* dims 是同步接口，不能套 async 包装 */
    T(CN, 'R250g dims 走同步合成（不能套 async 包装，否则返回 Promise 破坏调用方）',
      /function dimsWithFallback\(id\)/.test(cloud) &&
      /realDims\.call\(Images, id\)/.test(cloud),
      '同步合成');
  }

  /* ================= ③ 导出脚本自身纪律 ================= */
  {
    const CN = 'v4.6 导出脚本';

    T(CN, 'R251 导出脚本从 js/cloud.js 读端点与公钥（不重复硬编码，避免漂移）',
      /readCloudConfig/.test(exp) &&
      /endpoint:\\s\*'\(\[\^'\]\+\)'/.test(exp) &&
      /publishableKey:\\s\*'\(\[\^'\]\+\)'/.test(exp) &&
      !/wbpk_/.test(exp),
      /wbpk_/.test(exp) ? '脚本里又抄了一份公钥' : '单一来源');

    T(CN, 'R251b 0 篇时拒绝写入（防接口抖动把好快照擦成空文件）',
      /posts\.length === 0/.test(exp) &&
      /throw new Error\('云端返回 0 篇/.test(exp),
      '空数据保护');

    T(CN, 'R251c 只导出**被引用**的图片（未引用的草稿素材不该被公开）',
      /function collectImageIds/.test(exp) &&
      /collectImageIds\(posts\)/.test(exp) &&
      /未发布素材|草稿用图/.test(exp),
      '引用收集');

    /* 上面那条正则里的中文匹配写得太绕，改为直接钉函数名与调用点 */
    T(CN, 'R251d 清理旧图：取消引用后不留残骸在仓库里',
      /readdirSync\(IMG_DIR\)/.test(exp) && /清理旧图/.test(exp),
      '旧图清理');
  }

  /* ================= ④ 行为验证：云端抛错 → 真的回退到快照 ================= */
  {
    const CN = 'v4.6 回退行为';

    /* ⚠ 首跑教训：默认的 bootDom **自带云端桩**（fixtures），
       于是"云端抛错"根本没发生 —— 断言全落到了桩数据上（5 篇 fixture），
       看起来"回退成功"，其实一行回退代码都没走到。
       必须用 noSDK:true 把云端彻底摘掉，才是 GitHub Pages 的真实处境。
       （真实浏览器验证已独立证明回退可用；这里是让它在门禁里也守得住。） */
    const ctx = bootDom({ url: 'https://x.test/#/', noSDK: true });
    const w = ctx.w;

    const calls = [];
    w.fetch = function (url) {
      calls.push(String(url));
      if (String(url).indexOf('data/posts.json') === 0) {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve(readSnapshot()); }
        });
      }
      return Promise.reject(new Error('CSP 拦截：跨源请求被拒绝'));
    };

    let listed = null, got = null, tags = null, err = null;
    try {
      listed = await w.NEON.Posts.listPublished({ page: 1, pageSize: 10 });
      got = await w.NEON.Posts.get(4);
      tags = await w.NEON.Posts.tagStats();
    } catch (e) { err = String(e && e.message || e); }

    const snapForCount = readSnapshot();

    T(CN, 'R252 云端不可用 → listPublished 回退到快照并返回 {posts,total} 同形状',
      !err && listed && Array.isArray(listed.posts) &&
      listed.total === listed.posts.length &&
      listed.posts.length === snapForCount.posts.length,
      err ? ('抛错：' + err) : (listed ? (listed.posts.length + ' 篇 / total=' + listed.total) : 'null'));

    T(CN, 'R252b 回退后 get(id) 能取到快照里的正文（详情页可用）',
      !!got && got.id === 4 && typeof got.content === 'string' && got.content.length > 0,
      got ? ('id=' + got.id + ' contentLen=' + (got.content || '').length) : 'null');

    T(CN, 'R252c 回退后 tagStats 由快照聚合（侧栏频段不为空）',
      !!tags && Object.keys(tags).length > 0,
      tags ? JSON.stringify(tags) : 'null');

    T(CN, 'R252d 回退后 isSnapshot() 转为 true，且只取过一次快照（并发去重）',
      w.NEON.isSnapshot() === true &&
      calls.filter(function (u) { return u.indexOf('data/posts.json') === 0; }).length === 1,
      'isSnapshot=' + w.NEON.isSnapshot() + ' 快照请求次数=' +
        calls.filter(function (u) { return u.indexOf('data/posts.json') === 0; }).length);

    /* 图片回退：返回的是**同源相对路径**，不是 data URL
       —— 两者浏览器都能用，但相对路径省掉了把 1.5MB base64 塞进 JSON */
    let imgMap = null, imgErr = null;
    try { imgMap = await w.NEON.Images.fetchMany([2]); }
    catch (e) { imgErr = String(e && e.message || e); }
    T(CN, 'R252e 图片回退返回同源相对路径（不把图塞成 base64）',
      !imgErr && imgMap && String(imgMap.get(2) || '').indexOf('data/images/') === 0,
      imgErr || (imgMap ? String(imgMap.get(2)) : 'null'));

    /* 反向面：快照**也**拿不到时，必须抛**云端**的错 ——
       否则 noSDK 场景的降级文案会被静默改掉（本 case 头部的第④条） */
    const ctx2 = bootDom({ url: 'https://x.test/#/', noSDK: true });
    ctx2.w.fetch = function () { return Promise.reject(new Error('全挂')); };
    let e2 = null;
    try { await ctx2.w.NEON.Posts.listPublished({ page: 1, pageSize: 10 }); }
    catch (e) { e2 = String(e && e.message || e); }
    T(CN, 'R252f 快照与云端同时不可用 → 抛的是**云端**错误（根因优先）',
      !!e2 && /SDK|云服务/.test(e2),
      e2 === null ? '没有抛错（更糟：会静默空列表）' : e2);

    /* 反向面：云端**可用**时不许走快照（生产路径零改动） */
    const ctx3 = bootDom({ url: 'https://x.test/#/' });
    let calledSnapshot = false;
    ctx3.w.fetch = function (u) {
      if (String(u).indexOf('data/posts.json') === 0) calledSnapshot = true;
      return Promise.reject(new Error('不该被调用'));
    };
    let cloudListed = null;
    try { cloudListed = await ctx3.w.NEON.Posts.listPublished({ page: 1, pageSize: 10 }); }
    catch (e) { /* 桩不完整时容忍 */ }
    T(CN, 'R252g 云端可用时不碰快照（生产路径零改动，快照只是兜底）',
      calledSnapshot === false && cloudListed && cloudListed.posts.length > 0,
      '触碰快照=' + calledSnapshot + ' 云端返回=' + (cloudListed ? cloudListed.posts.length + ' 篇' : 'null'));
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: "v4.6 静态快照：GitHub Pages 同源回退" };

standalone(module, run);
