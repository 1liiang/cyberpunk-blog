'use strict';
/* ============================================================
   tests/cases/06-f-编辑器.js — F 编辑器
   由 tools/split-regress.js 从 tests/regress.js 机械拆分而来（D3 拆分）。
   原行号：L163-166
   独立运行：node tests/cases/06-f-编辑器.js
   ============================================================ */
const { makeSuite, standalone } = require('../case-runner');
const { SRC, stripComments, stripJsLineComments } = require('../common');

async function run() {
  const S = makeSuite();
  const T = S.T;
  const results = S.results;
  const BUILD = S.BUILD;

  /* ================= 场景 F：编辑器缩略图生成（源码断言） ================= */
  {
    /* v2.2.1：原来钉的是 `need('compressImage')(f, 256, 0.6)` 这串字面量 ——
       钉字面量的下场就是"改实现即红、但红完还得手改测试"，而且它真正想守的
       「缩略图够不够封面用」根本没守住（256 糊了照样绿）。
       改为钉【语义】：尺寸取自 cloud.js 的单一来源常量，且必须喂得饱展示盒。 */
    const c = stripComments(SRC.cloud);
    const a = stripJsLineComments(stripComments(SRC.app));

    function cnst(name) {
      const m = new RegExp(name + '\\s*=\\s*(\\d+(?:\\.\\d+)?)').exec(c);
      return m ? Number(m[1]) : null;
    }
    const THUMB = cnst('THUMB_MAX_DIM');
    const FULL = cnst('IMAGE_MAX_DIM');

    /* 列表页封面展示盒实测宽 1046px（推导见 cloud.js 尺寸标准注释） */
    const COVER_DISPLAY_W = 1046;

    T('F 编辑器', 'R24 缩略图尺寸取自 cloud.js 单一来源常量',
      THUMB !== null && FULL !== null, 'THUMB=' + THUMB + ' FULL=' + FULL);
    T('F 编辑器', 'R24b 缩略图宽 ≥ 封面展示宽（1x 不放大，杜绝像素感）',
      THUMB !== null && THUMB >= COVER_DISPLAY_W,
      THUMB + ' ≥ ' + COVER_DISPLAY_W + ' ?');
    T('F 编辑器', 'R24c 完整图宽 ≥ 封面展示宽的 2 倍（2x 高清屏）',
      FULL !== null && FULL >= COVER_DISPLAY_W * 2,
      FULL + ' ≥ ' + (COVER_DISPLAY_W * 2) + ' ?');
    T('F 编辑器', 'R24d 上传流程不再写死尺寸，改引用常量',
      /compressImage'\)\(\s*f,\s*need\('THUMB_MAX_DIM'\)/.test(a) &&
      /compressImage'\)\(\s*f,\s*need\('IMAGE_MAX_DIM'\)/.test(a));
    T('F 编辑器', 'R24e 尺寸常量已对外暴露（测试与实现共用一个来源）',
      /THUMB_MAX_DIM:\s*THUMB_MAX_DIM/.test(c) && /IMAGE_MAX_DIM:\s*IMAGE_MAX_DIM/.test(c));

    /* ---- 体积兜底阶梯（encodeWithinBytes）行为验证 ----
       抠出函数本体、注入假 drawAndEncode，测的是「阶梯怎么走」而不是编码本身。
       ⚠ 提取边界：从 encodeWithinBytes 到 compressImage 之间，别多带也别少带。 */
    const seg = (function () {
      const from = SRC.cloud.indexOf('function encodeWithinBytes');
      const to = SRC.cloud.indexOf('function compressImage');
      return from !== -1 && to > from ? SRC.cloud.slice(from, to) : '';
    })();
    T('F 编辑器', 'R24f 能从 cloud.js 抠出体积兜底阶梯', seg.indexOf('function encodeWithinBytes') === 0,
      seg ? seg.length + 'B' : '未定位');

    if (seg) {
      /* 假编码器：每次调用返回指定大小的 base64，并记录调用参数 */
      function mkLadder(results) {
        const calls = [];
        const fake = function (img, cw, ch, type, q, keepAlpha, s) {
          calls.push({ type: type, q: q, s: s, keepAlpha: keepAlpha });
          const r = results.shift();
          return { base64: 'x'.repeat(r.size), content_type: type, width: cw, height: ch, size_bytes: r.size };
        };
        const factory = new Function('drawAndEncode', seg + '\nreturn encodeWithinBytes;');
        return { run: factory(fake), calls: calls };
      }
      const OVER = 99999999, OK = 100;

      /* ① 首次就达标：只编码一次，格式不换 */
      let L = mkLadder([{ size: OK }]);
      let out = L.run(null, 1000, 500, 'image/jpeg', 0.85, false, 3400000);
      T('F 编辑器', 'R24g 一次达标时不再继续降级', L.calls.length === 1 && out.base64.length === OK,
        '编码 ' + L.calls.length + ' 次');

      /* ② JPEG 超限：下一档是降质量（同尺寸同格式），不是先缩尺寸 */
      L = mkLadder([{ size: OVER }, { size: OK }]);
      out = L.run(null, 1000, 500, 'image/jpeg', 0.85, false, 3400000);
      T('F 编辑器', 'R24h JPEG 超限先降质量再考虑缩尺寸',
        L.calls.length === 2 && L.calls[1].q === 0.72 && L.calls[1].s === 1,
        JSON.stringify(L.calls[1] || {}));

      /* ③ PNG 不吃 quality：阶梯里不该出现"同格式降质量"的空转 */
      L = mkLadder([{ size: OVER }, { size: OK }]);
      out = L.run(null, 1000, 500, 'image/png', 0.85, true, 3400000);
      T('F 编辑器', 'R24i PNG 超限直接缩尺寸（不做无效的降质量）',
        L.calls[1].s < 1, JSON.stringify(L.calls[1] || {}));

      /* ④ 全部超限：返回最后一档（JPEG），绝不把超限数据交给 INSERT */
      L = mkLadder([{ size: OVER }, { size: OVER }, { size: OVER }, { size: OVER }, { size: OVER },
                    { size: OVER }, { size: OVER }, { size: OVER }, { size: OVER }, { size: OVER }]);
      out = L.run(null, 1000, 500, 'image/png', 0.85, true, 100);
      T('F 编辑器', 'R24j 全阶梯超限时兜底转 JPEG',
        out && out.content_type === 'image/jpeg', out ? out.content_type : 'null');

      /* ⑤ 上传两处都传了字节上限（没上限的阶梯等于白写） */
      T('F 编辑器', 'R24k 上传流程传入 DATA/THUMB 字节上限',
        /need\('DATA_MAX_BYTES'\)/.test(a) && /need\('THUMB_MAX_BYTES'\)/.test(a));
    }
  }

  return { pass: results.filter(function (r) { return r.pass; }).length,
          fail: results.filter(function (r) { return !r.pass; }).length,
          results: results };
}

module.exports = { run: run, name: "F 编辑器" };

standalone(module, run);
