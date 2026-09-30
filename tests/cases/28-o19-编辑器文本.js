'use strict';
/* ============================================================
   tests/cases/28-o19-编辑器文本.js — O19 编辑器文本
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L2589-2687
   独立运行：node tests/cases/28-o19-编辑器文本.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  {
    const seg = (function () {
      const from = SRC.app.indexOf('function insertAtCursor(');
      const to = SRC.app.indexOf('/* 工具栏 */');
      return from !== -1 && to > from ? SRC.app.slice(from, to) : '';
    })();
    T('O19 编辑器文本', 'R90 能从 app.js 抠出三个文本操作函数',
      /function insertAtCursor\s*\(/.test(seg) &&
      /function wrapSelection\s*\(/.test(seg) &&
      /function linePrefix\s*\(/.test(seg),
      seg ? seg.length + 'B' : '未定位');

    /* 假 textarea：只需具备被这三个函数碰到的字段 */
    function mk(v, s, e) {
      s = s || 0;
      e = (e === undefined) ? s : e;
      const ta = {
        value: v, selectionStart: s, selectionEnd: e, focused: false,
        focus: function () { this.focused = true; }
      };
      let refreshes = 0;
      const factory = new Function('ta', 'debounceTimer', 'refreshPreview',
        seg + '\nreturn { insertAtCursor: insertAtCursor, wrapSelection: wrapSelection, linePrefix: linePrefix };');
      const m = factory(ta, null, function () { refreshes++; });
      return { ta: ta, m: m, count: function () { return refreshes; } };
    }

    if (seg) {
      /* --- insertAtCursor --- */
      let t = mk('abc', 1); t.m.insertAtCursor('X');
      T('O19 编辑器文本', 'R90b 光标处插入且光标后移一个插入串长度',
        t.ta.value === 'aXbc' && t.ta.selectionStart === 2 && t.ta.selectionEnd === 2,
        t.ta.value + ' @' + t.ta.selectionStart);

      t = mk('abc', 1, 2); t.m.insertAtCursor('X');
      T('O19 编辑器文本', 'R90c 有选区时替换选区内容',
        t.ta.value === 'aXc' && t.ta.selectionStart === 2, t.ta.value);

      t = mk('abc', 0); t.m.insertAtCursor('X');
      T('O19 编辑器文本', 'R90d 插入位置为 0（头部边界不越界）',
        t.ta.value === 'Xabc' && t.ta.selectionStart === 1, t.ta.value);

      /* --- wrapSelection（Ctrl+B / 工具栏加粗斜体的底层） --- */
      t = mk('hello', 0, 5); t.m.wrapSelection('**', '**');
      T('O19 编辑器文本', 'R90e 包裹选中文本（首尾各加标记）',
        t.ta.value === '**hello**' &&
        t.ta.selectionStart === 2 && t.ta.selectionEnd === 7,
        t.ta.value + ' 选区 ' + t.ta.selectionStart + '..' + t.ta.selectionEnd);

      t = mk('ab', 1); t.m.wrapSelection('*', '*');
      T('O19 编辑器文本', 'R90f 空选区时插入成对符号，光标落在两者之间',
        t.ta.value === 'a**b' && t.ta.selectionStart === 2 && t.ta.selectionEnd === 2,
        t.ta.value + ' @' + t.ta.selectionStart);

      t = mk('', 0); t.m.wrapSelection('**', '**');
      T('O19 编辑器文本', 'R90g 空文档包裹不越界（0 长度输入）',
        t.ta.value === '****' && t.ta.selectionStart === 2, t.ta.value);

      /* --- linePrefix（标题 / 引用 / 列表的行首前缀） --- */
      t = mk('hello', 0); t.m.linePrefix('## ');
      T('O19 编辑器文本', 'R90h 单行时前缀加在行首',
        t.ta.value === '## hello' && t.ta.selectionStart === 3, t.ta.value);

      t = mk('a\nb', 2); t.m.linePrefix('## ');
      T('O19 编辑器文本', 'R90i 第二行加前缀时不污染第一行',
        t.ta.value === 'a\n## b' && t.ta.selectionStart === 5,
        JSON.stringify(t.ta.value));

      t = mk('abc', 0); t.m.linePrefix('> ');
      T('O19 编辑器文本', 'R90j 光标在 0 时 lastIndexOf("\\n",-1) 边界不越界',
        t.ta.value === '> abc' && t.ta.selectionStart === 2, t.ta.value);

      t = mk('abc', 2); t.m.linePrefix('## ');
      T('O19 编辑器文本', 'R90k 光标在行中时前缀仍落在行首（不插在光标处）',
        t.ta.value === '## abc' && t.ta.selectionStart === 5, t.ta.value);

      /* ⚠ 这条是反向验证逼出来的（第一版断言在此处假绿）：
         R90h/j/k 的输入都**没让光标落在换行符索引上**，
         于是把 lastIndexOf('\n', start-1) 改成 start 也照样全绿 ——
         断言看似守住了边界，实际什么都没守住。
         唯一能区分两种实现的输入是 start === '\n' 的下标（此处为 1）：
           正确 → 找 start-1 之前 → -1 → 归 0（前缀加在**第一行**行首）
           错误 → 找 start 处 → 命中 '\n' → 归 2（前缀错加到第二行）
         故补这条"光标骑在换行符上"的用例，它是该 off-by-one 的唯一探针。 */
      t = mk('a\nb', 1); t.m.linePrefix('## ');
      T('O19 编辑器文本', 'R90n 光标恰在换行符上时前缀加在【当前行】行首（而非下一行）',
        t.ta.value === '## a\nb' && t.ta.selectionStart === 4,
        JSON.stringify(t.ta.value) + ' @' + t.ta.selectionStart);

      /* 三个操作都必须连带刷新预览 —— 否则用户看不到 Markdown 效果 */
      t = mk('abc', 1);
      t.m.insertAtCursor('X');
      await new Promise(function (r) { setTimeout(r, 260); });
      T('O19 编辑器文本', 'R90l 文本操作后触发预览刷新（防抖 200ms）',
        t.count() >= 1, '刷新 ' + t.count() + ' 次');
      T('O19 编辑器文本', 'R90m 操作后焦点回到 textarea（用户可继续输入）',
        t.ta.focused === true);
    }
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "O19 编辑器文本" };

standalone(module, run);
