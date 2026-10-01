/* ============================================================
   version.js — 版本与工程日志（单一数据源）
   ------------------------------------------------------------
   每次改动只需做两件事：
     1. 更新 VERSION.BUILD
     2. 往 VERSION.LOG 数组最前面 unshift 一条记录
   页脚版本号与工程日志弹窗都从这里读取，不会出现不一致。

   自证机制（排查"页面是不是旧版"时用）：
     · 每个版本号都带唯一 BUILD_ID，加载成功会在控制台打印
     · URL 加 ?diag=1 会在页面顶部显示一条确诊横幅
   ============================================================ */
(function () {
  'use strict';

  var VERSION = {
    /* 当前构建版本号 —— 每次改动必须递增 */
    BUILD: '5.7.0',

    /* 构建唯一标识：每次改动换个新值。
       用途：确认浏览器实际加载的是哪一份文件。 */
    BUILD_ID: '20261002T0127+0800-buildupte',

    /* 构建日期（随版本一起更新） */
    BUILT_AT: '2026-10-02',

    /* 工程日志：最新的一条放最前面 */
    /* 工程日志：最新的一条放最前面。
       ⚠ v5.6.3：1.0.0 ~ 5.5.1 的 88 条逐版流水账已裁掉，改成末尾的「历史事故索引」——
         完整历史在 git 里逐版可查，这里只留**可能重演的教训**。 */
    LOG: [
            {
        version: '5.7.0',
        date: '2026-10-02',
        title: 'P0 网络硬化：出网超时 + 首屏竞速兜底',
        items: [
          "问题（实测取证）—— supabase-js 只给 Realtime 与 Auth 路径加了时限；PostgREST 请求（文章列表/标签统计/电台条目）走的是 postgrest-js，全文没有任何 signal 或 timeout。更致命的是「挂住」不等于「失败」：withFallback 的兜底挂在 catch 上，一直 pending 就永远不切快照 —— jsdom 实测（把请求变成永不返回）6 秒过去仍是 0 张卡片、一直骨架态，且看不到尽头",
          "修法一 · 出网边界统一超时 —— 在 createClient 的 global.fetch 上包一层 AbortController（REQ_TIMEOUT_MS = 8000）。一处覆盖 Auth + PostgREST + Storage，不再逐个调用点加（那是「钉调用点」，本项目十几条出网路径必漏，以后新增还会漏）。已核对 vendor 的 bundle：postgrest-js 构造吃 fetch 选项、supabase-js 把 global.fetch 透传下去。调用方自带的 signal 仍生效（AbortSignal.any，退化为事件转发）；没有 window.fetch 的老环境不注入、行为不变",
          "修法二 · withFallback 加竞速上限（FALLBACK_RACE_MS = 10000）—— 光有 fetch 超时不够：实测首屏仍要干等 8 秒，根因是这道兜底只挂在失败上，而「慢」与「挂」都不算失败。现在超过竞速上限就先拿本地快照把页面画出来。竞速上限刻意大于请求超时，避免正常慢请求被快照抢先、同一次会话里内容会「变」",
          "新增 55 号用例 11 条（已登记进 manifest）—— 含端到端判据 R303：把云端请求变成「挂到超时才失败」后，断言首屏必须有界出内容。实测 858ms 渲染出 4 张卡片（修前 12 秒仍无内容）。另含「时限内返回不被误伤」「调用方 signal 仍生效」「竞速上限必须大于请求超时」",
          "反向验证（证明判据不松）—— 逐个摘掉机制各跑一遍：原样 11/11 全绿；不注入 global.fetch → 4 条红；去掉竞速 → R304 红且 R303 仍绿（说明两层机制相互独立）；定时器不 abort → 判据被挂死 12 秒未跑完，正是原始故障的形状",
          "配套 —— 51 号 R250/R250d 两条结构断言同步（withFallback 多了一层竞速，意图不变、字面恢复原形状以免误报）；tests/common.js 新增 hangCloud 故障桩（像真 fetch 那样在时限到达时抛 AbortError）与 timeoutMs 注入，并修掉「桩读不到 jsdom window 时限」的坑",
          "⚠ 本轮起有本地回滚点：_backup/20261002-012016-v5.6.6-pre-hardening（127 文件 / 9.7MB 源码快照）。改 js/ 必须 bump 且发布后 Ctrl+F5 —— ?v= 是唯一缓存击穿手段",
          "P1 氛围降档收敛 —— 原实现 3s 采样 × 4 个坏样本 = 连续 12 秒不达标才降档，而 downgrade() 一次只摘一层 ⇒ 最坏 9×12 ≈ 108 秒才关到不卡，体感就是「先卡十几秒，机器才开始自救」。现在 1s 采样 × 2 个坏样本（触发窗口 2s）+ 一次连降 2 层 + 2s 冷却，最坏约 10 秒关完",
          "P1 为什么单靠调采样不够 —— 那只能把「12 秒降一层」变成「2 秒降一层」，9 层仍要 18 秒；连降（CASCADE_LIMIT）才是把收敛时间压下来的那一步。冷却则防「一降帧率就回升、又判坏、再降」把氛围一层层抖光",
          "新增 56 号用例 9 条（已登记进 manifest）—— 用桩把帧率按到 10fps 真跑探针，断言：有界时间内真的降档（实测首次 35ms）、一次连降 ≥2 层、从最耗的层开始摘、降档有可见提示、冷却期内只触发一轮、持续低帧率下仍保留静态纹理作底",
          "反向验证 —— 把 CASCADE_LIMIT 改回 1（旧行为）后 56 号 R306b 当场报红，证明「连降」这条判据不是摆设",
          "配套 —— 45 号 R211f 同步（阈值仍 45fps，判据从「连续 4 个坏样本」改为「触发窗口 ≤3s」；降档顺序契约不变）。⚠ 探针采样间隔可由 window.__NEON_ATMO_SAMPLE_MS 覆盖，仅供测试压缩时间，源码里的真实值仍被契约断言钉着",
          "工程基建 —— 本目录此前没有版本控制。本轮装了 MinGit（便携版，解压即用、不写注册表，已加入用户 PATH）并做了首次提交 5bb9d0e；以后每步改动都能 diff/revert。另有独立于 git 的本机快照 _backup/20261002-012016-v5.6.6-pre-hardening"
        ]
      },
      {
        version: '5.6.6',
        date: '2026-10-02',
        title: '诊断横幅同步改准（不再把未加载当成缺失）',
        items: [
          'app.js 的 ?diag=1 诊断条原先也做 typeof marked/DOMPurify/hljs 三项检查并报成依赖缺失。同样的过期逻辑，三个库 v5.3.0 起改成渲染正文时按需注入，启动那刻必然不存在，于是诊断条永远显示缺失、把真正的诊断信息淹了',
          '现在改为如实汇报三态：加载失败过（loadVendors 新增 vendorFailed 记账）/ 待按需加载（正常，打开文章时才注入）/ 已就绪；并去掉 WorkBuddyCloud 那项（旧平台 SDK，早已不加载也不再使用）'
        ]
      },
      {
        version: '5.6.5',
        date: '2026-10-02',
        title: '修掉启动时那条过期假警报（截图实锤）',
        items: [
          '问题 —— 页面顶部常驻一条红条「以下 CDN 组件加载失败：Markdown、DOMPurify、highlight.js。请检查网络后刷新。」它同时错在两点。文案上，三个库 v4.8.1 起已本地托管在 js/vendor/，站里早没有 CDN 依赖；时机上，v5.3.0 起它们改成渲染正文时按需注入，于是启动那一刻必然不存在 —— 这条检查 100% 会亮，而用户其实还没打开任何一篇文章',
          '修法 —— 删掉 app.js 启动阶段的整段「CDN 依赖检查」。真实失败路径本来就有且更准：renderMarkdownInto() 在 loadVendors() 失败时就地渲染「Markdown 引擎加载失败，仅显示纯文本」加 pre 原文兜底（不白屏、不丢内容）。启动阶段不再对还没用到的库下结论',
          '配套用例 —— 故障矩阵 noMarked 从「期待出现 CDN 组件加载失败」改成「不许出现该过期文案」（新增 mustNot 机制）；noAllCDN 更名 noAllLibs（站里已无 CDN 依赖，场景真实含义是三个本地库加 SDK 一起缺失）；05 号新增 R16e 守卫防回流。故障注入 26 → 27 条',
          '过程坑（本项目第 3 次踩同一类）—— R16e 一开始扫的是未剥注释的源码，而我在注释里写了那句过期文案做说明，守卫自己判红。已改为扫 stripComments(SRC.app)，并在断言注释里写明这个坑',
          '另外：本轮发现「bump 的 --item 里带某些中文标点（如全角冒号）会让参数解析错位」——已记进教训，写 bump 命令时用「」与破折号代替'
        ]
      },
      {
        version: '5.6.4',
        date: '2026-10-02',
        title: '精简化收尾：裁掉历史日志流水账与历史归档文档',
        items: [
          'js/version.js：1194 行 → 199 行（105KB → 13KB）。原先 1.0.0~5.5.1 共 88 条逐版工程日志占了 3/4 篇幅；现只保留最近 4 版（5.6.3/5.6.2/5.6.1/5.6.0）的完整记录，并把更早历史里**有复发风险的 20 条教训**汇总成末尾一条「历史事故索引」（按发布缓存/库结构/云存储/降级/首绘/a11y/测试基建/CSS/主题等主题归类）。完整流水账在 git 历史里逐版可查',
          'app/docs/archive/ 整体删除（16 份 322KB）：3.0/4.0 改版方案、B5 终审报告、各期版本更新说明（v2.0.0/v2.0.2/v2.0.3/v2.9.5）、优化方案-v2.1规划、UI优化建议、体验优化方向-v2.7、改进设计表、安全审计报告、代码审计报告、版本更新排查指引、测试拆解与覆盖分析。判据：它们记录的是已退役的架构（CDN 时代、2.x 规划、base64 音频）与过期发布说明；27 处引用逐一改道后，有复发风险的教训进 version.js 索引、设计结论留在 HANDOVER 与源码注释',
          '配套改判：49 号 R243b 从「读 docs/archive/4.0-改版方案.md 并断言写着 B1~B5」改成「守 HANDOVER 里的五批注记」——归档删了，但记录不能跟着丢；另改 4 个 case 文件头的过期指针、HANDOVER/README/vendor-README/MIGRATION/handover-notes 里共 10 处指向已删文档的引用',
          '本轮精简化累计：项目 71.1MB → 20.6MB（不含 node_modules 则 ~4.7MB），文件数 1873 → 1551；门禁 1153 → 1125 条全绿；版本 v5.6.0 → v5.6.4'
        ]
      },
      {
        version: '5.6.3',
        date: '2026-10-02',
        title: '全项目精简化：删死内核与一次性物料，补结构性守卫',
        items: [
          '批次 A · js/radio.js 整个文件删除（17.7KB 的 <audio> 播放内核）。判据：index.html 根本没加载它（审计脚本 ⑤ 项直接报「未加载」），运行时代码里 window.NEONRadio 只剩 console.js 一处引用、而那处必然拿不到内核 —— 整个文件是死代码。连带：35 号 30 条内核断言（R129~R139c + R143f）退役、控制台 radio 命令撤下（命令从九条变八条）、tests/common.js 的 SRC.radio 与 opts.radio 按需装载移除',
          '批次 B · CSS 孤儿清理：旧「全息面板」整段 72 行（.holo-panel/-head/-live/-grid/-cell/-foot、@keyframes holo-blink）——被 v5.4 的 .holo-hero/.holo-card 取代后零标记；print 块里三个 v3.6.0 就已从 DOM 移除的装饰层（.grid-bg/.scanlines/.bg-noise）；reduce 块里指向已删 .holo-panel/.holo-live 的选择器同步去掉',
          '批次 C · 无引用物料与目录删除：_ppt_assets/（32.7MB 一次性 PPT 工作区）、根目录 NEON-DIARY 项目全景 PDF+PPTX（7MB）、_push/（249 个一次性部署排障脚本 4.5MB）、deps/ 与 config/（纯说明文档，站点与脚本都不读）、tests 里两个人工样张 HTML、db/seed/removed-posts-archive/（6.5MB 已删文章图备份）、db/seed/radio-*.json（base64 时代历史记录）。审计脚本先搬去 app/tools/audit-all.js 并改成相对路径',
          '批次 D · 顺带修掉两处真实的 CSS 破损：v3.6.0 删氛围层时留下的孤儿右花括号、v5.6.2 删 @keyframes radio-pulse 时留下的半截 keyframe。浏览器静默忽略，而既有断言只查「某条规则在不在」，所以长期没人发现 —— 整份样式的括号配平因此一直差 1~2。现已配平',
          '新增门禁守卫（49 号 R244/R244b）：CSS 括号配平 + 顶层无孤儿声明。「删规则时只删到第一个右花括号」是本项目唯一能让「删一半」不被任何断言发现的删法，这条守卫直接盯结构本身。已用本轮两处真实破损反向验证过它会报红',
          '净效果：项目目录 71.1MB → 20.8MB（其中 19MB 是 node_modules；站点本体+文档约 1.5MB），文件数 1873 → 1567；门禁 1153 → 1125 条全绿',
          '文档同步：根 README 重写（原先是 v4.7.0 那份迁移包说明，目录树/验收清单早已过期）、MANIFEST.md 顶部加历史档案说明并逐条标注已删项、db/README 与 docs/MIGRATION + SUPABASE-SETUP 标注已删 _push 引用、app/README 更新版本与断言数、HANDOVER 新增「全项目精简化」小节并同步头部版本/门禁/文件树'
        ]
      },
      {
        version: '5.6.2',
        date: '2026-10-02',
        title: '审计清单 ③④⑤ 与发现 D 收口：CSS 孤儿、导出器重建、日志定性',
        items: [
          "④ 旧电台样式整段删除（约 410 行）：.radio-dock* / .radio-panel* / .radio-track* / .radio-btn* / .radio-now* / .radio-seek / .radio-volume / .radio-bar / .radio-time / .radio-ctrls / .radio-vol* / .radio-list* / .radio-empty* / .radio-embed* / .radio-drop / .radio-hint / .radio-err / .radio-mark / .radio-glyph，外加 @keyframes radio-pulse / radio-marquee、body.has-radio .wrap 让位规则、打印块里的两个隐藏项、reduce 块里为它们写的三条归零；判据是「这些类名在 views.js / app.js / index.html 里零标记」，逐个核实后才删",
          "④ 保留（别误删）：电台页那批 .radio-page-tip / .radio-board / .radio-card* / .radio-compose / .radio-field / .radio-select / .radio-src-head / .radio-form* / .radio-op*，以及常驻控制台那套 .radio-console / .rc-*（复古收音机材质走它自己的局部变量，刻意不跟主题翻）",
          "④ 顺带修掉一处我自己造成的缺陷：删 reduce 块那两条时把上一条规则的注释收尾一起吃掉了（.topbar/.kbd-help 的 backdrop-filter 整条消失且块结构破损）。已按原样恢复，并核对整个 reduce 块括号配平、块内 .rc-tune-needle / .rc-vu i / backdrop-filter 三处都在",
          "发现 D：修 app/tools/export-static.js —— 它的电台导出块还在 select data/mime/duration_sec/size_bytes/cover_url/has_data，这些列在 v5 已从库与服务端删除，一旦真去查询会 42703 整轮导不出快照（现在没爆只是因为快照 radio 恒为空）。整块重写为「只导 v5 条目元数据」，字段与 cloud.js 的 RADIO_FIELDS 逐字一致；同时删掉 FORCE_AUDIO / AUDIO_EXT_BY_MIME / localFileSize / data/radio 落地与清目录逻辑。实测 --dry-run 跑通：云端现有 2 条网易云条目字段齐全",
          "发现 D 续：删掉仓库里那个空的 app/data/radio/ 目录（音频 2026-09-30 已移出仓库，目录只剩空壳；导出器也不再建它）。⚠ 快照 radio 数组保持原样未动 —— 云端那 2 条要等 workflow 下次跑才进快照，那是独立的一次变更",
          "⑤ 5 处 console.log 逐条判断完毕：全部保留。它们在 version.js 的「自证」块里，是排查「页面是不是旧版 / 浏览器吃了缓存」的第一手证据（§5 记着一次 bump 忘改导致登录 Failed to fetch 的事故，当时正是靠它定性的），输出恒定 5 行且不含用户数据；已在源码里写明保留理由与「别新增」的纪律",
          "配套用例：35 号 83→79（④ 删掉样式后，10 条守着已删样式的断言逐条退役或改判 —— R155/R155b/R156/R159b/R160c/R160e/R164b 退役，R159/R160/R160d/R161/R164/R165 改判到控制台与电台页上）、51 号 R253/R253b/R253c 改判（从「快照必须 0 首音频」改成「只许带 v5 八个字段」+「导出器字段与 cloud.js 逐字一致」）。门禁 1157→1153 全绿",
          "工具：_push/tools/audit-all.js 改成注释感知 —— 剥掉块/行注释再扫（① ② ③ ④ ⑦ 项）。原先按原文扫，刚清干净的代码因为注释里留了「某某已删除」的痕迹而继续报残留，把真信号淹没在假阳性里（实测 20+ 条全是注释）。现在 ① ② 在 js/ 下只剩 version.js 的构建日志命中，属预期"
        ]
      },
      {
        version: '5.6.1',
        date: '2026-10-02',
        title: '全项目审计专项清理 ① ②（死代码退场）',
        items: [
          '① cloud.js：删掉 base64 时代的全部旧电台 API —— readAudio / probeDuration / trackData / create / addTrack / probeSourceUrl / neteaseEmbedUrl / isEmbedUrl / addByUrl / playUrl / normalizeSourceUrl，以及只为它们存在的 AUDIO_* 常量、音频 LRU 缓存（radioCache 三函数 + 两个上限）、RADIO_DATA_FIELDS / RADIO_VIEW_ONLY / RADIO_WRITE_FIELDS；Radio 现在只剩 list / parseNetease / buildEmbedUrl / add / removeTrack / reorder',
          '② app.js + views.js：删掉旧「迷你条 dock + 弹出面板」整台机器 —— RadioUI 状态对象、paintDock / paintPanelProgress / paintPanel / openRadioPanel / closeRadioPanel / bindRadioDock / bindRadioPanel / handleRadioAction / formDraft / showAddForm / restoreFormDraft / formMsg / submitAddTrack / askRemoveTrack / moveTrack / loadRadioTracks / radioQueue / initRadio，以及 views.js 的 radioDockView / radioTrackRow / radioPanelView / audioLimitText / R_ICON；容器在 v5.2.0 就没了，函数体早已是空实现或不可达代码',
          '③ 保留件与改判：canManageRadio 是唯一还有用的（新电台页与常驻控制台都靠它）；登录态变化时的重取从 loadRadioTracks 改成 rcLoad（重取条目 + 重绘控制台）；boot 里的 initRadio() 调用随之删除（电台启动早在 v5.1.0 由 bindRadioPageOnce + requestIdleCallback(rcLoad) 完成）；app.js 的 tune 分支是旧面板遗留的不可达分支，一并删除',
          '④ 配套用例退役/改写（逐条做，不用批量正则 —— §6 记着「括号配平批量退役」的翻车教训）：35 号 106→83 条、54 号 39→26 条（整个 case 重写成 v5「网易云条目」，只保留界面/CSP 那几组真契约）、51 号 37→36 条；门禁 1194→1157 条，全绿。退役的每条都在源码里写明「退役了什么、为什么、谁继续守」',
          '⑤ 新引入的「清理守卫」一律扫**剥过注释**的源码：cloud.js 的清理纪要里就写着被删的名字，用原文扫会自己把自己判红（R143 / R146b 实测踩到）；另两处误伤也记下了 —— 不能写「全文件不得出现 .select(...data...)」（图片那条活路正是 .select(id,content_type,data,...)），也不能写 !/signedUrl/（附件下载是另一条活路）',
          '⑥ 已知遗留（不在本批范围）：body.has-radio 这个 class 已无代码挂载，对应的 CSS 规则与 .radio-dock* / .radio-panel* / .radio-track* / .radio-form* 一起留给审计清单 ④（只做 ① ②，不混批）；本轮只删代码，没动 CSS'
        ]
      },
      {
        version: '5.6.0',
        date: '2026-10-01',
        title: '全项目审计 + 修页脚错误',
        items: [
          '审计（扫事实不猜）：发现 6 类问题 —— ① 页脚仍写 POWERED BY WORKBUDDY CLOUD（站点早已迁到 Supabase，属真实内容错误）② cloud.js 里 base64 时代的电台 API 约 200 行已成死代码 ③ app.js/views.js 里旧面板小条机器约 300 行是死代码 ④ 已从库删掉的列（has_data/storage_path/duration_sec/size_bytes/cover_url）仍被上述死代码引用 ⑤ 5 处 console.log 待逐条判断 ⑥ 旧 dock/panel 的 CSS 也还在',
          '本轮先修 ①（一行，用户可见），其余列入专项清理：删除死代码会连带惊动断言旧设计的用例（35 号 4 条、54 号 addByUrl 相关），需要配套退役/改写 —— 这类改动我单独一批做，避免混在一起出问题',
          '没问题的部分：db/schema.sql 与 app/db/schema.sql 完全一致；建站时刻字面量只剩 1 处；js/vendor 四个库都被引用；.holo-*/.uptime-* 类均有对应标记'
        ]
      },
      /* ---------- v5.6.3：历史流水账已裁掉，改成「事故索引」 ----------
         ⚠ 这里原先是 1.0.0 → 5.5.1 共 88 条逐版工程日志（约 900 行、占本文件 3/4）。
         它们是"踩过的坑"的原始记录，但对**当前维护者**来说，真正需要的不是流水账，
         而是"哪些事故可能重演、怎么避免"。故裁成下面这一条索引：
           · 只留最近 4 版（上方的 5.6.3 / 5.6.2 / 5.6.1 / 5.6.0）的完整记录；
           · 再往前的历史里，凡是**有复发风险**的教训全部汇总在这里，按主题归类；
           · 完整历史在 git（仓库 `1liiang/cyberpunk-blog`）里逐版可查，本文件不再背负它。
         维护约定：新改动照旧"最前面加一条"；只有当某条教训会成为长期判据时，
         才值得往下面这张索引里补一行（别把索引又写回流水账）。 */
      {
        version: '≤5.5.1',
        date: '历史',
        title: '历史事故索引（1.0.0 ~ 5.5.1 的 88 条日志已裁，只留教训）',
        items: [
          '【发布与缓存】?v= 是唯一缓存击穿手段：改了 js/ 或 css/ **必须 bump**，否则用户拿旧文件。真实事故：改了 js/ 忘 bump → 浏览器复用旧 cloud.js（指向旧后端）→ 登录报 Failed to fetch。⚠ index.html 自己没有版本号可击穿 → 大改动后 Ctrl+F5。',
          '【发布与缓存】bump 的 --title / --item 里一律用「」，不要用双引号 —— 嵌套双引号会让 shell 提前闭合引号、参数错乱、**bump 静默失败**（版本号没变）→ 发布 = ?v= 未变 = 缓存击不穿。bump 后必须校验 BUILD。',
          '【发布与验证】发布后必须用 GET（禁用 curl -I）并带 --compressed；verified: true ≠ 已传播 —— 必须核对 ?v= 与 BUILD_ID。发布返回的 shareLink 是根路径遗留快照，正确地址永远带 /cyberpunk-blog/。',
          '【快照确定性】exportedAt 每次运行都变 → workflow 每 6 小时产出一次"只有时间戳变化"的提交，污染历史。修法：writeSnapshotIfChanged 比对时忽略 exportedAt，无实质变化不碰文件（提交历史里的时间戳因此等于"最后一次真正变化"）。',
          '【数据层/库结构】读/写字段清单**必须分开**：视图算出来的列（当年的 has_data）混进基表 INSERT…RETURNING 会报 42703「column … does not exist」，上传直接失败而列表读取一切正常 —— 症状极具误导性。',
          '【数据层/库结构】create or replace view **不能改列序**：加列必须追加到 SELECT 末尾，否则 42P16。视图重建后**必须补回 GRANT**（grant select … to anon, authenticated），忘了就是"匿名访客读不到、页面全空"。',
          '【数据层/云存储】云存储只服务登录用户（官方原文：Storage is for signed-in users，不暴露公开 URL/Bucket）⇒ 匿名访客调 createSignedUrl 直接 MISSING_CREDENTIALS。所以"所有人可见"的内容一律走数据库 + 公开视图，不要走 storage。',
          '【数据层/音频】base64 存库时代：解码 data URL 前**必须先剥 `data:…;base64,` 前缀**，否则前缀里的合法 base64 字符会被一并解码，凭空多出 15 字节前导垃圾（全部 .mp3 的 ID3 魔数从偏移 0 漂到 15）。该管道已在 v5.0.0 整体退役（见 HANDOVER §6）。',
          '【降级与快照】快照也拿不到时要抛**原始错误**，不能抛兜底的错误 —— 根因（如"SDK 未就绪"）被盖成后果（"快照坏了"）会让排查方向整体偏移。',
          '【降级与白屏】所有渲染路径必须包在 safeRoute/fatalPanel 里：任何视图异常都不允许白屏（27 号用例守着）。视图函数出错的最可能位置是"首绘时数据还没到"。',
          '【首绘前的事】主题 / 色相 / 氛围三件必须写在 theme-boot.js（同步脚本、早于 CSS 应用）；app.js 里的同名逻辑只是补正，跑的时候首绘早发生了 —— 顺序反了会"先裸后亮"闪一下。',
          '【无障碍】焦点归还要在元素移除**之前**做（顺序反了目标就丢了）；range 上的方向键必须放行给原生行为（否则滑杆沦为只能鼠标拖）；动效一律在 reduce 块显式归零 —— 裸时长 animation 不受 transitions 收敛管辖（R66m 只扫 transition、R72k 只认 --t-*）。',
          '【测试基建】异步断言必须 await：写在"没有 await 的 async IIFE"里的断言会**静默蒸发**（拆分实测 453 → 451）。故有断言数对账（manifest.json 基线）与 lintFloatingAsync 两道自审。',
          '【测试基建】"钉产物不钉生产者"会假绿：只断言生成出来的 JSON/文件，改坏生成脚本照样全绿（本项目栽过三次：owner_id 裁剪、slimPost 调用点、导出器 file 字段）。凡是"产物 + 生产者"两层的，都要分别钉。',
          '【测试基建】正则要锚定行首：/item.file = file;/ 无锚点会匹配到被注释掉的那行（反向验证实锤的假绿）。同理：源码注释里写了某标识符，会让"清理守卫"类断言自我判红 —— 守卫必须扫**剥过注释**的源码。',
          '【CSS】清代码时"只删到第一个右花括号"会留下半截规则：浏览器静默忽略，而所有既有断言照样全绿（它们只查"某条规则在不在"）。实测两次（v3.6.0 孤儿 `}`、v5.6.2 半截 @keyframes）—— 现由 49 号 R244/R244b 直接盯括号配平与顶层孤儿声明。',
          '【CSS】提取 @media 块必须按花括号配平，不能贪婪到文件末尾：@media print 不在末尾，贪婪会把后面整段样式吞进来 → 假绿。',
          '【样式与主题】颜色一律走 --hue/--cyan/--magenta 等变量；硬编码霓虹色换主题就露馅。但"模拟实体机器"的组件（常驻电台控制台的木纹/金属）**刻意**用局部变量、不跟主题翻。',
          '【文字排版】--mono 必须用带中文字形的等宽（现为 Sarasa Mono SC 子集自托管）；字号体系守 18 种（曾经 24 种含半像素）。',
          '【随机数】任何会写进 URL / 快照 / 缓存键的值都不许带随机或时间（快照必须确定性那条同理）。',
          '【构建产物】js/wordmark-paths.js 是字体转曲的**生成物**，勿手改；data/ 是快照产物，勿手改（由 tools/export-static.js 生成）。'
        ]
      },
    ]
  };

  window.NEONVersion = VERSION;

  /* ---------- 自证：控制台打印（永远执行，便于事后排查） ----------
     ⚠ v5.6.2（审计清单 ⑤「5 处 console.log 待逐条判断」）——**结论：全部保留**。
     逐条判断的依据：
       · 它们不是遗留的调试打印，而是本文件开头写的「自证机制」的**实现**：
         排查"页面是不是旧版 / 浏览器吃了缓存"时，控制台这几行就是第一手证据
         （尤其 BUILD_ID 与"若版本号不是最新的请强制刷新"那句提示）。
       · 删掉的代价是真实存在的：§5 的发布纪律里就有一次「改了 js/ 却忘了 bump，
         浏览器复用旧 cloud.js → 登录报 Failed to fetch」的事故，
         当时正是靠"控制台版本号对不对"快速定性的。
       · 输出量恒定 5 行、只在加载时打一次，不随交互增长，也不含用户数据。
     ⚠ 真正该守的纪律是**别新增**：本项目的审计脚本会把 console.log 计数报出来
       （残留在 version.js 之外的一律要当场说清理由）。 */
  try {
    console.log(
      '%c NEON://DIARY ' + '%c v' + VERSION.BUILD + ' ',
      'background:#04060d;color:#00f0ff;font-weight:bold',
      'background:#05ffa1;color:#04060d;font-weight:bold'
    );
    console.log('  构建标识 BUILD_ID: ' + VERSION.BUILD_ID);
    console.log('  构建日期 BUILT_AT: ' + VERSION.BUILT_AT);
    console.log('  version.js 加载时间: ' + new Date().toLocaleString());
    console.log('  → 若此处版本号不是最新的，说明浏览器加载了旧缓存，请强制刷新（Ctrl+Shift+R）');
  } catch (e) { /* 控制台不可用时忽略 */ }

  /* ---------- 自证：?diag=1 页面横幅 ---------- */
  function mountDiag() {
    if (!/[?&]diag=1/.test(location.search)) return;
    var paint = function () {
      if (!document.body) return;
      var el = document.createElement('div');
      el.id = 'neon-diag';
      el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;' +
        'background:#05ffa1;color:#04060d;font:12px/1.7 monospace;padding:8px 14px;' +
        'text-align:center;letter-spacing:.5px';
      el.textContent = 'DIAG · 实际加载版本 v' + VERSION.BUILD +
        ' · BUILD_ID=' + VERSION.BUILD_ID +
        ' · ' + new Date().toLocaleString();
      document.body.appendChild(el);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', paint);
    } else { paint(); }
  }
  mountDiag();

  /* ---------- 直接写页脚版本号（不依赖 app.js）----------
     原先版本号由 app.js 的 renderVersion() 写入。问题是：
       · 若 app.js 因任一依赖失败而中断，版本号就永远不显示
       · 而"版本号不显示"恰恰是最需要被诊断的场景 —— 逻辑上自相矛盾
     因此这里让 version.js 自己直接把版本号写到页脚，
     app.js 稍后写入时结果一致（同为 v{BUILD}），不会冲突。
     这样即使 app.js 全崩，用户依然能看到自己加载的是哪一版。 */
  function paintFooterVersion() {
    var el = document.getElementById('foot-version');
    if (!el) return false;
    el.textContent = 'v' + VERSION.BUILD;
    el.title = '构建于 ' + VERSION.BUILT_AT + ' · BUILD_ID=' + VERSION.BUILD_ID;
    el.style.color = '';
    el.setAttribute('data-painted-by', 'version.js');
    return true;
  }

  function bootVersionPaint() {
    if (paintFooterVersion()) return;
    /* 脚本在 <head> 且带 defer，理论上 DOM 已就绪；仍保留兜底 */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', paintFooterVersion);
    } else {
      setTimeout(paintFooterVersion, 0);
    }
  }
  bootVersionPaint();
})();
