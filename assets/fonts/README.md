# assets/fonts — 自托管字体

## sarasa-mono-sc-subset.woff2

| 项 | 值 |
|---|---|
| 字体 | Sarasa Mono SC（等距更纱黑体 SC）Regular |
| 上游 | https://github.com/be5invis/Sarasa-Gothic ｜ 许可：SIL Open Font License 1.1 |
| 获取渠道 | npm 包 [`@fontpkg/sarasa-mono-sc@0.36.0`](https://www.npmjs.com/package/@fontpkg/sarasa-mono-sc) 的 `sarasa-mono-sc-regular.ttf`（经 unpkg 下载） |
| 子集化 | `pyftsubset --text-file=<charset> --flavor=woff2 --layout-features=kern --no-hinting --drop-tables+=DSIG` |
| 字符集 | 7619 字符 = GB2312 全集（6763 汉字 + 符号）+ 站内源码扫描全部非 ASCII 字符 + 站点装饰符号清单（◢◣▚ 等） |
| 体积 | 约 960 KB（原 TTF 25.9 MB） |

**用途**：补 `--mono` 字体栈的中文字形（此前中文会掉到通用 monospace = 新宋体）。
栈序把 Sarasa 放在**拉丁等宽字体之后**（Cascadia Code → JetBrains Mono → Consolas → Courier New → Sarasa Mono SC），
故英文字符仍走原字体，仅中文/装饰符号落到 Sarasa；配合 `unicode-range` 按需下载。

**更新方法**（升级字体或扩充字符集时）：
1. 重新生成字符集（扫描源码 + GB2312；脚本思路见项目笔记 2026-09-30）
2. `pyftsubset` 重新子集化并替换本文件
3. 体积若显著变化，同步 `css/style.css` 里 `@font-face` 注释中的记录
