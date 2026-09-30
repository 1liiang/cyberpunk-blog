#!/usr/bin/env node
'use strict';
/* ============================================================
   tools/gen-feed.js — 生成 RSS 2.0 feed.xml（E2 构建步骤，解锁 C4）

   为什么必须由构建步骤产出：
     纯前端 SPA 生成的 XML 爬虫抓不到（不执行 JS），与 OG 卡片同一堵墙。
     所以在发布前用 Node 直连云库拉已发布文章，落成静态 feed.xml，
     让 RSS 阅读器能真正 GET 到内容。

   用法：npm run feed
   输出：<项目根>/feed.xml
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* 站点对外地址：RSS 里的链接必须是**能打开的绝对地址**。
   v4.8.0 起线上主地址是 GitHub Pages（旧的 WorkBuddy 主站随云服务停用而失效）。
   换自定义域名时：改这里的默认值，或临时用环境变量覆盖（不改代码）。 */
const SITE_URL = (process.env.NEON_SITE_URL || 'https://1liiang.github.io/').replace(/\/?$/, '/');
const BASE_URL = SITE_URL + 'cyberpunk-blog/';
const FEED_URL = BASE_URL + 'feed.xml';
const SITE_TITLE = 'NEON://DIARY';
const SITE_DESC = '一座霓虹废墟里的日记本 —— 代码、小说，以及深夜的一切胡思乱想。';
const AUTHOR = '漓江';
const LANG = 'zh-CN';

/* ⚠ 云配置从 js/cloud.js 读（**单一来源**）。
   这里原先硬编码了旧平台的 endpoint 与公钥，注释却写着"与 cloud.js 同源" ——
   迁移到 Supabase 后它会直接拉不到数据（端点换了、键也换了）。
   与 tools/export-static.js 用同一套解析方式。 */
function readCloudConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'cloud.js'), 'utf8');
  const ep = /endpoint:\s*'([^']+)'/.exec(src);
  const key = /publishableKey:\s*'([^']+)'/.exec(src);
  if (!ep || !key) throw new Error('无法从 js/cloud.js 解析 endpoint / publishableKey');
  return { endpoint: ep[1].replace(/\/$/, ''), key: key[1] };
}
const CLOUD = readCloudConfig();
const ENDPOINT = CLOUD.endpoint;
const PUBLISHABLE_KEY = CLOUD.key;
const FIELDS = 'id,title,summary,tags,created_at,updated_at,owner_name';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* XML 1.0 不允许大部分控制字符，净化后再入 feed，否则整个文件不可解析 */
function stripInvalidXml(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function toRFC822(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

async function fetchPublished() {
  /* Supabase PostgREST（查询串语法与旧平台同源，换的只是前缀与鉴权头） */
  const url = ENDPOINT + '/rest/v1/posts' +
    '?select=' + encodeURIComponent(FIELDS) +
    '&status=eq.published' +
    '&order=created_at.desc' +
    '&limit=50';
  const res = await fetch(url, {
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + PUBLISHABLE_KEY,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    throw new Error('拉取文章失败：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function itemXml(p) {
  const link = BASE_URL + '#/post/' + p.id;
  return [
    '    <item>',
    '      <title>' + esc(stripInvalidXml(p.title || '(无标题)')) + '</title>',
    '      <link>' + esc(link) + '</link>',
    '      <guid isPermaLink="false">' + esc('neon-post-' + p.id) + '</guid>',
    '      <pubDate>' + toRFC822(p.created_at) + '</pubDate>',
    '      <description>' + esc(stripInvalidXml(p.summary || '')) + '</description>',
    (Array.isArray(p.tags) ? p.tags.filter(Boolean)
      .map(t => '      <category>' + esc(t) + '</category>').join('\n') : ''),
    '    </item>'
  ].filter(Boolean).join('\n');
}

async function main() {
  let posts = [];
  try {
    posts = await fetchPublished();
  } catch (e) {
    console.error('✗ ' + e.message);
    console.error('  提示：若网络不可达，可稍后重试 npm run feed；feed.xml 未改动。');
    process.exit(1);
  }

  const lastBuild = toRFC822(posts.length ? (posts[0].updated_at || posts[0].created_at) : new Date().toISOString());
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>' + esc(SITE_TITLE) + '</title>',
    '    <link>' + esc(BASE_URL) + '</link>',
    '    <atom:link href="' + esc(FEED_URL) + '" rel="self" type="application/rss+xml" />',
    '    <description>' + esc(SITE_DESC) + '</description>',
    '    <language>' + LANG + '</language>',
    '    <managingEditor>' + esc(AUTHOR) + '</managingEditor>',
    '    <lastBuildDate>' + lastBuild + '</lastBuildDate>',
    '    <generator>NEON://DIARY gen-feed.js</generator>'
  ];
  posts.forEach(p => xml.push(itemXml(p)));
  xml.push('  </channel>', '</rss>', '');

  const dest = path.join(ROOT, 'feed.xml');
  fs.writeFileSync(dest, xml.join('\n'), 'utf8');
  console.log('✓ feed.xml 已生成：' + posts.length + ' 条已发布文章 → ' + dest);
}

main().catch(e => { console.error('✗ 生成失败：' + e.message); process.exit(1); });
