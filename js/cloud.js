/* ============================================================
   cloud.js — 数据访问层（Supabase）
   ------------------------------------------------------------
   迁移记录（2026-09-30）：后端从 WorkBuddy 云服务换成 Supabase。
   本文件对外接口、快照回退机制、图片压缩与电台逻辑**一律未改** ——
   变的只有最底下那层"SDK 边界"：
     · init()            —— 由 createWorkBuddyCloud 换成 supabase.createClient
     · makeAuthAdapter() —— 抹平 auth 的几处签名差异（发码 / 验码 / 改密）
     · .database.from()  —— Supabase 的 from() 在顶层，挂到 database 名下对齐旧形状

   为什么保留 PUBLIC_CONFIG 的字段名（endpoint / publishableKey）：
   ① tools/export-static.js 与 51 号用例都按这两个名字从本文件读配置（单一来源）；
   ② 语义也成立 —— anon key 本来就是"可公开的键"，真正的门是库里的 RLS。
   ============================================================ */
(function () {
  'use strict';

  var PUBLIC_CONFIG = {
    /* Supabase 项目 URL（Project Settings → API → Project URL）。
       ⚠ 只填**基址**：末尾别带 /rest/v1/ —— 客户端自己拼 /rest/v1 与 /auth/v1。 */
    endpoint: 'https://taxrgizbmgwzxnvlxudq.supabase.co',
    /* Supabase 的公开键。设计上就随前端公开，权限由库里的 RLS 决定。
       ⚠ 新版 Supabase 发的是 sb_publishable_… 形态（非 JWT）；已实测被 REST 接受。 */
    publishableKey: 'sb_publishable_UTy5nvywck24rPk-HvUvVQ_H3-Wr7Ro'
  };

  var cloud = null;
  var sdkReady = false;

  /* ---------- 初始化（必须在 SDK 脚本加载后调用一次） ---------- */
  function init() {
    if (sdkReady) return cloud;
    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
      console.error('[NEON] 数据层 SDK（supabase-js）未加载');
      return null;
    }
    var sb = supabase.createClient(PUBLIC_CONFIG.endpoint, PUBLIC_CONFIG.publishableKey, {
      auth: {
        persistSession: true,        /* 会话存 localStorage，刷新不掉登录 */
        autoRefreshToken: true,
        /* 本站是 hash 路由，且找回密码走"邮件验证码"而不是魔法链接，
           故关掉 URL 里的 token 嗅探 —— 否则 #access_token=… 会被路由当成页面地址 */
        detectSessionInUrl: false
      }
    });
    cloud = {
      raw: sb,                                  /* 需要底层客户端时用（storage / functions） */
      database: { from: function (t) { return sb.from(t); } },
      auth: makeAuthAdapter(sb),
      storage: { from: function (b) { return sb.storage.from(b); } }
    };
    sdkReady = true;
    return cloud;
  }

  function ensure() {
    if (!sdkReady) init();
    if (!sdkReady) throw new Error('云服务 SDK 未就绪：请检查网络后刷新页面');
    return cloud;
  }

  /* ---------- 通用错误归一化 ---------- */
  function errMsg(err, fallback) {
    if (!err) return fallback || '未知错误';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    if (err.msg) return err.msg;
    try { return JSON.stringify(err); } catch (e) { return fallback || '未知错误'; }
  }

  function pgCode(err) {
    return err && err.code ? String(err.code) : '';
  }

  /* ---------- auth 适配器 ----------
     cloud.js 内部的 Auth 包装层（下面那个对象）是按旧 SDK 的**返回形状**写的：
       signInWithPassword/sendOtp/verifyOtp 取 r.data，且 sendOtp 认 verificationId / isExistingUser。
     Supabase 的形状大同小异，只有三处真差异，全部在这里抹平：

     ① getSession / signInWithPassword / verifyOtp
        Supabase 返回 { data: { session, user } }，旧 SDK 的 data 直接就是会话对象
        ⇒ 统一剥一层 .session，让上层拿到的仍是"会话本身"（app.js 到处读 session.user.id）。

     ② 发码：Supabase 没有 sendOtp，等价物是 signInWithOtp。
        而 isExistingUser 关系到 UI 走"注册"还是"登录"页签，必须判出来；
        Supabase 出于防用户枚举**不会**直接告诉你账号是否存在
        ⇒ 先用 shouldCreateUser:false 探一次：报「不允许注册/用户不存在」= 新用户，
          再补一次 shouldCreateUser:true 把码发出去（新用户多一个往返，老用户零额外代价）。

     ③ 验码与改密：Supabase 用 { email, token, type } 三件套换会话；
        注册页还要顺手设密码，故验码成功后追加一次 updateUser({ password })。
        找回密码同理 —— 邮件模板里放 {{ .Token }} 出 6 位码，
        按 type:'recovery' 换会话后改密码（app.js 期望的 r.updateUser({nonce,password}) 就落在这里）。 */
  function makeAuthAdapter(sb) {
    function fail(err, fallback) { return { error: errMsg(err, fallback) }; }

    return {
      getSession: async function () {
        var r = await sb.auth.getSession();
        if (r.error) return fail(r.error, '会话获取失败');
        return { data: r.data ? r.data.session : null };
      },
      getUser: async function () {
        var r = await sb.auth.getUser();
        if (r.error) return fail(r.error, '用户信息获取失败');
        return { data: r.data ? r.data.user : null };
      },
      signInWithPassword: async function (opts) {
        var r = await sb.auth.signInWithPassword(opts);
        if (r.error) return fail(r.error, '账号或密码错误');
        return { data: r.data ? r.data.session : null };
      },
      sendOtp: async function (opts) {
        var email = opts && opts.email;
        var probe = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
        if (!probe.error) {
          return { data: { verificationId: email, isExistingUser: true } };
        }
        var code = String((probe.error && (probe.error.code || probe.error.error_code)) || '');
        var msg = String((probe.error && probe.error.message) || '');
        var looksNew = code === 'otp_disabled' || code === 'user_not_found' ||
          /signups?\s+not\s+allowed|user\s+not\s+found|not\s+found/i.test(msg);
        if (!looksNew) return fail(probe.error, '验证码发送失败');

        var create = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } });
        if (create.error) return fail(create.error, '验证码发送失败');
        /* verificationId 在 Supabase 侧没有对应物：换码只认 email + token。
           这里回填 email 本身，好让上层那段 pending.email === email 的一致性校验照旧生效。 */
        return { data: { verificationId: email, isExistingUser: false } };
      },
      verifyOtp: async function (opts) {
        var r = await sb.auth.verifyOtp({ email: opts.email, token: opts.token, type: 'email' });
        if (r.error) return fail(r.error, '验证失败');
        if (opts.password) {
          var u = await sb.auth.updateUser({ password: opts.password });
          if (u.error) return fail(u.error, '密码设置失败（请重试）');
        }
        return { data: r.data ? r.data.session : null };
      },
      resetPasswordForEmail: async function (email) {
        var r = await sb.auth.resetPasswordForEmail(email);
        if (r.error) return fail(r.error, '重置邮件发送失败');
        return { data: { updateUser: async function (o) {
          var v = await sb.auth.verifyOtp({ email: email, token: o.nonce, type: 'recovery' });
          if (v.error) return fail(v.error, '验证码无效或已过期');
          var u = await sb.auth.updateUser({ password: o.password });
          if (u.error) return fail(u.error, '密码更新失败');
          return {};
        } } };
      },
      signOut: async function () {
        var r = await sb.auth.signOut();
        if (r.error) return fail(r.error, '退出失败');
        return {};
      },
      onAuthStateChange: function (cb) {
        /* Supabase 回调签名是 (event, session) —— 与 app.js 的既有用法一致，直接透传 */
        return sb.auth.onAuthStateChange(cb);
      }
    };
  }

  /* ---------- 认证 ---------- */
  var Auth = {
    getSession: async function () {
      var r = await ensure().auth.getSession();
      if (r.error) throw new Error(errMsg(r.error, '会话获取失败'));
      return r.data || null;
    },
    getUser: async function () {
      var r = await ensure().auth.getUser();
      if (r.error) throw new Error(errMsg(r.error, '用户信息获取失败'));
      return r.data || null;
    },
    signInWithPassword: async function (email, password) {
      var r = await ensure().auth.signInWithPassword({ email: email, password: password });
      if (r.error) return { error: errMsg(r.error, '账号或密码错误') };
      return { session: r.data };
    },
    sendOtp: async function (email) {
      var r = await ensure().auth.sendOtp({ email: email });
      if (r.error) return { error: errMsg(r.error, '验证码发送失败') };
      return {
        verificationId: r.data && r.data.verificationId,
        isExistingUser: !!(r.data && r.data.isExistingUser)
      };
    },
    verifyOtp: async function (opts) {
      var r = await ensure().auth.verifyOtp(opts);
      if (r.error) return { error: errMsg(r.error, '验证失败') };
      return { session: r.data };
    },
    resetPasswordForEmail: async function (email) {
      var r = await ensure().auth.resetPasswordForEmail(email);
      if (r.error) return { error: errMsg(r.error, '重置邮件发送失败') };
      return { updateUser: r.data && r.data.updateUser };
    },
    signOut: async function () {
      var r = await ensure().auth.signOut();
      if (r.error) return { error: errMsg(r.error, '退出失败') };
      return {};
    },
    onAuthStateChange: function (cb) {
      return ensure().auth.onAuthStateChange(cb);
    }
  };

  /* ---------- 收藏（bookmarks，v4.9.0） ----------
     站长的规则：**只有登录了才能收藏，未登录只能浏览**。

     为什么从 localStorage 搬到数据库：既然收藏已经绑定登录态，再存本机就会出现
     "登录了、收藏却只在这台设备上"的错位 —— 于是直接跟账号走（换设备也在）。
     表结构见 db/schema.sql §5：主键 (owner_id, post_id)、外键 cascade、anon 被 revoke。

     与 Posts/Images 的纪律一致，但有一处**刻意不同**：
       · 读路径 list() 在云端不可达时返回**空表**、不抛错 ——
         收藏是账号数据，静态快照里根本没有它；让页面显示"空收藏 + 一句提示"
         比整页报错合理（与电台退役后 Radio.list() 的处理同口径）。
         界面靠 NEON.isSnapshot() 区分"真的没有收藏"与"云端不可达"。
       · 写路径 add/remove **没有兜底**：云端不可达时就是不能收藏，抛错让界面给提示。
         绝不能"看起来收藏成功了、其实没存" —— 那比不能收藏更糟。 */
  var BOOKMARK_MAX = 500;   /* 与列表取数上限一致，防止无限增长 */

  var Bookmarks = {
    /* 我收藏的文章 id（最近收藏在前） */
    list: async function () {
      /* 快照模式下不必去试 —— 收藏是账号数据，静态快照里没有它。
         短路掉是为了省一次注定失败的请求（也让契约更明确：空表，不抛）。 */
      if (snapshotMode) return [];
      try {
        var r = await ensure().database.from('bookmarks')
          .select('post_id,created_at')
          .order('created_at', { ascending: false })
          .limit(BOOKMARK_MAX);
        if (r.error) throw new Error(errMsg(r.error, '读取收藏失败'));
        return (r.data || []).map(function (row) { return row.post_id; });
      } catch (e) {
        return [];   /* 云端不可达 / 未登录：空表，由界面给提示 */
      }
    },

    /* 收藏一篇（幂等：重复收藏不报错，靠主键 + ignore-duplicates） */
    add: async function (postId) {
      var id = parseInt(postId, 10);
      if (!isFinite(id) || id <= 0) throw new Error('收藏失败：文章 id 无效');
      var r = await ensure().database.from('bookmarks')
        .upsert({ post_id: id }, { onConflict: 'owner_id,post_id', ignoreDuplicates: true });
      if (r.error) {
        var code = pgCode(r.error);
        if (code === '42501') throw new Error('权限不足：请先登录再收藏');
        throw new Error(errMsg(r.error, '收藏失败'));
      }
      return true;
    },

    /* 取消收藏 */
    remove: async function (postId) {
      var id = parseInt(postId, 10);
      if (!isFinite(id) || id <= 0) return true;
      var r = await ensure().database.from('bookmarks').delete().eq('post_id', id);
      if (r.error) throw new Error(errMsg(r.error, '取消收藏失败'));
      return true;
    },

    /* 旧版本地收藏列表（一次性迁移用；v4.9.0 之前的 neon_bookmarks 键） */
    LEGACY_KEY: 'neon_bookmarks'
  };

  /* ---------- 文章 ---------- */
  var LIST_FIELDS = 'id,title,summary,tags,cover_ref,status,owner_name,created_at,updated_at';

  var Posts = {
    /* 已发布文章列表（公开，支持标签过滤与分页） */
    listPublished: async function (opts) {
      opts = opts || {};
      var page = opts.page || 1;
      var pageSize = opts.pageSize || 10;
      var tag = opts.tag || null;

      /* 行数据与总数分开取，避免依赖 count 头的返回形态 */
      var buildCond = function (q) {
        q = q.eq('status', 'published');
        if (tag) q = q.contains('tags', [tag]);
        return q;
      };

      var from = (page - 1) * pageSize;
      var rowsQuery = buildCond(
        ensure().database.from('posts').select(LIST_FIELDS)
      ).order('created_at', { ascending: false }).range(from, from + pageSize - 1);

      var countQuery = buildCond(
        ensure().database.from('posts').select('id', { count: 'exact', head: true })
      );

      /* B2：并行取「行数据」与「总数」—— 两者互不依赖，串行会让首屏白等一个往返。
         ★ 关键：必须用 allSettled 语义，不能用 Promise.all。
           Promise.all 是"一损俱损"：计数请求一旦在网络层 reject
           （连接抖动、超时、count RPC 未部署），整个 await 立即抛错，
           于是**已经成功拿到的文章行数据被一起丢弃**，
           用户看到的是"数据流连接失败" —— 明明文章能显示的。
           而下面 L* 本就写了"计数不可用时退化为估算"的降级分支，
           用 Promise.all 等于让这段降级代码永远走不到。
           错误范围必须与数据范围一致：计数的失败只该影响 total，
           不该连带废掉 posts。 */
      var settled = function (p) {
        return Promise.resolve(p).then(
          function (v) { return { ok: true, value: v }; },
          function (e) { return { ok: false, reason: e }; }
        );
      };
      var results = await Promise.all([settled(rowsQuery), settled(countQuery)]);
      var rowsS = results[0];
      var countS = results[1];

      /* 行数据失败才是真正的失败（没有内容可展示） */
      if (!rowsS.ok) throw new Error(errMsg(rowsS.reason, '文章列表加载失败'));
      var rowsRes = rowsS.value;
      if (rowsRes.error) throw new Error(errMsg(rowsRes.error, '文章列表加载失败'));

      var posts = rowsRes.data || [];

      /* 计数失败：不抛错，走下面的估算降级 —— 这是本函数刻意的容错设计 */
      var countRes = countS.ok ? countS.value : null;
      var total = (countRes && !countRes.error && typeof countRes.count === 'number')
        ? countRes.count
        : null;
      /* 计数不可用时退化为「已知条数」估算，保证分页与展示不崩 */
      if (total === null) total = posts.length < pageSize ? from + posts.length : from + posts.length + 1;

      return { posts: posts, total: total };
    },

    /* 标签统计（已发布文章） */
    tagStats: async function () {
      var r = await ensure().database.from('posts')
        .select('tags')
        .eq('status', 'published')
        .limit(1000);
      if (r.error) throw new Error(errMsg(r.error, '标签加载失败'));
      var map = {};
      (r.data || []).forEach(function (row) {
        (row.tags || []).forEach(function (t) {
          map[t] = (map[t] || 0) + 1;
        });
      });
      return map;
    },

    /* 文章详情（RLS 决定可见性：未发布仅作者可见） */
    get: async function (id) {
      var r = await ensure().database.from('posts')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (r.error) {
        var code = pgCode(r.error);
        if (code === '42P01') throw new Error('数据表尚未初始化');
        throw new Error(errMsg(r.error, '文章加载失败'));
      }
      return r.data || null;
    },

    /* 我的全部文章（含草稿） */
    listMine: async function (uid) {
      if (!uid) return [];
      var r = await ensure().database.from('posts')
        .select(LIST_FIELDS)
        .eq('owner_id', uid)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (r.error) throw new Error(errMsg(r.error, '我的文章加载失败'));
      return r.data || [];
    },

    /* 新建（owner_id 由数据库 DEFAULT auth.uid() 填充，客户端不传） */
    create: async function (data) {
      var payload = {
        title: data.title,
        summary: data.summary || null,
        content: data.content || '',
        tags: data.tags || [],
        cover_ref: data.cover_ref || null,
        status: data.status || 'draft'
      };
      var r = await ensure().database.from('posts').insert(payload).select('id').single();
      if (r.error) {
        var code = pgCode(r.error);
        if (code === '42501') throw new Error('权限不足：请先登录再写作');
        throw new Error(errMsg(r.error, '保存失败'));
      }
      return r.data;
    },

    /* 更新（RLS 仅放行自己的文章；data 为空数组表示未命中） */
    update: async function (id, fields) {
      var r = await ensure().database.from('posts')
        .update(fields)
        .eq('id', id)
        .select('id');
      if (r.error) throw new Error(errMsg(r.error, '更新失败'));
      var affected = Array.isArray(r.data) ? r.data : [];
      if (affected.length === 0) throw new Error('没有更新任何内容：文章不存在或不是你的');
      return true;
    },

    /* 删除 */
    remove: async function (id) {
      var r = await ensure().database.from('posts').delete().eq('id', id).select('id');
      if (r.error) throw new Error(errMsg(r.error, '删除失败'));
      var affected = Array.isArray(r.data) ? r.data : [];
      if (affected.length === 0) throw new Error('没有删除任何内容：文章不存在或不是你的');
      return true;
    },

    /* ---------- C16：标签管理（重命名 / 合并） ----------
       思路：标签是 jsonb 数组，没有独立表，重命名只能"读出来 → 改数组 → 写回去"。
       逐篇 update 而非一条 SQL —— 因为 PostgREST 的 update 不能做"数组内元素替换"，
       且逐篇能精确知道哪几篇成功、哪几篇失败（批量一条失败就全未知）。

       为什么要 listMine 而不是 listPublished：
         标签管理是**作者侧**功能，草稿也带标签，一起改掉才能保证
         "改完之后所有文章里都不再出现旧标签"。公开接口拿不到草稿。 */
    renameTag: async function (uid, from, to) {
      if (!uid) throw new Error('请先登录');
      var oldTag = String(from == null ? '' : from).trim();
      var newTag = String(to == null ? '' : to).trim();
      if (!oldTag) throw new Error('旧标签不能为空');
      if (!newTag) throw new Error('新标签不能为空');
      if (newTag.length > 40) throw new Error('标签过长（上限 40 字）');

      /* 1) 拉出全部自己的文章（含草稿），筛出含旧标签的 */
      var r = await ensure().database.from('posts')
        .select('id,tags,title')
        .eq('owner_id', uid)
        .limit(500);
      if (r.error) throw new Error(errMsg(r.error, '读取文章失败'));
      var rows = r.data || [];
      var hits = rows.filter(function (row) {
        return Array.isArray(row.tags) && row.tags.indexOf(oldTag) !== -1;
      });
      if (hits.length === 0) return { changed: 0, failed: [] };

      /* 2) 逐篇替换：去重（合并场景下新标签可能已在同一篇里存在）+ trim 清洗 */
      var changed = 0;
      var failed = [];
      for (var i = 0; i < hits.length; i++) {
        var row2 = hits[i];
        var next = [];
        (row2.tags || []).forEach(function (t) {
          var v = String(t == null ? '' : t).trim();
          if (v === '') return;
          if (v === oldTag) v = newTag;             /* 重命名 */
          if (next.indexOf(v) === -1) next.push(v); /* 合并去重 */
        });
        try {
          var u = await ensure().database.from('posts')
            .update({ tags: next })
            .eq('id', row2.id)
            .select('id');
          if (u.error) throw new Error(errMsg(u.error, '更新失败'));
          if (!Array.isArray(u.data) || u.data.length === 0) {
            throw new Error('未命中（可能不是你的文章）');
          }
          changed++;
        } catch (e) {
          /* 单篇失败不中断：把失败的文章记下来，让用户知道哪些没改到 */
          failed.push({ id: row2.id, title: row2.title, reason: errMsg(e, '更新失败') });
        }
      }
      return { changed: changed, failed: failed };
    }
  };

  /* ---------- E1：前端错误上报 ----------
     生产白屏时用户不会开 F12，所以错误必须能自己回到库里。

     脱敏边界（安全基线：对外脱敏，原始错误只进 console）：
       · 写库的 message 是 scrubbed（裁长度 + 抹掉疑似 URL/邮箱/令牌）
       · 原始 error 对象只在 console 打印，不入库
       · 不采集任何表单输入内容
     写失败静默（上报通道自己不能成为新的错误源）。

     库层配套约束（改这里必须同步复核表结构）：
       · error_logs.owner_id 有 DEFAULT auth.uid()::uuid —— 客户端不传归属，
         由数据库按当前会话身份填充（与 posts.owner_id 同一机制）。
         注意必须显式 ::uuid 转型：auth.uid() 返回 text，直接用作 uuid 列默认值
         会报 42804「column is of type uuid but default expression is of type text」。
       · RLS select_own 用 owner_id::text = auth.uid()，故匿名上报（uid 为 NULL）
         归属为 NULL，登录后读不到 —— 匿名本就没有身份，这是设计使然。
       · 表只授 INSERT + 本人 SELECT，无 UPDATE/DELETE（日志只能追加）。 */
  var ERR_TABLE = 'error_logs';
  var MAX_MSG = 1000;
  var errSent = 0;          /* 单次会话上报计数 */
  var ERR_BUDGET = 10;      /* 会话内最多上报条数，防刷库 */

  function scrubMessage(s) {
    return String(s == null ? '' : s)
      .replace(/https?:\/\/\S+/gi, '[url]')                    /* 抹掉 URL（可能含 key） */
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')          /* 抹掉邮箱 */
      .replace(/\b(wbpk_|eyJ)[\w-]+\b/gi, '[token]')           /* 抹掉平台 key / JWT 片段 */
      .slice(0, MAX_MSG);
  }

  function scrubPath(s) {
    return String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ').slice(0, 500);
  }

  var Errors = {
    /* kind: 'error' | 'rejection' | 'manual' */
    report: async function (kind, payload) {
      if (errSent >= ERR_BUDGET) return false;
      errSent++;
      try {
        var row = {
          kind: kind === 'rejection' ? 'rejection' : (kind === 'manual' ? 'manual' : 'error'),
          build: scrubPath(payload.build || '').slice(0, 32),
          message: scrubMessage(payload.message),
          source: scrubPath(payload.source),
          lineno: Number.isFinite(payload.lineno) ? payload.lineno : null,
          colno: Number.isFinite(payload.colno) ? payload.colno : null,
          path: scrubPath(payload.path),
          ua: scrubPath(payload.ua).slice(0, 300)
        };
        var r = await ensure().database.from(ERR_TABLE).insert(row);
        if (r && r.error) return false;
        return true;
      } catch (e) {
        return false; /* 上报通道自身失败不得再抛 */
      }
    },
    /* 作者可读自己的最近错误（RLS 限定 owner_id = auth.uid()） */
    listMine: async function (uid, limit) {
      if (!uid) return [];
      try {
        var r = await ensure().database.from(ERR_TABLE)
          .select('id,kind,message,build,path,created_at')
          .eq('owner_id', uid)
          .order('created_at', { ascending: false })
          .limit(limit || 50);
        if (r.error) return [];
        return r.data || [];
      } catch (e) { return []; }
    },
    /* 内部：脱敏函数导出给测试 */
    _scrub: scrubMessage
  };

  /* ---------- 图片（公开读 + 云存储备份） ----------
     双缓存策略（B1 图片加载重构）：
     · imageCache —— 完整图（详情页正文用）
     · thumbCache —— 缩略图（列表页封面用，尺寸见下方 THUMB_MAX_DIM）
     旧数据无 thumb 字段时自动回退拉完整图，新旧行为兼容。
     ⚠ v2.2.1：缩略图从 256px 提到 1024px —— 列表封面展示宽 1046px，
       256px 会被 background-size:cover 放大 4 倍，是封面发虚的主因。

     A3 安全收口（M-2）：
     · 读取走视图 public_images —— 只暴露展示必需字段，不含 owner_id / storage_path；
       基表 post_images 的匿名 SELECT 已收回，访客无法再枚举 owner_id 等元信息。
     · 写入仍走基表（owner 由 DEFAULT auth.uid() 填充，客户端不传）。
     · content_type 经 SAFE_MIME 二次白名单校验后再拼 data URL，
       不信任库内返回值（纵深防御：库层有 CHECK，前端再兜一层）。 */
  var imageCache = new Map(); /* id -> 完整图 dataUrl */
  var thumbCache = new Map(); /* id -> 缩略图 dataUrl */

  /* 视图名：读取通道。改名只需动这一处。 */
  var IMAGE_READ_TABLE = 'public_images';
  var IMAGE_WRITE_TABLE = 'post_images';

  var SAFE_MIME = /^image\/(jpeg|png|gif|webp)$/i;

  function safeMime(ct) {
    return SAFE_MIME.test(String(ct || '')) ? ct : 'image/jpeg';
  }

  function cachePut(cache, id, url) {
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    cache.set(id, url);
  }

  function toDataUrl(contentType, base64) {
    return 'data:' + safeMime(contentType) + ';base64,' + base64;
  }

  /* 尺寸缓存：B3 用它在渲染时给 <img> 补 width/height 占位（消除 CLS）。
     数据来源是 post_images 的 width/height 列，public_images 视图已暴露（已核实）。
     ⚠ 存的是【原图】尺寸，缩略图等比缩放，宽高比一致，用于占位是准的。 */
  var dimsCache = new Map();
  function dimsPut(id, w, h) {
    if (w && h) dimsCache.set(id, { width: w, height: h });
  }

  /* 完整图查询并填充结果与缓存 */
  async function fetchFullRows(ids, result) {
    var r = await ensure().database.from(IMAGE_READ_TABLE)
      .select('id,content_type,data,width,height')
      .in('id', ids);
    if (r.error) return; /* 单图失败不阻塞渲染 */
    (r.data || []).forEach(function (row) {
      var url = toDataUrl(row.content_type, row.data);
      result.set(row.id, url);
      cachePut(imageCache, row.id, url);
      dimsPut(row.id, row.width, row.height);
    });
  }

  var Images = {
    /* 写入图片记录（压缩 base64 + 缩略图），owner 由 DEFAULT auth.uid() 填充 */
    insert: async function (meta) {
      var payload = {
        content_type: meta.content_type,
        data: meta.data,
        thumb: meta.thumb || null,
        storage_path: meta.storage_path || null,
        width: meta.width || null,
        height: meta.height || null,
        size_bytes: meta.size_bytes || null
      };
      var r = await ensure().database.from(IMAGE_WRITE_TABLE).insert(payload).select('id').single();
      if (r.error) {
        var code = pgCode(r.error);
        if (code === '42501') throw new Error('权限不足：请先登录再上传图片');
        throw new Error(errMsg(r.error, '图片保存失败'));
      }
      return r.data.id;
    },

    /* 批量取图（带缓存），返回 Map(id -> dataUrl)
       opts.thumb = true 时取缩略图（列表页封面用）；
       旧行无缩略图自动回退取完整图。 */
    fetchMany: async function (ids, opts) {
      var wantThumb = !!(opts && opts.thumb);
      var cache = wantThumb ? thumbCache : imageCache;
      var miss = [];
      var result = new Map();
      ids.forEach(function (id) {
        if (cache.has(id)) result.set(id, cache.get(id));
        else if (miss.indexOf(id) === -1) miss.push(id);
      });
      if (miss.length === 0) return result;

      if (!wantThumb) {
        await fetchFullRows(miss, result);
        return result;
      }

      /* 缩略图优先；无 thumb 的旧行回退完整图 */
      var rt = await ensure().database.from(IMAGE_READ_TABLE)
        .select('id,content_type,thumb,width,height')
        .in('id', miss);
      if (rt.error) return result;
      var legacy = [];
      (rt.data || []).forEach(function (row) {
        dimsPut(row.id, row.width, row.height);
        if (row.thumb) {
          var url = toDataUrl(row.content_type, row.thumb);
          result.set(row.id, url);
          cachePut(thumbCache, row.id, url);
        } else {
          legacy.push(row.id);
        }
      });
      if (legacy.length > 0) await fetchFullRows(legacy, result);
      return result;
    },

    /* B3：取图片原始尺寸（供渲染层补 width/height 占位）。
       只在 fetchMany 跑过之后有值，拿不到返回 null —— 调用方须容忍缺失。 */
    dims: function (id) {
      return dimsCache.get(id) || null;
    }
  };

  /* ---------- 云存储（原始图片备份 + 附件） ---------- */
  var ATTACH_MAX = 20 * 1024 * 1024;      /* 20MB */
  var IMAGE_MAX = 10 * 1024 * 1024;       /* 10MB */
  var IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  function safeName(name) {
    var cleaned = String(name || 'file')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\.\+/g, '.')
      .replace(/^\.+/, '');
    if (!/^[a-zA-Z0-9]/.test(cleaned)) cleaned = 'f_' + cleaned;
    return cleaned.slice(0, 80) || 'file';
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var Storage = {
    /* 图片原始文件 → 云存储 shared 路径（登录后可公开给站内用户） */
    uploadImage: async function (file, uid) {
      if (IMAGE_TYPES.indexOf(file.type) === -1) throw new Error('仅支持 JPG / PNG / GIF / WebP 图片');
      if (file.size > IMAGE_MAX) throw new Error('图片不能超过 10MB');
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      var path = cloud.storage.sharedPath(uid, 'blog/images/' + uuid() + '.' + ext);
      var r = await cloud.storage.upload(path, file, { contentType: file.type });
      if (r.error) throw new Error(errMsg(r.error, '云端备份上传失败（不影响文章内显示）'));
      return path;
    },

    /* 附件 → 云存储 shared 路径 */
    uploadAttachment: async function (file, uid) {
      if (file.size > ATTACH_MAX) throw new Error('附件不能超过 20MB');
      var ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      var base = safeName(file.name.replace(/\.[^.]*$/, ''));
      var suffix = ext ? '.' + ext : '';
      var path = cloud.storage.sharedPath(uid, 'blog/attachments/' + uuid() + '__' + base + suffix);
      var r = await cloud.storage.upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (r.error) throw new Error(errMsg(r.error, '附件上传失败'));
      return { path: path, name: safeName(file.name), size: file.size };
    },

    /* 签名下载 URL（需登录），返回字符串地址。
       ⚠ ttl 必须在 1~3600 之间（平台硬限制），这里统一夹取再下发。 */
    signedUrl: async function (path, ttl) {
      var r = await cloud.storage.createSignedUrl(path, clampTtl(ttl, 1800));
      if (r.error) throw new Error(errMsg(r.error, '获取下载链接失败'));
      var d = r.data;
      if (d && typeof d === 'object') return d.url || d.signedUrl || d.href || null;
      return d || null;
    }
  };

  /* ============================================================
     v2.9.0：电台（RADIO）数据层 —— 音频以 base64 存库（不再是云存储）
     ------------------------------------------------------------
     表 radio_tracks（RLS：读全开，增/改/删仅本人）：
       id / title / artist / album / data / duration_sec / size_bytes
       / mime / cover_url / sort_order / owner_id / created_at
     读取视图 public_radio（前端列表与播放都读它，**含 data 列**）。

     ⚠⚠ 为什么音频不能放云存储（2026-09-29 真实故障，血泪）：
        云存储**只服务登录用户**（官方文档原文：
          「Storage is for signed-in users. Public Bucket/public URL access
            is not exposed.」）
        ⇒ 未登录访客调 createSignedUrl 直接 `MISSING_CREDENTIALS`。
        而电台的需求是「**所有人**可听」—— 两者互斥，无解。
        改存数据库 + 公开视图后匿名访客也能读到（图片一直就是这么做的，
        所以封面自古就能匿名显示，音频当初却选了存储 —— 这就是分叉点）。

     ⚠ 代价（必须知道）：base64 比二进制大 33%，且**整首一次性传输**
       （不是流式，没有 Range 请求，拖动需先下完）。故：
         · 单曲上限维持 24MB（与 v2.8.0 存储方案一致，不缩用户的曲库）；
           24MiB 的 base64 最坏 33.55M 字符 ⇒ 库层 CHECK 取 36M（余量 ~7%）
         · list() **绝不带 data** —— 否则开个面板要下全库音频
         · 播放时按 id 单行取，并做**带上限**的 LRU 缓存（条数 + 字符总量双限）
     ⚠ 体积上限是「三保险」：客户端 readAudio 挡一次、读出的 data URL
       再量一次长度、库层 CHECK 兜底（防绕过前端直传）。
     ⚠ owner_id 是 **text** 不是 uuid —— 与 posts.owner_id 保持一致，
       RLS 里 auth.uid() 返回 text，类型不匹配会报 42883。
     ============================================================ */
  var AUDIO_MAX = 24 * 1024 * 1024;      /* 单曲二进制上限 24MB */
  /* base64 后最坏长度 = ceil(n/3)*4 + 前缀。24MiB → 33554432 + ~24 ≈ 33.55M 字符。
     库层 CHECK 取 36,000,000 ⇒ 余量约 7%（沿用图片那套「贴上限留 5~6%+」）。 */
  var AUDIO_DATA_MAX = 36000000;
  var AUDIO_TYPES = [
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
    'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac',
    'audio/webm', 'audio/opus'
  ];
  /* 扩展名兜底：部分系统对 .m4a/.flac 给不出 MIME（type 为空串） */
  var AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
  /* 扩展名 → MIME（浏览器给不出 type 时按扩展名补，存 data URL 需要正确的头） */
  var AUDIO_MIME_BY_EXT = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
    oga: 'audio/ogg', opus: 'audio/opus', wav: 'audio/wav', flac: 'audio/flac',
    webm: 'audio/webm'
  };
  /* ⚠⚠ 签名 URL 有效期有**平台硬上限 3600 秒**（1 小时）—— SDK 源码里
     `validateSignedURLTTL` 对越界直接抛
     "Signed URL expiry must be an integer between 1 and 3600 seconds."
     v2.8.0 首次上线时电台曾写 7200 → 播放链路第一步就炸、点播放毫无反应。
     ⚠ 这是参数非法、**与登录状态无关**：登录用户一样播不了，别往权限上查。
     电台本身已不再走签名（改读库），但这套夹取仍是附件下载等场景的地基。 */
  var SIGNED_TTL_MAX = 3600;
  var SIGNED_TTL_MIN = 1;
  var SIGNED_TTL_DEFAULT = 1800;         /* 未指定时的兜底（落在合法区间中部） */
  /* 出口统一夹取：任何调用方传错都不该把整条链路炸掉 */
  function clampTtl(ttl, fallback) {
    var t = Number(ttl);
    if (!isFinite(t)) t = Number(fallback);
    if (!isFinite(t)) t = SIGNED_TTL_DEFAULT;
    t = Math.floor(t);
    if (t < SIGNED_TTL_MIN) t = SIGNED_TTL_MIN;
    if (t > SIGNED_TTL_MAX) t = SIGNED_TTL_MAX;
    return t;
  }
  /* 读取侧视图：**数据就在同一个库**，所以匿名可读 = 所有人可听 */
  var RADIO_READ_TABLE = 'public_radio';
  var RADIO_WRITE_TABLE = 'radio_tracks';
  /* ⚠ 白名单**故意不含 data** —— 列表只取展示必需字段。
     带上 data 会让「打开面板」变成「下载整个曲库」，是致命的性能陷阱。
     v4.9.5：带上 source_url（外链音源）—— 它只是一条几十字符的 URL，
     与 data 完全不同量级；列表靠它区分"内链 / 外链"，也给 playUrl 走捷径。 */
  var RADIO_FIELDS = 'id,title,artist,album,mime,duration_sec,size_bytes,sort_order,cover_url,has_data,source_url,created_at';
  /* ⚠⚠ 视图**算出来**的列（基表没有），只在读视图时可用。
     has_data = (data IS NOT NULL OR source_url IS NOT NULL)，是为了让列表能判断
     "能不能播"而不必拉 data（v4.9.5 起把外链也算作可播）。
     把它混进基表（写路径）会让 PostgREST 生成
     `INSERT ... RETURNING …, has_data` → 42703：
     「column radio_tracks.has_data does not exist」——上传直接失败。 */
  var RADIO_VIEW_ONLY = ['has_data'];
  /* 基表（写路径）可返回的列 = 视图字段减去视图专有列。
     ⚠ 写路径**必须**用它，别图省事复用 RADIO_FIELDS。 */
  var RADIO_WRITE_FIELDS = RADIO_FIELDS.split(',').filter(function (c) {
    return RADIO_VIEW_ONLY.indexOf(c) < 0;
  }).join(',');
  /* 单曲音频数据的读取字段（与上互斥，只给 playUrl 用） */
  var RADIO_DATA_FIELDS = 'id,data,mime';
  /* 已取回的 data URL 缓存：重播 / 上下一首来回切换不必重下整首。
     ⚠ 必须**双限**（条数 + 字符总量）：单首 data URL 最坏 33.5M 字符
     （约 33MB 内存），只限条数的话「3 条」就是 100MB，移动端直接崩。
     字符上限 40M ≈ 40MB 内存，与「条数 ≤2」共同兜住上界。 */
  var RADIO_CACHE_MAX_ITEMS = 2;
  var RADIO_CACHE_MAX_CHARS = 40000000;
  var radioCache = [];
  function radioCacheTotal() {
    var n = 0;
    for (var i = 0; i < radioCache.length; i++) n += (radioCache[i].url || '').length;
    return n;
  }
  function radioCacheGet(id) {
    for (var i = 0; i < radioCache.length; i++) {
      if (radioCache[i].id === id) {
        var hit = radioCache.splice(i, 1)[0];
        radioCache.push(hit);          /* 命中即置为最近使用 */
        return hit.url;
      }
    }
    return null;
  }
  function radioCachePut(id, url) {
    radioCache = radioCache.filter(function (e) { return e.id !== id; });
    radioCache.push({ id: id, url: url });
    while (radioCache.length > 1 &&
           (radioCache.length > RADIO_CACHE_MAX_ITEMS ||
            radioCacheTotal() > RADIO_CACHE_MAX_CHARS)) {
      radioCache.shift();
    }
  }
  function radioCacheDrop(id) {
    radioCache = radioCache.filter(function (e) { return e.id !== id; });
  }
  /* 由文件推断音频 MIME（浏览器给空 type 时用扩展名兜底） */
  function audioMime(file, name) {
    if (file && file.type) return String(file.type).slice(0, 120);
    var ext = String(name || (file && file.name) || '').split('.').pop().toLowerCase();
    return AUDIO_MIME_BY_EXT[ext] || 'audio/mpeg';
  }
  /* 是否白名单内的音频（MIME 或扩展名任一命中即可） */
  function isAudioFile(file) {
    if (!file) return false;
    if (AUDIO_TYPES.indexOf(file.type) >= 0) return true;
    return AUDIO_EXT.test(file.name || '');
  }

  var Radio = {
    /* 曲目列表（匿名可读，按 sort_order 再按 id 升序 —— 稳定不跳动）
       ⚠ 查的是**视图 public_radio** 且**不含 data** —— 见 RADIO_FIELDS 注释。 */
    list: async function () {
      var res = await ensure().database.from(RADIO_READ_TABLE)
        .select(RADIO_FIELDS)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (res.error) throw new Error(errMsg(res.error, '曲目列表加载失败'));
      return res.data || [];
    },

    /* 把音频文件读成 data URL（base64）。**不写云存储**：
       云存储只服务登录用户，匿名访客拿不到可播地址，与「所有人可听」互斥。
       返回 { data, size, mime, name }；data 即 `data:audio/mpeg;base64,...`。 */
    readAudio: function (file) {
      return new Promise(function (resolve, reject) {
        function bail(msg) { reject(new Error(msg)); }
        if (!file) { bail('请选择音频文件'); return; }
        if (!isAudioFile(file)) {
          bail('仅支持 MP3 / M4A / AAC / OGG / WAV / FLAC 音频'); return;
        }
        if (file.size > AUDIO_MAX) {
          bail('单个音频不能超过 ' + Math.round(AUDIO_MAX / 1048576) + 'MB');
          return;
        }
        if (typeof FileReader === 'undefined') {
          bail('当前浏览器不支持本地文件读取，请换新版浏览器'); return;
        }
        var fr = new FileReader();
        fr.onerror = function () { bail('音频读取失败（文件可能已损坏）'); };
        fr.onload = function () {
          var url = String((fr.result === null || typeof fr.result === 'undefined') ? '' : fr.result);
          if (url.indexOf('data:') !== 0 || url.indexOf('base64,') < 0) {
            bail('音频读取结果异常'); return;
          }
          /* 第二道体积关：真实字符串长度（不是估算）也要过库上限 */
          if (url.length > AUDIO_DATA_MAX) {
            bail('音频体积超出库上限（约 ' + Math.round(AUDIO_DATA_MAX / 1048576) + 'MB 字符），请压缩后重试');
            return;
          }
          resolve({ data: url, size: file.size, mime: audioMime(file), name: String(file.name || '') });
        };
        fr.readAsDataURL(file);
      });
    },

    /* 读时长（可选步骤，失败返回 null 且**不阻断上传**）。
       做法：objectURL + 临时 Audio 只取元数据，拿到就 revoke。
       ⚠ 必须有超时兜底 —— 个别格式浏览器解析不出元数据会一直不触发事件。 */
    probeDuration: function (file) {
      return new Promise(function (resolve) {
        var A = (typeof window !== 'undefined') ? window.Audio : null;
        var U = (typeof window !== 'undefined') ? window.URL : null;
        if (!A || !U || typeof U.createObjectURL !== 'function') { resolve(null); return; }
        var objUrl = null, audio = null, timer = null, done = false;
        function finish(v) {
          if (done) return;
          done = true;
          if (timer) { clearTimeout(timer); timer = null; }
          try { if (objUrl) U.revokeObjectURL(objUrl); } catch (e) {}
          if (audio) { try { audio.removeAttribute('src'); } catch (e) {} }
          resolve(v);
        }
        try {
          objUrl = U.createObjectURL(file);
          audio = new A();
          audio.preload = 'metadata';
          audio.addEventListener('loadedmetadata', function () {
            var d = audio.duration;
            finish((isFinite(d) && d > 0) ? Math.round(d) : null);
          });
          audio.addEventListener('error', function () { finish(null); });
          timer = setTimeout(function () { finish(null); }, 4000);
          audio.src = objUrl;
        } catch (e) { finish(null); }
      });
    },

    /* 单曲音频数据（data URL）。**单行拉取** —— 这正是「所有人可听」的关键：
       匿名访客从公开视图读到音频本体，不需要任何登录态或签名 URL。
       ⚠ 返回体量可达十几 MB，调用方务必只取当前要播的那一首。 */
    trackData: async function (id) {
      if (id === null || typeof id === 'undefined' || id === '') {
        throw new Error('缺少曲目标识');
      }
      var res = await ensure().database.from(RADIO_READ_TABLE)
        .select(RADIO_DATA_FIELDS)
        .eq('id', id)
        .limit(1);
      if (res.error) throw new Error(errMsg(res.error, '音频读取失败'));
      var r = (res.data && res.data[0]) || null;
      if (!r) throw new Error('该曲目不存在或已被移除');
      if (!r.data) {
        throw new Error('该曲目暂无音频数据（多半是旧版上传），请删除后重新上传');
      }
      return r.data;
    },

    /* 入库一条曲目记录。⚠ 音频本体走 meta.data（data URL），不再有 storage_path。 */
    /* 入库一条曲目。**两种音源二选一**（v4.9.5 起）：
         · meta.source_url —— 外链音源（https 直链，库里只存这一条 URL）
         · meta.data       —— 内链音源（base64 data URL 全文，兼容既有记录）
       ⚠ 两者都没有 = 一条"看着能播、点了没声"的记录，必须在入口就挡住。 */
    create: async function (meta) {
      meta = meta || {};
      var title = String(meta.title || '').trim();
      if (!title) throw new Error('请填写曲目名称');
      if (title.length > 200) throw new Error('曲目名称不能超过 200 字');
      var srcUrl = Radio.normalizeSourceUrl(meta.source_url);
      if (!srcUrl && !meta.data) throw new Error('缺少音源：请上传音频文件，或填写 https 直链');
      if (meta.data && !srcUrl && String(meta.data).length > AUDIO_DATA_MAX) {
        throw new Error('音频体积超出库上限，请压缩后重试');
      }

      var row = {
        title: title,
        artist: meta.artist ? String(meta.artist).trim().slice(0, 200) : null,
        album: meta.album ? String(meta.album).trim().slice(0, 200) : null,
        /* 音源二选一：外链走 source_url（data 留 null），内链走 data。
           storage_path 一律 null（旧云存储方案遗留，让新旧记录在库层面一眼可分）。 */
        data: srcUrl ? null : String(meta.data),
        source_url: srcUrl,
        storage_path: null,
        duration_sec: (typeof meta.duration_sec === 'number' && meta.duration_sec >= 0)
          ? Math.round(meta.duration_sec) : null,
        size_bytes: (typeof meta.size_bytes === 'number' && meta.size_bytes >= 0)
          ? Math.round(meta.size_bytes) : null,
        mime: meta.mime ? String(meta.mime).slice(0, 120) : null,
        cover_url: meta.cover_url ? String(meta.cover_url).slice(0, 2000) : null,
        sort_order: (typeof meta.sort_order === 'number') ? Math.round(meta.sort_order) : 0,
        owner_id: meta.owner_id
      };
      /* ⚠ 两件事必须同时成立：
         ① select 用 RADIO_WRITE_FIELDS（基表列）——**不能**用 RADIO_FIELDS，
            里面的 has_data 是视图算出来的，基表插入时 RETURNING 会报 42703。
         ② 同样**不含 data**：否则入库响应会把刚上传的十几 MB 原样回吐一遍，白等一倍时间。 */
      var res = await ensure().database.from(RADIO_WRITE_TABLE).insert(row).select(RADIO_WRITE_FIELDS);
      if (res.error) throw new Error(errMsg(res.error, '曲目入库失败'));
      var saved = (res.data && res.data[0]) || null;
      if (saved) {
        /* 刚入库的行必然有音源 → 补上视图才有的 has_data，
           让返回对象与 list() 的行**同形**（调用方不必按来源分支判断）。 */
        saved.has_data = true;
        radioCacheDrop(saved.id);   /* 同 id 重传时清掉旧缓存 */
      }
      return saved;
    },

    /* 规范化外链音源。返回 '' 表示"没填"；填了但不合法则**抛错**（不静默丢弃 ——
       静默会变成"看着加成功了、点了没声"，比报错难查得多）。
       ⚠ 与库层的 CHECK 同规则（只放行 https）：http 会被浏览器当混合内容拦掉，
         javascript:/data:text/html 之类更不该进这条管道。 */
    normalizeSourceUrl: function (raw) {
      var s = String(raw == null ? '' : raw).trim();
      if (!s) return '';
      if (s.length > 2000) throw new Error('音频直链过长（上限 2000 字符）');
      if (!/^https:\/\//i.test(s)) throw new Error('音频直链必须以 https:// 开头');
      /* 只做结构性校验，不"猜"合法性：能不能播最终由 <audio> 说了算 */
      try { new URL(s); } catch (e) { throw new Error('音频直链格式不正确'); }
      return s;
    },

    /* 只凭一个外链入库（供 UI 的"贴链接"入口调用）。
       与 addTrack 并列：那个走文件（读 base64 + 探时长），这个不碰文件。
       ⚠ 时长/体积都留空 —— 外链不必下载就能播，播放时由 <audio> 自己得出时长。 */
    addByUrl: async function (url, meta, uid) {
      return await Radio.create({
        title: (meta && meta.title) || '',
        artist: meta && meta.artist,
        album: meta && meta.album,
        cover_url: meta && meta.cover_url,
        sort_order: meta && meta.sort_order,
        source_url: url,
        mime: meta && meta.mime,
        owner_id: uid
      });
    },

    /* 入库**前**先问浏览器一句："这个地址你到底能不能当音频加载？"
       v4.9.6 新增：站长第一次贴的是 B 站**网页地址**，库里存得好好的、
       播放时才报 "no supported sources" —— 句子里既像网络故障又像文件损坏，
       谁也不知道是自己贴错了。入口拦一次，这类错就再也进不了库。

       ⚠ 为什么用 <audio> 而不是 fetch 看 Content-Type：
         · 同源策略/防盗链会让 fetch 拿到与 <audio> **不同**的结果；
         · .m3u8 / 无扩展名的音频流 Content-Type 常是 text/plain，但照样能播；
         · 最终"能不能播"本来就由 <audio> 说了算 —— 那就直接问它。
       ⚠ 不需要 CORS：媒体元素播放是"不透明"加载（只有 Web Audio 分析才要 CORS）。
       返回 { ok:true, duration } 或 { ok:false, reason }；**永不抛错**（调用方按 ok 分支）。 */
    probeSourceUrl: function (url) {
      return new Promise(function (resolve) {
        var A = (typeof window !== 'undefined') ? window.Audio : null;
        if (!A) { resolve({ ok: false, reason: '当前环境无法试听校验，请自行确认地址可用' }); return; }
        var audio = null, timer = null, done = false;
        function finish(r) {
          if (done) return;
          done = true;
          if (timer) { clearTimeout(timer); timer = null; }
          if (audio) { try { audio.removeAttribute('src'); audio.load(); } catch (e) {} }
          resolve(r);
        }
        try {
          audio = new A();
          audio.preload = 'metadata';
          audio.addEventListener('loadedmetadata', function () {
            var d = audio.duration;
            finish({ ok: true, duration: (isFinite(d) && d > 0) ? Math.round(d) : null });
          });
          audio.addEventListener('error', function () {
            var code = (audio.error && audio.error.code) || 0;
            finish({
              ok: false,
              code: code,
              /* code 4 = 不是可播放的音频（网页链接/需登录/防盗链都会落到这里） */
              reason: code === 4
                ? '这个地址不是可直接播放的音频文件（可能是网页链接、需要登录，或开了防盗链）'
                : '这个地址无法作为音频加载（网络/格式问题）'
            });
          });
          /* 超时兜底：个别源既不报错也不给元数据（一直转圈）——不能让表单卡死 */
          timer = setTimeout(function () { finish({ ok: false, reason: '试听超时：地址无响应或太慢' }); }, 8000);
          audio.src = url;
          audio.load();
        } catch (e) {
          finish({ ok: false, reason: '试听校验失败：' + ((e && e.message) || '未知原因') });
        }
      });
    },

    /* 读文件 + 取时长 + 入库，一步到位（供 UI 调用）。
       ⚠ 没有「回删已上传文件」这一步了 —— 音频不再有独立的存储对象，
         入库失败就是整条失败，不会留孤儿（原 storage 方案的孤儿问题天然消失）。 */
    addTrack: async function (file, meta, uid) {
      var read = await Radio.readAudio(file);
      var probed = await Radio.probeDuration(file);
      return await Radio.create({
        title: (meta && meta.title) || String(read.name || '').replace(/\.[^.]*$/, ''),
        artist: meta && meta.artist,
        album: meta && meta.album,
        duration_sec: (meta && meta.duration_sec) || probed,
        cover_url: meta && meta.cover_url,
        sort_order: meta && meta.sort_order,
        data: read.data,
        size_bytes: read.size,
        mime: read.mime,
        owner_id: uid
      });
    },

    /* 删除曲目：音频本体就在这一行里，删记录 == 删音频
       （不再有独立的存储对象，因此也没有「文件删不掉」的中间态）。 */
    removeTrack: async function (row) {
      if (!row || !row.id) throw new Error('缺少曲目标识');
      var res = await ensure().database.from(RADIO_WRITE_TABLE).delete().eq('id', row.id);
      if (res.error) throw new Error(errMsg(res.error, '曲目删除失败'));
      radioCacheDrop(row.id);
      return true;
    },

    /* 取可播放地址。入参兼容「整行」与「id」，返回一个**可直接交给 <audio> 的地址**：
         · 有 source_url（外链音源）→ 直接返回它，**不碰 base64**（v4.9.5 起）
         · 否则 → 取库里的 data URL（内链，永久有效）
       ⚠ 两种来源对播放内核完全一样（它只认"一个地址"），所以 radio.js 一行都不用改。
       ⚠ 不带过期时间 ⇒ 无需续签（radio.js 已按「返回字符串 = 永久」处理）。
       ⚠ 带 LRU 缓存：上下一首来回切、播完重播都不会重新拉十几 MB。
         外链也进缓存（几十字符，代价可忽略），语义上更一致。 */
    playUrl: async function (row) {
      var id = (row && typeof row === 'object') ? row.id : row;
      var hit = radioCacheGet(id);
      if (hit) return hit;
      var direct = (row && typeof row === 'object') ? row.source_url : null;
      if (direct) {
        radioCachePut(id, direct);
        return direct;
      }
      var url = await Radio.trackData(id);
      radioCachePut(id, url);
      return url;
    },

    /* 批量重排：rows 为 [{id, sort_order}] */
    reorder: async function (rows) {
      if (!rows || !rows.length) return true;
      for (var i = 0; i < rows.length; i++) {
        var res = await ensure().database.from(RADIO_WRITE_TABLE)
          .update({ sort_order: rows[i].sort_order })
          .eq('id', rows[i].id);
        if (res.error) throw new Error(errMsg(res.error, '排序保存失败'));
      }
      return true;
    }
  };

  /* ---------- 图片尺寸标准（v2.2.1 统一封面清晰度） ----------
     ⚠ 改动这两个常量前，先算一遍「展示尺寸 → 源图需求」，别拍脑袋调。

     实测封面展示盒（.card-cover）：宽 1046px × 高 190px
       推导：.wrap 1120 - padding 40 = 1080 卡宽
             - .post-card padding 26×2 - border 1×2 = 1026
             + .card-cover 负边距 10×2 = 1046
     于是：
       · 1x 屏需源图 ≥ 1046px 宽
       · 2x 高清屏需源图 ≥ 2092px 宽

     为什么原来是糊的：
       缩略图只生成 256px，而背景用 background-size:cover 铺满 1046px，
       等于把 256px **放大 4.09 倍** —— 这就是"发虚 + 像素感"的直接来源。
       更糟的是"清晰度不一致"：老图（无缩略图）会回退取 1280px 原图（清晰），
       新图走 256px 缩略图（糊），同样是封面、两种来源，观感必然不齐。

     现在的标准（数字是拿真实存量图实测过的，不是估的）：
       · IMAGE_MAX_DIM = 2160 —— 展示版本（正文图 + 详情页封面）。
         封面/正文展示宽 1046px，2x 屏需 2092px；2160 = 2.06x，过线还留余量。
       · THUMB_MAX_DIM = 1280 —— 列表页封面专用，1046px 展示下 1.22x，
         1x 屏绝不放大；2x 屏 0.61x（柔，但"像素块"这种硬伤不会再有）。
         实测 1280/q0.75 与 1024/q0.82 体积几乎一样（~170~340KB vs 159~289KB），
         同样的字节买多 25% 分辨率 —— 所以选 1280 而不是 1024。
         不加到 2048+：列表是竖向堆叠 + 懒加载，首屏只 1~2 张，
         但单张会到 600KB+，为"卡片小图"付这个价不划算。
     ⚠ 缩略图还兼作编辑器"封面选择器"预览（该处实际用 data 全图，非 thumb）。

     体积上限（不是拍的，是库层 CHECK 倒推的）：
       库层 post_images.data ≤ 3,600,000、thumb ≤ 400,000（v1.6.0 落）。
       《改进设计表》记过一次翻车：原定 data ≤ 2,000,000，结果现网一张
       1280×720 PNG 的 base64 就有 2,058,404 —— 阈值卡在合法数据之下，
       约束一加就被数据本身拒绝（23514）。
       尺寸提到 2160 后 PNG 体积约翻 3~4 倍，必然撞线 → 故 compressImage 必须带
       「体积兜底阶梯」，见下方 DATA_MAX_BYTES / THUMB_MAX_BYTES。 */
  var IMAGE_MAX_DIM = 2160;
  var THUMB_MAX_DIM = 1280;
  var IMAGE_QUALITY = 0.85;
  var THUMB_QUALITY = 0.75;
  /* 各留一点余量（5%~6%），别贴着 CHECK 线走 */
  var DATA_MAX_BYTES = 3400000;
  var THUMB_MAX_BYTES = 380000;

  /* ---------- 浏览器端图片压缩（写入 post_images 的展示版本） ----------
     maxBytes：base64 字符数上限。超出时按阶梯降级，直到塞得进库层 CHECK。
     ⚠ 这层不是锦上添花 —— 没有它，尺寸提到 2048 的 PNG 会直接撞
       data ≤ 3,600,000 的 CHECK，上传报 23514 失败。宁可画质降一点，
       也不能让用户传不上来。 */
  function drawAndEncode(img, cw, ch, type, quality, keepAlpha, scale) {
    var sw = Math.max(1, Math.round(cw * scale));
    var sh = Math.max(1, Math.round(ch * scale));
    var canvas = document.createElement('canvas');
    canvas.width = sw; canvas.height = sh;
    var ctx = canvas.getContext('2d');
    if (!keepAlpha) { ctx.fillStyle = '#0b1120'; ctx.fillRect(0, 0, sw, sh); }
    ctx.drawImage(img, 0, 0, sw, sh);
    var dataUrl = canvas.toDataURL(type, quality);
    return {
      dataUrl: dataUrl,
      base64: dataUrl.split(',')[1] || '',
      content_type: type,
      width: sw,
      height: sh,
      size_bytes: Math.round((dataUrl.split(',')[1] || '').length * 3 / 4)
    };
  }

  /* 降级阶梯：
     ① 降质量 —— 只对 JPEG/WebP 有效（PNG 是lossless，quality 参数它根本不理）
     ② 降尺寸 —— 有损无损通吃，是 PNG 的主力手段
     ③ 转 JPEG —— 压缩率常提升 3~6 倍，代价是丢 alpha；放最后，能不丢就不丢
     每档都真编码一次再量长度 —— 体积这东西估不准，只能量。 */
  function encodeWithinBytes(img, cw, ch, outType, quality, keepAlpha, maxBytes) {
    var lossy = (outType === 'image/jpeg' || outType === 'image/webp');
    var plan = [];
    if (lossy) {
      [quality, 0.72, 0.6, 0.5].forEach(function (q) {
        plan.push({ type: outType, q: q, s: 1, alpha: keepAlpha });
      });
    }
    [1, 0.8, 0.64, 0.5].forEach(function (s) {
      plan.push({ type: outType, q: quality, s: s, alpha: keepAlpha });
    });
    [1, 0.75].forEach(function (s) {
      plan.push({ type: 'image/jpeg', q: 0.7, s: s, alpha: false });
    });

    var last = null;
    for (var i = 0; i < plan.length; i++) {
      var a = plan[i];
      var r;
      try { r = drawAndEncode(img, cw, ch, a.type, a.q, a.alpha, a.s); }
      catch (e) { continue; }
      last = r;
      if (!maxBytes || r.base64.length <= maxBytes) return r;
    }
    return last;
  }

  function compressImage(file, maxDim, quality, maxBytes) {
    maxDim = maxDim || IMAGE_MAX_DIM;
    quality = quality || IMAGE_QUALITY;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var keepAlpha = (file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif');
          var outType = keepAlpha ? (file.type === 'image/gif' ? 'image/png' : file.type) : 'image/jpeg';
          var out = encodeWithinBytes(img, cw, ch, outType, quality, keepAlpha, maxBytes);
          URL.revokeObjectURL(url);
          resolve(out);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(new Error('图片处理失败：' + errMsg(e)));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片文件无法读取'));
      };
      img.src = url;
    });
  }

  /* ============================================================
     v4.6.0：静态快照回退（同源 data/）

     背景 —— 为什么需要这一层
     ------------------------------------------------------------
     在**非本站域名**的环境（GitHub Pages 等）里，云取数会被两道闸同时拦：

       ① CSP   `connect-src 'self'`：跨源请求浏览器直接不发
       ② CORS  云端点按 Origin 白名单放行（只认自己的域名 + localhost，
                *.github.io 一律 403）

     于是页面会变成"界面在、文章全没有"的空壳。绕开这两道闸的唯一办法是
     让内容也变成**同源资源** —— tools/export-static.js 把已发布文章与被引用
     的图片导出到 data/，这里在云端不可达时自动改读它。

     实现纪律（为什么包在导出边界、而不是改 Posts/Images 内部）
     ------------------------------------------------------------
     · 云端可用时，行为与从前**逐字一致** —— 既有断言不受影响，
       不会为了一个副场景把主路径的成熟逻辑重新搅一遍。
     · 回退只在真抛错时发生，不改变任何成功路径的返回值形状
       （listPublished 仍返回 {posts,total}、fetchMany 仍返回 Map）。

     ⚠ 只管**读**路径。写路径（登录 / 发文 / 上传 / 电台）在静态环境下必然
       失败 —— 那是"没有后端"的固有限制，不是 bug。应用层已有错误提示，
       此处**不假装成功**（假成功比明确失败更糟：用户以为发出去了）。
     ============================================================ */
  var SNAPSHOT_URL = 'data/posts.json';
  var snapshot = null;        /* 已加载的快照 */
  var snapshotLoading = null; /* 加载中的 Promise（并发去重） */
  var snapshotMode = false;   /* 已确认云端不可达 → 本次会话不再重试 */

  function loadSnapshot() {
    if (snapshot) return Promise.resolve(snapshot);
    if (snapshotLoading) return snapshotLoading;
    snapshotLoading = fetch(SNAPSHOT_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('快照 HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j || !Array.isArray(j.posts)) throw new Error('快照格式不符');
        snapshot = j;
        return j;
      })
      .catch(function (e) {
        snapshotLoading = null;   /* 允许下次重试（首次可能是并发竞态） */
        throw new Error('静态快照不可用：' + (e && e.message || e));
      });
    return snapshotLoading;
  }

  function staticImageUrl(id) {
    if (!snapshot || !snapshot.images) return null;
    var meta = snapshot.images[String(id)];
    return meta && meta.file ? 'data/' + meta.file : null;
  }

  /* 本地快照的只读实现 —— 语义与云端版本对齐（排序/过滤/分页口径照抄） */
  var StaticPosts = {
    listPublished: async function (opts) {
      opts = opts || {};
      var page = opts.page || 1;
      var pageSize = opts.pageSize || 10;
      var tag = opts.tag || null;
      var snap = await loadSnapshot();
      /* 云端按 created_at 倒序取；这里同样倒序，避免快照顺序影响分页结果 */
      var all = snap.posts.slice().sort(function (a, b) {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
      if (tag) {
        all = all.filter(function (p) { return (p.tags || []).indexOf(tag) !== -1; });
      }
      var from = (page - 1) * pageSize;
      return { posts: all.slice(from, from + pageSize), total: all.length };
    },
    get: async function (id) {
      var snap = await loadSnapshot();
      var hit = null;
      snap.posts.forEach(function (p) { if (String(p.id) === String(id)) hit = p; });
      return hit;
    },
    tagStats: async function () {
      var snap = await loadSnapshot();
      var map = {};
      snap.posts.forEach(function (p) {
        (p.tags || []).forEach(function (t) { map[t] = (map[t] || 0) + 1; });
      });
      return map;
    }
  };

  var StaticImages = {
    fetchMany: async function (ids) {
      await loadSnapshot();
      var result = new Map();
      (ids || []).forEach(function (id) {
        var url = staticImageUrl(id);
        if (url) result.set(id, url);
      });
      return result;
    },
    /* 同步 —— 与 Images.dims 同形状；快照未加载时返回 null（调用方须容忍缺失） */
    dims: function (id) {
      if (!snapshot || !snapshot.images) return null;
      var meta = snapshot.images[String(id)];
      return (meta && meta.w && meta.h) ? { width: meta.w, height: meta.h } : null;
    },
    ready: function () { return !!snapshot; }
  };

  /* v4.7.0：电台回退。
     云端把音频存成十几 MB 的 base64 data URL（trackData 返回的就是它）；
     快照里则是**同源文件** `data/radio/<id>.<mp3>`。
     playUrl 的语义是"给我一个能播的地址"，所以返回文件路径即可 ——
     播放器不关心它是 data URL 还是路径，只把它交给 <audio>。
     ⚠ 不再需要把 27MB base64 塞进 JSON：那会让快照本体大到浏览器解析都费劲。 */
  var StaticRadio = {
    list: async function () {
      var snap = await loadSnapshot();
      return (snap.radio || []).slice();
    },
    playUrl: async function (row) {
      var id = (row && typeof row === 'object') ? row.id : row;
      var snap = await loadSnapshot();
      var hit = null;
      (snap.radio || []).forEach(function (r) { if (String(r.id) === String(id)) hit = r; });
      if (!hit) throw new Error('该曲目不在快照中');
      if (!hit.file) throw new Error('该曲目在快照中没有音频数据');
      return 'data/' + hit.file;
    }
  };

  /* 把实现在导出边界包一层：先走真身，抛错才落快照。
     snapshotMode 一旦**确认可用**才置位，之后本次会话直连快照 ——
     否则 GitHub Pages 上每次取数都要先挨一次 CSP 拒绝，
     控制台刷满违规告警、每个视图白等一个必然失败的往返。

     ⚠ 快照也拿不到时，抛**原始错误**而不是快照的错误。
       理由：原始错误才是根因（如"云服务 SDK 未就绪"），
       而快照失败只是"兜底也没接住"这一后果 ——
       把根因盖成后果会让排查方向从"配置错了"偏移到"快照坏了"。
       这条是被 noSDK / noAllCDN 两条既有断言逼出来的：
       首版没做这个区分，两个降级场景的提示文案被静默改掉。 */
  function withFallback(real, backup, keys) {
    var out = {};
    Object.keys(real).forEach(function (k) { out[k] = real[k]; });
    keys.forEach(function (k) {
      out[k] = async function () {
        if (snapshotMode) return await backup[k].apply(backup, arguments);
        try {
          return await real[k].apply(real, arguments);
        } catch (e) {
          try {
            var r = await backup[k].apply(backup, arguments);
            snapshotMode = true;   /* 兜底真的接住了，才认账 */
            return r;
          } catch (e2) {
            throw e;
          }
        }
      };
    });
    return out;
  }

  /* dims 是**同步**接口，不能套 async 包装 —— 手工合成：
     缓存里有真值就用真值，否则退回快照元数据 */
  var realDims = Images.dims;
  function dimsWithFallback(id) {
    var d = realDims.call(Images, id);
    return d || StaticImages.dims(id);
  }

  /* ---------- 导出 ---------- */
  window.NEON = {
    init: init,
    isReady: function () { return sdkReady; },
    /* 受控的数据表访问入口（封面选择器等场景使用） */
    dbFrom: function (table) { return ensure().database.from(table); },
    Auth: Auth,
    Posts: withFallback(Posts, StaticPosts, ['listPublished', 'get', 'tagStats']),
    /* v4.9.0：收藏（账号功能，**不套 withFallback** —— 云端数据没有静态兜底，
       读路径自己容错返回空表，写路径按"不能就不能"抛错） */
    Bookmarks: Bookmarks,
    BOOKMARK_MAX: BOOKMARK_MAX,
    Images: (function () {
      var imgs = withFallback(Images, StaticImages, ['fetchMany']);
      imgs.dims = dimsWithFallback;
      return imgs;
    })(),
    /* v4.6.0：是否已落到静态快照模式 —— 应用层据此提示"只读快照" */
    isSnapshot: function () { return snapshotMode; },
    SNAPSHOT_URL: SNAPSHOT_URL,    Errors: Errors,
    Storage: Storage,
    /* v2.9.0：电台数据层（曲目列表 / 音频入库 / 匿名可读播放地址） */
    /* v4.7.0：电台也走同源回退（与 Posts/Images 同一套纪律：只包读路径） */
    Radio: withFallback(Radio, StaticRadio, ['list', 'playUrl']),
    AUDIO_MAX: AUDIO_MAX,
    /* 库层 CHECK 对应的字符上限（客户端第二道体积关，与库同步） */
    AUDIO_DATA_MAX: AUDIO_DATA_MAX,
    RADIO_READ_TABLE: RADIO_READ_TABLE,
    RADIO_WRITE_TABLE: RADIO_WRITE_TABLE,
    /* 读/写两套字段清单（测试用来守住「视图专有列不得进写路径」）
       RADIO_FIELDS 含视图算出来的 has_data；RADIO_WRITE_FIELDS 是基表可返回的列。 */
    RADIO_FIELDS: RADIO_FIELDS,
    RADIO_WRITE_FIELDS: RADIO_WRITE_FIELDS,
    RADIO_VIEW_ONLY: RADIO_VIEW_ONLY,
    /* ⚠ 签名 URL 有效期的平台硬边界（1~3600），对外暴露给测试钉住。
       电台已不再走签名（改读库），这套留给附件下载等场景。 */
    SIGNED_TTL_MAX: SIGNED_TTL_MAX,
    SIGNED_TTL_MIN: SIGNED_TTL_MIN,
    clampTtl: clampTtl,
    compressImage: compressImage,
    /* v2.2.1：图片尺寸标准对外暴露，供上传流程与测试共用一个来源
       （测试钉这几个常量，避免"改了实现、测试还按旧数字放行"的假绿） */
    IMAGE_MAX_DIM: IMAGE_MAX_DIM,
    THUMB_MAX_DIM: THUMB_MAX_DIM,
    IMAGE_QUALITY: IMAGE_QUALITY,
    THUMB_QUALITY: THUMB_QUALITY,
    DATA_MAX_BYTES: DATA_MAX_BYTES,
    THUMB_MAX_BYTES: THUMB_MAX_BYTES,
    errMsg: errMsg
  };
})();
