(function(){
  var idx = window.__WIKI_INDEX__ || [];
  var q = document.getElementById('q');
  var box = document.getElementById('results');
  if(!q || !box) return;

  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function mark(text, terms){
    var out = esc(text);
    terms.forEach(function(t){
      if(t.length < 1) return;
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')','gi');
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
    var terms = raw.trim().split(/\s+/).filter(Boolean);
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
