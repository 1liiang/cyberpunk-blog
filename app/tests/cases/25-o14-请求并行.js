'use strict';
/* ============================================================
   tests/cases/25-o14-请求并行.js — O14 请求并行
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L2238-2345
   独立运行：node tests/cases/25-o14-请求并行.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, FIXTURES, bootDom, waitFor, stripComments, stripJsLineComments } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

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

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O14 请求并行" };

standalone(module, run);
