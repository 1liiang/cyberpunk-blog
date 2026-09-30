'use strict';
/* ============================================================
   tests/common.js — 测试基座
   加载真实源码（index.html + 4 个 js），用 jsdom 跑真实启动流程。
   数据库桩按表分派（posts / post_images），并记录全部查询供断言。
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) {
  JSDOM = require('C:/Users/liu/.workbuddy/binaries/node/workspace/node_modules/jsdom').JSDOM;
}

const SRC = {
  html: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  ver: fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'),
  cloud: fs.readFileSync(path.join(ROOT, 'js/cloud.js'), 'utf8'),
  views: fs.readFileSync(path.join(ROOT, 'js/views.js'), 'utf8'),
  /* C10：键盘可达层（快捷键 + 模态焦点陷阱）。独立文件、边界清晰，
     测试可直接 eval 后派发 KeyboardEvent 验证真实行为。 */
  keys: fs.readFileSync(path.join(ROOT, 'js/keys.js'), 'utf8'),
  app: fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'),
  /* v2.8.0：电台播放器内核（纯逻辑、零 DOM，可单独 eval 后沙箱实测） */
  radio: fs.readFileSync(path.join(ROOT, 'js/radio.js'), 'utf8'),
  /* v4.0 B1：场景框架（路由 → 场景 → 氛围层集）与氛围运行时（数字雨 + 帧率保底）。
     与线上 index.html 的加载顺序一致（都在 app.js 之前）。 */
  scene: fs.readFileSync(path.join(ROOT, 'js/scene.js'), 'utf8'),
  atmo: fs.readFileSync(path.join(ROOT, 'js/atmo.js'), 'utf8'),
  /* v4.1 B2：霓虹字标路径数据（须在 views 之前）与开场序列 */
  wordmark: fs.readFileSync(path.join(ROOT, 'js/wordmark-paths.js'), 'utf8'),
  boot: fs.readFileSync(path.join(ROOT, 'js/boot.js'), 'utf8'),
  /* v4.3 B4：装置 —— 点击反馈与命令终端（终端惰性建 DOM：eval 时无副作用） */
  tap: fs.readFileSync(path.join(ROOT, 'js/tap.js'), 'utf8'),
  console: fs.readFileSync(path.join(ROOT, 'js/console.js'), 'utf8'),
  /* O11：首绘前定主题的引导脚本（同步、零依赖，须单独 eval 才能测到它的行为） */
  themeBoot: fs.readFileSync(path.join(ROOT, 'js/theme-boot.js'), 'utf8'),
  css: fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8'),
  /* 构建/发版工具（O10 改号校验要读它的实现，确保防护没被削弱） */
  bump: fs.readFileSync(path.join(ROOT, 'tools/bump.js'), 'utf8'),
  pkg: fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
  vendorPath: path.join(ROOT, 'js/vendor/workbuddy-cloud-sdk.js'),
  vendorReadme: path.join(ROOT, 'js/vendor/README.md')
};

/* ---------- 固定数据 ----------
   前两篇（id 1/2）用于旧的封面 / 缩略图回退场景，字段保持原样不动。
   其后几篇是第三批（C1 搜索 / C3 归档 / C2 目录）新增：
     - 覆盖 2026-07 / 08 / 09 三个不同月份，便于断言按月分组与排序
     - tag / summary / title 各有可被搜索命中的关键词（如 "NEON"、"检索"）
     - content 含 h2/h3 与围栏代码块，便于断言 TOC 抽取与复制按钮注入
   注意：posts 数组顺序 = 桩返回顺序；listPublished 的 order() 在桩里是空操作，
   所以排序断言要依赖 app 层自己的分组排序，而不是桩的顺序。 */
const FIXTURES = {
  posts: [
    {
      id: 1, title: '拇指测试', summary: '带缩略图封面的文章', tags: ['test'],
      cover_ref: 'cloudimg://1', status: 'published', owner_name: '漓江', owner_id: 'u1',
      created_at: '2026-09-27T10:00:00+08:00', updated_at: '2026-09-27T10:00:00+08:00',
      content: '封面走缩略图，正文图：![](cloudimg://2) 完'
    },
    {
      id: 2, title: '回退测试', summary: '无缩略图的旧图封面', tags: ['legacy'],
      cover_ref: 'cloudimg://2', status: 'published', owner_name: '漓江', owner_id: 'u1',
      created_at: '2026-09-27T09:00:00+08:00', updated_at: '2026-09-27T09:00:00+08:00',
      content: '旧图正文：![](cloudimg://1)'
    },
    {
      id: 3, title: 'NEON 长文导读', summary: '一篇用于测试目录抽取的长文章',
      tags: ['code', 'guide'], cover_ref: null, status: 'published', owner_name: '漓江', owner_id: 'u1',
      created_at: '2026-09-20T12:00:00+08:00', updated_at: '2026-09-20T12:00:00+08:00',
      content: '## 第一节 开场\n正文甲\n\n### 小节 1.1 细节\n正文乙\n\n## 第二节 收尾\n正文丙\n\n```js\nconst a = 1;\nconsole.log(a);\n```'
    },
    {
      id: 4, title: '八月随笔', summary: '记录八月的零散思绪',
      tags: ['essay'], cover_ref: null, status: 'published', owner_name: '漓江', owner_id: 'u1',
      created_at: '2026-08-15T08:30:00+08:00', updated_at: '2026-08-15T08:30:00+08:00',
      content: '## 八月小记\n这里是八月的正文'
    },
    {
      id: 5, title: '七月检索笔记', summary: '关于全文检索的一些思考',
      tags: ['code', 'search'], cover_ref: null, status: 'published', owner_name: '漓江', owner_id: 'u1',
      created_at: '2026-07-03T21:00:00+08:00', updated_at: '2026-07-03T21:00:00+08:00',
      content: '## 检索的边界\n这里是七月的正文'
    },
    {
      id: 6, title: '未公开草稿', summary: '这篇不该出现在公开列表里',
      tags: ['draft'], cover_ref: null, status: 'draft', owner_name: '漓江', owner_id: 'u1',
      created_at: '2026-09-28T23:00:00+08:00', updated_at: '2026-09-28T23:00:00+08:00',
      content: '## 草稿内容\n未发布'
    }
  ],
  images: {
    1: { id: 1, content_type: 'image/png', thumb: 'THUMBB64PNG', data: 'FULLB64PNG1', owner_id: 'u1', width: 1280, height: 720 },
    2: { id: 2, content_type: 'image/jpeg', thumb: null, data: 'FULLB64JPEG2', owner_id: 'u1', width: 800, height: 600 }
  }
};

/* ---------- 行投影（模拟 PostgREST 的 select 字段裁剪） ---------- */
function project(row, fields) {
  if (!fields || fields === '*') return Object.assign({}, row);
  const out = {};
  String(fields).split(',').forEach(function (f) {
    f = f.trim();
    if (f in row) out[f] = row[f];
  });
  return out;
}

/* ---------- 云 SDK 桩：按表分派 + 记录查询 ---------- */
function makeCloudStub(fixtures, queries) {
  const posts = fixtures.posts, images = fixtures.images;

  function resolve(state) {
    queries.push({
      table: state.table, kind: state.kind, fields: state.fields, opts: state.opts,
      conds: state.conds.slice(), range: state.range, payload: state.payload || null
    });
    if (state.kind === 'insert') return Promise.resolve({ data: { id: 9001 }, error: null });

    if (state.table === 'posts') {
      let rows = posts.slice();
      state.conds.forEach(function (c) {
        if (c.type === 'eq' && c.col === 'status') rows = rows.filter(function (p) { return p.status === c.val; });
        if (c.type === 'eq' && c.col === 'id') rows = rows.filter(function (p) { return String(p.id) === String(c.val); });
        if (c.type === 'eq' && c.col === 'owner_id') rows = rows.filter(function (p) { return p.owner_id === c.val; });
        if (c.type === 'contains') rows = rows.filter(function (p) { return (p.tags || []).some(function (t) { return c.val.indexOf(t) !== -1; }); });
      });
      if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
      /* B2 故障注入：模拟"计数请求在网络层 reject"。
         这是 Promise.all 会连带丢弃行数据的真实场景，
         也是 allSettled 语义的验证点 —— 故必须能主动造出来。
         注意是 reject（非返回 {error}），因为 SDK 在连接层失败时是 reject，
         只有业务层错误才走 {error} 返回形态，两者要分别覆盖。 */
      if (fixtures && fixtures.__rejectCount && state.opts && state.opts.head) {
        return Promise.reject(new Error('Failed to fetch (count)'));
      }
      if (state.opts && state.opts.head) return Promise.resolve({ data: null, count: rows.length, error: null });
      const fields = state.fields || '*';
      if (state.maybeSingle) {
        return Promise.resolve({ data: rows[0] ? project(rows[0], fields) : null, error: null });
      }
      return Promise.resolve({ data: rows.map(function (r) { return project(r, fields); }), error: null });
    }

    /* A3：读走视图 public_images，写走基表 post_images。
       视图不暴露 owner_id / storage_path —— 桩按视图真实列裁剪，
       若前端误 select 视图不存在的列，project() 会直接漏掉该字段，可测出来。 */
    if (state.table === 'public_images' || state.table === 'post_images') {
      const VIEW_COLS = ['id', 'content_type', 'data', 'thumb', 'width', 'height', 'size_bytes', 'created_at'];
      let ids = null, ownerId = null;
      state.conds.forEach(function (c) {
        if (c.type === 'in' && c.col === 'id') ids = c.arr;
        if (c.type === 'eq' && c.col === 'owner_id') ownerId = c.val;
      });
      let rows = Object.keys(images).map(function (k) { return images[k]; });
      if (state.table === 'public_images') {
        rows = rows.map(function (r) {
          const out = {};
          VIEW_COLS.forEach(function (c) { if (c in r) out[c] = r[c]; });
          return out;
        });
      }
      if (ids) rows = rows.filter(function (r) { return ids.indexOf(r.id) !== -1; });
      if (ownerId) rows = rows.filter(function (r) { return r.owner_id === ownerId; });
      const fields = state.fields || '*';
      return Promise.resolve({ data: rows.map(function (r) { return project(r, fields); }), error: null });
    }

    return Promise.resolve({ data: [], error: null });
  }

  function makeQ(table) {
    const state = { table: table, kind: 'select', fields: null, opts: null, conds: [], range: null, maybeSingle: false, payload: null };
    const api = {
      select: function (f, opts) { state.fields = f; state.opts = opts; return api; },
      eq: function (col, val) { state.conds.push({ type: 'eq', col: col, val: val }); return api; },
      contains: function (col, val) { state.conds.push({ type: 'contains', col: col, val: val }); return api; },
      in: function (col, arr) { state.conds.push({ type: 'in', col: col, arr: arr.slice() }); return api; },
      order: function () { return api; },
      range: function (f, t) { state.range = [f, t]; return api; },
      limit: function () { return api; },
      insert: function (p) { state.kind = 'insert'; state.payload = p; return api; },
      update: function (p) { state.kind = 'update'; state.payload = p; return api; },
      delete: function () { state.kind = 'delete'; return api; },
      maybeSingle: function () { state.maybeSingle = true; return resolve(state); },
      single: function () { state.maybeSingle = true; return resolve(state); },
      then: function (onF, onR) { return resolve(state).then(onF, onR); }
    };
    return api;
  }

  return {
    auth: {
      getSession: async function () { return { data: null, error: null }; },
      getUser: async function () { return { data: null, error: null }; },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    },
    database: { from: makeQ },
    storage: {}
  };
}

/* ---------- 剥注释（用正则扫源码做断言前必须调用） ----------
   血泪教训（v1.7.0 CSP、v2.0.2 O9、v2.0.2 O11 各踩一次）：
   本项目习惯把"为什么这么写"记在注释里，而注释里往往会**引用被禁用的写法**，
   例如「不要内联 <script>」「已移除 @media (prefers-color-scheme: light)」。
   不剥注释直接扫，这些说明性文字会让"应该没有 X"的断言全部误判为红。
   ⚠ 反向的坑也要注意：剥注释后注释里"承诺"的行为就无法验证了，
     所以剥完还要确认被剥掉的量级合理，别把自己的被测代码也剥没了。 */
function stripComments(src) {
  return String(src || '')
    .replace(/<!--[\s\S]*?-->/g, '')      /* HTML 注释 */
    .replace(/\/\*[\s\S]*?\*\//g, '');    /* CSS/JS 块注释 */
}
/* JS 的行注释要单独一个函数：在 CSS 里 `//` 可能是 URL 或选择器，不能一刀切。 */
function stripJsLineComments(src) {
  return String(src || '').replace(/^\s*\/\/.*$/gm, '');
}

/* ---------- 版本号读取 ---------- */
function parseBuild(verSrc) {
  const m = /BUILD:\s*'([^']+)'/.exec(String(verSrc || ''));
  return m ? m[1] : null;
}

/* ---------- CSS 块体提取（D3：多场景共用，必须唯一来源） ----------
   ⚠ 这三个函数此前在 O12 / O13 / O17 **各写了一份**（且实现略有差异：
   O17 的 ruleBody 用 indexOf('}') 不做花括号配平）。
   拆分到不同文件后若继续各写各的，就会出现"改了 A 文件的判据、
   B 文件仍按旧判据放行"的假绿。故上提到此，**所有场景共用这一份**。

   · cssBlockAt  —— 从给定下标起做花括号配平，返回含花括号的 `{...}`
   · cssRuleBody —— 按选择器取规则体（**不含**花括号）；找不到返回 null
   · hasCssRule  —— 行首锚定判断某选择器是否作为独立规则存在

   ⚠ 取"下一个 { "必须用 indexOf('{', idx) 而不是"从 idx 往后第一个字符"：
   @media (…) 与选择器之间还有条件文本，直接取下标会取错位置。 */
function cssBlockAt(text, idx) {
  const t = String(text || '');
  if (idx < 0 || idx >= t.length) return '';
  const start = t.indexOf('{', idx);
  if (start === -1) return '';
  let depth = 0, end = -1;
  for (let k = start; k < t.length; k++) {
    if (t[k] === '{') depth++;
    else if (t[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  return end === -1 ? '' : t.slice(start, end + 1);
}

/* 行首锚定：`.post-card::before` 不能被 `xxx .post-card::before` 这类后代选择器
   骗过，也不能被注释里的同名文字救活（调用前先 stripComments）。 */
function cssRuleBodyCssEsc(sel) {
  return String(sel).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function hasCssRule(text, sel) {
  const esc = cssRuleBodyCssEsc(sel);
  return new RegExp('(^|\\})\\s*' + esc + '\\s*[,{]', 'm').test(String(text || ''));
}
function cssRuleBody(text, sel) {
  const t = String(text || '');
  const esc = cssRuleBodyCssEsc(sel);
  const m = new RegExp('(^|\\})\\s*(?:[^{}]*,\\s*)?' + esc + '\\s*(?:,[^{}]*)?\\{', 'm').exec(t);
  if (!m) return null;
  const open = t.indexOf('{', m.index);
  const close = t.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return t.slice(open + 1, close);
}

/* ---------- 轮询等待（异步启动流程的断言时机） ---------- */
function waitFor(cond, ms) {
  ms = ms || 3000;
  return new Promise(function (resolve) {
    const t0 = Date.now();
    (function tick() {
      let ok = false;
      try { ok = !!cond(); } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(tick, 25);
    })();
  });
}

/* ---------- 启动一个真实页面 ---------- */
function bootDom(opts) {
  opts = opts || {};
  const html = SRC.html.replace(/<script[^>]+src="https:\/\/[^"]+"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: opts.url || 'https://x.test/#/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, doc = w.document;

  const logs = [];
  if (opts.captureConsole) {
    w.console = {
      log: function () { logs.push(Array.prototype.map.call(arguments, String).join(' ')); },
      warn: function () { logs.push('WARN:' + Array.prototype.map.call(arguments, String).join(' ')); },
      error: function () { logs.push('ERR:' + Array.prototype.map.call(arguments, String).join(' ')); }
    };
  } else {
    w.console = { log: function () {}, warn: function () {}, error: function () {} };
  }
  w.scrollTo = function () {};
  try {
    if (!w.crypto) w.crypto = {};
    if (!w.crypto.randomUUID) w.crypto.randomUUID = function () { return 't-' + Math.random(); };
  } catch (e) { /* 新版 jsdom 的 crypto 为只读 getter，自带 randomUUID，跳过 */ }

  if (!opts.noMarked) {
    /* marked 桩：保持轻量，但足以驱动第三批的断言：
       - 图片引用（旧场景 R21/R31 等依赖）
       - ## / ### 标题 → <h2>/<h3>（C2 TOC 抽取）
       - ```lang 围栏代码块 → <pre><code>（C2 复制按钮注入）
       逐行扫描，未命中特殊语法的行仍沿用「整段包 <p>」的旧行为。 */
    w.marked = {
      parse: function (s) {
        const src = String(s || '');
        const imgRe = /!\[[^\]]*\]\(cloudimg:\/\/(\d+)\)/;
        const imgM = imgRe.exec(src);
        if (imgM && src.trim().indexOf('#') !== 0 && src.indexOf('```') === -1) {
          return '<p><img src="cloudimg://' + imgM[1] + '" alt="pic"></p>';
        }

        const lines = src.split('\n');
        let out = '', i = 0;
        while (i < lines.length) {
          const line = lines[i];
          if (/^```/.test(line)) {                       /* 围栏代码块 */
            const lang = line.replace(/^```/, '').trim();
            const buf = [];
            i++;
            while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
            i++;                                          /* 跳过结束围栏 */
            out += '<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' +
              buf.join('\n') + '</code></pre>';
            continue;
          }
          if (/^###\s+/.test(line)) { out += '<h3>' + line.replace(/^###\s+/, '') + '</h3>'; i++; continue; }
          if (/^##\s+/.test(line))  { out += '<h2>' + line.replace(/^##\s+/, '')  + '</h2>'; i++; continue; }
          if (/^#\s+/.test(line))   { out += '<h1>' + line.replace(/^#\s+/, '')   + '</h1>'; i++; continue; }
          if (line.trim() === '') { i++; continue; }
          out += '<p>' + line + '</p>';
          i++;
        }
        return out || '<p></p>';
      }
    };
  }
  if (!opts.noPurify) w.DOMPurify = { sanitize: function (x) { return String(x || ''); } };
  if (!opts.noHljs) w.hljs = { highlightElement: function () {} };

  /* 监听器计数：只为测「跨页是否累积 scroll 监听」这类生命周期问题。
     只统计 scroll 类型，其余类型原样透传，不影响既有断言。
     jsdom 默认无 IntersectionObserver —— 正好会走到降级分支，即泄漏风险最高的那条路。 */
  w.__scrollListeners = 0;
  const origAdd = w.addEventListener.bind(w);
  const origRemove = w.removeEventListener.bind(w);
  w.addEventListener = function (type, fn, opts) {
    if (type === 'scroll') w.__scrollListeners++;
    return origAdd(type, fn, opts);
  };
  w.removeEventListener = function (type, fn, opts) {
    if (type === 'scroll') w.__scrollListeners--;
    return origRemove(type, fn, opts);
  };

  const queries = [];
  const unhandled = [];
  w.addEventListener('unhandledrejection', function (e) { unhandled.push(String(e.reason)); });

  /* 数据层 SDK 桩：形状必须是 **Supabase 客户端**的形状 ——
     cloud.js 的 init() 调 supabase.createClient(...)，随后取 sb.from / sb.auth / sb.storage。
     makeCloudStub 产出的仍是原来那份查询桩（数据库链 / 查询记录 / 固定数据），
     这里只把它的三条口子摊平到顶层，免得整个桩重写一遍。
     ⚠ 登录相关方法（signInWithOtp 等）桩里没有：现有门禁不点击登录表单，
       真正要验登录链路得在真项目上做（见 docs/SUPABASE-SETUP.md 的验收清单）。 */
  if (!opts.noSDK) {
    w.supabase = {
      createClient: function () {
        var s = makeCloudStub(opts.fixtures || FIXTURES, queries);
        return { from: s.database.from, auth: s.auth, storage: s.storage };
      }
    };
  }

  /* O11：模拟「首绘前」这一步。
     真实浏览器里 js/theme-boot.js 是 <head> 中的同步脚本，在 CSS 生效与首绘
     之前执行；而 bootDom 要到下面才 eval 脚本，时机偏晚。
     为了让断言能覆盖「未启动任何 defer 脚本时 <html> 上是什么属性」，
     这里先把 theme-boot.js 真跑一遍（用 eval 走真实代码，不是重写一份逻辑），
     再决定是否继续 eval 其余脚本。 */
  if (opts.themeBoot) {
    const saved = [];
    /* opts.breakStorage：模拟「存储被禁用」——
       隐私模式 / 第三方 cookie 拦截 / Safari 的 SecurityError 都会让
       localStorage 的**访问本身**抛错（不只是返回 null）。
       这条路径必须被真测：引导脚本若没兜住，会在首绘前抛异常，
       轻则主题漂移，重则整站白屏 —— 而它是最靠前执行的脚本，破坏力最大。 */
    if (opts.breakStorage) {
      try {
        Object.defineProperty(w, 'localStorage', {
          configurable: true,
          get: function () { throw new Error('SecurityError: 存储被禁用'); }
        });
      } catch (e) { /* 不支持拦截时跳过，断言侧会据此说明 */ }
    } else if (opts.storage) {
      /* jsdom 的 localStorage 可用；如需预置偏好直接写进去 */
      Object.keys(opts.storage).forEach(function (k) {
        try { w.localStorage.setItem(k, opts.storage[k]); saved.push(k); } catch (e) {}
      });
    }
    w.eval(SRC.themeBoot);
  }
  /* opts.themeBootOnly：只跑到引导脚本为止，用来断言"首绘瞬间"的状态 */
  if (opts.themeBootOnly) {
    return { w: w, doc: doc, dom: dom, queries: queries, unhandled: unhandled, logs: logs, waitFor: waitFor };
  }

  if (!opts.skipVer) w.eval(SRC.ver);
  if (!opts.skipCloud) w.eval(SRC.cloud);
  /* v4.1：字标路径数据必须在 views 之前（views 渲染 Hero 时惰性读取） */
  if (!opts.skipWordmark) w.eval(SRC.wordmark);
  if (!opts.skipViews) w.eval(SRC.views);
  if (!opts.skipKeys) w.eval(SRC.keys);
  /* v4.0：场景 + 氛围运行时（在 app 之前 —— 与 index.html 的加载顺序一致）。
     jsdom 没有 2D canvas：atmo.js 会走"无 canvas 环境静默跳过"的降级分支，
     雨不渲染但页面正常 —— 线上不受影响（那里有完整 canvas）。 */
  if (!opts.skipScene) w.eval(SRC.scene);
  if (!opts.skipAtmo) w.eval(SRC.atmo);
  /* v4.1：开场序列（首访三态由 theme-boot 的 .boot-first 驱动；jsdom 里
     无标记时走"静默清理"路径，无副作用） */
  if (!opts.skipBoot) w.eval(SRC.boot);

  /* opts.breakRouteOnBoot：在 app.js 求值【之前】把某个视图函数换成会抛错的实现。
     用途：验证最后一道防白屏防线（safeRoute → fatalPanel）。
     为什么必须在 app.js 之前注入：app.js 是 IIFE，求值即执行 bootSafe()；
     若在它之后注入，第一次 route() 早已成功跑完，注入不生效。
     为什么改视图函数而不是 route 本身：route 在 IIFE 内不对外暴露，
     而 V() 每次调用都从 window.NEONViews 惰性取用 —— 换掉 homeView
     即可让 renderHome 在真实调用路径上抛错，走的是与线上完全一致的代码。 */
  if (opts.breakRouteOnBoot) {
    const viewsRef = w.NEONViews;
    if (viewsRef && typeof opts.breakRouteOnBoot === 'string') {
      /* opts.breakRouteMsg：自定义抛错的 message。
         传带 HTML 的字符串即可顺带验证 fatalPanel 里的 esc() 转义是否生效 ——
         错误面板也是渲染面，异常信息里若夹带标签同样能注入。 */
      const msg = opts.breakRouteMsg || '注入的渲染异常（测试用）';
      viewsRef[opts.breakRouteOnBoot] = function () {
        throw new Error(msg);
      };
    }
  }

  if (!opts.skipApp) w.eval(SRC.app);
  /* v4.3：装置（与 index.html 一致：app 之后）——console 的 DOM 惰性，
     eval 时只加载历史与定义接口，不触碰页面 */
  if (!opts.skipTap) w.eval(SRC.tap);
  if (!opts.skipConsole) w.eval(SRC.console);

  return { w: w, doc: doc, dom: dom, queries: queries, unhandled: unhandled, logs: logs, waitFor: waitFor };
}

module.exports = {
  ROOT: ROOT, SRC: SRC, FIXTURES: FIXTURES,
  bootDom: bootDom, waitFor: waitFor,
  stripComments: stripComments, stripJsLineComments: stripJsLineComments,
  /* D3 新增：跨场景共用的 CSS 判据与版本读取（唯一来源，禁止在 case 里另写一份） */
  parseBuild: parseBuild,
  cssBlockAt: cssBlockAt,
  cssRuleBody: cssRuleBody,
  hasCssRule: hasCssRule
};
