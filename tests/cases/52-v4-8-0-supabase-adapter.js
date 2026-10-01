'use strict';
/* ============================================================
   tests/cases/52-v4-8-0-supabase-adapter.js — v4.8 Supabase 适配
   ------------------------------------------------------------
   为什么单独立一个 case：
   v4.8 把数据层从 WorkBuddy SDK 换到 supabase-js，而**两家的 auth 形状
   并不完全一样**，差异全部集中在 js/cloud.js 的 makeAuthAdapter 里：

     · sendOtp    —— Supabase 没有这个 API（等价物是 signInWithOtp），
                     且出于防用户枚举**不告诉你账号是否存在**，
                     而 UI 要靠 isExistingUser 决定走"注册"还是"登录"页签
     · verifyOtp  —— Supabase 认 { email, token, type } 三件套；注册页还要顺手设密码
     · 找回密码    —— 站点流程是"邮件 6 位码 + 新密码"，Supabase 侧对应
                     type:'recovery' 换会话 + updateUser({password})

   这三处一旦映射错，症状是「注册不上 / 登不进去 / 重置密码卡死」，
   而既有 51 个 case 一条都覆盖不到 —— 共享桩（tests/common.js）是按
   查询链做的，auth 只有 getSession/getUser/onAuthStateChange 三个方法。
   故本 case 自带一个**可编排的 mock supabase**，逐个场景换应答，
   断言「适配器对 SDK 发了什么 + 吐回了什么」。

   ⚠ 与其它 case 不同，本文件不用 bootDom：需要按场景替换 auth 的行为，
      而 bootDom 的桩是固定的。它自己开最小 jsdom，跑的是真 cloud.js。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');
const { JSDOM } = require('jsdom');

const CASE = 'v4.8 Supabase 适配';
const SESSION = { user: { id: 'uid-1', email: 'me@x.test', user_metadata: { nickname: '漓江' } } };

/* mock supabase 客户端：形状必须与 supabase-js v2 一致 */
function boot(overrides) {
  const log = [];
  const calls = { createClient: null };
  const auth = {
    getSession: async function () { log.push('getSession'); return { data: { session: SESSION }, error: null }; },
    getUser: async function () { log.push('getUser'); return { data: { user: SESSION.user }, error: null }; },
    signInWithPassword: async function (o) { log.push(['signInWithPassword', o]); return { data: { session: SESSION, user: SESSION.user }, error: null }; },
    signInWithOtp: async function (o) { log.push(['signInWithOtp', o]); return { data: {}, error: null }; },
    verifyOtp: async function (o) { log.push(['verifyOtp', o]); return { data: { session: SESSION, user: SESSION.user }, error: null }; },
    updateUser: async function (o) { log.push(['updateUser', o]); return { data: { user: SESSION.user }, error: null }; },
    resetPasswordForEmail: async function (e) { log.push(['resetPasswordForEmail', e]); return { data: {}, error: null }; },
    signOut: async function () { log.push('signOut'); return { error: null }; },
    onAuthStateChange: function () { log.push('onAuthStateChange'); return { data: { subscription: { unsubscribe: function () {} } } }; }
  };
  Object.keys(overrides || {}).forEach(function (k) { auth[k] = overrides[k](log); });

  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only', url: 'https://x.test/' });
  const w = dom.window;
  w.supabase = {
    createClient: function (url, key, opts) {
      calls.createClient = { url: url, key: key, opts: opts };
      return {
        auth: auth,
        from: function (t) { return { __table: t }; },
        storage: { from: function (b) { return { __bucket: b }; } }
      };
    }
  };
  w.eval(SRC.cloud);
  return { w: w, Auth: w.NEON.Auth, log: log, calls: calls, NEON: w.NEON };
}

function callsOf(log, fn) {
  return log.filter(function (x) { return Array.isArray(x) && x[0] === fn; });
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;

  /* ================= 客户端构造：选项与形状对齐 ================= */
  {
    const c = boot();
    const ready = c.NEON.init();
    T(CASE, 'R257 init() 建客户端并返回，isReady() 为真', !!ready && c.NEON.isReady() === true);
    T(CASE, 'R258 createClient 用 PUBLIC_CONFIG 的 endpoint / publishableKey',
      !!c.calls.createClient && /supabase\.co/.test(c.calls.createClient.url) &&
      String(c.calls.createClient.key).length > 10,
      String(c.calls.createClient.url));
    const ao = (c.calls.createClient.opts || {}).auth || {};
    T(CASE, 'R259 auth 选项：持久会话开、自动续期开、URL 嗅探关（hash 路由必需）',
      ao.persistSession === true && ao.autoRefreshToken === true && ao.detectSessionInUrl === false,
      JSON.stringify(ao));
    T(CASE, 'R260 dbFrom(table) 走 sb.from（database 口子已对齐旧形状）',
      c.NEON.dbFrom('posts').__table === 'posts');
  }

  /* ================= 会话读取：必须剥掉 {data:{session}} 这层壳 ================= */
  {
    const c = boot();
    const s = await c.Auth.getSession();
    T(CASE, 'R261 getSession() 直接返回会话对象（app.js 到处读 session.user.id）',
      !!(s && s.user && s.user.id === 'uid-1'), s && s.user && s.user.id);
    const u = await c.Auth.getUser();
    T(CASE, 'R262 getUser() 直接返回 user 对象', !!(u && u.email === 'me@x.test'));
  }

  /* ================= 密码登录 ================= */
  {
    const c = boot();
    const r = await c.Auth.signInWithPassword('me@x.test', 'pw123456');
    T(CASE, 'R263 密码登录成功 → { session }（已剥壳）', !!(r.session && r.session.user.id === 'uid-1'));
    T(CASE, 'R264 传参形状 { email, password }',
      eq((callsOf(c.log, 'signInWithPassword')[0] || [])[1], { email: 'me@x.test', password: 'pw123456' }));
  }
  {
    const c = boot({ signInWithPassword: function () { return async function () { return { data: null, error: { message: 'Invalid login credentials' } }; }; } });
    const r = await c.Auth.signInWithPassword('me@x.test', 'bad');
    T(CASE, 'R265 密码登录失败 → { error } 原样上报', r.error === 'Invalid login credentials', r.error);
  }

  /* ================= 发码：老用户 / 新用户 / 真错误三分支 ================= */
  {
    const c = boot();
    const r = await c.Auth.sendOtp('old@x.test');
    const calls = callsOf(c.log, 'signInWithOtp');
    T(CASE, 'R266 老用户：只探一次就成功（shouldCreateUser:false）',
      calls.length === 1 && calls[0][1].options.shouldCreateUser === false, String(calls.length));
    T(CASE, 'R267 老用户：isExistingUser=true（上层走登录页签）', r.isExistingUser === true);
    T(CASE, 'R268 verificationId 回填 email（供上层做邮箱一致性校验）', r.verificationId === 'old@x.test');
  }
  {
    let n = 0;
    const c = boot({
      signInWithOtp: function (log) {
        return async function (o) {
          log.push(['signInWithOtp', o]);
          n++;
          if (n === 1) return { data: null, error: { code: 'otp_disabled', message: 'Signups not allowed for otp' } };
          return { data: {}, error: null };
        };
      }
    });
    const r = await c.Auth.sendOtp('new@x.test');
    const calls = callsOf(c.log, 'signInWithOtp');
    T(CASE, 'R269 新用户：探测被拒后补一次 shouldCreateUser:true（共两次）',
      calls.length === 2 && calls[1][1].options.shouldCreateUser === true, String(calls.length));
    T(CASE, 'R270 新用户：isExistingUser=false 且不报错（上层走注册页签）',
      r.isExistingUser === false && !r.error);
  }
  {
    const c = boot({
      signInWithOtp: function (log) {
        return async function (o) {
          log.push(['signInWithOtp', o]);
          return { data: null, error: { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' } };
        };
      }
    });
    const r = await c.Auth.sendOtp('x@x.test');
    T(CASE, 'R271 真错误（限流等）不误判为新用户：只探一次且如实报错',
      callsOf(c.log, 'signInWithOtp').length === 1 && !!r.error && r.isExistingUser === undefined, r.error);
  }

  /* ================= 验码：登录 / 注册（顺带设密码） ================= */
  {
    const c = boot();
    const r = await c.Auth.verifyOtp({ email: 'me@x.test', verificationId: 'me@x.test', isExistingUser: true, token: '123456' });
    const call = callsOf(c.log, 'verifyOtp')[0];
    T(CASE, 'R272 验码只发三件套 { email, token, type:"email" }（旧参数不外泄）',
      eq(call[1], { email: 'me@x.test', token: '123456', type: 'email' }), JSON.stringify(call[1]));
    T(CASE, 'R273 验码成功 → { session }', !!(r.session && r.session.user.id === 'uid-1'));
    T(CASE, 'R274 未传密码时不调 updateUser', callsOf(c.log, 'updateUser').length === 0);
  }
  {
    const c = boot();
    const r = await c.Auth.verifyOtp({ email: 'new@x.test', token: '654321', password: 'pw123456' });
    const up = callsOf(c.log, 'updateUser');
    T(CASE, 'R275 注册路径：验码后调一次 updateUser({ password })',
      up.length === 1 && eq(up[0][1], { password: 'pw123456' }), String(up.length));
    T(CASE, 'R276 注册路径：整体仍返回 { session }', !!(r.session && r.session.user.id === 'uid-1'));
  }
  {
    const c = boot({ updateUser: function () { return async function () { return { data: null, error: { message: 'Password should be at least 6 characters' } }; }; } });
    const r = await c.Auth.verifyOtp({ email: 'new@x.test', token: '654321', password: '123' });
    T(CASE, 'R277 设密码失败必须顶出错误（不能静默成功）', !!r.error && /at least 6/.test(r.error), r.error);
  }
  {
    const c = boot({ verifyOtp: function () { return async function () { return { data: null, error: { message: 'Token has expired or is invalid' } }; }; } });
    const r = await c.Auth.verifyOtp({ email: 'me@x.test', token: '000000' });
    T(CASE, 'R278 验码失败 → { error }', !!r.error && /expired/.test(r.error), r.error);
  }

  /* ================= 找回密码：码换会话 → 改密 ================= */
  {
    const c = boot();
    const r = await c.Auth.resetPasswordForEmail('me@x.test');
    T(CASE, 'R279 返回 { updateUser: fn }（app.js 期望的那个能力）', typeof r.updateUser === 'function');
    const done = await r.updateUser({ nonce: '111222', password: 'newpw123' });
    const v = callsOf(c.log, 'verifyOtp')[0];
    const u = callsOf(c.log, 'updateUser')[0];
    T(CASE, 'R280 updateUser 内部按 type:"recovery" 换会话', !!v && v[1].type === 'recovery' && v[1].token === '111222',
      JSON.stringify(v && v[1]));
    T(CASE, 'R281 随后改密码，成功时无 error', !!u && u[1].password === 'newpw123' && !done.error);
  }
  {
    const c = boot({ verifyOtp: function () { return async function () { return { data: null, error: { message: 'Token has expired or is invalid' } }; }; } });
    const r = await c.Auth.resetPasswordForEmail('me@x.test');
    const out = await r.updateUser({ nonce: 'bad', password: 'newpw123' });
    T(CASE, 'R282 码无效时报警且不继续改密',
      !!out.error && callsOf(c.log, 'updateUser').length === 0, out.error);
  }

  /* ================= 退出与登录态订阅 ================= */
  {
    const c = boot();
    const r = await c.Auth.signOut();
    T(CASE, 'R283 signOut 成功返回空对象', !r.error && c.log.indexOf('signOut') !== -1);
    const sub = c.Auth.onAuthStateChange(function () {});
    T(CASE, 'R284 onAuthStateChange 透传订阅对象（回调签名 event+session 与 app.js 一致）',
      !!(sub && sub.data && sub.data.subscription));
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
           fail: results.filter(function (r) { return !r.pass; }).length,
           results: results };
}

module.exports = { run: run, name: CASE };

standalone(module, run);
