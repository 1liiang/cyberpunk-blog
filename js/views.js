/* ============================================================
   views.js — 视图渲染层（纯函数：数据 → HTML 字符串）
   ============================================================ */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '----.--.--';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '----.--.--';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ---------- C18：阅读时长估算 ----------
     按中文阅读速度约 400 字/分钟估算。卡片上给一个「约 N 分钟」，
     帮读者决定"要不要现在读"。

     ⚠ 口径必须固定：这里统计的是**去掉 Markdown 语法标记后的有效字数**。
     直接数 raw 字符会把 `#` `**` `[]()` 这些标记也算成正文，
     一篇 300 字的短文可能虚报成 400 字 —— 估算只要"量级对"就行，
     但口径必须可复现，否则同长度的两篇可能给出不同结果。

     · 只给到分钟，且最小 1 分钟（<1 分钟统一说 1 分钟，比"0 分钟"合理）
     · summary 与 content 都可能缺失，缺失时返回 0 表示"无法估算" */
  var READ_WPM = 400;
  function readingMinutes(p) {
    if (!p) return 0;
    var raw = '';
    if (p.content) raw += String(p.content);
    if (!raw && p.summary) raw += String(p.summary);
    if (!raw) return 0;
    /* 剥掉常见 Markdown 标记（代码块围栏、行内代码、链接 URL、强调符号、标题井号） */
    var text = raw
      .replace(/```[\s\S]*?```/g, ' ')      /* 代码块整体按 0 字计（读代码节奏完全不同，不混入） */
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') /* 图片：不产生阅读时间 */
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') /* 链接：留文字，去 URL */
      .replace(/[#>*_~\-]{1,}/g, ' ')
      .replace(/\s+/g, ' ');
    /* 中文按字符计，英文按单词计 —— 混排时两者相加更接近真实速度 */
    var cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
    var words = (text.replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, ' ')
      .match(/[A-Za-z0-9]+/g) || []).length;
    var units = cjk + words;
    if (units <= 0) return 0;
    return Math.max(1, Math.round(units / READ_WPM));
  }

  function readingLabel(p) {
    var m = readingMinutes(p);
    return m ? '约 ' + m + ' 分钟' : '';
  }

  /* ---------- 标签频段配色（O9） ----------
     问题：归档页每条只有「标题 + 日期」，所有条目长得一模一样，
          不同类别（标签）完全无法区分；空标签条目更是没有任何身份信息。

     方案：把标签名映射到站点既有的 5 个霓虹频段之一，用图标 + 颜色双重编码：
       · 色相 = 频段编号 tagTone()，取 0..4 —— 对应 5 组 CSS 变量
       · 图标 = 同一个编号 tagGlyph()，取 5 个几何符号
       图标不是装饰：色盲用户 / 灰度打印 / 高对比模式下色相会失效，
       图标是唯一还能读出「这是哪一类」的通道，故两套编码必须同源。

     关键约束 —— 颜色必须稳定：同一个标签在任何页面、任何时间、任何列表顺序下
     都必须是同一个颜色。所以这里不用「出现顺序 % 5」（顺序一变颜色就变，
     读者刚建立的"紫色=代码"的直觉立刻失效），而用标签名的 FNV-1a 哈希。

     FNV-1a 逐字符运算，避免引入依赖；Math.imul 保证 32 位溢出行为与语言无关
     （若改用 a * 16777619，超过 2^53 后精度丢失，不同浏览器可能算出不同色号）。 */
  var TAG_TONES = 5;

  function tagHash(s) {
    var h = 2166136261;                       /* FNV offset basis */
    var str = String(s == null ? '' : s);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);             /* FNV prime，32 位无符号乘法 */
    }
    return h >>> 0;                           /* 收敛为无符号 32 位 */
  }

  function tagTone(tag) {
    return tagHash(tag) % TAG_TONES;          /* 0..4 → t0..t4 */
  }

  /* 与色号同源的图标：t0..t4 一一对应，改色号顺序必须同步改这里 */
  var TAG_GLYPHS = ['◆', '▲', '■', '⬢', '●'];
  function tagGlyph(tag) {
    return TAG_GLYPHS[tagTone(tag) % TAG_GLYPHS.length];
  }

  /* 标签徽章：色块 + 边框 + 图标 + 文字 + 底部下划线，四重区分
     data-tone 驱动 CSS 取色 —— 颜色值只在 CSS 里定义一次，
     JS 侧永远不拼颜色，避免两处色板不同步。

     同一批标签（同一张卡片 / 同一条目）里若两个标签撞到同一个色号，
     读者会误以为它们是同一类 —— 这里按「首次出现占用，后来者顺延」消歧，
     保证同一容器内色号互不相同。注意：色号只在容器内顺延，
     不改变标签本身的稳定色（tagTone 是唯一权威），
     所以跨条目的「紫色=代码」直觉不会被打乱。 */
  function tagBadge(tag, used) {
    return '<a class="tag-badge" data-tone="t' + toneIn(tag, used) + '"' +
      ' href="#/tag/' + encodeURIComponent(tag) + '"' +
      ' title="频段 #' + esc(tag) + '">' +
      '<i class="tag-glyph" aria-hidden="true">' + tagGlyph(tag) + '</i>' +
      esc(tag) +
      '</a>';
  }

  /* 在 used 这份「已占用色号」表里给 tag 找一个不冲突的色号并登记 */
  function toneIn(tag, used) {
    var base = tagTone(tag);
    if (!used) return base;                    /* 单标签场景：不需要消歧 */
    for (var k = 0; k < TAG_TONES; k++) {
      var c = (base + k) % TAG_TONES;
      if (used.indexOf(c) === -1) { used.push(c); return c; }
    }
    return base;                               /* 标签数 > 5：允许复用，不再折腾 */
  }

  /* 一个条目可能挂多个标签，全部平铺；一个都没有时给中性灰「未分类」。
     线上实测 id=4 的文章 tags 就是 []，这不是异常输入而是常态，
     所以必须显式给身份，而不是留空 —— 留空等于回到"所有条目长得一样"。

     trim 是必须的：编辑器的标签输入允许「代码, 随笔」这种带空格的写法，
     若不对每个标签 trim，'  ' 会被当成一个合法的（空白）标签渲染出空白徽章，
     既没有文字也没有意义 —— 等于在列表里留了个隐形条目。 */
  function tagBadges(tags) {
    /* 容错：数据库是 jsonb，理论上给的是数组，但一旦某行被人工改成字符串
       （或前端某处漏了拆分），`tags.map` 会直接抛 TypeError —— 归档页整页白掉。
       宁可把它当单个标签渲染，也不要让一条脏数据毁掉整个列表。 */
    var arr = Array.isArray(tags) ? tags : (tags == null ? [] : [tags]);
    var list = arr.map(function (t) {
      return t == null ? '' : String(t).trim();
    }).filter(function (t) { return t !== ''; });
    if (!list.length) {
      return '<span class="tag-badge tag-badge-none" title="这条广播没有标注频段">' +
        '<i class="tag-glyph" aria-hidden="true">◇</i>未分类</span>';
    }
    var used = [];
    return list.map(function (t) { return tagBadge(t, used); }).join('');
  }

  function tagChips(tags) {
    /* O9：卡片上的标签也带上频段色号 —— 否则首页是"紫色标签"、
       归档页是"五色色标"，同一篇文章在两个页面呈现两种分类视觉，读者要重新学一遍。
       这里复用 tagBadges 的清洗与消歧逻辑，只换外层样式类。 */
    var arr = Array.isArray(tags) ? tags : (tags == null ? [] : [tags]);
    var list = arr.map(function (t) {
      return t == null ? '' : String(t).trim();
    }).filter(function (t) { return t !== ''; });
    var used = [];
    return list.map(function (t) {
      return '<a class="tag-chip" data-tone="t' + toneIn(t, used) + '"' +
        ' href="#/tag/' + encodeURIComponent(t) + '">#' + esc(t) + '</a>';
    }).join('');
  }

  /* ---------- 频段色号分配（O9 第二步：跨整页统一） ----------
     上面 tagTone 是「按名字哈希」，好处是无需上下文、绝对稳定；
     代价是标签一多就会撞号（5 个色号装 N 个标签，必然复用）。

     所以标签总览这种「一次看到全部标签」的页面换一套更合适的规则：
     按出现次数排名分配色号 —— 用得最多的频段拿 t0，次多的拿 t1……
     于是「色号 = 频段热度」成为一条可读的规律，而不是随机分布。
     排名相同的按标签名排序，保证同一批数据每次渲染结果完全一致。

     注意这里没有引入新色相，仍复用同样 5 个频段，
     所以标签总览的颜色与归档页的颜色属于同一个色板、同一套语义。 */
  function rankedTones(stats) {
    var keys = Object.keys(stats || {});
    keys.sort(function (a, b) {
      var d = (stats[b] || 0) - (stats[a] || 0);   /* 热度降序 */
      return d !== 0 ? d : (a < b ? -1 : (a > b ? 1 : 0));  /* 同热度按名字，保证确定性 */
    });
    /* 前 5 名拿 0..4 且互不重复 —— 光靠「排名 % 5」做不到这点：
       第 8 名的 7%5=2 会和第 3 名撞车，热度相差一倍却是同一个颜色，反而误导。
       第 6 名起退回按名字哈希：不再声称"热度第 N"，只保证"这个标签恒定这个色"。 */
    var map = {};
    keys.forEach(function (k, i) {
      map[k] = i < TAG_TONES ? i : tagTone(k);
    });
    return map;
  }

  /* ---------- 文章卡片 ---------- */
  /* ---------- v3.4.2 批 B：空态块的统一产出 ----------
     此前 loading / error 两种空态在 9 个视图里各写一遍（共 16 处几乎相同的拼接），
     差异只在"有没有 code 行"和"hint 说什么"。抽成两个函数后：
       ① 少 40 余行；
       ② 措辞集中 —— 原来"正在接入数据流 / 正在扫描频段 / 正在读取档案"散落各处，
          想统一口径得改九处；
       ③ "空态长什么样"从此只有一处可改（将来加插画/改结构不用九处同步）。
     ⚠ 参数保留全部差异：抽象是为了复用结构，不是为了抹平文案。
     ⚠ 产出的 HTML 与替换前逐字节一致 —— 行为断言（waitFor('.empty-state')）不受影响。 */
  function loadingBlock(code, hint) {
    return '<div class="empty-state"><span class="empty-glyph">▚</span>' +
      (code ? '<span class="empty-code">' + esc(code) + '</span>' : '') +
      '<span class="empty-hint type-cursor">' +
      esc(hint || '正在接入数据流') + '</span></div>';
  }

  function errorBlock(state, withCode) {
    return '<div class="empty-state"><span class="empty-glyph">⚠</span>' +
      (withCode === false ? '' : '<span class="empty-code">CONNECTION LOST</span>') +
      '<span class="empty-hint">' + esc(state.error) + '</span></div>';
  }

  function postCard(p) {
    /* 注意：数据库行字段是 cover_ref（snake_case）。
       此处曾误写 coverRef（camelCase）导致首页封面从不渲染，v1.5.0 修复。 */
    /* F4/F5（v2.4.0 插单）C1 HUD 读数 + C6 标题压字：
       有封面时，kick 行（SIG_三位编号 // 日期）与标题一起压进封面底部渐变区；
       无封面时不渲染 cover-press，标题回退卡身原位 —— 分支天然回退，无第三种状态。 */
    var hasCover = !!p.cover_ref;
    var coverPressHtml = '';
    if (hasCover) {
      var sig = 'SIG_' + (p.id < 10 ? '00' : p.id < 100 ? '0' : '') + p.id;
      coverPressHtml = '<div class="cover-press">' +
        '<div class="cover-kick">' + sig + ' // ' + fmtDate(p.created_at) + '</div>' +
        '<h2>' + esc(p.title) + '</h2>' +
        '</div>';
    }
    var coverHtml = hasCover
      ? '<div class="card-cover" data-cover="' + esc(p.cover_ref) + '">' + coverPressHtml + '</div>'
      : '';
    var statusHtml = p.status && p.status !== 'published'
      ? '<span class="card-status draft">DRAFT</span>'
      : '';
    /* C18：阅读时长（仅当能估算出来时才渲染，避免空标签占位） */
    var readLabel = readingLabel(p);
    var readHtml = readLabel ? '<span class="meta-read" title="按 400 字/分钟估算">◷ ' + readLabel + '</span>' : '';
    /* C19：收藏按钮。⚠ 卡内已嵌 <a>（tag 链接），这里必须用 <button> 而非 <a>：
       ① HTML 禁止 a 嵌套 ② 收藏是"动作"不是"跳转"，语义上 button 才对。
       aria-pressed 让读屏知道当前是否已收藏（配合 C10）。 */
    var marked = !!(p._marked);
    var markHtml = '<button type="button" class="card-mark' + (marked ? ' is-on' : '') +
      '" data-mark="' + p.id + '" aria-pressed="' + (marked ? 'true' : 'false') +
      '" title="' + (marked ? '从收容所移除' : '收容这条信号') + '"' +
      ' aria-label="' + (marked ? '从收容所移除：' : '收容这条信号：') + esc(p.title) + '">' +
      '<span class="mark-glyph" aria-hidden="true">' + (marked ? '◈' : '◇') + '</span></button>';
    return '' +
      /* F1 卡片键盘可达：tabindex 让整卡进入 Tab 序，role=link + aria-label
         告诉读屏这是一个"链接到文章"的元素及其目的地。
         ⚠ 不能用 <a> 包整卡 —— 卡内已有 <a> 标签（tag 链接），HTML 禁止 a 嵌套；
         Enter/Space 的激活由 app.js 的 keydown 代理完成。 */
      '<article class="post-card" data-id="' + p.id + '"' +
      ' tabindex="0" role="link" aria-label="阅读：' + esc(p.title) + '">' +
        statusHtml +
        coverHtml +
        (hasCover ? '' : '<h2>' + esc(p.title) + '</h2>') +
        (p.summary ? '<div class="card-summary">' + esc(p.summary) + '</div>' : '') +
        '<div class="card-meta">' +
          '<span class="meta-date">' + fmtDate(p.created_at) + '</span>' +
          (p.owner_name ? '<span class="meta-author">' + esc(p.owner_name) + '</span>' : '') +
          readHtml +
          '<span class="card-tags">' + tagChips(p.tags) + '</span>' +
        '</div>' +
        markHtml +
      '</article>';
  }

  /* ---------- 首页 / 标签过滤页 ---------- */
  function homeView(state) {
    var posts = state.posts || [];

    /* ---------- v3.1.0 B2 / v4.1 B2：首页 = 字标 Hero + 街区；标签页仍走连续列表 ----------
       三条设计取舍（都为了"大改但不砸掉既有判据"）：

       ① **街区只给真正的首页**（`!state.tagName`）。#/tag/x 是"某个频段的全部信号"，
          用户来这里是"找东西"，连续列表才是对的形态；街区是"逛站台"的形态。

       ② **Hero 内部保留 `.page-head`**。它是全站页头装饰（标题斜纹、分隔线、菱形锚）
          的挂载点，也是既有断言的判据（"页头存在"）。摘掉它会同时丢掉装饰与判据 ——
          所以不是"换掉页头"，而是"把页头请进 Hero 里当字标"。

       ③ **精选卡不套 `.post-list`**（它是单张，不是列表），`.post-list` 保持唯一 ——
          避免踩到"取第一个 .post-list 却只有一张卡"这类历史断言。 */
    if (!state.tagName) {
      if (state.loading) {
        return heroHtml(state) + loadingBlock('LOADING...');
      }
      if (state.error) {
        return heroHtml(state) + errorBlock(state);
      }
      if (posts.length === 0) {
        return heroHtml(state) +
          '<div class="empty-state"><span class="empty-glyph">▚</span><span class="empty-code">NO SIGNAL</span><span class="empty-hint">频道空闲中，等待第一次广播</span></div>';
      }
      return heroHtml(state) + districtHtml(state);
    }

    var html = '' +
      '<div class="page-head">' +
        '<h1>标签 // ' + esc(state.tagName) + '</h1>' +
        '<div class="crumb">' +
          '<a href="#/">所有信号</a> ▸ <b>#' + esc(state.tagName) + '</b> · 共 ' + state.total + ' 条' +
        '</div>' +
      '</div>';

    if (state.loading) {
      html += loadingBlock('LOADING...');
      return html;
    }
    if (state.error) {
      html += errorBlock(state);
      return html;
    }
    if (posts.length === 0) {
      html += '<div class="empty-state"><span class="empty-glyph">▚</span><span class="empty-code">NO SIGNAL</span><span class="empty-hint">频道空闲中，该标签下暂无广播</span></div>';
      return html;
    }
    html += '<div class="post-list">' + posts.map(postCard).join('') + '</div>';
    if (state.hasMore) {
      html += '<div class="load-more-wrap"><button class="btn" id="btn-load-more">加载更多信号 ▾</button></div>';
    }
    return html;
  }

  /* ============ v3.1.0 B2 / v4.1 B2 街区化：Hero 字标与街区 ============
     数据口径说明：所有数字都从**已加载的文章**在本地聚合得出（标签、月份），
     不新增任何网络请求 —— 面板渲染绝不 await 网络是本项目的铁律。
     代价是"频段数/归档节奏"基于当前已加载的信号，故在模块内用小字注明口径。 */

  /* 色相读数：与 app.js 的 HUE_KEY 同一个存储键。views 层不引 app 层变量
     （两者都是 IIFE，互不可见），故这里只读一个原始数字，不做名称映射 ——
     色号由 CSS 的 hsl(var(--hue)) 自行呈现，天然不会与 app.js 的清单漂移。
     ⚠ v4.5.0：这里的"未选过"判据必须与 theme-boot.js / app.js 同口径 ——
       否则侧栏会显示 184° 而实际配色是 285（"读数与实物不符"）。 */
  function hueReadout() {
    try {
      var raw = localStorage.getItem('neon_hue');
      if (raw && /^\d{1,3}$/.test(raw)) {
        var n = parseInt(raw, 10);
        var picked = localStorage.getItem('neon_hue_pick') === '1';
        if (!(n === 184 && !picked)) return n;
      }
    } catch (e) { /* 隐私模式：回落默认 */ }
    return 285;
  }

  function daysSinceBorn() {
    var start = new Date(SITE_BORN).getTime();
    if (!isFinite(start)) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 86400000));
  }

  function localTagStats(posts) {
    var map = {};
    (posts || []).forEach(function (p) {
      (p.tags || []).forEach(function (t) { map[t] = (map[t] || 0) + 1; });
    });
    return map;
  }

  /* 近 6 个月的信号密度（按 created_at 本地聚合）。
     条形宽度用百分比 —— 用 px 要算 max 值再乘系数，多一层取整误差。 */
  function monthStats(posts) {
    var map = {};
    (posts || []).forEach(function (p) {
      var d = new Date(p.created_at);
      if (!isFinite(d.getTime())) return;
      var k = d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
      map[k] = (map[k] || 0) + 1;
    });
    var keys = Object.keys(map).sort().reverse().slice(0, 6).reverse();
    var max = keys.reduce(function (m, k) { return Math.max(m, map[k]); }, 1);
    return keys.map(function (k) {
      return { key: k, count: map[k], pct: Math.round((map[k] / max) * 100) };
    });
  }

  /* v4.1 B2：霓虹字标 —— 「NEON://DIARY」的 SVG 字形描边。
     路径数据来自 js/wordmark-paths.js（由字体转曲生成，见该文件头注释）；
     动画全在 CSS（stroke-dasharray + pathLength 归一化，零 JS 测量），
     错峰用行内 --i 变量控制（借 taozhiyy 的 0.6s/字 + 0.24s 错峰参数）。
     惰性取用 + 降级：路径数据缺失时返回空串，h1 落到纯文字兜底（不让首页依赖它）。 */
  function wordmarkSvg() {
    var W = null;
    try { W = window.NEONWordmark; } catch (e) { W = null; }
    if (!W || !W.glyphs || !W.glyphs.length || !W.width) return '';
    var h = W.maxY - W.minY;
    var paths = W.glyphs.map(function (g, i) {
      /* 单字母强调（.hl）延续到字标：R 单独高亮（见 CSS 的 .wordmark .hl）。
         ⚠ 翻转变换写在**每个 path 的 transform 上**（而非包一层 <g>）——
         这样 CSS 可以自由给 <g class="wordmark-echo"> 加偏移（CSS transform
         会覆盖 SVG 的 transform 属性；写在 g 上会把翻转一起覆盖掉，字形倒转）。 */
      var hl = g.char === 'R' ? ' hl' : '';
      return '<path class="wordmark-glyph' + hl + '" style="--i:' + i +
        '" pathLength="100" transform="translate(' + g.x + ' ' + W.maxY + ') scale(1 -1)" d="' + g.d + '"/>';
    }).join('');
    return '' +
      '<svg class="wordmark" viewBox="0 0 ' + W.width + ' ' + h + '"' +
        ' preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
        /* echo 层：偏移描边做 RGB 分裂残影（同路径第二条，纯装饰） */
        '<g class="wordmark-echo">' + paths + '</g>' +
        '<g class="wordmark-main">' + paths + '</g>' +
      '</svg>';
  }

  function heroHtml(state) {
    /* v4.1 B2：Hero 2.0 —— 主视觉从「文字标题」升级为「霓虹字标」。
       契约（40 号断言迁移后的口径）：
         · h1 语义完整（sr-only 全文 "NEON://DIARY"），可访问名不受 SVG 影响；
         · 单字母强调保留：字标里 R 的 path 带 .hl（恰一处）；
         · MODULE 00 编号与信号数留在 .crumb（沿用）；
         · 字标数据缺失时整段回退为旧版文字标题（含 .hl）。 */
    var svg = wordmarkSvg();
    return '' +
      '<section class="hero">' +
        '<div class="hero-bg" aria-hidden="true"></div>' +
        '<div class="hero-inner">' +
          '<div class="page-head">' +
            '<h1 class="hero-title">' +
              (svg || 'NEON://DIA<span class="hl">R</span>Y') +
              '<span class="sr-only">NEON://DIARY</span>' +
            '</h1>' +
            '<div class="crumb">MODULE 00 · STATION LOG ▸ 共 <b>' + state.total + '</b> 条信号</div>' +
          '</div>' +
          '<p class="hero-sub">NIGHT CITY 边缘的一座信号塔 · ' +
            '记录代码、小说，以及深夜的一切胡思乱想</p>' +
        '</div>' +
        /* ⚠ 不做成 <a href="#district"> —— 本站是 hash 路由，
           任何 #xxx 锚点都会被 parseHash 当成路由解析（#district → 未知路由 → 404 视图）。
           所以滚动引导只做"提示"，不做跳转。 */
        '<p class="hero-scroll" aria-hidden="true">向下滚动 · KEEP SCROLLING <i>▾</i></p>' +
      '</section>';
  }

  /* v4.1 B2：街区招牌 —— 模块头从"小字行"升级为「灯牌」：
     挂架节点（装饰）+ BLOCK 编号 + 名称。编号语义从"模块"变为"街块"，
     与全站既有的 SECTOR 编号线并存（Block ⊂ Sector，同一体系的两种部件）。 */
  function blockSign(no, name, en) {
    return '<header class="block-sign">' +
      '<span class="block-node" aria-hidden="true"></span>' +
      '<span class="block-no">BLOCK ' + no + '</span>' +
      '<span class="block-name">' + name + '<i> / ' + en + '</i></span>' +
      '</header>';
  }

  /* v3.2.0 B3：页面级编号。
     首页六个模块占 MODULE 01~06，其余版块从 07 接着往下编，全站连成一条编号线。
     ⚠ 编号标是 h1 的**兄弟节点**（不是 h1 内容）—— 既有的页头 h1 文案断言不受影响。 */
  function pageNo(code) {
    return '<span class="page-no">SECTOR ' + code + '</span>';
  }

  function statModule(state) {
    var tags = localTagStats(state.posts);
    return '<article class="block block-stat" data-block="03">' +
      blockSign('03', '站台状态', 'STATION') +
      '<ul class="stat-list">' +
        '<li><span class="stat-k">建站</span><span class="stat-v">' + daysSinceBorn() + '</span><i>天</i></li>' +
        '<li><span class="stat-k">信号</span><span class="stat-v">' + state.total + '</span><i>条</i></li>' +
        '<li><span class="stat-k">频段</span><span class="stat-v">' + Object.keys(tags).length + '</span><i>个</i></li>' +
        '<li><span class="stat-k">色相</span><span class="stat-v">' + hueReadout() + '</span><i>°</i>' +
          '<span class="hue-dot" aria-hidden="true"></span></li>' +
      '</ul>' +
      '<p class="block-note">实时在线读数见 ABOUT 页</p>' +
      '</article>';
  }

  function tagModule(tagKeys, tags) {
    if (!tagKeys.length) return '';
    return '<article class="block block-freq" data-block="04">' +
      blockSign('04', '标签频段', 'FREQ') +
      '<div class="freq-list">' + tagKeys.map(function (k) {
        /* 复用 .tag-chip 的色号映射（[data-tone="tN"] { --tone: … }）——
           不在这里再写第三份"色号 → 颜色"表：那种表多一份就多一处漂移点。 */
        return '<a class="tag-chip freq-chip" data-tone="t' + tagTone(k) + '" href="#/tag/' +
          encodeURIComponent(k) + '">' + esc(k) + '<b>' + tags[k] + '</b></a>';
      }).join('') + '</div>' +
      '<p class="block-note">基于已加载的 ' + Object.keys(tags).length + ' 个频段</p>' +
      '</article>';
  }

  function monthModule(months) {
    if (!months.length) return '';
    return '<article class="block block-rhythm" data-block="05">' +
      blockSign('05', '归档节奏', 'RHYTHM') +
      '<ul class="rhythm-list">' + months.map(function (m) {
        return '<li><span class="rhythm-k">' + m.key + '</span>' +
          '<span class="rhythm-bar" style="width:' + m.pct + '%" aria-hidden="true"></span>' +
          '<b class="rhythm-n">' + m.count + '</b></li>';
      }).join('') + '</ul>' +
      '<p class="block-note">按已加载信号的月份分布</p>' +
      '</article>';
  }

  function idCardModule() {
    return '<article class="block block-id" data-block="06">' +
      blockSign('06', '身份卡', 'OPERATOR') +
      '<div class="id-card">' +
        '<span class="id-glyph" aria-hidden="true">◈</span>' +
        '<p class="id-name">漓江</p>' +
        '<p class="id-line">「在霓虹废墟里写代码、写小说，以及深夜的一切胡思乱想。」</p>' +
        '<a class="btn btn-ghost" href="#/about">进入档案 ▸</a>' +
      '</div>' +
      '</article>';
  }

  function districtHtml(state) {
    var posts = state.posts || [];
    var featured = posts[0];
    var rest = posts.slice(1);
    var tags = localTagStats(posts);
    var tagKeys = Object.keys(tags)
      .sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 8);

    /* v4.1 B2：街区化 —— bento 网格 →「塔台街区」。
       布局骨架沿用 12 列制（"一屏看全站状态"是这个首页的优点，不砸），
       变的是视觉语言与入场方式：
         · 每个街块 = 建筑立面：灯牌招牌（.block-sign）+ 挂架节点 + 门面纹理；
         · 街道主干线 .district-line（宽屏在内容左侧留白处，窄屏由 CSS 隐藏）；
         · 入场从"错峰淡入"改为"沿街点亮"（animation-timeline: view()，
           降级 = 原有错峰入场 —— @supports 双路径）。
       ⚠ 契约保留：.post-list 唯一（精选不套 list）、加载更多按钮、全部本地聚合。 */
    return '<section class="district" id="district" aria-label="站台街区">' +
      '<span class="district-line" aria-hidden="true"></span>' +
      (featured
        ? '<article class="block block-featured" data-block="01">' +
            blockSign('01', '精选信号', 'SPOTLIGHT') +
            '<div class="block-body">' + postCard(featured) + '</div>' +
          '</article>'
        : '') +
      (rest.length
        ? '<article class="block block-stream" data-block="02">' +
            blockSign('02', '信号流', 'STREAM') +
            '<div class="block-body"><div class="post-list">' + rest.map(postCard).join('') + '</div></div>' +
            (state.hasMore
              ? '<div class="load-more-wrap"><button class="btn" id="btn-load-more">加载更多信号 ▾</button></div>'
              : '') +
          '</article>'
        : '') +
      statModule(state) +
      tagModule(tagKeys, tags) +
      monthModule(monthStats(posts)) +
      idCardModule() +
      '</section>';
  }

  /* ---------- 标签总览 ---------- */
  function tagsView(state) {
    var stats = state.stats || {};
    var keys = Object.keys(stats).sort(function (a, b) { return stats[b] - stats[a]; });
    var html = '' +
      '<div class="page-head">' + pageNo('08') + '<h1>标签矩阵 / TAG MATRIX</h1><div class="crumb">信号频段分布 · 共 <b>' + keys.length + '</b> 个标签</div></div>';
    if (state.loading) {
      html += loadingBlock(null, '正在扫描频段');
      return html;
    }
    if (state.error) {
      html += errorBlock(state, false);
      return html;
    }
    if (keys.length === 0) {
      html += '<div class="empty-state"><span class="empty-glyph">∅</span><span class="empty-code">EMPTY SPECTRUM</span><span class="empty-hint">还没有任何标签</span></div>';
      return html;
    }
    /* O9：标签总览是「一次看到全部频段」的页面，色号按热度排名分配，
       前 5 名互不重复，扫一眼就能看出哪几个频段是主线。 */
    var toneMap = rankedTones(stats);
    html += '<div class="tag-cloud">' + keys.map(function (k) {
      var level = stats[k] >= 5 ? 1 : 0;
      var size = 13 + Math.min(stats[k], 6) * 1.5 + level;
      return '<a class="tag-item" data-tone="t' + toneMap[k] +
        (level ? ' tag-item-hot' : '') +
        '" style="font-size:' + size.toFixed(0) + 'px" href="#/tag/' +
        encodeURIComponent(k) + '">' + esc(k) +
        '<span class="tag-count">' + stats[k] + '</span></a>';
    }).join('') + '</div>';
    return html;
  }

  /* v3.2.0 B3：筛选条 —— 高频标签快捷入口。
     数据取自 state.source（搜索的候选集，已在内存里聚合），**零新增请求**。
     点击后由 app.js 的委托改 hash 触发搜索 —— 与手动输入走同一条路径。 */
  function searchFilters(state) {
    var stats = localTagStats(state.source || []);
    var keys = Object.keys(stats)
      .sort(function (a, b) { return stats[b] - stats[a]; }).slice(0, 6);
    if (!keys.length) return '';
    return '<div class="filter-row">' +
      '<span class="filter-label">快捷频段</span>' +
      keys.map(function (k) {
        return '<button type="button" class="tag-chip freq-chip" data-tone="t' + tagTone(k) +
          '" data-search-fill="' + esc(k) + '" title="用「' + esc(k) + '」扫描">' +
          esc(k) + '<b>' + stats[k] + '</b></button>';
      }).join('') +
      '</div>';
  }

  /* ---------- C1 搜索页 ---------- */
  /* 纯前端过滤：state.source 是内存里的候选集，state.q 是查询词。
     匹配范围为 title / summary / tags（不匹配正文——正文在列表接口里本来就没取，
     硬要匹配就得上库层全文检索，那超出本批「先做前端过滤」的约定）。 */
  function searchView(state) {
    var q = state.q || '';
    var hits = state.hits || [];
    var html = '' +
      '<div class="page-head">' + pageNo('09') + '<h1>搜索 / SEARCH</h1>' +
        '<div class="crumb">关键词嗅探 · ' +
          (q ? '匹配 <b>' + esc(q) + '</b> · 命中 <b>' + hits.length + '</b> 条'
             : '输入关键词，扫描全部广播') +
        '</div>' +
      '</div>' +
      '<div class="search-bar">' +
        /* v2.9.5：加一层 .search-field 包住输入框 —— 旋转光晕需要一个
           position:relative 的宿主来挂 ::before（<input> 不支持伪元素）。
           输入框的 id/class 都没动，JS 取用与既有测试不受影响。 */
        '<div class="search-field">' +
          '<input type="text" id="search-input" class="search-input" placeholder="输入标题 / 摘要 / 标签的关键词……" ' +
            'value="' + esc(q) + '" autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<button class="btn btn-magenta" id="search-go">扫描 ▸</button>' +
        (q ? '<button class="btn btn-ghost" id="search-clear">清空</button>' : '') +
      '</div>' +
      searchFilters(state);

    if (state.loading) {
      html += loadingBlock('SCANNING...');
      return html;
    }
    if (state.error) {
      html += errorBlock(state);
      return html;
    }
    if (!q) {
      html += '<div class="empty-state"><span class="empty-glyph">⌕</span><span class="empty-code">READY</span>' +
        '<span class="empty-hint">索引已就绪 · 共 ' + (state.total || 0) + ' 条信号待扫描</span></div>' +
        partialNote(state);
      return html;
    }
    if (hits.length === 0) {
      html += '<div class="empty-state"><span class="empty-glyph">∅</span><span class="empty-code">NO MATCH</span>' +
        '<span class="empty-hint">没有信号包含「' + esc(q) + '」</span></div>' + partialNote(state);
      return html;
    }
    html += '<div class="search-result-note">// 命中 ' + hits.length + ' 条 · 按时间倒序</div>' +
      partialNote(state);
    html += '<div class="post-list">' + hits.map(postCard).join('') + '</div>';
    return html;
  }

  /* 取数上限提示：候选集是一次性拉的首屏页，不是全量。
     若不说明，页面会声称「共 233 条」却只扫了 200 条 —— 静默误导比不显示更糟。 */
  function partialNote(state) {
    var total = state.total || 0;
    var scanned = state.scanned || 0;
    if (!total || !scanned || total <= scanned) return '';
    return '<div class="partial-note">// 仅覆盖最近 ' + scanned + ' 条（共 ' + total +
      ' 条），更早的广播未纳入本次检索</div>';
  }

  /* ---------- C3 归档页（按月分组） ---------- */
  /* state.groups: [{ key:'2026-09', label:'2026 年 09 月', posts:[…] }, …] 已按时间倒序 */
  /* v3.3.0 B4：发文热力图小工具（3.0 方案 §9.8）——
     数据来自归档页已有的月份分组（groups），**零额外请求**。
     固定 12 格 = 最近 12 个自然月（含无数据的空月），
     颜色深浅 0~4 级 —— 空月也占格，这样"哪几个月断更"一眼可见。 */
  function heatWidget(groups) {
    var map = {};
    (groups || []).forEach(function (g) {
      var first = (g.posts && g.posts[0]) || {};
      var d = new Date(first.created_at);
      if (!isFinite(d.getTime())) return;
      var k = d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
      map[k] = (map[k] || 0) + (g.posts ? g.posts.length : 0);
    });
    var now = new Date();
    var cells = [];
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var k = d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
      cells.push({ key: k, count: map[k] || 0 });
    }
    var max = cells.reduce(function (m, c) { return Math.max(m, c.count); }, 1);
    var total = cells.reduce(function (s, c) { return s + c.count; }, 0);
    /* v3.7.0：小工具可折叠 —— 标题行包进原生按钮（键盘可达 + aria-expanded），
       正文与注脚统一收进 .widget-body（折叠时整块隐藏）。
       折叠态不在这里读 localStorage：由 app.js 渲染后同帧恢复（职责分层）。 */
    return '<section class="widget" data-widget="heat">' +
      '<header class="widget-head">' +
        '<button type="button" class="widget-toggle" data-widget-toggle aria-expanded="true" aria-controls="widget-body-heat">' +
          '<span class="widget-title">▦ 发文热力图</span>' +
          '<span class="widget-total">' + total + ' 条</span>' +
          '<span class="widget-caret" aria-hidden="true">▾</span>' +
        '</button>' +
      '</header>' +
      '<div class="widget-body" id="widget-body-heat">' +
        '<div class="heat-grid">' + cells.map(function (c) {
          var lv = c.count === 0 ? 0 : Math.max(1, Math.round((c.count / max) * 4));
          return '<span class="heat-cell" data-lv="' + lv + '" title="' +
            c.key + ' · ' + c.count + ' 条"></span>';
        }).join('') + '</div>' +
        '<p class="widget-note">近 12 个自然月 · 越亮信号越密</p>' +
      '</div>' +
      '</section>';
  }

  function archiveView(state) {
    var groups = state.groups || [];
    var total = state.total || 0;
    var html = '' +
      '<div class="page-head">' + pageNo('07') + '<h1>归档 / ARCHIVE</h1>' +
        '<div class="crumb">时间线归档 · 共 <b>' + total + '</b> 条 · <b>' + groups.length + '</b> 个月</div>' +
      '</div>';

    if (state.loading) {
      html += loadingBlock('LOADING...', '正在整理时间线');
      return html;
    }
    if (state.error) {
      html += errorBlock(state);
      return html;
    }
    if (groups.length === 0) {
      html += '<div class="empty-state"><span class="empty-glyph">∅</span><span class="empty-code">EMPTY TIMELINE</span><span class="empty-hint">时间线上还没有任何广播</span></div>';
      return html;
    }
    /* v3.3.0 B4：归档页改双栏 —— 左侧时间线 + 右侧热力图小工具。
       ⚠ 月份分组的 DOM（.archive-group / .archive-month / .archive-item / data-tone）
         一个都没动，只是外面多包了一层栅格。 */
    html += '<div class="archive-grid"><div class="archive-main">';
    html += partialNote(state);
    /* v4.2 B3：时间线加「年份标」——月份分组（g.label 形如 2026.09）跨年处
       插一个大号年份牌，把"时间流逝"在视觉上分段。
       ⚠ aria-hidden：年份信息已在各月的 label（2026.09）里，此处是纯视觉重复，
         标为装饰，避免读屏重复播报。 */
    var lastYear = null;
    groups.forEach(function (g) {
      var year = String(g.label || '').slice(0, 4);
      if (year && year !== lastYear) {
        html += '<div class="archive-year" aria-hidden="true">' + esc(year) + '</div>';
        lastYear = year;
      }
      html += '' +
        '<section class="archive-group">' +
          '<h2 class="archive-month">' + esc(g.label) +
            '<span class="archive-count">' + g.posts.length + '</span>' +
          '</h2>' +
          '<ul class="archive-list">' +
            g.posts.map(function (p) {
              /* 草稿只有作者本人看得到，归档页公开取数拿不到；
                 这里仍显式标注状态，是为了让「同一套区分语言」在控制台/归档之间通用。 */
              var draft = p.status && p.status !== 'published'
                ? '<span class="archive-flag" title="尚未广播，仅作者可见">◈ 草稿</span>'
                : '';
              return '<li class="archive-item" data-tone="t' + tagTone((p.tags || [])[0]) + '">' +
                '<span class="archive-badges">' + tagBadges(p.tags) + '</span>' +
                '<a class="archive-link" href="#/post/' + p.id + '">' + esc(p.title) + '</a>' +
                draft +
                '<span class="archive-day">' + fmtDate(p.created_at).slice(-5) + '</span>' +
              '</li>';
            }).join('') +
          '</ul>' +
        '</section>';
    });
    html += '</div><aside class="archive-aside">' + heatWidget(groups) + '</aside></div>';
    return html;
  }

  /* ---------- 文章详情 ---------- */
  function postView(state) {
    /* C8：面包屑末段原本写死「详情」——那是从详情页模板复制过来的，
       但 404 页根本没有"详情"可看，语义是错的。
       · loading 阶段结果未定 → 保持中性「详情」（否则会闪一下"信号丢失"）
       · 确定没有文章（404 / 取不到）→ 「信号丢失」 */
    var crumbTail = (state.post || state.loading) ? '详情' : '信号丢失';
    var html = '' +
      '<div class="page-head"><h1>' + esc(state.post ? state.post.title : '信号丢失') + '</h1>' +
      '<div class="crumb"><a href="#/">所有信号</a> ▸ <b>' + crumbTail + '</b></div></div>';

    if (state.loading) {
      html += loadingBlock(null, '正在解码信号');
      return html;
    }
    if (!state.post) {
      html += '<div class="empty-state"><span class="empty-glyph">⚠</span><span class="empty-code">404 // SIGNAL NOT FOUND</span>' +
        '<span class="empty-hint">信号不存在，或尚未公开（草稿仅作者可见）</span>' +
        '<div style="margin-top:22px"><a class="btn" href="#/">返回信号列表</a></div></div>';
      return html;
    }
    var p = state.post;
    /* C18：详情页也标注阅读时长 —— 与卡片同源同算法，读者在列表与详情看到的一致 */
    var readLabel = readingLabel(p);
    /* C19：收藏按钮（详情页版本，与卡片版共用 data-mark 委托） */
    var marked = !!(state.marked);
    var markBtn = '<button type="button" class="btn btn-ghost btn-mark' + (marked ? ' is-on' : '') +
      '" id="post-mark" data-mark="' + p.id + '" aria-pressed="' + (marked ? 'true' : 'false') + '">' +
      '<span class="mark-glyph" aria-hidden="true">' + (marked ? '◈' : '◇') + '</span>' +
      (marked ? '已收容' : '收容信号') + '</button>';
    /* v3.2.0 B3 / v4.2 B3：正文改为「阅读栅格」——正文列 + TOC 辅助栏。
       v4.2 在栅格之上叠加「终端阅读框」：工具条（解码读数 + 行号开关）+ 行号 gutter。
       ⚠ TOC 的 DOM 位置在正文**之后**（视觉上在第 2 列）：
         Tab 顺序天然是"读完正文再到目录"，不必用 tabindex 硬掰。
       ⚠ 页尾三件套（postTrail）留在栅格**之外**：相关信号/上下篇是通栏内容，
         塞进正文列会被 240px 的目录挤窄。 */
    /* ⚠ renderedMd 可能缺省（29 号等测试直接以不完整 state 调 postView）——
       用 || '' 兜底：读数归零而不是抛错（渲染面永远不该因数据缺口崩）。 */
    var mdSrc = state.renderedMd || '';
    var blockCount = (mdSrc.match(/<(p|h2|h3|ul|ol|pre|blockquote)\b/g) || []).length;
    var charCount = mdSrc.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
    html += '<article class="post-full">' +
      '<div class="reading">' +
        '<div class="reading-main">' +
          '<h1 class="post-title">' + esc(p.title) + '</h1>' +
          '<div class="post-meta">' +
            '<span>⌚ ' + fmtDate(p.created_at) + '</span>' +
            (p.owner_name ? '<span>⌁ ' + esc(p.owner_name) + '</span>' : '') +
            (readLabel ? '<span>◷ ' + readLabel + '</span>' : '') +
            (p.status !== 'published' ? '<span style="color:var(--yellow)">◈ DRAFT</span>' : '') +
            '<span class="card-tags">' + tagChips(p.tags) + '</span>' +
            markBtn +
          '</div>' +
          (p.cover_ref ? '<div class="post-cover" data-cover="' + esc(p.cover_ref) + '"></div>' : '') +
          /* v4.2 B3：终端阅读框 —— 工具条 + 带行号 gutter 的正文。
             读数（段数/字数）在服务端渲染阶段就从 renderedMd 算出（零 DOM 依赖）。 */
          '<div class="reading-frame">' +
            '<div class="rf-bar">' +
              '<span class="rf-tag">▤ SIGNAL DECODED // 正文</span>' +
              '<span class="rf-stats">' + blockCount + ' 段 · 约 ' + charCount + ' 字</span>' +
              '<button type="button" class="rf-btn" id="ln-toggle" aria-pressed="true"># 行号</button>' +
            '</div>' +
            '<div class="md-body" id="md-target">' + state.renderedMd + '</div>' +
          '</div>' +
        '</div>' +
        /* C2：TOC 占位容器。目录项由 app.js 的 buildToc() 在渲染后注入
           （须等真实 DOM 落地才能读 h2/h3 的文本与位置）。
           默认隐藏，抽出条目标题后才显示——避免无标题文章留一个空框。 */
        '<nav class="toc" id="post-toc" hidden aria-label="文章目录"></nav>' +
      '</div>' +
      postTrail(state, p) +
    '</article>';
    return html;
  }

  /* ---------- C14+：详情页「读完之后」三件套 ----------
     这是全站唯一一处「断头路」：读到页尾直接就是页脚，读者无处可去。
     三块内容都来自 state 里已取回的数据（不额外发请求，故不增加等待）：

     ① 相关信号 related —— 按标签重合度排序，纯前端可算
     ② 上一篇 / 下一篇 —— 按发布时间相邻（时间线是本站的天然主轴）
     ③ 返回信号流 —— 长文滚到底后不必再滚回顶部

     ⚠ 三块都可能为空（例如只有一篇文章、或无标签）：
       · related 为空 → 整块不渲染（不留空标题）
       · prev/next 都为空 → 只渲染「返回信号流」，不渲染空的 pagination 容器 */
  function postTrail(state, p) {
    var html = '';

    /* ① 相关信号：score = 共同标签数 / 篇标签总数。
       分母用"本文标签数"而非"两篇合集"，因为读者视角是
       "这篇里提到的标签，有多少在另一篇里也出现"。 */
    var related = state.related || [];
    if (related.length) {
      html += '<section class="trail-block trail-related" aria-label="相关信号">' +
        '<h3 class="trail-head">◈ 相关信号 <span class="trail-sub">// 频段重合</span></h3>' +
        '<ul class="trail-list">' +
        related.map(function (r) {
          var shared = r._shared || 0;
          return '<li class="trail-item">' +
            '<a class="trail-link" href="#/post/' + r.id + '">' + esc(r.title) + '</a>' +
            '<span class="trail-share" title="共同频段数">' + shared + ' 段重合</span>' +
            '<span class="trail-date">' + fmtDate(r.created_at) + '</span>' +
            '</li>';
        }).join('') +
        '</ul></section>';
    }

    /* ② 上一篇 / 下一篇 + ③ 返回信号流 */
    var prev = state.prev || null;   /* 更早的一篇 */
    var next = state.next || null;   /* 更新的一篇 */
    html += '<nav class="trail-block trail-nav" aria-label="文章导航">' +
      '<div class="trail-pager">' +
        (prev
          ? '<a class="trail-prev" href="#/post/' + prev.id + '" rel="prev">' +
              '<span class="pager-dir">◂ 更早</span>' +
              '<span class="pager-title">' + esc(prev.title) + '</span></a>'
          : '<span class="trail-prev trail-none"><span class="pager-dir">◂ 更早</span>' +
              '<span class="pager-title">已是第一条信号</span></span>') +
        (next
          ? '<a class="trail-next" href="#/post/' + next.id + '" rel="next">' +
              '<span class="pager-dir">更新 ▸</span>' +
              '<span class="pager-title">' + esc(next.title) + '</span></a>'
          : '<span class="trail-next trail-none"><span class="pager-dir">更新 ▸</span>' +
              '<span class="pager-title">已是最新信号</span></span>') +
      '</div>' +
      '<div class="trail-back"><a class="btn btn-ghost" href="#/">◂ 返回信号流</a>' +
        (p.tags && p.tags.length
          ? '<a class="btn btn-ghost" href="#/tag/' + encodeURIComponent(p.tags[0]) + '"># ' + esc(p.tags[0]) + ' 频道</a>'
          : '') +
      '</div>' +
    '</nav>';

    return html;
  }

  /* ---------- 关于页 ---------- */
  /* v2.9.9：建站时间的**单一来源**。
     v2.9.8 曾误取「最早一条广播」2026.07.03 —— 用户指正：应以博主本人
     创建博客的时间为准，即 2026-09-28 00:18（本站项目目录的创建时刻）。
     ⚠ 只改这一个值：页面显示、data-born、四段读数全部跟着走，
       不存在第二处要同步的日期字面量。 */
  var SITE_BORN = '2026-09-28T00:18:00+08:00';
  function bornDisplay() {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(SITE_BORN);
    return m ? m[1] + '.' + m[2] + '.' + m[3] : SITE_BORN;
  }

  function aboutView() {
    return '' +
      '<div class="page-head">' + pageNo('11') + '<h1>关于 / ABOUT</h1><div class="crumb">身份卡 · <b>ID-CARD</b></div></div>' +
      /* v2.9.9 站点在线时长 HUD：天 / 时 / 分 / 秒 四段分解读数。
         app.js 的 startUptimeTicker() 每秒写 #uptime-days/#uptime-hours/#uptime-min/#uptime-sec；
         建站时间经 data-born 传给 app.js —— 日期字面量只活在这一处。 */
      '<section class="uptime-hud" data-born="' + SITE_BORN + '" aria-label="站点在线时长">' +
        '<div class="uptime-head">' +
          '<span class="uptime-tag">STATION UPTIME</span>' +
          '<span class="uptime-live"><i aria-hidden="true"></i>LIVE</span>' +
        '</div>' +
        '<div class="uptime-grid">' +
          '<div class="uptime-cell"><span class="uptime-label">BOOT DATE / 建站</span>' +
            '<span class="uptime-num">' + bornDisplay() + '</span></div>' +
          '<div class="uptime-cell"><span class="uptime-label">DAYS / 天</span>' +
            '<span class="uptime-num"><b id="uptime-days">—</b><i>天</i></span></div>' +
          '<div class="uptime-cell"><span class="uptime-label">HOURS / 时</span>' +
            '<span class="uptime-num"><b id="uptime-hours">—</b><i>时</i></span></div>' +
          '<div class="uptime-cell"><span class="uptime-label">MIN / 分</span>' +
            '<span class="uptime-num"><b id="uptime-min">—</b><i>分</i></span></div>' +
          '<div class="uptime-cell"><span class="uptime-label">SEC / 秒</span>' +
            '<span class="uptime-num"><b id="uptime-sec">—</b><i>秒</i></span></div>' +
        '</div>' +
        '<div class="uptime-arc" aria-hidden="true"></div>' +
        '<p class="uptime-foot">信号自 ' + bornDisplay() + ' 起持续广播 · 每一秒都在变长</p>' +
      '</section>' +
      '<div class="about-grid">' +
        '<div class="about-card"><span class="about-file" aria-hidden="true">FILE 01</span>' +
          '<h3>OPERATOR / 博主</h3>' +
          '<p><b>漓江</b> —— 本站唯一的信号源。</p>' +
          '<p>这座霓虹废墟里的日记本，记录代码、小说、以及深夜的一切胡思乱想。如果你读到了这里，说明信号没有衰减。</p>' +
          '<div class="about-stat"><span>代号</span><span>LIJIANG</span></div>' +
          '<div class="about-stat"><span>状态</span><span>ONLINE ▮</span></div>' +
          '<div class="about-stat"><span>坐标</span><span>NIGHT CITY 边缘</span></div>' +
          '<div class="about-stat"><span>频道</span><span>NEON://DIARY</span></div>' +
        '</div>' +
        '<div class="about-card"><span class="about-file" aria-hidden="true">FILE 02</span>' +
          '<h3>SYSTEM / 本站架构</h3>' +
          '<p>一台纯前端的赛博朋克终端，接驳云端神经：</p>' +
          '<div class="about-stat"><span>文章数据</span><span>云端数据库</span></div>' +
          '<div class="about-stat"><span>图片 / 附件</span><span>云端存储</span></div>' +
          '<div class="about-stat"><span>登录认证</span><span>邮箱（密码 / 验证码）</span></div>' +
          '<div class="about-stat"><span>正文格式</span><span>Markdown + 代码高亮</span></div>' +
          '<p style="margin-top:14px">想在这里留下自己的广播？注册一个账号，进入控制台即可写作。注册即可成为作者。</p>' +
        '</div>' +
        '<div class="about-card"><span class="about-file" aria-hidden="true">FILE 03</span>' +
          '<h3>PROTOCOL / 使用守则</h3>' +
          '<p>▸ 文章版权归各信号源作者所有。</p>' +
          '<p>▸ 欢迎通过标签频段检索感兴趣的内容。</p>' +
          '<p>▸ 附件下载需要登录后获取授权链接。</p>' +
          '<p>▸ 本站拒绝任何形式的信号干扰（垃圾广播将被删除）。</p>' +
        '</div>' +
        '<div class="about-card"><span class="about-file" aria-hidden="true">FILE 04</span>' +
          '<h3>TRANSMISSION / 联系</h3>' +
          '<p>信号接收确认中……</p>' +
          '<p>如果你收到了来自这座城市的消息，那是你的终端还没有生锈。</p>' +
          '<p style="margin-top:10px"><span class="tag-chip">#cyberpunk</span> <span class="tag-chip">#写作</span> <span class="tag-chip">#代码</span></p>' +
        '</div>' +
      '</div>';
  }

  /* ---------- 登录页 ---------- */
  function loginView(state) {
    var t = state.tab || 'password';
    var tabBtn = function (key, label) {
      return '<button type="button" data-tab="' + key + '" class="' + (t === key ? 'active' : '') + '">' + label + '</button>';
    };
    var html = '' +
      '<div class="form-panel">' +
        '<div class="form-title">ACCESS TERMINAL</div>' +
        '<div class="form-sub">// 身份验证 · Identity Verification</div>' +
        '<div class="tabs">' +
          tabBtn('password', '密码登录') +
          tabBtn('otp', '验证码登录') +
          tabBtn('signup', '注册') +
          tabBtn('reset', '忘记密码') +
        '</div>';

    if (t === 'password') {
      html += '' +
        '<div class="field"><label>邮箱 <b>*</b></label><input type="email" id="li-email" aria-label="邮箱" placeholder="operator@nightcity.net" autocomplete="email"></div>' +
        '<div class="field"><label>密码 <b>*</b></label><input type="password" id="li-password" aria-label="密码" placeholder="••••••••" autocomplete="current-password"></div>' +
        '<button class="btn btn-block" id="li-submit">接入系统 ▸</button>';
    }

    if (t === 'otp') {
      html += '' +
        '<div class="field"><label>邮箱 <b>*</b></label><input type="email" id="li-email" aria-label="邮箱" placeholder="operator@nightcity.net" autocomplete="email"></div>' +
        '<div class="field"><label>验证码 <b>*</b></label>' +
          '<div class="otp-row"><input type="text" id="li-code" aria-label="验证码" placeholder="6 位验证码" maxlength="10" autocomplete="one-time-code">' +
          '<button type="button" class="btn btn-sm" id="li-send">获取验证码</button></div>' +
          '<div class="field-hint">验证码将发送到你的邮箱</div>' +
        '</div>' +
        '<button class="btn btn-block" id="li-submit">接入系统 ▸</button>';
    }

    if (t === 'signup') {
      html += '' +
        '<div class="field"><label>昵称 <b>*</b></label><input type="text" id="li-nickname" aria-label="昵称" placeholder="你在本站的代号" maxlength="24"></div>' +
        '<div class="field"><label>邮箱 <b>*</b></label><input type="email" id="li-email" aria-label="邮箱" placeholder="operator@nightcity.net" autocomplete="email"></div>' +
        '<div class="field"><label>验证码 <b>*</b></label>' +
          '<div class="otp-row"><input type="text" id="li-code" aria-label="验证码" placeholder="6 位验证码" maxlength="10" autocomplete="one-time-code">' +
          '<button type="button" class="btn btn-sm" id="li-send">获取验证码</button></div>' +
        '</div>' +
        '<div class="field"><label>设置密码 <b>*</b></label><input type="password" id="li-password" aria-label="密码" placeholder="至少 6 位" autocomplete="new-password">' +
          '<div class="field-hint">注册即成为本站作者，可在控制台发布文章</div></div>' +
        '<button class="btn btn-block" id="li-submit">创建身份 ▸</button>';
    }

    if (t === 'reset') {
      html += '' +
        '<div class="field"><label>邮箱 <b>*</b></label><input type="email" id="li-email" aria-label="邮箱" placeholder="operator@nightcity.net" autocomplete="email"></div>' +
        '<div class="field"><label>邮件验证码 <b>*</b></label>' +
          '<div class="otp-row"><input type="text" id="li-code" aria-label="验证码" placeholder="重置邮件中的验证码" maxlength="10">' +
          '<button type="button" class="btn btn-sm" id="li-send">发送重置邮件</button></div>' +
        '</div>' +
        '<div class="field"><label>新密码 <b>*</b></label><input type="password" id="li-password" aria-label="密码" placeholder="至少 6 位" autocomplete="new-password"></div>' +
        '<button class="btn btn-block" id="li-submit">重写密钥 ▸</button>';
    }

    html += '</div>';
    return html;
  }

  /* ---------- 控制台 ---------- */
  function adminView(state) {
    var items = state.posts || [];
    var html = '' +
      '<div class="page-head">' + pageNo('12') + '<h1>控制台 / CONSOLE</h1><div class="crumb">广播控制台 · 已拦截 <b>' + items.length + '</b> 条信号记录</div></div>';

    if (state.loading) {
      html += loadingBlock(null, '正在读取档案');
      return html;
    }
    if (state.error) {
      html += errorBlock(state, false);
      return html;
    }
    if (items.length === 0) {
      html += '<div class="empty-state"><span class="empty-glyph">∅</span><span class="empty-code">EMPTY ARCHIVE</span>' +
        '<span class="empty-hint">你还没有任何信号记录，写下第一篇吧</span></div>';
      return html;
    }

    /* v3.3.0 B4：控制台仪表盘化（3.0 方案 §9.7）——
       左导航 + 右侧「统计块 + 记录列表」。统计全部由已取回的 items 本地聚合，零额外请求。
       ⚠ 记录行的类与属性（.admin-item / .admin-title[data-edit]）一个都没动 ——
         控制台相关的既有断言全部继续生效。 */
    var pub = 0, draft = 0, thisMonth = 0;
    var tagSet = {};
    var now = new Date();
    items.forEach(function (p) {
      if (p.status === 'published') pub++; else draft++;
      (p.tags || []).forEach(function (t) { tagSet[t] = 1; });
      var d = new Date(p.created_at || p.updated_at);
      if (isFinite(d.getTime()) &&
          d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) thisMonth++;
    });

    html += '' +
      '<div class="console">' +
        '<nav class="console-nav" aria-label="控制台导航">' +
          '<span class="console-nav-label">TIER 01 / 管理</span>' +
          '<a href="#/admin" aria-current="page">▤ 信号记录</a>' +
          '<a href="#/tagadmin">⌗ 标签管理</a>' +
          '<a href="#/marks">◇ 收容所</a>' +
          '<span class="console-nav-label">TIER 02 / 前台</span>' +
          '<a href="#/">◂ 返回信号流</a>' +
          '<a href="#/archive">▤ 时间线归档</a>' +
        '</nav>' +
        '<div class="console-main">' +
          '<div style="margin-bottom:22px"><a class="btn btn-magenta" href="#/edit/new">＋ NEW POST / 新的广播</a></div>' +
          '<div class="console-stats">' +
            '<div class="console-stat"><span class="stat-k">已广播</span><b>' + pub + '</b></div>' +
            '<div class="console-stat"><span class="stat-k">草稿</span><b>' + draft + '</b></div>' +
            '<div class="console-stat"><span class="stat-k">本月</span><b>' + thisMonth + '</b></div>' +
            '<div class="console-stat"><span class="stat-k">频段</span><b>' + Object.keys(tagSet).length + '</b></div>' +
          '</div>' +
          '<div class="console-list">';

    items.forEach(function (p) {
      html += '' +
        '<div class="admin-item">' +
          '<span class="card-status ' + (p.status === 'published' ? 'published' : 'draft') + '">' + (p.status === 'published' ? 'ONLINE' : 'DRAFT') + '</span>' +
          '<span class="admin-title" data-edit="' + p.id + '">' + esc(p.title) + '</span>' +
          '<span class="admin-info">' + fmtDate(p.updated_at) + '</span>' +
          '<a class="btn btn-sm" href="#/edit/' + p.id + '">编辑</a>' +
        '</div>';
    });

    html += '</div></div></div>';
    return html;
  }

  /* ---------- 编辑器 ---------- */
  function editView(state) {
    var isNew = !state.postId;
    var p = state.post || {};
    var html = '' +
      '<div class="page-head"><h1>' + (isNew ? '新广播 / NEW SIGNAL' : '编辑广播 / EDIT SIGNAL') + '</h1>' +
      '<div class="crumb"><a href="#/admin">控制台</a> ▸ <b>' + (isNew ? '撰写新广播' : '编辑 #' + state.postId) + '</b></div></div>' +
      '<div class="form-panel wide" style="max-width:none">' +
        '<div class="field"><label>标题 <b>*</b></label><input type="text" id="ed-title" aria-label="标题" maxlength="120" placeholder="这条广播的频率名称……" value="' + esc(p.title || '') + '"></div>' +
        '<div class="field-row">' +
          '<div class="field" style="flex:2"><label>摘要</label><input type="text" id="ed-summary" aria-label="摘要" maxlength="200" placeholder="信号摘要（显示在列表卡片上）" value="' + esc(p.summary || '') + '"></div>' +
          '<div class="field" style="flex:1"><label>标签</label><input type="text" id="ed-tags" aria-label="标签" placeholder="逗号分隔，如：随笔,代码" value="' + esc((p.tags || []).join(',')) + '"></div>' +
        '</div>' +
        '<div class="field"><label>封面图引用</label>' +
          '<div class="otp-row">' +
            '<input type="text" id="ed-cover" placeholder="cloudimg://ID（在正文上传图片后可复制引用）" value="' + esc(p.cover_ref || '') + '">' +
            '<button type="button" class="btn btn-sm" id="ed-cover-pick">从图片库选</button>' +
          '</div>' +
        '</div>' +
        /* A3：窄屏「输入/预览」切换（.ed-switch 桌面隐藏、≤1000px 显示）。
           默认 data-ed-view="input"：窄屏只显示输入 pane，点「预览」换 pane；
           桌面双列布局不读该属性，行为不变。 */
        '<div class="tabs ed-switch" id="ed-switch" role="tablist" aria-label="编辑器视图切换">' +
          '<button type="button" class="active" data-ed-view="input" role="tab" aria-selected="true">✎ 输入</button>' +
          '<button type="button" data-ed-view="preview" role="tab" aria-selected="false">◈ 预览</button>' +
        '</div>' +
        '<div class="editor-grid" data-ed-view="input">' +
          '<div class="editor-pane">' +
            /* C11：自动保存原本是静默的，作者无法判断草稿有没有被留住。
               这里给一个带时间戳的状态位；role=status 让读屏也能播报（配合 C10 键盘可达）。 */
            '<div class="editor-pane-head"><span class="dot"></span> INPUT // MARKDOWN' +
            '<span class="editor-status" id="ed-status" role="status" aria-live="polite"></span></div>' +
            '<textarea id="editor-textarea" spellcheck="false" placeholder="# 在这里输入 Markdown 正文&#10;&#10;支持标题、列表、表格、代码块……&#10;工具栏可上传图片与附件">' + esc(p.content || '') + '</textarea>' +
            '<div class="editor-toolbar">' +
              '<button type="button" class="tool-btn" data-tool="h2" title="标题">H2</button>' +
              '<button type="button" class="tool-btn" data-tool="bold" title="粗体">B</button>' +
              '<button type="button" class="tool-btn" data-tool="italic" title="斜体">I</button>' +
              '<button type="button" class="tool-btn" data-tool="code" title="行内代码">&lt;/&gt;</button>' +
              '<button type="button" class="tool-btn" data-tool="pre" title="代码块">[ ]</button>' +
              '<button type="button" class="tool-btn" data-tool="quote" title="引用">❝</button>' +
              '<button type="button" class="tool-btn" data-tool="link" title="链接">🔗</button>' +
              '<button type="button" class="tool-btn" data-tool="hr" title="分隔线">——</button>' +
              '<span style="flex:1"></span>' +
              '<button type="button" class="tool-btn" id="ed-upload-img" title="上传图片到云端并插入引用">🖼 图片</button>' +
              '<button type="button" class="tool-btn" id="ed-upload-attach" title="上传附件到云端">📎 附件</button>' +
            '</div>' +
          '</div>' +
          '<div class="editor-pane">' +
            '<div class="editor-pane-head"><span class="dot" style="background:var(--cyan);box-shadow:var(--glow-cyan)"></span> OUTPUT // PREVIEW</div>' +
            '<div class="editor-preview"><div class="md-body" id="ed-preview"><span class="type-cursor" style="color:var(--text-dim)">开始输入即可实时预览</span></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="editor-actions">' +
          '<button class="btn" id="ed-save-draft">保存草稿</button>' +
          (isNew
            ? '<button class="btn btn-magenta" id="ed-publish">立即广播 ▸</button>'
            : '<button class="btn btn-magenta" id="ed-publish">' + (p.status === 'published' ? '更新广播 ▸' : '发布广播 ▸') + '</button>') +
          (!isNew ? '<span class="spacer"></span>' +
            (p.status === 'published' ? '<button class="btn btn-ghost" id="ed-toggle-status">转为草稿</button>' : '') +
            '<button class="btn btn-ghost" id="ed-delete" style="color:var(--red);border-color:rgba(255,56,96,.4)">删除</button>' : '') +
        '</div>' +
      '</div>' +
      '<input type="file" id="file-img" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none">' +
      '<input type="file" id="file-attach" style="display:none">';
    return html;
  }

  /* ---------- C19：收容所（本地收藏） ----------
     定位：读者的「稍后读」。数据存在 localStorage，不进数据库 ——
     博客是单作者、读者无需登录，云端收藏要引入读者账号体系（大工程）。
     本地收藏的边界要在文案里说清：换浏览器/清缓存会丢，不是同步收藏。 */
  function marksView(state) {
    var posts = state.posts || [];
    var html = '' +
      '<div class="page-head">' + pageNo('10') + '<h1>收藏夹 / STASH</h1>' +
        '<div class="crumb">收容所 · 本地暂存 <b>' + posts.length + '</b> 条信号</div>' +
      '</div>';

    if (state.loading) {
      html += loadingBlock('LOADING...', '正在读取本地收容所');
      return html;
    }
    if (posts.length === 0) {
      html += '<div class="empty-state"><span class="empty-glyph">◇</span><span class="empty-code">STASH EMPTY</span>' +
        '<span class="empty-hint">还没有收容任何信号 · 在卡片或文章页点 ◇ 即可收容</span>' +
        '<div style="margin-top:22px"><a class="btn" href="#/">去信号流里逛逛</a></div></div>';
      return html;
    }
    /* 本地收藏的边界必须写在页面上，不能只写在代码注释里 */
    html += '<div class="partial-note">// 收容记录保存在本浏览器，换设备或清缓存后会丢失；这是「稍后读」，不是云端同步</div>';
    html += '<div style="margin-bottom:22px"><button class="btn btn-ghost" id="marks-clear" ' +
      'style="color:var(--red);border-color:rgba(255,56,96,.4)">✕ 清空收容所</button></div>';
    html += '<div class="post-list">' + posts.map(postCard).join('') + '</div>';
    return html;
  }

  /* ---------- C16：标签管理（重命名 / 合并） ----------
     只对已登录作者开放 —— 标签改动是写库操作。
     设计要点：
       · 「重命名」= 把旧标签换成新标签；若新标签已存在，等价于**合并**
       · 影响范围必须**先展示再执行**：改之前告诉作者"将有 N 篇受影响"
       · 未登录时给明确引导，而不是渲染一个点了没反应的界面 */
  function tagAdminView(state) {
    var stats = state.stats || {};
    var keys = Object.keys(stats).sort(function (a, b) { return stats[b] - stats[a]; });
    var html = '' +
      '<div class="page-head">' + pageNo('13') + '<h1>标签管理 / TAG CONTROL</h1>' +
        '<div class="crumb">频段管理 · 共 <b>' + keys.length + '</b> 个标签</div>' +
      '</div>';

    if (state.loading) {
      html += loadingBlock(null, '正在扫描频段');
      return html;
    }
    if (state.error) {
      html += errorBlock(state, false);
      return html;
    }
    if (keys.length === 0) {
      html += '<div class="empty-state"><span class="empty-glyph">∅</span><span class="empty-code">EMPTY SPECTRUM</span><span class="empty-hint">还没有任何标签可管理</span></div>';
      return html;
    }
    var toneMap = rankedTones(stats);
    html += '<div class="partial-note">// 重命名会批量更新所有含该标签的文章（含草稿）。若目标标签已存在，则两个标签会被合并。</div>';
    html += '<ul class="tagadmin-list">' + keys.map(function (k) {
      return '<li class="tagadmin-item" data-tone="t' + toneMap[k] + '">' +
        '<span class="tagadmin-name"><i class="tag-glyph" aria-hidden="true">' + tagGlyph(k) + '</i>' +
          esc(k) + '<span class="tagadmin-count">' + stats[k] + ' 篇</span></span>' +
        '<span class="tagadmin-actions">' +
          '<button class="btn btn-sm" data-rename="' + esc(k) + '" data-count="' + stats[k] + '">重命名 / 合并</button>' +
        '</span>' +
        '</li>';
    }).join('') + '</ul>';
    return html;
  }

  /* ============================================================
     v2.8.0：电台（RADIO）视图
     ------------------------------------------------------------
     两个渲染出口：
       radioDockView(st)   —— 左上角常驻迷你条（收起态）
       radioPanelView(st)  —— 展开面板（曲目列表 + 完整控制 + 管理区）

     ⚠ 纯渲染，不含事件绑定 —— 绑定在 app.js 里做（事件代理），
       这样本文件保持"数据 → HTML 字符串"的纯函数约定，便于测试。
     ⚠ CSP 禁内联事件：这里绝不出现内联事件属性，全部靠 data-radio-* 属性 + 代理。
     （注：本行刻意不写出被禁属性的字面形式 —— 源码扫描类断言会把它当真实用法。）
     ============================================================ */

  /* 播放/暂停/上一首/下一首等图标用字符，避免额外资源 */
  var R_ICON = {
    play: '▶', pause: '❚❚', prev: '⏮', next: '⏭',
    vol: '🔊', mute: '🔇', repeat: '↻', one: '↻¹', shuffle: '⇄',
    list: '☰', up: '⇧', down: '⇩', del: '✕', radio: '◉'
  };

  /* 迷你条（左上角常驻）。st 为 NEONRadio.state() 的快照 */
  function radioDockView(st) {
    st = st || {};
    var cur = st.current;
    var title = cur ? (cur.title || '未命名曲目') : '电台待命';
    var artist = cur && cur.artist ? ' · ' + cur.artist : '';
    var playing = !!st.playing;
    var count = st.count || 0;
    var cls = 'radio-dock-inner' + (playing ? ' is-playing' : '') +
      (st.error ? ' has-error' : '');

    return '' +
      '<div class="' + cls + '" data-radio-open="1" role="button" tabindex="0"' +
        ' aria-label="电台：' + esc(title) + '，' + (playing ? '正在播放' : '已暂停') + '，回车展开">' +
        '<button type="button" class="radio-btn radio-btn-play" data-radio-act="toggle"' +
          ' aria-label="' + (playing ? '暂停' : '播放') + '">' +
          '<span class="radio-glyph" aria-hidden="true">' + (playing ? R_ICON.pause : R_ICON.play) + '</span>' +
        '</button>' +
        '<div class="radio-dock-info">' +
          '<div class="radio-dock-title" title="' + esc(title + artist) + '">' +
            '<span class="radio-mark" aria-hidden="true">' + R_ICON.radio + '</span> ' +
            esc(title) + esc(artist) +
          '</div>' +
          '<div class="radio-dock-sub">' +
            (st.error ? '<span class="radio-err">' + esc(st.error) + '</span>'
              : (count ? ('RADIO // ' + (st.index + 1) + ' / ' + count +
                 (st.loading ? ' · 缓冲中…' : (playing ? ' · ON AIR' : ' · PAUSED')))
                : 'RADIO // 暂无曲目')) +
          '</div>' +
        '</div>' +
        '<span class="radio-dock-arrow" aria-hidden="true">' + R_ICON.list + '</span>' +
      '</div>';
  }

  /* 单曲体积上限文案：从数据层常量读。
     ⚠ 别在视图里写死数字 —— 否则改了 cloud.js 的 AUDIO_MAX 而这里忘改，
     就会出现"提示 24MB、实际挡 10MB"这种文案与实现脱节的经典坑。 */
  function audioLimitText() {
    var max = (typeof window !== 'undefined' && window.NEON && window.NEON.AUDIO_MAX)
      ? Number(window.NEON.AUDIO_MAX) : 0;
    if (!(max > 0)) return '';
    return Math.round(max / 1048576) + 'MB';
  }

  /* 曲目行 */
  function radioTrackRow(row, st) {
    var isCur = !!(st.current && st.current.id === row.id);
    var dur = row.duration_sec ? NEONRadio.fmtTime(row.duration_sec) : '--:--';
    /* ⚠ 旧版（云存储时代）上传的记录没有音频本体（视图的 has_data 为 false）。
       这类行点了必报错 —— 明确禁用并说清原因，别给"点了没反应"的按钮。 */
    var playable = row.has_data !== false;
    return '' +
      '<li class="radio-track' + (isCur ? ' is-current' : '') + (playable ? '' : ' is-dead') +
        '" data-track-id="' + row.id + '">' +
        '<button type="button" class="radio-track-play" data-radio-act="playat" data-id="' + row.id + '"' +
          (playable ? '' : ' disabled') +
          ' aria-label="' + esc((playable ? '播放 ' : '') + (row.title || '未命名曲目')) + '">' +
          '<span aria-hidden="true">' + (isCur && st.playing ? R_ICON.pause : R_ICON.play) + '</span>' +
        '</button>' +
        '<span class="radio-track-info">' +
          '<span class="radio-track-title">' + esc(row.title || '未命名曲目') + '</span>' +
          (row.artist ? '<span class="radio-track-artist">' + esc(row.artist) + '</span>' : '') +
          (playable ? '' : '<span class="radio-track-warn">暂无音频数据 · 请删除后重新上传</span>') +
        '</span>' +
        '<span class="radio-track-dur">' + dur + '</span>' +
        (row._manage ?
          '<span class="radio-track-ops">' +
            '<button type="button" class="radio-op" data-radio-act="up" data-id="' + row.id + '"' +
              ' aria-label="上移" title="上移">' + R_ICON.up + '</button>' +
            '<button type="button" class="radio-op" data-radio-act="down" data-id="' + row.id + '"' +
              ' aria-label="下移" title="下移">' + R_ICON.down + '</button>' +
            '<button type="button" class="radio-op radio-op-del" data-radio-act="del" data-id="' + row.id + '"' +
              ' aria-label="删除" title="删除">' + R_ICON.del + '</button>' +
          '</span>' : '') +
      '</li>';
  }

  /* 展开面板 */
  function radioPanelView(st) {
    st = st || {};
    var cur = st.current;
    var canManage = !!st.canManage;
    var q = (st.queue || []).map(function (r) {
      var copy = Object.create(r);
      copy._manage = canManage;
      return copy;
    });

    var listHtml;
    if (q.length) {
      listHtml = '<ul class="radio-list">' + q.map(function (r) { return radioTrackRow(r, st); }).join('') + '</ul>';
    } else if (st.listLoading) {
      /* 面板先开、数据后到：骨架期给明确的「正在调频」而不是"没有曲目"，
         否则网络慢时会误报空库（2026-09-29 实测点开半天没反应）。 */
      listHtml = '<div class="radio-empty radio-loading">' +
          '<span class="radio-empty-glyph" aria-hidden="true">◌</span>' +
          '<span>调频中 · 正在拉取曲目…</span>' +
        '</div>';
    } else {
      listHtml = '<div class="radio-empty">' +
          '<span class="radio-empty-glyph" aria-hidden="true">◌</span>' +
          '<span>频段静默 · 还没有曲目</span>' +
          (canManage ? '<span class="radio-empty-hint">用下方「+ 添加曲目」上传音频文件</span>' : '') +
        '</div>';
    }

    var repeatLabel = st.repeat === 'one' ? R_ICON.one + ' 单曲'
      : (st.repeat === 'all' ? R_ICON.repeat + ' 循环' : R_ICON.repeat + ' 关闭');

    return '' +
      '<div class="radio-panel" role="dialog" aria-modal="false" aria-label="电台播放器">' +
        '<div class="radio-panel-head">' +
          '<span class="radio-panel-title"><span aria-hidden="true">' + R_ICON.radio + '</span> RADIO</span>' +
          '<button type="button" class="radio-btn" data-radio-act="close" aria-label="收起">✕</button>' +
        '</div>' +

        '<div class="radio-now">' +
          '<div class="radio-now-cover' + (cur && cur.cover_url ? ' has-img' : '') + '"' +
            (cur && cur.cover_url ? ' style="background-image:url(' + esc(cur.cover_url) + ')"' : '') + '>' +
            (cur && cur.cover_url ? '' : '<span aria-hidden="true">' + R_ICON.radio + '</span>') +
          '</div>' +
          '<div class="radio-now-meta">' +
            '<div class="radio-now-title">' + (cur ? esc(cur.title || '未命名曲目') : '未在播放') + '</div>' +
            '<div class="radio-now-artist">' + (cur && cur.artist ? esc(cur.artist) : '—') + '</div>' +
            '<div class="radio-now-album">' + (cur && cur.album ? esc(cur.album) : '') + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="radio-bar">' +
          '<span class="radio-time" data-radio-time>0:00</span>' +
          '<input type="range" class="radio-seek" data-radio-act="seek" min="0" max="1000" value="0"' +
            ' aria-label="播放进度" step="1">' +
          /* ⚠ 总时长这一格必须带 data-radio-dur：它在整面板重绘时只渲染一次，
             而后由 paintPanelProgress 在 timeupdate 里持续纠正。
             没有这个钩子的话，切歌后它会一直停在上一首的值（实测过）。 */
          '<span class="radio-time" data-radio-dur>' + NEONRadio.fmtTime(st.duration) + '</span>' +
        '</div>' +

        '<div class="radio-ctrls">' +
          '<button type="button" class="radio-btn" data-radio-act="prev" aria-label="上一首">' +
            '<span aria-hidden="true">' + R_ICON.prev + '</span></button>' +
          '<button type="button" class="radio-btn radio-btn-play radio-btn-lg" data-radio-act="toggle"' +
            ' aria-label="' + (st.playing ? '暂停' : '播放') + '">' +
            '<span aria-hidden="true">' + (st.playing ? R_ICON.pause : R_ICON.play) + '</span></button>' +
          '<button type="button" class="radio-btn" data-radio-act="next" aria-label="下一首">' +
            '<span aria-hidden="true">' + R_ICON.next + '</span></button>' +
          '<button type="button" class="radio-btn' + (st.repeat !== 'off' ? ' is-on' : '') +
            '" data-radio-act="repeat" aria-label="循环模式：' + repeatLabel + '">' +
            '<span aria-hidden="true">' + (st.repeat === 'one' ? R_ICON.one : R_ICON.repeat) + '</span></button>' +
          '<button type="button" class="radio-btn' + (st.shuffle ? ' is-on' : '') +
            '" data-radio-act="shuffle" aria-label="随机播放' + (st.shuffle ? '（开）' : '（关）') + '">' +
            '<span aria-hidden="true">' + R_ICON.shuffle + '</span></button>' +
        '</div>' +

        '<div class="radio-vol">' +
          '<button type="button" class="radio-btn" data-radio-act="mute"' +
            ' aria-label="' + (st.muted ? '取消静音' : '静音') + '">' +
            '<span aria-hidden="true">' + (st.muted || st.volume === 0 ? R_ICON.mute : R_ICON.vol) + '</span></button>' +
          '<input type="range" class="radio-volume" data-radio-act="volume" min="0" max="100"' +
            ' value="' + Math.round((st.muted ? 0 : (st.volume || 0)) * 100) + '"' +
            ' aria-label="音量">' +
          '<span class="radio-vol-num">' + Math.round((st.muted ? 0 : (st.volume || 0)) * 100) + '%</span>' +
        '</div>' +

        '<div class="radio-list-head">' +
          '<span>曲目 <b>' + q.length + '</b></span>' +
          (canManage ? '<button type="button" class="btn btn-sm radio-add" data-radio-act="add">+ 添加曲目</button>' : '') +
        '</div>' +
        listHtml +
        (canManage ? '<div class="radio-drop" data-radio-drop hidden>松手即上传到频段</div>' : '') +
        /* 上传表单：默认隐藏，点「+ 添加曲目」后显示（避免隐藏的 file input 无法聚焦） */
        (canManage ? '' +
          '<div class="radio-form" data-radio-form hidden>' +
            '<label class="radio-field"><span>曲目名称 *</span>' +
              '<input type="text" data-radio-field="title" maxlength="200" placeholder="例如：夜航西飞"></label>' +
            '<label class="radio-field"><span>艺术家</span>' +
              '<input type="text" data-radio-field="artist" maxlength="200" placeholder="可留空"></label>' +
            '<label class="radio-field"><span>专辑</span>' +
              '<input type="text" data-radio-field="album" maxlength="200" placeholder="可留空"></label>' +
            '<label class="radio-field"><span>音频文件 *</span>' +
              '<input type="file" data-radio-field="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac"></label>' +
            '<div class="radio-form-ops">' +
              '<button type="button" class="btn btn-sm" data-radio-act="cancel-add">取消</button>' +
              '<button type="button" class="btn btn-sm btn-cyan" data-radio-act="submit-add">上传并加入</button>' +
            '</div>' +
            '<div class="radio-form-msg" data-radio-msg hidden></div>' +
          '</div>' : '') +
        '<div class="radio-hint">' +
          (canManage
            ? '提示：音频随曲目存在云端库中，<b>所有人（含未登录访客）</b>都可直接收听' +
              (audioLimitText() ? '；单曲上限 ' + audioLimitText() + '。' : '。')
            : '提示：按播放键即可收听。') +
        '</div>' +
      '</div>';
  }

  /* ---------- 导出 ---------- */
  window.NEONViews = {
    esc: esc,
    fmtDate: fmtDate,
    fmtSize: fmtSize,
    readingMinutes: readingMinutes,
    readingLabel: readingLabel,
    tagHash: tagHash,
    tagTone: tagTone,
    tagGlyph: tagGlyph,
    tagBadge: tagBadge,
    tagBadges: tagBadges,
    rankedTones: rankedTones,
    homeView: homeView,
    tagsView: tagsView,
    searchView: searchView,
    archiveView: archiveView,
    postView: postView,
    postTrail: postTrail,
    marksView: marksView,
    tagAdminView: tagAdminView,
    /* v2.8.0：电台 */
    radioDockView: radioDockView,
    radioPanelView: radioPanelView,
    R_ICON: R_ICON,
    aboutView: aboutView,
    loginView: loginView,
    adminView: adminView,
    editView: editView
  };
})();
