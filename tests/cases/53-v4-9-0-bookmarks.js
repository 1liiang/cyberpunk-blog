'use strict';
/* ============================================================
   tests/cases/53-v4-9-0-bookmarks.js — v4.9.0 收藏跟账号走 + 登录门槛

   站长的规则：「只有登录了才能收藏，未登录只能浏览」。
   这条规则要**三层同时成立**，本 case 用真启动 + 真点击逐层走查：
     ① 界面层：访客点收藏 → 不写库、给提示、引导去登录；按钮显示锁定态
     ② 应用层：登录后从云端取回收藏；写失败要回滚；退出要清缓存；
              旧版本机收藏一次性并入账号
     ③ 数据层：确实读写 bookmarks 表、写的是 post_id（不是往 localStorage 塞）
   库层的 RLS（anon 被 revoke、只能读写自己的）在 db 侧验：
   PGlite 预演（_push/tools/test-schema-pglite.js）+ 真项目验收。

   为什么必须有这一层：静态断言（34 号）只能证明"代码里有那道 if"，
   证明不了"访客点下去真的没写库"。二者缺一不可。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, FIXTURES, bootDom, waitFor } = require('../common');

/* 每个场景都要一份**自己的** fixtures —— 桩会就地改 bookmarks 数组，
   共用一份会让用例之间互相污染（这也是本 case 刻意不直接用 FIXTURES 的原因）。 */
function fx(extra) {
  const f = Object.assign({}, FIXTURES, extra || {});
  if (!f.bookmarks) f.bookmarks = [];
  return f;
}
const SESSION = { user: { id: 'u1', email: 'me@x.test', user_metadata: {} } };

function clickMark(ctx, idx) {
  const btn = ctx.doc.querySelectorAll('.post-card .card-mark')[idx || 0];
  if (!btn) return null;
  btn.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  return btn;
}
function cloudWrites(ctx) {
  return ctx.queries.filter(function (q) {
    return q.table === 'bookmarks' && (q.kind === 'upsert' || q.kind === 'insert' || q.kind === 'delete');
  });
}
function toastText(ctx) {
  const w = ctx.doc.getElementById('toast-wrap');
  return w ? w.textContent : '';
}

async function run() {
  const S = makeSuite();
  const T = S.T;

  /* ================= ① 访客：只能浏览，不能收藏 ================= */
  {
    const CN = 'v4.9 收藏门槛';
    const ctx = bootDom({ url: 'https://x.test/#/', fixtures: fx() });
    const ok = await waitFor(function () { return ctx.doc.querySelectorAll('.post-card').length >= 3; }, 4000);
    T(CN, 'R285 访客首页渲染出卡片（前置条件成立）', ok, ok ? '' : '卡片没渲染出来');

    const btn = ctx.doc.querySelector('.post-card .card-mark');
    T(CN, 'R285b 访客的收藏按钮显示**锁定态**（is-locked + 锁形 + 说明文案）',
      !!btn && btn.classList.contains('is-locked') &&
      /登录后可收藏/.test(btn.getAttribute('title') || '') &&
      /🔒/.test(btn.textContent || ''),
      btn ? ('class=' + btn.className + ' title=' + btn.getAttribute('title')) : '按钮不存在');

    const before = cloudWrites(ctx).length;
    clickMark(ctx, 0);
    await waitFor(function () { return ctx.doc.getElementById('toast-wrap').textContent.length > 0; }, 1000);

    T(CN, 'R285c ★ 访客点收藏**没有**产生任何写请求（未登录不能收藏）',
      cloudWrites(ctx).length === before,
      '写请求数 ' + before + ' → ' + cloudWrites(ctx).length);

    T(CN, 'R285d 访客点收藏得到明确提示（而不是点了没反应）',
      /登录/.test(toastText(ctx)),
      'toast=' + JSON.stringify(toastText(ctx).slice(0, 40)));

    T(CN, 'R285e 访客点收藏被引导到登录页（#/login）',
      ctx.w.location.hash === '#/login',
      'hash=' + ctx.w.location.hash);

    T(CN, 'R285f 访客点收藏后按钮**没有**被点亮（不留假状态）',
      !btn.classList.contains('is-on'),
      'class=' + btn.className);
    ctx.dom.window.close();
  }

  /* 访客打开收藏页 → 登录引导，而不是空列表 */
  {
    const CN = 'v4.9 收藏门槛';
    const ctx = bootDom({ url: 'https://x.test/#/marks', fixtures: fx() });
    const ok = await waitFor(function () { return !!ctx.doc.getElementById('marks-login'); }, 4000);
    const listed = ctx.queries.filter(function (q) { return q.table === 'posts'; }).length;
    T(CN, 'R285g 访客打开收藏页看到登录引导（不是"空收藏"空态）',
      ok && /ACCESS REQUIRED/.test(ctx.doc.body.textContent || ''),
      ok ? '' : '没有登录引导');
    T(CN, 'R285h 访客的收藏页不发起任何文章取数（不浪费请求）',
      listed === 0, 'posts 请求 ' + listed + ' 次');
    ctx.dom.window.close();
  }

  /* ================= ② 已登录：收藏走云端 ================= */
  {
    const CN = 'v4.9 收藏云端';
    const fixtures = fx({ __session: SESSION, bookmarks: [{ owner_id: 'u1', post_id: 1, created_at: '2026-10-01T00:00:00Z' }] });
    const ctx = bootDom({ url: 'https://x.test/#/', fixtures: fixtures });
    const ok = await waitFor(function () { return ctx.doc.querySelectorAll('.post-card').length >= 3; }, 4000);

    /* 收藏态来自云端：fixture 里收藏了 post 1 → 对应卡片应点亮 */
    const onCards = Array.prototype.filter.call(ctx.doc.querySelectorAll('.post-card .card-mark'),
      function (b) { return b.classList.contains('is-on'); });
    T(CN, 'R286 登录后收藏态来自云端（fixture 收藏的 post 1 被点亮）',
      ok && onCards.length === 1 && onCards[0].getAttribute('data-mark') === '1',
      '点亮 ' + onCards.length + ' 个' + (onCards[0] ? '（data-mark=' + onCards[0].getAttribute('data-mark') + '）' : ''));

    const btn = ctx.doc.querySelector('.post-card .card-mark');
    T(CN, 'R286b 登录后按钮不再是锁定态',
      !!btn && !btn.classList.contains('is-locked'),
      btn ? 'class=' + btn.className : '按钮不存在');

    /* 点一个未收藏的 → 云端应有 upsert，payload 带 post_id */
    const target = Array.prototype.filter.call(ctx.doc.querySelectorAll('.post-card .card-mark'),
      function (b) { return !b.classList.contains('is-on'); })[0];
    const tid = target ? parseInt(target.getAttribute('data-mark'), 10) : null;
    target.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    const wrote = await waitFor(function () {
      return cloudWrites(ctx).some(function (q) { return q.kind === 'upsert' && q.payload && parseInt(q.payload.post_id, 10) === tid; });
    }, 2000);
    T(CN, 'R286c 已登录点收藏 → 云端写入 bookmarks（payload 是 post_id）',
      wrote && fixtures.bookmarks.some(function (b) { return b.post_id === tid; }),
      '写了=' + wrote + ' 云端条目=' + fixtures.bookmarks.length);
    T(CN, 'R286d 写入后按钮点亮（乐观更新 + 落库一致）',
      !!target && target.classList.contains('is-on'),
      target ? 'class=' + target.className : '-');

    /* 再点一次 → 云端删除。
       ⚠ 必须等**写完之后**再点第二次：内存缓存是在 await 之后才更新的，
         抢在它前面点，handler 会读到旧状态又走一次"收藏"（实测踩过）。 */
    await waitFor(function () { return /已收藏/.test(toastText(ctx)); }, 2000);
    target.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    const removed = await waitFor(function () {
      return !fixtures.bookmarks.some(function (b) { return b.post_id === tid; });
    }, 2000);
    T(CN, 'R286e 再点一次 → 云端删除该收藏（取消收藏真的落库）',
      removed && cloudWrites(ctx).some(function (q) { return q.kind === 'delete'; }),
      '云端剩余 ' + fixtures.bookmarks.length + ' 条');
    ctx.dom.window.close();
  }

  /* ================= ③ 写失败必须回滚 ================= */
  {
    const CN = 'v4.9 收藏云端';
    const fixtures = fx({
      __session: SESSION,
      __bookmarkWriteError: { message: 'permission denied', code: '42501' }
    });
    const ctx = bootDom({ url: 'https://x.test/#/', fixtures: fixtures });
    await waitFor(function () { return ctx.doc.querySelectorAll('.post-card').length >= 3; }, 4000);
    const btn = ctx.doc.querySelector('.post-card .card-mark');
    btn.dispatchEvent(new ctx.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(function () { return !btn.classList.contains('is-on'); }, 2000);
    T(CN, 'R286f 写失败要回滚（绝不出现"看起来收藏了、其实没存"）',
      !btn.classList.contains('is-on') && /失败|权限|登录/.test(toastText(ctx)),
      'class=' + btn.className + ' toast=' + JSON.stringify(toastText(ctx).slice(0, 30)));
    ctx.dom.window.close();
  }

  /* ================= ④ 旧版本机收藏一次性迁移 ================= */
  {
    const CN = 'v4.9 收藏迁移';
    const fixtures = fx({ __session: SESSION, bookmarks: [] });
    const ctx = bootDom({
      url: 'https://x.test/#/',
      fixtures: fixtures,
      /* 预置旧版本机收藏。storage 注入已独立于 themeBoot（common.js 的修正），
         不再需要额外传 themeBoot。 */
      storage: { neon_bookmarks: JSON.stringify([3, 4]) }
    });
    const migrated = await waitFor(function () { return fixtures.bookmarks.length >= 2; }, 4000);
    T(CN, 'R287 v4.9.0 之前存在本机的收藏被并入账号',
      migrated && fixtures.bookmarks.map(function (b) { return b.post_id; }).sort().join(',') === '3,4',
      '云端=' + fixtures.bookmarks.map(function (b) { return b.post_id; }).join(','));
    let left = 'x';
    try { left = ctx.w.localStorage.getItem('neon_bookmarks'); } catch (e) { left = 'ERR'; }
    T(CN, 'R287b 迁移成功后删掉旧键（不会每次登录重复导入）',
      left === null, '残留=' + String(left));
    ctx.dom.window.close();
  }

  /* ================= ⑤ 快照模式：读空表、不抛错 ================= */
  await (async function () {
    const CN = 'v4.9 收藏兜底';
    const ctx = bootDom({ url: 'https://x.test/#/', noSDK: true, fixtures: fx() });
    /* jsdom 默认没有 fetch —— 必须自己喂一份快照响应，
       否则"回退"本身也会失败，snapshotMode 根本不会置位（51 号同样处理）。 */
    ctx.w.fetch = function (url) {
      if (String(url).indexOf('data/posts.json') === 0) {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve({ posts: [], images: {}, exportedAt: 'x', source: 'x' }); }
        });
      }
      return Promise.reject(new Error('CSP 拦截：跨源请求被拒绝'));
    };
    /* 先触发一次普通读，让数据层真的落到快照模式 */
    try { await ctx.w.eval('NEON.Posts.listPublished({ page: 1, pageSize: 5 })'); } catch (e) {}
    const r = await ctx.w.eval('NEON.Bookmarks.list()');
    T(CN, 'R287c 云端不可达（快照模式）时 list() 返回空表且不抛错',
      Array.isArray(r) && r.length === 0,
      '返回 ' + JSON.stringify(r));
    T(CN, 'R287d 快照模式下 isSnapshot() 为真（应用据此区分"没收藏"与"连不上"）',
      ctx.w.eval('NEON.isSnapshot()') === true,
      'isSnapshot=' + ctx.w.eval('NEON.isSnapshot()'));
    ctx.dom.window.close();
  })();

  /* ================= ⑥ 退出登录清空缓存（账号数据不串号） ================= */
  await (async function () {
    const CN = 'v4.9 收藏隔离';
    const fixtures = fx({ __session: SESSION, bookmarks: [{ owner_id: 'u1', post_id: 1, created_at: '2026-10-01T00:00:00Z' }] });
    const ctx = bootDom({ url: 'https://x.test/#/', fixtures: fixtures });
    await waitFor(function () { return ctx.doc.querySelectorAll('.post-card .card-mark.is-on').length === 1; }, 4000);
    /* 桩把 onAuthStateChange 的回调存了下来，这里手动触发"退出" */
    const fired = typeof fixtures.__onAuth === 'function';
    if (fired) fixtures.__onAuth('SIGNED_OUT', null);
    const cleared = await waitFor(function () {
      return ctx.doc.querySelectorAll('.post-card .card-mark.is-on').length === 0;
    }, 2000);
    T(CN, 'R287e 退出登录后收藏态立即清空（下一个人登录看不到上一个人的收藏）',
      fired && cleared,
      fired ? (cleared ? '' : '界面仍点亮') : '桩未暴露 onAuthStateChange 回调');
    ctx.dom.window.close();
  })();

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: 'v4.9 收藏（账号 + 登录门槛）' };
standalone(module, run);
