/* ============================================================================
   世界观 Wiki · 前端交互（零依赖）
   ----------------------------------------------------------------------------
   职责：
     1. 主题切换（深/浅，localStorage 记忆，首屏由 <head> 内联脚本预先定色）
     2. 移动端抽屉目录（汉堡 + 遮罩 + Esc）
     3. 侧边栏分组折叠 + 目录即时过滤 + 当前条目自动滚入视野
     4. 顶栏检索（本地索引，多词命中打分、高亮、键盘上下/回车）
     5. 阅读进度条、右侧本页目录滚动高亮、回到顶部
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;

  /* ------------------------------------------------------------ 主题切换 */
  function initTheme() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('wiki-theme', next); } catch (e) {}
      btn.setAttribute('aria-label', next === 'light' ? '切换到深色主题' : '切换到浅色主题');
    });
  }

  /* ------------------------------------------------------------ 移动抽屉 */
  function initDrawer() {
    var burger = document.getElementById('nav-open');
    var scrim = document.getElementById('scrim');
    if (!burger) return;

    function close() {
      body.classList.remove('nav-open');
      if (scrim) scrim.classList.remove('show');
      burger.setAttribute('aria-expanded', 'false');
    }
    function open() {
      body.classList.add('nav-open');
      if (scrim) scrim.classList.add('show');
      burger.setAttribute('aria-expanded', 'true');
    }

    burger.addEventListener('click', function () {
      if (body.classList.contains('nav-open')) close(); else open();
    });
    if (scrim) scrim.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    // 点目录里的链接后自动收起
    var nav = document.getElementById('nav');
    if (nav) {
      nav.addEventListener('click', function (e) {
        if (e.target.closest('a')) close();
      });
    }
  }

  /* ------------------------------------------------- 分组折叠 + 目录过滤 */
  function initNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var collapsed = {};
    try { collapsed = JSON.parse(localStorage.getItem('wiki-nav-collapsed') || '{}') || {}; } catch (e) {}

    var groups = [].slice.call(nav.querySelectorAll('.nav-group'));
    groups.forEach(function (g) {
      var key = g.getAttribute('data-group') || '';
      var head = g.querySelector('.nav-head');
      if (collapsed[key]) g.setAttribute('data-collapsed', '1');
      if (head) {
        head.setAttribute('aria-expanded', collapsed[key] ? 'false' : 'true');
        head.addEventListener('click', function () {
          var isCollapsed = g.getAttribute('data-collapsed') === '1';
          if (isCollapsed) {
            g.removeAttribute('data-collapsed');
            delete collapsed[key];
          } else {
            g.setAttribute('data-collapsed', '1');
            collapsed[key] = 1;
          }
          head.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
          try { localStorage.setItem('wiki-nav-collapsed', JSON.stringify(collapsed)); } catch (e) {}
        });
      }
    });

    // 过滤：输入时隐藏不匹配项，并临时展开所有分组
    var filter = document.getElementById('nav-filter');
    var scrollBox = document.getElementById('nav-scroll');
    var emptyTip = nav.querySelector('.nav-empty');
    if (filter && scrollBox) {
      filter.addEventListener('input', function () {
        var kw = filter.value.trim().toLowerCase();
        var hitTotal = 0;
        groups.forEach(function (g) {
          var items = [].slice.call(g.querySelectorAll('.nav-list li'));
          var hit = 0;
          items.forEach(function (li) {
            var text = (li.textContent || '').toLowerCase();
            var match = !kw || text.indexOf(kw) >= 0;
            li.style.display = match ? '' : 'none';
            if (match) hit++;
          });
          g.style.display = hit || !kw ? '' : 'none';
          if (kw) g.removeAttribute('data-collapsed');
          else if (collapsed[g.getAttribute('data-group') || '']) g.setAttribute('data-collapsed', '1');
          hitTotal += hit;
        });
        if (emptyTip) emptyTip.hidden = !kw || hitTotal > 0;
      });
    }

    // 当前条目滚入视野
    var active = nav.querySelector('.nav-list a.active');
    if (active && scrollBox) {
      var aTop = active.offsetTop;
      var boxTop = scrollBox.scrollTop;
      var boxH = scrollBox.clientHeight;
      if (aTop < boxTop || aTop > boxTop + boxH - 60) {
        scrollBox.scrollTop = Math.max(0, aTop - boxH / 3);
      }
    }
  }

  /* -------------------------------------------------------------- 顶栏检索 */
  function initSearch() {
    var idx = window.__WIKI_INDEX__ || [];
    var q = document.getElementById('q');
    var box = document.getElementById('results');
    if (!q || !box || !idx.length) return;

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function mark(text, terms) {
      var out = esc(text);
      terms.forEach(function (t) {
        if (!t) return;
        var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        out = out.replace(re, '<mark>$1</mark>');
      });
      return out;
    }

    function snippet(text, terms) {
      var lower = String(text || '').toLowerCase();
      var pos = -1;
      for (var i = 0; i < terms.length; i++) {
        pos = lower.indexOf(terms[i].toLowerCase());
        if (pos >= 0) break;
      }
      if (pos < 0) pos = 0;
      var start = Math.max(0, pos - 40);
      var head = start > 0 ? '…' : '';
      return head + String(text || '').slice(start, start + 150) + '…';
    }

    function search(raw) {
      var terms = raw.trim().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      var res = [];
      idx.forEach(function (p) {
        var title = String(p.title || '');
        var cat = String(p.category || '');
        var hay = (title + ' ' + cat + ' ' + (p.headings || []).join(' ') + ' ' + (p.body || '')).toLowerCase();
        var score = 0;
        var ok = true;
        var tl = title.toLowerCase();
        terms.forEach(function (t) {
          var needle = t.toLowerCase();
          var n = hay.split(needle).length - 1;
          if (n === 0) { ok = false; return; }
          score += n;
          if (tl.indexOf(needle) >= 0) score += 12;
          if (tl === needle) score += 30;
          if (cat.toLowerCase().indexOf(needle) >= 0) score += 3;
        });
        if (ok) res.push({ p: p, score: score, terms: terms });
      });
      res.sort(function (a, b) { return b.score - a.score; });
      return res.slice(0, 8);
    }

    var items = [];

    function render(raw) {
      if (!raw.trim()) { box.hidden = true; box.innerHTML = ''; items = []; return; }
      var hits = search(raw);
      box.hidden = false;
      if (!hits.length) {
        items = [];
        box.innerHTML = '<div class="empty">没有匹配的条目</div>';
        return;
      }
      box.innerHTML = hits.map(function (r, i) {
        var cat = r.p.category ? '<span class="r-cat">' + esc(r.p.category) + '</span>' : '';
        return '<a class="r' + (i === 0 ? ' on' : '') + '" href="' + esc(r.p.url) + '">' +
          '<div class="r-t">' + mark(r.p.title, r.terms) + cat + '</div>' +
          '<div class="r-s">' + mark(snippet(r.p.body, r.terms), r.terms) + '</div></a>';
      }).join('') + '<div class="hint">↑↓ 选择 · Enter 打开 · Esc 关闭</div>';
      items = [].slice.call(box.querySelectorAll('.r'));
    }

    function move(dir) {
      if (!items.length) return;
      var cur = -1;
      items.forEach(function (el, i) { if (el.classList.contains('on')) cur = i; });
      cur = dir > 0 ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items.forEach(function (el) { el.classList.remove('on'); });
      items[cur].classList.add('on');
      items[cur].scrollIntoView({ block: 'nearest' });
    }

    q.addEventListener('input', function () { render(q.value); });
    q.addEventListener('focus', function () { if (q.value.trim()) render(q.value); });

    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        var on = box.querySelector('.r.on') || items[0];
        if (on) { e.preventDefault(); on.click(); }
      } else if (e.key === 'Escape') {
        box.hidden = true; q.blur();
      }
    });

    document.addEventListener('click', function (e) {
      if (!box.contains(e.target) && e.target !== q) box.hidden = true;
    });

    // 「/」或 Ctrl/Cmd+K 唤起检索
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) ||
        document.activeElement.isContentEditable;
      if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); q.select(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); q.focus(); q.select(); }
    });
  }

  /* ------------------------------------------- 进度条 / 目录高亮 / 回顶 */
  function initScroll() {
    var bar = document.getElementById('progress');
    var toTop = document.getElementById('to-top');
    var tocLinks = [].slice.call(document.querySelectorAll('.toc a'));
    var heads = tocLinks.map(function (a) {
      var id = decodeURIComponent((a.getAttribute('href') || '').replace(/^#/, ''));
      return document.getElementById(id);
    });
    var ticking = false;

    function update() {
      var doc = document.documentElement;
      var max = (doc.scrollHeight - window.innerHeight);
      var pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      if (bar) bar.style.width = pct + '%';
      if (toTop) {
        if (window.scrollY > 640) toTop.classList.add('show');
        else toTop.classList.remove('show');
      }

      if (heads.length) {
        var current = -1;
        for (var i = 0; i < heads.length; i++) {
          var h = heads[i];
          if (h && h.getBoundingClientRect().top <= 150) current = i;
        }
        tocLinks.forEach(function (a, i) { a.classList.toggle('on', i === current); });
      }
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();

    if (toTop) {
      toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  /* ---------------------------------------------------------------- 启动 */
  function boot() {
    initTheme();
    initDrawer();
    initNav();
    initSearch();
    initScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
