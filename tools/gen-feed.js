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
/* 注意：根路径 / 只是跳转页，真实内容在 /cyberpunk-blog/ 下。
   所有对外 URL 必须带这层前缀，否则阅读器 GET 到的是空壳。 */
const SITE_URL = 'https://cyberpunk-blog.app.workbuddy.host/';
const BASE_URL = SITE_URL + 'cyberpunk-blog/';
const FEED_URL = BASE_URL + 'feed.xml';
const SITE_TITLE = 'NEON://DIARY';
const SITE_DESC = '一座霓虹废墟里的日记本 —— 代码、小说，以及深夜的一切胡思乱想。';
const AUTHOR = '漓江';
const LANG = 'zh-CN';

/* 云配置与 cloud.js 同源；密钥本身无权限，真正边界是 RLS（只放行 status=published） */
const ENDPOINT = SITE_URL.replace(/\/$/, '');
const PUBLISHABLE_KEY = 'wbpk_pQJvN8eWX3KFQyE3DVhDDj_FLZMpPbJoseRqprhQCUXxFwVmrCGr8Ce';
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
  const url = ENDPOINT + '/.cloud/database/rest/posts' +
    '?select=' + encodeURIComponent(FIELDS) +
    '&status=eq.published' +
    '&order=created_at.desc' +
    '&limit=50';
  const res = await fetch(url, {
    headers: { 'x-wb-webapp-access-key': PUBLISHABLE_KEY, 'Accept': 'application/json' }
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
