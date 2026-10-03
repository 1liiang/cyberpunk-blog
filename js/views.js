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

  /* 统一加载和错误状态。静态骨架预留高度，取数结束后由结果替换；
     错误文字仍保留具体原因，不用装饰遮盖失败。 */
  function loadingBlock(code, hint) {
    return '<div class="empty-state loading-state" role="status" aria-live="polite">' +
      '<div class="loading-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>' +
      (code ? '<span class="empty-code">' + esc(code) + '</span>' : '') +
      '<span class="empty-hint">' +
      esc(hint || '正在接入数据流') + '</span></div>';
  }

  function errorBlock(state, withCode) {
    return '<div class="empty-state"><span class="empty-glyph">⚠</span>' +
      (withCode === false ? '' : '<span class="empty-code">CONNECTION LOST</span>') +
      '<span class="empty-hint">' + esc(state.error) + '</span></div>';
  }

  /* v4.9.1：锁定态用的霓虹锁（**内联 SVG**，不用 <use>/sprite）。
     ⚠ 为什么不用 sprite + <use>：<use> 克隆出的内容活在**影子树**里，
       `.mark-lock .lk-body` 这类选择器**进不去**，于是描边规则全部失效、
       path 退回默认 fill:#000 —— 实测渲染成一块黑色实心疙瘩（截图才发现）。
       同理，悬停时那条扫描线也永远动不了。内联之后选择器与动画都正常。
     ⚠ 这段必须与 app.js 的 LOCK_SVG **字面一致**：两处渲染出不同的锁，
       正是本项目踩过的"半新半旧"那类事故（卡片版 / 详情页版 / 空态版三处都用它）。 */
  function lockSvg() {
    return '<svg class="mark-lock" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path class="lk-shackle" d="M8.4 10.6V8.2a3.6 3.6 0 0 1 7.2 0v2.4"/>' +
      '<path class="lk-body" d="M6.6 10.6h10.8l1.6 1.6v6.6l-1.6 1.6H6.6L5 18.8v-6.6z"/>' +
      '<circle class="lk-hole" cx="12" cy="14.5" r="1.5"/>' +
      '<path class="lk-hole" d="M12 15.9v2.4"/>' +
      '<path class="lk-scan" d="M5.4 12.4h13.2"/>' +
      '</svg>';
  }

  function postCard(p) {
    /* 注意：数据库行字段是 cover_ref（snake_case）。
       此处曾误写 coverRef（camelCase）导致首页封面从不渲染，v1.5.0 修复。 */
    /* 封面与文字分开，标题不再压在图片上；同一结构适配精选横卡和双列文章流。 */
    var hasCover = !!p.cover_ref;
    var coverHtml = hasCover
      ? '<div class="card-cover" data-cover="' + esc(p.cover_ref) + '" aria-hidden="true"></div>'
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
    /* v4.9.0：未登录时按钮仍是可点的（点了给"需要登录"的引导），
       但要**看起来**像锁上的 —— 否则访客会以为点了没反应。
       v4.9.1：锁不再用 🔒 emoji（与霓虹风格不搭），改为内联 SVG 图元
       `#neon-lock`（定义在 index.html 的 sprite 里，currentColor 穿过 <use> 继承，
       所以颜色自动跟随按钮 —— 换主题/色相不用改一行代码）。 */
    var locked = !!p._markLocked;
    var markHtml = '<button type="button" class="card-mark' + (marked ? ' is-on' : '') + (locked ? ' is-locked' : '') +
      '" data-mark="' + p.id + '" aria-pressed="' + (marked ? 'true' : 'false') +
      '" title="' + (locked ? '登录后可收藏' : (marked ? '取消收藏' : '收藏这条信号')) + '"' +
      ' aria-label="' + (locked ? '登录后可收藏：' : (marked ? '取消收藏：' : '收藏这条信号：')) + esc(p.title) + '">' +
      '<span class="mark-glyph" aria-hidden="true">' + (locked ? lockSvg() : (marked ? '◈' : '◇')) + '</span></button>';
    return '' +
      /* F1 卡片键盘可达：tabindex 让整卡进入 Tab 序，role=link + aria-label
         告诉读屏这是一个"链接到文章"的元素及其目的地。
         ⚠ 不能用 <a> 包整卡 —— 卡内已有 <a> 标签（tag 链接），HTML 禁止 a 嵌套；
         Enter/Space 的激活由 app.js 的 keydown 代理完成。 */
      '<article class="post-card' + (hasCover ? ' has-cover' : ' no-cover') + '" data-id="' + p.id + '"' +
      ' tabindex="0" role="link" aria-label="阅读：' + esc(p.title) + '">' +
        statusHtml +
        coverHtml +
        (!hasCover ? '<span class="card-spark" aria-hidden="true">✧</span>' : '') +
        '<div class="card-copy">' +
          '<h2>' + esc(p.title) + '</h2>' +
          (p.summary ? '<div class="card-summary">' + esc(p.summary) + '</div>' : '') +
          '<div class="card-meta">' +
            '<span class="meta-date">' + fmtDate(p.created_at) + '</span>' +
            (p.owner_name ? '<span class="meta-author">' + esc(p.owner_name) + '</span>' : '') +
            readHtml +
            '<span class="card-tags">' + tagChips(p.tags) + '</span>' +
          '</div>' +
        '</div>' +
        markHtml +
      '</article>';
  }

  /* ---------- 首页 / 标签过滤页 ---------- */
  function homeView(state) {
    var posts = state.posts || [];

    /* 首页主视觉由独立的 holoHero 承载，这里只更新文章区。
       标签页保留连续列表；精选卡独立于唯一的 .post-list。 */
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

  /* 标签数量从已加载的文章聚合，不增加网络请求。 */
  function localTagStats(posts) {
    var map = {};
    (posts || []).forEach(function (p) {
      (p.tags || []).forEach(function (t) { map[t] = (map[t] || 0) + 1; });
    });
    return map;
  }

  function heroHtml(state) {
    return '<section class="hero hero-feed" aria-label="最新广播">' +
        '<div class="page-head"><h2>最新广播</h2>' +
          '<div class="crumb">SIGNAL FEED · 共 <b>' + state.total + '</b> 条信号</div>' +
        '</div>' +
      '</section>';
  }

  /* 栏目页签：去掉工程编号，保留真实栏目名称。 */
  function blockSign(name, en) {
    return '<header class="block-sign">' +
      '<span class="block-spark" aria-hidden="true">✦</span>' +
      '<span class="block-name">' + name + '<i> / ' + en + '</i></span>' +
      '</header>';
  }

  /* v3.2.0 B3：页面级编号。
     首页六个模块占 MODULE 01~06，其余版块从 07 接着往下编，全站连成一条编号线。
     ⚠ 编号标是 h1 的**兄弟节点**（不是 h1 内容）—— 既有的页头 h1 文案断言不受影响。 */
  function pageNo(code) {
    return '<span class="page-no">SECTOR ' + code + '</span>';
  }

  function tagModule(tagKeys, tags) {
    if (!tagKeys.length) return '';
    return '<article class="block block-freq" data-block="04">' +
      blockSign('标签频段', 'FREQ') +
      '<div class="freq-list">' + tagKeys.map(function (k) {
        /* 复用 .tag-chip 的色号映射（[data-tone="tN"] { --tone: … }）——
           不在这里再写第三份"色号 → 颜色"表：那种表多一份就多一处漂移点。 */
        return '<a class="tag-chip freq-chip" data-tone="t' + tagTone(k) + '" href="#/tag/' +
          encodeURIComponent(k) + '">' + esc(k) + '<b>' + tags[k] + '</b></a>';
      }).join('') + '</div>' +
      '<p class="block-note">基于已加载的 ' + Object.keys(tags).length + ' 个频段</p>' +
      '</article>';
  }

  function districtHtml(state) {
    var posts = state.posts || [];
    /* 主卡由首页首次取数锁定，追加内容保持原有时间顺序。
       独立渲染视图时也可省略 featuredId，自动选取一篇封面文章。 */
    var featuredIndex = state.featuredId == null
      ? posts.findIndex(function (p) { return !!p.cover_ref; })
      : posts.findIndex(function (p) { return p.id === state.featuredId; });
    if (featuredIndex < 0) featuredIndex = 0;
    var featured = posts[featuredIndex];
    var rest = posts.filter(function (p, i) { return i !== featuredIndex; });
    var tags = localTagStats(posts);
    var tagKeys = Object.keys(tags)
      .sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 8);

    /* 文章区只保留精选、信号流与标签入口。即使只有一张精选卡，
       hasMore 仍能显示加载按钮，避免分页入口被 rest.length 隐藏。 */
    return '<section class="district" id="district" aria-label="文章与标签">' +
      (featured
        ? '<article class="block block-featured" data-block="01">' +
            blockSign(featured.cover_ref ? '封面信号' : '最新信号', 'SPOTLIGHT') +
            '<div class="block-body">' + postCard(featured) + '</div>' +
          '</article>'
        : '') +
      (rest.length || state.hasMore
        ? '<article class="block block-stream" data-block="02">' +
            blockSign('继续探索', 'STREAM') +
            '<div class="block-body"><div class="post-list">' + rest.map(postCard).join('') + '</div></div>' +
            (state.hasMore
              ? '<div class="load-more-wrap"><button class="btn" id="btn-load-more">加载更多信号 ▾</button></div>'
              : '') +
          '</article>'
        : '') +
      tagModule(tagKeys, tags) +
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
      '<div class="search-bar hud-frame' + (state.loading && q ? ' is-searching' : '') + '" aria-busy="' + (state.loading ? 'true' : 'false') + '">' +
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
      /* v4.9.3：空态加背景插画（站长提供的图）—— "一点开这一页就能看到"。
         ⚠ 图走 CSS 的 .search-hero::before（纯装饰，不进无障碍树、也能被打印样式单独关掉），
           并叠两层遮罩：原图很亮（霓虹粉），不压暗会把 READY 与提示文字吃掉。
         ⚠ **结果态不铺图** —— 那会跟列表抢注意力，长列表滚动时也更花。 */
      html += '<div class="search-hero">' +
          '<div class="search-hero-inner">' +
            '<div class="empty-state"><span class="empty-glyph">⌕</span><span class="empty-code">READY</span>' +
              '<span class="empty-hint">索引已就绪 · 共 ' + (state.total || 0) + ' 条信号待扫描</span></div>' +
          '</div>' +
        '</div>' +
        partialNote(state);
      return html;
    }
    if (hits.length === 0) {
      html += '<div class="empty-state has-mascot">' + holoMascot('search') + '<span class="empty-code">NO MATCH</span>' +
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
      '<div class="page-head post-back"><div class="crumb"><a href="#/">← 所有信号</a> ▸ <b>' + crumbTail + '</b></div></div>';

    if (state.loading) {
      html += loadingBlock(null, '正在解码信号');
      return html;
    }
    if (!state.post) {
      html += '<div class="empty-state"><span class="empty-glyph">⚠</span><h1 class="empty-code">404 // SIGNAL NOT FOUND</h1>' +
        '<span class="empty-hint">信号不存在，或尚未公开（草稿仅作者可见）</span>' +
        '<div style="margin-top:22px"><a class="btn" href="#/">返回信号列表</a></div></div>';
      return html;
    }
    var p = state.post;
    /* C18：详情页也标注阅读时长 —— 与卡片同源同算法，读者在列表与详情看到的一致 */
    var readLabel = readingLabel(p);
    /* C19：收藏按钮（详情页版本，与卡片版共用 data-mark 委托）
       v4.9.0：未登录时显示锁定态（点了会引导去登录） */
    var marked = !!(state.marked);
    var markLocked = !!state.markLocked;
    var markBtn = '<button type="button" class="btn btn-ghost btn-mark' + (marked ? ' is-on' : '') + (markLocked ? ' is-locked' : '') +
      '" id="post-mark" data-mark="' + p.id + '" aria-pressed="' + (marked ? 'true' : 'false') + '"' +
      ' title="' + (markLocked ? '登录后可收藏' : (marked ? '取消收藏' : '收藏这条信号')) + '">' +
      '<span class="mark-glyph" aria-hidden="true">' + (markLocked ? lockSvg() : (marked ? '◈' : '◇')) + '</span>' +
      (markLocked ? '登录后可收藏' : (marked ? '已收藏' : '收藏')) + '</button>';
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
              '<span class="rf-tag">正文</span>' +
              '<span class="rf-stats">' + blockCount + ' 段 · 约 ' + charCount + ' 字</span>' +
              '<details class="reading-options"><summary>阅读设置</summary>' +
                '<div class="reading-options-panel" aria-label="阅读设置">' +
                  '<div class="reading-setting"><span>字号</span><div role="group" aria-label="正文字号">' +
                    '<button type="button" class="rf-btn" data-reading-size="standard" aria-pressed="true">标准</button>' +
                    '<button type="button" class="rf-btn" data-reading-size="large" aria-pressed="false">大字</button>' +
                  '</div></div>' +
                  '<div class="reading-setting"><span>正文宽度</span><div role="group" aria-label="正文宽度">' +
                    '<button type="button" class="rf-btn" data-reading-width="standard" aria-pressed="true">适中</button>' +
                    '<button type="button" class="rf-btn" data-reading-width="wide" aria-pressed="false">宽版</button>' +
                  '</div></div>' +
                  '<div class="reading-setting"><span>段落辅助</span><button type="button" class="rf-btn" id="ln-toggle" aria-pressed="false">显示行号</button></div>' +
                '</div>' +
              '</details>' +
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
     ⚠ 只改这一个值：首页与关于页的显示和 data-born 全部跟着走，
       不存在第二处要同步的日期字面量。 */
  var SITE_BORN = '2026-09-28T00:18:00+08:00';
  function bornDisplay() {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(SITE_BORN);
    return m ? m[1] + '.' + m[2] + '.' + m[3] : SITE_BORN;
  }

  function aboutView() {
    return '' +
      '<div class="page-head"><h1>关于这里</h1><div class="crumb">日常、代码与深夜的灵感</div></div>' +
      '<p class="about-uptime" data-born="' + SITE_BORN + '" aria-label="站点在线时长">' +
        '<span aria-hidden="true">✦</span> 自 ' + bornDisplay() + ' 持续广播 <b id="uptime-days">—</b> 天' +
      '</p>' +
      '<div class="about-grid">' +
        '<div class="about-card about-intro">' +
          '<h2>你好，我是漓江。</h2>' +
          '<p>这座霓虹废墟里的日记本，记录代码、小说、以及深夜的一切胡思乱想。如果你读到了这里，说明信号没有衰减。</p>' +
          '<p class="about-topics"><span>代码</span><span>小说</span><span>日常</span></p>' +
          '<a class="btn btn-ghost" href="#/archive">翻阅日记</a>' +
        '</div>' +
        '<div class="about-card about-notes">' +
          '<h2>在这里慢慢逛</h2>' +
          '<p>可以按标签寻找感兴趣的内容，也可以登录后收藏喜欢的文章。</p>' +
          '<p>文章版权归作者所有；附件需要登录后下载。请尊重每一位作者的表达。</p>' +
          '<details class="about-system"><summary>关于网站与写作</summary>' +
            '<div class="about-system-body">' +
              '<p>页面以静态文件加载，文章、登录与收藏接入云端服务。</p>' +
              '<div class="about-stat"><span>正文格式</span><span>Markdown + 代码高亮</span></div>' +
              '<div class="about-stat"><span>登录方式</span><span>邮箱密码 / 验证码</span></div>' +
              '<p>注册后进入控制台，即可写下自己的广播。</p>' +
            '</div>' +
          '</details>' +
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
        '<div class="crumb">跟随账号 · 已收藏 <b>' + posts.length + '</b> 条信号</div>' +
      '</div>';

    /* ★ v4.9.0 门槛：未登录只能浏览。
       与「标签管理」同一处理 —— 给明确引导，而不是渲染一个点了没反应的界面。 */
    if (state.needLogin) {
      html += '<div class="empty-state"><span class="empty-glyph empty-glyph-lock">' + lockSvg() + '</span><span class="empty-code">ACCESS REQUIRED</span>' +
        '<span class="empty-hint">收藏是账号功能：登录后才能收藏，未登录只能浏览。' +
        '登录后收藏跟着账号走 —— 换设备也在。</span>' +
        '<div style="margin-top:22px"><button class="btn" id="marks-login">去登录 / ACCESS</button></div></div>';
      return html;
    }

    if (state.loading) {
      html += loadingBlock('LOADING...', '正在读取你账号下的收藏');
      return html;
    }
    if (posts.length === 0 && state.offline) {
      /* 云端不可达 ≠ 没有收藏 —— 这两件事必须分开说，否则用户以为收藏被清空了 */
      html += '<div class="empty-state"><span class="empty-glyph">⚠</span><span class="empty-code">CLOUD UNREACHABLE</span>' +
        '<span class="empty-hint">现在连不上云端，收藏暂时读不出来（不是被清空了）。恢复连接后刷新即可。</span>' +
        '<div style="margin-top:22px"><a class="btn" href="#/">回信号流</a></div></div>';
      return html;
    }
    if (posts.length === 0) {
      html += '<div class="empty-state has-mascot">' + holoMascot('stash') + '<span class="empty-code">STASH EMPTY</span>' +
        '<span class="empty-hint">还没有收藏任何信号 · 在卡片或文章页点 ◇ 即可收藏</span>' +
        '<div style="margin-top:22px"><a class="btn" href="#/">去信号流里逛逛</a></div></div>';
      return html;
    }
    html += '<div class="partial-note">// 收藏保存在你的账号下，换设备登录后依然在</div>';
    html += '<div style="margin-bottom:22px"><button class="btn btn-ghost" id="marks-clear" ' +
      'style="color:var(--red);border-color:rgba(255,56,96,.4)">✕ 清空收藏</button></div>';
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
     v2.8.0 → v5.1.0：电台（RADIO）视图
     ------------------------------------------------------------
     ⚠ v5.6.1 清理：v2.8.0 那套「迷你条 dock + 展开面板 panel」的视图出口
     （radioDockView / radioTrackRow / radioPanelView / audioLimitText 与 R_ICON）
     随 HANDOVER §6 审计清单 ② 一并删除 ——
     容器（index.html 的 #radio-dock / #radio-panel-host）早在 v5.2.0 就没了，
     这些函数体也已是死代码；它们还是 RADIO_FIELDS 之外唯一还在读
     `window.NEON.AUDIO_MAX`、`has_data`、`duration_sec`、`cover_url`、
     `radio-track-*` 类名的地方。播放界面现在在 #radio-stage（app.js 的 paintStage）。

     ⚠ 纯渲染，不含事件绑定 —— 绑定在 app.js 里做（事件代理），
       这样本文件保持"数据 → HTML 字符串"的纯函数约定，便于测试。
     ⚠ CSP 禁内联事件：这里绝不出现内联事件属性，全部靠 data-radio-* 属性 + 代理。
     （注：本行刻意不写出被禁属性的字面形式 —— 源码扫描类断言会把它当真实用法。）
     ============================================================ */

  /* 同一只小猫用于欢迎区、搜索空态与收藏空态；始终为纯装饰。 */
  function holoMascot(mood) {
    var label = mood === 'search' ? '再换个关键词试试' : (mood === 'stash' ? '等一篇喜欢的故事' : 'NEKO://ONLINE');
    return '<div class="holo-mascot' + (mood ? ' is-' + mood : '') + '" aria-hidden="true">' +
      '<span class="holo-mascot-orbit"></span>' +
      '<span class="holo-mascot-ear is-left"></span><span class="holo-mascot-ear is-right"></span>' +
      '<span class="holo-mascot-face"><i class="holo-mascot-eye is-left"></i><i class="holo-mascot-eye is-right"></i>' +
        '<i class="holo-mascot-mouth"></i><i class="holo-mascot-cheek is-left"></i><i class="holo-mascot-cheek is-right"></i></span>' +
      '<span class="holo-mascot-spark is-one">✦</span><span class="holo-mascot-spark is-two">✧</span>' +
      '<span class="holo-mascot-tag">' + label + '</span>' +
      '</div>';
  }

  /* 首页全息欢迎区。时长只显示一份；电台默认折叠，其节点位于
     #home-content 外，列表更新不会替换播放器。折叠不会卸载 iframe。 */
  function holoHero(state) {
    state = state || {};
    var bootDate = state.bootDate || '----------';
    var nickname = state.nickname || 'NEON://DIARY';
    var tags = state.tags || ['私人频道', '日常与灵感'];
    var stations = state.stations || [];
    return '' +
      '<div class="holo-hero">' +
        '<section class="holo-welcome">' +
          '<p class="holo-kicker"><span aria-hidden="true">✦</span> PERSONAL SIGNAL / 私人频道</p>' +
          '<h1 class="holo-heading"><span class="holo-brand">NEON://DIARY</span>把日常，写成发光的信号。</h1>' +
          '<p class="holo-intro">NIGHT CITY 边缘的一座小小信号塔。记录代码、小说，以及深夜的一切胡思乱想。</p>' +
          '<div class="holo-actions"><a class="btn" href="#/search">寻找一段信号 <span aria-hidden="true">↗</span></a>' +
            '<a class="btn btn-ghost" href="#/about">认识站长</a></div>' +
          '<div class="holo-status" data-born="' + SITE_BORN + '" aria-label="建站时间 ' + esc(bootDate) + '；站点在线时长" title="自 ' + esc(bootDate) + ' 起广播">' +
            '<span class="holo-boot"><span>BOOT DATE</span><b>' + esc(bootDate) + '</b></span>' +
            '<span class="uptime-live"><i aria-hidden="true"></i>持续广播</span>' +
            '<span class="uptime-num" data-holo-uptime>' + esc(String(state.uptimeText || '----')) + '</span>' +
          '</div>' +
        '</section>' +
        '<div class="holo-card" data-holo-card>' +
          holoMascot() +
          '<div class="holo-id-top">' +
            '<span class="holo-avatar" aria-hidden="true">' + esc(nickname.slice(0, 1)) + '</span>' +
            '<span>' +
              '<span class="holo-name">' + esc(nickname) + '</span>' +
              '<span class="holo-tags">' + tags.map(function (x) { return '<span class="holo-tag">' + esc(x) + '</span>'; }).join('') + '</span>' +
            '</span>' +
          '</div>' +
          '<p class="holo-card-note">在代码与故事之间，收集一点灵感，也留一点可爱。</p>' +
        '</div>' +
        '<details class="holo-radio" data-holo-radio>' +
          '<summary class="holo-radio-head"><span class="holo-radio-tag">♫ RADIO LINK</span>' +
            '<span>给阅读加一点背景音乐</span><span class="holo-radio-live">展开收听 <i aria-hidden="true"></i></span></summary>' +
          '<div class="holo-radio-body">' +
            '<div class="holo-radio-list" data-radio-list>' +
              stations.map(function (st) {
                return '<button type="button" class="holo-radio-item" data-radio-id="' + esc(String(st.id)) +
                  '" data-radio-type="' + esc(String(st.type)) + '" aria-pressed="false">' +
                  '<span class="holo-radio-name">' + esc(st.name) + '</span>' +
                  '<span class="holo-radio-kind">' + (String(st.type) === '0' ? '歌单' : '单曲') + '</span>' +
                '</button>';
              }).join('') +
            '</div>' +
            /* v5.9.4：面板里只留**占位锚点**。真正的播放器常驻在 #radio-persistent
               （永不搬动，避免浏览上下文重建导致断音），首页时用 fixed 定位覆盖到这里。
               未挂载时锚点自己显示提示文案。 */
            '<div class="holo-radio-anchor" data-radio-anchor><div class="holo-radio-ph" data-radio-ph>选择上方曲目，<b>开始收听</b></div></div>' +
            '<p class="holo-radio-foot">网易云官方播放器 · 点击播放器开始播放</p>' +
          '</div>' +
        '</details>' +
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
    holoHero: holoHero,
    SITE_BORN: SITE_BORN,
    tagAdminView: tagAdminView,
    aboutView: aboutView,
    loginView: loginView,
    adminView: adminView,
    editView: editView
  };
})();
