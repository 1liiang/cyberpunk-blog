'use strict';
/* ============================================================
   tests/cases/10-j-草稿快照.js — J 草稿快照
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L243-310
   独立运行：node tests/cases/10-j-草稿快照.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

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

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "J 草稿快照" };

standalone(module, run);
