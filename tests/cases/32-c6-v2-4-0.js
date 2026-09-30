'use strict';
/* ============================================================
   tests/cases/32-c6-v2-4-0.js — v2.4.0 插单（K2 / K4 / C1+ C6）

   对应《UI优化建议.md》实施期新增四项（用户选定提案板）：
     · E6(K2)  .btn 双层取景框（::before inset 3px 内圈 + clip-path:inherit
               + currentColor 派生，四色变体自动适配）
     · E7(K4)  .btn-magenta:hover 故障色散 text-shadow（青/紫双侧残影）
     · F4(C1)  封面 kick 读数行（SIG_XXX // 日期）
     · F5(C6)  标题压字（.cover-press 进封面底部，无封面回退卡身原位）

   写法原则（同 29/30/31 号）：行为 > 语义 > 字面；每条可反向验证。
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, stripComments, stripJsLineComments, cssRuleBody } = require('../common');

/* 顶层规则遍历器（与 30/31 号同一实现，绕开 cssRuleBody 联合选择器误命中） */
function topLevelRules(css) {
  const out = [];
  const re = /(^|\})\s*([^{}]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const open = re.lastIndex;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    out.push([m[2], css.slice(open, close)]);
    re.lastIndex = close;
  }
  return out;
}

/* @media 块提取（与 31 号同一实现） */
function mediaBlocks(css, cond) {
  const re = /@media([^{]*)\{/g;
  const out = [];
  let m;
  while ((m = re.exec(css))) {
    if (cond && !cond(m[1])) { continue; }
    let depth = 1, i = re.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push({ cond: m[1].trim(), body: css.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);

  /* ================= E6（K2）：双层取景框 ================= */
  {
    const before = topLevelRules(css).filter(function (r) {
      return /^\.btn::before$/.test(r[0].trim());
    });
    const body = before.map(function (r) { return r[1]; }).join('\n');
    T('E6 双层取景框', 'R104 .btn::before 内圈存在（clip-path:inherit + pointer-events:none + currentColor 派生）',
      before.length === 1 &&
      /clip-path\s*:\s*inherit/.test(body) &&
      /pointer-events\s*:\s*none/.test(body) &&
      /currentColor/.test(body),
      before.length === 0 ? '未找到 .btn::before' : 'ok');

    const hoverBlk = mediaBlocks(css, function (c) { return /hover\s*:\s*hover/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    T('E6 双层取景框', 'R104b hover 点亮内圈在 @media(hover:hover) 块内（E1 铁律）',
      /\.btn:hover:not\(:disabled\)::before\s*\{[^}]*border-color\s*:[^;}]*currentColor/.test(hoverBlk),
      'hover 块内未找到 ::before 点亮规则');

    const magentaBefore = topLevelRules(css).filter(function (r) {
      return /^\.btn-magenta\b/.test(r[0].trim()) && /::before/.test(r[0]);
    });
    T('E6 双层取景框', 'R104c 色变体不重复写 ::before（currentColor 自动适配）',
      magentaBefore.length === 0 && topLevelRules(css).filter(function (r) {
        return /::before$/.test(r[0].trim()) && /^\.btn\b/.test(r[0].trim());
      }).length === 1,
      '变体不应各自定义 ::before');
  }

  /* ================= E7（K4）：故障色散 ================= */
  {
    const hoverBlk = mediaBlocks(css, function (c) { return /hover\s*:\s*hover/.test(c); })
      .map(function (b) { return b.body; }).join('\n');
    const m = hoverBlk.match(/\.btn-magenta:hover:not\(:disabled\)\s*\{([^}]*)\}/);
    const body = m ? m[1] : '';
    T('E7 故障色散', 'R105 btn-magenta hover 为青/紫双侧色散（非单色 glow）',
      /text-shadow\s*:\s*-1\.5px\s+0\s+rgba\(0,\s*240,\s*255,\s*0?\.9\)\s*,\s*1\.5px\s+0\s+rgba\(181,\s*55,\s*242,\s*0?\.9\)/.test(body),
      m ? body.replace(/\s+/g, ' ') : '未找到 .btn-magenta:hover 规则');

    /* 旧的单色 glow text-shadow 不应残留（防止两版并存） */
    T('E7 故障色散', 'R105b 旧版单色 text-shadow 已被替换',
      !/text-shadow\s*:\s*0\s+0\s+8px\s+rgba\(255,\s*42,\s*109/.test(hoverBlk),
      'hover 块内仍有旧版 0 0 8px 品红 text-shadow');
  }

  /* ================= F4/F5（C1+C6）：HUD 读数 + 标题压字 ================= */
  {
    const views = stripJsLineComments(SRC.views);
    // 钉 class="..." 结构而非裸词 —— 反向验证实测：views.js 块注释里的 "cover-press"
    // 字样会把裸词断言救活（stripJsLineComments 只剥行注释，不剥块注释）。
    T('F4/F5 封面压字', 'R106 postCard 含 cover-press/cover-kick/SIG_ 结构（源码）',
      /class="cover-press"/.test(views) && /class="cover-kick"/.test(views) && /'SIG_' \+/.test(views),
      'views.js 未找到压字结构');

    T('F4/F5 封面压字', 'R106b SIG 编号三位补零逻辑存在',
      /p\.id < 10 \? '00' : p\.id < 100 \? '0' : ''/.test(views),
      '未找到补零三元式');

    T('F4/F5 封面压字', 'R106c 无封面回退：h2 条件渲染（hasCover ? \'\' : \'<h2>\'）',
      /\(hasCover \? '' : '<h2>' \+ esc\(p\.title\) \+ '<\/h2>'\)/.test(views),
      '未找到卡身 h2 的条件渲染');

    const pressRule = topLevelRules(css).filter(function (r) {
      return /\.cover-press$/.test(r[0].trim());
    });
    const pb = pressRule.map(function (r) { return r[1]; }).join('\n');
    T('F4/F5 封面压字', 'R107 .cover-press 绝对定位压底部 + z-index 盖过暗罩',
      pressRule.length >= 1 &&
      /position\s*:\s*absolute/.test(pb) &&
      /z-index\s*:\s*1/.test(pb) &&
      /bottom\s*:\s*10px/.test(pb),
      pressRule.length === 0 ? '未找到 .cover-press 规则' : 'ok');

    const kickRule = topLevelRules(css).filter(function (r) {
      return /\.cover-kick$/.test(r[0].trim());
    });
    const kb = kickRule.map(function (r) { return r[1]; }).join('\n');
    T('F4/F5 封面压字', 'R107b .cover-kick 等宽字体 + cyan 变量取色（禁硬编码）',
      kickRule.length >= 1 &&
      /font-family\s*:\s*var\(--mono\)/.test(kb) &&
      /color\s*:\s*var\(--cyan\)/.test(kb),
      kickRule.length === 0 ? '未找到 .cover-kick 规则' : 'ok');

    const coverH2 = cssRuleBody(css, '.post-card .card-cover h2');
    T('F4/F5 封面压字', 'R107c 压字版 h2 补黑色投影（图上可读）',
      coverH2 !== null && /text-shadow/.test(coverH2),
      coverH2 === null ? '未找到 .post-card .card-cover h2' : 'ok');
  }

  /* ================= v2.4.1：封面底部亮线修复 ================= */
  {
    /* 机制：background-clip 默认 border-box → 图像底 1px 垫进半透明 border 后，
       ::after 暗罩(inset:0)只盖 padding-box 盖不到 border 区 → 那行图像成为
       全封面唯一未压暗像素 → 视觉上"封面底部一条多余亮线"。 */
    const coverBody = cssRuleBody(css, '.post-card .card-cover');
    T('v2.4.1 封面亮线', 'R108 .card-cover 背景收进 padding-box（不再垫入半透明 border 下）',
      coverBody !== null && /background-clip\s*:\s*padding-box/.test(coverBody) &&
      /border-bottom\s*:\s*1px solid var\(--line\)/.test(coverBody),
      coverBody === null ? '未找到 .card-cover' : 'ok');
  }

  /* ================= 行为测试（jsdom 真渲染） ================= */
  {
    const ctx = bootDom({ skipApp: true });
    const V = ctx.w.NEONViews;
    const post = {
      id: 42, title: '信号塔下的午夜广播', summary: '测试摘要',
      cover_ref: 'cloudimg://2', status: 'published',
      created_at: '2026-09-28T12:00:00Z', tags: [], owner_name: ''
    };
    const plain = Object.assign({}, post, { id: 7, cover_ref: null, title: '无封面手记' });
    ctx.doc.body.innerHTML = V.homeView({ posts: [post, plain], total: 2, loading: false, tagName: null });

    const covered = ctx.doc.querySelector('.post-card[data-id="42"]');
    const bare = ctx.doc.querySelector('.post-card[data-id="7"]');

    const pressH2 = covered ? covered.querySelector('.card-cover .cover-press h2') : null;
    T('F4/F5 封面压字', 'R106d 有封面：h2 在 .cover-press 内且不在卡身',
      !!pressH2 && pressH2.textContent === post.title && covered.querySelector(':scope > h2') === null,
      '有封面卡 h2 位置错误');

    const kick = covered ? covered.querySelector('.cover-kick') : null;
    T('F4/F5 封面压字', 'R106e kick 读数 = SIG_042 // ' + V.fmtDate(post.created_at) + '（补零与日期同源）',
      !!kick && kick.textContent === 'SIG_042 // ' + V.fmtDate(post.created_at),
      kick ? kick.textContent : '未找到 .cover-kick');

    T('F4/F5 封面压字', 'R106f 无封面：无 cover-press，h2 回退卡身直子位',
      !!bare && bare.querySelector('.cover-press') === null &&
      bare.querySelector(':scope > h2') !== null &&
      bare.querySelector(':scope > h2').textContent === plain.title,
      '无封面卡回退错误');

    ctx.dom.window.close();
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { name: 'C6 v2.4.0', run: run };
standalone(module, run);
