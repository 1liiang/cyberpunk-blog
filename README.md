# NEON://DIARY — 项目根

一座霓虹废墟里的日记本（赛博朋克风格**单页博客**）。纯静态、零构建、零外部脚本。

> ⚠ **v5.6.3 重写**：本文件原先是 2026-09-30 那份"完整迁移包"的说明（版本停在 v4.7.0、
> 目录树里还写着 `config/` `deps/`、验收清单还要求"电台 3 首可播"）。那些描述早已过期 ——
> 迁移包专属目录与一次性素材已清理，站点本身也换过后端、换过电台形态。
> 现在这份只讲**当前真实的样子**。

## 目录

```
个人网站/
├── app/          ★ 站点本体（拿走即可独立运行）
│   ├── index.html      唯一入口（含 CSP）
│   ├── js/ css/ assets/
│   ├── data/           静态快照（GitHub Pages 的内容来源，勿手改）
│   ├── tests/ tools/   门禁（343 条；18 个核心 case）+ 构建/导出/审计脚本
│   └── README.md       ★ 站点自己的说明（先读这个）
├── db/           数据库重建资料（schema.sql + 种子 + 导出/导入/校验工具）
├── docs/         迁移与部署指南（docs/MIGRATION.md 等）
├── HANDOVER → app/HANDOVER.md   ★★ 接手必读（纪律、坑、未完成项）
├── README.md     你在这里
└── MANIFEST.md   2026-09-30 的迁移包清单（历史档案，见其顶部说明）
```

## 五分钟上手

```bash
cd app
npm ci                 # 只装 jsdom（唯一 devDependency）
npm run gate           # ★ 全量门禁，必须 343/343 全绿
python -m http.server 8898 --bind 127.0.0.1   # 本地预览 → http://127.0.0.1:8898/
```

改完东西的三步：`npm run gate` 全绿 → `node tools/bump.js <新版本> --title=… --item=…`
（`?v=` 是唯一的缓存击穿手段，忘了 bump 用户会拿到旧文件）→ 发布并线上验证。

## 现在是什么样

- **后端**：Supabase（配置在 `app/js/cloud.js` 顶部 `PUBLIC_CONFIG`）；
  云端不可达时**自动回退**读 `app/data/` 快照（GitHub Pages 就靠它）
- **内容**：文章 + 图片 + 收藏（账号功能）+ **电台**（网易云官方 outchain iframe：
  站点只存"哪一首/哪个歌单"，音频与版权都在网易云侧）
- **线上**：<https://1liiang.github.io/cyberpunk-blog/>
- **断点/无障碍/减少动效**：全站三档响应式 + `prefers-reduced-motion` 全量守卫

细节、纪律与踩过的坑都在 **`app/HANDOVER.md`**（那是唯一权威的交接文档，本文件不重复）。

## 数据版权

文章内容版权归作者所有；代码供参考。
