# MANIFEST — neon-diary-migration-bundle（历史档案）

> ## ⚠ v5.6.3 说明：**这是 2026-09-30 的档案，不是当前清单**
> 本文件记录的是当年那份"完整迁移包"的逐文件清单与校验和，为的是留下"当时到底
> 交付了什么"的可查证据。此后项目一直在演进（后端迁 Supabase、电台换成网易云条目、
> 多轮死代码清理），下面列到的不少文件**已经不存在了** —— 例如：
>
> | 本文件里还有 | 现状 |
> |---|---|
> | `app/js/radio.js` | ❌ 已删除（v5.6.3，死内核） |
> | `app/tests/o9-preview.html` / `p2-snapshot.html` | ❌ 已删除（人工样张，无自动化引用） |
> | `config/` `deps/` | ❌ 已删除（纯说明文档，站点与脚本都不读） |
> | `db/seed/radio-index.json` / `radio-rows.json` | ❌ 已删除（历史记录，导入器早已不读） |
> | `db/seed/removed-posts-archive/` | ❌ 已删除（6.5MB 已删文章的图片备份） |
> | `_push/`（249 个一次性部署/调试脚本） | ❌ 已删除（审计脚本移到 `app/tools/audit-all.js`） |
> | `_ppt_assets/` + 根目录 PPT/PDF | ❌ 已删除（33MB + 7MB 一次性物料） |
>
> **当前的真实结构看 [README.md](./README.md)；当前的文件数与门禁数看
> [app/README.md](./app/README.md) 与 [app/HANDOVER.md](./app/HANDOVER.md)。**

> 本包为 NEON://DIARY 的完整迁移包。逐文件清单如下（不含本文件自身）。
> 主说明见 [README.md](./README.md)；迁移路线见 [docs/MIGRATION.md](./docs/MIGRATION.md)。

- 生成时间：2026-09-30（本清单随包生成，之后未再变动）
- 文件总数：**147**（不含 _test 临时目录）
- 总大小：**44.45 MB**

## 顶层结构

```
neon-diary-migration-bundle/
├── README.md            总入口（结构 / 复现步骤 / 依赖 / 包内变更）
├── MANIFEST.md          本文件（逐文件清单 + 校验和）
├── app/                 完整应用（源码 + 快照 + 测试 + 工具）
├── config/              云端配置档案与更换说明
├── deps/                依赖清单副本与安装说明
├── db/                  数据库重建资料（schema + seed + 工具）
└── docs/                迁移指南
```

## 文件清单

### 根目录 （1 个文件，7.3 KB）

- `README.md` — 7.3 KB

### app/ （122 个文件，31.68 MB）

- `app/.github/workflows/sync-snapshot.yml` — 2.8 KB
- `app/.gitignore` — 712 B
- `app/.nojekyll` — 0 B
- `app/3.0-改版方案.md` — 29.4 KB
- `app/4.0-改版方案.md` — 26.1 KB
- `app/安全审计报告.md` — 28.7 KB
- `app/版本更新排查指引.md` — 11.0 KB
- `app/版本更新说明-v2.0.0.md` — 21.4 KB
- `app/版本更新说明-v2.0.2.md` — 12.4 KB
- `app/版本更新说明-v2.0.3.md` — 10.8 KB
- `app/版本更新说明-v2.9.5.md` — 9.3 KB
- `app/测试拆解与覆盖分析-D3.md` — 23.9 KB
- `app/代码审计报告-20260929.md` — 13.9 KB
- `app/改进设计表.md` — 30.0 KB
- `app/体验优化方向-v2.7提案.md` — 8.1 KB
- `app/优化方案-v2.1规划.md` — 56.1 KB
- `app/assets/fonts/README.md` — 1.4 KB
- `app/assets/fonts/sarasa-mono-sc-subset.woff2` — 956.5 KB
- `app/assets/og-cover.jpg` — 121.4 KB
- `app/B5-终审报告.md` — 10.2 KB
- `app/css/style.css` — 208.4 KB
- `app/data/images/2.png` — 1.47 MB
- `app/data/posts.json` — 4.2 KB
- `app/data/radio/4.mp3` — 11.59 MB
- `app/data/radio/5.mp3` — 9.77 MB
- `app/data/radio/6.mp3` — 5.77 MB
- `app/docs/handover-notes/MEMORY.md` — 9.9 KB
- `app/docs/handover-notes/PROJECT-NOTES.md` — 28.8 KB
- `app/docs/handover-notes/README.md` — 825 B
- `app/docs/handover-notes/TESTING-NOTES.md` — 18.8 KB
- `app/feed.xml` — 1.7 KB
- `app/HANDOVER.md` — 16.7 KB
- `app/index.html` — 12.9 KB
- `app/js/app.js` — 163.5 KB
- `app/js/atmo.js` — 11.8 KB
- `app/js/boot.js` — 3.4 KB
- `app/js/cloud.js` — 55.5 KB
- `app/js/console.js` — 11.9 KB
- `app/js/keys.js` — 14.4 KB
- `app/js/radio.js` — 17.7 KB
- `app/js/scene.js` — 6.3 KB
- `app/js/tap.js` — 2.5 KB
- `app/js/theme-boot.js` — 7.2 KB
- `app/js/vendor/README.md` — 1.4 KB
- `app/js/vendor/workbuddy-cloud-sdk.js` — 60.6 KB
- `app/js/version.js` — 73.5 KB
- `app/js/views.js` — 81.3 KB
- `app/js/wordmark-paths.js` — 4.5 KB
- `app/package-lock.json` — 28.6 KB
- `app/package.json` — 1.5 KB
- `app/README.md` — 4.6 KB
- `app/tests/case-runner.js` — 6.9 KB
- `app/tests/cases/01-a-正常启动.js` — 2.8 KB
- `app/tests/cases/02-b-文章详情.js` — 1.7 KB
- `app/tests/cases/03-c-首页列表.js` — 3.0 KB
- `app/tests/cases/04-d-写入透传.js` — 1.8 KB
- `app/tests/cases/05-e-供应链.js` — 2.7 KB
- `app/tests/cases/06-f-编辑器.js` — 5.9 KB
- `app/tests/cases/07-g-版本一致.js` — 1.4 KB
- `app/tests/cases/08-h-长度约束.js` — 3.4 KB
- `app/tests/cases/09-i-og-卡片.js` — 2.2 KB
- `app/tests/cases/10-j-草稿快照.js` — 5.0 KB
- `app/tests/cases/11-k-bump-脚本.js` — 4.5 KB
- `app/tests/cases/12-l-图片收口.js` — 3.3 KB
- `app/tests/cases/13-m-csp.js` — 3.9 KB
- `app/tests/cases/14-n-第三批.js` — 14.2 KB
- `app/tests/cases/15-o-2-0-收尾.js` — 18.9 KB
- `app/tests/cases/16-o16-auto-收口.js` — 3.6 KB
- `app/tests/cases/17-o17-装饰层.js` — 19.1 KB
- `app/tests/cases/18-o7-复查修正.js` — 3.9 KB
- `app/tests/cases/19-o8-分隔线.js` — 2.7 KB
- `app/tests/cases/20-o9-色标.js` — 31.1 KB
- `app/tests/cases/21-o10-改号.js` — 4.8 KB
- `app/tests/cases/22-o11-暗色优先.js` — 9.7 KB
- `app/tests/cases/23-o12-减少动效.js` — 9.7 KB
- `app/tests/cases/24-o13-键盘可达.js` — 13.3 KB
- `app/tests/cases/25-o14-请求并行.js` — 6.9 KB
- `app/tests/cases/26-o15-阅读进度.js` — 10.1 KB
- `app/tests/cases/27-o18-防白屏.js` — 4.5 KB
- `app/tests/cases/28-o19-编辑器文本.js` — 6.0 KB
- `app/tests/cases/29-p1-v2-2-0.js` — 10.2 KB
- `app/tests/cases/30-p0-v2-2-2.js` — 7.5 KB
- `app/tests/cases/31-p1-v2-3-0.js` — 12.4 KB
- `app/tests/cases/32-c6-v2-4-0.js` — 9.2 KB
- `app/tests/cases/34-v2-7-体验批次.js` — 24.3 KB
- `app/tests/cases/35-v2-8-0-电台.js` — 44.2 KB
- `app/tests/cases/36-v2-9-4-uiverse.js` — 26.6 KB
- `app/tests/cases/37-v2-9-5-uiverse-b.js` — 11.4 KB
- `app/tests/cases/38-v2-9-8-uptime.js` — 16.3 KB
- `app/tests/cases/39-v3-0-0-b1-tokens.js` — 16.3 KB
- `app/tests/cases/40-v3-1-0-home-bento.js` — 16.7 KB
- `app/tests/cases/41-v3-2-0-b3-reading.js` — 14.9 KB
- `app/tests/cases/42-v3-3-0-b4-console.js` — 9.1 KB
- `app/tests/cases/43-v3-5-0-responsive-audit.js` — 8.4 KB
- `app/tests/cases/44-v3-7-0-widget-collapse.js` — 10.5 KB
- `app/tests/cases/45-v4-0-0-scene-atmo.js` — 14.2 KB
- `app/tests/cases/46-v4-1-0-scene-gate.js` — 10.7 KB
- `app/tests/cases/47-v4-2-0-reading-deck.js` — 11.1 KB
- `app/tests/cases/48-v4-3-0-console-devices.js` — 10.4 KB
- `app/tests/cases/49-v4-4-0-final-audit.js` — 10.8 KB
- `app/tests/cases/50-v4-5-0-hue-default.js` — 10.1 KB
- `app/tests/cases/51-v4-6-0-static-fallback.js` — 23.2 KB
- `app/tests/cases/manifest.json` — 5.6 KB
- `app/tests/common.js` — 23.4 KB
- `app/tests/fault-matrix.js` — 3.7 KB
- `app/tests/o11-preview.html` — 3.5 KB
- `app/tests/o9-preview.html` — 58.1 KB
- `app/tests/p2-snapshot.html` — 37.9 KB
- `app/tests/regress.js` — 4.4 KB
- `app/tests/run-all.js` — 1.9 KB
- `app/tests/sandbox-p2.js` — 6.2 KB
- `app/tools/archive/regress-monolith-2.1.2.js` — 160.1 KB
- `app/tools/baseline-cases.js` — 3.3 KB
- `app/tools/bump.js` — 19.0 KB
- `app/tools/check-snapshot.js` — 3.9 KB
- `app/tools/check-version.js` — 2.3 KB
- `app/tools/export-static.js` — 14.0 KB
- `app/tools/gen-feed.js` — 4.5 KB
- `app/tools/perf-probe-norain.js` — 1.9 KB
- `app/tools/perf-probe-v441.js` — 2.3 KB
- `app/tools/split-regress.js` — 9.5 KB
- `app/UI优化建议.md` — 28.3 KB

### config/ （1 个文件，2.2 KB）

- `config/README.md` — 2.2 KB

### db/ （19 个文件，12.72 MB）

- `db/README.md` — 4.9 KB
- `db/schema.sql` — 10.6 KB
- `db/seed/EXPORT-REPORT.md` — 906 B
- `db/seed/images-index.json` — 1.5 KB
- `db/seed/images-rows.json` — 1.2 KB
- `db/seed/images/2.png` — 1.47 MB
- `db/seed/images/6.png` — 923.6 KB
- `db/seed/images/7.png` — 1.47 MB
- `db/seed/images/8.png` — 2.36 MB
- `db/seed/images/8.thumb.png` — 172.2 KB
- `db/seed/posts.json` — 3.1 KB
- `db/seed/radio-index.json` — 1.5 KB
- `db/seed/radio-rows.json` — 1.3 KB
- `db/seed/removed-posts-archive/img6.json` — 1.20 MB
- `db/seed/removed-posts-archive/img7.json` — 1.96 MB
- `db/seed/removed-posts-archive/img8.json` — 3.14 MB
- `db/seed/removed-posts-archive/posts-8-9.json` — 788 B
- `db/seed/removed-posts-archive/README.md` — 1.3 KB
- `db/tools/export-cloud-full.js` — 14.6 KB

### deps/ （3 个文件，32.1 KB）

- `deps/package-lock.json` — 28.6 KB
- `deps/package.json` — 1.5 KB
- `deps/README.md` — 2.0 KB

### docs/ （1 个文件，6.5 KB）

- `docs/MIGRATION.md` — 6.5 KB

## 关键文件校验和（sha256，完整）

| 文件 | 大小 | sha256 |
|---|---|---|
| `app/data/images/2.png` | 1.47 MB | `5715a06986fe696195195ea10dd98392805d5d96478ee08170e041629ddc6ddb` |
| `app/data/posts.json` | 4.2 KB | `9c12b56af576e7034cffa8f38950f01a6439297addd8498d465013830e361b68` |
| `app/data/radio/4.mp3` | 11.59 MB | `4595ce5dc407ecfa14226360fc58fcf2a26c0a0f64fe74d7beb85568dfad9a58` |
| `app/data/radio/5.mp3` | 9.77 MB | `1fb7c528e82ae71a4b20b988a41bc2891a1413c21afc53b33d3f48991e5801e6` |
| `app/data/radio/6.mp3` | 5.77 MB | `1ef3280ffb7f2e2b24adfc1409c3bda58753b44cf0e3da1e5872b5d1117d73a6` |
| `app/tools/check-snapshot.js` | 3.9 KB | `0e3246a0df6d49bcb40cf71526d1ab9d1bf665c43e04bad185d4f8c86ab49494` |
| `app/tools/export-static.js` | 14.0 KB | `2a3fef917d6248be44a7d8d4f2abb1abf46143793ca11c2503d0a71de586ba79` |
| `db/schema.sql` | 10.6 KB | `2b0add3f9957c28f292b849516cfbb2440a69e1e795dd8bf4a3e978654c045c4` |
| `db/seed/EXPORT-REPORT.md` | 906 B | `ddc83ac700863b04d80af874cd497387db97db4a50080f8bb78a460f5ff7600b` |
| `db/seed/images-index.json` | 1.5 KB | `d09a865b9a94f5b0388927e3d3f8a8fe30d2defe3b5a076f04f6ed7314c474a7` |
| `db/seed/images-rows.json` | 1.2 KB | `5296bcee3e707573b1bf33a2471877fe3d4a6c7487106e85fa7349b3a1f5cb65` |
| `db/seed/images/2.png` | 1.47 MB | `5715a06986fe696195195ea10dd98392805d5d96478ee08170e041629ddc6ddb` |
| `db/seed/images/6.png` | 923.6 KB | `8f5059f33562bbb65f278d7bf83a88aff38dd7d0ada2f1b1d27fa2ca625f875d` |
| `db/seed/images/7.png` | 1.47 MB | `55415965d5ba21c5ca19623916bfca8d38a18572642ec7cc76cc3c1854d300b6` |
| `db/seed/images/8.png` | 2.36 MB | `83819eee4b188eae5ad43b2901c82de77542f8f238543c8a6c9daba536626db0` |
| `db/seed/images/8.thumb.png` | 172.2 KB | `e4ef073356e26689b7468d8a8b655b61fad5dc0f14023a269d472e25edfb3503` |
| `db/seed/posts.json` | 3.1 KB | `fbd6ccda67d7ef8b8634049b550b4adaad92c3ae53a6ce73be694d92cd0d3b27` |
| `db/seed/radio-index.json` | 1.5 KB | `b940a153bff5b8e858c3f84ce637225d1f1e7b56e2bbd296d4123d859bde2cf9` |
| `db/seed/radio-rows.json` | 1.3 KB | `f3c0d37b2b422cd4a475b1a4da0f12d58fcc485bb3c712b8b7b25e6babefc11a` |
| `db/seed/removed-posts-archive/img6.json` | 1.20 MB | `736335a32785e08b34567955f3c19c42588d41d86b410866d682585d11e5a16a` |
| `db/seed/removed-posts-archive/img7.json` | 1.96 MB | `b54135e84f0ead67dbb47dbf166725daf056bedacf3b66e452974480482383e5` |
| `db/seed/removed-posts-archive/img8.json` | 3.14 MB | `403cc23073dbec7e2f585cae74e8948236cca8312baef59e6b8fbc4f23ce8c1f` |
| `db/seed/removed-posts-archive/posts-8-9.json` | 788 B | `d0920bb8e41c13bac9194f22ba7a5a01266ed1afa8b2927dd7fba9d25f948ea9` |
| `db/seed/removed-posts-archive/README.md` | 1.3 KB | `f8569c77207dd282420d928bacb13afbcb21329be12f8a1354d4935199bcefeb` |
| `db/tools/export-cloud-full.js` | 14.6 KB | `086e45078832bf78745ac23702664e6e5ed1056fa984d9125ca06bb2966d1f96` |

> 校验方法（任选）：`sha256sum <文件>`（Git Bash）或 `certutil -hashfile <文件> SHA256`（Windows）。
> 数据层快照（`app/data/`）与种子数据（`db/seed/`）之间的同源性验证：
> 跑 `cd app && node tools/check-snapshot.js`（快照自洽检查）。
