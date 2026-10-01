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

    /* ⚠ v5.7.0 补充：withFallback 现在还有**竞速上限**这一层（FALLBACK_RACE_MS）——
       因为"挂住"不算失败，只挂 catch 的兜底永远不介入（实测：请求悬挂时首屏
       12 秒仍无内容）。这条断言顺带钉住"竞速不能把正常慢请求抢先"
       （竞速上限必须大于请求超时），细节见 55 号用例。 */
    T(CN, 'R250 cloud.js 提供回退包装 withFallback（先真身、抛错才落快照；且带竞速上限）',
      /function withFallback\(/.test(cloud) &&
      /real\[k\]\.apply\(real, arguments\)/.test(cloud) &&
      /backup\[k\]\.apply\(backup, arguments\)/.test(cloud) &&
      /var FALLBACK_RACE_MS = (\d+);/.test(cloud) &&
      /Promise\.race\(\[/.test(cloud),
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

  /* ================= ⑤ v4.7.0：电台纳入快照 + 自动同步 workflow ================= */
  {
    const CN = 'v4.7 电台与自动同步';
    const snap = readSnapshot();

    /* 5.1 ⚠ 2026-09-30 站长决定：**不做歌曲部分**。
       3 首商业歌曲（夜航星 / 孤勇者 / 苦昼短）的音频已从仓库移除 ——
       GitHub Pages 上不再公开分发，新库也不导入那批音频；界面保留。

       ⚠ v5.6.2 改判（审计清单 D）：这条从"快照必须 0 首**音频**"改成
       "快照里的电台必须是 **v5 条目形状**"。理由：
         · 「电台不做歌曲」指的是**不再公开分发商业音频**，而 v5 的条目根本不带音频
           （播放地址是指向网易云的 outchain iframe），所以条目本身不涉版权与体积；
         · 而"快照 radio 恒为空"是个**会过期的产物判据** —— 云端现在真有条目
           （实测两首），导出器一旦重跑就会把它们写进快照，这条会无缘无故爆红。
       现在守的是两条真契约：
         · radio 必须是数组（形状不能坏）
         · 每条只许带 v5 的八个字段 —— **绝不许**再出现 data / mime / size_bytes /
           cover_url / file 这类音频时代的东西（那才是"音频又回来了"的信号） */
    const radio = (snap && snap.radio) || [];
    const RADIO_OK_FIELDS = ['id', 'title', 'artist', 'kind', 'netease_id',
      'source_url', 'sort_order', 'created_at'];
    const strayFields = [];
    radio.forEach(function (r) {
      Object.keys(r).forEach(function (k) {
        if (RADIO_OK_FIELDS.indexOf(k) < 0) strayFields.push('#' + r.id + '.' + k);
      });
    });
    T(CN, 'R253 快照电台只含 v5 条目字段（不该再出现 data / mime / file 等音频时代字段）',
      Array.isArray(radio) && strayFields.length === 0,
      strayFields.length ? '⚠ 越界字段：' + strayFields.join(', ')
                         : (radio.length + ' 条，字段干净'));

    /* 5.2 ★ 关键设计守卫：大对象**不许**进 JSON。
           base64 时代的音频（每首十几 MB）若照搬进快照，posts.json 会变成 30MB，
           浏览器解析都费劲。v5 之后条目只有一条 URL，这条守卫仍然值钱 ——
           它挡的是"以后有人又把大字段塞回来"。 */
    const jsonBytes = fs.statSync(SNAPSHOT).size;
    T(CN, 'R253b 快照本体保持轻量（大对象不进 JSON）',
      jsonBytes < 200 * 1024,
      (jsonBytes / 1024).toFixed(1) + ' KB（上限 200KB）');

    /* ⚠ R253 只证明**产物**自洽，证明不了**生产者**写对了字段。
       反向验证实锤过：改坏生产者，产物当然不会变。这是本项目第三次栽在
       "钉产物不钉生产者"上（前两次：owner_id 裁剪、slimPost 调用点），
       所以这里继续盯着导出脚本的**源码**。

       ⚠ v5.6.2 改判：原判据（`item.file = file;` + `radioFiles.push({`）钉的是
       "音频文件必须落地"——那条路已删除。改为钉 v5 的真契约：
       导出脚本 select 的电台字段必须与 cloud.js 的 RADIO_FIELDS **逐字一致**，
       否则快照条目会缺字段（界面渲染不出播放器形态）。 */
    const expRadioFields = (/const RADIO_FIELDS = '([^']+)'/.exec(exp) || [, ''])[1];
    const cloudRadioFields = (/var RADIO_FIELDS = '([^']+)'/.exec(cloud) || [, ''])[1];
    T(CN, 'R253c 导出脚本的电台字段与 cloud.js 的 RADIO_FIELDS 逐字一致（钉生产者）',
      !!expRadioFields && expRadioFields === cloudRadioFields &&
      /kind/.test(expRadioFields) && /netease_id/.test(expRadioFields) &&
      /source_url/.test(expRadioFields) &&
      !/\bdata\b/.test(expRadioFields) && !/has_data/.test(expRadioFields),
      'exp=' + expRadioFields + ' / cloud=' + cloudRadioFields);

    /* 5.3 回退覆盖了电台的读路径
       ⚠ v5.6.1：回退键从 ['list', 'playUrl'] 收成 ['list'] ——
       条目自带 source_url（网易云官方播放器地址），播放在界面侧渲染 iframe，
       不再有"取可播放地址"这一步；StaticRadio.playUrl 随审计清单 ① 一并删除。 */
    T(CN, 'R254 cloud.js 为 Radio 提供同源回退（list）',
      /var StaticRadio = \{/.test(cloud) &&
      /Radio: withFallback\(Radio, StaticRadio, \['list'\]\)/.test(cloud),
      'Radio 回退');

    /* 5.4 行为：云端不可用时的电台读路径。
       ⚠ 音频退役后这条反而更值钱了：**空列表是现在线上的常态** ——
         页面打开没东西，读路径绝不能因此抛错或返回坏形状。 */
    const ctx = bootDom({ url: 'https://x.test/#/', noSDK: true });
    ctx.w.fetch = function (url) {
      if (String(url).indexOf('data/posts.json') === 0) {
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve(readSnapshot()); } });
      }
      return Promise.reject(new Error('CSP 拦截'));
    };
    let rows = null, rerr = null;
    try { rows = await ctx.w.NEON.Radio.list(); } catch (e) { rerr = String(e && e.message || e); }
    T(CN, 'R254b 云端不可用 → Radio.list() 仍走快照且不抛错（无条目时给空数组）',
      !rerr && Array.isArray(rows) && rows.length === 0,
      rerr || (rows ? rows.length + ' 条' : 'null'));

    /* v5.6.1 退役：R254c「快照无曲目时 playUrl 明确报错」——
       playUrl 已随审计清单 ① 删除（条目自带 source_url，不再需要取址入口）。
       它守的"withFallback 不许静默返回坏值"这条纪律由上面的 R254b 继续守着。 */

    /* 5.5 自动同步 workflow：结构三要素 */
    const wfPath = path.join(ROOT, '.github', 'workflows', 'sync-snapshot.yml');
    const wf = fs.existsSync(wfPath) ? fs.readFileSync(wfPath, 'utf8') : '';
    T(CN, 'R255 自动同步 workflow 在位（定时 + 手动触发 + 写权限）',
      /cron:\s*'0 \*\/6 \* \* \*'/.test(wf) &&
      /workflow_dispatch:/.test(wf) &&
      /permissions:\s*\n\s*contents:\s*write/.test(wf),
      wf ? '结构完整' : 'workflow 缺失');

    /* 5.6 无变更时必须静默退出 —— 每 6 小时一个空提交会把历史刷成噪音 */
    T(CN, 'R255b 无变更不造空提交（否则每 6 小时污染一次提交历史）',
      /git diff --cached --quiet/.test(wf) && /exit 0/.test(wf),
      '空提交保护');

    /* 5.7 不监听 push —— 本 workflow 自己会推送，监听 push 会形成空转环 */
    T(CN, 'R255c 刻意不监听 push（避免"提交→触发→再提交"空转环）',
      !/^\s*push:/m.test(wf),
      /^\s*push:/m.test(wf) ? '⚠ 监听了 push，会空转' : '未监听 push');

    /* 5.8 这个 workflow 的能力前提：服务器端没有 CORS，
           所以能直接读云端 —— 这正是"Pages 当主站"能成立的关键 */
    T(CN, 'R255d workflow 直接跑导出脚本（服务器端无 CORS，可读云端）',
      /run:\s*node tools\/export-static\.js/.test(wf),
      '导出步骤');

    /* 5.9 ★★ 快照的**确定性** —— 这条是被实测逼出来的设计修复。
           首版把 exportedAt 原样写进 JSON，结果 workflow 第一次跑就产出了一个
           只有时间戳变化的提交：也就是**每 6 小时污染一次历史** ——
           正是 workflow 里那句"无变更不提交"想避免的，却被时间戳废掉了。

           这里把脚本里的 writeSnapshotIfChanged 抽出来**真跑**：
           只改时间戳 → 不重写；内容真变 → 重写。 */
    let detOk = false, detHow = '', tmpFile = '';
    try {
      const m = /const VOLATILE_LINE = [\s\S]*?\nfunction writeSnapshotIfChanged\(file, obj\) \{[\s\S]*?\n\}/.exec(exp);
      if (!m) throw new Error('抽不到 writeSnapshotIfChanged');
      /* eslint-disable no-new-func */
      const fn = new Function('fs', m[0] + '\nreturn writeSnapshotIfChanged;')(fs);

      tmpFile = path.join(require('os').tmpdir(), 'neon-snapshot-determinism.json');
      const base = { exportedAt: '2026-01-01T00:00:00Z', posts: [1, 2], radio: [] };
      const onlyTime = { exportedAt: '2026-06-06T12:00:00Z', posts: [1, 2], radio: [] };
      const realChange = { exportedAt: '2026-06-06T12:00:00Z', posts: [1, 2, 3], radio: [] };

      fs.writeFileSync(tmpFile, JSON.stringify(base, null, 2), 'utf8');
      const r1 = fn(tmpFile, onlyTime);     /* 期望 false */
      const afterR1 = fs.readFileSync(tmpFile, 'utf8');
      const r2 = fn(tmpFile, realChange);   /* 期望 true */
      const afterR2 = fs.readFileSync(tmpFile, 'utf8');

      detOk = r1 === false &&
              r2 === true &&
              JSON.stringify(onlyTime, null, 2) !== afterR1 &&   /* 文件确实没被换掉 */
              afterR2 === JSON.stringify(realChange, null, 2);   /* 真变了就写进去 */
      detHow = '仅时间戳变→' + r1 + ' / 内容变→' + r2;
    } catch (e) {
      detHow = '抽取失败：' + (e && e.message || e);
    } finally {
      try { if (tmpFile) fs.unlinkSync(tmpFile); } catch (e2) { /* 忽略 */ }
    }
    T(CN, 'R256 快照是确定性产物：只有时间戳变则**不重写**，内容真变才写',
      detOk, detHow);

    /* 5.10 与上一条配套：脚本必须**真的用了**这个函数（钉调用点） */
    T(CN, 'R256b 脚本确实调用 writeSnapshotIfChanged（不是定义完没人用）',
      /^\s*const snapChanged = writeSnapshotIfChanged\(/m.test(exp),
      /^\s*const snapChanged = writeSnapshotIfChanged\(/m.test(exp) ? '调用点在位' : '⚠ 未调用');
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: "v4.6 静态快照：GitHub Pages 同源回退" };

standalone(module, run);
