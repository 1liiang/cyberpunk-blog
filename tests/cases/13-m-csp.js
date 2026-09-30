'use strict';
/* ============================================================
   tests/cases/13-m-csp.js — M CSP
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L409-447
   独立运行：node tests/cases/13-m-csp.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 M：A2 CSP ================= */
  {
    const cspM = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(SRC.html);
    const csp = cspM ? cspM[1] : '';
    T('M CSP', 'R35 CSP meta 已声明', !!csp, csp ? csp.slice(0, 40) + '…' : '缺失');

    const need_ = [
      ["default-src 'self'", /default-src 'self'/],
      /* v4.8.1：三个第三方库改本地托管后，script-src 不再需要放开 CDN 域 ——
         这条判据随之从「含 jsdelivr」变为「只有 'self'」（外部脚本域一个都不许有）。 */
      ['script-src 仅 self（零外部脚本域）', /script-src\s+'self'\s*(;|$)/],
      ['script-src 无 unsafe-inline', /script-src(?![^;]*unsafe-inline)/],
      ['img-src 含 data:', /img-src[^;]*data:/],
      ['img-src 含 blob:', /img-src[^;]*blob:/],
      /* ⚠⚠ media-src 是 v2.9.0 的电台音频能播的前提，漏了会**静默失败**：
         没有 media-src 指令时回落到 default-src 'self'，于是
         `<audio src="data:audio/wav;base64,…">` 被 CSP 拦下，
         元素只报 code 4「Media load rejected by URL safety check」——
         看起来像"文件损坏"，实际是策略没放行。
         · data: —— 曲目播放地址就是库里的 data URL（匿名可听的那条路）
         · blob: —— 读时长 probeDuration 用 createObjectURL(file) 喂临时 Audio
         （这两个写法必须与 cloud.js / radio.js 的实际取址方式保持一致。） */
      ['media-src 含 data:', /media-src[^;]*data:/],
      ['media-src 含 blob:', /media-src[^;]*blob:/],
      /* v4.8：数据层搬到 Supabase 后，connect-src 必须放行它的域。
         漏了这条的症状极具迷惑性 —— **界面照常渲染、文章一篇不剩**：
         CSP 违规的请求浏览器根本不发，页面不白屏、只有控制台报错，
         很容易被误判成"数据库挂了/后端宕了"。故在此钉死。 */
      ['connect-src 含 supabase 域', /connect-src[^;]*supabase\.co/],
      ['object-src none', /object-src 'none'/],
      ["base-uri 'self'", /base-uri 'self'/],
      ["form-action 'self'", /form-action 'self'/]
    ];
    need_.forEach(function (pair) {
      T('M CSP', 'R35b ' + pair[0], pair[1].test(csp));
    });

    /* 铁律：策略必须覆盖实际用到的全部外域，否则会拦掉自己的资源。
       ⚠ 只统计**页面会去加载**的引用 —— `<meta content="https://…">` 里的地址
         （og:url / og:image / twitter:image）是给爬虫看的，浏览器不会请求它，
         不适用 connect-src/script-src 那套。v4.8.0 把卡片地址改指 GitHub Pages 时
         撞上了这条：它会把 og:url 的域也当成"必须被 CSP 覆盖"，于是假红。
         故先剥掉 meta 标签再统计（其余 script/link/img 引用一律照旧受检）。 */
    const htmlForOrigins = SRC.html.replace(/<meta\b[^>]*>/gi, '');
    const origins = Array.from(new Set((htmlForOrigins.match(/https:\/\/[a-z0-9.-]+/g) || [])));
    const uncovered = origins.filter(function (o) {
      const host = o.replace(/^https:\/\//, '').replace(/^www\./, '');
      const esc = host.replace(/\./g, '\\.');
      /* 声明了该域，或该域是本页同源（self 覆盖） */
      return new RegExp(esc.replace(/\\\./g, '\\.')).test(csp) === false &&
        o.indexOf('cyberpunk-blog.app.workbuddy.host') === -1;
    });
    T('M CSP', 'R36 CSP 覆盖页面引用的全部外域', uncovered.length === 0,
      uncovered.length ? '未覆盖：' + uncovered.join(', ') : origins.length + ' 个外域全覆盖');

    /* 零内联脚本 / 零内联事件：否则 script-src 无 unsafe-inline 会直接拦死。
       注意：必须先剥掉 HTML 注释再检测，否则注释里提到的 "<script>" 字样会误报。 */
    const htmlNoComments = SRC.html.replace(/<!--[\s\S]*?-->/g, '');
    const inlineScripts = htmlNoComments.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    T('M CSP', 'R36b 无内联 <script> 块', inlineScripts.length === 0, inlineScripts.length + ' 个');
    const inlineHandlers = (htmlNoComments + SRC.app + SRC.views).match(/\son(click|load|error|change|input|submit)=/g) || [];
    T('M CSP', 'R36c 无内联事件属性（onclick= 等）', inlineHandlers.length === 0, inlineHandlers.length + ' 个');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "M CSP" };

standalone(module, run);
