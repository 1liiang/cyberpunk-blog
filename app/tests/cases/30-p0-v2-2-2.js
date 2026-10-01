'use strict';
/* ============================================================
   tests/cases/30-p0-v2-2-2.js — P0 v2.2.2（B1 / A1 / A2 / E4）

   对应 v2.2.2 的 P0 批次四项（原《UI优化建议.md》已随历史归档清理）：
     · B1  亮色主题 3 处硬编码色变量化（--md-h4 / --md-em / --md-quote）
     · A1  详情页正文限宽 760px
     · A2  h2/h3 scroll-margin-top: 76px（锚点落点兜底）
     · E4  toast 类型前缀符号（✕/✓/⚠/▸）

   写法原则（同 29 号 D3 守则）：
     · 必须钉源码的，钉【语义】而不是字符串全等
     · 每条断言都能反向验证：把修复摘掉它必须报红
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, stripComments, stripJsLineComments, cssRuleBody } = require('../common');

/* 提取某变量在 CSS 全文里的全部定义值（--name: #xxx） */
function varValues(cssText, name) {
  const re = new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{3,8})', 'g');
  const vals = [];
  let m;
  while ((m = re.exec(cssText))) vals.push(m[1].toLowerCase());
  return vals;
}

/* 取 html[data-theme="light"] { ... } 的块体（该块内无嵌套规则，第一个 } 即块尾；
   stripComments 已把注释剥掉，不会截断在注释里的 } 上） */
function lightBlock(cssText) {
  const i = cssText.indexOf('html[data-theme="light"]');
  if (i === -1) return '';
  const open = cssText.indexOf('{', i);
  const close = cssText.indexOf('}', open);
  if (open === -1 || close === -1) return '';
  return cssText.slice(open, close);
}

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const css = stripComments(SRC.css);

  /* 顶层规则遍历器（选择器, 体）。cssRuleBody 对联合选择器的成员（如 h4 是
     L599 联合规则的尾部）会误命中前导规则，这里统一用自己的遍历器。 */
  const rules = [];
  {
    const re = /(^|\})\s*([^{}]+)\{/g;
    let m;
    while ((m = re.exec(css))) {
      const open = re.lastIndex;
      const close = css.indexOf('}', open);
      if (close === -1) break;
      rules.push([m[2], css.slice(open, close)]);
      re.lastIndex = close;
    }
  }

  /* ================= B1：亮色硬编码色变量化 ================= */
  {
    /* h4 的 color 定义在独立规则里（联合规则只有 text-bright 兜底）：
       存在命中 .md-body h4 的规则体走 var(--md-h4) 且无十六进制色。 */
    const h4Ok = rules.some(function (r) {
      return /(^|[\s,])\.md-body h4(?![\w-])/.test(r[0]) &&
        /color\s*:\s*var\(--md-h4\)/.test(r[1]) && !/#[0-9a-f]{3,8}/i.test(r[1]);
    });
    T('B1 亮色硬编码色', 'R94 .md-body h4 颜色走 --md-h4（不再硬编码）', h4Ok,
      h4Ok ? 'ok' : '未找到含 var(--md-h4) 的 .md-body h4 规则');

    const em = cssRuleBody(css, '.md-body em');
    T('B1 亮色硬编码色', 'R94b .md-body em 颜色走 --md-em（规则体内不再有十六进制色）',
      em !== null && /color\s*:\s*var\(--md-em\)/.test(em) && !/#[0-9a-f]{3,8}/i.test(em),
      em === null ? '未找到 .md-body em 规则' : em.trim());

    const quote = cssRuleBody(css, '.md-body blockquote');
    T('B1 亮色硬编码色', 'R94c .md-body blockquote 颜色走 --md-quote（不再硬编码 #d9a0b8）',
      quote !== null && /color\s*:\s*var\(--md-quote\)/.test(quote) && !/d9a0b8/i.test(quote),
      quote === null ? '未找到 .md-body blockquote 规则' : quote.trim());

    /* 三变量必须在暗/亮两张表各有一份定义 —— 只剩一份说明亮色表漏加，
       本 bug 的本质正是"亮色沿用暗色值"。 */
    const counts = ['md-h4', 'md-em', 'md-quote'].map(function (n) {
      return varValues(css, n).length;
    });
    T('B1 亮色硬编码色', 'R94d 三变量在暗/亮两表都有定义（各 ≥2 处）',
      counts.every(function (c) { return c >= 2; }), counts.join('/'));

    const lb = lightBlock(css);
    const inLight = ['md-h4', 'md-em', 'md-quote'].every(function (n) {
      return new RegExp('--' + n + '\\s*:').test(lb);
    });
    T('B1 亮色硬编码色', 'R94e html[data-theme="light"] 块内三变量齐备',
      inLight, lb ? 'ok' : '未找到亮色变量表');

    /* 亮色值必须 ≠ 暗色值（压暗版）。任一变量两表同值即退化回原 bug。 */
    const diffs = ['md-h4', 'md-em', 'md-quote'].map(function (n) {
      const v = varValues(css, n);
      const uniq = v.filter(function (x, i) { return v.indexOf(x) === i; });
      return uniq.length;
    });
    T('B1 亮色硬编码色', 'R94f 三变量亮色值与暗色值不同（确实是压暗版）',
      diffs.every(function (u) { return u >= 2; }), diffs.join('/'));
  }

  /* ================= A1：正文限宽 ================= */
  {
    const body = cssRuleBody(css, '.md-body');
    /* v3.4.2 批 B：限宽改为走 --w-read 变量（值与原来等价：760px）。
       判据随之升级 —— 不能只看"有没有 760px 这个字面值"：
       现在要同时钉住「规则引用了变量」与「变量的值确实是 760px」，
       否则改了变量就能偷偷改掉全站正文行宽，而这正是本次接入想避免的事。 */
    T('A1 正文限宽', 'R95 .md-body 限宽 760px 且水平居中（走 --w-read，值须为 760px）',
      body !== null && /max-width\s*:\s*(760px|var\(--w-read\))/.test(body) &&
      /margin-inline\s*:\s*auto/.test(body) &&
      /--w-read\s*:\s*760px/.test(css),
      body === null ? '未找到 .md-body 规则' : body.trim());
  }

  /* ================= A2：锚点落点兜底 ================= */
  {
    /* 复用外层 rules 遍历器（不能用 cssRuleBody('.md-body h2, .md-body h3')：
       L599 联合选择器含同样子串，会误命中没有 scroll-margin 的规则体）。
       钉语义：存在选择器命中 .md-body h2 的规则体含 76px，h3 同 ——
       合并/拆条/换序都放行，唯独不能没有。 */
    function hasScrollMargin(tag) {
      return rules.some(function (r) {
        return new RegExp('(^|[\\s,])\\.md-body ' + tag + '(?![\\w-])').test(r[0]) &&
          /scroll-margin-top\s*:\s*76px/.test(r[1]);
      });
    }
    T('A2 锚点落点', 'R96 .md-body h2 与 h3 都有 scroll-margin-top: 76px（scrollIntoView 路径兜底）',
      hasScrollMargin('h2') && hasScrollMargin('h3'),
      'h2=' + hasScrollMargin('h2') + ' h3=' + hasScrollMargin('h3'));
  }

  /* ================= E4：toast 类型前缀符号 ================= */
  {
    const app = stripJsLineComments(stripComments(SRC.app));
    /* 行为测试做不了：toast 是 IIFE 私有函数，外部触发面依赖剪贴板/网络桩，
       桩复杂度超过被测逻辑本身。故钉拼接结构 + 反向验证。 */
    T('E4 toast 符号', 'R97 toast 文本 = (类型查表 || 默认▸) + msg（颜色不再是唯一信息通道）',
      /textContent\s*=\s*\([^()]*\[type\]\s*\|\|\s*'▸ '\s*\)\s*\+\s*msg/.test(app),
      '结构未命中');

    /* 三符号必须与类型一一对应 —— error 配成 ✓ 是事故级错位，必须钉死。 */
    T('E4 toast 符号', 'R97b error✕ / ok✓ / warn⚠ 一一对应（错位即红）',
      /error\s*:\s*'✕ '/.test(app) && /ok\s*:\s*'✓ '\s*[,}]/.test(app) && /warn\s*:\s*'⚠ '/.test(app),
      '符号映射未命中');
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "P0 v2.2.2" };

standalone(module, run);
