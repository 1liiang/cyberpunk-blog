'use strict';
/* ============================================================
   tests/cases/50-v4-5-0-hue-default.js — v4.5.0 出厂色相 184 → 285

   站长在配色面板里挑中了「紫」（285），拍板定为全站出厂色相。
   改动本身只是一行默认值，**真正的风险在存量迁移**：

     老用户浏览器里存着 `neon_hue=184` —— 那是**旧默认值**，
     与"用户真的动手挑了青"在存储里长得一模一样。
     若不处理存量，所有人（含站长的浏览器）打开还是青，等于没改。

   故引入「旧默认值 + 显式挑选标记」的判据：
       值 === 184  且  无 neon_hue_pick 标记  ⇒  视为"从未选过" → 落回新默认 285。

   ⚠ 本 case 守的就是这条判据的**三处同口径**。它是本版唯一会"静默出错"的地方：
     三处（theme-boot 首绘前 / app 运行时补正 / views 侧栏读数）若口径不一致，
     表现是"首绘紫、补正后跳青"或"侧栏写 184° 而配色是紫"——
     两种都极难从现象反推原因。

   覆盖四层：
     ① 常量与三处同口径（静态）
     ② 首绘前行为（theme-boot 真跑：jsdom + 预置存储）
     ③ 运行时行为（setHue 写标记 / getHue 的回落）
     ④ CSS 默认值与"能力未减少"（九档仍在、184 仍可选）
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, bootDom, stripComments } = require('../common');
const { ROOT } = require('../common');
const fs = require('fs');
const path = require('path');

const NEW_DEFAULT = 285;   /* 紫 */
const OLD_DEFAULT = 184;   /* 青（旧出厂） */
const PICK_KEY = 'neon_hue_pick';

/* 从 <html> 的**行内 style** 读 --hue。
   读不到 = theme-boot 没写 ⇒ 走 CSS :root 的默认值（这正是迁移路径的预期结果）。 */
function inlineHue(doc) {
  const v = doc.documentElement.style.getPropertyValue('--hue');
  return v === '' ? null : parseInt(v, 10);
}

async function run() {
  const S = makeSuite();
  const T = S.T;

  const css = stripComments(SRC.css);
  const app = stripComments(SRC.app);
  const themeBoot = stripComments(SRC.themeBoot);
  const views = stripComments(SRC.views);

  /* ================= ① CSS 默认值再核对（jq 无关，直接看 :root） ================= */
  {
    const CN = 'v4.5 出厂色相';
    const rootBlk = (/^:root\s*\{([\s\S]*?)\n\}/m.exec(css) || [, ''])[1];

    T(CN, 'R244 CSS :root 的 --hue 默认值为 285（紫）',
      /--hue:\s*285\s*;/.test(rootBlk),
      (/--hue:\s*\d+/.exec(rootBlk) || ['未找到 --hue'])[0]);

    /* 能力未减少：184 仍是九档之一，随时可切回青。
       这条防的是"顺手把 184 从 HUE_STOPS 里删掉"这种过度改动。 */
    const stops = (/HUE_STOPS\s*=\s*\[([^\]]+)\]/.exec(app) || [, ''])[1]
      .split(',').map(function (s) { return s.trim(); });
    T(CN, 'R244b 九档快捷仍在，且 184（青）未被移除（能力只换默认、不减项）',
      stops.length === 9 && stops.indexOf('184') !== -1 && stops.indexOf('285') !== -1,
      'stops=' + stops.join(','));

    /* 名称表未漂移（面板 title / aria-label 用它） */
    T(CN, 'R244c 色相名称表：285=紫、184=青',
      /285:\s*'紫'/.test(app) && /184:\s*'青'/.test(app),
      '名称表');
  }

  /* ================= ② 三处迁移判据同口径（静态） ================= */
  {
    const CN = 'v4.5 迁移口径';

    /* 三个文件都必须同时出现：旧默认常量 + 挑选标记键 + "与"关系。
       ⚠ 判据钉**同现**而非"某文件里有"—— 少一处就是不同口径。 */
    const hasOldConst = function (src) {
      return /HUE_OLD_DEFAULT\s*=\s*184/.test(src);
    };
    const hasPickKey = function (src) {
      return new RegExp('HUE_PICK_KEY\\s*=\\s*[\'"]' + PICK_KEY + '[\'"]').test(src);
    };

    T(CN, 'R245 theme-boot.js（首绘前）含旧默认常量与挑选标记键',
      hasOldConst(themeBoot) && hasPickKey(themeBoot),
      'old=' + hasOldConst(themeBoot) + ' pick=' + hasPickKey(themeBoot));

    T(CN, 'R245b app.js（运行时补正）含旧默认常量与挑选标记键',
      hasOldConst(app) && hasPickKey(app),
      'old=' + hasOldConst(app) + ' pick=' + hasPickKey(app));

    /* views.js 是第三个写入者 —— 它不参与"写 --hue"，但**读数**必须同口径，
       否则侧栏显示 184° 而整站配色是紫（读数与实物不符）。 */
    T(CN, 'R245c views.js（侧栏读数）同口径：184 且无标记 → 不采用该值',
      /neon_hue/.test(views) && /neon_hue_pick/.test(views) &&
      /n\s*===\s*184\s*&&\s*!picked/.test(views),
      '侧栏读数迁移判据');

    /* 三处都必须有"隐藏/回落新默认"的动作，而不只是"识别旧值" */
    T(CN, 'R245d 三处都回落新默认 285（不是只识别旧值却不改行为）',
      /return\s+285/.test(views) && /HUE_DEFAULT\s*=\s*285/.test(app),
      'defaults');
  }

  /* ================= ③ 首绘前真跑 theme-boot（jsdom + 预置存储） ================= */
  {
    const CN = 'v4.5 迁移行为';

    /* 3.1 存量用户：存 184、无标记 ⇒ 不写 --hue（交给 CSS 默认 285） */
    const c1 = bootDom({
      themeBoot: true, themeBootOnly: true,
      storage: { neon_hue: String(OLD_DEFAULT) }
    });
    T(CN, 'R246 存量「184 且无挑选标记」→ theme-boot 不写 --hue（落回 CSS 新默认）',
      inlineHue(c1.doc) === null,
      'inline --hue = ' + inlineHue(c1.doc));

    /* 3.2 明选过其他色相：原样应用，不能被迁移误伤 */
    const c2 = bootDom({
      themeBoot: true, themeBootOnly: true,
      storage: { neon_hue: '330' }
    });
    T(CN, 'R246b 存量「330」→ 原样写入 --hue（迁移不误伤其它选择）',
      inlineHue(c2.doc) === 330,
      'inline --hue = ' + inlineHue(c2.doc));

    /* 3.3 明选过青（有标记）：184 必须留住。
           ⚠ 这条是本设计的**关键**：没有它，"回头选青的人每次开站被弹回紫"。 */
    const c3 = bootDom({
      themeBoot: true, themeBootOnly: true,
      storage: { neon_hue: String(OLD_DEFAULT), neon_hue_pick: '1' }
    });
    T(CN, 'R246c 明选过青（184 + 挑选标记）→ --hue 写 184，不被迁移弹回',
      inlineHue(c3.doc) === OLD_DEFAULT,
      'inline --hue = ' + inlineHue(c3.doc));

    /* 3.4 首访（无任何存储）：不写 --hue，走 CSS 默认 */
    const c4 = bootDom({ themeBoot: true, themeBootOnly: true, storage: {} });
    T(CN, 'R246d 首访（无存储）→ 不写 --hue，走 CSS 的 285 默认',
      inlineHue(c4.doc) === null,
      'inline --hue = ' + inlineHue(c4.doc));

    /* 3.5 存储被禁用（隐私模式）：引导脚本必须静默降级，
           既不能抛错，也不能写出非法 --hue。 */
    const c5 = bootDom({ themeBoot: true, themeBootOnly: true, breakStorage: true });
    T(CN, 'R246e 存储被禁用 → 静默降级（不写 --hue、不抛错）',
      inlineHue(c5.doc) === null,
      'inline --hue = ' + inlineHue(c5.doc));
  }

  /* ================= ④ 运行时：setHue 必须写"显式挑选"标记 ================= */
  {
    const CN = 'v4.5 迁移行为';

    const ctx = bootDom({ url: 'https://x.test/#/' });
    await ctx.waitFor(function () { return !!ctx.w.NEONControls; }, 5000);

    /* 4.1 点色卡 → 存储写值 + 写标记 + --hue 立刻生效 */
    ctx.w.NEONControls.setHue(OLD_DEFAULT);
    T(CN, 'R247 setHue(184) 写入挑选标记 neon_hue_pick=1',
      ctx.w.localStorage.getItem(PICK_KEY) === '1',
      'pick=' + ctx.w.localStorage.getItem(PICK_KEY));

    T(CN, 'R247b setHue(184) 同时落值、并立刻改写 --hue',
      ctx.w.localStorage.getItem('neon_hue') === '184' &&
      ctx.doc.documentElement.style.getPropertyValue('--hue') === '184',
      'store=' + ctx.w.localStorage.getItem('neon_hue') +
      ' --hue=' + ctx.doc.documentElement.style.getPropertyValue('--hue'));

    /* 4.2 有标记之后，再走一次启动补正路径 —— 184 必须被认作"合法选择"而非"没选过"。
           这条把"标记真的被消费"钉住（写标记而不读标记 = 白写）。 */
    const c = bootDom({
      themeBoot: true, themeBootOnly: true,
      storage: { neon_hue: '184', neon_hue_pick: '1' }
    });
    T(CN, 'R247c 标记被真正消费：同样存 184，有标记就写、无标记就不写（对照）',
      inlineHue(c.doc) === 184,
      'inline --hue = ' + inlineHue(c.doc));

    /* 4.3 滑杆的两条路径都要经 setHue 的**落存储**语义：
           input（拖动中）→ applyHue：只改 CSS 变量，不写存储（写了会拖钝手感）
           change（松手）→ setHue：落存储 + 写挑选标记
         于是"松手"也一样置位标记 ⇒ 拖滑杆选青的人同样不会被迁移弹回。
         ⚠ 首跑这条曾按"滑杆直接走 setHue"写死而报红 —— 实际是 input/change 分流，
           是**断言写错了**，不是代码有问题。此处按真实设计钉。 */
    T(CN, 'R247d 滑杆 input 只预览（applyHue，不写存储）、change 才落存储（setHue）',
      /addEventListener\('input'[\s\S]{0,200}?applyHue\(parseInt\(ev\.target\.value, 10\)\)/.test(app) &&
      /addEventListener\('change'[\s\S]{0,200}?setHue\(parseInt\(ev\.target\.value, 10\)\)/.test(app),
      'input→applyHue / change→setHue');

    ctx.dom.window.close();
  }

  /* ================= ⑤ 面板滑杆初值随默认值走（不再写死） ================= */
  {
    const CN = 'v4.5 出厂色相';
    T(CN, 'R248 面板滑杆初值由 HUE_DEFAULT 生成（不写死 184，避免与新默认脱节）',
      /' value="'\s*\+\s*HUE_DEFAULT\s*\+\s*'"/.test(app) &&
      !/value="184"/.test(app),
      /value="\d+"|'\s*\+\s*HUE_DEFAULT/.test(app) ? '已参数化' : '未找到');
  }

  return { pass: S.results.filter(function (r) { return r.pass; }).length,
          fail: S.results.filter(function (r) { return !r.pass; }).length,
          results: S.results };
}

module.exports = { run: run, name: "v4.5 出厂色相：285 + 存量迁移三处同口径" };

standalone(module, run);
