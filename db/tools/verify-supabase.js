#!/usr/bin/env node
/* ============================================================
   db/tools/verify-supabase.js — 真后端验收（拿到项目后跑这一条）

   验什么：不看界面，直接对**真 Supabase** 打 PostgREST/Auth，
   把"这套库结构与策略在真环境里是否成立"逐条验掉：
     A. 匿名通道（anon key，无会话）
        · 能读已发布文章 / 图片视图 / 电台视图（含音频本体）
        · 读不到草稿、读不到图片基表、读不到 error_logs
        · 写不进 posts / radio_tracks（RLS 默认拒绝）
     B. 登录通道（有了会话之后）
        · 注册（或登录已有账号）拿到会话
        · 自己发的草稿只有自己看得见
        · 能插入图片行（走基表）并立刻从视图读到
        · 能改自己的、删自己的
        · 改别人的 → 影响 0 行（RLS 静默挡下）
     C. 收尾：删掉本次造的测试数据（不留残渣）

   配置来源与导出工具一致：从 app/js/cloud.js 读 endpoint / publishableKey（单一来源）。
   账号：优先用环境变量 NEON_E2E_EMAIL / NEON_E2E_PASSWORD（你自己的账号，最真实）；
        没给就临时注册一个（若项目开了 Confirm email 会拿不到会话 —— B 段自动跳过并提示）。

   依赖：@supabase/supabase-js（与站点用的是同一个包；本机装在 _push/tools）。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CLOUD_JS = path.join(ROOT, 'app', 'js', 'cloud.js');

function readCloudConfig() {
  const src = fs.readFileSync(CLOUD_JS, 'utf8');
  const ep = /endpoint:\s*'([^']+)'/.exec(src);
  const key = /publishableKey:\s*'([^']+)'/.exec(src);
  if (!ep || !key) throw new Error('无法从 js/cloud.js 解析 endpoint / publishableKey');
  return { endpoint: ep[1].replace(/\/$/, ''), key: key[1] };
}

let fail = 0, skip = 0;
function T(name, ok, info) {
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + name + (info ? '  [' + info + ']' : ''));
  if (!ok) fail++;
}
function SKIP(name, why) { skip++; console.log('  ⏭  ' + name + '  —— ' + why); }

(async function () {
  const cfg = readCloudConfig();
  console.log('=== 真后端验收 ===');
  console.log('  端点  ' + cfg.endpoint);
  if (/REPLACE_ME/.test(cfg.endpoint) || /REPLACE_ME/.test(cfg.key)) {
    console.error('\n✗ app/js/cloud.js 里还是占位符 —— 先把真实 Project URL / anon key 填进去再跑。');
    process.exit(1);
  }

  let createClient = null;
  try { ({ createClient } = require('@supabase/supabase-js')); }
  catch (e) {
    console.error('\n✗ 缺少依赖 @supabase/supabase-js（本机装法：在 _push/tools 下 pnpm add @supabase/supabase-js）');
    process.exit(1);
  }

  const anon = createClient(cfg.endpoint, cfg.key, { auth: { persistSession: false } });

  /* ================= A. 匿名通道 ================= */
  console.log('\n=== A. 匿名通道（无会话）===');
  const posts = await anon.from('posts').select('id,title,status,created_at').eq('status', 'published').order('created_at', { ascending: false });
  T('匿名可读已发布文章', !posts.error && Array.isArray(posts.data) && posts.data.length >= 1,
    posts.error ? posts.error.message : posts.data.length + ' 篇');
  const draftPeek = await anon.from('posts').select('id').eq('status', 'draft');
  T('匿名读不到草稿（RLS）', !draftPeek.error && draftPeek.data.length === 0,
    draftPeek.error ? draftPeek.error.message : draftPeek.data.length + ' 篇');

  const imgs = await anon.from('public_images').select('id,content_type,width,height');
  T('匿名可读图片视图', !imgs.error && imgs.data.length >= 1, imgs.error ? imgs.error.message : imgs.data.length + ' 张');

  const base = await anon.from('post_images').select('id');
  T('匿名读不到图片基表（防枚举 owner_id）',
    !!base.error || (Array.isArray(base.data) && base.data.length === 0),
    base.error ? base.error.message.slice(0, 60) : '返回 0 行');

  /* ⚠ 2026-09-30 起电台退役：库里应为 0 首。这里验的是"视图通路还在"，
     而不是"有曲目"—— 老版本断言 length>=1，退役后会把正确状态判成红。 */
  const radio = await anon.from('public_radio').select('id,title,has_data,duration_sec').order('sort_order', { ascending: true });
  T('匿名可读电台视图（电台已退役，应为 0 首）', !radio.error && radio.data.length === 0,
    radio.error ? radio.error.message : radio.data.length + ' 首');
  const withData = (radio.data || []).filter(function (r) { return r.has_data; });
  if (withData.length) {
    const one = await anon.from('public_radio').select('id,data').eq('id', withData[0].id).maybeSingle();
    const okData = !one.error && one.data && /^data:audio\/[a-z0-9.+-]+;base64,/.test(one.data.data || '');
    T('匿名拿得到音频本体（"所有人可听"的实现基础）', okData, okData ? (String(one.data.data).length / 1048576).toFixed(1) + ' MB' : (one.error && one.error.message));
  } else { SKIP('音频本体读取', '库里没有带音频的曲目'); }

  const anonIns = await anon.from('posts').insert({ title: 'anon 越权测试', content: '', status: 'published' });
  T('匿名写不进 posts（RLS 拒绝）', !!anonIns.error, anonIns.error ? anonIns.error.message.slice(0, 60) : '竟然插入成功了！');

  const errSandbox = await anon.from('error_logs').select('id').limit(1);
  T('匿名读不到 error_logs', !!errSandbox.error || (errSandbox.data || []).length === 0);

  /* v4.9.0 收藏：站长的规则是"只有登录了才能收藏" ——
     库层的实现方式是**连表都不授权给 anon**（不是"授权了被 RLS 挡"），
     所以这里期望的是权限错误（42501 一类），而不是"返回 0 行"。
     ⚠ 此刻 `anon` 客户端还没执行过 signUp/signIn（那在 B 阶段），仍是真匿名。 */
  const anonBm = await anon.from('bookmarks').select('post_id').limit(1);
  T('★ 匿名碰不到 bookmarks 表（未授权，未登录不能收藏）',
    !!anonBm.error,
    anonBm.error ? String(anonBm.error.message).slice(0, 70) : '竟然读到了 ' + (anonBm.data || []).length + ' 行！');

  /* ================= B. 登录通道 ================= */
  console.log('\n=== B. 登录通道 ===');
  const email = process.env.NEON_E2E_EMAIL || ('neon-e2e-' + Date.now() + '@example.com');
  const password = process.env.NEON_E2E_PASSWORD || ('E2e-' + Math.random().toString(36).slice(2, 10) + '!9');
  const created = !process.env.NEON_E2E_EMAIL;
  console.log('  账号  ' + email + (created ? '（本次临时注册）' : '（来自环境变量）'));

  let session = null;
  if (created) {
    const su = await anon.auth.signUp({ email: email, password: password });
    if (su.error) T('注册成功', false, su.error.message);
    else if (!su.data.session) SKIP('登录通道整体', '项目开着 Confirm email —— 请先确认该邮箱，或临时关掉它再跑');
    else { session = su.data.session; T('注册并拿到会话', true, 'user=' + su.data.user.id.slice(0, 8) + '…'); }
  } else {
    const si = await anon.auth.signInWithPassword({ email: email, password: password });
    if (si.error) T('登录成功', false, si.error.message);
    else { session = si.data.session; T('登录并拿到会话', true, 'user=' + si.data.user.id.slice(0, 8) + '…'); }
  }

  let testPostId = null, testImageId = null;
  /* v4.9.0：为了验"他人读不到我的收藏"，会额外注册一个账号 —— 记下来，收尾时提醒删除 */
  const otherUsers = [];
  /* ⚠⚠ 匿名断言必须用**全新的客户端**：
     上面的 `anon` 客户端一旦执行过 signUp/signIn，它就不再匿名了
     （supabase-js 会把会话存在该客户端上），于是"草稿对匿名不可见"这类断言
     会拿**已登录身份**去查 —— 结果看起来像 RLS 泄漏，实则是测试写错了。
     （实测踩过：同一客户端先 signUp 再查草稿，data.length=1。） */
  const freshAnon = createClient(cfg.endpoint, cfg.key, { auth: { persistSession: false } });
  if (session) {
    const uid = session.user.id;
    const authed = createClient(cfg.endpoint, cfg.key, {
      auth: { persistSession: false },
      global: { headers: { Authorization: 'Bearer ' + session.access_token } }
    });

    /* 草稿只对自己可见 */
    const ins = await authed.from('posts').insert({
      owner_id: uid, title: 'E2E 验收草稿', content: '由 verify-supabase.js 创建', status: 'draft', tags: []
    }).select('id,owner_id,status').single();
    T('插入草稿（owner_id = 自己的 uid，RLS with check 放行）', !ins.error, ins.error ? ins.error.message.slice(0, 70) : 'id=' + ins.data.id);
    if (!ins.error) testPostId = ins.data.id;

    const anonDraft = await freshAnon.from('posts').select('id').eq('id', testPostId);
    T('该草稿对匿名不可见', !anonDraft.error && anonDraft.data.length === 0, anonDraft.error ? anonDraft.error.message : (anonDraft.data || []).length + ' 行');

    /* 图片：走基表插入，再从视图读 —— 上传链路的库层闭环 */
    const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    const img = await authed.from('post_images').insert({
      owner_id: uid, content_type: 'image/png', data: png1x1, width: 1, height: 1, size_bytes: 68
    }).select('id').single();
    T('插入图片（基表）', !img.error, img.error ? img.error.message.slice(0, 70) : 'id=' + img.data.id);
    if (!img.error) {
      testImageId = img.data.id;
      const viaView = await freshAnon.from('public_images').select('id,content_type').eq('id', testImageId).maybeSingle();
      T('新图立即可从公开视图读到（匿名）', !viaView.error && !!viaView.data);
    }

    /* 改自己的 */
    const upd = await authed.from('posts').update({ title: 'E2E 验收草稿 v2' }).eq('id', testPostId).select('id');
    T('改自己的文章成功', !upd.error && (upd.data || []).length === 1);

    /* 改别人的 → 影响 0 行（RLS 静默挡下） */
    const foreign = await authed.from('posts').update({ title: 'hacked' }).neq('owner_id', uid).select('id');
    T('改不到别人的文章（影响 0 行）', !foreign.error && (foreign.data || []).length === 0,
      foreign.error ? foreign.error.message.slice(0, 60) : '0 行');

    /* 发布 → 匿名人看见 */
    const pub = await authed.from('posts').update({ status: 'published' }).eq('id', testPostId).select('id');
    if (!pub.error && (pub.data || []).length === 1) {
      const seen = await freshAnon.from('posts').select('id').eq('id', testPostId);
      T('发布后匿名立刻可见（写入→公开的闭环）', !seen.error && seen.data.length === 1);
    } else { T('发布自己的草稿', false, pub.error && pub.error.message); }

    /* ---------- v4.9.0 收藏（账号功能） ---------- */
    if (testPostId) {
      /* owner_id 不传 —— 由库层默认值 auth.uid() 填（前端也不传，这里保持一致） */
      const bmAdd = await authed.from('bookmarks').upsert(
        { post_id: testPostId }, { onConflict: 'owner_id,post_id', ignoreDuplicates: true });
      T('登录后可收藏（owner_id 由库层 auth.uid() 默认值填）', !bmAdd.error,
        bmAdd.error ? String(bmAdd.error.message).slice(0, 70) : 'post_id=' + testPostId);

      const bmAgain = await authed.from('bookmarks').upsert(
        { post_id: testPostId }, { onConflict: 'owner_id,post_id', ignoreDuplicates: true });
      T('重复收藏是幂等的（主键 + ignore-duplicates，不报错）', !bmAgain.error,
        bmAgain.error ? String(bmAgain.error.message).slice(0, 70) : 'ok');

      const bmList = await authed.from('bookmarks').select('post_id,created_at').order('created_at', { ascending: false });
      T('读得到自己的收藏', !bmList.error && (bmList.data || []).some(function (r) { return r.post_id === testPostId; }),
        bmList.error ? String(bmList.error.message).slice(0, 60) : (bmList.data || []).length + ' 条');

      /* 另一个账号读不到我的收藏（RLS 只放行本人）——
         这是"收藏是私密的"这条承诺的硬证据 */
      const other = createClient(cfg.endpoint, cfg.key, { auth: { persistSession: false } });
      const otherEmail = 'neon-e2e2-' + Date.now() + '@example.com';
      const su2 = await other.auth.signUp({ email: otherEmail, password: password });
      if (su2.error || !su2.data.session) {
        SKIP('他人读不到我的收藏', '第二个账号建不出来（' + (su2.error ? su2.error.message : '需确认邮箱') + '）');
      } else {
        const otherClient = createClient(cfg.endpoint, cfg.key, {
          auth: { persistSession: false },
          global: { headers: { Authorization: 'Bearer ' + su2.data.session.access_token } }
        });
        const peek = await otherClient.from('bookmarks').select('post_id');
        T('他人读不到我的收藏（RLS 以 auth.uid() 为界）',
          !peek.error && (peek.data || []).length === 0,
          peek.error ? String(peek.error.message).slice(0, 60) : (peek.data || []).length + ' 行');
        otherUsers.push(otherEmail);
      }

      const bmDel = await authed.from('bookmarks').delete().eq('post_id', testPostId).select('post_id');
      T('取消收藏（删除自己的行）', !bmDel.error && (bmDel.data || []).length === 1,
        bmDel.error ? String(bmDel.error.message).slice(0, 60) : (bmDel.data || []).length + ' 行');
    }
  }

  /* ================= C. 收尾 ================= */
  console.log('\n=== C. 收尾（不留测试残渣）===');
  if (session && testPostId) {
    const del = await createClient(cfg.endpoint, cfg.key, {
      auth: { persistSession: false },
      global: { headers: { Authorization: 'Bearer ' + session.access_token } }
    }).from('posts').delete().eq('id', testPostId).select('id');
    T('测试文章已删除', !del.error && (del.data || []).length === 1, del.error && del.error.message);
  } else { SKIP('清理测试文章', '本次没有创建'); }
  if (session && testImageId) {
    const delImg = await createClient(cfg.endpoint, cfg.key, {
      auth: { persistSession: false },
      global: { headers: { Authorization: 'Bearer ' + session.access_token } }
    }).from('post_images').delete().eq('id', testImageId).select('id');
    T('测试图片已删除', !delImg.error && (delImg.data || []).length === 1, delImg.error && delImg.error.message);
  } else { SKIP('清理测试图片', '本次没有创建'); }
  if (created && session) {
    console.log('  ⚠ 本次临时注册了账号 ' + email + '（anon key 删不掉用户）—— 不需要的话到 Supabase → Authentication → Users 里删掉它。');
  }
  otherUsers.forEach(function (u) {
    console.log('  ⚠ 另注册了一个账号 ' + u + '（用于验"他人读不到我的收藏"）—— 同样需要手工删。');
  });

  console.log('\n' + (fail ? '✗ 有 ' + fail + ' 项未通过' + (skip ? '（另有 ' + skip + ' 项跳过）' : '')
                        : '✓ 真后端验收全部通过' + (skip ? '（' + skip + ' 项因配置跳过）' : '')));
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('\n验收脚本异常: ' + (e && e.stack || e));
  process.exit(1);
});
