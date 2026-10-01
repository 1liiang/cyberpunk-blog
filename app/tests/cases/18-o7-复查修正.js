'use strict';
/* ============================================================
   tests/cases/18-o7-复查修正.js — O7 复查修正
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L1210-1264
   独立运行：node tests/cases/18-o7-复查修正.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, waitFor } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

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

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O7 复查修正" };

standalone(module, run);
