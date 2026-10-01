'use strict';
/* ============================================================
   tests/cases/35-v2-8-0-电台.js — v2.8.0 电台播放器

   覆盖四层：
     ① 内核行为（js/radio.js）—— 用 jsdom + 真源码 eval，桩 Audio 观测真实调用
     ② 数据层契约（js/cloud.js）—— 字段白名单 / MIME / 体积上限 / 路径
     ③ 界面结构（js/views.js）—— 关键控件与可访问性属性存在
     ④ 样式（css/style.css）—— 定位/滚动约束/截断/reduce 归零

   写法原则（同 29–34 号）：行为 > 语义 > 字面；每条可反向验证。

   ⚠ 三条本 case 特有的坑（踩过）：
     · jsdom 需要 runScripts:'outside-only' 才能让 w.eval 里的 window 生效
     · 续签定时器长达 2h 且自续，**测完必须 destroy()**，否则 Node 进程不退出
     · jsdom 无真实 Audio —— 必须用桩，且要观测 setAttribute 等调用而非只读属性
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, stripComments, stripJsLineComments } = require('../common');

/* 顶层规则遍历器（剥选择器内注释，同 33/34 号）。
   ⚠ 返回 [sel, body] 数组对，不是 {sel, body} 对象。 */
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

/* 按花括号配平提取 @media 块。
   ⚠ 不能用「从 @media print 一直贪婪到字符串结尾」的写法 —— print 块
   **不在文件末尾**（后面还有整段电台样式），贪婪会把它们一并吞进来，
   于是主样式里的 .radio-dock[hidden] 隐藏规则被当成"打印隐藏"命中
   → 摘掉实现也照样绿（假绿，实测踩过）。 */
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

/* 按花括号配平提取 `function <name>(...) { ... }` 的函数体。
   ⚠ 为什么必须这么做（v2.9.3 实测假绿）：若只写「函数名 ⋯ 900 字符内出现 X」
   这种带大窗口的懒匹配，窗口会**跨出函数边界**，蹭到后面别的代码里的 X ——
   于是「把函数体内那行赋值删掉」也照样绿。
   提取出函数体再断言，匹配范围就被物理限制死了。 */
function fnBody(src, name) {
  const key = 'function ' + name;
  const i = src.indexOf(key);
  if (i < 0) return '';
  const b = src.indexOf('{', i);
  if (b < 0) return '';
  let d = 0;
  let j = b;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) break; }
  }
  return src.slice(b + 1, j);
}

/* ⚠ v5.6.3：这一块（makeAudioStub / bootRadio / wait / ROWS）是给 <audio> 内核
   用的 harness —— radio.js 已删除，随之移除。电台现在的播放由网易云官方 iframe
   承担，本站既不持有音频、也不推进进度。 */

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;

  const app = SRC.app;
  const cloud = SRC.cloud;
  const views = SRC.views;
  const css = SRC.css;
  const html = SRC.html;

  /* ⚠ v5.6.3：①「内核行为」整段（R129~R139c 共 49 条）已随 radio.js 删除 ——
     那个 <audio> 内核不再被 index.html 加载、运行时代码里也无人调用。
     电台播放现在完全交给网易云官方 outchain iframe（断言见 54 号）。 */

  /* ================= ② 数据层契约 ================= */
  {
    /* ---------- v5.6.1：base64 时代的 8 条断言已退役 ----------
       R140（AUDIO_TYPES MIME 白名单）/ R140b（AUDIO_MAX）/ R140c（FileReader → data URL）
       / R140d（AUDIO_DATA_MAX 覆盖 base64 最坏长度）
       / R141d（RADIO_DATA_FIELDS 单行取音频）/ R141e（RADIO_VIEW_ONLY 登记 has_data）
       / R142b（读出的 data URL 二次量长）/ R143（playUrl 取库内 data URL）
       —— 它们钉的都是"音频以 base64 存库"那条管道；该管道在 v5.0.0 随
       「电台 = 网易云条目」整体退役，cloud.js 里对应的
       readAudio / probeDuration / trackData / create / addTrack / probeSourceUrl /
       neteaseEmbedUrl / isEmbedUrl / addByUrl / playUrl 与 AUDIO_* 常量、
       音频 LRU 缓存已按 HANDOVER §6 审计清单 ① 删除（v5.6.1）。
       ⚠ 退役时**逐条**处理，不做批量正则替换（§6 记着"括号配平批量退役"的翻车教训）。
       ⚠ 本轮新增的"清理守卫"一律扫**剥过注释**的源码：cloud.js 的清理纪要里
       就写着这些被删掉的名字，用原文扫会自己把自己判红（第一版实测踩到）。 */
    const cloudCode = stripJsLineComments(stripComments(cloud));
    /* ⚠ cloudCode 必须在**本块最前面**声明：R141d 就要用它，
       声明写在中途会撞 temporal dead zone（"Cannot access before initialization"），
       而且只有那一条会红 —— 典型难查的错法（v5.6.1 实测踩到）。 */

    /* 字段白名单：列表只取展示必需字段 */
    T('数据层', 'R141 列表查询使用显式字段清单（非 select('*')）',
      /RADIO_FIELDS\s*=/.test(cloud) && /select\(RADIO_FIELDS\)/.test(cloud),
      '未走字段白名单');

    T('数据层', 'R141b 列表按 sort_order + id 双排序（顺序稳定不跳动）',
      /order\('sort_order'[\s\S]{0,80}?order\('id'/.test(cloud),
      '排序不完整');

    /* ⚠⚠ 列表字段里**绝不能有 data** —— 否则「打开面板」等于「下载整个曲库」，
       每首十几 MB，两首就卡死。这是本架构最容易被后人改错的地方，必须钉死。 */
    const fieldList = (cloud.match(/RADIO_FIELDS\s*=\s*'([^']*)'/) || ['', ''])[1];
    T('数据层', 'R141c 列表字段白名单不含 data（否则开面板要下全库音频）',
      fieldList.length > 0 && !/(^|,)\s*data\s*(,|$)/.test(fieldList),
      'RADIO_FIELDS = ' + fieldList);

    T('数据层', 'R141d 音频走单行查询按 id 取一首（绝不整表拉音频）',
      /* ⚠ v5.6.1 退役原判据（RADIO_DATA_FIELDS 单行取 base64）。
         翻转为**清理守卫**：base64 取音频的通道必须不存在。
         ⚠ 不能写「全文件不得出现 .select(...data...)」—— 图片那条活的读取路径
           正是 `.select('id,content_type,data,width,height')`（实测踩到误伤）。
           这里只钉电台那三个**专属**标识。 */
      !/RADIO_DATA_FIELDS/.test(cloudCode) && !/trackData/.test(cloudCode) &&
      !/id,data,mime/.test(cloudCode) &&
      !/(^|,)\s*data\s*(,|$)/.test(fieldList),
      '又出现了音频 data 列的读取通道');

    /* ⚠⚠⚠ v2.9.2 实测事故（用户上传时报「column radio_tracks.has_data does not exist」）：
       读/写**两套字段清单必须分开**。has_data 是视图 public_radio 里**算出来**的列
       （`data IS NOT NULL`），基表 radio_tracks 根本没有它。写路径若图省事复用
       RADIO_FIELDS，PostgREST 会生成 `INSERT … RETURNING …, has_data` → 42703，
       **上传直接失败**，而列表读取却一切正常 —— 症状极具误导性。
       ⚠ 实现里的**注释也写了这些标识符** ⇒ 必须先剥注释（块 + 行）再扫。
       ⚠ 下面不满足于扫字面：把常量声明块整段抽出来**真跑一遍**，
         直接在"实际生效的值"上断言 —— 后人换种写法重构也不会误红。 */
    const constBlock = (function () {
      /* ⚠ 切到**分号**为止，不能切到 `var RADIO_FIELDS` 这个位置 ——
         后者会把声明本身排除在外，eval 出来就是 "RADIO_FIELDS is not defined"
         （v5.6.1 改判时实测踩到，R141f/R141g 两条同时红）。 */
      const s = cloudCode.indexOf('var RADIO_READ_TABLE');
      const e = cloudCode.indexOf(';', cloudCode.indexOf('var RADIO_FIELDS'));
      return (s >= 0 && e > s) ? cloudCode.slice(s, e + 1) : '';
    })();
    let RC = null;
    try {
      RC = new Function(constBlock +
        '\nreturn { F: RADIO_FIELDS, R: RADIO_READ_TABLE };')();
    } catch (e) { RC = null; }

    const cols = function (s) { return String(s || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean); };
    /* v5.6.1 退役：R141e「RADIO_VIEW_ONLY 登记 has_data」—— 视图专有列清单随
       base64 管道一起删掉了（has_data 这个概念在 v5.0.0 就已不存在）。 */

    /* v5.0.0：电台改为「网易云条目」，has_data 概念消失（每条都必然可播）。
       改判：读清单必须带 kind / netease_id / source_url —— 界面靠它们决定摆 66px 还是 430px 播放器。 */
    T('数据层', 'R141f 读清单含 kind/netease_id/source_url（界面靠它决定播放器形态）',
      !!RC && cols(RC.F).indexOf('kind') >= 0 && cols(RC.F).indexOf('netease_id') >= 0 &&
      cols(RC.F).indexOf('source_url') >= 0,
      RC ? 'RADIO_FIELDS = ' + RC.F : '常量块求值失败');

    T('数据层', 'R141g 写路径复用同一套清单（RADIO_FIELDS），且不含任何已删列',
      /* ⚠ v5.6.1 改判：原先比的是"RADIO_WRITE_FIELDS = 读清单 − 视图专有列"。
         v5 的写入口 add() 直接 select(RADIO_FIELDS) —— 两套清单合一，
         因为视图专有列（has_data）已经没有了。守的东西不变：
         写路径返回的列必须与读路径一致，且不得回到 data/mime/storage_path 那批已删列。 */
      !!RC && (function () {
        const f = cols(RC.F);
        const addPath = cloudCode.slice(cloudCode.indexOf('add: async function'));
        return f.indexOf('title') >= 0 && f.indexOf('created_at') >= 0 &&
          f.indexOf('data') < 0 && f.indexOf('mime') < 0 && f.indexOf('has_data') < 0 &&
          /insert\(row\)\.select\(RADIO_FIELDS\)/.test(addPath);
      })(),
      RC ? '写路径清单可疑：' + RC.F : '常量块求值失败');

    T('数据层', 'R141h v5 的写入不再碰任何已删列（data / has_data / mime 都不该再出现）',
      /parseNetease/.test(cloudCode) && /buildEmbedUrl/.test(cloudCode) &&
      !/has_data/.test(cloudCode) && !/duration_sec/.test(cloudCode) &&
      !/cover_url/.test(cloudCode) && !/AUDIO_/.test(cloudCode) &&
      !/\.select\('id,data,mime'\)/.test(cloudCode),
      '写入路径仍引用已删列 / 已删的 base64 常量');

    /* v5.6.1 退役：R141i「入库返回的行补 has_data」—— has_data 已随管道删除。 */

    /* 入库前校验：标题必填 + 长度上限。
       ⚠ v5.6.1 改口径：base64 时代的上传入口 create() 文案（"请填写曲目名称"）已删除，
       现在唯一入口是 add()，文案是"请填写条目名称（单曲名或歌单名）"与"名称不能超过 200 字"。 */
    T('数据层', 'R142 入库前校验标题必填与长度上限',
      /请填写条目名称/.test(cloudCode) && /名称不能超过 200 字/.test(cloudCode),
      '缺少标题校验');

    /* v5.6.1 退役：R142b「读出的 data URL 再量一次长度」—— 不再有 base64 二次体积关
       （文件上传整条路在 v5.0.0 就移除了，AUDIO_DATA_MAX 随 ① 一并删除）。 */

    /* 音频本体与记录同行 ⇒ 删记录即删音频；不得再残留存储补偿逻辑 */
    const removeBody = cloud.slice(cloud.indexOf('removeTrack: async function'));
    T('数据层', 'R142c removeTrack 只删库记录（本体随行删除，无存储孤儿）',
      /from\(RADIO_WRITE_TABLE\)\.delete\(\)\.eq\('id'/.test(removeBody) &&
      !/storage\.remove/.test(removeBody),
      '仍残留云存储删除逻辑');

    /* v5.6.1 从 R143 原判据（playUrl 取库内 data URL）**改判为清理守卫**：
       网易云条目自带 source_url（官方播放器地址），界面直接渲染 iframe，
       不再有"取可播放地址"这一步 —— playUrl / trackData 必须彻底消失，
       且整条路径都不得再依赖登录态与签名 URL。 */
    T('数据层', 'R143 播放地址不再走 base64（条目自带 source_url，界面渲染官方 iframe）',
      /* ⚠ 必须扫**剥过注释**的 cloudCode：cloud.js 的清理纪要里就写着这些名字，
         用原文扫会自己把自己判红（实测踩到）。
         ⚠ 不能写 !/signedUrl/ —— 附件下载（Storage.signedUrl）是**另一条活路**，
           与电台无关，扫全文件会误伤（实测踩到）。这里只钉电台那条：
           音频取址通道（playUrl / trackData / data 列）必须彻底消失。 */
      !/playUrl/.test(cloudCode) && !/trackData/.test(cloudCode) &&
      !/RADIO_DATA_FIELDS/.test(cloudCode) &&
      /source_url:\s*Radio\.buildEmbedUrl\(/.test(cloudCode),
      '播放地址仍在走 base64 取址那条死路');

    /* ⚠⚠ 签名有效期：平台硬上限 3600 秒（SDK 的 validateSignedURLTTL 硬校验）。
       v2.8.0 首次上线时写了 7200 → createSignedUrl 直接抛
       "Signed URL expiry must be an integer between 1 and 3600 seconds."
       → 播放链路第一步就炸，点播放毫无反应（2026-09-29 真实故障。
       当年静态测试放过了 —— 旧断言只查「存在 AUDIO_TTL」却不管数值，典型假绿）。
       现在改成**全量扫描**：数据层里每个 TTL 兜底值都必须在区间内，
       不依赖任何特定常量名 —— 改名、新增、写死数字都绕不过去。 */
    const maxM = cloud.match(/SIGNED_TTL_MAX\s*=\s*(\d+)/);
    const minM = cloud.match(/SIGNED_TTL_MIN\s*=\s*(\d+)/);
    const maxVal = maxM ? Number(maxM[1]) : NaN;
    const minVal = minM ? Number(minM[1]) : NaN;

    T('数据层', 'R143a 平台签名上限定义为 3600 秒（SDK 硬约束，不可调大）',
      maxVal === 3600 && minVal === 1,
      'MAX=' + maxVal + ' / MIN=' + minVal);

    const ttlFbs = [];
    let tm;
    const fbRe = /clampTtl\([^,]+,\s*(\d+)\)/g;
    while ((tm = fbRe.exec(cloud))) ttlFbs.push(Number(tm[1]));
    const defRe = /SIGNED_TTL_DEFAULT\s*=\s*(\d+)/g;
    while ((tm = defRe.exec(cloud))) ttlFbs.push(Number(tm[1]));

    T('数据层', 'R143b 数据层所有 TTL 兜底值都落在合法区间内（全量扫描，非单点抽检）',
      ttlFbs.length > 0 && ttlFbs.every((v) => v >= minVal && v <= maxVal),
      '兜底值 [' + ttlFbs.join(', ') + '] 须全部落在 ' + minVal + '..' + maxVal);

    /* 出口夹取：任何调用方传越界值都不该炸链路 —— 真跑一遍边界 */
    const fnM = cloud.match(/\n  function clampTtl\(ttl, fallback\)\s*\{[\s\S]*?\n  \}/);
    let clampOk = false;
    let clampDetail = '未找到 clampTtl';
    if (fnM && Number.isFinite(maxVal) && Number.isFinite(minVal)) {
      try {
        const fn = new Function('SIGNED_TTL_MIN', 'SIGNED_TTL_MAX',
          fnM[0] + '\n  return clampTtl;')(minVal, maxVal);
        const cases = [[99999, maxVal], [7200, maxVal], [0, minVal], [-5, minVal],
                       [1800, 1800], [maxVal, maxVal], [minVal, minVal]];
        const got = cases.map((c) => fn(c[0], 1800));
        clampOk = cases.every((c, i) => got[i] === c[1]);
        clampDetail = cases.map((c, i) => c[0] + '->' + got[i]).join(' ');
      } catch (e) { clampDetail = 'eval 失败: ' + e.message; }
    }
    T('数据层', 'R143d 签名有效期出口统一夹取（越界值不炸链路）',
      clampOk, clampDetail);

    T('数据层', 'R143e signedUrl 走 clampTtl 下发（唯一出口未绕过）',
      /createSignedUrl\(path,\s*clampTtl\(/.test(cloud),
      'signedUrl 未夹取 ttl');

    /* v5.6.3 退役：R143f「内核不自带 TTL 兜底常数」—— 判据扫的是 radio.js，
       而那个内核已删除（整个文件是死代码）。TTL 的单一来源现在只剩数据层自己，
       由上面的 R143a/R143b/R143d/R143e 继续守着。 */

    /* 「所有人可听」的实现基石：读的是**公开视图**（anon 有 SELECT），不是基表 */
    T('数据层', 'R143g 读取来源是公开视图 public_radio（这才是"所有人可听"）',
      /RADIO_READ_TABLE\s*=\s*'public_radio'/.test(cloud) &&
      /from\(RADIO_READ_TABLE\)/.test(cloud),
      '读取来源不是公开视图');

    /* v5.6.1 退役：R143h / R143i / R143j / R143c ——
       · R143h/i/j 钉的是"取回的 base64 data URL 出入 LRU 缓存"（条数 + 字符总量双限、
         删曲目时清缓存、真跑一遍淘汰）。条目不再有本体可缓存，radioCache 全家
         （含三个常量与三个函数）已随 ① 删除。
       · R143c 钉 `owner_id: meta.owner_id` 这个赋值形状（防被 Number() 包住）。
         v5 的写入口 add() 里 owner_id 直接来自 uid 参数（add(row) 的 row.owner_id = uid），
         字面形状变了；owner_id 仍是 text（库列类型 + RLS 契约），
         但已无任何"可能被数字化的赋值点"可钉，故一并退役。 */
  }

  /* ================= ③ 界面结构 ================= */
  {
    /* ⚠ v5.6.1：v2.8.0 的 10 条"迷你条 / 面板"断言（R144 / R144b / R145 / R145b /
       R145c / R145d / R146 / R146b / R146c / R146d）已随视图出口一起退役 ——
       容器与函数都没了（审计清单 ②）。这里换成**现在真正活着**的那一版：
       电台页（radioView）+ 常驻控制台（paintStage）。 */

    /* 电台页：条目列表 + 播放/管理入口 */
    T('界面 · 电台页', 'R144 条目列表渲染成卡片，每张带可点播的播放键与标题',
      /class="radio-board"/.test(views) && /class="radio-card/.test(views) &&
      /data-radio-act="playitem"/.test(views) && /radio-card-title/.test(views) &&
      /radio-card-id/.test(views),
      '电台页列表结构缺失');

    T('界面 · 电台页', 'R144b 播放键可被读屏识别（aria-label 带条目名）',
      /data-radio-act="playitem"[\s\S]{0,120}?aria-label="播放 /.test(views),
      '播放键缺 aria-label');

    /* v5.1.0：控制台在 #app 之外常驻；单曲 66px / 歌单 430px 官方条 */
    T('界面 · 控制台', 'R145 官方播放器按类型给高度（单曲 66 / 歌单 430）',
      /\/type=0\/\.test\(url\)\s*\?\s*'430'\s*:\s*'66'/.test(app),
      '未按类型区分播放器高度');

    T('界面 · 控制台', 'R145b 同一个地址不重建 iframe（重建 = 重新加载 = 歌断掉）',
      /RC_STATE\.mounted === url\) return/.test(app) && /RC_STATE\.mounted = url/.test(app),
      '缺少"地址未变则不重建"的守卫');

    T('界面 · 控制台', 'R145c 控制台给出"加载不出来"的兜底链接（新窗口打开）',
      /rc-fallback/.test(app) && /target="_blank"/.test(app),
      '缺少兜底链接');

    T('界面 · 控制台', 'R145d mini / full 两种体型由路由决定（切页不断歌）',
      /setAttribute\('data-mode',\s*isFull \? 'full' : 'mini'\)/.test(app),
      '未按路由切换 data-mode');

    /* 条目信息：标题 / 类型 / 网易云 id 三样都要露出来 */
    T('界面 · 信息', 'R146 卡片显示标题、类型标签与网易云 id',
      /'歌单' : '单曲'/.test(views) && /it\.netease_id/.test(views) &&
      /radio-card-artist/.test(views),
      '条目信息不完整');

    /* v5.0.0：每条条目都必然可播（网易云官方播放器），has_data 概念消失 ——
       原先"禁用不可播旧记录"的分支已无对应物，改钉"不再出现死按钮判据"。
       ⚠ 必须先剥注释：views.js 的清理纪要里就写着 has_data（实测踩到误伤）。 */
    const viewsCode = stripJsLineComments(stripComments(views));
    T('界面 · 信息', 'R146b 视图不再依赖 has_data（v5 每条条目都必然可播）',
      !/has_data/.test(viewsCode) && !/radio-track-warn/.test(viewsCode),
      '视图仍按 has_data 判断可播性');

    /* 管理：上传 / 删除 / 排序 */
    /* v5.0.0：本地文件上传按站长决定移除，表单改为"网易云条目" */
    T('界面 · 管理', 'R147 管理区含网易云条目表单（名称 / 备注 / 链接或 id / 类型）',
      /data-radio-field="title"/.test(views) && /data-radio-field="artist"/.test(views) &&
      /data-radio-field="url"/.test(views) && /data-radio-field="kind"/.test(views),
      '条目表单字段不全');

    T('界面 · 管理', 'R147b 管理区含删除与上下移动',
      /data-radio-act="del"/.test(views) && /data-radio-act="up"/.test(views) &&
      /data-radio-act="down"/.test(views),
      '管理操作不全');

    T('界面 · 管理', 'R147c 类型选择器提供 自动/单曲/歌单 三档，且**不再有文件输入**',
      /<option value="auto"/.test(views) && /<option value="song"/.test(views) &&
      /<option value="playlist"/.test(views) &&
      /* ⚠ 别写成全站 !/type="file"/ —— 编辑器上传图片那里也有 type="file"（实测踩到）。
         只看**电台表单块**里有没有残留。 */
      !/data-radio-form[\s\S]{0,1600}?type="file"/.test(views),
      '类型选择器不全或电台表单里仍残留文件输入');

    /* 可访问性：每个纯图标按钮都要有 aria-label */
    const bareButtons = (views.match(/<button(?![^>]*aria-label)[^>]*>\s*<span aria-hidden/g) || []).length;
    T('界面 · 无障碍', 'R148 图标按钮均带 aria-label（读屏可辨）',
      bareButtons === 0, bareButtons + ' 个图标按钮缺 aria-label');

    /* v5.6.1 从 R149 原判据**改判**：原断言扫的是"整个 views.js 无内联事件属性"，
       而它真正想守的只有电台那一块。现在改成扫**电台页视图源码**（radioView），
       范围更准，也能挡住"给电台卡片加 onchange=" 这类回归。
       ⚠ 不用全站版：editor/boot 那些块与电台无关，红起来指向不明。 */
    var radioSrcBlock = '';
    (function () {
      var i = views.indexOf('function radioView(');
      if (i < 0) return;
      var b = views.indexOf('{', i);
      var d = 0;
      for (var j = b; j < views.length; j++) {
        if (views[j] === '{') d++;
        else if (views[j] === '}') { d--; if (d === 0) { radioSrcBlock = views.slice(b + 1, j); break; } }
      }
    })();
    T('界面 · CSP', 'R149 电台页无内联事件属性（CSP 禁内联；事件全走 data-radio-act + 代理）',
      radioSrcBlock.length > 0 && !/\son[a-z]+\s*=\s*["']/i.test(radioSrcBlock) &&
      /data-radio-act/.test(radioSrcBlock),
      radioSrcBlock.length ? '出现内联事件属性' : '没有取到 radioView 函数体');

    /* ⚠⚠ v5.6.1：原先还有一条"跨文件 CSP 前提"的路标注释（曲目播放地址是 data URL、
       读时长用 blob URL，故 index.html 必须有 media-src 且放行 data:/blob:）。
       条目改成网易云官方 iframe 后**不再需要** media-src 放宽（那条放宽已在 v5 收回），
       本 case 这里只留这段说明；media-src 的现状由 13-m-csp.js 与 54 号的 R297 守着。 */

    /* v5.6.1 退役：R168 / R168b / R168c（"订阅内核 timeupdate，进度条与总时长要跟着走"）。
       整条前提已不存在 —— 播放由网易云官方播放器（iframe）自己负责，
       本站既不拿音频进度、也不画进度条；paintPanelProgress 与 [data-radio-dur]
       随审计清单 ② 一并删除。 */

    /* 挂载点必须在 #app 之外 —— 否则路由重写会打断播放 */
    const bodyStart = html.indexOf('<main class="wrap"');
    const dockIdx = html.indexOf('id="radio-stage"');
    T('界面 · 挂载', 'R150 ★ 播放器容器（#radio-stage）挂在 #app 之外（路由重写不打断播放；v5.2.0 起旧 dock 已移除）',
      dockIdx > 0 && dockIdx < bodyStart,
      'dock 位置 idx=' + dockIdx + '，main idx=' + bodyStart);

    T('界面 · 挂载', 'R150b radio.js 在 app.js 之前加载（初始化时可用）',
      html.indexOf('js/radio.js') > 0 &&
      html.indexOf('js/radio.js') < html.indexOf('js/app.js'),
      '加载顺序错误');
  }

  /* ================= ④ app.js 接线 ================= */
  {
    /* v5.6.1：R151 原判据（boot 里调 initRadio 且包 try）已退役 ——
       initRadio 随审计清单 ② 删除。改钉**现在这条**启动路：
       电台代理绑定一次 + 条目延后到首绘之后才拉（v5.3.0 的启动加速，
       访客多半不开电台，不该为首屏付一次跨区往返）。 */
    T('接线', 'R151 启动流程按 v5.3.0 的方式起电台（代理只绑一次 + 首绘后再拉条目）',
      /function bindRadioPageOnce\(\)/.test(app) &&
      /bindRadioPageOnce\(\);\s*\/\*[^*]*v5\.3\.0/.test(app) &&
      /requestIdleCallback\(function \(\) \{ rcLoad\(\); \}/.test(app),
      '电台启动路径与 v5.3.0 的约定不一致');

    T('接线', 'R151b 事件用代理绑定（委托一次，重渲染不失效）',
      /* ⚠ 旧判据绑在 radioDockEl / radio-panel-host 上（容器与函数都没了）。
         v5 的委托点是 document 上的 [data-radio-act] —— 卡片整块重渲染也不会失效。 */
      /function bindRadioPage\(\) \{[\s\S]{0,200}?document\.addEventListener\('click'/.test(app) &&
      /function bindRadioPageOnce\(\) \{[\s\S]{0,200}?rcPageBound = true/.test(app),
      '未用事件代理');

    T('接线', 'R151c 代理覆盖电台页全部动作（playitem / up / down / del / additem）',
      (function () {
        const need = ['playitem', 'up', 'down', 'del', 'additem'];
        const i = app.indexOf('function bindRadioPage(');
        const j = app.indexOf('function route()', i);
        const body = (i >= 0 && j > i) ? app.slice(i, j) : '';
        return body.length > 0 && need.every(function (a) {
          return new RegExp("act === '" + a + "'").test(body);
        });
      })(),
      '有动作没接上');

    /* v5.6.1 退役：R151c（拖动进度条不回写 value）、R152（RadioUI.busy 防重复提交）、
       R153b（restoreFormDraft 表单草稿）、R153（点面板外/Esc 收起面板）——
       它们钉的都是旧面板的交互件，容器与函数都已删除。
       ⚠ 防重复提交这一条值得说一句：新表单是"点一次 → 立刻写库 → rcLoad → 重绘"，
       没有按钮常驻可连点的窗口（写入中会把状态写在表单提示位），
       故不需要 busy 标志；真要防连点，那是新页面自己的事，不是被删代码的遗产。 */

    /* 上传前校验并给具体原因 */
    T('接线', 'R152b 入库前校验并给具体原因（未登录 / 缺字段 / 认不出链接）',
      /say\('请先登录'/.test(app) &&
      /say\('名称与链接都要填'/.test(app) &&
      /errMsg\(e2, '加入失败'\)/.test(app),
      '缺少入库前校验或具体原因');

    /* 权限：只读收听 vs 管理 */
    T('接线', 'R154 管理能力依赖登录态（未登录只读收听）',
      /function\s+canManageRadio/.test(app) &&
      /State\.session\s*&&\s*State\.session\.user/.test(app.slice(app.indexOf('function canManageRadio'), app.indexOf('function canManageRadio') + 300)),
      '权限判断缺失');

    /* v5.6.1 退役：R167「访客队列摘掉无音频本体的旧记录」——
       判据（radioQueue + has_data !== false）随 base64 时代一起删除：
       v5 的条目条条可播，没有"访客不该看到的死记录"这回事了。 */

    /* ⚠ 条目按身份渲染（未登录访客没有增删排序入口）⇒ 身份一变必须重取。
       v5.6.1：重取调用从旧面板的 loadRadioTracks() 换成现在这条真路 rcLoad()。

       ⚠ 判据不能靠"固定字符数"或"第一个 });"定位：v4.9.0 给 SIGNED_IN 分支加了
         收藏迁移 + 刷新（几十行，内部自带 }); ），这两种写法都假红过一次。
         改用 boot 里紧跟在注册之后的那条 catch 作为结束锚点。 */
    const authIdx = app.indexOf('onAuthStateChange(function');
    const authEnd = authIdx >= 0 ? app.indexOf('} catch (e) { /* 监听失败', authIdx) : -1;
    const authBody = (authIdx >= 0 && authEnd > authIdx) ? app.slice(authIdx, authEnd) : '';
    T('接线', 'R167b 身份变化后重取电台条目（否则登录后界面不反映管理入口）',
      authBody.length > 0 && /rcLoad\(\)/.test(authBody),
      '登录态变化未重取条目');
  }

  /* ================= ⑤ 样式 ================= */
  {
    /* ⚠ v5.6.2（审计清单 ④ 落地）：v2.8.0 的 dock/panel 样式已整段删除，
       本节原有 10 条"守着已删样式"的断言随之退役 ——
       R155 / R155b（dock 定位与避让）、R156（面板滚动上限）、
       R159 / R159b（dock 与曲目行的截断）、R160 / R160c / R160d / R160e（dock 的
       脉冲、毛玻璃、跑马灯与 hover 归属）、R164（body.has-radio 让位）、
       R164b（has-radio 判据）、R165（打印隐藏 dock）。
       它们钉的类名在 views.js / app.js / index.html 里**零标记**，只剩 CSS 自己引用自己。
       改判到**现在真正活着**的那台常驻控制台（.radio-console / .rc-*）上。 */

    const rules = topLevelRules(css);
    const findRule = (name) => {
      const hit = rules.find((r) => r[0] === name);
      return hit ? hit[1] : null;
    };

    T('样式', 'R155c --topbar-h 已定义为变量（单一来源）',
      /--topbar-h\s*:\s*\d+px/.test(css), '未定义 --topbar-h');

    /* 长文本截断：曲名过长不能撑破容器（控制台右侧标题那一格） */
    T('响应式', 'R159 长标题截断（ellipsis）不撑破容器',
      /text-overflow\s*:\s*ellipsis/.test(findRule('.rc-title') || '') &&
      /text-overflow\s*:\s*ellipsis/.test(findRule('.radio-card-title') || ''),
      '缺少截断');

    /* 弹性子项 min-width:0 —— 不加则 ellipsis 失效。
       ⚠ 控制台那个槽位是字号/长度都可变的 iframe 宿主，窄屏下最容易被内容顶破。 */
    T('响应式', 'R159b 弹性子项设 min-width:0（否则 ellipsis / iframe 会顶破容器）',
      /min-width\s*:\s*0/.test(findRule('.rc-slot') || ''),
      '缺少 min-width:0');

    /* reduce 归零：控制台的两个无限循环装饰动画必须登记。
       ⚠ 与旧断言同一套道理：它们是**无限循环**的裸时长 animation，
          R66m 只扫 transition、R72k 只认 --t-*，谁都不会替我关掉。 */
    T('样式 · reduce', 'R160 reduce 块关掉控制台的指针扫频与 VU 电平（无限循环装饰动画）',
      /\.rc-tune-needle,\s*\.rc-vu i\s*\{\s*animation:\s*none\s*!important/.test(css),
      'reduce 未关闭控制台动画');

    T('样式 · reduce', 'R160c reduce 块把指针摆回中位（停转后不能停在随机相位）',
      /\.rc-tune-needle\s*\{\s*left:\s*40%\s*!important/.test(css),
      'reduce 未复位指针');

    T('样式 · reduce', 'R160d reduce 块关掉底栏与帮助面板的毛玻璃（省算力）',
      /* ⚠ v5.6.2：旧判据扫的是 `.radio-dock-inner, .radio-panel` 那两项（已删）。
         现在守的是这条规则本身还在，且**不许**把已删的电台浮层再写回来。 */
      /\.topbar,\s*\.kbd-help\s*\{\s*backdrop-filter:\s*none\s*!important/.test(css) &&
      !/\.radio-dock-inner,\s*\.radio-panel\s*\{\s*backdrop-filter/.test(css),
      'reduce 未关毛玻璃，或已删的旧浮层又回来了');

    /* 三档主题：控制台内部**刻意**用局部变量模拟实体机器（木纹/金属不跟主题翻），
       但它不该硬编码本站在用的那四个霓虹色 —— 那是"换主题就露馅"的老坑。
       ⚠ 这条比原来更严：旧版只看 dock 一条规则，现在扫整段控制台。 */
    const consoleBlock = (function () {
      var i = css.indexOf('/* ============================================================\n   v5.1.0：电台常驻控制台');
      if (i < 0) i = css.indexOf('v5.1.0：电台常驻控制台');
      var j = css.indexOf('/* 电台页 */', i);
      return (i >= 0 && j > i) ? css.slice(i, j) : '';
    })();
    T('样式 · 主题', 'R161 控制台不硬编码本站霓虹色（材质走它自己的局部变量）',
      consoleBlock.length > 0 && !/#00f0ff|#ff2a6d|#b537f2|#f9f002/i.test(consoleBlock),
      consoleBlock.length ? '硬编码了霓虹色' : '没取到控制台样式段');

    /* ---------- 与固定控制台的布局避让 ----------
       ⚠ v5.6.2 改判：旧版是"dock 固定在左上，正文顶部让出 84px"（body.has-radio）。
         新控制台固定在**右下/底部居中**，所以正文改在**底部**让位：
         电台页给 240px，否则最后一条条目会被控制台盖住。 */
    const reserveSel = rules.find((r) => /data-mode="full"/.test(r[0]) && /#app/.test(r[0]));
    T('样式 · 避让', 'R164 电台页底部让出控制台高度（最后一条不被盖住）',
      !!reserveSel && /padding-bottom\s*:\s*2[0-9]{2}px/.test(reserveSel[1]),
      reserveSel ? 'padding-bottom 不足：' + reserveSel[1].slice(0, 60) : '缺少 [data-mode=full] ~ #app 规则');

    /* v5.6.2 退役：R164b（has-radio 由 paintDock 驱动）—— 挂 class 的代码 v5.6.1 已删，
       v5.6.2 连那条孤儿 CSS 一起删了，判据无处可查。 */

    /* 打印：控制台不该被打出来（它是屏幕专属的实体机器造型）
       ⚠ 必须用配平提取，不能贪婪到文件末尾 —— 否则会误命中主样式里的
       别的规则，摘掉实现也照样绿（假绿，实测踩过）。 */
    const printBody = mediaBlocks(css, (c) => /print/.test(c)).map((b) => b.body).join('\n');
    T('样式 · 打印', 'R165 打印时隐藏常驻电台控制台（不浪费纸墨）',
      /\.radio-console[^{]*\{[^}]*display\s*:\s*none/.test(printBody),
      '打印未隐藏 .radio-console');
  }

  /* ================= ⑥ 交叉一致性 ================= */
  {
    /* v5.6.1 改判：动作名从"内核能力"（toggle/prev/next/playat/mute/repeat/shuffle，
       那是已删的旧面板）换成**现在真正在用的**这一套 ——
       电台页与首页入口发出的 data-radio-act 必须被 app.js 的代理接住，
       拼错就是"点了没反应"，这条守卫照旧值钱。 */
    const acts = ['playitem', 'up', 'down', 'del', 'additem'];
    const missing = acts.filter((a) => !new RegExp('data-radio-act="' + a + '"').test(views));
    T('交叉一致性', 'R162 UI 发出的动作名与代理相接（拼错 = 点了没反应）',
      missing.length === 0, '缺失动作：' + missing.join(','));

    /* app.js 的代理要覆盖 UI 里出现的**每一个**动作 —— 不再手写清单，
       直接从 views.js 里把动作名刮出来比对，新增动作忘了接就会红。 */
    const viewActs = Array.from(new Set(
      (views.match(/data-radio-act="[a-z-]+"/g) || []).map(function (s) {
        return s.replace(/^data-radio-act="|"$/g, '');
      })
    )).sort();
    const bindIdx = app.indexOf('function bindRadioPage(');
    const bindEnd = app.indexOf('function route()', bindIdx);
    const bindBody = (bindIdx >= 0 && bindEnd > bindIdx) ? app.slice(bindIdx, bindEnd) : '';
    const notHandled = viewActs.filter(function (a) {
      return !new RegExp("act === '" + a + "'").test(bindBody);
    });
    T('交叉一致性', 'R162b app 侧代理覆盖 UI 全部动作（从 views.js 实刮，非手写清单）',
      viewActs.length > 0 && bindBody.length > 0 && notHandled.length === 0,
      notHandled.length ? '未处理：' + notHandled.join(',') : ('共 ' + viewActs.length + ' 个动作'));

    /* v5.6.1 退役：R162c（"迷你条与面板共用 toggle 动作 ≥2 处"）——
       迷你条与面板都已不存在，toggle 不再是 UI 动作（播放交给网易云 iframe 自己）。 */

    /* 数据层产出的行 → 视图消费的字段必须对齐 */
    T('交叉一致性', 'R163 视图消费的字段都在数据层白名单内（title / artist / kind）',
      /RADIO_FIELDS\s*=\s*'[^']*title[^']*'/.test(cloud) &&
      /RADIO_FIELDS\s*=\s*'[^']*artist[^']*'/.test(cloud) &&
      /RADIO_FIELDS\s*=\s*'[^']*kind[^']*'/.test(cloud),
      '字段白名单缺视图需要的字段');

    /* v2.9.0 新增：视图判定「能不能播」用的 has_data 必须在白名单里，
       否则列表返回的行没有该字段，`has_data !== false` 恒真 ⇒
       禁用逻辑形同虚设（旧记录又变回"点了报错"的死按钮）。 */
    /* v5.0.0：has_data 概念消失（旧记录都已迁移成网易云条目）。
       但仍有一条跨层契约要守：**netease_id 必须在白名单里** ——
       界面靠它把条目还原成官方播放器地址，缺了就只能显示空壳。 */
    T('交叉一致性', 'R163b netease_id 在数据层白名单内（界面靠它还原播放器地址）',
      /RADIO_FIELDS\s*=\s*'[^']*\bnetease_id\b[^']*'/.test(cloud),
      'RADIO_FIELDS 缺 netease_id —— 条目无法还原成播放器');

    /* v5.6.1 退役：R163c（取址回调传整行 / 内核与地址来源解耦）——
       fetchUrl 是 NEONRadio 内核的接口，取址来自已删的 initRadio；
       条目的播放地址现在是行里的 source_url，界面直接渲染 iframe，没有"回调"这一层。 */
  }

  return {
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    results: results
  };
}

module.exports = { name: 'v2.8.0 电台', run: run };
standalone(module, run);
