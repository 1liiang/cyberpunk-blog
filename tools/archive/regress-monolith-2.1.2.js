'use strict';
/* ============================================================
   tests/regress.js — 功能回归
   R01-R15：核心功能（欢迎语 / 版本号 / 工程日志 / 数据源一致性）
   R16-R19：A1 供应链加固（CDN 锁版本 + SRI + SDK 本地化）
   R20-R24：B1 图片加载重构（缩略图 + 回退 + 透传）
   R25：版本三处一致性（version.js / index.html / LOG）
   ============================================================ */
const fs = require('fs');
const crypto = require('crypto');
const {
  SRC, FIXTURES, bootDom, waitFor, stripComments, stripJsLineComments,
  parseBuild, cssBlockAt, cssRuleBody, hasCssRule
} = require('./common');
const { makeSuite, checkDuplicateNames } = require('./case-runner');

/* D3：results / T / BUILD 改由 case-runner 的 makeSuite 提供。
   拆分后每个 tests/cases/*.js 都调用同一个 makeSuite，
   保证断言的记录格式在各文件间完全一致。 */
async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 A：正常启动（首页） ================= */
  {
    const ctx = bootDom({ captureConsole: true });
    await waitFor(function () { return ctx.doc.body.innerHTML.length > 600; }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    const fv = ctx.doc.getElementById('foot-version');
    T('A 正常启动', 'R01 页脚渲染版本号', fv && /^v\d+\.\d+\.\d+$/.test(fv.textContent), fv && fv.textContent);
    T('A 正常启动', 'R02 页脚标注来源与构建标识', fv && /BUILD_ID=/.test(fv.getAttribute('title') || ''), fv && fv.getAttribute('title'));
    T('A 正常启动', 'R03 工程日志按钮存在', !!ctx.doc.getElementById('btn-changelog'));
    T('A 正常启动', 'R04 控制台打印版本横幅', ctx.logs.some(function (l) { return /BUILD_ID/.test(l); }));
    T('A 正常启动', 'R05 无诊断横幅（未带 diag 参数）', !ctx.doc.getElementById('neon-diag'));
    T('A 正常启动', 'R06 无未处理拒绝', ctx.unhandled.length === 0, ctx.unhandled[0] || '');
    T('A 正常启动', 'R07 无 console.error', !ctx.logs.some(function (l) { return l.indexOf('ERR:') === 0; }));

    /* 版本数据源 */
    const NV = ctx.w.NEONVersion;
    T('A 正常启动', 'R08 NEONVersion.LOG 非空且结构完整',
      NV && Array.isArray(NV.LOG) && NV.LOG.length >= 4 && NV.LOG.every(function (e) { return e.version && Array.isArray(e.items); }),
      NV && NV.LOG.length);
    T('A 正常启动', 'R09 最新日志版本 === BUILD', NV && NV.LOG[0].version === NV.BUILD, NV && NV.LOG[0].version + ' vs ' + NV.BUILD);

    /* 工程日志弹窗 */
    const btn = ctx.doc.getElementById('btn-changelog');
    if (btn) btn.click();
    const modal = ctx.doc.querySelector('.modal-log');
    const entries = ctx.doc.querySelectorAll('.log-entry');
    T('A 正常启动', 'R10 日志弹窗可打开且有内容', !!modal && entries.length >= 4, entries.length + ' 条');
    ctx.dom.window.close();
  }

  /* ================= 场景 B：文章详情（full 图） ================= */
  {
    const ctx = bootDom({ url: 'https://x.test/#/post/1' });
    await waitFor(function () {
      return ctx.doc.querySelector('.post-cover') && ctx.doc.querySelector('#md-target img');
    }, 3000);
    const okFull = await waitFor(function () {
      const img = ctx.doc.querySelector('#md-target img');
      return img && /^data:image\/jpeg;base64,FULLB64JPEG2$/.test(img.getAttribute('src') || '');
    }, 3000);
    T('B 文章详情', 'R21 正文图使用原图 data URL', okFull);
    const okCover = await waitFor(function () {
      const cover = ctx.doc.querySelector('.post-cover');
      return cover && /FULLB64PNG1/.test(cover.style.backgroundImage || '');
    }, 3000);
    T('B 文章详情', 'R21b 详情页封面使用原图', okCover);
    ctx.dom.window.close();
  }

  /* ================= 场景 C：首页列表（B1 缩略图） ================= */
  {
    const ctx = bootDom({ url: 'https://x.test/#/' });
    await waitFor(function () { return ctx.doc.querySelectorAll('[data-cover]').length >= 2; }, 3000);
    const okThumb = await waitFor(function () {
      const covers = ctx.doc.querySelectorAll('.card-cover');
      return covers.length >= 2;
    }, 3000);
    /* 等 hydrate 完成（data-cover 属性被移除即完成） */
    await waitFor(function () {
      return ctx.doc.querySelectorAll('[data-cover]').length === 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 100); });

    /* A3：读通道应走视图 public_images（不含 owner_id），写通道仍为基表 */
    const imgQueries = ctx.queries.filter(function (q) { return q.table === 'public_images' && q.kind === 'select'; });
    const covers = ctx.doc.querySelectorAll('.card-cover');
    const bg = covers.length >= 2 ? covers[0].style.backgroundImage : '';
    const bg2 = covers.length >= 2 ? covers[1].style.backgroundImage : '';

    T('C 首页列表', 'R20 新图封面用缩略图数据', /THUMBB64PNG/.test(bg), bg.slice(0, 60));
    T('C 首页列表', 'R20b 图片查询 select 含 thumb 列',
      imgQueries.some(function (q) { return String(q.fields || '').indexOf('thumb') !== -1; }),
      imgQueries.map(function (q) { return q.fields; }).join(' | '));
    T('C 首页列表', 'R22 旧图无 thumb 回退原图', /FULLB64JPEG2/.test(bg2), bg2.slice(0, 60));
    T('C 首页列表', 'R22b 回退走了完整图查询',
      imgQueries.some(function (q) { return String(q.fields || '') === 'id,content_type,data'; }),
      imgQueries.map(function (q) { return q.fields; }).join(' | '));
    ctx.dom.window.close();
  }

  /* ================= 场景 D：图片写入透传（cloud.js 插件层） ================= */
  {
    const ctx = bootDom({ skipApp: true });
    let captured = null;
    const NEON = ctx.w.NEON;
    /* 拦截 insert 落库前的 payload：直接调用 Images.insert，桩已记录 */
    let err = null;
    try {
      await NEON.Images.insert({
        content_type: 'image/png', data: 'FULLB64X', thumb: 'THUMBX',
        width: 1280, height: 720, size_bytes: 100, storage_path: null
      });
    } catch (e) { err = e; }
    const ins = ctx.queries.filter(function (q) { return q.table === 'post_images' && q.kind === 'insert'; });
    captured = ins.length ? ins[0].payload : null;
    T('D 写入透传', 'R23 Images.insert 透传 thumb 字段',
      !err && captured && captured.thumb === 'THUMBX' && captured.data === 'FULLB64X',
      err ? String(err) : (captured ? 'thumb=' + captured.thumb : '无 insert 记录'));
    ctx.dom.window.close();
  }

  /* ================= 场景 E：A1 供应链加固（静态断言） ================= */
  {
    const html = SRC.html;
    const LIBS = [
      { name: 'marked', url: 'marked@12.0.2/marked.min.js' },
      { name: 'dompurify', url: 'dompurify@3.4.16/dist/purify.min.js' },
      { name: 'highlight.js', url: 'cdn-assets@11.12.0/highlight.min.js' }
    ];
    LIBS.forEach(function (lib) {
      const re = new RegExp('<script[^>]*src="https://cdn\\.jsdelivr\\.net/npm/[^"]*' +
        lib.url.replace(/[@/.]/g, '\\$&') + '"[^>]*></script>');
      const m = re.exec(html);
      const tag = m ? m[0] : '';
      T('E 供应链', 'R16 ' + lib.name + ' 锁定精确版本', !!m, lib.url);
      T('E 供应链', 'R16b ' + lib.name + ' 带 SRI integrity', /integrity="sha384-[A-Za-z0-9+/=]{40,}"/.test(tag));
      T('E 供应链', 'R16c ' + lib.name + ' 带 crossorigin', /crossorigin="anonymous"/.test(tag));
    });
    T('E 供应链', 'R17 云 SDK 本地托管（js/vendor/）', html.indexOf('js/vendor/workbuddy-cloud-sdk.js') !== -1);
    T('E 供应链', 'R17b 不再加载 @dev 漂移标签资源', !/src="[^"]*@dev/.test(html));

    const vendorExists = fs.existsSync(SRC.vendorPath);
    let vendorSize = 0, readmeOk = false, readmeInfo = '';
    if (vendorExists) {
      vendorSize = fs.statSync(SRC.vendorPath).size;
      const buf = fs.readFileSync(SRC.vendorPath);
      const hash = crypto.createHash('sha384').update(buf).digest('base64');
      const readme = fs.existsSync(SRC.vendorReadme) ? fs.readFileSync(SRC.vendorReadme, 'utf8') : '';
      readmeOk = readme.indexOf('sha384-' + hash) !== -1 || readme.indexOf(hash) !== -1;
      readmeInfo = 'size=' + vendorSize;
    }
    T('E 供应链', 'R18 vendor SDK 文件存在且非空', vendorExists && vendorSize > 10000, readmeInfo);
    T('E 供应链', 'R19 vendor README 哈希与文件一致', readmeOk);
  }

  /* ================= 场景 F：编辑器缩略图生成（源码断言） ================= */
  {
    T('F 编辑器', 'R24 上传流程生成 256px 缩略图',
      SRC.app.indexOf("need('compressImage')(f, 256, 0.6)") !== -1);
  }

  /* ================= 场景 G：版本三处一致性 ================= */
  {
    const m = /\?v=([0-9.]+)/.exec(SRC.html);
    const htmlV = m ? m[1] : null;
    const allSame = SRC.html.split('?v=').length - 1 >= 5 &&
      SRC.html.replace(new RegExp('\\?v=' + (htmlV || 'x').replace(/\./g, '\\.'), 'g'), '').indexOf('?v=') === -1;
    T('G 版本一致', 'R25 index.html 全部 ?v= 同值', !!htmlV && allSame, '?v=' + htmlV + ' × ' + (SRC.html.split('?v=').length - 1));
    T('G 版本一致', 'R25b ?v= === version.js BUILD', htmlV === BUILD, htmlV + ' vs ' + BUILD);
  }

  /* ================= 场景 H：A4 库层长度约束（源码 + 约定断言） ================= */
  {
    /* R26 原断言是 `SRC.cloud.indexOf('post_images') !== -1` ——
       近乎恒真（cloud.js 必然提到这张表），把整个文件删了才会红，等于摆设。
       改为守一条真实不变量：**非分页的取数路径必须有硬上限**。
       listMine 不走 range 分页，若没有 limit，文章上千时会一次拉爆。 */
    const listMineSeg = (function () {
      const i = SRC.cloud.indexOf('listMine:');
      const j = SRC.cloud.indexOf('create:', i);
      return i !== -1 ? SRC.cloud.slice(i, j === -1 ? i + 1200 : j) : '';
    })();
    T('H 长度约束', 'R26 listMine 非分页取数带硬上限（防一次拉爆）',
      /\.limit\(\s*\d+\s*\)/.test(listMineSeg),
      (listMineSeg.match(/\.limit\([^)]*\)/) || ['(无 limit，危险)'])[0]);
    /* 前端 maxlength 仅为体验，库层才是边界：断言编辑器已收窄到设计表值以内 */
    T('H 长度约束', 'R26b 标题 maxlength <= 200',
      /id="ed-title"[^>]*maxlength="(\d+)"/.test(SRC.views) &&
      Number(/id="ed-title"[^>]*maxlength="(\d+)"/.exec(SRC.views)[1]) <= 200,
      (function () { const m = /id="ed-title"[^>]*maxlength="(\d+)"/.exec(SRC.views); return m ? 'maxlength=' + m[1] : '未找到'; })());
    T('H 长度约束', 'R26c 摘要 maxlength <= 500',
      /id="ed-summary"[^>]*maxlength="(\d+)"/.test(SRC.views) &&
      Number(/id="ed-summary"[^>]*maxlength="(\d+)"/.exec(SRC.views)[1]) <= 500,
      (function () { const m = /id="ed-summary"[^>]*maxlength="(\d+)"/.exec(SRC.views); return m ? 'maxlength=' + m[1] : '未找到'; })());
    /* R26d 曾钉死在 split 正则上：v2.0.0 把分隔符扩成中英文分号、并抽出
       normalizeTags() 后该正则咬空，直接 TypeError 崩掉整轮。
       改为钉 TAG_MAX 常量 —— 这才是「标签上限」的真正单一数据源。 */
    const tagMaxM = /var\s+TAG_MAX\s*=\s*(\d+)\s*;/.exec(SRC.app);
    T('H 长度约束', 'R26d 标签上限 <= 10（TAG_MAX 常量）',
      !!tagMaxM && Number(tagMaxM[1]) <= 10,
      tagMaxM ? 'TAG_MAX=' + tagMaxM[1] : '未找到 TAG_MAX');
    T('H 长度约束', 'R26e 单标签长度 <= 50（TAG_LEN_MAX 常量）',
      (function () {
        const m = /var\s+TAG_LEN_MAX\s*=\s*(\d+)\s*;/.exec(SRC.app);
        return !!m && Number(m[1]) > 0 && Number(m[1]) <= 50;
      })(),
      (function () { const m = /var\s+TAG_LEN_MAX\s*=\s*(\d+)\s*;/.exec(SRC.app); return m ? 'TAG_LEN_MAX=' + m[1] : '未找到'; })());
  }

  /* ================= 场景 I：C5 OG 分享卡片 ================= */
  {
    const need_ = [
      ['og:type', /<meta\s+property="og:type"\s+content="[^"]+"/],
      ['og:title', /<meta\s+property="og:title"\s+content="[^"]+"/],
      ['og:description', /<meta\s+property="og:description"\s+content="[^"]+"/],
      ['og:image', /<meta\s+property="og:image"\s+content="https:\/\/[^"]+"/],
      ['og:url', /<meta\s+property="og:url"\s+content="https:\/\/[^"]+"/],
      ['twitter:card', /<meta\s+name="twitter:card"\s+content="summary_large_image"/]
    ];
    need_.forEach(function (pair) {
      const m = pair[1].exec(SRC.html);
      T('I OG 卡片', 'R27 ' + pair[0] + ' 已声明', !!m, m ? 'ok' : '缺失');
    });
    /* og:image 必须指向真实存在的本地资源 */
    const imgM = /<meta\s+property="og:image"\s+content="https:\/\/[^"]+\/([^"\/]+)"/.exec(SRC.html);
    const imgName = imgM ? imgM[1] : null;
    const imgPath = imgName ? require('path').join(require('./common').ROOT, 'assets', imgName) : null;
    const imgExists = imgPath ? fs.existsSync(imgPath) : false;
    T('I OG 卡片', 'R27b og:image 指向的本地文件存在', imgExists, imgName || '未解析');
    if (imgExists) {
      const sz = fs.statSync(imgPath).size;
      T('I OG 卡片', 'R27c og:image 体积 < 400KB（利于抓取）', sz < 400 * 1024, Math.round(sz / 1024) + 'KB');
    }
  }

  /* ================= 场景 J：C7 草稿自动保存 ================= */
  {
    const src = SRC.app;
    T('J 草稿快照', 'R28 快照 key 前缀与分槽实现', src.indexOf('neon_draft_') !== -1 && src.indexOf('draftKey') !== -1);
    T('J 草稿快照', 'R28b 防抖 3000ms', /setTimeout\(snapshotNow,\s*3000\)/.test(src));
    T('J 草稿快照', 'R28c 存储上限 4MB 安全线', /DRAFT_LIMIT\s*=\s*4\s*\*\s*1024\s*\*\s*1024/.test(src));
    T('J 草稿快照', 'R28d 超限截断并标记 truncated', /truncated\s*=\s*true/.test(src));
    T('J 草稿快照', 'R28e 保存成功后清除快照', /clearDraft\(state\.postId\)/.test(src));
    T('J 草稿快照', 'R28f 进页检测未恢复草稿', src.indexOf('offerDraftRestore') !== -1);
    T('J 草稿快照', 'R28g 标题/摘要/标签/封面纳入快照',
      src.indexOf("'ed-title', 'ed-summary', 'ed-tags', 'ed-cover'") !== -1);
    T('J 草稿快照', 'R28h 离开页面时落盘（hashchange）',
      /addEventListener\('hashchange'[\s\S]{0,300}snapshotNow\(\)/.test(src));
    T('J 草稿快照', 'R28i 不落库（快照只写 localStorage）',
      /function writeDraft[\s\S]*?localStorage\.setItem/.test(src) &&
      !/writeDraft[\s\S]{0,400}need\('Posts'\)/.test(src));

    /* R29：把 C7 纯逻辑抽到最小沙箱里真跑一遍（行为断言 > 字面断言） */
    const sandbox = { localStorage: (function () {
      var s = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; },
        setItem: function (k, v) { s[k] = String(v); },
        removeItem: function (k) { delete s[k]; },
        _keys: function () { return Object.keys(s); }
      };
    })() };
    /* 从真实源码中提取 C7 区块并求值，确保测的就是上线那份代码 */
    const seg = (function () {
      const start = src.indexOf('var DRAFT_PREFIX');
      const end = src.indexOf('/* 进编辑页：有未恢复快照则询问 */');
      return start !== -1 && end !== -1 ? src.slice(start, end) : '';
    })();
    let api = null, evalErr = null;
    try {
      const factory = new Function('localStorage', 'console',
        seg + '\nreturn { writeDraft: writeDraft, readDraft: readDraft, clearDraft: clearDraft, DRAFT_LIMIT: DRAFT_LIMIT, draftKey: draftKey };');
      api = factory(sandbox.localStorage, { warn: function () {} });
    } catch (e) { evalErr = e; }
    T('J 草稿快照', 'R29 沙箱内可提取 C7 逻辑', !!api, evalErr ? String(evalErr).slice(0, 60) : 'ok');
    if (api) {
      /* 写入 → 读回 */
      const w1 = api.writeDraft(42, { title: 'T', summary: 'S', tags: 'a,b', cover: '', content: 'BODY' });
      const r1 = api.readDraft(42);
      T('J 草稿快照', 'R29b 写入后可原样读回',
        w1.saved && r1 && r1.title === 'T' && r1.content === 'BODY' && r1.tags === 'a,b', r1 ? 'ok' : '读回失败');
      /* 分槽隔离 */
      api.writeDraft(null, { title: 'NEW', content: 'X' });
      const rNew = api.readDraft(null), r42 = api.readDraft(42);
      T('J 草稿快照', 'R29c 新建槽与文章槽互不覆盖',
        rNew && rNew.title === 'NEW' && r42 && r42.title === 'T', 'new=' + (rNew && rNew.title) + ' p42=' + (r42 && r42.title));
      /* 清除 */
      api.clearDraft(42);
      T('J 草稿快照', 'R29d clearDraft 后读不到该槽', api.readDraft(42) === null);
      T('J 草稿快照', 'R29e 清除不影响其他槽', api.readDraft(null) && api.readDraft(null).title === 'NEW');
      /* 超限截断 */
      const big = 'x'.repeat(api.DRAFT_LIMIT + 5000);
      const w2 = api.writeDraft(7, { title: 'BIG', content: big });
      const r2 = api.readDraft(7);
      T('J 草稿快照', 'R29f 超限时截断并标记 truncated',
        w2.saved && w2.truncated === true && r2 && r2.truncated === true,
        'truncated=' + (r2 && r2.truncated));
      T('J 草稿快照', 'R29g 截断后正文长度小于上限',
        r2 && r2.content.length <= api.DRAFT_LIMIT, r2 ? r2.content.length + ' < ' + api.DRAFT_LIMIT : '');
      /* 损坏数据容错 */
      sandbox.localStorage.setItem(api.draftKey(99), '{坏JSON');
      T('J 草稿快照', 'R29h 损坏快照读取不抛错、返回 null', api.readDraft(99) === null);
    }
  }

  /* ================= 场景 K：D2 版本 bump 脚本 ================= */
  {
    const path = require('path');
    const bumpPath = path.join(require('./common').ROOT, 'tools', 'bump.js');
    const bumpSrc = fs.existsSync(bumpPath) ? fs.readFileSync(bumpPath, 'utf8') : '';
    T('K bump 脚本', 'R30 tools/bump.js 存在且非空', bumpSrc.length > 1000, bumpSrc.length + 'B');
    /* 脚本必须同时覆盖三处改动点，缺一即是设计表担心的「忘一处」 */
    T('K bump 脚本', 'R30b 覆盖 version.js 的 BUILD',
      /BUILD:\\s\*'\[\^'\]\*'/.test(bumpSrc) && bumpSrc.indexOf('buildNewVersionJs') !== -1);
    T('K bump 脚本', 'R30c 覆盖 LOG unshift 插入', /LOG:\\s\*\\\[\\n/.test(bumpSrc) && bumpSrc.indexOf('items: [') !== -1);
    T('K bump 脚本', 'R30d 覆盖 index.html 全部 ?v= 引用',
      /\\\?v=\[0-9\.\]\+/.test(bumpSrc) && bumpSrc.indexOf('buildNewHtml') !== -1);
    T('K bump 脚本', 'R30e 支持 --dry-run 预览（不写盘）',
      bumpSrc.indexOf('--dry-run') !== -1 && bumpSrc.indexOf('dryRun') !== -1);
    T('K bump 脚本', 'R30f 拒绝版本号回退',
      bumpSrc.indexOf('cmpVer') !== -1 && /未高于当前 BUILD/.test(bumpSrc));
    T('K bump 脚本', 'R30g 拒绝非法 semver',
      bumpSrc.indexOf('isValidSemver') !== -1);

    /* 真跑一次 dry-run：确认脚本可执行且不改动文件 */
    const before = { ver: fs.readFileSync(path.join(require('./common').ROOT, 'js', 'version.js'), 'utf8'), html: SRC.html };
    let out = '', code = null;
    try {
      out = require('child_process').execSync(
        '"' + process.execPath + '" "' + bumpPath + '" 99.0.0 --title="t" --item="i" --dry-run',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }
      );
      code = 0;
    } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status; }
    T('K bump 脚本', 'R30h dry-run 可执行且退出码 0', code === 0, 'exit=' + code);
    T('K bump 脚本', 'R30i dry-run 输出版本预览', /1\.7\.0|99\.0\.0|目标/.test(out), out.split('\n').filter(function (l) { return /目标/.test(l); })[0] || '');
    const afterVer = fs.readFileSync(path.join(require('./common').ROOT, 'js', 'version.js'), 'utf8');
    T('K bump 脚本', 'R30j dry-run 不写盘（文件未变）',
      afterVer === before.ver, afterVer === before.ver ? 'unchanged' : '文件被改动！');
    /* v2.0.0 复查新增：--refresh-id 只刷 BUILD_ID（bump 后又改代码时的正规做法，
       避免为刷 ID 而强行递增版本号、绕过递增校验） */
    T('K bump 脚本', 'R30k 支持 --refresh-id 只刷 BUILD_ID',
      bumpSrc.indexOf('--refresh-id') !== -1 && bumpSrc.indexOf('refreshId') !== -1);
    T('K bump 脚本', 'R30l --refresh-id 拒绝版本号参数（防误用成 bump）',
      /--refresh-id 不接受版本号参数/.test(bumpSrc));
    let rOut = '', rCode = null;
    try {
      rOut = require('child_process').execSync(
        '"' + process.execPath + '" "' + bumpPath + '" --refresh-id --dry-run',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }
      );
      rCode = 0;
    } catch (e) { rOut = String(e.stdout || '') + String(e.stderr || ''); rCode = e.status; }
    T('K bump 脚本', 'R30m --refresh-id dry-run 可执行且不动版本号',
      rCode === 0 && /BUILD_ID/.test(rOut), 'exit=' + rCode);
    const afterRefresh = fs.readFileSync(path.join(require('./common').ROOT, 'js', 'version.js'), 'utf8');
    T('K bump 脚本', 'R30n --refresh-id dry-run 不写盘',
      afterRefresh === before.ver, afterRefresh === before.ver ? 'unchanged' : '文件被改动！');
  }

  /* ================= 场景 L：A3 post_images 收口 ================= */
  {
    /* 读走视图、写走基表 —— 这是 A3 的核心接口约定 */
    T('L 图片收口', 'R31 读取通道指向视图 public_images',
      SRC.cloud.indexOf("IMAGE_READ_TABLE = 'public_images'") !== -1);
    T('L 图片收口', 'R31b 写入通道仍为基表 post_images',
      SRC.cloud.indexOf("IMAGE_WRITE_TABLE = 'post_images'") !== -1);
    /* 视图不得暴露 owner_id / storage_path */
    T('L 图片收口', 'R32 读取不 select owner_id',
      !/IMAGE_READ_TABLE\)[\s\S]{0,120}?owner_id/.test(SRC.cloud));
    T('L 图片收口', 'R32b 读取不 select storage_path',
      !/IMAGE_READ_TABLE\)[\s\S]{0,120}?storage_path/.test(SRC.cloud));
    /* MIME 纵深防御：前端不信任库内 content_type */
    T('L 图片收口', 'R33 前端 MIME 白名单校验存在',
      SRC.cloud.indexOf('SAFE_MIME') !== -1 && /image\\\/\(jpeg\|png\|gif\|webp\)/.test(SRC.cloud));
    T('L 图片收口', 'R33b toDataUrl 经 safeMime 过滤',
      /function toDataUrl[\s\S]{0,200}?safeMime\(/.test(SRC.cloud));
    T('L 图片收口', 'R33c 封面选择器同样做 MIME 白名单',
      /SAFE_MIME[\s\S]{0,300}?content_type/.test(SRC.app));

    /* 行为验证：视图桩不含 owner_id，前端若误读会拿到 undefined
       ⚠ D3 拆分暴露的隐性缺陷：这个 IIFE 原先【没有 await】，两条断言（R34/R34b）
       是靠「后面还有一堆慢 case，微任务赶在 return 前跑完」才碰巧落进 results 的。
       一旦拆成独立文件（run() 立刻返回），它们就被静默丢掉 —— 453 变 451。
       凡异步断言必须 await，不能赌时序。 */
    await (async function () {
      const ctx = bootDom({ skipApp: true });
      const NEON = ctx.w.NEON;
      const m = await NEON.Images.fetchMany([1, 2]);
      T('L 图片收口', 'R34 经视图正常取到图片 data URL',
        m.size === 2 && /^data:image\/png;base64,THUMBB64PNG|^data:image\/png;base64,FULLB64PNG1/.test(m.get(1) || ''),
        'size=' + m.size + ' id1=' + String(m.get(1)).slice(0, 28));
      const q = ctx.queries.filter(function (x) { return x.table === 'public_images'; });
      T('L 图片收口', 'R34b 查询确实打到视图而非基表',
        q.length > 0 && ctx.queries.every(function (x) {
          return x.table !== 'post_images' || x.kind === 'insert';
        }), '视图查询 ' + q.length + ' 次');
      ctx.dom.window.close();
    })();
  }

  /* ================= 场景 M：A2 CSP ================= */
  {
    const cspM = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(SRC.html);
    const csp = cspM ? cspM[1] : '';
    T('M CSP', 'R35 CSP meta 已声明', !!csp, csp ? csp.slice(0, 40) + '…' : '缺失');

    const need_ = [
      ["default-src 'self'", /default-src 'self'/],
      ['script-src 含 jsdelivr', /script-src[^;]*https:\/\/cdn\.jsdelivr\.net/],
      ['script-src 无 unsafe-inline', /script-src(?![^;]*unsafe-inline)/],
      ['img-src 含 data:', /img-src[^;]*data:/],
      ['img-src 含 blob:', /img-src[^;]*blob:/],
      ['object-src none', /object-src 'none'/],
      ["base-uri 'self'", /base-uri 'self'/],
      ["form-action 'self'", /form-action 'self'/]
    ];
    need_.forEach(function (pair) {
      T('M CSP', 'R35b ' + pair[0], pair[1].test(csp));
    });

    /* 铁律：策略必须覆盖实际用到的全部外域，否则会拦掉自己的资源 */
    const origins = Array.from(new Set((SRC.html.match(/https:\/\/[a-z0-9.-]+/g) || [])));
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

  /* ================= 场景 N：第三批 P2（C2 目录/复制 · C1 搜索 · C3 归档） ================= */

  /* ---- N1：C2 详情页 TOC 抽取 + 滚动高亮 + 代码复制按钮 ---- */
  {
    const ctx = bootDom({ url: 'https://x.test/#/post/3' });
    await waitFor(function () {
      const t = ctx.doc.getElementById('md-target');
      return t && t.querySelectorAll('h2,h3').length >= 3;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });

    const nav = ctx.doc.getElementById('post-toc');
    const heads = ctx.doc.querySelectorAll('#md-target h2, #md-target h3');
    T('N 第三批', 'R37 详情页给出 TOC 容器', !!nav);
    T('N 第三批', 'R37b 从正文抽出 h2/h3 且数量匹配', !!nav && nav.querySelectorAll('a.toc-link').length === heads.length,
      nav ? nav.querySelectorAll('a.toc-link').length + ' / ' + heads.length : '无容器');
    T('N 第三批', 'R37c 每条标题都被补上 id 锚点',
      heads.length > 0 && Array.prototype.every.call(heads, function (h) { return !!h.id; }));
    const links = nav ? nav.querySelectorAll('a.toc-link') : [];
    T('N 第三批', 'R37d 目录链接指向真实存在的锚点',
      links.length > 0 && Array.prototype.every.call(links, function (a) {
        const id = a.getAttribute('data-toc');
        return id && !!ctx.doc.getElementById(id);
      }));
    T('N 第三批', 'R37e h3 条目带层级类名 toc-lv3',
      nav && nav.querySelectorAll('.toc-item.toc-lv3').length >= 1,
      nav && nav.querySelectorAll('.toc-item.toc-lv3').length);
    T('N 第三批', 'R37f 目录默认可见（标题数 >= 2）', nav && !nav.hidden);

    /* 代码块复制按钮 */
    const pres = ctx.doc.querySelectorAll('#md-target pre');
    T('N 第三批', 'R38 代码块被注入复制按钮',
      pres.length >= 1 && Array.prototype.every.call(pres, function (p) { return !!p.querySelector('.code-copy'); }),
      pres.length + ' 个 pre');
    T('N 第三批', 'R38b 复制按钮为 <button type=button>（非链接）',
      Array.prototype.every.call(pres, function (p) {
        const b = p.querySelector('.code-copy');
        return b && b.tagName === 'BUTTON' && b.getAttribute('type') === 'button';
      }));
    T('N 第三批', 'R38c pre 带 has-copy 类以避让 ::before 角标',
      Array.prototype.every.call(pres, function (p) { return p.classList.contains('has-copy'); }));
    T('N 第三批', 'R38d 无内联 onclick 依赖（走 addEventListener）',
      !/\.onclick\s*=/.test(SRC.app));

    /* 少于 2 个标题时不显示空目录 */
    const ctx2 = bootDom({ url: 'https://x.test/#/post/2' });
    await waitFor(function () {
      const t = ctx2.doc.getElementById('md-target');
      return t && t.innerHTML.length > 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });
    const nav2 = ctx2.doc.getElementById('post-toc');
    T('N 第三批', 'R37g 标题不足 2 个时目录隐藏（不留空框）', !!nav2 && nav2.hidden === true, nav2 && nav2.hidden);
    ctx.dom.window.close();
    ctx2.dom.window.close();
  }

  /* ---- N1b：TOC 生命周期（切页必须释放，否则每进一次详情页泄漏一份） ---- */
  {
    /* 强制走 scroll 降级路径（无 IntersectionObserver），这是泄漏最严重的分支：
       window 上的监听器永不自动回收，会跨页累积。 */
    const ctx = bootDom({ url: 'https://x.test/#/post/3' });
    await waitFor(function () {
      const t = ctx.doc.getElementById('md-target');
      return t && t.querySelectorAll('h2,h3').length >= 3;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });

    /* jsdom 无 IntersectionObserver → 走 scroll 降级分支（泄漏风险最高的那条路） */
    const after1 = ctx.w.__scrollListeners;
    /* C9 之后基线由 1 变为 2：详情页有两条独立的 scroll 监听 ——
         ① TOC 滚动高亮（降级路径，随页面生命周期存在）
         ② C9 阅读进度条/回顶（全局一个，initScrollUI 幂等安装）
       这里不再硬编码"必须等于 1"（那样每加一处全局监听都要改测试，
       而且改完就失去了对泄漏的约束力），改为断言"= TOC 1 + 全局 1"，
       并显式区分来源，避免将来有人把它当成可以随意增长的计数。 */
    T('N 第三批', 'R37h-0 详情页注册 scroll 监听 = TOC 降级 1 + C9 全局 1',
      after1 === 2, 'count=' + after1 + '（期望 2：TOC 1 + C9 全局 1）');

    /* 反复进出详情页：若 releaseToc 生效，监听器数量不应随次数增长 */
    for (let i = 0; i < 5; i++) {
      ctx.w.location.hash = '#/';
      await new Promise(function (r) { setTimeout(r, 60); });
      ctx.w.location.hash = '#/post/3';
      await new Promise(function (r) { setTimeout(r, 90); });
    }
    await new Promise(function (r) { setTimeout(r, 200); });
    const after = ctx.w.__scrollListeners;
    /* 关键：断言的是"没有随进出次数增长"这一性质，
       而非某个具体数字 —— 数字会随功能增加而变，性质不会。
       6 次进出若不释放，count 会涨到 6+；现在应稳定在 2。 */
    T('N 第三批', 'R37h 反复进出详情页 6 次后 scroll 监听不累积',
      after === after1, '6 次进出后 count=' + after + '（进入时 ' + after1 + '；不修复会涨到 6+）');
    T('N 第三批', 'R37i 源码存在 releaseToc 释放函数', /function releaseToc\s*\(/.test(SRC.app));
    T('N 第三批', 'R37j 路由入口调用 releaseToc（切页即释放）',
      /function route\(\)[\s\S]{0,500}releaseToc\(\)/.test(SRC.app));
    ctx.dom.window.close();
  }

  /* ---- N2：C1 搜索（#/search） ---- */
  {
    const ctx = bootDom({ url: 'https://x.test/#/search' });
    await waitFor(function () { return !!ctx.doc.getElementById('search-input'); }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    T('N 第三批', 'R39 #/search 路由渲染出搜索框', !!ctx.doc.getElementById('search-input'));
    T('N 第三批', 'R39b 空查询时提示索已就绪、不列结果',
      !ctx.doc.querySelector('.post-list') && /READY|索引/.test(ctx.doc.body.textContent || ''));

    /* 直接跳到带关键词的 hash，验证过滤结果 */
    ctx.w.location.hash = '#/search/NEON';
    await waitFor(function () {
      const list = ctx.doc.querySelector('.post-list');
      return list && list.querySelectorAll('.post-card').length > 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 150); });
    const cards = ctx.doc.querySelectorAll('.post-list .post-card');
    T('N 第三批', 'R39c 搜索命中标题（#/search/NEON → 1 条）', cards.length === 1, cards.length + ' 条');
    T('N 第三批', 'R39d 命中项标题正确',
      cards.length === 1 && /NEON/.test(cards[0].textContent));

    /* 按标签命中 */
    ctx.w.location.hash = '#/search/search';
    await waitFor(function () {
      const list = ctx.doc.querySelector('.post-list');
      return list && list.querySelectorAll('.post-card').length > 0;
    }, 3000);
    await new Promise(function (r) { setTimeout(r, 120); });
    const tagCards = ctx.doc.querySelectorAll('.post-list .post-card');
    T('N 第三批', 'R39e 按 tag 命中（#/search/search → 1 条）', tagCards.length === 1, tagCards.length + ' 条');

    /* 无命中 */
    ctx.w.location.hash = '#/search/zzz-not-exist';
    await waitFor(function () { return /NO MATCH/.test(ctx.doc.body.textContent || ''); }, 3000);
    T('N 第三批', 'R39f 无命中时给出 NO MATCH 空状态',
      /NO MATCH/.test(ctx.doc.body.textContent || ''));

    /* 草稿不该出现在公开搜索里 */
    ctx.w.location.hash = '#/search/未公开';
    await waitFor(function () { return /NO MATCH|post-list/.test(ctx.doc.body.textContent || ''); }, 3000);
    await new Promise(function (r) { setTimeout(r, 120); });
    T('N 第三批', 'R39g 草稿不进公开搜索索引',
      !ctx.doc.querySelector('.post-list .post-card'));

    /* 导航栏入口 */
    const navSearch = ctx.doc.querySelector('#nav a[data-nav="search"]');
    T('N 第三批', 'R39h 导航栏存在 SEARCH 入口', !!navSearch);
    ctx.dom.window.close();
  }

  /* ---- N3：C3 归档（#/archive，按月分组倒序） ---- */
  {
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return ctx.doc.querySelectorAll('.archive-group').length > 0; }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    const groups = ctx.doc.querySelectorAll('.archive-group');
    const months = Array.prototype.map.call(groups, function (g) {
      return g.querySelector('.archive-month').textContent.replace(/\d+$/, '').trim();
    });
    T('N 第三批', 'R40 归档页按月分组', groups.length === 3, groups.length + ' 个月');
    T('N 第三批', 'R40b 分组月份倒序（09 → 08 → 07）',
      months.length === 3 && /09/.test(months[0]) && /08/.test(months[1]) && /07/.test(months[2]),
      months.join(' | '));
    T('N 第三批', 'R40c 每月条数标注正确（9月 3 条）',
      groups.length > 0 && /3/.test(groups[0].querySelector('.archive-count').textContent),
      groups[0] && groups[0].querySelector('.archive-count').textContent);
    const totalItems = ctx.doc.querySelectorAll('.archive-item').length;
    T('N 第三批', 'R40d 归档条目总数 == 已发布文章数（5）', totalItems === 5, totalItems + ' 条');
    T('N 第三批', 'R40e 草稿不进归档', !/未公开草稿/.test(ctx.doc.body.textContent || ''));
    const firstLink = ctx.doc.querySelector('.archive-link');
    T('N 第三批', 'R40f 归档条目链接到详情页',
      !!firstLink && /^#\/post\/\d+$/.test(firstLink.getAttribute('href')),
      firstLink && firstLink.getAttribute('href'));
    const navArc = ctx.doc.querySelector('#nav a[data-nav="archive"]');
    T('N 第三批', 'R40g 导航栏存在 ARCHIVE 入口', !!navArc);
    T('N 第三批', 'R40h 未截断时不显示 partial-note（诚实提示不噪音）',
      !ctx.doc.querySelector('.partial-note'));
    ctx.dom.window.close();
  }

  /* ---- N3b：截断时必须诚实告知（否则「共 233 条」实为「只扫了 200 条」） ---- */
  {
    /* 造一个 total 大于实际返回行数的数据源：桩返回 2 行但声称 total=99 */
    const fx = JSON.parse(JSON.stringify(FIXTURES));
    fx.posts = fx.posts.filter(function (p) { return p.status === 'published'; });
    const ctx = bootDom({ url: 'https://x.test/#/archive', fixtures: fx });
    await waitFor(function () { return ctx.doc.querySelectorAll('.archive-group').length > 0; }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });

    /* 本桩的 total 就是返回行数，跑不出截断场景 —— 故直接对视图层求值。
       抠片段时要连 partialNote 一起带上（它定义在 archiveView 之前，漏了会 ReferenceError）。 */
    const archiveFn = (function () {
      /* 从文件头的 esc 起抠，把 archiveView 依赖的工具函数一并带上 */
      const from = SRC.views.indexOf('function esc');
      const to = SRC.views.indexOf('/* ---------- 文章详情');
      const seg = SRC.views.slice(from, to);
      return new Function(seg + '\nreturn archiveView;')();
    })();
    const htmlTruncated = archiveFn({
      loading: false, error: null, total: 99, scanned: 2,
      groups: [{ key: 'k', label: '2026 年 09 月', posts: [] }]
    });
    T('N 第三批', 'R40i total 大于已扫描量时给出截断提示',
      /partial-note/.test(htmlTruncated) && /仅覆盖最近 2 条/.test(htmlTruncated),
      /partial-note/.test(htmlTruncated) ? '已提示' : '未提示');
    const htmlFull = archiveFn({
      loading: false, error: null, total: 2, scanned: 2,
      groups: [{ key: 'k', label: '2026 年 09 月', posts: [] }]
    });
    T('N 第三批', 'R40j 未截断（total<=scanned）时不提示', !/partial-note/.test(htmlFull));
    ctx.dom.window.close();
  }

  /* ---- N4：第三批不越界（不改 A2 CSP / 不放宽既有约定） ---- */
  {
    /* 从 CSP meta 里精确取出 script-src 这一段再判断。
       注意不能对整份 html 直接查 unsafe-inline —— style-src 本来就合法保留了它。 */
    const cspM = /Content-Security-Policy"\s+content="([^"]+)"/.exec(SRC.html);
    const csp = cspM ? cspM[1] : '';
    const scriptSrc = (/script-src([^;]*)/.exec(csp) || [])[1] || '';
    T('N 第三批', 'R41 CSP meta 仍存在且未被放宽', !!cspM);
    T('N 第三批', 'R41b CSP script-src 仍不含 unsafe-inline',
      /'self'/.test(scriptSrc) && !/unsafe-inline/.test(scriptSrc),
      scriptSrc.trim());
    T('N 第三批', 'R41c 搜索/归档未引入库层全文检索（仍走 listPublished）',
      /renderSearch[\s\S]{0,600}listPublished/.test(SRC.app) &&
      /renderArchive[\s\S]{0,600}listPublished/.test(SRC.app));
    /* 只统计真正作为资源地址出现的外域（…"https://host/ 或 …="https://host"），
       不要用宽松正则扫到 CSP 策略文本里的 https:// 字样。 */
    const origins = {};
    (SRC.html.match(/["'(]https:\/\/([a-z0-9.-]+)/gi) || []).forEach(function (raw) {
      const host = raw.replace(/^["'(]https:\/\//i, '').replace(/[;'")\s].*$/, '');
      if (host && host.indexOf('www.w3.org') === -1) origins[host] = 1;
    });
    T('N 第三批', 'R41d 未新增外部依赖域（仅 jsdelivr + 自身域名）',
      Object.keys(origins).length === 2 && !!origins['cdn.jsdelivr.net'],
      Object.keys(origins).join(', '));
  }

  /* ================= 场景 O：2.0 收尾批（E2 / E1 / C4 / C6 / CRUD） ================= */

  /* ---- O1：安全审计 L-3 闭环（parseHash 不再因畸形编码抛错） ---- */
  {
    const seg = SRC.app.slice(SRC.app.indexOf('function safeDecode'), SRC.app.indexOf('function route()'));
    const make = new Function('location', seg + '\nreturn parseHash;');
    const bad = ['#/%', '#/%E0%A4%A', '#/tag/%', '#/search/%zz', '#/%C3%28'];
    let threw = 0;
    bad.forEach(h => {
      try { make({ hash: h })(); } catch (e) { threw++; }
    });
    T('O 2.0 收尾', 'R42 畸形 URI 编码不再抛 URIError（L-3 闭环）', threw === 0,
      threw + '/' + bad.length + ' 抛错');
    /* 正常路由仍要能用，别为了健壮性把功能搞坏 */
    let okNormal = true;
    try {
      const a = make({ hash: '#/post/1' })();
      const b = make({ hash: '#/tag/代码' })();
      okNormal = a.name === 'post' && a.id === 1 && b.tag === '代码';
    } catch (e) { okNormal = false; }
    T('O 2.0 收尾', 'R42b 正常路由解析不受影响', okNormal);
    T('O 2.0 收尾', 'R42c 源码存在 safeDecode', /function safeDecode\s*\(/.test(SRC.app));
  }

  /* ---- O2：E2 构建流程 ---- */
  {
    const pkgPath = require('path').join(__dirname, '..', 'package.json');
    const lockPath = require('path').join(__dirname, '..', 'package-lock.json');
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) { /* 留 null */ }
    T('O 2.0 收尾', 'R43 package.json 存在且声明脚本', !!pkg && !!pkg.scripts);
    T('O 2.0 收尾', 'R43b 门禁脚本 gate 指向 run-all', !!pkg && /run-all/.test(pkg.scripts.gate || ''));
    T('O 2.0 收尾', 'R43c feed 脚本指向 gen-feed（C4 依赖它）', !!pkg && /gen-feed/.test(pkg.scripts.feed || ''));
    T('O 2.0 收尾', 'R43d build = gate + feed', !!pkg && /gate/.test(pkg.scripts.build || '') && /feed/.test(pkg.scripts.build || ''));
    T('O 2.0 收尾', 'R43e preversion 自动跑门禁（防带病发版）', !!pkg && /gate/.test(pkg.scripts.preversion || ''));
    let lockSize = 0;
    try { lockSize = fs.statSync(lockPath).size; } catch (e) { lockSize = 0; }
    T('O 2.0 收尾', 'R43f package-lock.json 已生成', lockSize > 1000, lockSize + 'B');
    /* 版本自检工具真跑一遍。
       不 fork 子进程（沙箱下 spawnSync 会 EBUSY），直接 require 调 check()。 */
    let checkOut = '', checkOk = false;
    try {
      const cv = require('../tools/check-version.js');
      const r = cv.check();
      checkOk = r.ok === true;
      checkOut = r.ok
        ? '✓ 版本一致：v' + r.build + '（' + r.refs.length + ' 处 ?v= 引用）'
        : r.problems.join('; ');
    } catch (e) { checkOut = String(e && e.message); }
    T('O 2.0 收尾', 'R43g version:check 工具可执行且当前一致', checkOk, checkOut.slice(0, 60));
    /* 未引入打包器：本项目的价值就是"打开就能跑" */
    T('O 2.0 收尾', 'R43h 未引入打包器（devDependencies 仅 jsdom）',
      !!pkg && Object.keys(pkg.devDependencies || {}).every(k => /jsdom/.test(k)),
      pkg ? Object.keys(pkg.devDependencies || {}).join(',') || '(空)' : '');
  }

  /* ---- O3：E1 错误上报 ---- */
  {
    const ctx = bootDom({ captureConsole: true });
    await waitFor(() => ctx.doc.body.innerHTML.length > 600, 3000);
    await new Promise(r => setTimeout(r, 200));

    T('O 2.0 收尾', 'R44 NEON.Errors 已导出', !!(ctx.w.NEON && ctx.w.NEON.Errors));
    T('O 2.0 收尾', 'R44b report 与 listMine 存在',
      !!(ctx.w.NEON && typeof ctx.w.NEON.Errors.report === 'function' && typeof ctx.w.NEON.Errors.listMine === 'function'));

    /* 脱敏：URL / 邮箱 / 令牌必须被抹掉，这是安全基线 */
    const scrub = ctx.w.NEON.Errors._scrub;
    T('O 2.0 收尾', 'R45 脱敏抹掉 URL', !/https?:\/\//.test(scrub('访问 https://a.com/x?k=1 失败')),
      scrub('访问 https://a.com/x?k=1 失败'));
    T('O 2.0 收尾', 'R45b 脱敏抹掉邮箱', !/@/.test(scrub('用户 a@b.com 报错')), scrub('用户 a@b.com 报错'));
    T('O 2.0 收尾', 'R45c 脱敏抹掉平台 key（wbpk_）',
      !/wbpk_/.test(scrub('key=wbpk_abc123XYZ 无效')), scrub('key=wbpk_abc123XYZ 无效'));
    T('O 2.0 收尾', 'R45d 脱敏抹掉 JWT 片段（eyJ）',
      !/eyJ/.test(scrub('token eyJhbGciOi 过期')), scrub('token eyJhbGciOi 过期'));
    T('O 2.0 收尾', 'R45e 超长消息被裁到 1000 内', scrub('x'.repeat(5000)).length <= 1000,
      scrub('x'.repeat(5000)).length + ' 字符');

    /* 上报只写脱敏后的数据：原始 error 对象不入库 */
    const before = ctx.queries.length;
    ctx.w.dispatchEvent(new ctx.w.ErrorEvent('error', { message: 'boom https://x.com', filename: 'a.js', lineno: 1 }));
    await new Promise(r => setTimeout(r, 200));
    const errQ = ctx.queries.filter(q => q.table === 'error_logs');
    T('O 2.0 收尾', 'R46 未捕获异常触发写 error_logs', errQ.length > 0, errQ.length + ' 条');
    if (errQ.length) {
      const row = errQ[0].payload || {};
      T('O 2.0 收尾', 'R46b 入库的 message 已脱敏（不含原始 URL）',
        !/https?:\/\//.test(String(row.message || '')), String(row.message).slice(0, 40));
      T('O 2.0 收尾', 'R46c 带构建版本便于定位', !!row.build && /v?\d/.test(String(row.build)), String(row.build));
      T('O 2.0 收尾', 'R46d 只写 INSERT（日志不可改）', errQ[0].kind === 'insert', errQ[0].kind);
    }
    /* 会话内上报有上限，防死循环刷库 */
    T('O 2.0 收尾', 'R46e 源码含会话上报上限（防刷库）', /ERR_BUDGET/.test(SRC.cloud));
    ctx.dom.window.close();
  }

  /* ---- O4：C4 RSS ---- */
  {
    const feedPath = require('path').join(__dirname, '..', 'feed.xml');
    let feed = '';
    try { feed = fs.readFileSync(feedPath, 'utf8'); } catch (e) { feed = ''; }
    T('O 2.0 收尾', 'R47 feed.xml 已生成', feed.length > 100, feed.length + 'B');
    T('O 2.0 收尾', 'R47b 是合法 RSS 2.0 结构',
      /^<\?xml/.test(feed) && /<rss version="2.0"/.test(feed) && /<\/rss>\s*$/.test(feed.trim()));
    T('O 2.0 收尾', 'R47c 声明 atom:self 自引用', /rel="self"/.test(feed));
    /* URL 必须带 /cyberpunk-blog/ 前缀 —— 少一层就是空壳。
       先剥掉 <rss ...> 开标签：里面的 xmlns 命名空间（w3.org）不是站点 URL，
       第一版没剥，把命名空间也算进去，5 个 URL 里 1 个假红。 */
    const feedBody = feed.replace(/<rss[^>]*>/, '');
    const hrefs = feedBody.match(/https?:\/\/[^"<]+/g) || [];
    T('O 2.0 收尾', 'R47d 所有 URL 带 /cyberpunk-blog/ 前缀（根域只是跳转页）',
      hrefs.length > 0 && hrefs.every(h => /\/cyberpunk-blog\//.test(h)),
      hrefs.length + ' 个 URL');
    T('O 2.0 收尾', 'R47e 无 XML 非法控制字符',
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(feed));
    /* 发现声明 */
    T('O 2.0 收尾', 'R47f index.html 有 RSS 发现声明',
      /<link[^>]+rel="alternate"[^>]+application\/rss\+xml/.test(SRC.html));
    /* 生成器存在且只输出 published */
    T('O 2.0 收尾', 'R47g gen-feed.js 存在且只取 status=published',
      fs.existsSync(require('path').join(__dirname, '..', 'tools', 'gen-feed.js')) &&
      /status=eq\.published/.test(fs.readFileSync(require('path').join(__dirname, '..', 'tools', 'gen-feed.js'), 'utf8')));
  }

  /* ---- O5：C6 亮色主题 ---- */
  {
    T('O 2.0 收尾', 'R48 CSS 定义亮色变量块', /html\[data-theme="light"\]/.test(SRC.css || ''));
    T('O 2.0 收尾', 'R48b 亮色下霓虹色被压暗（青色不再是 #00f0ff）',
      /--cyan:\s*#007a91/.test(SRC.css || ''));
    /* O11：扫之前必须剥注释 —— 本次改造的注释里**大量引用了**被移除的
       @media (prefers-color-scheme: light) 和 :not([data-theme="dark"])，
       不剥注释的话这些"说明性文字"会让下面三条断言全部假红。
       （同一坑 v1.7.0 的 CSP 断言也踩过。） */
    const cssBare = stripComments(SRC.css || '');
    T('O 2.0 收尾', 'R48c 默认暗色：不再跟随系统偏好（prefers-color-scheme 已移除）',
      !/@media\s*\(prefers-color-scheme/.test(cssBare),
      /@media\s*\(prefers-color-scheme/.test(cssBare) ? '仍存在媒体查询分支' : '已移除');
    /* R48d：原先守的是「别裸用 :not([data-theme="dark"])」。
       O11 之后这个选择器已彻底退场（它本就是配合"跟随系统"media 块用的），
       断言随之升级为更强的一条：**任何地方都不该再出现它**，
       也不必再区分"在 media 内还是外"。 */
    T('O 2.0 收尾', 'R48d 不再使用 :not([data-theme="dark"]) 这类否定式主题选择器',
      !/:not\(\s*\[data-theme="dark"\]\s*\)/.test(cssBare),
      (cssBare.match(/:not\(\[data-theme="dark"\]\)/g) || []).length + ' 处');
    /* O11 正面断言：暗色兜底必须真的存在 —— :root 默认变量就是暗色，
       且亮色只在显式属性下生效。这条替代了原来的 R48d2（它守的是 media 内的
       :not(...) 合法用法，该用法已随 media 块一起消失）。 */
    T('O 2.0 收尾', 'R48d2 亮色仅由显式 data-theme="light" 触发（媒体查询不参与）',
      /html\[data-theme="light"\]\s*\{/.test(cssBare) &&
      !/@media\s*\(prefers-color-scheme/.test(cssBare));
    T('O 2.0 收尾', 'R48e 代码块底色改用变量（非硬编码）',
      /background:\s*var\(--code-bg\)/.test(SRC.css || ''));

    /* 运行时：三态循环 + 持久化 */
    const ctx = bootDom({ captureConsole: true });
    await waitFor(() => !!ctx.doc.getElementById('btn-theme'), 3000);
    await new Promise(r => setTimeout(r, 150));
    const btn = ctx.doc.getElementById('btn-theme');
    T('O 2.0 收尾', 'R49 导航栏存在主题按钮', !!btn);
    T('O 2.0 收尾', 'R49b 按钮是 <button>（非内联 onclick）',
      !!btn && btn.tagName === 'BUTTON' && !btn.getAttribute('onclick'));
    /* O11 主断言：从未选择过的用户，看到的必须是暗色 —— 与系统设置无关。 */
    T('O 2.0 收尾', 'R49e 默认态是暗色（btn 文案 ☾ DARK，非 ◐ AUTO）',
      !!btn && /DARK/.test(btn.textContent) && !/AUTO/.test(btn.textContent),
      btn ? btn.textContent : '无按钮');
    T('O 2.0 收尾', 'R49f 默认态 data-theme="dark"（而非无属性/亮色）',
      ctx.doc.documentElement.getAttribute('data-theme') === 'dark',
      String(ctx.doc.documentElement.getAttribute('data-theme')));

    /* 2.1.0（P0 批）：AUTO 态收口 —— 两态循环 dark ⇄ light。
       AUTO 在 O11 之后已名存实亡（它唯一的实现方式 @media prefers-color-scheme
       被删掉了，点它等于"什么都不设" = 暗色）。保留一个看起来有效、
       实际无效的开关比没有更糟，故本批正式摘除。 */
    const seq = [];
    for (let i = 0; i < 3; i++) {
      btn.click();
      await new Promise(r => setTimeout(r, 40));
      seq.push(ctx.doc.documentElement.getAttribute('data-theme'));
    }
    T('O 2.0 收尾', 'R49c 两态循环 dark→light→dark→light（AUTO 已收口）',
      JSON.stringify(seq) === JSON.stringify(['light', 'dark', 'light']), JSON.stringify(seq));
    T('O 2.0 收尾', 'R49c2 循环中不再出现"无属性"态（AUTO 的残留表现）',
      seq.indexOf(null) === -1, JSON.stringify(seq));
    T('O 2.0 收尾', 'R49d 选择持久化到 localStorage',
      ['light', 'dark'].indexOf(ctx.w.localStorage.getItem('neon_theme')) !== -1,
      ctx.w.localStorage.getItem('neon_theme'));
    ctx.dom.window.close();
  }

  /* ---- 2.1.0：AUTO 收口的兼容与归一化 ---- */
  {
    /* 存量 'auto' 值必须被归一化为 dark 并就地改写，不能：
       ① 崩掉  ② 显示成 AUTO（那个选项已不存在）  ③ 保持 auto 让语义含糊
       注意：storage 预置只在 themeBoot 分支里生效，故必须传 themeBoot:true，
       否则 storage 根本写不进去（会读到 null，断言全部失去意义）。 */
    const c = bootDom({ captureConsole: true, themeBoot: true, storage: { neon_theme: 'auto' } });
    await waitFor(() => !!c.doc.getElementById('btn-theme'), 3000);
    await new Promise(r => setTimeout(r, 150));
    const btn = c.doc.getElementById('btn-theme');
    T('O16 AUTO 收口', 'R77 源码中已无三态数组（auto 从循环里摘除）',
      !/\['dark',\s*'light',\s*'auto'\]/.test(SRC.app));
    T('O16 AUTO 收口', 'R77b THEME_ICON 不再含 auto 项',
      !/THEME_ICON\s*=\s*\{[^}]*auto:/.test(SRC.app));
    T('O16 AUTO 收口', 'R77c 按钮文案不含 AUTO（不会再出现无效选项）',
      !!btn && !/AUTO/.test(btn.textContent), btn ? btn.textContent : '无按钮');
    T('O16 AUTO 收口', 'R77d 存量 auto 用户看到暗色（归一化到默认值）',
      c.doc.documentElement.getAttribute('data-theme') === 'dark',
      String(c.doc.documentElement.getAttribute('data-theme')));
    T('O16 AUTO 收口', 'R77e 存量 auto 值被就地改写为 dark（下次启动无需再判断）',
      c.w.localStorage.getItem('neon_theme') === 'dark',
      String(c.w.localStorage.getItem('neon_theme')));

    /* 点一下应当进入 light（而不是先"进 auto"） */
    btn.click();
    await new Promise(r => setTimeout(r, 60));
    T('O16 AUTO 收口', 'R77f auto 存量用户点击后直接进 light（跳过已废弃的中间态）',
      c.doc.documentElement.getAttribute('data-theme') === 'light' &&
      c.w.localStorage.getItem('neon_theme') === 'light',
      c.doc.documentElement.getAttribute('data-theme'));
    c.dom.window.close();
  }

  /* ---- O17：赛博朋克装饰层（符号 / 名言 / 花纹光效） ---- */
  {
    /* 先剥注释再扫源码 —— 本项目注释里大量出现"某写法已移除/不要用"之类
       的自我说明，不剥会把它们误判成真实规则（此坑已踩 4 次）。 */
    const css = SRC.css || '';
    const cssBare = stripComments(css);
    const htmlBare = (SRC.html || '').replace(/<!--[\s\S]*?-->/g, '');

    /* --- 1. 装饰选择器存在性（行首锚定，避免被别处同名规则骗过） ---
       为什么锚行首：`.post-card::before` 若只写 `/\.post-card::before/`，
       会被注释里那句"· 卡片 → 四角 L 形边框标记（.post-card::before/::after）"
       救活（注释在 stripComments 后已删，故这里更稳）；但仍需锚行首，
       防止 `xxx .post-card::before` 这类后代选择器造成误配。 */
    /* D3：判据上提到 common.js（hasCssRule / cssRuleBody），此处只保留语义化别名。
       原来这里各写一份 —— 拆分后若继续复制，会出现"改了别处的判据、这里仍按旧判据
       放行"的假绿。故一律走 common.js 的唯一实现。 */
    const hasRule = function (sel) { return hasCssRule(cssBare, sel); };

    const decoSelectors = [
      ['R78 body::before 全息渐变晕斑（背景层）', 'body::before'],
      ['R78b .wrap::before 星点符号阵列（背景层）', '.wrap::before'],
      ['R78c .wrap::after 右侧竖排名言（名言文字）', '.wrap::after'],
      ['R78d .logo::after logo 扫描光泽（顶栏光效）', '.logo::after'],
      ['R78e .page-head h1::after 标题斜纹图案（标题区）', '.page-head h1::after'],
      ['R78f .post-card::before 卡片左上角标（卡片）', '.post-card::before'],
      ['R78g .post-card::after 卡片右下角标（卡片）', '.post-card::after'],
      ['R78h .post-full::before 文章左缘信号标尺（阅读面）', '.post-full::before'],
      ['R78i .about-card::after 关于卡角标花纹（卡片）', '.about-card::after'],
      ['R78j .site-footer::before 页脚全息分隔条（边框/分隔）', '.site-footer::before'],
      ['R78k .md-body blockquote::before 引用块装饰引号（名言）', '.md-body blockquote::before'],
      ['R78l .empty-state::before 空状态终端框（符号）', '.empty-state::before']
    ];
    decoSelectors.forEach(function (p) {
      T('O17 装饰层', p[0], hasRule(p[1]), hasRule(p[1]) ? 'OK' : '缺失：' + p[1]);
    });

    /* --- 2. 三类装饰元素齐备（用户明确要求：符号 / 名言 / 光效） --- */
    /* ⚠ 不能用注释里的"O17：赛博朋克装饰层"当锚点 —— stripComments 已把注释删了。
       改钉可执行结构：--deco-holo 的赋值（装饰块起点）
       → html[data-theme="light"]（装饰块终点，其后就是亮色变量表）。 */
    const decoStart = cssBare.indexOf('--deco-holo:');
    const decoEnd = cssBare.indexOf('html[data-theme="light"]');
    T('O17 装饰层', 'R79 装饰块在 CSS 中有明确分区（可定位）',
      decoStart !== -1 && decoEnd !== -1 && decoEnd > decoStart,
      'start=' + decoStart + ' end=' + decoEnd);
    const decoBlock = (decoStart !== -1 && decoEnd > decoStart) ? cssBare.slice(decoStart, decoEnd) : '';

    /* 名言文字：至少有一处 content 输出英文格言（竖排名言），
       且页脚名言容器有装饰（::before/::after 加 ◇ 引号符号）。 */
    T('O17 装饰层', 'R79b 含名言文字装饰（content 输出格言）',
      /content:\s*"[A-Z][A-Z0-9 ,'\-—–:;.!?]{20,}"/.test(decoBlock),
      (decoBlock.match(/content:\s*"[A-Z][^"]*"/) || ['(无)'])[0].slice(0, 60));
    T('O17 装饰层', 'R79c 页脚名言两侧加装饰符号（◇ 引号）',
      /\.site-footer\s*>\s*div:last-child::before[\s\S]{0,200}content:\s*"◇"/.test(decoBlock),
      /\.site-footer\s*>\s*div:last-child::before/.test(decoBlock) ? '已加' : '缺失');

    /* 光效：霓虹发光（text-shadow 走 --glow-*）+ 扫描线（已有 .scanlines 保留）
       + 全息渐变（--deco-holo 多色渐变）三类都应在装饰块中体现 */
    T('O17 装饰层', 'R79d 含全息渐变定义（--deco-holo 四色停靠）',
      /--deco-holo:\s*linear-gradient\(/.test(decoBlock) &&
      (decoBlock.match(/--deco-holo:[\s\S]*?;/) || [''])[0].split('color-mix').length >= 4);
    T('O17 装饰层', 'R79e 全息渐变由变量派生（至少 3 处 color-mix，无硬编码色）',
      (decoBlock.match(/color-mix\(/g) || []).length >= 3,
      'color-mix 出现 ' + (decoBlock.match(/color-mix\(/g) || []).length + ' 次');

    /* --- 3. 可读性红线：装饰必须是 pointer-events:none 的纯视觉层 ---
       所有装饰伪元素都不得接收鼠标事件（否则会挡住卡片点击、链接等）。 */
    const decoSels = [
      'body::before', '.wrap::before', '.wrap::after', '.logo::after',
      '.page-head h1::after', '.post-card::before', '.post-card::after',
      '.post-full::before', '.about-card::after', '.site-footer::before',
      '.md-body blockquote::before', '.empty-state::before', '.empty-state::after'
    ];
    /* ⚠ 不要用 `(?:[^{}]*,\s*)*` 这类嵌套量词 —— 它会在不匹配时
       引发灾难性回溯，直接挂死整轮测试（实测 7 分钟无输出）。
       改用「先按行定位选择器，再向后扫到最近的 { 取块体」的线性做法。
       D3：该实现已上提到 common.js 的 cssRuleBody（与 O12/O13 共用同一份）。 */
    const ruleBody = function (sel) { return cssRuleBody(cssBare, sel); };
    const missingPe = decoSels.filter(function (sel) {
      const body = ruleBody(sel);
      if (body === null) return true;          /* 找不到规则 = 有问题 */
      return !/pointer-events:\s*none/.test(body);
    });
    T('O17 装饰层', 'R80 全部装饰层 pointer-events:none（不挡任何交互）',
      missingPe.length === 0,
      missingPe.length ? '缺 pointer-events:none：' + missingPe.join(', ') : decoSels.length + ' 个全过');

    /* 装饰层不得盖住正文：背景层 z-index 必须 <= 0（.wrap 是 z-index 1） */
    const bodyBeforeM = /body::before\s*\{([^}]*)\}/.exec(cssBare);
    T('O17 装饰层', 'R80b 背景晕斑 z-index:0（在 .wrap z-index:1 之下）',
      !!bodyBeforeM && /z-index:\s*0/.test(bodyBeforeM[1]),
      bodyBeforeM ? (bodyBeforeM[1].match(/z-index:[^;]*/) || ['(无 z-index)'])[0] : '规则缺失');

    /* --- 4. 主题适配：装饰色必须走变量，禁止硬编码霓虹色 ---
       （v2.0.1 教训：硬编码 rgba(0,240,255) 在亮色主题下依然刺眼。） */
    const hardcoded = [];
    const reColor = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
    let cm;
    while ((cm = reColor.exec(decoBlock)) !== null) {
      const v = cm[0];
      /* 白名单：mask 用的纯黑/纯白；其余一律视为硬编码 */
      if (/^#(000|fff|000000|ffffff)$/i.test(v)) continue;
      if (/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(,\s*[\d.]+)?\s*\)$/.test(v)) continue;
      if (/^rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*[\d.]+)?\s*\)$/.test(v)) continue;
      hardcoded.push(v);
    }
    T('O17 装饰层', 'R81 装饰块无硬编码霓虹色（全部走变量/color-mix）',
      hardcoded.length === 0,
      hardcoded.length ? '硬编码：' + hardcoded.slice(0, 6).join(', ') : '0 处');

    /* 反向确认：装饰块里确实用了 color-mix 从变量派生（不是"没色所以没硬编码"） */
    T('O17 装饰层', 'R81b 装饰色确实由 CSS 变量派生（color-mix + var）',
      /color-mix\(in srgb,\s*var\(--/.test(decoBlock),
      (decoBlock.match(/color-mix\(in srgb,\s*var\(--[a-z-]+\)/g) || []).length + ' 处');

    /* --- 5. reduced-motion 覆盖：装饰动画必须可关 --- */
    const rmStart = cssBare.indexOf('prefers-reduced-motion');
    T('O17 装饰层', 'R82 reduced-motion 块存在（装饰动画有处可关）', rmStart !== -1);
    const rmSuffix = ' @media (prefers-reduced-motion: reduce) { ' + cssBare.slice(rmStart).replace(/^[^{]*\{/, '');
    /* 装饰层的位移动画（logo 扫描）与过渡（角标）必须在 reduce 块里被关掉 */
    const r82b = /\.logo:hover::after\s*\{\s*display:\s*none/.test(rmSuffix);
    T('O17 装饰层', 'R82b logo 扫描光泽在减少动效下被关闭', r82b,
      r82b ? '已覆盖' : '未覆盖');
    /* ⚠ info 必须与断言用同一个谓词，否则会出现「绿着却写着未覆盖」的自相矛盾。 */
    const r82c = /\.post-card::before[\s\S]{0,80}transition:\s*none/.test(rmSuffix);
    T('O17 装饰层', 'R82c 卡片角标的过渡在减少动效下被归零', r82c,
      r82c ? '已覆盖' : '未覆盖');

    /* --- 5b. P1 修复：竖排名言不得被硬裁切（72h/72i）---
       v2.1.1 的 .wrap::after 用 max-height: 62vh + overflow: hidden 约束一行
       61 字符的竖排文字：竖排总高 = 字符数 × (font-size + letter-spacing)，
       固定 10.5px + 4px 时约 885px，800~900px 高的常见窗口会被截掉 11%~44%，
       句子断在半句上。修复 = 字号随视口高度自适应 + 去掉硬裁切。
       这两条断言钉住"修复的两个必要条件"，任何一条回退都会报红：
         · 有 clamp(...vh...) 形式的字号（说明自适应生效）
         · 无 max-height 约束（说明硬裁切已去除） */
    const quoteBody = ruleBody('.wrap::after');
    /* 断言要钉"两条声明同时存在"：
       · 有 clamp(...vh...)：自适应生效（防截断的正面条件）
       · clamp 之前有 px fallback：旧浏览器拿到兜底字号，不会回落到继承的 16px
       只查前者会漏掉"clamp 不被支持 → 字号暴涨"这条降级路径。 */
    T('O17 装饰层', 'R72h 竖排名言字号随视口高度自适应（clamp + vh，防截断）',
      !!quoteBody && /font-size:\s*clamp\([^)]*\d+(\.\d+)?vh[^)]*\)/.test(quoteBody),
      quoteBody ? (/font-size:\s*(clamp\([^;]*\))/.exec(quoteBody) || [])[1] || '(无)' : '未找到规则');
    T('O17 装饰层', 'R72h2 clamp 前有 px 兜底（旧浏览器不致回落到 16px 撑爆视口）',
      !!quoteBody && /font-size:\s*[\d.]+px;\s*font-size:\s*clamp\(/.test(quoteBody),
      quoteBody && /font-size:\s*([\d.]+px);\s*font-size:\s*clamp/.test(quoteBody)
        ? '兜底 ' + (/font-size:\s*([\d.]+px);\s*font-size:\s*clamp/.exec(quoteBody) || [])[1]
        : '缺兜底声明');
    T('O17 装饰层', 'R72i 竖排名言已去除硬裁切（无 max-height 截断单行文字）',
      !!quoteBody && !/max-height\s*:/.test(quoteBody),
      quoteBody ? (/max-height\s*:[^;]*/.exec(quoteBody) || ['(无 max-height)'])[0] : '未找到规则');
    /* 第二道防线：极矮窗（<=640px）整体隐藏，避免缩到下限仍放不下。
       这是"边界兜底"，与 R83 的窄屏隐藏是不同维度（宽 × 高）。 */
    T('O17 装饰层', 'R72j 极矮窗（<=640px）隐藏竖排名言（字号下限兜底）',
      /@media\s*\(max-height:\s*640px\)\s*\{[\s\S]{0,120}\.wrap::after\s*\{\s*display:\s*none/.test(cssBare));

    /* --- 5c. P1 修复：装饰专用时长必须进 reduced-motion 归零名单（72k/72l）---
       v2.1.1 新增 --t-sweep: 0.55s 时漏进归零列表。当时无害纯属巧合
       （唯一使用者 .logo:hover::after 被 display:none 关掉了），
       但任何将来复用该变量的元素都会在"减少动效"下真的跑 0.55s → 违背无障碍承诺。
       这里钉的是**机制**而非清单：扫描全 CSS 里所有**取值为时长**的 `--t-*` 定义，
       断言每一个都出现在 reduce 块内。以后加 --t-reveal: 0.4s 之类会当场报红。

       ⚠ 只扫"时长度量"的变量，不能把 --t-bezier 也算进来 ——
       它是 cubic-bezier(0.4,0,0.2,1) 的**缓动曲线**（timing function），
       与"时长"是正交的两件事：减少动效下要归零的是"走多久"，
       而不是"用什么曲线走"（何况时长归零后曲线本就失去意义）。
       第一版断言用 `/--t-[a-z-]+\s*:/` 无差别匹配，把 --t-bezier 误判成
       "漏归零"而报红 —— 这是**断言假阳性**，不是代码缺陷。
       改为：只收「冒号后紧跟 <数字>s / <数字>ms」的变量。 */
    const allTVars = Array.from(new Set((cssBare.match(/--t-[a-z-]+\s*:\s*[\d.]+m?s\b/g) || [])
      .map(function (s) { return s.replace(/\s*:.*$/, ''); })));
    const rmBlockOnly = rmStart !== -1 ? cssBare.slice(rmStart) : '';
    const missingTVars = allTVars.filter(function (v) {
      /* reduce 块内的 :root 里必须有一条把该变量归零的声明 */
      return !new RegExp(v.replace(/[-]/g, '\\-') + '\\s*:\\s*0*\\.?0*0*1?ms').test(rmBlockOnly);
    });
    T('O17 装饰层', 'R72k 所有「时长型」--t-* 变量都在 reduced-motion 块内被归零',
      allTVars.length > 0 && missingTVars.length === 0,
      (missingTVars.length ? '漏归零：' + missingTVars.join(', ') : allTVars.length + ' 个全部归零')
      + ' [' + allTVars.join(' ') + ']');
    /* 反向确认：断言确实把 --t-bezier 这类非时长变量排除了
       （否则"只扫时长"这个修复本身没被验证，等于换了个假绿）。 */
    T('O17 装饰层', 'R72k2 缓动曲线变量（--t-bezier）不被误判为时长型',
      allTVars.indexOf('--t-bezier') === -1 && /--t-bezier\s*:\s*cubic-bezier/.test(cssBare),
      '扫得 ' + allTVars.length + ' 个时长变量，--t-bezier 已排除');
    T('O17 装饰层', 'R72l --t-sweep 已在减少动效下归零（消除时长逃逸）',
      /--t-sweep\s*:\s*0\.001ms/.test(rmBlockOnly));

    /* --- 5e. 顺序健壮性：reduce 块的归零不得依赖"本块排在最后"（72n）---
       查证过程发现的一类系统性隐患：reduce 块用 @media 包裹，但 @media
       **不增加特异性** —— 块内 `:root { --t-fast: ... }` 与文件开头定义
       `--t-fast: 0.15s` 的 `:root` 特异性完全相同（都是 0,1,0），
       最终取值只由"谁在文件里更靠后"决定。
       后果：有人把 reduce 块上移（或把新响应式块追加到文件末尾）→
       减少动效静默失效，页面看起来毫无变化，极难察觉。
       修复 = 给块内所有"与更早的基础声明竞争同一属性"的规则加 !important，
       把隐式顺序依赖换成显式优先级。
       本条断言块内两个关键归零点都带了 !important。 */
    const r72n = /--t-fast:\s*0\.001ms\s*!important/.test(rmBlockOnly) &&
                 /--t-sweep:\s*0\.001ms\s*!important/.test(rmBlockOnly);
    T('O17 装饰层', 'R72n 归零变量带 !important（不依赖"本块排最后"的隐式顺序）', r72n,
      r72n ? '已硬化' : '仍依赖文件顺序');

    /* --- 5d. P2 修复：全屏 blur 在减少动效下降级（72m/72m2）---
       body::before 是 position:fixed + inset:-20%（140% 视口面积）+ blur(90px)，
       滚动时持续参与合成、每帧重算模糊 —— 开销高于 topbar 的 backdrop-filter
       （后者已在本块关闭，前者当时漏了）。减少动效的诉求含"前庭不适 + 低端机降级"，
       故这里一并压掉硬模糊。

       ⚠ 必须断言 !important：body::before 同时被基础规则(blur 90px)与
       @media(max-width:720px)(blur 60px) 改写，三者特异性相同(0,1,0)，
       取值只由文件顺序决定 —— 不加 !important 就等于把正确性押在
       "reduce 块永远排在文件最后"这个隐式约定上；顺手挪动代码块就会静默失效。
       72m2 专门守住这一点，防止有人"清理掉多余的 !important"。 */
    T('O17 装饰层', 'R72m 全屏晕斑 blur 在减少动效下被降级（省重绘开销）',
      /body::before\s*\{\s*filter:\s*none/.test(rmBlockOnly));
    T('O17 装饰层', 'R72m2 blur 降级带 !important（消除对声明顺序的隐式依赖）',
      /body::before\s*\{\s*filter:\s*none\s*!important/.test(rmBlockOnly));

    /* --- 6. 响应式 / 触屏适配：窄屏与无 hover 设备上装饰收敛 --- */
    const r83 = /@media\s*\(max-width:\s*1400px\)\s*\{[\s\S]{0,120}\.wrap::after\s*\{\s*display:\s*none/.test(cssBare);
    T('O17 装饰层', 'R83 窄屏（<=1400px）隐藏右侧竖排名言（保可读性）', r83,
      r83 ? '已设' : '未设');
    const r83b = /@media\s*\(max-width:\s*720px\)\s*\{[^@]*?\.post-full::before\s*\{\s*display:\s*none/.test(cssBare);
    T('O17 装饰层', 'R83b 小屏（<=720px）隐藏文章左缘标尺（不挤正文）', r83b,
      r83b ? '已设' : '未设');
    T('O17 装饰层', 'R83c 无 hover 设备（触屏）关闭卡片角标 hover 增强',
      /@media\s*\(hover:\s*none\)/.test(cssBare) &&
      /@media\s*\(hover:\s*none\)\s*\{[\s\S]{0,200}\.post-card:hover::before/.test(cssBare));

    /* --- 7. CSP 合规：装饰纯 CSS，不得引入内联脚本/内联事件 ---
       （装饰若走 JS innerHTML 注入，就需要内联脚本，会被 CSP 拦死。） */
    T('O17 装饰层', 'R84 装饰层未引入内联 <script>（纯 CSS 实现）',
      !/<script(?![^>]*\bsrc=)[^>]*>/.test(htmlBare));

    /* --- 8. 真实渲染：启动页面确认装饰未破坏既有结构 ---
       ⚠ 等待条件必须是"卡片真的出现"，不能用 body.innerHTML.length > 500 ——
       那个阈值连 loading 占位块都能满足，会在首屏数据回来前就断言，
       导致 R85 系列看到 0 张卡片、假红。 */
    const c = bootDom({ url: 'https://x.test/#/' });
    let rendered = true;
    try {
      await waitFor(function () { return c.doc.querySelectorAll('.post-card').length > 0; }, 5000);
    } catch (e) { rendered = false; }
    T('O17 装饰层', 'R85 装饰样式加入后页面正常渲染（页头存在）',
      rendered && !!c.doc.querySelector('.page-head h1'),
      c.doc.querySelector('.page-head h1') ? c.doc.querySelector('.page-head h1').textContent : '(无)');
    T('O17 装饰层', 'R85b 装饰样式加入后卡片仍正常渲染',
      c.doc.querySelectorAll('.post-card').length > 0,
      c.doc.querySelectorAll('.post-card').length + ' 张');
    T('O17 装饰层', 'R85c 装饰样式加入后页脚名言仍在',
      !!c.doc.querySelector('.site-footer > div:last-child') &&
      /THE STREET FINDS ITS OWN USES/.test(c.doc.querySelector('.site-footer > div:last-child').textContent || ''));
    T('O17 装饰层', 'R85d 装饰样式加入后无未捕获异常',
      (c.unhandled || []).length === 0,
      (c.unhandled || []).length + ' 个');
    c.dom.window.close();
  }

  /* ---- O6：CRUD 边界规则 ---- */
  {
    /* 从 app.js 抠出 normalizeTags 真跑（含全部依赖） */
    const from = SRC.app.indexOf('var TAG_MAX');
    const to = SRC.app.indexOf('/* ============ C6：亮色主题');
    const norm = new Function(SRC.app.slice(from, to) + '\nreturn normalizeTags;')();

    T('O 2.0 收尾', 'R50 标签去重（保持首次顺序）',
      JSON.stringify(norm('代码,随笔,代码')) === JSON.stringify(['代码', '随笔']),
      JSON.stringify(norm('代码,随笔,代码')));
    T('O 2.0 收尾', 'R50b 大小写重复按小写归一，保留原写法',
      JSON.stringify(norm('JS,js,JS')) === JSON.stringify(['JS']), JSON.stringify(norm('JS,js,JS')));
    T('O 2.0 收尾', 'R50c 空项被丢弃（不存空串）',
      JSON.stringify(norm('a,,b,  ,c')) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(norm('a,,b,  ,c')));
    T('O 2.0 收尾', 'R50d 支持中英文逗号与分号',
      JSON.stringify(norm('a，b;c；d,e')) === JSON.stringify(['a', 'b', 'c', 'd', 'e']),
      JSON.stringify(norm('a，b;c；d,e')));
    T('O 2.0 收尾', 'R50e 超 8 个截断', norm('1,2,3,4,5,6,7,8,9,10').length === 8,
      norm('1,2,3,4,5,6,7,8,9,10').length + ' 个');
    T('O 2.0 收尾', 'R50f 单标签超 24 字符截断', norm('x'.repeat(50)).length === 1 && norm('x'.repeat(50))[0].length === 24);
    T('O 2.0 收尾', 'R50g 空输入返回空数组', JSON.stringify(norm('')) === '[]' && JSON.stringify(norm(null)) === '[]');
    T('O 2.0 收尾', 'R50h 不修改入参（返回新数组）', (function () {
      const before = 'a,b';
      norm(before);
      return before === 'a,b';
    })());
    /* 删除必须是二次确认，且不可逆 */
    T('O 2.0 收尾', 'R51 删除走模态二次确认', /ed-delete[\s\S]{0,600}openModal|openModal[\s\S]{0,400}确认删除/.test(SRC.app));
    /* 未命中提示在 cloud.js（数据层知道 affected 行数），app.js 只做 toast 呈现。
       第一版只在 SRC.app 里找，必然找不到 —— 断言写错了位置，不是功能缺失。 */
    T('O 2.0 收尾', 'R51b 更新/删除未命中时明确报错（不静默成功）',
      /没有更新任何内容/.test(SRC.cloud) && /没有删除任何内容/.test(SRC.cloud),
      (SRC.cloud.match(/没有(更新|删除)任何内容/g) || []).join(' / ') || '未找到');
  }

  /* ---- O7：2.0 全面复查修正（v2.0.0 收尾自审） ----
     以下断言对应「全面复查计划」中查出的 4 处代码缺陷，
     每一条都先在反向验证里确认过「修掉它就会转红」，不是摆设。 */
  {
    /* R52：资源加载错误不得被当成 JS 异常上报。
       危害：ERR_BUDGET 只有 10 条，一张图挂了就可能把配额吃光，
       真正的 JS 异常反而报不上来 —— 上报机制等于废掉。 */
    T('O7 复查修正', 'R52 error 钩子拒收资源加载错误（防吃掉上报配额）',
      /isResourceError/.test(SRC.app) &&
      /ev\.target\s*&&\s*ev\.target\s*!==\s*window/.test(SRC.app) &&
      /if\s*\(\s*isResourceError\s*\)\s*return/.test(SRC.app));

    /* 反向验证：用真实的 img error 事件跑一遍钩子，确认它没写库 */
    const ctx2 = bootDom({ captureConsole: true });
    await waitFor(() => ctx2.doc.body.innerHTML.length > 600, 3000);
    await new Promise(r => setTimeout(r, 150));
    const beforeLogs = ctx2.queries.filter(q => q.table === 'error_logs').length;
    const imgEl = ctx2.doc.createElement('img');
    ctx2.doc.body.appendChild(imgEl);
    const resErr = new ctx2.w.Event('error');
    Object.defineProperty(resErr, 'target', { value: imgEl });
    ctx2.w.dispatchEvent(resErr);
    await new Promise(r => setTimeout(r, 150));
    const afterLogs = ctx2.queries.filter(q => q.table === 'error_logs').length;
    T('O7 复查修正', 'R52b 实测：img 加载失败不写 error_logs',
      afterLogs === beforeLogs, beforeLogs + ' → ' + afterLogs);

    /* R53：正文长度前端必须拦，且上限与库层 posts_content_len 对齐 */
    const cm = /var\s+CONTENT_MAX\s*=\s*(\d+)\s*;/.exec(SRC.app);
    T('O7 复查修正', 'R53 正文长度前端上限存在且 = 库层 200000',
      !!cm && Number(cm[1]) === 200000, cm ? 'CONTENT_MAX=' + cm[1] : '未找到');
    T('O7 复查修正', 'R53b 超限时中止提交并给出人话提示',
      /body\.length\s*>\s*CONTENT_MAX/.test(SRC.app) && /正文超出上限/.test(SRC.app));

    /* R54：error_logs.owner_id 必须有 DEFAULT auth.uid()::uuid，
       否则登录用户上报后读不到自己那条（RLS 是 owner_id::text = auth.uid()）。
       测试不联网，故断言「cloud.js 记录了该约束」—— 结构真值由复查时实测确认，
       这里守住的是「不许把这个约束从注释里悄悄删掉」。 */
    T('O7 复查修正', 'R54 error_logs 归属列默认值约束已记录（auth.uid()::uuid）',
      /DEFAULT auth\.uid\(\)::uuid/.test(SRC.cloud) &&
      /42804|default expression is of type text/.test(SRC.cloud));

    /* R55：CSS 变量不得重复定义（重复 = 后一条静默覆盖前一条，是纯噪音） */
    const cssBody = SRC.css || '';
    const lightBlock = /html\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(cssBody);
    let dupInLight = [];
    if (lightBlock) {
      const names = lightBlock[1].match(/(--[\w-]+)\s*:/g) || [];
      const seen = {};
      names.forEach(n => {
        const k = n.replace(/\s*:$/, '');
        if (seen[k]) dupInLight.push(k);
        seen[k] = 1;
      });
    }
    T('O7 复查修正', 'R55 亮色变量块无重复定义',
      dupInLight.length === 0, dupInLight.join(',') || '无重复');
  }

  /* ---- O8：页头分隔线（用户反馈：上下区域边界不清） ----
     问题：页头（标题+副标题）与下方内容之间只有留白，亮色主题下糊成一片。
     方案：.page-head::after 画赛博朋克横向分隔线（渐变主线 + 扫描段），
          .page-head::before 画左端品红菱形锚点。纯 CSS，零 JS。 */
  {
    const cssTxt = SRC.css || '';
    const afterM = /\.page-head::after\s*\{([\s\S]*?)\}/.exec(cssTxt);
    const beforeM = /\.page-head::before\s*\{([\s\S]*?)\}/.exec(cssTxt);
    const headM = /\.page-head\s*\{([\s\S]*?)\}/.exec(cssTxt);

    T('O8 分隔线', 'R56 .page-head::after 分隔线规则存在', !!afterM);
    T('O8 分隔线', 'R56b 分隔线用 background 渐变绘制（非 border 实线）',
      !!afterM && /background\s*:/.test(afterM[1]) && /linear-gradient/.test(afterM[1]));
    T('O8 分隔线', 'R56c 分隔线高度 1px + 上方留白',
      !!afterM && /height\s*:\s*1px/.test(afterM[1]) && /margin-top\s*:/.test(afterM[1]));
    T('O8 分隔线', 'R56d 分隔线含「扫描段」（第二层渐变）',
      !!afterM && (afterM[1].match(/linear-gradient/g) || []).length >= 2);
    T('O8 分隔线', 'R56e 左端菱形锚点（::before + clip-path polygon）',
      !!beforeM && /clip-path\s*:\s*polygon/.test(beforeM[1]));
    T('O8 分隔线', 'R56f .page-head 有 position:relative（菱形锚的定位基准）',
      !!headM && /position\s*:\s*relative/.test(headM[1]));
    /* 关键：颜色必须走变量，否则亮色主题下分隔线仍是刺眼荧光青 */
    const afterBgVar = afterM ? /var\(--(cyan|line-strong|magenta|glow)/.test(afterM[1]) : false;
    T('O8 分隔线', 'R56g 分隔线配色走 CSS 变量（亮色主题自动适配）', afterBgVar);
    const hardNeon = afterM ? (afterM[1].match(/#00f0ff|#ff2a6d|#f9f002/gi) || []) : [];
    T('O8 分隔线', 'R56h 分隔线内无硬编码霓虹色值',
      hardNeon.length === 0, hardNeon.join(',') || '无');
    /* 全站复用：所有页面标题区都该有这条分隔线（用的是同一个 .page-head） */
    T('O8 分隔线', 'R56i 分隔线挂在通用 .page-head 上（全站页面同享）',
      /\.page-head::after/.test(cssTxt) && !/\.archive-view\s+\.page-head::after/.test(cssTxt));
  }

  /* ---- O9：标签频段色标（用户反馈：归档页所有条目长得一模一样） ----
     问题：归档条目只有「标题 + 日期」，没有标签、没有状态，任何可区分视觉信息。
     方案：标签名 → 5 个霓虹频段之一，用「色相 + 图标 + 下划线 + 边框」四重编码；
          空标签给中性灰「未分类」，不留白。
     ⚠ 核心不变量：同一个标签的色号必须恒定 —— 它是「紫色=代码」这种
       肌肉记忆得以成立的前提，也是本场景断言的重心。 */
  {
    const cssTxt = SRC.css || '';
    const viewsTxt = SRC.views || '';

    /* ---- O9-A：色号推导函数（在真实沙箱里执行，不只对源码做断行字符串匹配） ---- */
    const box = { NEONViews: null };
    try {
      new Function('window', 'document', 'console', viewsTxt)(
        box, { getElementById: function () { return null; } },
        { log: function () {}, warn: function () {}, error: function () {} });
    } catch (e) { /* 求值失败时 box.NEONViews 保持 null，下方断言会如实报红 */ }
    const V2 = box.NEONViews;

    /* 样本取自真实的线上标签（指南/代码/随笔/小说/检索）加上夹具里的英文标签。
       色号分布经实测为 {0:..,1:..,2:..,3:..}，覆盖 4 个频段。 */
    const TONE_SAMPLES = ['指南', '代码', '随笔', '小说', '检索',
      'test', 'legacy', 'draft', 'code', 'guide', 'essay', 'search'];

    T('O9 色标', 'R57 标签配色模块已导出', !!(V2 && typeof V2.tagTone === 'function' &&
      typeof V2.tagGlyph === 'function' && typeof V2.tagBadges === 'function'));

    if (V2 && typeof V2.tagTone === 'function') {
      /* 色号范围：必须落在 0..4。越界（如 t5）会让 data-tone 指向不存在的 CSS 规则，
         徽章静默褪成无色 —— 不报错、只是"看不出区别"，是最难被发现的一类坏。

         ⚠ 不能只抽查一批样本就完事：曾实测「色号 +1」这种越界写法，
           12 个样本恰好没有一个落到 4，抽样断言照样全绿（漏检！）。
           所以改为「程序化穷举 + 数学性质」双管齐下：
             ① 穷举 0..TAG_TONES-1 必须全部可达（保证不会少给）
             ② 穷举 0..TAG_TONES+20 必须一个都不出现（保证不会多给）
           输入空间按 TONE_SAMPLES 组合，只要实现里出现 %N 之外的算术偏移，
           总有一个输入会暴露。 */
      const rangeProbe = [];
      TONE_SAMPLES.forEach(function (a) {
        TONE_SAMPLES.forEach(function (b) {
          rangeProbe.push(a, a + b, b + a, a + '#' + b, String(a).repeat(3));
        });
      });
      const probeTones = rangeProbe.map(V2.tagTone);
      const outOfRange = probeTones.filter(function (t) {
        return !Number.isInteger(t) || t < 0 || t > 4;
      });
      T('O9 色标', 'R57b 色号恒落在 0..4（穷举 ' + rangeProbe.length + ' 个输入验证）',
        outOfRange.length === 0,
        outOfRange.length ? '越界 ' + outOfRange.slice(0, 5).join(',') : '全部合法');

      /* 5 个色号都必须真的可达 —— 若实现写成 %3，t3/t4 永远拿不到，
         等于 2 个频段形同虚设，而上面的"不越界"检查完全看不出来。 */
      const reachable = new Set(probeTones);
      T('O9 色标', 'R57b2 5 个色号全部可达（无死频段）',
        reachable.size === 5,
        '可达 ' + Array.from(reachable).sort().join(','));

      /* 稳定性的两种破坏方式都要挡住：
         ① 每次调用结果不同（用了随机数 / Date.now）
         ② 依赖调用顺序（用了全局计数器或"上次结果"） */
      let stable = true;
      const firstPass = TONE_SAMPLES.map(V2.tagTone);
      for (let round = 0; round < 50; round++) {
        TONE_SAMPLES.forEach(function (t, i) { if (V2.tagTone(t) !== firstPass[i]) stable = false; });
      }
      T('O9 色标', 'R57c 同一标签恒得同一色号（50 轮复算不漂移）', stable);

      /* 顺序无关：换个顺序问，答案必须一样 ——
         这正是「不用 出现顺序%5」的理由，也是最容易被写错的破口（见 R57n 的反向验证） */
      const orderFree = TONE_SAMPLES.slice().reverse().every(function (t) {
        return V2.tagTone(t) === firstPass[TONE_SAMPLES.indexOf(t)];
      });
      T('O9 色标', 'R57d 色号与调用顺序无关（反序询问结果不变）', orderFree);

      /* 色号必须有区分力：全挤在一个色号上等于没区分 */
      const spread = new Set(firstPass);
      T('O9 色标', 'R57e 样本标签覆盖到多个频段（不是全同色）',
        spread.size >= 3, '命中 ' + spread.size + ' / 5 个频段');

      /* 图标与色号必须同源：否则色盲用户拿到的图标和颜色说的不是同一件事。
         判据是"色号相同 ⟺ 图标相同"这个双向蕴含，不是简单比对长度。 */
      const glyphs = TONE_SAMPLES.map(V2.tagGlyph);
      const glyphByTone = {};
      let glyphConsistent = true;
      TONE_SAMPLES.forEach(function (t, i) {
        const k = firstPass[i];
        if (glyphByTone[k] === undefined) glyphByTone[k] = glyphs[i];
        else if (glyphByTone[k] !== glyphs[i]) glyphConsistent = false;
      });
      T('O9 色标', 'R57f 图标与色号同源（同色号必同图标）', glyphConsistent);

      /* 图标不能是空串 —— 空图标等于把「非色彩通道」这条线悄悄抽掉 */
      T('O9 色标', 'R57g 每个频段都有非空图标（色彩之外的识别通道）',
        glyphs.every(function (g) { return typeof g === 'string' && g.trim().length > 0; }),
        glyphs.join(' '));

      /* ---- O9-B：徽章渲染 ---- */
      const multi = V2.tagBadges(['code', 'guide']);
      T('O9 色标', 'R57h 徽章输出 data-tone 供 CSS 取色',
        (multi.match(/data-tone="t[0-4]"/g) || []).length === 2,
        multi.slice(0, 80));
      T('O9 色标', 'R57i 徽章是指向标签筛选页的链接',
        /<a class="tag-badge"[^>]*href="#\/tag\/code"/.test(multi));

      /* 空标签必须显式给身份（线上 id=4 的文章 tags 就是 []） */
      const none = V2.tagBadges([]);
      T('O9 色标', 'R57j 空标签渲染为「未分类」（不留白）',
        /tag-badge-none/.test(none) && /未分类/.test(none), none);
      T('O9 色标', 'R57k 未分类不占用任一频段编号（它没有频段）',
        !/data-tone/.test(none));
      T('O9 色标', 'R57l null / undefined / 纯空白标签同样归入未分类',
        /未分类/.test(V2.tagBadges(null)) && /未分类/.test(V2.tagBadges(undefined)) &&
        /未分类/.test(V2.tagBadges(['', '  '])));
      T('O9 色标', 'R57m 脏数据（字符串而非数组）不抛错（否则整页白掉）',
        (function () {
          try { return /data-tone/.test(V2.tagBadges('code')); } catch (e) { return false; }
        })());

      /* 同容器消歧：一条卡片挂两个撞号标签时，不得显示成同一个颜色
         —— 否则读者会以为它们是同一类。 */
      const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'];
      const byTone = {};
      pool.forEach(function (t) { (byTone[V2.tagTone(t)] = byTone[V2.tagTone(t)] || []).push(t); });
      const clash = Object.keys(byTone).filter(function (k) { return byTone[k].length >= 3; })[0];
      const clashTags = clash ? byTone[clash].slice(0, 3) : [];
      const clashHtml = V2.tagBadges(clashTags);
      const clashTones = (clashHtml.match(/data-tone="t([0-4])"/g) || []);
      T('O9 色标', 'R57n 同一条目内撞号标签自动顺延（颜色互不相同）',
        clashTags.length === 3 && new Set(clashTones).size === 3,
        clashTags.join('/') + ' → ' + clashTones.join(','));
      T('O9 色标', 'R57o 消歧只在容器内生效，不污染标签自身的恒定色',
        V2.tagBadges([clashTags[0]]).indexOf('t' + V2.tagTone(clashTags[0]) + '"') !== -1);

      /* XSS：标签名来自用户输入，必须转义后才进 HTML */
      const evil = V2.tagBadges(['<img src=x onerror=alert(1)>']);
      T('O9 色标', 'R57p 标签名转义后才进 HTML（无原始尖括号）',
        !/<img/.test(evil) && /&lt;img/.test(evil));

      /* ---- O9-C：标签总览按热度排名分配色号 ---- */
      const stats = { code: 5, guide: 3, essay: 3, search: 2, test: 1, legacy: 1, draft: 1 };
      const rm = V2.rankedTones(stats);
      T('O9 色标', 'R57q 热度最高者拿 t0',
        rm.code === 0, 'code → t' + rm.code);
      T('O9 色标', 'R57r 前 5 名色号互不重复',
        new Set([rm.code, rm.guide, rm.essay, rm.search, rm.draft]).size === 5,
        JSON.stringify(rm));
      T('O9 色标', 'R57s 排名分配是确定性的（同数据两次结果一致）',
        JSON.stringify(V2.rankedTones(stats)) === JSON.stringify(rm));
      T('O9 色标', 'R57t 超出 5 名者退回稳定哈希（不声称热度，但仍恒定）',
        rm.test === V2.tagTone('test') && rm.legacy === V2.tagTone('legacy'));
    } else {
      T('O9 色标', 'R57b-t 色号推导函数不可用（已由 R57 报红）', false, '跳过');
    }

    /* ---- O9-D：CSS 侧（颜色只定义一次，且全走变量） ---- */
    const badgeM = /\.tag-badge\s*\{([\s\S]*?)\}/.exec(cssTxt);
    T('O9 色标', 'R58 .tag-badge 规则存在', !!badgeM);
    T('O9 色标', 'R58b 5 个频段色号各有对应规则（t0..t4 齐全）',
      [0, 1, 2, 3, 4].every(function (i) {
        return new RegExp('\\.tag-badge\\[data-tone="t' + i + '"\\]').test(cssTxt);
      }));
    T('O9 色标', 'R58c 频段色号全部映射到站点既有变量（不引入新色相）',
      [0, 1, 2, 3, 4].every(function (i) {
        const m = new RegExp('\\.tag-badge\\[data-tone="t' + i + '"\\]\\s*\\{\\s*--tone:\\s*var\\(--(cyan|magenta|yellow|violet|green)\\)').exec(cssTxt);
        return !!m;
      }));
    /* 关键补强：光断言"每个 tN 都解析到某个合法变量"不够 ——
       把 t4 也写成 var(--cyan) 照样全绿，但 t0 与 t4 就变成同一个颜色，
       5 个频段实际只剩 4 个可区分（实测这个写法确实骗过了初版断言）。
       所以必须断言「5 个 tN 映射到 5 个互不相同的变量」。 */
    const badgeVarMap = [0, 1, 2, 3, 4].map(function (i) {
      const m = new RegExp('\\.tag-badge\\[data-tone="t' + i + '"\\]\\s*\\{\\s*--tone:\\s*var\\((--[\\w-]+)\\)').exec(cssTxt);
      return m ? m[1] : null;
    });
    T('O9 色标', 'R58c2 5 个频段映射到 5 个互不相同的变量（无撞色）',
      badgeVarMap.every(function (v) { return v !== null; }) &&
      new Set(badgeVarMap).size === 5,
      badgeVarMap.join(' '));
    /* 关键：不得硬编码霓虹色 —— 硬编码的 rgba/hex 不随主题变，亮色下刺眼 */
    const badgeHard = badgeM ? (badgeM[1].match(/#[0-9a-f]{3,8}|rgba?\(\s*\d/gi) || []) : [];
    T('O9 色标', 'R58d 色标本体无硬编码颜色（全走 --tone 变量）',
      badgeHard.length === 0, badgeHard.join(',') || '无');
    /* 色相之外的第二通道：图标 + 底边下划线（色盲/灰度下仍可区分） */
    T('O9 色标', 'R58e 色标含图标与底部下划线（非纯色彩编码）',
      !!badgeM && /\.tag-badge\s+\.tag-glyph/.test(cssTxt) &&
      /border-bottom\s*:\s*2px\s+solid\s+var\(--tone\)/.test(badgeM[1]));
    /* 未分类中性灰：必须也走变量，不能写死 #888 */
    const noneM = /\.tag-badge-none\s*\{([\s\S]*?)\}/.exec(cssTxt);
    T('O9 色标', 'R58f 未分类用中性灰变量（不占用 5 个频段）',
      !!noneM && /--tone:\s*var\(--text-dim\)/.test(noneM[1]));
    /* 归档条目级色标 */
    const itemM = /\.archive-item\s*\{([\s\S]*?)\}/.exec(cssTxt);
    T('O9 色标', 'R58g 归档条目有左侧色条（.archive-item::before + --tone）',
      /\.archive-item::before\s*\{[\s\S]*?background\s*:\s*var\(--tone\)/.test(cssTxt));
    T('O9 色标', 'R58h 归档条目 hover 底纹随频段色（不是写死的青）',
      !!itemM === false || /\.archive-item:hover\s*\{\s*background:\s*color-mix\(in srgb,\s*var\(--tone\)/.test(cssTxt),
      (/\.archive-item:hover\s*\{([^}]*)\}/.exec(cssTxt) || [, ''])[1].trim());
    /* 卡片标签也带频段色 —— 首页与归档页必须是同一套分类视觉 */
    T('O9 色标', 'R58i 卡片 .tag-chip 同样支持 data-tone（跨页一致）',
      [0, 1, 2, 3, 4].every(function (i) {
        return new RegExp('\\.tag-chip\\[data-tone="t' + i + '"\\]').test(cssTxt);
      }));
    T('O9 色标', 'R58j 无 data-tone 时回落幽紫（关于页装饰标签观感不变）',
      /\.tag-chip\s*\{[\s\S]*?--tone:\s*var\(--violet\)/.test(cssTxt));
    /* 标签总览 */
    T('O9 色标', 'R58k 标签总览 .tag-item 支持 data-tone（5 色频段）',
      [0, 1, 2, 3, 4].every(function (i) {
        return new RegExp('\\.tag-cloud \\.tag-item\\[data-tone="t' + i + '"\\]').test(cssTxt);
      }));
    T('O9 色标', 'R58l 标签总览已去掉写死的紫色 rgba(181,55,242)',
      !/\.tag-cloud \.tag-item\s*\{[\s\S]{0,400}?rgba\(181,\s*55,\s*242/.test(cssTxt));

    /* ---- O9-E：亮色主题适配（用户明确要求浅色背景下同样清晰可辨） ----
       这里不能只断言"变量块里有这 5 个名字" —— 那太弱：
       色值再暗一个数量级也照样通过。真正要守的是可读性，所以要真算对比度。 */
    function hexToRgb(h) {
      const m = /^#([0-9a-f]{6})$/i.exec(String(h).trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function relLum(rgb) {
      const f = rgb.map(function (v) {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    }
    function contrast(a, b) {
      const la = relLum(a), lb = relLum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    /* O11 起，亮色变量表【只剩一份】（html[data-theme="light"]）。
       原先还有一份挂在 @media (prefers-color-scheme: light) 里，随"默认暗色"
       的改造被移除 —— 见 style.css 里的说明：那个 media 块本身就是 bug。
       这里保留数组结构（rather than 直接删一项），是为了让"少了一份"这件事
       被显式记录：若将来有人误加回媒体查询版本，下面 every() 的守门依然成立。 */
    const lightBlocks = [
      (/html\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(cssTxt) || [, ''])[1]
    ];
    const TONE_VARS = ['--cyan', '--magenta', '--yellow', '--violet', '--green'];

    /* 对每份亮色变量表，逐个频段算「色标文字色 vs 页面底色」的对比度。
       文字色不是 --tone 本身，而是 CSS 里的 --tone-ink：
         color-mix(in srgb, var(--tone) <比例>%, var(--text-bright))
       ⚠ 比例必须【从 CSS 里读】而不是在测试里写死常量 ——
         写死的话，有人把 CSS 的 82% 改成 100%（=直接用 --tone，青色掉到 4.46）
         这条断言照样全绿，等于白测。这是"钉常量"教训在相反方向的又一次复现：
         该钉的常量是 TAG_TONES 那种真·单一数据源，
         而"公式里掺多少"属于实现细节，必须现读现算。
       页面底色取 --bg-0（色标的 9% 同色底很淡，可近似为页面底色）。
       阈值取 WCAG AA 正文级 4.5:1。 */
    const inkMixM = /--tone-ink:\s*color-mix\(in srgb,\s*var\(--tone\)\s*([\d.]+)%,\s*var\(--text-bright\)\)/.exec(cssTxt);
    const inkPct = inkMixM ? parseFloat(inkMixM[1]) / 100 : NaN;
    function mixInk(toneRgb, inkRgb) {
      return toneRgb.map(function (v, i) {
        return Math.round(v * inkPct + inkRgb[i] * (1 - inkPct));
      });
    }

    const contrastReport = [];
    let contrastOk = !isNaN(inkPct);
    let worst = 99;
    if (isNaN(inkPct)) contrastReport.push('--tone-ink 公式缺失');
    lightBlocks.forEach(function (blk) {
      const bgHex = (/--bg-0\s*:\s*(#[0-9a-f]{6})/i.exec(blk) || [, null])[1];
      const inkHex = (/--text-bright\s*:\s*(#[0-9a-f]{6})/i.exec(blk) || [, null])[1];
      const bg = bgHex ? hexToRgb(bgHex) : null;
      const ink = inkHex ? hexToRgb(inkHex) : null;
      if (!bg || !ink) { contrastOk = false; return; }
      TONE_VARS.forEach(function (v) {
        const hex = (new RegExp(v + '\\s*:\\s*(#[0-9a-f]{6})', 'i').exec(blk) || [, null])[1];
        const rgb = hex ? hexToRgb(hex) : null;
        if (!rgb) { contrastOk = false; contrastReport.push(v + '=缺失'); return; }
        const c = contrast(bg, mixInk(rgb, ink));
        if (c < worst) worst = c;
        if (c < 4.5) { contrastOk = false; contrastReport.push(v + '=' + c.toFixed(2)); }
        else contrastReport.push(v + '=' + c.toFixed(1));
      });
    });
    const lightBg = (/--bg-0\s*:\s*(#[0-9a-f]{6})/i.exec(lightBlocks[0]) || [, '?'])[1];
    T('O9 色标', 'R59 亮色主题下 5 个频段墨色对底色对比度均 ≥ 4.5:1（WCAG AA）',
      contrastOk && lightBlocks.every(function (b) { return b.length > 0; }),
      '底色 ' + lightBg + ' · 掺入 ' + (isNaN(inkPct) ? '?' : Math.round(inkPct * 100) + '%') +
      ' · 最差 ' + (worst === 99 ? '?' : worst.toFixed(2)) + ' · ' + contrastReport.join(' '));

    /* 反向守门：若把 --tone-ink 改回直接用 --tone，青色会掉到 4.46 而失守。
       这条断言保证「公式本身」在 CSS 里存在，而不只是测试里算得漂亮。 */
    T('O9 色标', 'R59d 三处色标都用同一套墨色公式（--tone-ink 掺主体文字色）',
      (cssTxt.match(/--tone-ink:\s*color-mix\(in srgb,\s*var\(--tone\)\s*\d+%,\s*var\(--text-bright\)\)/g) || []).length >= 3,
      '出现 ' + ((cssTxt.match(/--tone-ink:/g) || []).length) + ' 处');

    /* color-mix 是派生半透明的唯一手段 —— 硬编码 rgba 不随主题变。
       注意排除 fallback 与注释干扰，只认规则体里真的用到的。 */
    const mixUses = (cssTxt.match(/color-mix\(in srgb,\s*var\(--tone\)/g) || []).length;
    T('O9 色标', 'R59b 色标的底色/边框由 --tone 派生（color-mix，随主题变）',
      mixUses >= 4, 'color-mix 使用 ' + mixUses + ' 处');

    /* 色相的判定：5 个频段必须是 5 个可分辨的色相，不能有两个是同一个色
       （比如把 --green 也写成青，肉眼就分不出来了）。 */
    const darkHues = TONE_VARS.map(function (v) {
      const hex = (new RegExp(v + '\\s*:\\s*(#[0-9a-f]{6})', 'i').exec((/^[\s\S]*?\n\}/.exec(cssTxt) || [''])[0]) || [, null])[1];
      const rgb = hex ? hexToRgb(hex) : null;
      if (!rgb) return -1;
      const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d === 0) return 0;
      let h;
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return Math.round(h * 60 + 360) % 360;
    });
    T('O9 色标', 'R59c 5 个频段色相彼此不同（不是同色重复）',
      new Set(darkHues).size === 5 && darkHues.every(function (h) { return h >= 0; }),
      darkHues.join('°'));

    /* ---- O9-F：端到端 —— 真实归档页每条都有可区分的标识 ---- */
    const ctx = bootDom({ url: 'https://x.test/#/archive' });
    await waitFor(function () { return ctx.doc.querySelectorAll('.archive-item').length > 0; }, 3000);

    const items = Array.prototype.slice.call(ctx.doc.querySelectorAll('.archive-item'));
    T('O9 色标', 'R60 归档页每条都有频段标识（不再只有标题+日期）',
      items.length > 0 && items.every(function (li) {
        return !!li.querySelector('.archive-badges .tag-badge, .archive-badges .tag-badge-none');
      }), items.length + ' 条');
    T('O9 色标', 'R60b 每条条目都带 data-tone（驱动左侧色条）',
      items.length > 0 && items.every(function (li) { return /^t[0-4]$/.test(li.getAttribute('data-tone') || ''); }),
      items.map(function (li) { return li.getAttribute('data-tone'); }).join(','));

    /* 这些是用户可见的文字必须真的在页面上（不是只在源码里） */
    const bodyTxt = ctx.doc.body.textContent || '';
    T('O9 色标', 'R60c 标签文字已渲染到页面', /code/.test(bodyTxt) && /guide/.test(bodyTxt));
    T('O9 色标', 'R60d 图标已渲染到页面（非色彩识别通道真的存在）',
      items.length > 0 && items.every(function (li) {
        const g = li.querySelector('.tag-badge .tag-glyph');
        return g && g.textContent.trim().length > 0;
      }));

    /* 关键回归：同一条目内不得出现两个同色徽章（否则读不出"这两个是不同类"） */
    const dupInItem = items.filter(function (li) {
      const ts = Array.prototype.map.call(li.querySelectorAll('.tag-badge[data-tone]'), function (b) {
        return b.getAttribute('data-tone');
      });
      return new Set(ts).size !== ts.length;
    });
    T('O9 色标', 'R60e 页面上同一条目内无重复色号',
      dupInItem.length === 0, dupInItem.length + ' 条冲突');

    /* 跨条目稳定：同一标签在页面任何位置都是同一色号。
       这是整个方案的地基 —— 也是唯一能挡住"按顺序取色"实现的断言。 */
    const toneByTag = {};
    let crossStable = true;
    Array.prototype.forEach.call(ctx.doc.querySelectorAll('.tag-cloud .tag-item[data-tone], .tag-badge[data-tone]'), function (el) {
      const name = (el.textContent || '').replace(/[◆▲■⬢●◇×\d\s#]/g, '');
      const tone = el.getAttribute('data-tone');
      if (!name) return;
      if (toneByTag[name] === undefined) toneByTag[name] = tone;
      else if (toneByTag[name] !== tone) crossStable = false;
    });
    T('O9 色标', 'R60f 同一标签跨条目/跨组件恒为同一色号',
      crossStable, Object.keys(toneByTag).map(function (k) { return k + '=' + toneByTag[k]; }).join(' '));

    /* CSP：零内联事件属性 —— 色标是链接，不得中途改用 onclick */
    T('O9 色标', 'R60g 色标不含内联事件属性（CSP 下会被直接拦死）',
      !/tag-badge[^>]*\son[a-z]+=/i.test(SRC.views));
    ctx.dom.window.close();
  }

  /* ---- O10：bump 改号模式（--renumber）----
     背景：本轮要把一个【已 bump 但从未发布】的号改掉（2.1.0 → 2.0.2）。
     原校验「新号必须 > 本地 BUILD」会误拦这个合法操作，
     但它守的那条不变量是对的，不能简单删掉。故新增 --renumber：
     改与【已发布版本】比对，并要求调用者显式声明线上版本。

     这个场景不跑真实 bump（会写盘），而是把 bump.js 的校验函数抠出来实测 ——
     与本项目既有的做法一致（把工具脚本写成「导出函数 + CLI」正是为此）。
     关键在于：新机制必须比旧机制【不更弱】，所以既要验放行路径，
     也要验它仍然拦住所有该拦的（已用过的号 / 缺基准 / 基准格式错）。 */
  {
    const bumpSrc = SRC.bump || '';

    /* ⚠ 教训：这里最初写的是 /--renumber/.test(bumpSrc) ——
       看着像个断言，实际上是个摆设：用法说明、注释、错误提示里都含这个词，
       把选项解析那一行删掉它照样绿（实测确认）。
       断言必须钉【可执行结构】，不能钉【文本里出现过的词】。 */
    T('O10 改号', 'R61 --renumber / --published 已接进参数解析（不只是写了文档）',
      /a === '--renumber'\)\s*out\.renumber\s*=\s*true/.test(bumpSrc) &&
      /a\.startsWith\('--published='\)\)\s*out\.published\s*=\s*a\.slice/.test(bumpSrc),
      'renumber=' + /a === '--renumber'\)\s*out\.renumber\s*=\s*true/.test(bumpSrc) +
      ' published=' + /a\.startsWith\('--published='\)\)\s*out\.published\s*=\s*a\.slice/.test(bumpSrc));

    /* 同上：常规模式的守卫必须【仍然存在且未被改写为无条件分支】。
       写成精确匹配 + 反向排除「去掉 !args.renumber 前缀」的改写。 */
    T('O10 改号', 'R61b 常规模式守卫存在，且仍受 !args.renumber 约束',
      /if\s*\(\s*!args\.renumber\s*&&\s*cur\.build\s*&&\s*cmpVer\(args\.version,\s*cur\.build\)\s*<=\s*0\)/.test(bumpSrc) &&
      /'      版本号必须递增/.test(bumpSrc),
      '含 !args.renumber 前缀: ' + /if\s*\(\s*!args\.renumber\s*&&\s*cur\.build/.test(bumpSrc));

    T('O10 改号', 'R61c 改号模式以「已发布版本」为基准',
      /args\.renumber\s*\?\s*args\.published\s*:\s*cur\.build/.test(bumpSrc),
      (/const\s+compareBase[^;]*/.exec(bumpSrc) || [''])[0]);

    /* 三条拒绝路径必须都在：缺基准 / 基准格式错 / 新号未超过已发布版本 */
    T('O10 改号', 'R61d 改号缺 --published 时拒绝执行',
      /--renumber 必须同时给出 --published/.test(bumpSrc));
    T('O10 改号', 'R61e --published 格式非 x.y.z 时拒绝',
      /--published 必须是 x\.y\.z 形式/.test(bumpSrc));
    T('O10 改号', 'R61f 目标号未超过已发布版本时拒绝（防复用已用过的缓存键）',
      /cmpVer\(args\.version,\s*args\.published\)\s*<=\s*0/.test(bumpSrc) &&
      /改号也不允许用回已发布过的号/.test(bumpSrc));

    /* 拒绝路径必须发生在写盘之前 —— 否则会留下改了一半的文件 */
    const writeIdx = bumpSrc.indexOf('fs.writeFileSync(VERSION_JS, newVer');
    const guardIdx = bumpSrc.indexOf('args.renumber ? args.published : cur.build');
    T('O10 改号', 'R61g 全部校验都在写盘之前（不产生半成品文件）',
      guardIdx !== -1 && writeIdx !== -1 && guardIdx < writeIdx,
      'guard@' + guardIdx + ' < write@' + writeIdx);

    /* 版本单一数据源：package.json 的 version 不许长期漂移 */
    const pkgM = /"version"\s*:\s*"([^"]+)"/.exec(SRC.pkg || '');
    const buildM = /BUILD:\s*'([^']+)'/.exec(SRC.ver || '');
    T('O10 改号', 'R61h package.json 版本与 version.js 的 BUILD 一致',
      !!pkgM && !!buildM && pkgM[1] === buildM[1],
      'package.json=' + (pkgM ? pkgM[1] : '?') + ' vs BUILD=' + (buildM ? buildM[1] : '?'));
    /* 2.1.0：bump.js 现在负责同步 package.json。
       否则每次 bump 后必然踩 R61h 报红、得手动补一处 —— 
       工具的职责是"把该改的改全"，不是"改一半剩下的让人记"。 */
    T('O10 改号', 'R61j bump.js 会把 package.json 的 version 一并同步',
      /PKG_JSON/.test(SRC.bump || '') &&
      /package\.json/.test(SRC.bump || '') &&
      /writeFileSync\(PKG_JSON/.test(SRC.bump || ''));

    /* 已发布的号不许出现在 LOG 里两次（改号若忘了删旧条目就会重复） */
    const logVersions = (SRC.ver.match(/version:\s*'([^']+)'/g) || []).map(function (s) {
      return s.replace(/version:\s*'/, '').replace(/'$/, '');
    });
    const dupLog = logVersions.filter(function (v, i) { return logVersions.indexOf(v) !== i; });
    T('O10 改号', 'R61i 工程日志无重复版本号（改号后旧条目已清理）',
      dupLog.length === 0, dupLog.join(',') || '无重复');
  }

  /* ---- O11：暗色优先（默认暗色 + 首绘前定色 + 不依赖系统） ---- */
  {
    const css = SRC.css || '';
    const html = SRC.html || '';
    const tboot = SRC.themeBoot || '';
    /* 同上：源码注释里会引用被移除的写法与"NEON 还没加载"的说明，
       扫之前一律先剥注释，否则说明文字会把断言判红。 */
    const cssBare = stripComments(css);
    const tbootBare = stripComments(stripJsLineComments(tboot));

    /* ---- 静态结构 ---- */
    T('O11 暗色优先', 'R62 CSS 中已无任何 prefers-color-scheme 分支（不再跟随系统）',
      !/prefers-color-scheme/.test(cssBare),
      (cssBare.match(/prefers-color-scheme/g) || []).length + ' 处');
    T('O11 暗色优先', 'R62b 亮色变量表仍在（手动切换没被误删）',
      /html\[data-theme="light"\]\s*\{[\s\S]*?--bg-0:\s*#eef2f8/.test(cssBare));
    T('O11 暗色优先', 'R62c 暗色是 :root 默认（无属性即暗色，无需额外规则）',
      /:root\s*\{[\s\S]*?--bg-0:\s*#04060d/.test(cssBare));

    /* 引导脚本必须【同步】且【在样式表之前】，否则会先暗后亮闪一帧 */
    const bootIdx = html.indexOf('js/theme-boot.js');
    const cssIdx = html.indexOf('css/style.css');
    const bootTag = /<script(?![^>]*\b(?:defer|async)\b)[^>]*src="js\/theme-boot\.js[^"]*"[^>]*>/.exec(html);
    T('O11 暗色优先', 'R63 index.html 引入了 theme-boot.js', bootIdx !== -1);
    T('O11 暗色优先', 'R63b 引导脚本是【同步】脚本（无 defer/async）—— 否则赶不上首绘',
      !!bootTag, bootTag ? '命中同步标签' : (/(theme-boot\.js)/.test(html) ? '存在但带 defer/async' : '未引入'));
    T('O11 暗色优先', 'R63c 引导脚本排在样式表之前（CSS 生效前已定色）',
      bootIdx !== -1 && cssIdx !== -1 && bootIdx < cssIdx,
      'boot@' + bootIdx + ' css@' + cssIdx);
    T('O11 暗色优先', 'R63d 引导脚本带版本查询串（跟 ?v= 一起失效缓存）',
      /src="js\/theme-boot\.js\?v=[0-9.]+"/.test(html));
    /* CSP 硬约束：script-src 无 'unsafe-inline'，引导脚本绝不能是内联的 */
    T('O11 暗色优先', 'R63e 引导脚本是外部文件而非内联（CSP 会拦死内联）',
      /<script(?![^>]*src=)[^>]*>[\s\S]*?neon_theme[\s\S]*?<\/script>/.test(html) === false);
    T('O11 暗色优先', 'R63f 引导脚本零依赖（不引用 NEON/NEONViews/V() 等尚未加载的全局）',
      !/\bwindow\.NEON\b|\bNEONViews\b|\bNEON\(\)/.test(tbootBare));
    /* ⚠ 此处原本有一条 R63g「引导脚本有 try/catch 结构」，已在 D3 批次【删除】。
       它是典型的弱断言：把 catch 体改成 `if (false) {}` 照样绿，
       甚至把 catch 整段删掉、只留 try 也绿 —— 因为它只数"文本里有没有这两个词"。
       真正守行为的是下面 R64f/R64g：真让 localStorage 抛错，再看 <html> 落成什么。
       （已反向验证：把 theme-boot.js 的 try/catch 整段去掉，R64f 立刻报红。）
       留此注释是防止后人把它当作"漏测"又加回来 —— 加回来只会稀释断言强度。 */
    T('O11 暗色优先', 'R63h 引导脚本只用 same-origin 相对路径（无外域请求）',
      !/https?:\/\//.test(tbootBare));

    /* ---- 运行时：真跑 theme-boot.js（不是重写一份逻辑） ---- */
    /* 场景①：从未选择过 → 首绘瞬间就该是暗色。
       2.1.0 起引导脚本对"默认"也【显式】打 data-theme="dark"
       （此前是不打属性、靠 :root 兜底）。视觉结果一致，
       但显式态可被直接读取断言 —— 首绘定色不该依赖"某属性恰好没被设置"。 */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64 无存储记录时首绘前即为暗色',
        attr === 'dark' || attr === null, String(attr));
      c.dom.window.close();
    }
    /* 场景②：曾手动选亮色 → 首绘前就必须打上 light（这一条就是"零闪烁"的本质） */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'light' } });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64b 存了 light 时首绘前即打上 data-theme="light"（无先暗后亮）',
        attr === 'light', String(attr));
      c.dom.window.close();
    }
    /* 场景③：曾手动选暗色 → 明确打上 dark */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'dark' } });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64c 存了 dark 时首绘前即打上 data-theme="dark"',
        attr === 'dark', String(attr));
      c.dom.window.close();
    }
    /* 场景④：脏数据 → 不能崩，也不该错判成亮色。
       2.1.0 起显式落成 dark，故允许 dark 或无属性（都是暗色语义）。 */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'BLUE' } });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64d 存储值非法时按暗色处理（不误判为亮色）',
        attr === null || attr === 'dark', String(attr));
      c.dom.window.close();
    }
    /* 场景⑤：'auto' 是已废弃的存量值（2.1.0 两态收口）。
       它必须落成暗色 —— 既不能崩、也不能因"曾经有效"而错判成亮色。
       归一化的完整行为由 O16 的 R77 系列覆盖，这里只守"不亮"。 */
    {
      const c = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'auto' } });
      const attr = c.doc.documentElement.getAttribute('data-theme');
      T('O11 暗色优先', 'R64e 存量 auto 值不崩、不误判为亮色（auto 已收口为暗色）',
        attr === null || attr === 'dark', String(attr));
      c.dom.window.close();
    }
    /* 场景⑥：存储被禁用（隐私模式）—— 引导脚本必须静默降级为暗色。
       ⚠ 这条是「行为」断言而非「源码里有 try/catch」那种结构断言：
         结构断言会被 `if (false)` 之类的等价改写骗过（实测过），
         必须真让 localStorage 抛错、再看 <html> 落成什么。 */
    {
      let threw = null, attr = '?';
      try {
        const c = bootDom({ themeBoot: true, themeBootOnly: true, breakStorage: true });
        attr = c.doc.documentElement.getAttribute('data-theme');
        c.dom.window.close();
      } catch (e) { threw = e; }
      T('O11 暗色优先', 'R64f 存储被禁用时不抛异常（隐私模式下不崩）',
        threw === null, threw ? String(threw.message) : '未抛错');
      T('O11 暗色优先', 'R64g 存储被禁用时降级为暗色（不带属性 = :root 兜底）',
        attr === null || attr === 'dark', String(attr));
    }

    /* ---- 端到端：整站启动后仍是暗色，且手动切换 + 持久化不被破坏 ---- */
    {
      const c = bootDom({ captureConsole: true });
      await waitFor(() => !!c.doc.getElementById('btn-theme'), 3000);
      await new Promise(r => setTimeout(r, 120));
      const btn2 = c.doc.getElementById('btn-theme');
      T('O11 暗色优先', 'R65 整站启动后仍是暗色（默认未被系统或存储改写）',
        c.doc.documentElement.getAttribute('data-theme') === 'dark',
        String(c.doc.documentElement.getAttribute('data-theme')));

      /* 手动切到亮色 → 属性生效 */
      btn2.click();
      await new Promise(r => setTimeout(r, 60));
      T('O11 暗色优先', 'R65b 手动切到亮色后属性变为 light',
        c.doc.documentElement.getAttribute('data-theme') === 'light',
        String(c.doc.documentElement.getAttribute('data-theme')));
      T('O11 暗色优先', 'R65c 用户选择已持久化到 localStorage',
        c.w.localStorage.getItem('neon_theme') === 'light',
        String(c.w.localStorage.getItem('neon_theme')));

      /* 关键回归：此时「重新打开页面」（新 dom + 预置同一存储）应直接是亮色，
         而不是先暗一帧 —— 这正是 R64b 覆盖的路径，这里从端到端再确认一次。 */
      const c2 = bootDom({ themeBoot: true, themeBootOnly: true, storage: { neon_theme: 'light' } });
      T('O11 暗色优先', 'R65d 重开后首绘前即恢复用户选择的亮色（偏好持久化生效）',
        c2.doc.documentElement.getAttribute('data-theme') === 'light',
        String(c2.doc.documentElement.getAttribute('data-theme')));
      c2.dom.window.close();
      c.dom.window.close();
    }
  }

  /* ---- O12：C13 尊重 prefers-reduced-motion ---- */
  {
    const cssRaw = SRC.css || '';
    /* 同 O11：注释里会大段说明"为什么这么做"，扫之前一律剥注释 */
    const cssBare = stripComments(cssRaw);

    /* --- 静态结构：块必须存在，且必须在文件末尾（靠层叠顺序覆盖前文） --- */
    const rmIdx = cssBare.indexOf('@media (prefers-reduced-motion: reduce)');
    T('O12 减少动效', 'R66 CSS 含 @media (prefers-reduced-motion: reduce) 块',
      rmIdx !== -1, rmIdx === -1 ? '未找到' : 'offset ' + rmIdx);
    T('O12 减少动效', 'R66b 该块位于样式表末尾（层叠顺序才能压过前面的规则）',
      rmIdx !== -1 && rmIdx > cssBare.length * 0.8,
      rmIdx === -1 ? '未找到' : Math.round(rmIdx / cssBare.length * 100) + '% 处');

    /* 截出该块内容，后面的断言只在这个块内找 —— 否则会误命中块外的同名规则 */
    /* D3：花括号配平统一走 common.js 的 cssBlockAt（O13/O17 共用同一份实现）。
       原实现在这里内联了一遍 —— 拆分后若各写各的，判据漂移无人察觉。 */
    const block = rmIdx !== -1 ? cssBlockAt(cssBare, rmIdx) : '';

    /* --- 块内必须真的关掉了方案点名的几项动画 ---
       注意：不能只断言"块存在"。整块写空 `{}` 也能过第一层，
       故逐项断言关键属性确实出现在【块内】。 */
    T('O12 减少动效', 'R66c 扫描线被关闭（.scanlines → display:none）',
      /\.scanlines\s*\{[^}]*display:\s*none/.test(block),
      block ? '' : '块为空');
    T('O12 减少动效', 'R66d 加载跑马灯被停（.loading-bar → animation:none）',
      /\.loading-bar\s*\{[^}]*animation:\s*none/.test(block));
    T('O12 减少动效', 'R66e 打字光标闪烁被停（.type-cursor → animation:none）',
      /\.type-cursor::after\s*\{[^}]*animation:\s*none/.test(block));
    T('O12 减少动效', 'R66f Logo 故障抖动被停（.logo:hover .logo-mark → animation:none）',
      /\.logo:hover\s+\.logo-mark[^{]*\{[^}]*animation:\s*none/.test(block));
    T('O12 减少动效', 'R66g 三档时长变量在块内归零（--t-fast/normal/slow）',
      /--t-fast:\s*0\.001ms/.test(block) &&
      /--t-normal:\s*0\.001ms/.test(block) &&
      /--t-slow:\s*0\.001ms/.test(block));
    T('O12 减少动效', 'R66h 通配兜底把 transition-duration 全局归零',
      /\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition-duration:\s*0\.001ms/.test(block));
    T('O12 减少动效', 'R66i 平滑滚动改回瞬时（html → scroll-behavior:auto）',
      /html\s*\{[^}]*scroll-behavior:\s*auto/.test(block));

    /* --- 反向保护：不能把 fadein 之类"承担可见性职责"的动画整个 none 掉 ---
       @keyframes fadein 的 to 才是 opacity:1；若把 .post-card 的 animation
       置为 none，元素会停在初始的 opacity:0 = 内容永久不可见。
       故此处【禁止】出现 `.post-card { ... animation: none }` 这种写法。 */
    T('O12 减少动效', 'R66j 位移动画只压时长不禁用（避免元素停在 opacity:0）',
      !/\.post-card\s*\{[^}]*animation:\s*none/.test(block) &&
      !/\.toast\s*\{[^}]*animation:\s*none/.test(block) &&
      !/\.modal\s*\{[^}]*animation:\s*none/.test(block));
    T('O12 减少动效', 'R66k 位移动画确有压缩时长与次数（.post-card/.modal/.toast）',
      /\.post-card,\s*\.modal,\s*\.toast,\s*\.toast\.hide\s*\{[^}]*animation-duration/.test(block));

    /* --- 全局副作用守卫：该块不得削弱主题变量表 ---
       同理于 O11 的教训：不能为了停动画把亮色变量一起删掉。 */
    T('O12 减少动效', 'R66l 该块未误伤主题变量表（亮色 --bg-0 仍在块外）',
      /html\[data-theme="light"\]\s*\{[\s\S]*?--bg-0:\s*#eef2f8/.test(cssBare) &&
      !/--bg-0/.test(block));

    /* --- 全站时长收敛：transition 不应再有裸写的 .x s 时长（除 0.001ms 兜底） --- */
    const bareDurations = (cssBare.match(/transition:[^;}]*?(?<![\w-])\d*\.?\d+s(?![a-z])/g) || []);
    T('O12 减少动效', 'R66m 正文 transition 时长已全部收敛到 --t-* 变量',
      bareDurations.length === 0,
      bareDurations.length ? bareDurations.slice(0, 2).join(' | ') : '无裸时长');

    /* --- 变量本身必须存在（收敛的前提） --- */
    const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(cssBare);
    const rootVars = rootBlock ? rootBlock[1] : '';
    T('O12 减少动效', 'R66n :root 定义了 --t-fast/--t-normal/--t-slow 三档',
      /--t-fast:/.test(rootVars) && /--t-normal:/.test(rootVars) && /--t-slow:/.test(rootVars));

    /* --- 运行时：块内规则能被真实 CSS 引擎解析（不是靠正则自欺） ---
       正则能验证"文本里有这些字样"，但验证不了"浏览器真能读懂它"——
       一个漏掉的括号就会让整块规则被引擎静默丢弃，而正则照样全绿。
       故这里把块交给 jsdom 的真实 CSS 解析器，读回子规则数与选择器。

       ⚠ 踩坑记录（实测得出）：jsdom 解析器遇到**孤立的 `}`**（未配对的闭合括号）
       会把后续所有内容降级成普通 CSSStyleRule —— 即 `{ display:none }` 被当成声明
       而不是规则体。而 stripComments() 剥走注释后，`@media` 前面恰好残留着
       上一条规则的 `}` 与空白。直接把 `slice(i, end+1)`（只有块体）喂进去，
       必然报 "Could not parse CSS stylesheet"。
       故这里【从块体的第一个块内容开始构造】，前面不携带任何前导括号。
       注意 jsdom 只解析样式表；@media 是否命中（媒体特性）不在此覆盖范围 ——
       本条守的是"语法可解析"，不是"媒体查询生效"。 */
    {
      const c = bootDom({});
      const style = c.doc.createElement('style');
      /* block 是 `{...}` 形态，前缀上 @media 条件即可得到语法完整的样式表，
         不带任何前导 `}`，避免触发上面那个降级行为。 */
      style.textContent = '@media (prefers-reduced-motion: reduce) ' + block;
      c.doc.head.appendChild(style);

      /* 只认我们自己刚插入的这张表，避免被 head 里已有的样式干扰 */
      let mediaRule = null;
      try {
        const sheets = c.doc.styleSheets;
        for (let i = 0; i < sheets.length; i++) {
          const rs = sheets[i].cssRules || [];
          for (let j = 0; j < rs.length; j++) {
            if (rs[j].media && String(rs[j].media.mediaText).indexOf('prefers-reduced-motion') !== -1) {
              mediaRule = rs[j];
              break;
            }
          }
          if (mediaRule) break;
        }
      } catch (e) { /* 解析异常按失败处理，下方断言会报红 */ }

      const inner = mediaRule && mediaRule.cssRules ? Array.prototype.slice.call(mediaRule.cssRules) : [];
      const sels = inner.map(function (r) { return r.selectorText || ''; }).join(' | ');
      T('O12 减少动效', 'R66o 块内容被 CSS 引擎成功解析（无语法错误导致整块丢弃）',
        !!mediaRule && inner.length > 0,
        mediaRule ? inner.length + ' 条子规则' : '未解析出 media 规则');
      /* 更进一步：三条最关键的规则必须真的被引擎认到（不是正则幻觉） */
      T('O12 减少动效', 'R66p 引擎确实认出了 .scanlines / .loading-bar / 通配兜底三条',
        inner.some(function (r) { return (r.selectorText || '').indexOf('.scanlines') !== -1; }) &&
        inner.some(function (r) { return (r.selectorText || '').indexOf('.loading-bar') !== -1; }) &&
        inner.some(function (r) { return /^\*/.test(r.selectorText || ''); }),
        sels.slice(0, 120));
      c.dom.window.close();
    }
  }

  /* ---- O13：C10 键盘可达 ---- */
  {
    const html = SRC.html || '';
    const cssBare = stripComments(SRC.css || '');
    const keysBare = stripComments(stripJsLineComments(SRC.keys || ''));

    /* --- 结构：跳转链接与帮助面板容器 --- */
    T('O13 键盘可达', 'R67 index.html 含「跳到主内容」跳转链接',
      /class="skip-link"[^>]*href="#app"/.test(html));
    T('O13 键盘可达', 'R67b 跳转链接是页面首个可聚焦元素（排在其他内容之前）',
      html.indexOf('skip-link') < html.indexOf('<header class="topbar"'));
    T('O13 键盘可达', 'R67c 主内容容器带 tabindex="-1"（可被编程聚焦）',
      /<main[^>]*id="app"[^>]*tabindex="-1"/.test(html));
    T('O13 键盘可达', 'R67d 顶部导航带 aria-label（读屏可识别为「主导航」）',
      /<nav[^>]*id="nav"[^>]*aria-label=/.test(html));
    T('O13 键盘可达', 'R67e 快捷键帮助面板容器为 role="dialog" + aria-modal',
      /id="kbd-help"[^>]*role="dialog"/.test(html) && /id="kbd-help"[^>]*aria-modal="true"/.test(html));

    /* --- CSS：焦点可见性 --- */
    /* ⚠ 这条断言踩过一次假绿（已修复，记在这里防回退）：
       最初写成 /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--cyan\)/，
       看似精确，实则会被**别处的** .search-input:focus-visible 等规则命中 ——
       把裸 :focus-visible 整条删掉，测试依然全绿。
       现在改为：先切出选择器恰好等于 ":focus-visible" 的那条规则体，再查它内部，
       保证守的是"全站兜底焦点环"这一条本身，而不是任何一条带 focus-visible 后缀的规则。 */
    const globalFocusRule = (function () {
      /* 裸 :focus-visible 规则：行首（允许前导空白）就是 ":focus-visible" 后跟 "{"。
         不能写成子串匹配 —— .search-input:focus-visible 也含该子串，
         会造成"改了兜底规则测试却仍绿"的假绿（实测验证过）。 */
      const m = /^[ \t]*:focus-visible\s*\{/m.exec(cssBare);
      /* D3：同上，配平逻辑统一走 common.js */
      return m ? cssBlockAt(cssBare, m.index) : '';
    })();

    T('O13 键盘可达', 'R68 CSS 定义了裸 :focus-visible 全站兜底焦点环',
      globalFocusRule !== '' && /outline:\s*2px solid var\(--cyan\)/.test(globalFocusRule),
      globalFocusRule ? '命中规则体' : '未找到裸 :focus-visible 规则');
    T('O13 键盘可达', 'R68a 兜底焦点环带 outline-offset（贴边元素也能看清）',
      /outline-offset:\s*\dpx/.test(globalFocusRule));
    /* 反向保护：绝不能"为了让焦点环更干净"而全局干掉 outline。
       这是无障碍最常见的破坏方式（去掉 outline 却不给替代）。 */
    T('O13 键盘可达', 'R68b CSS 未出现全局 outline:none（只在有替代方案的具体元素上）',
      !/\*\s*\{[^}]*outline:\s*none/.test(cssBare));
    T('O13 键盘可达', 'R68c 编辑器正文焦点环交由容器 :focus-within 承担',
      /#editor-textarea:focus-visible\s*\{\s*outline:\s*none/.test(cssBare) &&
      /\.editor-pane:focus-within/.test(cssBare));
    T('O13 键盘可达', 'R68d 跳转链接平时视觉隐藏、聚焦时显现',
      /\.skip-link\s*\{[^}]*left:\s*-9999px/.test(cssBare) &&
      /\.skip-link:focus\s*\{[^}]*left:\s*12px/.test(cssBare));

    /* --- 运行时：真派发 KeyboardEvent，验证行为而非源码字样 --- */
    const kc = bootDom({ captureConsole: true });
    await waitFor(() => !!kc.doc.getElementById('btn-theme'), 3000);
    await new Promise(r => setTimeout(r, 120));

    T('O13 键盘可达', 'R69 keys.js 已加载并暴露 NEONKeys',
      typeof kc.w.NEONKeys === 'object' && typeof kc.w.NEONKeys.handleKey === 'function');

    /* 派发键事件的助手：target 默认挂在 body 上（非输入态） */
    function press(key, opts) {
      opts = opts || {};
      const ev = new kc.w.KeyboardEvent('keydown', {
        key: key, bubbles: true, cancelable: true,
        shiftKey: !!opts.shift, ctrlKey: !!opts.ctrl, metaKey: !!opts.meta, altKey: !!opts.alt
      });
      const t = opts.target || kc.doc.body;
      t.dispatchEvent(ev);
      return ev;
    }

    /* Esc / 修饰键放行 */
    T('O13 键盘可达', 'R69b Ctrl/Cmd 组合键不被拦截（不抢浏览器快捷键）',
      kc.w.NEONKeys.handleKey({ key: 'k', ctrlKey: true, target: kc.doc.body }) === false &&
      kc.w.NEONKeys.handleKey({ key: 's', metaKey: true, target: kc.doc.body }) === false);
    T('O13 键盘可达', 'R69c Alt 组合键不被拦截',
      kc.w.NEONKeys.handleKey({ key: 'Tab', altKey: true, target: kc.doc.body }) === false);

    /* 输入态豁免 —— 这条最容易被实现者忽略，也最容易伤用户 */
    {
      const input = kc.doc.createElement('input');
      kc.doc.body.appendChild(input);
      T('O13 键盘可达', 'R69d 输入框内打 "/" 不被拦截（否则搜不了带斜杠的内容）',
        kc.w.NEONKeys.handleKey({ key: '/', target: input }) === false);
      T('O13 键盘可达', 'R69e 输入框内打 "?" 不被拦截（否则问号永远打不出）',
        kc.w.NEONKeys.handleKey({ key: '?', target: input }) === false &&
        !kc.w.NEONKeys.helpOpen());
      /* textarea 同样豁免 */
      const ta = kc.doc.createElement('textarea');
      kc.doc.body.appendChild(ta);
      T('O13 键盘可达', 'R69f textarea 内按键同样豁免',
        kc.w.NEONKeys.handleKey({ key: '/', target: ta }) === false);
      T('O13 键盘可达', 'R69g isTyping 正确识别 input/textarea',
        kc.w.NEONKeys.isTyping(input) === true && kc.w.NEONKeys.isTyping(ta) === true &&
        kc.w.NEONKeys.isTyping(kc.doc.body) === false);
      input.remove(); ta.remove();
    }

    /* "?" 唤起帮助面板 + Esc 关闭（端到端，走真实事件） */
    {
      press('?', { shift: true });
      await new Promise(r => setTimeout(r, 30));
      const helpEl = kc.doc.getElementById('kbd-help');
      T('O13 键盘可达', 'R69h 按 "?" 唤起快捷键帮助面板',
        !!helpEl && !helpEl.hidden, helpEl ? ('hidden=' + helpEl.hidden) : '无容器');
      T('O13 键盘可达', 'R69i 帮助面板渲染了快捷键清单（且与 KEYS 同源）',
        !!helpEl && helpEl.querySelectorAll('.kbd-help-row').length >= kc.w.NEONKeys.KEYS.length,
        helpEl ? helpEl.querySelectorAll('.kbd-help-row').length + ' 行 / KEYS ' + kc.w.NEONKeys.KEYS.length + ' 项' : '-');
      /* 每一项都必须被渲染出来 —— 防止"面板打开了但清单是空的"这种半成品 */
      T('O13 键盘可达', 'R69i2 KEYS 中每条快捷键都出现在面板里（无遗漏）',
        !!helpEl && kc.w.NEONKeys.KEYS.every(function (it) {
          return helpEl.textContent.indexOf(it.k) !== -1;
        }));

      press('Escape');
      await new Promise(r => setTimeout(r, 30));
      T('O13 键盘可达', 'R69j 按 Esc 关闭帮助面板',
        kc.doc.getElementById('kbd-help').hidden === true);
    }

    /* "g 前缀" 跳转 */
    {
      kc.w.location.hash = '#/';
      await new Promise(r => setTimeout(r, 60));
      press('g');
      press('a');
      await new Promise(r => setTimeout(r, 80));
      T('O13 键盘可达', 'R69k "g a" 跳转到归档页',
        kc.w.location.hash === '#/archive', kc.w.location.hash);

      press('g');
      press('t');
      await new Promise(r => setTimeout(r, 80));
      T('O13 键盘可达', 'R69l "g t" 跳转到标签页',
        kc.w.location.hash === '#/tags', kc.w.location.hash);

      /* 前缀超时/非法第二键：不应乱跳 */
      kc.w.location.hash = '#/about';
      await new Promise(r => setTimeout(r, 60));
      press('g');
      press('z'); /* 非法 */
      await new Promise(r => setTimeout(r, 60));
      T('O13 键盘可达', 'R69m "g" 后跟非法键不跳转（静默取消，不误动作）',
        kc.w.location.hash === '#/about', kc.w.location.hash);
    }

    /* "/" 聚焦搜索 */
    {
      kc.w.location.hash = '#/search';
      await new Promise(r => setTimeout(r, 200));
      const si = kc.doc.getElementById('search-input');
      T('O13 键盘可达', 'R69n 搜索页存在 #search-input', !!si);
      if (si) {
        kc.doc.body.focus();
        press('/');
        await new Promise(r => setTimeout(r, 60));
        T('O13 键盘可达', 'R69o 按 "/" 把焦点移到搜索框',
          kc.doc.activeElement === si,
          kc.doc.activeElement ? (kc.doc.activeElement.id || kc.doc.activeElement.tagName) : 'null');
      }
    }

    /* 模态焦点陷阱：真实打开一个模态，检查焦点落入 + Tab 循环 + 归还 */
    {
      const trigger = kc.doc.getElementById('btn-theme');
      if (trigger && trigger.focus) trigger.focus();
      const beforeFocus = kc.doc.activeElement;

      /* 通过 changelog 按钮打开模态（它调 openModal） */
      const logBtn = kc.doc.getElementById('btn-changelog');
      T('O13 键盘可达', 'R70 存在可打开模态的入口（工程日志按钮）', !!logBtn);
      if (logBtn) {
        logBtn.click();
        await new Promise(r => setTimeout(r, 80));
        const mask = kc.doc.getElementById('neon-modal');
        T('O13 键盘可达', 'R70b 模态已打开', !!mask);
        T('O13 键盘可达', 'R70c 模态带 role="dialog" + aria-modal（读屏可识别）',
          !!mask && mask.getAttribute('role') === 'dialog' && mask.getAttribute('aria-modal') === 'true');
        T('O13 键盘可达', 'R70d 打开后焦点被移入模态内（不会留在背景页）',
          !!mask && mask.contains(kc.doc.activeElement),
          kc.doc.activeElement ? (kc.doc.activeElement.className || kc.doc.activeElement.tagName) : 'null');

        /* Tab 循环：在最后一个可聚焦元素上按 Tab 应回到第一个 */
        if (mask) {
          const items = kc.w.NEONKeys.focusablesIn(mask);
          T('O13 键盘可达', 'R70e 模态内可识别出可聚焦元素', items.length > 0, items.length + ' 个');
          if (items.length > 1) {
            const last = items[items.length - 1];
            last.focus();
            const tabEv = new kc.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            /* 陷阱监听挂在容器上，故从容器内元素派发 */
            last.dispatchEvent(tabEv);
            T('O13 键盘可达', 'R70f 末位元素 Tab 后焦点回到首位（焦点被关在模态内）',
              kc.doc.activeElement === items[0],
              kc.doc.activeElement ? (kc.doc.activeElement.className || kc.doc.activeElement.tagName) : 'null');

            /* Shift+Tab 反向 */
            items[0].focus();
            const stabEv = new kc.w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
            items[0].dispatchEvent(stabEv);
            T('O13 键盘可达', 'R70g 首位元素 Shift+Tab 后焦点跳到末位（反向循环）',
              kc.doc.activeElement === last,
              kc.doc.activeElement ? (kc.doc.activeElement.className || kc.doc.activeElement.tagName) : 'null');
          }
        }

        /* Esc 关模态并归还焦点 */
        press('Escape');
        await new Promise(r => setTimeout(r, 80));
        T('O13 键盘可达', 'R70h Esc 关闭模态',
          !kc.doc.getElementById('neon-modal'));
        T('O13 键盘可达', 'R70i 关闭后焦点归还给触发元素（键盘用户不迷路）',
          kc.doc.activeElement === beforeFocus,
          kc.doc.activeElement === beforeFocus ? '已归还' :
            (kc.doc.activeElement ? (kc.doc.activeElement.id || kc.doc.activeElement.tagName) : 'null'));
      }
    }

    /* 静态守卫：keys.js 绝不能有内联事件 / 外域依赖（CSP 与供应链双约束） */
    T('O13 键盘可达', 'R71 keys.js 无内联 on* 事件属性写法',
      !/\bon(click|keydown|keyup|focus)\s*=\s*["']/.test(keysBare));
    T('O13 键盘可达', 'R71b keys.js 零外域请求',
      !/https?:\/\//.test(keysBare));
    T('O13 键盘可达', 'R71c keys.js 只在无修饰键或 Shift 场景工作（不抢 Ctrl/Alt/Meta）',
      /ctrlKey\s*\|\|\s*ev\.altKey\s*\|\|\s*ev\.metaKey/.test(keysBare));
    T('O13 键盘可达', 'R71d index.html 已引入 keys.js（带版本查询串）',
      /src="js\/keys\.js\?v=[0-9.]+"/.test(html));
    T('O13 键盘可达', 'R71e keys.js 排在 app.js 之前（app 的模态要用到它的 trapFocus）',
      html.indexOf('js/keys.js') !== -1 &&
      html.indexOf('js/keys.js') < html.indexOf('js/app.js'));

    kc.dom.window.close();
  }

  /* ---- O14：B2 请求并行化（allSettled 语义 + 逐个降级） ---- */
  {
    const appBare = stripComments(stripJsLineComments(SRC.app || ''));
    const cloudBare = stripComments(stripJsLineComments(SRC.cloud || ''));

    /* --- 结构：辅助函数存在，且用的是 allSettled 语义 --- */
    T('O14 请求并行', 'R72 app.js 定义了 parallelSafe（并行取数通道）',
      /function parallelSafe\s*\(/.test(appBare));
    T('O14 请求并行', 'R72b parallelSafe 内部把每个任务包成 never-reject（settled）',
      /function settled\s*\(/.test(appBare) &&
      /function\s*\(e\)\s*\{\s*return\s*\{\s*ok:\s*false/.test(appBare));
    T('O14 请求并行', 'R72c parallelSafe 用 Promise.all 组合【已 settled 的】任务',
      /Promise\.all\(list\)/.test(appBare));
    /* 同步抛错也必须被消化 —— need() 在数据层缺失时是同步抛的 */
    T('O14 请求并行', 'R72d 任务同步抛错也被捕获（否则并行化反而更脆）',
      /catch\s*\(e\)\s*\{\s*return settled\(Promise\.reject\(e\)\)/.test(appBare));

    /* --- 关键：cloud.js 的 listPublished 不得再用裸 Promise.all ---
       这是本轮修掉的真实缺陷：行数据与总数并行时若计数请求 reject，
       裸 Promise.all 会连带丢弃已成功的行数据，
       而下面本就有"计数不可用则估算"的降级分支 —— 等于让降级永远走不到。 */
    const lpIdx = cloudBare.indexOf('listPublished');
    const lpEnd = cloudBare.indexOf('tagStats', lpIdx);
    const listPublished = lpIdx === -1 ? '' : cloudBare.slice(lpIdx, lpEnd === -1 ? lpIdx + 2000 : lpEnd);
    T('O14 请求并行', 'R72e listPublished 仍并行取行数据与总数（保留并行收益）',
      /Promise\.all\(\[settled\(rowsQuery\),\s*settled\(countQuery\)\]\)/.test(listPublished),
      listPublished ? '' : '未定位到 listPublished');
    T('O14 请求并行', 'R72f listPublished 不再对裸 query 直接 Promise.all（错误语义已修）',
      !/await Promise\.all\(\[rowsQuery,\s*countQuery\]\)/.test(listPublished));
    T('O14 请求并行', 'R72g 计数失败不抛错，走估算降级（total === null 分支可达）',
      /if \(total === null\) total =/.test(listPublished));
    T('O14 请求并行', 'R72h 行数据失败才抛错（失败范围与数据范围一致）',
      /if \(!rowsS\.ok\) throw new Error/.test(listPublished));

    /* --- 运行时：真跑 parallelSafe 的行为 --- */
    {
      const c = bootDom({ skipApp: true });
      /* parallelSafe 在 app.js 的 IIFE 内部，不对外暴露。
         这里用"抠源码片段 + 求值"的方式真跑它 —— 
         比断言源码字符串可靠得多。 */
      const from = SRC.app.indexOf('function settled(');
      const to = SRC.app.indexOf('/* ============ 全局状态');
      T('O14 请求并行', 'R72i 能从 app.js 抠出 settled/parallelSafe 源码',
        from !== -1 && to !== -1 && to > from);
      if (from !== -1 && to > from) {
        const factory = new Function(SRC.app.slice(from, to) + '\nreturn { settled: settled, parallelSafe: parallelSafe };');
        const mod = factory();

        /* ① 全部成功 */
        const r1 = await mod.parallelSafe([
          function () { return Promise.resolve('A'); },
          function () { return Promise.resolve('B'); }
        ]);
        T('O14 请求并行', 'R73 全部成功时逐项返回 ok:true 与原值',
          r1.length === 2 && r1[0].ok && r1[1].ok &&
          r1[0].value === 'A' && r1[1].value === 'B');

        /* ② 一个 reject，另一个必须不受影响 —— 这就是 allSettled 语义的核心 */
        const r2 = await mod.parallelSafe([
          function () { return Promise.resolve({ posts: [{ id: 1 }, { id: 2 }] }); },
          function () { return Promise.reject(new Error('count 挂了')); }
        ]);
        T('O14 请求并行', 'R73b 单项失败不连累其它（成功的值仍可取到）',
          r2[0].ok && !r2[1].ok &&
          r2[0].value.posts.length === 2,
          'rows.ok=' + r2[0].ok + ' count.ok=' + r2[1].ok);
        T('O14 请求并行', 'R73c 失败项带 ok:false 与原始 reason（供 errMsg 脱敏渲染）',
          r2[1].ok === false && !!r2[1].reason && /count 挂了/.test(String(r2[1].reason.message)));

        /* ③ 同步抛错的任务（模拟 need() 在数据层缺失时抛） */
        let syncThrew = false;
        let r3 = null;
        try {
          r3 = await mod.parallelSafe([
            function () { throw new Error('数据层未就绪：缺少 Posts'); },
            function () { return Promise.resolve('ok'); }
          ]);
        } catch (e) { syncThrew = true; }
        T('O14 请求并行', 'R73d 同步抛错的任务不会让 parallelSafe 整体炸掉',
          !syncThrew && !!r3 && r3.length === 2 && !r3[0].ok && r3[1].ok,
          syncThrew ? '整体抛错' : 'ok');
      }
      c.dom.window.close();
    }

    /* --- 端到端：计数拒绝时首页仍能显示文章（这是 B2 修的真实缺陷） --- */
    {
      /* 定制桩：让 count 查询 reject，行查询正常 */
      const c = bootDom({
        captureConsole: true,
        fixtures: {
          posts: FIXTURES.posts,
          /* 用一个标志位让 cloud stub 的 count 分支拒绝 */
          __rejectCount: true
        }
      });
      await waitFor(function () { return c.doc.body.innerHTML.length > 600; }, 3000);
      await new Promise(function (r) { setTimeout(r, 250); });
      const cards = c.doc.querySelectorAll('.post-card');
      T('O14 请求并行', 'R73e 计数请求失败时首屏文章仍然可见（错误范围未污染数据）',
        cards.length > 0,
        cards.length + ' 张卡片');
      const bodyTxt = c.doc.body.textContent || '';
      T('O14 请求并行', 'R73f 计数失败不弹"数据流连接失败"整页错误',
        bodyTxt.indexOf('数据流连接失败') === -1,
        bodyTxt.indexOf('数据流连接失败') === -1 ? '无整页错误' : '出现整页错误文案');
      c.dom.window.close();
    }
  }

  /* ---- O15：C9 阅读进度条 + 回到顶部 ---- */
  {
    const html = SRC.html || '';
    const cssBare = stripComments(SRC.css || '');
    const appBare = stripComments(stripJsLineComments(SRC.app || ''));

    /* --- 结构：节点挂在 #app 之外（否则被路由重渲染抹掉） --- */
    const appOpen = html.indexOf('id="app"');
    const progIdx = html.indexOf('id="read-progress"');
    const toTopIdx = html.indexOf('id="to-top"');
    T('O15 阅读进度', 'R74 index.html 含进度条容器', progIdx !== -1);
    T('O15 阅读进度', 'R74b 进度条挂在 #app 之外（在它之前，不会被 innerHTML 抹掉）',
      progIdx !== -1 && appOpen !== -1 && progIdx < appOpen,
      'progress@' + progIdx + ' app@' + appOpen);
    T('O15 阅读进度', 'R74c 进度条对读屏隐藏（纯视觉指示）',
      /id="read-progress"[^>]*aria-hidden="true"/.test(html) ||
      /aria-hidden="true"[^>]*id="read-progress"/.test(html));

    T('O15 阅读进度', 'R74d 回到顶部是 <button> 而非 <a href="#">',
      /<button[^>]*id="to-top"/.test(html));
    T('O15 阅读进度', 'R74e 回到顶部带 aria-label（读屏有人话）',
      /id="to-top"[^>]*aria-label="[^"]+"/.test(html) ||
      /aria-label="[^"]+"[^>]*id="to-top"/.test(html));
    T('O15 阅读进度', 'R74f 回到顶部挂在 #app 之外',
      toTopIdx !== -1 && appOpen !== -1 && toTopIdx > appOpen);
    /* CSP 硬约束：绝不能有内联 onclick */
    T('O15 阅读进度', 'R74g 回到顶部无内联 onclick（CSP 会拦死）',
      !/<button[^>]*id="to-top"[^>]*onclick=/.test(html));

    /* --- CSS：必须用 transform 而非 width 驱动进度 --- */
    const progRule = (function () {
      const m = /\.read-progress-bar\s*\{([\s\S]*?)\}/.exec(cssBare);
      return m ? m[1] : '';
    })();
    T('O15 阅读进度', 'R74h 进度条用 transform: scaleX() 驱动（不触发重排）',
      /transform:\s*scaleX\(/.test(progRule));
    /* 精确断言：CSS 里 width 只能是布局用的固定值（100% 撑满父容器），
       绝不能出现"按进度动态赋值"的百分比写法。真正的动态写入在 JS 侧，
       由 R75g 断言 JS 不碰 style.width —— 两侧都守住才算数。 */
    T('O15 阅读进度', 'R74i 进度条的 width 不用于表达进度（只作布局撑满）',
      !/width:\s*(?:calc\(|\d*\.?\d+%\s*[+*])/.test(progRule) &&
      !/width:\s*\d+px/.test(progRule),
      progRule.match(/width:[^;]+/g) ? progRule.match(/width:[^;]+/g).join(' | ') : '无 width');
    T('O15 阅读进度', 'R75g JS 不通过 style.width 更新进度（一律走 transform）',
      !/\.style\.width\s*=/.test(appBare));
    T('O15 阅读进度', 'R74j 进度条设了 transform-origin: 0（从左端生长）',
      /transform-origin:\s*0/.test(progRule));
    T('O15 阅读进度', 'R74k 进度条 pointer-events:none（不挡下方可点元素）',
      /\.read-progress\s*\{[^}]*pointer-events:\s*none/.test(cssBare));
    T('O15 阅读进度', 'R74l 回顶按钮默认隐藏，靠 data-visible 显形',
      /\.to-top\s*\{[^}]*opacity:\s*0/.test(cssBare) &&
      /\.to-top\[data-visible="1"\]/.test(cssBare));

    /* --- JS：节流与不依赖 IO --- */
    T('O15 阅读进度', 'R75 滚动处理用 requestAnimationFrame 节流',
      /requestAnimationFrame/.test(appBare));
    T('O15 阅读进度', 'R75b 有"本帧已排期"的去重判断（不是每帧多次重算）',
      /if \(scrollUI\.rafId\) return/.test(appBare));
    /* R75c：判据必须切在 updateScrollUI 函数体内（不是"从它到最后"），
       否则会把后面 buildToc 里的 IntersectionObserver 也算进来（误报）。
       切法：取 updateScrollUI 定义到下一个顶层 function 之间的片段。 */
    const updateFn = (function () {
      const i = appBare.indexOf('function updateScrollUI(');
      if (i === -1) return '';
      const rest = appBare.slice(i + 10);
      const next = rest.search(/\n  function\s/);
      return next === -1 ? rest : rest.slice(0, next);
    })();
    T('O15 阅读进度', 'R75c 进度/回顶用 scrollTop 与视口高度算（不依赖 IntersectionObserver）',
      /currentScrollTop\s*\(/.test(updateFn) &&
      /innerHeight/.test(updateFn) &&
      !/IntersectionObserver/.test(updateFn),
      '片段长 ' + updateFn.length);
    T('O15 阅读进度', 'R75d 提供释放函数（监听器可回收）',
      /function releaseScrollUI\s*\(/.test(appBare));
    T('O15 阅读进度', 'R75e init 幂等：先释放再安装（重复调用不叠加）',
      /function initScrollUI\s*\([\s\S]{0,200}releaseScrollUI\(\)/.test(appBare));
    T('O15 阅读进度', 'R75f 回顶按钮的 click 绑定有防重复标记',
      /__neonBound/.test(appBare));

    /* --- 运行时：真跑（jsdom 无布局，故用属性/风格状态验证，不验像素） --- */
    {
      const c = bootDom({ captureConsole: true, url: 'https://x.test/#/archive' });
      await waitFor(function () { return c.doc.body.innerHTML.length > 600; }, 3000);
      await new Promise(function (r) { setTimeout(r, 200); });

      T('O15 阅读进度', 'R76 启动后进度条节点存在',
        !!c.doc.getElementById('read-progress'));
      T('O15 阅读进度', 'R76b 启动后回顶按钮存在',
        !!c.doc.getElementById('to-top'));
      T('O15 阅读进度', 'R76c 初始（未滚动）时进度条处于 idle 隐藏态',
        c.doc.getElementById('read-progress').getAttribute('data-idle') === '1');
      T('O15 阅读进度', 'R76d 初始（未滚动）时回顶按钮隐藏',
        c.doc.getElementById('to-top').getAttribute('data-visible') === '0');

      /* 模拟滚动：jsdom 无布局，故直接喂 scrollTop 与尺寸，再派发 scroll */
      c.doc.documentElement.scrollTop = 0;
      Object.defineProperty(c.w, 'pageYOffset', { value: 0, writable: true, configurable: true });
      Object.defineProperty(c.doc.documentElement, 'scrollHeight', { value: 4000, configurable: true });
      Object.defineProperty(c.w, 'innerHeight', { value: 800, configurable: true });

      /* 滚到中点 */
      Object.defineProperty(c.w, 'pageYOffset', { value: 1600, writable: true, configurable: true });
      c.w.dispatchEvent(new c.w.Event('scroll'));
      await new Promise(function (r) { setTimeout(r, 80); });

      const bar = c.doc.getElementById('read-progress-bar');
      const tf = bar ? (bar.style.transform || '') : '';
      T('O15 阅读进度', 'R76e 滚动到中点后进度条 scaleX 约为 0.5',
        /scaleX\(0\.5/.test(tf), tf || '（无 transform）');
      T('O15 阅读进度', 'R76f 滚动中进度条脱离 idle 态（可见）',
        c.doc.getElementById('read-progress').getAttribute('data-idle') === '0');
      T('O15 阅读进度', 'R76g 滚过一屏后回顶按钮显形',
        c.doc.getElementById('to-top').getAttribute('data-visible') === '1');

      /* 滚到底 */
      Object.defineProperty(c.w, 'pageYOffset', { value: 3200, writable: true, configurable: true });
      c.w.dispatchEvent(new c.w.Event('scroll'));
      await new Promise(function (r) { setTimeout(r, 80); });
      T('O15 阅读进度', 'R76h 滚到底时进度条满格 scaleX(1)',
        /scaleX\(1(\.0+)?\)/.test(c.doc.getElementById('read-progress-bar').style.transform || ''),
        c.doc.getElementById('read-progress-bar').style.transform);
      T('O15 阅读进度', 'R76i 滚到底后进度条回到 idle 隐藏态（顶边不留静止线）',
        c.doc.getElementById('read-progress').getAttribute('data-idle') === '1');

      /* 回到顶部：模拟点击，断言 scrollTo 被调用 */
      let scrolledTo = null;
      c.w.scrollTo = function (a, b) {
        scrolledTo = (typeof a === 'object') ? (a && a.top) : a;
      };
      c.doc.getElementById('to-top').click();
      await new Promise(function (r) { setTimeout(r, 60); });
      T('O15 阅读进度', 'R76j 点击回顶按钮触发滚动到 0',
        scrolledTo === 0, 'scrollTo top=' + String(scrolledTo));

      /* 监听器幂等：再装一次不应增加 */
      const before = c.w.__scrollListeners;
      T('O15 阅读进度', 'R76k 详情/归档页 scroll 监听数已计入（>0 说明 C9 已装）',
        before > 0, 'count=' + before);
      c.dom.window.close();
    }

    /* 短页面（内容不足一屏）：两种 UI 都不该出现 */
    {
      const c = bootDom({ url: 'https://x.test/#/about' });
      await waitFor(function () { return c.doc.body.innerHTML.length > 400; }, 3000);
      await new Promise(function (r) { setTimeout(r, 150); });
      /* 把页面高度设成小于视口 */
      Object.defineProperty(c.doc.documentElement, 'scrollHeight', { value: 400, configurable: true });
      Object.defineProperty(c.w, 'innerHeight', { value: 900, configurable: true });
      Object.defineProperty(c.w, 'pageYOffset', { value: 0, writable: true, configurable: true });
      c.w.dispatchEvent(new c.w.Event('scroll'));
      await new Promise(function (r) { setTimeout(r, 80); });
      T('O15 阅读进度', 'R76l 内容不足一屏时进度条隐藏（无 0% 死线）',
        c.doc.getElementById('read-progress').getAttribute('data-idle') === '1');
      T('O15 阅读进度', 'R76m 内容不足一屏时回顶按钮不出现（短页面无悬浮物）',
        c.doc.getElementById('to-top').getAttribute('data-visible') === '0');
      c.dom.window.close();
    }
  }

  /* ---- O18：防白屏最后一道防线（bootSafe / safeRoute / safeRenderNav / fatalPanel） ----
     覆盖背景（D3 拆解时盘出的**高危缺口**）：
     这四层是「任何渲染异常都不允许白屏」的兜底链，此前**零断言**。
     危险在于它的失效方式：route() 抛错时若 safeRoute 没接住，整站白屏；
     而它自己坏了，同样白屏 —— 且两种情况**都不会有任何测试报红**。

     行为侧靠 common.js 的 breakRouteOnBoot 注入：
     在 app.js 求值【之前】把 homeView 换成抛错实现，让 renderHome 在真实
     调用路径上炸掉。改视图函数而非 route 本身，是因为 route 在 IIFE 内
     不对外暴露，而 V() 惰性取用 —— 这样走的是与线上完全一致的代码。 */
  {
    const appBare = stripComments(stripJsLineComments(SRC.app || ''));

    /* --- 源码结构：四层防线必须都在，且接线正确 --- */
    T('O18 防白屏', 'R89 四层防线函数均存在（bootSafe/safeRoute/safeRenderNav/fatalPanel）',
      /function bootSafe\s*\(/.test(appBare) &&
      /function safeRoute\s*\(/.test(appBare) &&
      /function safeRenderNav\s*\(/.test(appBare) &&
      /function fatalPanel\s*\(/.test(appBare));
    T('O18 防白屏', 'R89b bootSafe 包裹 boot 调用（启动期异常可兜）',
      /function bootSafe\s*\(\s*\)\s*\{[\s\S]{0,200}boot\(\)/.test(appBare));
    T('O18 防白屏', 'R89c safeRoute 捕获异常后转调 fatalPanel（异常变故障面板）',
      /function safeRoute\s*\(\s*\)\s*\{[\s\S]{0,300}fatalPanel\(/.test(appBare));
    T('O18 防白屏', 'R89d safeRenderNav 已接入 boot 与认证变化（≥2 处调用）',
      (appBare.match(/safeRenderNav\(\)/g) || []).length >= 2,
      (appBare.match(/safeRenderNav\(\)/g) || []).length + ' 处');

    /* --- 行为：真注入抛错视图函数，看防线是否接住 --- */
    const c = bootDom({
      captureConsole: true,
      breakRouteOnBoot: 'homeView',
      breakRouteMsg: '<img src=x onerror=alert(1)>BOOM'
    });
    await waitFor(function () { return c.doc.body.innerHTML.length > 100; }, 3000);
    await new Promise(function (r) { setTimeout(r, 300); });

    T('O18 防白屏', 'R89e 渲染异常时不白屏（body 仍有实质内容）',
      c.doc.body.innerHTML.length > 600, c.doc.body.innerHTML.length + 'B');
    const codeEl = c.doc.querySelector('.empty-code');
    T('O18 防白屏', 'R89f 渲染异常时显示 RENDER FAULT 故障面板',
      !!c.doc.querySelector('.empty-state') && !!codeEl &&
      /RENDER FAULT/.test(codeEl.textContent || ''),
      codeEl ? codeEl.textContent : '(无面板)');
    T('O18 防白屏', 'R89g 故障面板给出「返回首页」出口（用户不困死）',
      !!c.doc.querySelector('.empty-state a.btn[href="#/"]'));
    /* 错误面板本身也是渲染面：异常信息若夹带标签，必须被 esc 转义。
       否则「渲染出错」这条路径就变成了注入点 —— 越慌越容易被打。 */
    const hintEl = c.doc.querySelector('.empty-hint');
    T('O18 防白屏', 'R89h 异常信息经 esc 转义（故障面板也不注入）',
      !c.doc.querySelector('img[src="x"]') && /&lt;/.test(hintEl ? hintEl.innerHTML : ''),
      hintEl ? hintEl.textContent.slice(0, 50) : '(无)');
    T('O18 防白屏', 'R89i 渲染异常不产生未处理 Promise 拒绝',
      (c.unhandled || []).length === 0, (c.unhandled || [])[0] || '');
    /* 原始错误只进 console，不整段糊到页面上 —— 与 E1 脱敏同源的要求 */
    T('O18 防白屏', 'R89j 原始异常只进 console.error（不外泄给访客）',
      c.logs.some(function (l) { return l.indexOf('ERR:') === 0 && /路由渲染失败/.test(l); }),
      (c.logs.filter(function (l) { return l.indexOf('ERR:') === 0; })[0] || '(无)').slice(0, 60));
    c.dom.window.close();

    /* --- 反向确认：正常启动绝不该出现 RENDER FAULT ---
       没有这一条，上面 R89f 可能因「面板恒存在」而恒真。 */
    const c2 = bootDom({ captureConsole: true });
    await waitFor(function () { return c2.doc.body.innerHTML.length > 600; }, 3000);
    await new Promise(function (r) { setTimeout(r, 200); });
    const code2 = c2.doc.querySelector('.empty-code');
    T('O18 防白屏', 'R89k 正常启动不出现 RENDER FAULT（故障面板非默认态）',
      !code2 || !/RENDER FAULT/.test(code2.textContent || ''),
      code2 ? code2.textContent : '(无面板)');
    c2.dom.window.close();
  }

  /* ---- O19：编辑器文本操作沙箱（insertAtCursor / wrapSelection / linePrefix） ----
     覆盖背景（D3 拆解时盘出的**高危缺口**）：这三个是编辑器工具栏与
     Ctrl+B/I 的底层实现，直接改写用户正文，此前**零断言**。
     值得盯的边界是 linePrefix 的 `lastIndexOf('\n', start - 1)`：
     start=0 时传入 -1，靠 "+1 归 0" 才落在行首 —— 这是个安静的 off-by-one 风险点。

     测法：把这三个函数抠出来真跑（不只对源码做断行匹配）。
     它们依赖外层闭包里的 ta / debounceTimer / refreshPreview，
     抠片段时**不必**带上这些依赖 —— 改为由 new Function 的形参注入，
     这样每个用例都能换一个全新的假 textarea，互不污染。 */
  {
    const seg = (function () {
      const from = SRC.app.indexOf('function insertAtCursor(');
      const to = SRC.app.indexOf('/* 工具栏 */');
      return from !== -1 && to > from ? SRC.app.slice(from, to) : '';
    })();
    T('O19 编辑器文本', 'R90 能从 app.js 抠出三个文本操作函数',
      /function insertAtCursor\s*\(/.test(seg) &&
      /function wrapSelection\s*\(/.test(seg) &&
      /function linePrefix\s*\(/.test(seg),
      seg ? seg.length + 'B' : '未定位');

    /* 假 textarea：只需具备被这三个函数碰到的字段 */
    function mk(v, s, e) {
      s = s || 0;
      e = (e === undefined) ? s : e;
      const ta = {
        value: v, selectionStart: s, selectionEnd: e, focused: false,
        focus: function () { this.focused = true; }
      };
      let refreshes = 0;
      const factory = new Function('ta', 'debounceTimer', 'refreshPreview',
        seg + '\nreturn { insertAtCursor: insertAtCursor, wrapSelection: wrapSelection, linePrefix: linePrefix };');
      const m = factory(ta, null, function () { refreshes++; });
      return { ta: ta, m: m, count: function () { return refreshes; } };
    }

    if (seg) {
      /* --- insertAtCursor --- */
      let t = mk('abc', 1); t.m.insertAtCursor('X');
      T('O19 编辑器文本', 'R90b 光标处插入且光标后移一个插入串长度',
        t.ta.value === 'aXbc' && t.ta.selectionStart === 2 && t.ta.selectionEnd === 2,
        t.ta.value + ' @' + t.ta.selectionStart);

      t = mk('abc', 1, 2); t.m.insertAtCursor('X');
      T('O19 编辑器文本', 'R90c 有选区时替换选区内容',
        t.ta.value === 'aXc' && t.ta.selectionStart === 2, t.ta.value);

      t = mk('abc', 0); t.m.insertAtCursor('X');
      T('O19 编辑器文本', 'R90d 插入位置为 0（头部边界不越界）',
        t.ta.value === 'Xabc' && t.ta.selectionStart === 1, t.ta.value);

      /* --- wrapSelection（Ctrl+B / 工具栏加粗斜体的底层） --- */
      t = mk('hello', 0, 5); t.m.wrapSelection('**', '**');
      T('O19 编辑器文本', 'R90e 包裹选中文本（首尾各加标记）',
        t.ta.value === '**hello**' &&
        t.ta.selectionStart === 2 && t.ta.selectionEnd === 7,
        t.ta.value + ' 选区 ' + t.ta.selectionStart + '..' + t.ta.selectionEnd);

      t = mk('ab', 1); t.m.wrapSelection('*', '*');
      T('O19 编辑器文本', 'R90f 空选区时插入成对符号，光标落在两者之间',
        t.ta.value === 'a**b' && t.ta.selectionStart === 2 && t.ta.selectionEnd === 2,
        t.ta.value + ' @' + t.ta.selectionStart);

      t = mk('', 0); t.m.wrapSelection('**', '**');
      T('O19 编辑器文本', 'R90g 空文档包裹不越界（0 长度输入）',
        t.ta.value === '****' && t.ta.selectionStart === 2, t.ta.value);

      /* --- linePrefix（标题 / 引用 / 列表的行首前缀） --- */
      t = mk('hello', 0); t.m.linePrefix('## ');
      T('O19 编辑器文本', 'R90h 单行时前缀加在行首',
        t.ta.value === '## hello' && t.ta.selectionStart === 3, t.ta.value);

      t = mk('a\nb', 2); t.m.linePrefix('## ');
      T('O19 编辑器文本', 'R90i 第二行加前缀时不污染第一行',
        t.ta.value === 'a\n## b' && t.ta.selectionStart === 5,
        JSON.stringify(t.ta.value));

      t = mk('abc', 0); t.m.linePrefix('> ');
      T('O19 编辑器文本', 'R90j 光标在 0 时 lastIndexOf("\\n",-1) 边界不越界',
        t.ta.value === '> abc' && t.ta.selectionStart === 2, t.ta.value);

      t = mk('abc', 2); t.m.linePrefix('## ');
      T('O19 编辑器文本', 'R90k 光标在行中时前缀仍落在行首（不插在光标处）',
        t.ta.value === '## abc' && t.ta.selectionStart === 5, t.ta.value);

      /* ⚠ 这条是反向验证逼出来的（第一版断言在此处假绿）：
         R90h/j/k 的输入都**没让光标落在换行符索引上**，
         于是把 lastIndexOf('\n', start-1) 改成 start 也照样全绿 ——
         断言看似守住了边界，实际什么都没守住。
         唯一能区分两种实现的输入是 start === '\n' 的下标（此处为 1）：
           正确 → 找 start-1 之前 → -1 → 归 0（前缀加在**第一行**行首）
           错误 → 找 start 处 → 命中 '\n' → 归 2（前缀错加到第二行）
         故补这条"光标骑在换行符上"的用例，它是该 off-by-one 的唯一探针。 */
      t = mk('a\nb', 1); t.m.linePrefix('## ');
      T('O19 编辑器文本', 'R90n 光标恰在换行符上时前缀加在【当前行】行首（而非下一行）',
        t.ta.value === '## a\nb' && t.ta.selectionStart === 4,
        JSON.stringify(t.ta.value) + ' @' + t.ta.selectionStart);

      /* 三个操作都必须连带刷新预览 —— 否则用户看不到 Markdown 效果 */
      t = mk('abc', 1);
      t.m.insertAtCursor('X');
      await new Promise(function (r) { setTimeout(r, 260); });
      T('O19 编辑器文本', 'R90l 文本操作后触发预览刷新（防抖 200ms）',
        t.count() >= 1, '刷新 ' + t.count() + ' 次');
      T('O19 编辑器文本', 'R90m 操作后焦点回到 textarea（用户可继续输入）',
        t.ta.focused === true);
    }
  }

  /* D3：汇总后做断言名重名检测 —— 拆分前靠「共用同一个 results 数组」天然去重，
     拆分后跨文件重名无人管，故在此显式判红（守则第 2 条）。 */
  const all = results.concat(checkDuplicateNames(results));
  const fail = all.filter(function (r) { return !r.pass; }).length;
  return { pass: all.length - fail, fail: fail, results: all };
}

module.exports = { run: run };

if (require.main === module) {
  run().then(function (r) {
    r.results.forEach(function (x) {
      console.log((x.pass ? '  PASS  ' : '  FAIL  ') + '[' + x.case + '] ' + x.name + (x.info ? '  [' + x.info + ']' : ''));
    });
    console.log('\n功能回归: ' + r.pass + '/' + (r.pass + r.fail));
    process.exit(r.fail === 0 ? 0 : 1);
  });
}
