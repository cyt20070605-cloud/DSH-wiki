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
  { title: '世界构成', pages: ['world'] },
  { title: '核心规则', pages: ['world-cycle', 'essence', 'law', 'sorcerer', 'power-system', 'correction'] },
  { title: '非凡物品', pages: ['sealed-object', 'end-ring', 'reactor', 'golden-tree', 'alchemy', 'essence-economy'] },
  { title: '非凡种族', pages: ['race-human', 'race-fantasy', 'race-dragonkin'] },
  { title: '非凡存在', pages: ['new-gods', 'old-kings', 'outer-gods', 'calamity'] },
  { title: '势力', pages: ['ashihara', 'baghdad', 'asara', 'new-shenzhou', 'victoria', 'northern-alliance', 'faralensa', 'federation', 'european-federation'] },
  // 重大事件：按发生时间排列（旧时代末期 → 十四世纪末 → 1999 → 当代机制）
  { title: '重要事件', pages: ['new-world-project', 'shatter-war', 'day-of-wrath', 'millennium-sinking', 'history-official'] },
  { title: '历史', pages: ['timeline'] },
  { title: '检索', pages: ['glossary'] },
];

// 已并入其它页面的旧网址：内容页删除后仍保留一个**静默**跳转，
// 以免旧链接、书签、浏览器缓存的旧侧边栏点到 404。
// 键 = 已退休的 slug，值 = 落点（可带 #锚点）。
const REDIRECTS = {
  // 注：「律法熔断」一节已从术士页撤下，故不再带 #锚点（原锚点已不存在）
  'law-meltdown': { to: 'sorcerer.html', target: '术士' },
  'passage': { to: 'world.html#区域间通行的方式', target: '四层世界' },
  'alchemy-arms': { to: 'alchemy.html#炼金武装', target: '炼金学' },
  // 「遗物」改名「封印物」后旧网址的静默跳转
  'artifact-relic': { to: 'sealed-object.html', target: '封印物' },
  // 势力页改名后的旧网址
  'middle-east': { to: 'asara.html', target: '阿萨拉' },
  'holy-faralensa': { to: 'faralensa.html', target: '法拉伦萨' },
  'sakura-empire': { to: 'ashihara.html', target: '苇原' },
  'victorian-united-kingdom': { to: 'victoria.html', target: '维多利亚' },
  'european-community': { to: 'european-federation.html', target: '欧陆联合' },
  'european-union': { to: 'european-federation.html', target: '欧陆联合' },
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
  const priority = ['原初律法', '律法', '无上意志', '修正值', '炼金武装', '封印物', '灰潮使徒', '灰潮构造体', 'DEVIL TRIGGER', '终末之环', '世界引擎', '先锋守望', '帷幕计划', '千年协定', '帝国轴心', '绛天之龙', '铸形之炎', '伏行之恶', '轮回终末', '百相熔炉', '永世集团', '黄金黎明', '世外天国', '辉石', '魔人', '亚龙', '四界', '新世工程', '新世', '破碎战争', '第一次冲击', '震怒之日', '第二次冲击', '千禧陆沉', '第三次冲击', '维多利亚', '法拉伦萨', '欧陆联合', '北方同盟', '新合众国', '新神州', '巴格达', '阿萨拉', '苇原', '金色裂痕', '黄金树'];
  const owner = {
    原初律法: 'law.html', 无上意志: 'outer-gods.html', 修正值: 'correction.html', 炼金武装: 'alchemy.html#炼金武装',
    封印物: 'sealed-object.html', 灰潮使徒: 'calamity.html', 灰潮构造体: 'calamity.html',    'DEVIL TRIGGER': 'calamity.html', 终末之环: 'sealed-object.html', 世界引擎: 'timeline.html',
    先锋守望: 'timeline.html', 帷幕计划: 'timeline.html', 千年协定: 'timeline.html', 帝国轴心: 'timeline.html',
    绛天之龙: 'outer-gods.html', 铸形之炎: 'outer-gods.html', 伏行之恶: 'outer-gods.html', 轮回终末: 'outer-gods.html',
    百相熔炉: 'old-kings.html', 永世集团: 'old-kings.html', 黄金黎明: 'old-kings.html', 世外天国: 'old-kings.html',
    辉石: 'essence.html', 魔人: 'calamity.html', 亚龙: 'calamity.html',
    // 裁决后新增条目
    环阶: 'power-system.html', 源质抗性: 'sorcerer.html',
    四界: 'power-system.html', 物质界: 'power-system.html', 形成界: 'power-system.html',
    创造界: 'power-system.html', 原型界: 'power-system.html',
    通行方式: 'world.html#阻止区域间通行的方式', 官方叙事: 'history-official.html', 辉石经济: 'essence-economy.html',
    凝结: 'essence-economy.html', 耐受上限: 'sorcerer.html',
    新合众国: 'federation.html', 神明: 'new-gods.html', 律法: 'law.html',
    // 项目独立页（术语一律指向页面自身）
    帷幕计划: 'history-official.html', 新世工程: 'new-world-project.html',
    新世: 'new-world-project.html',
    // 重大事件页
    破碎战争: 'shatter-war.html', 第一次冲击: 'shatter-war.html',
    震怒之日: 'day-of-wrath.html', 第二次冲击: 'day-of-wrath.html',
    千禧陆沉: 'millennium-sinking.html', 第三次冲击: 'millennium-sinking.html',
    // 势力页（各页术语一律指向页面自身）
    维多利亚: 'victoria.html', 法拉伦萨: 'faralensa.html',
    欧陆联合: 'european-federation.html', 北方同盟: 'northern-alliance.html',
    新神州: 'new-shenzhou.html', 巴格达: 'baghdad.html', 阿萨拉: 'asara.html', 苇原: 'ashihara.html',
    // 非凡物品页（封印物 与 其子页 终末之环）
    黄金树: 'golden-tree.html', 金色裂痕: 'golden-tree.html',
  };
  for (const t of priority) if (owner[t]) map.set(t, owner[t]);
  return map;
}

/** 侧栏分组（NAV_GROUPS 顺序 + 未被收录的页面兜到「其它」） */
function groupPages(pages) {
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
  return groups;
}

/** 阅读顺序（上一页 / 下一页用） */
function orderedPages(pages) {
  return groupPages(pages).flatMap((g) => g.items);
}

function renderSidebar(groups, currentKey) {
  const sections = groups
    .map((g) => {
      const links = g.items
        .map((p) => {
          const active = p.key === currentKey ? ' class="active" aria-current="page"' : '';
          const sub = p.summary ? `<span class="nav-sub">${escapeHtml(p.summary)}</span>` : '';
          return `<li><a href="${escapeAttr(p.file)}"${active}><span class="nav-title">${escapeHtml(p.title)}</span>${sub}</a></li>`;
        })
        .join('\n          ');
      return `      <section class="nav-group" data-group="${escapeAttr(g.title)}">
        <button class="nav-head" type="button" aria-expanded="true"><span>${escapeHtml(g.title)}</span><span class="caret" aria-hidden="true">▾</span></button>
        <ul class="nav-list">
          ${links}
        </ul>
      </section>`;
    })
    .join('\n');

  return `    <div class="nav-filter">
      <input id="nav-filter" type="search" placeholder="过滤条目…" aria-label="过滤条目" autocomplete="off">
    </div>
    <div class="nav-scroll" id="nav-scroll">
${sections}
      <p class="nav-empty" hidden>没有匹配的条目</p>
    </div>`;
}

const ICON_SEARCH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6"></path></svg>`;
const ICON_SUN = `<svg class="i-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"></circle><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"></path></svg>`;
const ICON_MOON = `<svg class="i-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z"></path></svg>`;

function pageShell({ pages, page, content, toc, prev, next }) {
  const groups = groupPages(pages);
  const nav = renderSidebar(groups, page.key);
  const groupTitle = (groups.find((g) => g.items.some((p) => p.key === page.key)) || {}).title || '';

  const crumbs = [
    `<a href="index.html">${escapeHtml(SITE_TITLE)}</a>`,
    groupTitle ? `<span class="sep">/</span><span>${escapeHtml(groupTitle)}</span>` : '',
    page.category && page.category !== groupTitle ? `<span class="sep">/</span><span>${escapeHtml(page.category)}</span>` : '',
  ].join('');

  const tocHtml = toc.length
    ? `<nav class="toc" aria-label="本页目录"><p class="rail-title">本页目录</p><ul>${toc
        .map((h) => `<li><a href="#${escapeAttr(h.id)}">${escapeHtml(h.text)}</a></li>`)
        .join('')}</ul></nav>`
    : `<p class="rail-empty">本页无分节</p>`;

  const pagerCell = (p, dir, label) =>
    p
      ? `<a class="${dir}" href="${escapeAttr(p.file)}"><span class="p-label">${label}</span><span class="p-title">${escapeHtml(p.title)}</span></a>`
      : `<span class="spacer" aria-hidden="true"></span>`;
  const pager =
    prev || next
      ? `    <nav class="pager" aria-label="翻页">
      ${pagerCell(prev, 'prev', '← 上一篇')}
      ${pagerCell(next, 'next', '下一篇 →')}
    </nav>`
      : '';

  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)} · ${escapeHtml(SITE_TITLE)}</title>
<meta name="description" content="${escapeAttr(page.summary || SITE_TITLE)}">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#080a10">
<script>try{var t=localStorage.getItem('wiki-theme');if(!t){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
<link rel="stylesheet" href="style.css">
</head>
<body>
<a class="skip-link" href="#content">跳到正文</a>
<div class="read-progress" id="progress" aria-hidden="true"></div>
<div class="scrim" id="scrim" aria-hidden="true"></div>

<header class="topbar">
  <button class="burger" id="nav-open" type="button" aria-label="打开目录" aria-expanded="false">☰</button>
  <a class="brand" href="index.html">
    <span class="brand-mark" aria-hidden="true">源</span>
    <span class="brand-body">
      <span class="brand-main">${escapeHtml(SITE_TITLE)}</span>
      <span class="brand-sub">${escapeHtml(SITE_SUB)}</span>
    </span>
  </a>
  <div class="search">
    <div class="search-field">
      ${ICON_SEARCH}
      <input id="q" type="search" placeholder="搜索设定…" aria-label="搜索设定" autocomplete="off" spellcheck="false">
      <span class="search-kbd" aria-hidden="true">/</span>
    </div>
    <div id="results" class="results" role="listbox" aria-label="搜索结果" hidden></div>
  </div>
  <button class="icon-btn" id="theme-toggle" type="button" aria-label="切换深色 / 浅色主题">${ICON_SUN}${ICON_MOON}</button>
</header>

<div class="layout">
  <aside class="sidebar" id="nav" aria-label="条目目录">
${nav}
  </aside>

  <main class="main" id="content">
    <nav class="crumbs" aria-label="位置">${crumbs}</nav>
    <article class="article">
      <header class="doc-head">
        <h1 class="doc-title">${escapeHtml(page.title)}</h1>
        ${page.summary ? `<p class="doc-lead">${escapeHtml(page.summary)}</p>` : ''}
        <p class="meta">${page.category ? `<span class="chip">${escapeHtml(page.category)}</span>` : ''}${page.tags.map((t) => `<span class="chip ghost">${escapeHtml(t)}</span>`).join('')}${page.updated ? `<span class="updated">更新：${escapeHtml(page.updated)}</span>` : ''}</p>
      </header>
      <div class="prose">
${content}
      </div>
    </article>
${pager}
    <footer class="footer">
      <div>本地静态 Wiki · 内容源 <code>content/*.md</code> · 由 <code>build.mjs</code> 生成</div>
      <div>${escapeHtml(SITE_TITLE)} · ${escapeHtml(SITE_SUB)}</div>
    </footer>
  </main>

  <aside class="rail" aria-label="本页导航">
    ${tocHtml}
  </aside>
</div>

<button class="to-top" id="to-top" type="button" aria-label="回到顶部">↑</button>
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
  const order = orderedPages(pages);
  for (const page of pages.values()) {
    globalThis.__LINKED__ = new Set(); // 每页重置「首次出现」去重
    const { html, headings, plain } = renderMarkdown(page.body, page.file, page.autolink);
    const outFile = path.join(OUT_DIR, page.file);
    const pos = order.findIndex((p) => p.key === page.key);
    const prev = pos > 0 ? order[pos - 1] : null;
    const next = pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null;
    fs.writeFileSync(outFile, pageShell({ pages, page, content: html, toc: headings, prev, next }), 'utf8');

    searchIndex.push({
      title: page.title,
      url: page.file,
      category: page.category,
      summary: page.summary,
      headings: headings.map((h) => h.text),
      body: plain.replace(/\s+/g, ' ').slice(0, 8000),
    });
  }

  // 样式与脚本来自 assets/，构建时原样拷贝进产物目录（改样式只需改 assets/*）
  fs.writeFileSync(path.join(OUT_DIR, 'style.css'), readAsset('style.css'), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'app.js'), readAsset('app.js'), 'utf8');
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

// 样式与客户端脚本放在 assets/ 下，构建时原样拷贝到 site/。
// 这样改 UI 不必再动本文件，也免去在模板字符串里转义反引号与 ${}。
const ASSET_DIR = path.join(ROOT, 'assets');

function readAsset(name) {
  const file = path.join(ASSET_DIR, name);
  if (!fs.existsSync(file)) {
    console.error(`缺少资源文件：assets/${name}`);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8');
}

/* -------------------------------------------------------------------- run */

const args = process.argv.slice(2);
build();
if (args.includes('--serve')) {
  const i = args.indexOf('--serve');
  const port = Number(args[i + 1]) || 8899;
  serve(port);
}
