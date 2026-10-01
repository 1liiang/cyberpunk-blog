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

/* 造一个可观测的 Audio 桩：记录调用 + 支持手动触发事件 */
function makeAudioStub() {
  const calls = [];
  const listeners = {};
  return {
    _calls: calls,
    _fire(t) { (listeners[t] || []).forEach((f) => f({})); },
    src: '', volume: 1, muted: false, loop: false,
    currentTime: 0, duration: NaN, preload: '',
    setAttribute(k, v) { calls.push(['setAttribute', k, v]); },
    removeAttribute(k) { this.src = ''; calls.push(['removeAttribute', k]); },
    load() { calls.push(['load']); },
    play() { calls.push(['play']); return Promise.resolve(); },
    pause() { calls.push(['pause']); },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); }
  };
}

/* 在隔离的 jsdom 里跑 radio.js 真源码 */
function bootRadio(fetchUrl) {
  let JSDOM;
  try { JSDOM = require('jsdom').JSDOM; }
  catch (e) { JSDOM = require('C:/Users/liu/.workbuddy/binaries/node/workspace/node_modules/jsdom').JSDOM; }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  dom.window.eval(SRC.radio);
  const R = dom.window.NEONRadio;
  const audio = makeAudioStub();
  R.init({ audio: audio, fetchUrl: fetchUrl || ((row) => Promise.resolve('https://cdn.test/' + (row && row.id))) });
  return { R, audio, dom };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* v2.9.0：音频存库（base64），行里不再有 storage_path —— 只有 has_data 标记。
   保留 has_data:true 让"可播放"路径正常走通。 */
const ROWS = [
  { id: 11, title: '夜航西飞', artist: 'A', mime: 'audio/mpeg', has_data: true, duration_sec: 200 },
  { id: 22, title: '雨林电波', artist: 'B', mime: 'audio/mpeg', has_data: true, duration_sec: 180 },
  { id: 33, title: '霓虹残响', artist: 'C', mime: 'audio/mpeg', has_data: true, duration_sec: 240 }
];

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;

  const app = SRC.app;
  const cloud = SRC.cloud;
  const views = SRC.views;
  const css = SRC.css;
  const radio = SRC.radio;
  const html = SRC.html;

  /* ================= ① 内核行为（真跑 jsdom） ================= */
  {
    const { R, audio } = bootRadio();

    R.setList(ROWS);
    let st = R.state();
    T('内核 · 队列', 'R129 setList 载入队列，初始未选中',
      st.count === 3 && st.index === -1 && st.current === null,
      'count=' + st.count + ' index=' + st.index);

    await R.play();
    await wait(30);
    st = R.state();
    T('内核 · 播放', 'R130 play() 选中首曲并设为播放中',
      st.index === 0 && st.current && st.current.id === 11 && st.playing === true,
      'index=' + st.index + ' playing=' + st.playing);

    T('内核 · 播放', 'R130b src 被设为取地址函数返回的签名地址',
      /^https:\/\/cdn\.test\//.test(audio.src), audio.src);

    R.pause();
    T('内核 · 播放', 'R130c pause() 停止播放态', R.state().playing === false);

    R.next();
    await wait(30);
    T('内核 · 切歌', 'R131 next() 前进一首',
      R.state().current && R.state().current.id === 22,
      'id=' + (R.state().current && R.state().current.id));

    audio.currentTime = 0;
    R.prev();
    await wait(30);
    T('内核 · 切歌', 'R131b prev() 在起始位置退回上一首',
      R.state().current && R.state().current.id === 11);

    /* 播过 3 秒：符合"先回本曲开头"的通用播放器习惯 */
    audio.currentTime = 10;
    R.prev();
    await wait(20);
    T('内核 · 切歌', 'R131c 播过 3s 后 prev 回到本曲开头而非上一首',
      R.state().current && R.state().current.id === 11);

    R.setVolume(0.5);
    T('内核 · 音量', 'R132 setVolume 生效（0.5）', Math.abs(R.state().volume - 0.5) < 0.001);
    R.setVolume(2);
    T('内核 · 音量', 'R132b setVolume 上越界夹到 1', R.state().volume === 1);
    R.setVolume(-1);
    T('内核 · 音量', 'R132c setVolume 下越界夹到 0', R.state().volume === 0);

    R.setVolume(0.8);
    R.toggleMute();
    T('内核 · 音量', 'R132d toggleMute 进入静音', R.state().muted === true);
    R.setVolume(0.6);
    T('内核 · 音量', 'R132e 调音量自动解除静音（符合直觉）', R.state().muted === false);

    R.setRepeat('one');
    T('内核 · 模式', 'R133 setRepeat(one) 生效且 audio.loop 同步',
      R.state().repeat === 'one' && audio.loop === true);
    R.setRepeat('bogus');
    T('内核 · 模式', 'R133b setRepeat 脏值被忽略（白名单）', R.state().repeat === 'one');

    R.setShuffle(true);
    T('内核 · 模式', 'R133c setShuffle 生效', R.state().shuffle === true);
    R.setShuffle(false);

    R.playAt(33);
    await wait(30);
    T('内核 · 指定播放', 'R134 playAt(id) 命中指定曲目',
      R.state().current && R.state().current.id === 33);
    T('内核 · 指定播放', 'R134b playAt 不存在的 id 返回 false', R.playAt(9999) === false);

    audio.duration = 200;
    R.seek(50);
    T('内核 · 进度', 'R135 seek(50) 生效', Math.abs(R.state().time - 50) < 0.001);
    R.seek(9999);
    T('内核 · 进度', 'R135b seek 越界被夹在时长内', audio.currentTime <= 200);

    /* 每次切歌都重取地址：不复用上一轮的 URL（可能已失效）。
       v2.9.0 起地址是库内 data URL（永久有效），"重取"由数据层的
       LRU 缓存兜住成本，因此这条约定仍然成立且更便宜。 */
    let fetchCount = 0;
    const h = bootRadio((row) => { fetchCount++; return Promise.resolve('https://cdn/' + fetchCount); });
    h.R.setList(ROWS);
    await h.R.play(); await wait(20);
    const c1 = fetchCount;
    h.R.playAt(22); await wait(20);
    T('内核 · 取址', 'R136 每次切歌都重取地址（不复用可能已失效的 URL）',
      fetchCount > c1, 'fetch=' + fetchCount);
    h.R.destroy();

    /* ---------- 取址契约（v2.9.0 从「传路径」改为「传整行」） ----------
       ⚠ 这是跨层契约：内核若不传整行，数据层从「存储签名 URL」换成
       「库内 data URL」时内核就得跟着改 —— 契约钉住，换实现不必动内核。 */
    let gotRow = null;
    const g = bootRadio((row) => {
      gotRow = row;
      return Promise.resolve('data:audio/mpeg;base64,QUFB');
    });
    g.R.setList(ROWS);
    await g.R.play(); await wait(20);
    T('内核 · 取址', 'R136b 取址回调收到整行数据（而不是某一列路径字符串）',
      !!gotRow && gotRow.id === 11 && typeof gotRow === 'object',
      '收到：' + JSON.stringify(gotRow));
    T('内核 · 取址', 'R136c 返回字符串 = 永久地址，直接设为 src（data URL 全链路走通）',
      /^data:audio\/mpeg/.test(g.audio.src), 'src=' + g.audio.src.slice(0, 40));
    g.R.destroy();

    /* 对象返回值 {url, ttl} 也要支持 —— 将来若换成"带 token 的公开直链"，
       内核不必再改一次（ttl>0 才挂续签定时器）。 */
    const o = bootRadio(() => Promise.resolve({ url: 'https://cdn/tok/1.mp3', ttl: 1800 }));
    o.R.setList([ROWS[0]]);
    await o.R.play(); await wait(20);
    T('内核 · 取址', 'R136d 返回 {url,ttl} 同样可用（限时地址路径未被改坏）',
      /^https:\/\/cdn\/tok\//.test(o.audio.src), 'src=' + o.audio.src);
    o.R.destroy();

    /* 空队列安全性 */
    R.setList([]);
    R.next(); R.prev();
    T('内核 · 边界', 'R137 空队列 next/prev 不崩且无选中',
      R.state().count === 0 && R.state().index === -1);

    /* ended 行为 */
    R.setList(ROWS);
    R.setRepeat('off');
    R.playAt(33); await wait(30);
    audio._fire('ended'); await wait(40);
    T('内核 · 边界', 'R137b repeat=off 播完末曲后停止（不环绕）',
      R.state().playing === false);

    R.setRepeat('all');
    R.playAt(33); await wait(30);
    audio._fire('ended'); await wait(40);
    T('内核 · 边界', 'R137c repeat=all 播完末曲后回到首曲',
      R.state().current && R.state().current.id === 11);

    /* 时间格式化 */
    T('内核 · 格式化', 'R138 fmtTime 处理分/时/非法值',
      R.fmtTime(0) === '0:00' && R.fmtTime(65) === '1:05' &&
      R.fmtTime(3661) === '1:01:01' && R.fmtTime(NaN) === '--:--',
      [R.fmtTime(0), R.fmtTime(65), R.fmtTime(3661), R.fmtTime(NaN)].join(' / '));

    /* 取地址失败降级 */
    const f = bootRadio(() => Promise.reject(new Error('签名服务不可用')));
    f.R.setList([ROWS[0]]);
    await f.R.play(); await wait(60);
    T('内核 · 容错', 'R139b 取地址失败时给出错误文案（不静默）',
      !!f.R.state().error && /签名服务不可用/.test(f.R.state().error),
      'error=' + f.R.state().error);
    f.R.destroy();

    /* destroy 必须真的清掉定时器（否则宿主进程不退出） */
    T('内核 · 生命周期', 'R139c 提供 destroy() 清理续签定时器',
      /function\s+destroy\s*\(/.test(radio) && /clearTimeout\(signTimer\)/.test(radio),
      '缺少 destroy 或未清定时器');

    R.destroy();
  }

  /* ================= ② 数据层契约 ================= */
  {
    T('数据层', 'R140 音频 MIME 白名单存在且覆盖常见格式',
      /AUDIO_TYPES/.test(cloud) && /audio\/mpeg/.test(cloud) && /audio\/flac/.test(cloud),
      '缺少 MIME 白名单');

    T('数据层', 'R140b 音频体积上限存在（防超大文件打爆存储）',
      /AUDIO_MAX\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(cloud),
      '缺少 AUDIO_MAX');

    /* ---------- v2.9.0：音频改走 base64 入库，不再写云存储 ----------
       ⚠ 为什么必须换（2026-09-29 真实故障）：云存储**只服务登录用户**
       （文档：Storage is for signed-in users，不暴露公开 URL / 公开 Bucket），
       匿名访客调 createSignedUrl 直接 MISSING_CREDENTIALS —— 与电台
       「所有人可听」的需求互斥。改存库 + 公开视图后匿名也能读到（图片一直如此）。 */
    T('数据层', 'R140c 上传走 FileReader → data URL（不再写云存储）',
      /readAsDataURL\(file\)/.test(cloud) &&
      !/sharedPath\(uid,\s*'blog\/audio\//.test(cloud),
      '仍在走云存储上传路径（匿名访客将拿不到播放地址）');

    /* 库层 CHECK 必须覆盖「单曲上限」的 base64 最坏长度，否则合法文件会撞库报错。
       ⚠ 两个常量联动 —— 断言从 AUDIO_MAX 推导，不写死数字，
       这样「调大单曲上限却忘了同步库层」会被立刻抓住。 */
    const audioMaxM = cloud.match(/AUDIO_MAX\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    /* ⚠ 正则只捕获到前导数字（24），必须自己乘回字节数 ——
       否则会拿「24」当字节数，算出荒唐的 base64 最坏长度。 */
    const audioMaxVal = audioMaxM ? Number(audioMaxM[1]) * 1024 * 1024 : NaN;
    const dataMaxM = cloud.match(/AUDIO_DATA_MAX\s*=\s*(\d+)/);
    const dataMaxVal = dataMaxM ? Number(dataMaxM[1]) : NaN;
    const b64Worst = Number.isFinite(audioMaxVal) ? Math.ceil(audioMaxVal / 3) * 4 : NaN;
    T('数据层', 'R140d 库层体积上限覆盖单曲上限的 base64 最坏长度（合法文件不撞库）',
      Number.isFinite(audioMaxVal) && Number.isFinite(dataMaxVal) &&
      dataMaxVal >= b64Worst,
      'AUDIO_MAX=' + (audioMaxVal / 1048576) + 'MB → base64 最坏 ' + b64Worst +
      ' 字符，而 AUDIO_DATA_MAX=' + dataMaxVal);

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
      /RADIO_DATA_FIELDS\s*=\s*'[^']*\bdata\b[^']*'/.test(cloud) &&
      /\.select\(RADIO_DATA_FIELDS\)[\s\S]{0,80}?\.eq\('id',\s*id\)/.test(cloud),
      '缺单曲音频读取通道，或不是按 id 的单行查询');

    /* ⚠⚠⚠ v2.9.2 实测事故（用户上传时报「column radio_tracks.has_data does not exist」）：
       读/写**两套字段清单必须分开**。has_data 是视图 public_radio 里**算出来**的列
       （`data IS NOT NULL`），基表 radio_tracks 根本没有它。写路径若图省事复用
       RADIO_FIELDS，PostgREST 会生成 `INSERT … RETURNING …, has_data` → 42703，
       **上传直接失败**，而列表读取却一切正常 —— 症状极具误导性。
       ⚠ 实现里的**注释也写了这些标识符** ⇒ 必须先剥注释（块 + 行）再扫。
       ⚠ 下面不满足于扫字面：把常量声明块整段抽出来**真跑一遍**，
         直接在"实际生效的值"上断言 —— 后人换种写法重构也不会误红。 */
    const cloudCode = stripJsLineComments(stripComments(cloud));
    const constBlock = (function () {
      const s = cloudCode.indexOf('var RADIO_READ_TABLE');
      const e = cloudCode.indexOf('var RADIO_DATA_FIELDS');
      return (s >= 0 && e > s) ? cloudCode.slice(s, e) : '';
    })();
    let RC = null;
    try {
      RC = new Function(constBlock +
        '\nreturn { F: RADIO_FIELDS, W: RADIO_WRITE_FIELDS, V: RADIO_VIEW_ONLY, R: RADIO_READ_TABLE };')();
    } catch (e) { RC = null; }

    const cols = function (s) { return String(s || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean); };
    T('数据层', 'R141e 视图专有列已显式登记（has_data 不在基表上）',
      !!RC && Array.isArray(RC.V) && RC.V.indexOf('has_data') >= 0,
      RC ? 'RADIO_VIEW_ONLY = [' + RC.V.join(',') + ']' : '常量块抽取/求值失败');

    /* v5.0.0：电台改为「网易云条目」，has_data 概念消失（每条都必然可播）。
       改判：读清单必须带 kind / netease_id / source_url —— 界面靠它们决定摆 66px 还是 430px 播放器。 */
    T('数据层', 'R141f 读清单含 kind/netease_id/source_url（界面靠它决定播放器形态）',
      !!RC && cols(RC.F).indexOf('kind') >= 0 && cols(RC.F).indexOf('netease_id') >= 0 &&
      cols(RC.F).indexOf('source_url') >= 0,
      RC ? 'RADIO_FIELDS = ' + RC.F : '常量块求值失败');

    T('数据层', 'R141g 基表清单 = 读清单 − 视图专有列（不含 has_data，常规列还在）',
      !!RC && (function () {
        const w = cols(RC.W);
        return w.length > 0 && w.indexOf('has_data') < 0 &&
          w.indexOf('title') >= 0 && w.indexOf('created_at') >= 0;
      })(),
      RC ? 'RADIO_WRITE_FIELDS = ' + RC.W : '常量块求值失败');

    T('数据层', 'R141h v5 的写入不再碰任何已删列（data / has_data / mime 都不该再出现）',
      /parseNetease/.test(cloudCode) && /buildEmbedUrl/.test(cloudCode) &&
      !/\.select\('id,data,mime'\)/.test(cloudCode),
      '写入路径仍引用已删列');

    T('数据层', 'R141i 入库返回的行补 has_data（与列表行同形，调用方无需分支判断）',
      /saved\.has_data\s*=\s*true/.test(cloudCode),
      '入库返回值缺 has_data —— 新上传行与列表行不同形');

    /* 入库前校验：标题必填 + 长度上限 */
    T('数据层', 'R142 入库前校验标题必填与长度上限',
      /请填写曲目名称/.test(cloud) && /不能超过 200 字/.test(cloud),
      '缺少标题校验');

    /* 体积「三保险」：file.size 一关 → 读出的字符串长度二关 → 库 CHECK 兜底。
       第二关不可省：base64 比二进制大 33%，只看 file.size 挡不住编码膨胀。 */
    T('数据层', 'R142b 读出的 data URL 再量一次长度（防 base64 膨胀撞库上限）',
      /url\.length\s*>\s*AUDIO_DATA_MAX/.test(cloud),
      '缺少编码后的二次体积校验');

    /* 音频本体与记录同行 ⇒ 删记录即删音频；不得再残留存储补偿逻辑 */
    const removeBody = cloud.slice(cloud.indexOf('removeTrack: async function'));
    T('数据层', 'R142c removeTrack 只删库记录（本体随行删除，无存储孤儿）',
      /from\(RADIO_WRITE_TABLE\)\.delete\(\)\.eq\('id'/.test(removeBody) &&
      !/storage\.remove/.test(removeBody),
      '仍残留云存储删除逻辑');

    /* 播放地址 = 库内音频数据（data: URL），**匿名可读** —— 本次修复的核心 */
    const playUrlBody = cloud.slice(cloud.indexOf('playUrl: async function'),
      cloud.indexOf('playUrl: async function') + 600);
    T('数据层', 'R143 播放地址取自库内音频数据（不再依赖登录态与签名 URL）',
      /playUrl: async function/.test(cloud) && /Radio\.trackData\(/.test(cloud) &&
      !/Storage\.signedUrl/.test(playUrlBody),
      '播放地址仍走签名 URL（匿名访客必然失败）');

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

    /* 内核不再自带 TTL 常数 —— 有效期由数据层**单一来源**下发。
       曾经两处各自写数字（cloud 7200 / radio 3300），改一处漏一处必炸。 */
    T('数据层', 'R143f 内核不自带 TTL 兜底常数（有效期单一来源，避免各自越界）',
      !/AUDIO_TTL/.test(radio) && /signTtlSec\s*>\s*0/.test(radio),
      '内核仍持有 TTL 常量，或未按 ttl 正负判定是否续签');

    /* 「所有人可听」的实现基石：读的是**公开视图**（anon 有 SELECT），不是基表 */
    T('数据层', 'R143g 读取来源是公开视图 public_radio（这才是"所有人可听"）',
      /RADIO_READ_TABLE\s*=\s*'public_radio'/.test(cloud) &&
      /from\(RADIO_READ_TABLE\)/.test(cloud),
      '读取来源不是公开视图');

    /* 缓存：重播 / 上下一首来回切不该重新拉十几 MB。
       ⚠ 必须**双限**（条数 + 字符总量）—— 单首 data URL 最坏 33.5M 字符（约 33MB），
       只限条数的话「3 条」就是 100MB，移动端直接崩。 */
    T('数据层', 'R143h 音频缓存双限（条数 + 字符总量），防大文件把内存吃爆',
      /RADIO_CACHE_MAX_ITEMS\s*=\s*\d+/.test(cloud) &&
      /RADIO_CACHE_MAX_CHARS\s*=\s*\d+/.test(cloud) &&
      /radioCacheGet\(id\)/.test(cloud) && /radioCachePut\(/.test(cloud),
      '缺少音频数据缓存，或只限条数不限字符总量');

    T('数据层', 'R143i 删除曲目时同步清该曲缓存（防"已删还能播"）',
      /radioCacheDrop\(row\.id\)/.test(cloud), '未清缓存');

    /* 真跑一遍淘汰逻辑（不靠"源码里有这个常量"这种弱断言）：
       两条大文件塞进去，字符总量超限就必须丢掉最旧的那条。 */
    let cacheOk = false;
    let cacheDetail = '未提取到缓存实现';
    /* ⚠ 提取必须**停在** radioCacheDrop 之前 —— 用 lookahead 而不是把
       `function radioCacheDrop` 本身吃进来，否则 new Function 里留一个
       没有函数体的声明，直接 SyntaxError（实测踩过）。 */
    const cacheM = cloud.match(/var RADIO_CACHE_MAX_ITEMS[\s\S]*?(?=function radioCacheDrop)/);
    if (cacheM) {
      try {
        const api = new Function(cacheM[0] +
          '\n  return { put: radioCachePut, get: radioCacheGet,' +
          ' size: function () { return radioCache.length; } };')();
        const big = new Array(25000001).join('x');    /* 25M 字符：单个就超半量 */
        api.put(1, big);
        api.put(2, big);
        const afterTwo = api.size();                  /* 期望 1（字符总量已越界） */
        api.put(3, big);
        api.put(4, 'small');
        cacheOk = afterTwo === 1 && api.size() === 2 &&
          api.get(1) === null && api.get(3) === big && api.get(4) === 'small';
        cacheDetail = '两条大文件后 size=' + afterTwo + '（应为 1），最终 size=' +
          api.size() + '，get(1)=' + api.get(1) + '，get(3)命中=' + (api.get(3) === big) +
          '，get(4)=' + api.get(4);
      } catch (e) { cacheDetail = 'eval 失败: ' + e.message; }
    }
    T('数据层', 'R143j 缓存淘汰真跑一遍（超字符总量丢最旧，最近使用仍命中）',
      cacheOk, cacheDetail);

    /* owner_id 必须是 text —— 与 posts 一致，否则 RLS 的 auth.uid() 比较报 42883 */
    T('数据层', 'R143c owner_id 用 text 类型（与 posts 一致，避免 RLS 类型不匹配）',
      /owner_id:\s*meta\.owner_id/.test(cloud) && !/owner_id:\s*Number\(/.test(cloud),
      'owner_id 处理方式可疑');
  }

  /* ================= ③ 界面结构 ================= */
  {
    T('界面 · 迷你条', 'R144 迷你条渲染播放键与曲目信息',
      /radio-dock-inner/.test(views) && /data-radio-act="toggle"/.test(views) &&
      /radio-dock-title/.test(views),
      '迷你条结构缺失');

    T('界面 · 迷你条', 'R144b 迷你条可键盘操作（role=button + tabindex）',
      /data-radio-open="1" role="button" tabindex="0"/.test(views),
      '迷你条不可键盘聚焦');

    /* 五个基本控制齐全 */
    T('界面 · 控制', 'R145 面板含播放/暂停/上一首/下一首',
      /data-radio-act="toggle"/.test(views) && /data-radio-act="prev"/.test(views) &&
      /data-radio-act="next"/.test(views),
      '基本控制不全');

    T('界面 · 控制', 'R145b 面板含音量调节与静音',
      /data-radio-act="volume"/.test(views) && /data-radio-act="mute"/.test(views),
      '音量控制缺失');

    T('界面 · 控制', 'R145c 面板含进度拖拽（seek）',
      /data-radio-act="seek"/.test(views), '缺少进度拖拽');

    T('界面 · 控制', 'R145d 面板含循环与随机模式切换',
      /data-radio-act="repeat"/.test(views) && /data-radio-act="shuffle"/.test(views),
      '缺少模式切换');

    /* 当前播放曲目信息 */
    T('界面 · 信息', 'R146 面板显示当前曲目的标题/艺术家',
      /radio-now-title/.test(views) && /radio-now-artist/.test(views),
      '当前曲目信息缺失');

    /* 曲目列表 */
    T('界面 · 列表', 'R146b 曲目列表渲染每首的标题与时长',
      /radio-track-title/.test(views) && /radio-track-dur/.test(views),
      '曲目列表结构缺失');

    T('界面 · 列表', 'R146c 列表项可点播（data-radio-act="playat"）',
      /data-radio-act="playat"/.test(views), '列表项不可播放');

    /* v2.9.0：库里可能残留「云存储时代」的旧记录（有记录、无音频本体）。
       这类行点了必报错 —— 视图必须显式禁用并说明原因，
       而不是给一个"点了没反应/点了报错"的按钮。 */
    T('界面 · 列表', 'R146d 无音频本体的旧记录禁用播放并说明原因',
      /has_data\s*!==\s*false/.test(views) &&
      /' disabled'/.test(views) &&
      /radio-track-warn/.test(views),
      '未处理 has_data=false 的旧记录（会出现"点了报错"的死按钮）');

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

    /* CSP：不得出现内联事件 */
    T('界面 · CSP', 'R149 无内联事件属性（CSP 禁内联）',
      !/\son(click|change|input|keydown|submit|load|error)\s*=/i.test(views),
      '出现内联事件属性');

    /* ⚠⚠ 电台还有一个**跨文件**的 CSP 前提：曲目播放地址是 data URL、
       读时长用 blob URL，所以 index.html 的 CSP 必须有 `media-src` 且放行
       data:/blob:（缺失时回落到 default-src 'self'，音频被静默拦下，
       Chromium 只报 code 4 —— 看起来像"文件损坏"）。
       该约束的断言放在 CSP 自己的主场 `13-m-csp.js`（R35b media-src 两条），
       避免同一正则两处写死；这里只留路标。 */

    /* ⚠⚠ v2.9.3 实测缺陷：进度显示在播放过程中**完全冻住**。
       内核每次进度推进都 emit('timeupdate', {time, duration})，但 UI 侧从没订阅它 ——
       进度条与两个时间标签只由 paintPanelProgress 维护，而它此前只在**离散**的
       statechange（播放/暂停/载入/切歌）里被捎带调一次；播放中不触发 statechange。
       ⇒ 整首歌里进度不动；总时长更只在整面板重绘时渲染一次，
         切歌后长期停在**上一首**的值（实测：播 2:31 的曲子，标签显示 5:03）。
       ⚠ 实现的注释里也写了这些标识符 ⇒ 必须先剥注释（块 + 行）再扫。 */
    const appCode = stripJsLineComments(stripComments(app));

    T('界面 · 进度', 'R168 订阅了内核的 timeupdate（进度才会随时间走）',
      /on\(\s*'timeupdate'\s*,[\s\S]{0,80}?paintPanelProgress\s*\(/.test(appCode),
      '未订阅 timeupdate —— 进度条与时间标签会冻在瞬时值上');

    /* ⚠ 这条必须**先提取函数体**再断言。用「函数名 ⋯ 大窗口 ⋯ 关键字」的懒匹配会
       跨出函数边界、蹭到后面别处的 `.textContent =`，于是"删掉函数体内那行赋值"
       仍判绿（v2.9.3 反向验证实测：M2 变异假绿）。 */
    const progBody = fnBody(appCode, 'paintPanelProgress');
    const durHook = progBody.indexOf('[data-radio-dur]') >= 0;
    const durWrite = /\.textContent\s*=\s*[\s\S]{0,60}?fmtTime\(\s*st\.duration/.test(progBody);
    T('界面 · 进度', 'R168b 进度更新函数当场取「总时长」那一格、并当场把 st.duration 写进去',
      durHook && durWrite,
      'paintPanelProgress 体内缺' + (durHook ? '' : ' [data-radio-dur] 取值') + (durWrite ? '' : ' fmtTime(st.duration) 回写'));

    T('界面 · 进度', 'R168c 总时长那一格带 data-radio-dur 钩子（否则无处可更新）',
      /<span class="radio-time" data-radio-dur>/.test(stripJsLineComments(stripComments(views))),
      '总时长 span 缺 data-radio-dur');

    /* 挂载点必须在 #app 之外 —— 否则路由重写会打断播放 */
    const bodyStart = html.indexOf('<main class="wrap"');
    const dockIdx = html.indexOf('id="radio-dock"');
    T('界面 · 挂载', 'R150 播放器容器挂在 #app 之外（路由重写不打断播放）',
      dockIdx > 0 && dockIdx < bodyStart,
      'dock 位置 idx=' + dockIdx + '，main idx=' + bodyStart);

    T('界面 · 挂载', 'R150b radio.js 在 app.js 之前加载（初始化时可用）',
      html.indexOf('js/radio.js') > 0 &&
      html.indexOf('js/radio.js') < html.indexOf('js/app.js'),
      '加载顺序错误');
  }

  /* ================= ④ app.js 接线 ================= */
  {
    T('接线', 'R151 启动流程调用电台初始化（且包了 try）',
      /try\s*\{\s*initRadio\(\)/.test(app), '未在 boot 中初始化电台');

    T('接线', 'R151b 事件用代理绑定（面板重渲染不失效）',
      /radioDockEl\.addEventListener\('click'/.test(app) &&
      /host\.addEventListener\('click'/.test(app),
      '未用事件代理');

    T('接线', 'R151c 拖动进度条时不回写 value（避免与手指打架）',
      /document\.activeElement\s*!==\s*seek/.test(app),
      '缺少拖动保护');

    /* 上传防重复提交 */
    T('接线', 'R152 上传有防重复提交标志',
      /RadioUI\.busy/.test(app) && /if\s*\(RadioUI\.busy\)\s*return/.test(app),
      '缺少防重复提交');

    /* 上传前校验并给具体原因 */
    T('接线', 'R152b 上传前校验文件与标题，给具体原因',
      /请选择音频文件/.test(app) && /请填写曲目名称/.test(app),
      '缺少上传前校验');

    /* 面板外点击收起 + Esc 收起 */
    T('接线', 'R153 点面板外部与 Esc 都能收起',
      /closest\('\.radio-panel'\)/.test(app) && /=== 'Escape'/.test(app),
      '缺少收起交互');

    /* 表单草稿保留 */
    T('接线', 'R153b 重渲染后回填表单草稿（填一半不丢）',
      /function\s+restoreFormDraft/.test(app), '缺少草稿回填');

    /* 权限：只读收听 vs 管理 */
    T('接线', 'R154 管理能力依赖登录态（未登录只读收听）',
      /function\s+canManageRadio/.test(app) &&
      /State\.session\s*&&\s*State\.session\.user/.test(app.slice(app.indexOf('function canManageRadio'), app.indexOf('function canManageRadio') + 300)),
      '权限判断缺失');

    /* v2.9.0：访客队列要摘掉「无音频本体」的旧记录 —— 它对访客永远播不了，
       留着只会让电台看起来是坏的；而作者必须看得到才能删/重传，故管理视角全留。 */
    T('接线', 'R167 访客队列摘掉无音频本体的旧记录（作者仍可见以便重传）',
      /function\s+radioQueue\(\)/.test(app) &&
      /if\s*\(\s*canManageRadio\(\)\s*\)\s*return\s+RadioUI\.rows/.test(app) &&
      /has_data\s*!==\s*false/.test(app.slice(app.indexOf('function radioQueue'))),
      '未按身份过滤播放队列');

    /* ⚠ 过滤判据依赖登录态，而启动时会话还没恢复完 ⇒ 身份一变必须重取，
       否则作者登录后会看不到那条待处理的旧记录（"消失"而不是"可见待删"）。

       ⚠ 判据不能靠"固定字符数"或"第一个 });"定位：v4.9.0 给 SIGNED_IN 分支加了
         收藏迁移 + 刷新（几十行，内部自带 }); ），这两种写法都假红过一次。
         改用 boot 里紧跟在注册之后的那条 catch 作为结束锚点。 */
    const authIdx = app.indexOf('onAuthStateChange(function');
    const authEnd = authIdx >= 0 ? app.indexOf('} catch (e) { /* 监听失败', authIdx) : -1;
    const authBody = (authIdx >= 0 && authEnd > authIdx) ? app.slice(authIdx, authEnd) : '';
    T('接线', 'R167b 身份变化后重取曲目（否则作者看不到待处理的旧记录）',
      authBody.length > 0 && /loadRadioTracks\(\)/.test(authBody),
      '登录态变化未重取曲目');
  }

  /* ================= ⑤ 样式 ================= */
  {
    const rules = topLevelRules(css);
    const findRule = (name) => {
      const hit = rules.find((r) => r[0] === name);
      return hit ? hit[1] : null;
    };

    T('样式', 'R155 迷你条固定定位（常驻不随滚动消失）',
      /position\s*:\s*fixed/.test(findRule('.radio-dock') || ''),
      'dock 未固定定位');

    T('样式', 'R155b 迷你条避开顶栏高度（用 --topbar-h 变量）',
      /var\(--topbar-h/.test(findRule('.radio-dock') || ''),
      '未避开顶栏');

    T('样式', 'R155c --topbar-h 已定义为变量（单一来源）',
      /--topbar-h\s*:\s*\d+px/.test(css), '未定义 --topbar-h');

    T('样式', 'R156 面板有滚动上限（长列表不撑破视口）',
      /max-height/.test(findRule('.radio-panel') || '') &&
      /overflow-y\s*:\s*auto/.test(findRule('.radio-panel') || ''),
      '面板缺少滚动约束');

    /* 长文本截断：曲名过长不能撑破布局 */
    T('响应式', 'R159 长曲名截断（ellipsis）不撑破容器',
      /text-overflow\s*:\s*ellipsis/.test(findRule('.radio-dock-title') || '') &&
      /text-overflow\s*:\s*ellipsis/.test(findRule('.radio-track-title') || ''),
      '缺少截断');

    /* flex 子项 min-width:0 —— 不加则 ellipsis 失效 */
    T('响应式', 'R159b 弹性子项设 min-width:0（否则 ellipsis 不生效）',
      /min-width\s*:\s*0/.test(findRule('.radio-dock-info') || '') &&
      /min-width\s*:\s*0/.test(findRule('.radio-track-info') || ''),
      '缺少 min-width:0');

    /* reduce 归零：装饰动效与新时长必须登记 */
    T('样式 · reduce', 'R160 reduce 块关闭电平脉冲动画',
      /\.radio-dock-inner\.is-playing::before\s*\{\s*animation:\s*none/.test(css),
      'reduce 未关闭脉冲');

    T('样式 · reduce', 'R160c reduce 块关掉电台浮层的毛玻璃（省算力）',
      /\.radio-dock-inner,\s*\.radio-panel\s*\{\s*backdrop-filter:\s*none/.test(css),
      'reduce 未关毛玻璃');

    /* v2.9.6：dock 的跑马灯光效。
       ⚠ 它的 1.9s 是裸时长写在 animation 里 —— R66m 只扫 transition、
         R72k 只认 --t-* 变量，两条既有守卫都【够不着】它。
       ⇒ 若 reduce 块里那条显式关闭被删掉，跑马灯会在"减少动效"下照常狂跑，
         而且没有任何其它断言会红。这条就是唯一的守卫。 */
    T('样式 · reduce', 'R160d reduce 块显式关掉 dock 跑马灯光效（裸时长 animation 无其它守卫）',
      /\.radio-dock-inner:hover::after\s*\{\s*animation:\s*none\s*!important;\s*opacity:\s*0\s*!important/.test(css),
      'reduce 未关跑马灯');

    T('样式 · reduce', 'R160e 跑马灯只在 hover 媒体块内驱动（E1 铁律 + 触屏不触发）',
      (function () {
        const blocks = [];
        const re = /@media\s*\(hover:\s*hover\)\s*\{/g;
        let m;
        while ((m = re.exec(css))) {
          let depth = 1, i = re.lastIndex;
          while (depth > 0 && i < css.length) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
            i++;
          }
          blocks.push(css.slice(re.lastIndex, i - 1));
        }
        const body = blocks.join('\n');
        return /\.radio-dock-inner:hover::after\s*\{[^}]*animation:\s*radio-marquee/.test(body);
      })(),
      'hover 驱动未落在 @media(hover:hover) 内');

    /* 三档主题：新组件不得硬编码霓虹色（走变量才能随主题自适应） */
    const dockBody = findRule('.radio-dock-inner') || '';
    T('样式 · 主题', 'R161 新组件颜色走 CSS 变量（不硬编码霓虹色）',
      !/#00f0ff|#ff2a6d|#b537f2|#f9f002/i.test(dockBody),
      '硬编码了霓虹色');

    /* ---------- 布局避让（真实浏览器实测出的重叠） ----------
       dock 是 fixed 浮层，居中布局下 .wrap 会钻到它底下 —— 实测 1258px 视口
       横向重叠 168px，页面标题被压掉大半。修复＝给正文顶部让出 dock 高度。 */
    const reserveSel = rules.find((r) => /body\.has-radio/.test(r[0]) && /\.wrap/.test(r[0]));
    T('样式 · 避让', 'R164 电台启用时主内容顶部让出 dock 高度（不压标题）',
      !!reserveSel && /padding-top\s*:\s*8[0-9]px/.test(reserveSel[1]),
      reserveSel ? 'padding-top 不足：' + reserveSel[1].slice(0, 60) : '缺少 body.has-radio .wrap 规则');

    /* class 由 paintDock 挂 —— 判据必须是「电台可用」而非「dock 当前可见」，
       否则面板一开一关正文会上下跳 84px。 */
    const paintDockBody = app.slice(app.indexOf('function paintDock'), app.indexOf('function paintPanelProgress'));
    T('样式 · 避让', 'R164b has-radio 由电台可用性驱动（非 dock 显隐，防正文跳动）',
      /classList\.toggle\(\s*'has-radio'\s*,\s*!!st\.count\s*\|\|\s*canManageRadio\(\)/.test(paintDockBody),
      '判据不对（可能跟 dock.hidden 绑定 → 正文会跳）');

    /* 打印：浮层不该被打出来（原隐藏清单漏了电台）
       ⚠ 必须用配平提取，不能贪婪到文件末尾 —— 否则会误命中主样式里的
       `.radio-dock[hidden]{display:none}`，摘掉实现也照样绿（假绿，实测踩过）。 */
    const printBody = mediaBlocks(css, (c) => /print/.test(c)).map((b) => b.body).join('\n');
    T('样式 · 打印', 'R165 打印时隐藏电台浮层（不浪费纸墨）',
      /\.radio-dock[^{]*\{[^}]*display\s*:\s*none/.test(printBody),
      '打印未隐藏 .radio-dock');
  }

  /* ================= ⑥ 交叉一致性 ================= */
  {
    /* 内核导出的函数与 UI 调用的动作名要对得上 —— 拼错会"点了没反应" */
    const acts = ['toggle', 'prev', 'next', 'playat', 'mute', 'repeat', 'shuffle'];
    const missing = acts.filter((a) => !new RegExp('data-radio-act="' + a + '"').test(views));
    T('交叉一致性', 'R162 UI 动作名与内核能力一一对应',
      missing.length === 0, '缺失动作：' + missing.join(','));

    /* app.js 的 switch 分支要覆盖 UI 里出现的每个动作 */
    const handler = app.slice(app.indexOf('function handleRadioAction'));
    const handlerBody = handler.slice(0, handler.indexOf('function numIdOf'));
    const notHandled = acts.filter((a) => !new RegExp("case\\s+'" + a + "'").test(handlerBody));
    T('交叉一致性', 'R162b app 侧动作处理覆盖 UI 全部动作',
      notHandled.length === 0, '未处理：' + notHandled.join(','));

    /* 面板与迷你条共用同一套动作名（toggle） */
    const toggleCount = (views.match(/data-radio-act="toggle"/g) || []).length;
    T('交叉一致性', 'R162c 迷你条与面板共用 toggle 动作（≥2 处）',
      toggleCount >= 2, 'toggle 出现 ' + toggleCount + ' 次');

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

    /* 取址回调的跨层契约：内核传**整行**、数据层按 id 取。
       这条钉住「地址来源从存储换成库」这类改造不必再动内核。 */
    T('交叉一致性', 'R163c 取址回调传整行（内核与地址来源解耦）',
      /fetchUrl:\s*function\s*\(row\)/.test(app) &&
      /playUrl:\s*(async\s+)?function\s*\(row\)/.test(cloud),
      '取址回调仍按某一列路径传参 —— 换地址来源时内核会被迫改动');
  }

  return {
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    results: results
  };
}

module.exports = { name: 'v2.8.0 电台', run: run };
standalone(module, run);
