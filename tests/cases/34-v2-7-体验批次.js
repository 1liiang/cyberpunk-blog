'use strict';
/* ============================================================
   tests/cases/34-v2-7-体验批次.js — v2.7 体验批次（伪更新）

   五项一起验收，因为它们共用一处「详情页页尾」的渲染出口：
     · C14+ 详情页三件套（相关信号 / 上下篇 / 返回信号流）
     · C18  阅读时长估算
     · C19  收容所（本地收藏）
     · C16  标签管理（重命名 / 合并）
     · C12  暖色档（第三主题）
     · C15  打印样式

   写法原则（同 29–33 号）：行为 > 语义 > 字面；每条可反向验证。

   ⚠ 本 case 的断言对象分三类，取材方式不同：
     ① 纯前端可算的（readingMinutes / buildTrail 的排序）→ 抠源码真跑
     ② 结构性的（view 输出的 HTML 片段）→ 调 NEONViews 真渲染
     ③ 样式的（@media print / 暖色档变量）→ 扫 CSS 顶层规则
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, stripComments, stripJsLineComments } = require('../common');

/* 顶层规则遍历器（剥选择器内注释，同 33 号） */
function topLevelRules(css) {
  const out = [];
  const re = /(^|\})\s*([^{}]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const open = re.lastIndex;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    const sel = m[2].replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    out.push([sel, css.slice(open, close)]);
    re.lastIndex = close;
  }
  return out;
}

/* @media 块提取（同 31/32/33 号） */
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
  const rules = topLevelRules(css);
  const app = stripJsLineComments(SRC.app);
  const views = stripJsLineComments(SRC.views);

  /* ================= C18：阅读时长估算 ================= */
  {
    /* 抠出 readingMinutes 所在片段真跑：从 READ_WPM 到 readingLabel 结束。
       ⚠ 依赖 esc/fmtDate 之外的零外部符号 —— 这段是纯计算，可独立 eval。 */
    const from = views.indexOf('var READ_WPM');
    const to = views.indexOf('function readingLabel');
    const end = views.indexOf('}', views.indexOf('return m ?', to)) + 1;
    const src = views.slice(from, end) + '\nreturn { readingMinutes: readingMinutes };';
    const M = new Function(src)();

    T('C18 阅读时长', 'R120 空输入返回 0（不估算，而非报错/算成 1 分钟）',
      M.readingMinutes(null) === 0 && M.readingMinutes({}) === 0,
      String(M.readingMinutes(null)));

    /* 400 字/分钟：800 个中文字 → 2 分钟 */
    const cjk800 = '字'.repeat(800);
    T('C18 阅读时长', 'R120b 中文按 400 字/分钟（800 字 → 2 分钟）',
      M.readingMinutes({ content: cjk800 }) === 2,
      String(M.readingMinutes({ content: cjk800 })));

    /* 英文按单词计：800 词 → 2 分钟 */
    const en800 = Array(800).fill('word').join(' ');
    T('C18 阅读时长', 'R120c 英文按单词计（800 词 → 2 分钟）',
      M.readingMinutes({ content: en800 }) === 2,
      String(M.readingMinutes({ content: en800 })));

    /* 短文最少 1 分钟（不出现"约 0 分钟"） */
    T('C18 阅读时长', 'R120d 极短文下限 1 分钟（不出现"约 0 分钟"）',
      M.readingMinutes({ content: '短' }) === 1,
      String(M.readingMinutes({ content: '短' })));

    /* 代码块不计入阅读时间 —— 口径必须固定 */
    const codeOnly = '```\n' + 'x'.repeat(4000) + '\n```';
    T('C18 阅读时长', 'R120e 代码块整体不计入（口径固定，可复现）',
      M.readingMinutes({ content: codeOnly }) === 0,
      String(M.readingMinutes({ content: codeOnly })));

    /* 无 content 时回退 summary */
    T('C18 阅读时长', 'R120f content 缺失时回退 summary',
      M.readingMinutes({ summary: cjk800 }) === 2,
      String(M.readingMinutes({ summary: cjk800 })));
  }

  /* ================= C14+：详情页三件套 ================= */
  {
    /* 卡片与详情页都要有阅读时长（同源） */
    T('C14+ 三件套', 'R121 postView 渲染页尾 trail（postTrail 被调用）',
      /postTrail\(state, p\)/.test(views),
      'postView 未调用 postTrail —— 三件套不会出现');

    /* 三块内容的结构断言：钉 class 形式而非裸词（裸词会被块注释救活） */
    T('C14+ 三件套', 'R121b 相关信号块（trail-related + trail-head）',
      /class="trail-block trail-related"/.test(views),
      '未找到相关信号容器');
    T('C14+ 三件套', 'R121c 上下篇分页（trail-prev / trail-next）',
      /class="trail-prev"/.test(views) && /class="trail-next"/.test(views),
      '未找到上下篇');
    T('C14+ 三件套', 'R121d 返回信号流按钮',
      /返回信号流/.test(views),
      '未找到返回信号流');
    T('C14+ 三件套', 'R121e 相关信号显示"N 段重合"（不只是标题）',
      /段重合/.test(views),
      '未显示重合度');

    /* 相关为空时不渲染空标题 —— 已经用 if (related.length) 守卫 */
    T('C14+ 三件套', 'R121f 相关信号为空时整块不渲染（不留空标题）',
      /if\s*\(related\.length\)\s*\{/.test(views),
      '未做空守卫');

    /* 邻居方向约定：next = 更新（下标更小），prev = 更早（下标更大） */
    T('C14+ 三件套', 'R121g 邻居方向正确（next=下标-1 更新，prev=下标+1 更早）',
      /state\.next\s*=\s*myIdx\s*>\s*0\s*\?\s*pool\[myIdx\s*-\s*1\]/.test(app) &&
      /state\.prev\s*=\s*myIdx\s*<\s*pool\.length\s*-\s*1\s*\?\s*pool\[myIdx\s*\+\s*1\]/.test(app),
      '邻居方向约定与文案不一致');

    /* 排序：重合度降序，同分按时间倒序 */
    T('C14+ 三件套', 'R121h 相关排序 = 重合度降序（同分按时间新在前）',
      /return\s+b\.s\s*-\s*a\.s/.test(app),
      '未按重合度降序排序');

    /* 相关最多 3 条 */
    T('C14+ 三件套', 'R121i 相关信号最多 3 条',
      /scored\.slice\(0,\s*3\)/.test(app),
      '未限制条数');

    /* 不污染候选池原对象（复制后再挂 _shared） */
    T('C14+ 三件套', 'R121j 不污染候选池对象（复制后再挂 _shared）',
      /copy\._shared\s*=\s*it\.s/.test(app) && /hasOwnProperty\.call\(it\.p,\s*k\)/.test(app),
      '直接改了池对象的引用');

    /* 邻居候选复用 listPublished，不新增接口 */
    T('C14+ 三件套', 'R121k 邻居/相关复用 listPublished（不新增取数接口）',
      /need\('Posts'\)\.listPublished\(\{\s*page:\s*1,\s*pageSize:\s*SEARCH_FETCH_SIZE\s*\}\)/.test(app),
      '三件套用了额外接口');
  }

  /* ================= C19：收容所（本地收藏） ================= */
  {
    T('C19 收容所', 'R122 localStorage 键为 neon_bookmarks（常量单一来源）',
      /var MARK_KEY = 'neon_bookmarks'/.test(app),
      '未定义 MARK_KEY');

    /* 读取必须容错：解析失败/隐私模式返回空数组，绝不抛。
       注意：catch 里 return 之后常带行尾块注释，
       stripJsLineComments 只剥双斜线注释、不剥块注释 ——
       断言须允许 return [] 之后还跟着注释，故用宽松的 [\s\S] 跨行匹配。 */
    T('C19 收容所', 'R122b 读失败降级为空数组（隐私模式不崩页）',
      /catch\s*\(e\)\s*\{[\s\S]{0,160}?return\s*\[\]/.test(app),
      'readMarks 未做容错');

    /* 清洗：只留正整数 id 并去重 */
    T('C19 收容所', 'R122c 清洗非法值与去重（只留正整数 id）',
      /!isFinite\(n\)\s*\|\|\s*n\s*<=\s*0/.test(app) && /seen\[n\]/.test(app),
      '未清洗/去重');

    /* 新收容的排最前（稍后读直觉） */
    T('C19 收容所', 'R122d 新收容的排最前（unshift，最近优先）',
      /list\.unshift\(n\)/.test(app),
      '未用 unshift');

    /* 上限保护，防无限膨胀 */
    T('C19 收容所', 'R122e 有容量上限（防 localStorage 无限膨胀）',
      /MARK_MAX\s*=\s*500/.test(app) && /slice\(0,\s*MARK_MAX\)/.test(app),
      '无上限保护');

    /* 委托绑定在 document（列表会被重建，逐次绑会泄漏） */
    T('C19 收容所', 'R122f 收藏按钮走 document 委托（列表重建不泄漏监听）',
      /document\.addEventListener\('click'/.test(app) && /closest\('\[data-mark\]'\)/.test(app),
      '未用委托');

    /* 点收藏不能顺带跳进文章（卡片本身是 role=link） */
    T('C19 收容所', 'R122g 点收藏阻止冒泡（不触发卡片跳转）',
      /ev\.preventDefault\(\)/.test(app) && /ev\.stopPropagation\(\)/.test(app),
      '未阻止冒泡');

    /* 委托挂在 boot 里，且必须在 route 之前。
       ⚠ 不能只 indexOf('bindMarkDelegation()') —— 那会命中
       `function bindMarkDelegation() {` 的函数定义行，把「定义了但没调用」判成绿。
       必须钉调用现场：boot 体内的 `try { bindMarkDelegation(); }` 形式。 */
    const bootIdx = app.indexOf('try { bindMarkDelegation();');
    const routeIdx = app.indexOf('safeRoute();\n  }', bootIdx);
    T('C19 收容所', 'R122h 委托在启动时安装（首屏即可用，无窗口期）',
      bootIdx !== -1 && routeIdx !== -1,
      bootIdx === -1 ? 'boot 未调用 bindMarkDelegation' : '调用位置异常');

    /* 卡片用 button 而非 a（卡内已有 a，禁止嵌套） */
    T('C19 收容所', 'R122i 收藏控件是 <button>（卡内禁 a 嵌套）',
      /<button type="button" class="card-mark/.test(views),
      '用了 <a> 或其它标签');

    /* aria-pressed 让读屏知道收藏态 */
    T('C19 收容所', 'R122j aria-pressed 反映收藏态（无障碍）',
      /aria-pressed="' \+ \(marked \? 'true' : 'false'\)/.test(views),
      '缺少 aria-pressed');

    /* 边界说明必须写在页面上（不能只写在注释） */
    T('C19 收容所', 'R122k 页面上说明"本地保存，换设备会丢"（不只写注释）',
      /保存在本浏览器/.test(views) && /不是云端同步/.test(views),
      '未向用户说明本地收藏的边界');

    /* 收容所页在取消收藏后要即时移除该条目（页面与数据一致） */
    T('C19 收容所', 'R122l 取消收藏后即时移除该卡片（页面与数据一致）',
      /closest\('\.post-card'\)/.test(app) && /card\.remove\(\)/.test(app),
      '未做即时移除');

    /* 路由已注册 */
    T('C19 收容所', 'R122m 路由 #/marks 已注册',
      /parts\[0\] === 'marks'/.test(app) && /name === 'marks'/.test(app),
      '未注册路由');
  }

  /* ================= C16：标签管理 ================= */
  {
    T('C16 标签管理', 'R123 renameTag 在数据层导出（Posts.renameTag）',
      /renameTag: async function/.test(SRC.cloud),
      '数据层没有 renameTag');

    /* 逐篇 update，失败不中断，记录失败明细 */
    T('C16 标签管理', 'R123b 单篇失败不中断，记入 failed 明细',
      /failed\.push\(\{\s*id:/.test(SRC.cloud) && /return\s*\{\s*changed:\s*changed,\s*failed:\s*failed\s*\}/.test(SRC.cloud),
      '失败处理不完整');

    /* 合并场景去重（新标签可能已在同一篇里存在） */
    T('C16 标签管理', 'R123c 合并时去重（不产生重复标签）',
      /next\.indexOf\(v\)\s*===\s*-1/.test(SRC.cloud),
      '未去重');

    /* 只改自己的文章（owner_id 过滤） */
    T('C16 标签管理', 'R123d 只改自己的文章（owner_id 过滤）',
      /\.eq\('owner_id',\s*uid\)/.test(SRC.cloud),
      '未按 owner_id 过滤');

    /* 空标签拒绝 */
    T('C16 标签管理', 'R123e 拒绝空标签（新旧都不能为空）',
      /旧标签不能为空/.test(SRC.cloud) && /新标签不能为空/.test(SRC.cloud),
      '未校验空值');

    /* 未登录时引导登录，而不是渲染死界面 */
    T('C16 标签管理', 'R123f 未登录时引导登录（不渲染无效界面）',
      /ACCESS DENIED/.test(app) && /标签管理是写操作，请先登录/.test(app),
      '未做登录守卫');

    /* 影响范围预告 */
    T('C16 标签管理', 'R123g 执行前预告影响篇数（不做黑箱操作）',
      /篇文章受影响/.test(app),
      '未预告影响范围');

    /* 部分失败如实报告，不说"成功" */
    T('C16 标签管理', 'R123h 部分失败如实报告（不掩盖为成功）',
      /r\.failed\.length\s*\+\s*'\s*篇失败'/.test(app),
      '失败被掩盖');

    /* 路由 + 导航入口 */
    T('C16 标签管理', 'R123i 路由 #/tagadmin 已注册且有导航入口',
      /parts\[0\] === 'tagadmin'/.test(app) && /href="#\/tagadmin"/.test(app),
      '未注册路由或入口');

    /* CSS 类存在 */
    T('C16 标签管理', 'R123j .tagadmin-list 样式已定义',
      rules.some(function (r) { return /\.tagadmin-list/.test(r[0]); }),
      '未定义样式');
  }

  /* ================= C12：暖色档 ================= */
  {
    const warm = rules.filter(function (r) { return /^html\[data-theme="warm"\]$/.test(r[0].trim()); });
    T('C12 暖色档', 'R124 html[data-theme="warm"] 变量表存在',
      warm.length >= 1,
      '未定义暖色档');

    const body = warm.map(function (r) { return r[1]; }).join('\n');
    T('C12 暖色档', 'R124b 暖色档底色偏暖（非纯白）',
      /--bg-0:\s*#f6efe4/.test(body),
      '暖色底值未命中');

    /* ⚠ 关键：暖色档必须把浅底所需的结构变量也写全，
       否则会回落到 :root 的暗色值 —— 出现"暖底黑字块"的割裂 */
    T('C12 暖色档', 'R124c 结构变量齐备（panel/line/code-bg，不回落到暗色）',
      /--panel:/.test(body) && /--line:/.test(body) && /--code-bg:/.test(body),
      '缺结构变量 → 会回落暗色');

    /* 主题循环扩为三态 */
    T('C12 暖色档', 'R124d 主题循环含三档（dark/light/warm）',
      /THEME_ORDER\s*=\s*\['dark',\s*'light',\s*'warm'\]/.test(app),
      '循环未含 warm');

    /* theme-boot 白名单同步（否则冷启动暖色档会闪一下暗色） */
    T('C12 暖色档', 'R124e theme-boot 白名单含 warm（首绘前定色，无闪烁）',
      /ALLOWED\s*=\s*\['dark',\s*'light',\s*'warm'\]/.test(SRC.themeBoot),
      'theme-boot 未同步');

    /* applyTheme 用白名单校验而非 if(light) */
    T('C12 暖色档', 'R124f applyTheme 走白名单校验（脏值落回默认）',
      /THEME_ORDER\.indexOf\(mode\)\s*===\s*-1/.test(app),
      '未做白名单校验');
  }

  /* ================= C15：打印样式 ================= */
  {
    /* ⚠ cond 用词边界，否则 @media printX 也会被 /print/ 命中 → 假绿 */
    const printBlocks = mediaBlocks(css, function (c) { return /\bprint\b/.test(c); });
    T('C15 打印样式', 'R125 @media print 块存在（此前 0 处）',
      printBlocks.length >= 1,
      '未定义打印样式');

    const pb = printBlocks.map(function (b) { return b.body; }).join('\n');
    T('C15 打印样式', 'R125b 打印转白底黑字',
      /background:\s*#fff\s*!important/.test(pb) && /color:\s*#000\s*!important/.test(pb),
      '未转白底黑字');

        /* v3.6.1：'R125c —— 其守卫对象（氛围层）已整体移除，断言作废。 */

    T('C15 打印样式', 'R125d 打印时展开链接 URL（纸上可追）',
      /attr\(href\)/.test(pb),
      '未展开链接 URL');

    T('C15 打印样式', 'R125e 打印时隐藏交互件（按钮/导航/进度条/收藏/分页）',
      /\.card-mark/.test(pb) && /\.trail-back/.test(pb) && /\.progress-bar/.test(pb) && /\.to-top/.test(pb),
      '交互件未隐藏');

    T('C15 打印样式', 'R125f 打印避免卡片被切断（page-break-inside）',
      /page-break-inside:\s*avoid/.test(pb),
      '未处理分页切断');

    /* ---- C15b 面包屑渐变文字（v2.9.7） ----
       .crumb 在屏幕上走 background-clip:text + color:transparent。
       纸面上浏览器默认不打印背景图 ⇒ 渐变没了、字又是透明的 → 整行消失。
       这是"渐变文字"技法最典型的静默翻车点，必须有断言守着。 */
    T('C15 打印样式', 'R125g 打印还原面包屑实色（否则 color:transparent 在纸上整行消失）',
      /\.page-head \.crumb\s*\{[^}]*color:\s*#000\s*!important/.test(pb) &&
      /background:\s*none\s*!important/.test(pb) &&
      /background-clip:\s*border-box/.test(pb),
      '打印未还原 .crumb');

    const crumbBody = rules.filter(function (r) { return /^\.page-head \.crumb$/.test(r[0].trim()); })
      .map(function (r) { return r[1]; }).join('\n');
    T('C15 打印样式', 'R125h 面包屑渐变文字走变量 + background-clip:text（三主题自适应）',
      /background-image:\s*linear-gradient/.test(crumbBody) &&
      /var\(--text-dim\)/.test(crumbBody) && /var\(--cyan\)/.test(crumbBody) && /var\(--violet\)/.test(crumbBody) &&
      /background-clip:\s*text/.test(crumbBody) &&
      !/#00f0ff|#b537f2|#ff2a6d/i.test(crumbBody),
      crumbBody ? crumbBody.replace(/\s+/g, ' ').slice(0, 140) : '未找到 .page-head .crumb');
  }

  /* ================= 交叉一致性 ================= */
  {
    /* 每张卡片都要能收藏 + 显示时长（两个新元素都在 postCard 里） */
    const cardFrom = views.indexOf('function postCard');
    const cardTo = views.indexOf('function homeView');
    const card = views.slice(cardFrom, cardTo);
    T('交叉一致性', 'R126 卡片同时含收藏按钮与阅读时长',
      /card-mark/.test(card) && /meta-read/.test(card),
      '卡片缺任一新元素');

    /* 详情页与卡片共用同一套收藏委托（同一个 data-mark 契约） */
    T('交叉一致性', 'R126b 详情页与卡片共用 data-mark 契约',
      /data-mark="' \+ p\.id/.test(views) && /data-mark="' \+ p\.id/.test(card),
      '两处契约不一致');

    /* 所有列表页都要 applyMarks，否则收藏态在不同页面不一致 */
    const markApps = (app.match(/applyMarks\(/g) || []).length;
    T('交叉一致性', 'R126c 首页/搜索/收容所都盖了收藏态（≥3 处调用）',
      markApps >= 3,
      'applyMarks 调用点不足：' + markApps);
  }

  /* ============ 线上事故回归：半新半旧的视图层不许白屏 ============
     事故（2026-09-29）：版本号未变 ⇒ ?v= 缓存键不变 ⇒ 浏览器复用旧 views.js。
     旧 views 有 esc（所以旧的 V() 判定"可用"）却没有 marksView/tagAdminView，
     于是 V().marksView 是 undefined，调用即 TypeError；而 renderMarks 是 async，
     错误走 Promise rejection，`try { route() } catch` 的同步 try 【抓不到】→
     #/marks 永久停在 index.html 的 BOOTING TERMINAL 占位，整页空白且无任何提示。
     三处防线：① safeRoute 接住 async rejection；② V() 用必需函数清单识别半新半旧；
     ③ 降级视图补齐新函数签名，给可读提示而非 undefined 崩。 */
  {
    /* ① async rejection 必须被接住（只 try route() 不够） */
    T('线上事故回归', 'R127 路由安全包装接住 async 渲染的 rejection',
      /ret\s*=\s*route\(\)/.test(app) &&
      /typeof\s+ret\.then\s*===\s*'function'/.test(app) &&
      /ret\.catch\(/.test(app),
      'safeRoute 未接住 async 渲染的 rejection（错误会被吞，页面停在 BOOTING）');

    /* ② V() 不能只查 esc 就认账 */
    T('线上事故回归', 'R127b V() 用必需函数清单识别「半新半旧」的 views',
      /REQUIRED_VIEW_FNS/.test(app) &&
      /function\s+viewsUsable\s*\(/.test(app) &&
      /if\s*\(viewsUsable\(real\)\)\s*return\s+real/.test(app),
      'V() 仍只看 esc，旧 views 会被误判可用 → 新路由崩白屏');

    /* 清单必须真的覆盖 app.js 会调用的新函数（漏一个就仍会 undefined 崩） */
    T('线上事故回归', 'R127c 必需清单覆盖本批新增的视图函数',
      /'marksView'/.test(app) && /'tagAdminView'/.test(app) &&
      /'postTrail'/.test(app) && /'readingLabel'/.test(app),
      '必需函数清单漏了本批新增函数');

    /* ③ 降级视图也要有这些函数（否则 undefined(state) 直接 TypeError） */
    const fb = app.slice(app.indexOf('function buildViewFallback'), app.indexOf('function V()'));
    T('线上事故回归', 'R127d 降级视图补齐新函数（不返回 undefined 崩）',
      /marksView:/.test(fb) && /tagAdminView:/.test(fb) &&
      /postTrail:/.test(fb) && /readingLabel:/.test(fb) &&
      /readingMinutes:/.test(fb),
      '降级视图缺新函数 → V().marksView 仍是 undefined');

    /* ④ 提示文案要能指导用户（明确说"强制刷新"） */
    T('线上事故回归', 'R127e 降级提示明确指导强制刷新',
      /强制刷新/.test(fb) && /Ctrl\+Shift\+R/.test(fb),
      '降级提示未指导用户如何自救');
  }

  /* ================= 卡片标签 × 收藏按钮 避让（v2.6.2） =================
     ⚠ 事故：`.card-mark` 绝对定位贴右下角（right:10px / bottom:10px / 34×34），
     `.card-tags` 用 margin-left:auto 也推到最右 —— 两者抢占同一区域，
     标签多或名字长时必然重叠（实测「#指南」被收藏框压住）。
     修法：给 `.card-meta` 预留右侧空间，从布局上永久规避，
     而不是靠"标签别太多"这种约定。 */
  (function () {
    /* ⚠ topLevelRules 返回的是 [sel, body] 数组对，不是 {sel, body} 对象 */
    const rules = topLevelRules(SRC.css);
    const findRule = (name) => {
      const hit = rules.find((r) => r[0] === name);
      return hit ? hit[1] : null;
    };
    const metaBody = findRule('.card-meta');

    T('卡片避让', 'R128 .card-meta 预留右侧空间（收藏按钮宽度 + 间距）',
      !!metaBody && /padding-right\s*:\s*(4[0-9]|5[0-9])px/.test(metaBody),
      '.card-meta 未预留右侧空间 → 标签与收藏按钮会重叠');

    /* 反向：确认收藏按钮确实是贴右下角的绝对定位（前提成立才有避让的必要） */
    const markBody = findRule('.card-mark');
    T('卡片避让', 'R128b 收藏按钮仍贴卡片右下角（避让前提成立）',
      !!markBody && /position\s*:\s*absolute/.test(markBody) &&
      /right\s*:\s*10px/.test(markBody) && /bottom\s*:\s*10px/.test(markBody),
      '收藏按钮定位已变，避让策略需重新评估');

    /* 反向：标签确实靠右（margin-left:auto）——这才是撞车的原因 */
    const tagsBody = findRule('.card-tags');
    T('卡片避让', 'R128c 标签行靠右对齐（撞车原因）',
      !!tagsBody && /margin-left\s*:\s*auto/.test(tagsBody),
      '标签行不再靠右，避让策略可简化');

    /* 避让必须"真够"：预留宽度 ≥ 按钮宽 + 按钮右偏移，
       否则按钮仍会压到标签右端（擦边而非规避）。
       ⚠ 不要拿 padding-right 直接比 width —— 两者性质不同（内边距 vs 元素宽），
       必须把按钮的 right 偏移也算进去，才是它实际占用的横向范围。 */
    const num = (body, re) => {
      const m = body ? body.match(re) : null;
      return m ? Number(m[1]) : NaN;
    };
    const reserved = num(metaBody, /padding-right\s*:\s*(\d+)px/);
    const markW = num(markBody, /width\s*:\s*(\d+)px/);
    const markRight = num(markBody, /right\s*:\s*(\d+)px/);
    T('卡片避让', 'R128d 预留宽度 ≥ 按钮宽 + 右偏移（真规避，非擦边）',
      !isNaN(reserved) && !isNaN(markW) && !isNaN(markRight) &&
      reserved >= markW + markRight,
      '预留 ' + reserved + 'px < 按钮 ' + markW + 'px + 偏移 ' + markRight + 'px → 仍会重叠');

    /* 结构侧：卡片确实同时渲染了 meta 行与收藏按钮（同一容器内才谈得上避让） */
    T('卡片避让', 'R128e 卡片同时含 .card-meta 与 .card-mark（同容器）',
      /class="card-meta"/.test(SRC.views) && /class="card-mark/.test(SRC.views),
      '卡片结构已变，避让断言失效');
  })();

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { name: '体验批次 v2.7', run: run };
standalone(module, run);
