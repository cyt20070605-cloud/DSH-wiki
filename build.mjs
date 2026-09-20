#!/usr/bin/env node
/**
 * 世界观 Wiki 静态站构建脚本（零依赖）
 *
 * 用法：
 *   node build.mjs            构建到 site/
 *   node build.mjs --serve    构建后用内置 http 服务打开（默认 8899）
 *   node build.mjs --serve 9000
 *
 * 输入：content/**.md（带 YAML front matter）
 * 输出：site/**.html + site/style.css + site/app.js + site/search-index.json
 *
 * 说明：内容源严格保留原始设定措辞，本脚本只做结构化渲染与交叉链接。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(ROOT, 'content');
const OUT_DIR = path.join(ROOT, 'site');

const SITE_TITLE = '世界观 Wiki';
const SITE_SUB = '群星 · 现世 · 边境 · 旧域';

/* ------------------------------------------------------------------ utils */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const escapeAttr = (s) => escapeHtml(s);

/** 条目锚点：保留 CJK，去掉标点 */
const slugify = (s) =>
  String(s)
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/[（）()「」【】《》〈〉、，。：；！？·"'“”‘’\s]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'section';

const stripMd = (s) =>
  String(s)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`_]{1,3}/g, '')
    .trim();

/** 提取条目代码名（原文里用【】包裹的名词，用于正文高亮与互链） */
const CODE_RE = /【([^】]{1,24})】/g;
const TERM_RE = /“([^”]{1,24})”/g;

/* ------------------------------------------------------------ front matter */

function parseFrontMatter(raw) {
  const meta = {};
  let body = raw;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (/^\[.*\]$/.test(val)) {
        val = val
          .slice(1, -1)
          .split(',')
          .map((x) => x.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
      meta[key] = val;
    }
    body = raw.slice(m[0].length);
  }
  return { meta, body };
}

/* ------------------------------------------------------------- md → html */

function renderInline(text, ctx) {
  const codes = [];
  let s = String(text);

  // 行内代码先抽出，避免内部被其它规则误伤
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  s = escapeHtml(s);

  // 粗体 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(（])\*([^*\n]+)\*(?=[\s)）.,，。]|$)/g, '$1<em>$2</em>');

  // 链接：[文本](目标.md#锚点)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, target) => {
    let href = target;
    let cls = '';
    if (/^([a-z]+:|#|\/)/i.test(target)) {
      // 外链 / 纯锚点
      if (/^https?:/i.test(target)) cls = ' class="ext" target="_blank" rel="noreferrer"';
    } else {
      const [file, hash] = target.split('#');
      href = file.replace(/\.md$/i, '.html') + (hash ? `#${hash}` : '');
    }
    return `<a href="${escapeAttr(href)}"${cls}>${label}</a>`;
  });

  // 术语自动互链：仅在未配置 autolink: false 的页面生效。
  // 两点约束：
  //   1) 每个术语全页只链接「首次出现」；
  //   2) 只在「不在任何 <a> 内部」的文本段里插入，避免生成嵌套链接
  //      （正文里手写的链接一律原样保留）。
  if (ctx.autolink !== false && ctx.linkMap && ctx.linked) {
    const segments = s.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/g);
    for (const [term, file] of ctx.linkMap) {
      if (term.length < 2) continue;
      if (ctx.selfFile && ctx.selfFile === file) continue;
      if (ctx.linked.has(term)) continue;
      // 术语在 HTML 转义后的形态（如引号会被转成实体）
      const needle = escapeHtml(term);
      const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu');
      for (let k = 0; k < segments.length; k++) {
        if (k % 2 === 1) continue; // 奇数位是已有的 <a>…</a>
        const m = re.exec(segments[k]);
        if (!m) continue;
        const target = `<a class="term" href="${escapeAttr(file)}">${needle}</a>`;
        segments[k] = segments[k].slice(0, m.index) + target + segments[k].slice(m.index + needle.length);
        ctx.linked.add(term);
        break;
      }
    }
    s = segments.join('');
  }

  // 条目代码名 【xxx】
  s = s.replace(/【([^】]+)】/g, '<code class="code">【$1】</code>');
  // 引号名词
  s = s.replace(/“([^”]+)”/g, '<em class="quoted">“$1”</em>');

  // 还原行内代码
  s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);

  return s;
}

function renderMarkdown(md, file, autolink = true) {
  const linkMap = globalThis.__LINK_MAP__;
  const selfFile = file;
  // 「每个术语只链接首次出现」的去重集合，随整篇文档传递（含递归的引用块）
  const linked = globalThis.__LINKED__ || new Set();
  globalThis.__LINKED__ = linked;
  const ctx = { linkMap, selfFile, autolink, linked };
  const usedIds = new Map();
  const headings = [];
  const plainLines = [];

  const splitRow = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  const uniq = (base) => {
    const n = (usedIds.get(base) ?? 0) + 1;
    usedIds.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行
    if (!trimmed) {
      i++;
      continue;
    }

    // 围栏代码块（``` 或 ~~~）
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const lang = fence[2] || '';
      const buf = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}`).test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束围栏
      const code = escapeHtml(buf.join('\n'));
      out.push(`<pre class="code${lang ? ` lang-${escapeAttr(lang)}` : ''}"><code>${code}</code></pre>`);
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 标题
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = uniq(slugify(text));
      if (level === 2) headings.push({ id, text: stripMd(text) });
      plainLines.push(stripMd(text));
      out.push(`<h${level} id="${escapeAttr(id)}">${renderInline(text, ctx)}<a class="anchor" href="#${escapeAttr(id)}" aria-label="锚点">#</a></h${level}>`);
      i++;
      continue;
    }

    // 引用块
    if (/^>\s?/.test(trimmed)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      plainLines.push(...buf.map(stripMd));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), file, autolink).html}</blockquote>`);
      continue;
    }

    // 表格
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1].trim()) && lines[i + 1].includes('-')) {
      const head = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = head.map((c) => `<th>${renderInline(c, ctx)}</th>`).join('');
      const tbody = rows
        .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, ctx)}</td>`).join('')}</tr>`)
        .join('');
      plainLines.push(...rows.flat().map(stripMd));
      out.push(`<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`);
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const indent = (lines[i].match(/^\s*/) || [''])[0].length;
        const content = lines[i].trim().replace(/^[-*+]\s+/, '');
        items.push({ indent, content });
        i++;
      }
      // 简化处理：按缩进分一层嵌套
      let html = '<ul>';
      let depth = items[0]?.indent ?? 0;
      for (const it of items) {
        if (it.indent > depth) {
          html += '<ul>';
          depth = it.indent;
        } else if (it.indent < depth) {
          html += '</ul>';
          depth = it.indent;
        }
        plainLines.push(stripMd(it.content));
        html += `<li>${renderInline(it.content, ctx)}</li>`;
      }
      while (depth > (items[0]?.indent ?? 0)) {
        html += '</ul>';
        depth -= 2;
      }
      html += '</ul>';
      out.push(html);
      continue;
    }

    // 有序列表
    if (/^\d+[.、]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.、]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+[.、]\s+/, ''));
        i++;
      }
      plainLines.push(...items.map(stripMd));
      out.push(`<ol>${items.map((t) => `<li>${renderInline(t, ctx)}</li>`).join('')}</ol>`);
      continue;
    }

    // 段落
    const buf = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|>\s?|[-*+]\s|\d+[.、]\s|\|)/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    const text = buf.join(' ');
    plainLines.push(stripMd(text));
    out.push(`<p>${renderInline(text, ctx)}</p>`);
  }

  return { html: out.join('\n'), headings, plain: plainLines.join('\n') };
}

/* ------------------------------------------------------------------ pages */

const NAV_GROUPS = [
  { title: '总览', pages: ['index'] },
  { title: '世界构成', pages: ['world', 'passage'] },
  { title: '核心规则', pages: ['world-cycle', 'essence', 'law', 'sorcerer', 'power-system', 'correction'] },
  { title: '非凡物品', pages: ['artifact-relic', 'alchemy', 'alchemy-arms', 'essence-economy'] },
  { title: '非凡种族', pages: ['race-human', 'race-fantasy', 'race-dragonkin'] },
  { title: '非凡存在', pages: ['new-gods', 'old-kings', 'outer-gods', 'calamity'] },
  { title: '历史', pages: ['timeline', 'history-official', 'federation'] },
  { title: '检索', pages: ['glossary'] },
];

// 已并入其它页面的旧网址：内容页删除后仍保留一个**静默**跳转，
// 以免旧链接、书签、浏览器缓存的旧侧边栏点到 404。
// 键 = 已退休的 slug，值 = 落点（可带 #锚点）。
const REDIRECTS = {
  'law-meltdown': { to: 'sorcerer.html#律法熔断', target: '术士' },
};

function loadContent() {
  // 排除 Office 风格的临时锁文件（~$xxx.md）与隐藏文件，
  // 否则它们会被当成正文，产出一个垃圾页面。
  const files = fs.existsSync(CONTENT_DIR)
    ? fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('~$') && !f.startsWith('.'))
    : [];
  const skipped = fs.existsSync(CONTENT_DIR)
    ? fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md') && (f.startsWith('~$') || f.startsWith('.')))
    : [];
  if (skipped.length) {
    console.warn(`  已跳过 ${skipped.length} 个临时/隐藏文件：${skipped.join('、')}`);
  }
  const pages = new Map();
  for (const f of files) {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8');
    const { meta, body } = parseFrontMatter(raw);
    const key = f.replace(/\.md$/, '');
    pages.set(key, {
      key,
      file: `${key}.html`,
      title: meta.title || key,
      category: meta.category || '',
      summary: meta.summary || '',
      tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? String(meta.tags).split(',').map((s) => s.trim()) : [],
      keywords: Array.isArray(meta.keywords) ? meta.keywords : meta.keywords ? String(meta.keywords).split(',').map((s) => s.trim()) : [],
      autolink: meta.autolink !== 'false',
      updated: meta.updated || '',
      body,
    });
  }
  return pages;
}

function buildLinkMap(pages) {
  const map = new Map();
  for (const p of pages.values()) {
    for (const kw of p.keywords) if (kw && kw.length >= 2) map.set(kw, p.file);
  }
  // 精确名词优先：代码名【】内的词优先绑定到其所属条目
  const priority = ['原初律法', '无上意志', '修正值', '炼金武装', '遗物', '封印物', '灰潮使徒', '灰潮构造体', 'DEVIL TRIGGER', '终末之环', '世界引擎', '先锋守望', '帷幕工程', '千年协定', '帝国轴心', '绛天之龙', '铸形之炎', '伏行之恶', '轮回终末', '百相熔炉协会', '永世集团', '黄金黎明结社', '无邦者', '辉石', '魔人', '亚龙', '四界'];
  const owner = {
    原初律法: 'law.html', 无上意志: 'outer-gods.html', 修正值: 'correction.html', 炼金武装: 'alchemy-arms.html',
    遗物: 'artifact-relic.html', 灰潮使徒: 'calamity.html', 灰潮构造体: 'calamity.html',    'DEVIL TRIGGER': 'calamity.html', 终末之环: 'timeline.html', 世界引擎: 'timeline.html',
    先锋守望: 'timeline.html', 帷幕工程: 'timeline.html', 千年协定: 'timeline.html', 帝国轴心: 'timeline.html',
    绛天之龙: 'outer-gods.html', 铸形之炎: 'outer-gods.html', 伏行之恶: 'outer-gods.html', 轮回终末: 'outer-gods.html',
    百相熔炉协会: 'old-kings.html', 永世集团: 'old-kings.html', 黄金黎明结社: 'old-kings.html', 无邦者: 'old-kings.html',
    辉石: 'essence.html', 魔人: 'calamity.html', 亚龙: 'calamity.html',
    // 裁决后新增条目
    环阶: 'power-system.html', 源质抗性: 'sorcerer.html',
    四界: 'power-system.html', 物质界: 'power-system.html', 形成界: 'power-system.html',
    创造界: 'power-system.html', 原型界: 'power-system.html',
    通行方式: 'passage.html', 官方叙事: 'history-official.html', 辉石经济: 'essence-economy.html',
    凝结: 'essence-economy.html', 耐受上限: 'sorcerer.html',
    新合众国: 'federation.html', 新神: 'new-gods.html',
  };
  for (const t of priority) if (owner[t]) map.set(t, owner[t]);
  return map;
}

function renderSidebar(pages, currentKey) {
  const groups = [];
  const placed = new Set();
  for (const g of NAV_GROUPS) {
    const items = g.pages.map((k) => pages.get(k)).filter(Boolean);
    if (!items.length) continue;
    items.forEach((p) => placed.add(p.key));
    groups.push({ title: g.title, items });
  }
  const rest = [...pages.values()].filter((p) => !placed.has(p.key));
  if (rest.length) groups.push({ title: '其它', items: rest });

  return groups
    .map((g) => {
      const links = g.items
        .map((p) => {
          const active = p.key === currentKey ? ' class="active"' : '';
          return `<li><a href="${escapeAttr(p.file)}"${active}><span class="nav-title">${escapeHtml(p.title)}</span>${p.summary ? `<span class="nav-sub">${escapeHtml(p.summary)}</span>` : ''}</a></li>`;
        })
        .join('');
      return `<section class="nav-group"><h3>${escapeHtml(g.title)}</h3><ul>${links}</ul></section>`;
    })
    .join('');
}

function pageShell({ pages, page, content, toc }) {
  const nav = renderSidebar(pages, page.key);
  const tocHtml = toc.length
    ? `<nav class="toc"><h4>本页目录</h4><ul>${toc.map((h, idx) => `<li><a href="#${escapeAttr(h.id)}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></nav>`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)} · ${escapeHtml(SITE_TITLE)}</title>
<meta name="description" content="${escapeAttr(page.summary || SITE_TITLE)}">
<meta name="robots" content="noindex,nofollow">
<link rel="stylesheet" href="style.css">
</head>
<body>
<input id="nav-toggle" type="checkbox" hidden>
<header class="topbar">
  <label for="nav-toggle" class="burger" title="目录">☰</label>
  <a class="brand" href="index.html"><span class="brand-main">${escapeHtml(SITE_TITLE)}</span><span class="brand-sub">${escapeHtml(SITE_SUB)}</span></a>
  <div class="search-box">
    <input id="q" type="search" placeholder="搜索设定…（点击或按 / 聚焦）" autocomplete="off" spellcheck="false">
    <div id="results" class="results" hidden></div>
  </div>
</header>
<div class="layout">
  <aside class="sidebar">${nav}</aside>
  <main class="content">
    <article class="article">
      <h1>${escapeHtml(page.title)}</h1>
      <p class="meta">${page.category ? `<span class="chip">${escapeHtml(page.category)}</span>` : ''}${page.tags.map((t) => `<span class="chip ghost">${escapeHtml(t)}</span>`).join('')}${page.updated ? `<span class="updated">更新：${escapeHtml(page.updated)}</span>` : ''}</p>
      ${content}
    </article>
    ${tocHtml}
    <footer class="footer">本地静态 Wiki · 内容源：<code>content/*.md</code> · 由 <code>build.mjs</code> 生成</footer>
  </main>
</div>
<script src="search-index.js"></script>
<script src="app.js"></script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ build */

function build() {
  const pages = loadContent();
  if (!pages.size) {
    console.error('content/ 下没有找到 .md 文件');
    process.exit(1);
  }
  globalThis.__LINK_MAP__ = buildLinkMap(pages);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const searchIndex = [];
  for (const page of pages.values()) {
    globalThis.__LINKED__ = new Set(); // 每页重置「首次出现」去重
    const { html, headings, plain } = renderMarkdown(page.body, page.file, page.autolink);
    const outFile = path.join(OUT_DIR, page.file);
    fs.writeFileSync(outFile, pageShell({ pages, page, content: html, toc: headings }), 'utf8');

    searchIndex.push({
      title: page.title,
      url: page.file,
      category: page.category,
      summary: page.summary,
      headings: headings.map((h) => h.text),
      body: plain.replace(/\s+/g, ' ').slice(0, 8000),
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'style.css'), STYLE, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'app.js'), APP_JS, 'utf8');
  // 未公开的设定稿：默认禁止搜索引擎收录。若要公开可自行删除本段与 HTML 里的 robots meta。
  fs.writeFileSync(
    path.join(OUT_DIR, 'robots.txt'),
    ['User-agent: *', 'Disallow: /', ''].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'search-index.js'),
    `window.__WIKI_INDEX__ = ${JSON.stringify(searchIndex)};\n`,
    'utf8'
  );

  // 退休网址的静默跳转：页面不可见内容，落地即进目标页。
  // 不进侧边栏、不进检索索引，也不显示任何中转文字或链接。
  for (const [slug, r] of Object.entries(REDIRECTS)) {
    if (pages.has(slug)) {
      console.warn(`  跳转壳 ${slug}.html 与现有页面同名，已跳过`);
      continue;
    }
    const [file, frag] = r.to.split('#');
    const href = frag ? `${file}#${encodeURI(frag)}` : file;
    fs.writeFileSync(
      path.join(OUT_DIR, `${slug}.html`),
      `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${r.target} · 世界观 Wiki</title>
<meta name="robots" content="noindex,nofollow">
<link rel="canonical" href="${href}">
<meta http-equiv="refresh" content="0; url=${href}">
</head>
<body>
<script>location.replace(${JSON.stringify(href)});</script>
</body>
</html>
`,
      'utf8'
    );
  }

  const totalChars = [...pages.values()].reduce((n, p) => n + p.body.length, 0);
  console.log(`✓ 构建完成：${pages.size} 个页面 → ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`  正文合计 ${totalChars} 字符，检索索引 ${searchIndex.length} 条`);
  console.log(`  打开：${path.join(OUT_DIR, 'index.html')}`);
}

/* ------------------------------------------------------------------- serve */

function serve(port) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const target = path.join(OUT_DIR, rel);
    if (!target.startsWith(OUT_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(target, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 not found');
        return;
      }
      res.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n本地站点：http://127.0.0.1:${port}/`);
    console.log('（Ctrl+C 停止）');
  });
}

/* ---------------------------------------------------------------- assets */

const STYLE = `:root{
  --bg:#0f1218; --bg-soft:#151a23; --bg-card:#1a212c; --line:#28323f;
  --fg:#e6ecf4; --fg-dim:#9aa8ba; --accent:#7cc4ff; --accent-dim:#3d7fb0;
  --gold:#e2c98a; --radius:10px;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Cascadia Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:15.5px;line-height:1.75}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:var(--mono);font-size:.9em;background:#232c38;padding:.1em .4em;border-radius:5px}
code.code{background:transparent;color:var(--gold);font-weight:600}
em.quoted{color:var(--gold);font-style:normal}

/* topbar */
.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;padding:10px 18px;background:rgba(15,18,24,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.brand{display:flex;flex-direction:column;line-height:1.2;color:var(--fg)}
.brand:hover{text-decoration:none}
.brand-main{font-weight:700;letter-spacing:.5px}
.brand-sub{font-size:11.5px;color:var(--fg-dim);letter-spacing:.4px}
.burger{display:none;cursor:pointer;font-size:20px;padding:0 6px;color:var(--fg-dim)}
.search-box{position:relative;margin-left:auto;width:min(420px,45vw)}
#q{width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg-soft);color:var(--fg);font-family:var(--sans);font-size:14px}
#q:focus{outline:none;border-color:var(--accent-dim);box-shadow:0 0 0 3px rgba(124,196,255,.12)}
.results{position:absolute;top:calc(100% + 6px);right:0;width:min(560px,80vw);max-height:60vh;overflow:auto;background:var(--bg-card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 12px 32px rgba(0,0,0,.45)}
.results .r{padding:10px 13px;border-bottom:1px solid var(--line);cursor:pointer;display:block;color:var(--fg)}
.results .r:last-child{border-bottom:none}
.results .r:hover,.results .r.on{background:#222b38;text-decoration:none}
.results .r-t{font-weight:600;font-size:14px}
.results .r-t .cat{font-weight:400;font-size:11.5px;color:var(--fg-dim);margin-left:6px}
.results .r-s{font-size:12.5px;color:var(--fg-dim);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.results mark{background:rgba(226,201,138,.25);color:var(--gold);border-radius:3px;padding:0 2px}
.results .empty{padding:14px;color:var(--fg-dim);font-size:13px}

/* layout */
.layout{display:grid;grid-template-columns:274px minmax(0,1fr);gap:28px;max-width:1400px;margin:0 auto;padding:22px 18px 60px}
.sidebar{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 84px);overflow:auto;padding-right:6px}
.nav-group{margin-bottom:16px}
.nav-group h3{margin:0 0 6px;font-size:11.5px;letter-spacing:1.2px;color:var(--fg-dim);text-transform:uppercase;font-weight:600}
.nav-group ul{list-style:none;margin:0;padding:0}
.nav-group li a{display:flex;flex-direction:column;padding:6px 10px;border-radius:8px;color:var(--fg);border-left:2px solid transparent}
.nav-group li a:hover{background:var(--bg-soft);text-decoration:none}
.nav-group li a.active{background:var(--bg-card);border-left-color:var(--accent)}
.nav-title{font-size:14px}
.nav-sub{font-size:11px;color:var(--fg-dim);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* article */
.article{background:var(--bg-soft);border:1px solid var(--line);border-radius:var(--radius);padding:26px 30px}
.article h1{margin:0 0 8px;font-size:27px;letter-spacing:.5px}
.article h2{margin:30px 0 10px;font-size:20px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.article h3{margin:22px 0 8px;font-size:16.5px;color:var(--gold)}
.article h4{margin:18px 0 6px;font-size:15px}
.article p{margin:10px 0}
.article ul,.article ol{margin:10px 0;padding-left:22px}
.article li{margin:5px 0}
.article blockquote{margin:12px 0;padding:10px 16px;border-left:3px solid var(--accent-dim);background:#131922;border-radius:0 8px 8px 0;color:#cfd9e6}
.article hr{border:none;border-top:1px dashed var(--line);margin:26px 0}
pre.code{background:#0c1016;border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.65;color:#c7d6e8}
pre.code code{background:transparent;padding:0;font-size:inherit}
.anchor{opacity:0;margin-left:8px;font-weight:400;font-size:14px;color:var(--fg-dim)}
h2:hover .anchor,h3:hover .anchor{opacity:1}
.meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 18px}
.chip{font-size:11.5px;padding:2px 9px;border-radius:99px;background:#22303f;color:var(--accent);border:1px solid #2b3d50}
.chip.ghost{background:transparent;color:var(--fg-dim);border-color:var(--line)}
.updated{font-size:11.5px;color:var(--fg-dim)}
.table-wrap{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid var(--line);padding:7px 11px;text-align:left;vertical-align:top}
th{background:#1d2632;color:var(--gold);font-weight:600;white-space:nowrap}
tbody tr:nth-child(even){background:#171e28}
a.term{border-bottom:1px dashed var(--accent-dim)}
a.ext::after{content:"↗";font-size:11px;margin-left:2px;color:var(--fg-dim)}

/* toc */
.toc{margin-top:18px;background:var(--bg-soft);border:1px solid var(--line);border-radius:var(--radius);padding:14px 18px}
.toc h4{margin:0 0 8px;font-size:12px;letter-spacing:1px;color:var(--fg-dim);text-transform:uppercase}
.toc ul{list-style:none;margin:0;padding:0;columns:2;column-gap:24px}
.toc li{margin:3px 0;font-size:13.5px}
.footer{margin-top:26px;color:var(--fg-dim);font-size:12px;text-align:center}

@media (max-width:900px){
  .burger{display:block}
  .layout{grid-template-columns:1fr;padding:16px 12px 50px}
  .sidebar{position:fixed;top:56px;left:0;bottom:0;width:280px;max-height:none;background:var(--bg-soft);border-right:1px solid var(--line);padding:16px;transform:translateX(-102%);transition:transform .2s ease;z-index:25}
  #nav-toggle:checked ~ .layout .sidebar{transform:none}
  .article{padding:18px 16px}
  .toc ul{columns:1}
  .search-box{width:auto;flex:1}
}
`;

const APP_JS = `(function(){
  var idx = window.__WIKI_INDEX__ || [];
  var q = document.getElementById('q');
  var box = document.getElementById('results');
  if(!q || !box) return;

  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function mark(text, terms){
    var out = esc(text);
    terms.forEach(function(t){
      if(t.length < 1) return;
      var re = new RegExp('(' + t.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&') + ')','gi');
      out = out.replace(re,'<mark>$1</mark>');
    });
    return out;
  }
  function snippet(body, terms){
    var lower = body.toLowerCase();
    var pos = -1;
    for(var i=0;i<terms.length;i++){
      pos = lower.indexOf(terms[i].toLowerCase());
      if(pos >= 0) break;
    }
    if(pos < 0) pos = 0;
    var start = Math.max(0, pos - 40);
    return (start > 0 ? '…' : '') + body.slice(start, start + 150) + '…';
  }
  function search(raw){
    var terms = raw.trim().split(/\\s+/).filter(Boolean);
    if(!terms.length) return [];
    var res = [];
    idx.forEach(function(p){
      var hay = (p.title + ' ' + p.category + ' ' + (p.headings||[]).join(' ') + ' ' + p.body).toLowerCase();
      var score = 0, ok = true;
      terms.forEach(function(t){
        var n = hay.split(t.toLowerCase()).length - 1;
        if(n === 0){ ok = false; return; }
        score += n;
        if(p.title.toLowerCase().indexOf(t.toLowerCase()) >= 0) score += 12;
        if(p.category.toLowerCase().indexOf(t.toLowerCase()) >= 0) score += 3;
      });
      if(ok) res.push({ p: p, score: score, terms: terms });
    });
    res.sort(function(a,b){ return b.score - a.score; });
    return res.slice(0, 8);
  }
  var last = [];
  function render(raw){
    last = search(raw);
    if(!raw.trim()){ box.hidden = true; box.innerHTML=''; return; }
    box.hidden = false;
    if(!last.length){ box.innerHTML = '<div class="empty">没有匹配的条目</div>'; return; }
    box.innerHTML = last.map(function(r,i){
      return '<a class="r' + (i===0?' on':'') + '" href="' + r.p.url + '">' +
        '<div class="r-t">' + mark(r.p.title, r.terms) + '<span class="cat">' + esc(r.p.category) + '</span></div>' +
        '<div class="r-s">' + mark(snippet(r.p.body, r.terms), r.terms) + '</div></a>';
    }).join('');
  }
  q.addEventListener('input', function(){ render(q.value); });
  q.addEventListener('focus', function(){ if(q.value.trim()) render(q.value); });
  document.addEventListener('click', function(e){
    if(!box.contains(e.target) && e.target !== q) box.hidden = true;
  });
  q.addEventListener('keydown', function(e){
    var items = box.querySelectorAll('.r');
    if(!items.length) return;
    var cur = Array.prototype.indexOf.call(items, box.querySelector('.r.on'));
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      cur = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items.forEach(function(el){ el.classList.remove('on'); });
      items[cur].classList.add('on');
      items[cur].scrollIntoView({ block:'nearest' });
    } else if(e.key === 'Enter'){
      e.preventDefault();
      (items[cur] || items[0]).click();
    } else if(e.key === 'Escape'){
      box.hidden = true; q.blur();
    }
  });
  document.addEventListener('keydown', function(e){
    if(e.key === '/' && document.activeElement !== q){
      e.preventDefault(); q.focus();
    }
  });
})();
`;

/* -------------------------------------------------------------------- run */

const args = process.argv.slice(2);
build();
if (args.includes('--serve')) {
  const i = args.indexOf('--serve');
  const port = Number(args[i + 1]) || 8899;
  serve(port);
}
