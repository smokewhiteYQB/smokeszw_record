/* 显微拉曼 · 考场速查台 —— 本地离线检索逻辑
 * 依赖 data.js 里的 window.EXAM_DATA：{lessons[], hw[], sols[]}
 * 无网络请求；所有跳转均为相对路径 + 锚点。
 */
(function () {
  'use strict';
  const D = window.EXAM_DATA;
  if (!D) { document.body.innerHTML = '<p style="padding:30px">data.js 未加载</p>'; return; }

  const LESSON_CH = { 1:1, 2:1, 3:2, 4:2, 5:3, 6:3, 7:3, 8:3, 9:4, 10:0, 11:5, 12:5, 13:5, 14:6, 15:6, 16:6, 17:0 };

  /* ---------- 建索引 ---------- */
  const docs = [];         // 统一文档
  const secById = {};      // lessonNo + '|' + secId -> secDoc

  D.lessons.forEach((L) => {
    let ch = LESSON_CH[L.no] || 0;
    L.sections.forEach((s, si) => {
      const m = (s.title || '').match(/第\s*([1-6])\s*章/);
      if (m) ch = Number(m[1]);
      const body = (s.body || '').replace(/\r/g, '');
      const chat = (s.chips || []).join(' ');
      const doc = {
        kind: 'sec', lessonNo: L.no, short: L.short, lessonTitle: L.title,
        secId: s.id, secNo: s.no, title: s.title, body: body, chips: chat,
        slides: s.slides || [], url: L.url, chapter: ch, idx: si,
        titleHay: (s.title || '').toLowerCase(),
        hay: ((s.title || '') + ' ' + chat + ' ' + body + ' ' +
              (s.slides || []).map((x) => x.title + ' ' + (x.alt || '')).join(' ')).toLowerCase()
      };
      docs.push(doc);
      secById[L.no + '|' + s.id] = doc;
    });
  });

  (D.hw || []).forEach((h) => {
    docs.push({
      kind: 'hw', lessonNo: h.lessonNo, short: h.lessonShort, lessonTitle: h.lessonShort,
      secId: h.secId, secNo: h.secNo, title: h.title, body: h.body || '',
      slides: h.slides || [], url: h.url, chapter: h.chapter, hwNo: h.hwNo, idx: 0,
      titleHay: (h.title || '').toLowerCase(),
      hay: ((h.title || '') + ' ' + (h.body || '') + ' 作业' + h.hwNo + ' 第' + h.chapter + '章 解答')
        .toLowerCase()
    });
  });

  (D.sols || []).forEach((s) => {
    docs.push({
      kind: 'sol', chapter: s.chapter, title: (s.file || '').replace(/\.docx$/, ''), body: s.text || '',
      lessonNo: 0, short: '', slides: [], url: '', idx: 0,
      titleHay: (s.file || '').toLowerCase(),
      hay: ((s.file || '') + ' ' + (s.text || '') + ' 第' + s.chapter + '章 课后作业解答').toLowerCase()
    });
  });

  // 课件页级文档
  const slideDocs = [];
  D.lessons.forEach((L) => {
    let ch = LESSON_CH[L.no] || 0;
    L.sections.forEach((s) => {
      const m = (s.title || '').match(/第\s*([1-6])\s*章/);
      if (m) ch = Number(m[1]);
      (s.slides || []).forEach((sl) => {
        slideDocs.push({
          kind: 'slide', lessonNo: L.no, short: L.short, lessonTitle: L.title,
          secId: s.id, secTitle: s.title, title: sl.title || ('课件第' + sl.no + '页'),
          alt: sl.alt || '', src: sl.src, page: sl.id, url: L.url, chapter: ch,
          titleHay: ((sl.title || '') + ' ' + (sl.alt || '')).toLowerCase(),
          hay: ((sl.title || '') + ' ' + (sl.alt || '') + ' ' + (s.title || '')).toLowerCase()
        });
      });
    });
  });

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const qInput = $('q'), main = $('main'), stat = $('stat');
  const pv = $('preview'), pvBody = $('pv-body'), pvTitle = $('pv-title');
  const lightbox = $('lightbox'), lightboxImg = $('lightbox-img');
  const TOC = $('p-toc'), HW = $('p-hw');

  let state = { q: '', kind: 'all', chapter: 0, results: [], active: -1, pv: null };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function tokens(q) {
    return q.trim().toLowerCase().split(/[\s,，、;；/]+/).filter((t) => t.length > 0);
  }

  function hl(text, toks) {
    let out = esc(text);
    toks.slice().sort((a, b) => b.length - a.length).forEach((t) => {
      const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('(' + safe + ')', 'gi'), '<mark>$1</mark>');
    });
    return out;
  }

  function snippet(text, toks, width) {
    text = (text || '').replace(/\s+/g, ' ');
    width = width || 190;
    let at = -1;
    for (const t of toks) { const i = text.toLowerCase().indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) at = 0;
    const start = Math.max(0, at - 70);
    const piece = text.slice(start, start + width);
    return (start > 0 ? '…' : '') + hl(piece, toks) + (start + width < text.length ? '…' : '');
  }

  function slideRange(slides) {
    if (!slides || !slides.length) return '';
    const ids = slides.map((s) => s.id);
    const a = Math.min.apply(null, ids), b = Math.max.apply(null, ids);
    return a === b ? ('课件 p' + a) : ('课件 p' + a + '–p' + b);
  }

  function score(doc, toks) {
    let sc = 0;
    for (const t of toks) {
      if (doc.titleHay.indexOf(t) >= 0) sc += 10;
      else if (doc.hay.indexOf(t) >= 0) sc += 3;
      else return -1;
    }
    if (doc.kind === 'sec') sc += 2;
    if (doc.kind === 'hw') sc += 1;
    return sc;
  }

  /* ---------- 搜索 ---------- */
  const STOP = { '什么': 1, '怎么': 1, '如何': 1, '为什': 1, '么是': 1, '的是': 1, '一个': 1, '这个': 1, '可以': 1, '是不': 1, '不是': 1, '以及': 1, '或者': 1, '如果': 1, '因为': 1, '所以': 1, '我们': 1, '他们': 1, '时候': 1, '问题': 1, '一下': 1, '请问': 1 };

  function bigrams(q) {
    const s = q.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
    const out = [];
    for (let i = 0; i < s.length - 1; i++) {
      const b = s.slice(i, i + 2);
      if (!STOP[b]) out.push(b);
    }
    return Array.from(new Set(out));
  }

  // 长句无空格时的兜底：按二元片段做 OR 匹配，至少命中 2 个片段
  function scoreOr(doc, toks) {
    let hit = 0, sc = 0;
    for (const t of toks) {
      if (doc.titleHay.indexOf(t) >= 0) { hit++; sc += 6; }
      else if (doc.hay.indexOf(t) >= 0) { hit++; sc += 2; }
    }
    if (hit < 2) return -1;
    return sc + hit;
  }

  function search(toks, fn) {
    const pool = docs.filter((d) => (state.kind === 'all' || d.kind === state.kind) &&
      (!state.chapter || d.chapter === state.chapter));
    const hits = pool.map((d) => ({ d: d, s: fn(d, toks) })).filter((x) => x.s >= 0);
    hits.sort((a, b) => b.s - a.s || a.d.lessonNo - b.d.lessonNo || a.d.idx - b.d.idx);
    const prim = hits.slice(0, 80).map((x) => x.d);

    let slides = [];
    if (state.kind === 'all' || state.kind === 'slide') {
      slides = slideDocs
        .filter((d) => !state.chapter || d.chapter === state.chapter)
        .map((d) => ({ d: d, s: fn(d, toks) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s || a.d.lessonNo - b.d.lessonNo || a.d.page - b.d.page)
        .slice(0, state.kind === 'slide' ? 200 : 40)
        .map((x) => x.d);
    }
    return { prim: prim, slides: slides };
  }

  function runSearch() {
    const toks = tokens(state.q);
    state.active = -1;
    if (!toks.length) { state.results = []; renderHome(); return; }

    let used = toks, note = '';
    let r = search(toks, score);
    if (!r.prim.length && !r.slides.length && state.q.replace(/\s/g, '').length >= 4) {
      const bg = bigrams(state.q);
      if (bg.length >= 2) {
        r = search(bg, scoreOr);
        if (r.prim.length || r.slides.length) { used = bg; note = '整句没命中，已拆成关键词：' + bg.join(' / '); }
      }
    }
    state.results = r.prim.concat(r.slides);
    renderResults(r.prim, r.slides, used, note);
  }

  /* ---------- 渲染：首页 ---------- */
  function renderHome() {
    const totalSec = docs.filter((d) => d.kind === 'sec').length;
    main.innerHTML =
      '<div class="hint">' +
        '<span class="tag"><b>' + D.lessons.length + '</b> 讲</span>' +
        '<span class="tag"><b>' + totalSec + '</b> 节讲述</span>' +
        '<span class="tag"><b>' + slideDocs.length + '</b> 页课件</span>' +
        '<span class="tag"><b>' + (D.hw || []).length + '</b> 道作业</span>' +
        '<span class="tag"><b>' + (D.sols || []).length + '</b> 段解答</span>' +
      '</div>' +
      '<div class="meta-line">考场动线：① 在搜索框输入题目关键词 → ② 看「课件 pX–pY」页码 → ③ 点「看课件」直达该页 / 点「预览」看整节讲解。</div>' +
      '<div class="grid">' + D.lessons.map((L) => {
        const chapter = LESSON_CH[L.no] || 0;
        const tag = L.no === 10 || L.no === 17 ? '习题课' : (chapter ? '第' + chapter + '章' : '');
        return '<div class="lcard" data-lesson="' + L.no + '">' +
          '<span class="n">第 ' + L.no + ' 课</span>' +
          '<h3>' + esc(L.sub || L.short) + '</h3>' +
          '<div class="d">' + (tag ? tag + ' · ' : '') + L.sections.length + ' 节 · ' + L.slideCount + ' 页</div>' +
        '</div>';
      }).join('') + '</div>';
    stat.textContent = '共 ' + docs.length + ' 条索引 + ' + slideDocs.length + ' 页课件';
    Array.prototype.forEach.call(main.querySelectorAll('.lcard'), (el) => {
      el.addEventListener('click', () => {
        const no = Number(el.getAttribute('data-lesson'));
        openTocLesson(no, true);
        switchTab('toc');
      });
    });
  }

  /* ---------- 渲染：结果 ---------- */
  function cardHtml(d, toks) {
    const isSlide = d.kind === 'slide';
    const badge = { sec: '讲述', slide: '课件页', hw: '作业', sol: '解答' }[d.kind];
    const head = isSlide
      ? ('第 ' + d.lessonNo + ' 课 · ' + esc(d.secTitle))
      : (d.kind === 'sol' ? ('第 ' + d.chapter + ' 章 作业解答')
        : ('第 ' + d.lessonNo + ' 课 · ' + (d.secNo ? '§' + esc(d.secNo) + ' ' : '') + (d.kind === 'hw' ? '' : '')));
    const pages = isSlide ? ('第 ' + d.page + ' 页') : slideRange(d.slides || []);
    let snip = snippet(d.kind === 'sol' ? d.body : (d.body || d.alt), toks);
    let thumbs = '';
    if (isSlide) {
      thumbs = '<div class="thumbs"><img loading="lazy" data-src="' + d.src + '" alt="' + esc(d.title) + '"></div>';
    } else if ((d.slides || []).length) {
      thumbs = '<div class="thumbs">' + d.slides.slice(0, 3).map((s) =>
        '<img loading="lazy" data-src="' + s.src + '" alt="' + esc(s.title || '') + '">').join('') + '</div>';
    }
    const acts = isSlide
      ? '<button class="mini primary" data-act="pv">预览所在节</button>' +
        '<button class="mini" data-act="page">跳到该页</button>'
      : (d.kind === 'sol'
        ? '<button class="mini primary" data-act="pv">阅读全文</button>'
        : '<button class="mini primary" data-act="pv">预览</button>' +
          '<button class="mini" data-act="open">打开该节</button>' +
          (d.kind === 'hw' ? '<button class="mini" data-act="hw">打开习题课</button>' : ''));

    return '<div class="card" data-kind="' + d.kind + '">' +
      '<div class="top"><span class="badge ' + d.kind + '">' + badge + '</span>' + head +
        (pages ? '<span class="pages">' + pages + '</span>' : '') + '</div>' +
      '<h3>' + hl(d.title, toks) + '</h3>' +
      '<div class="snip">' + snip + '</div>' +
      '<div class="acts">' + acts + '</div>' + thumbs +
    '</div>';
  }

  function renderResults(prim, slides, toks, note) {
    let html = '';
    if (note) html += '<div class="meta-line" style="color:#8a5a00">' + esc(note) + '</div>';
    if (prim.length) {
      html += '<div class="meta-line">讲述 / 作业 / 解答：' + prim.length + ' 条（按相关度）</div>' +
        prim.map((d) => cardHtml(d, toks)).join('');
    }
    if (slides.length) {
      html += '<div class="meta-line" style="margin-top:16px">课件页直击：' + slides.length + ' 页（点缩略图看大图）</div>' +
        slides.map((d) => cardHtml(d, toks)).join('');
    }
    if (!prim.length && !slides.length) {
      html = '<div class="empty">没有命中。试试更短的关键词（如「选择定则」「噪声」「退火」），或把类型切换成「全部」。</div>';
    }
    main.innerHTML = html;
    stat.textContent = '结果 ' + (prim.length + slides.length) + ' 条';

    Array.prototype.forEach.call(main.querySelectorAll('img[data-src]'), (img) => {
      img.src = img.getAttribute('data-src');
      img.addEventListener('click', (e) => { e.stopPropagation(); showLightbox(img.src); });
    });

    Array.prototype.forEach.call(main.querySelectorAll('.card'), (card, i) => {
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        const act = btn ? btn.getAttribute('data-act') : 'pv';
        setActive(i);
        const d = state.results[i];
        if (act === 'open' || act === 'hw') window.open(d.url, '_blank');
        else if (act === 'page') window.open(d.url + '#slide-' + d.page, '_blank');
        else previewDoc(d);
      });
    });
  }

  function setActive(i) {
    state.active = i;
    Array.prototype.forEach.call(main.querySelectorAll('.card'), (c, j) => c.classList.toggle('active', j === i));
  }

  /* ---------- 预览栏 ---------- */
  function showLightbox(src) { lightboxImg.src = src; lightbox.classList.add('on'); }

  function metaLine(s) {
    const chips = (s.chips || []).filter((c) => !/^课件/.test(c));
    const range = slideRange(s.slides || []);
    return chips.concat(range ? [range] : []).join(' · ');
  }

  function previewDoc(d) {
    if (d.kind === 'slide') {
      const sec = secById[d.lessonNo + '|' + d.secId];
      state.pv = sec ? { lessonNo: d.lessonNo, idx: sec.idx } : null;
      pvTitle.textContent = '第 ' + d.lessonNo + ' 课 · ' + d.title;
      pvBody.innerHTML =
        '<div class="ptitle">' + esc(d.title) + '</div>' +
        '<div class="pmeta">第 ' + d.page + ' 页 · ' + esc(d.secTitle) + '</div>' +
        '<div class="slides"><img src="' + d.src + '" alt=""><div class="cap">' + esc(d.alt) + '</div></div>' +
        (sec ? '<div class="ptext">' + sec.body.split('\n').map((p) => '<p>' + esc(p) + '</p>').join('') + '</div>' : '');
      pv.classList.remove('hide');
      return;
    }
    if (d.kind === 'sol' || d.kind === 'hw') {
      state.pv = null;
      pvTitle.textContent = d.kind === 'sol' ? '作业解答' : '作业讲解';
      pvBody.innerHTML = '<div class="ptitle">' + esc(d.title) + '</div>' +
        '<div class="pmeta">第 ' + d.chapter + ' 章</div>' +
        '<div class="ptext">' + (d.body || '').split('\n').map((p) => '<p>' + esc(p) + '</p>').join('') + '</div>' +
        (d.kind === 'hw' ? '<div class="acts" style="margin-top:10px"><button class="mini primary" id="pv-hwopen">在新窗口打开该习题课</button></div>' : '');
      pv.classList.remove('hide');
      const b = $('pv-hwopen');
      if (b) b.addEventListener('click', () => window.open(d.url, '_blank'));
      return;
    }
    // sec
    const L = D.lessons[d.lessonNo - 1];
    const s = L.sections[d.idx];
    state.pv = { lessonNo: d.lessonNo, idx: d.idx };
    pvTitle.textContent = '第 ' + d.lessonNo + ' 课 · ' + s.title;
    pvBody.innerHTML =
      '<div class="ptitle">' + esc(s.title) + '</div>' +
      '<div class="pmeta">' + esc(metaLine(s)) + '</div>' +
      '<div class="slides">' + (s.slides || []).map((sl) =>
        '<img loading="lazy" src="' + sl.src + '" alt=""><div class="cap">p' + sl.id + ' ' + esc(sl.title || '') + '</div>').join('') + '</div>' +
      '<div class="ptext">' + (s.body || '').split('\n').map((p) => '<p>' + esc(p) + '</p>').join('') + '</div>';
    pv.classList.remove('hide');
    pvBody.scrollTop = 0;
  }

  function pvMove(step) {
    if (!state.pv) return;
    const L = D.lessons[state.pv.lessonNo - 1];
    let idx = state.pv.idx + step;
    if (idx < 0 || idx >= L.sections.length) return;
    const s = L.sections[idx];
    const doc = secById[L.no + '|' + s.id];
    if (doc) previewDoc(doc);
  }

  /* ---------- 左栏：目录 ---------- */
  function renderToc() {
    TOC.innerHTML = D.lessons.map((L) => {
      const ch = LESSON_CH[L.no] || 0;
      const tag = L.no === 10 || L.no === 17 ? '习题课' : (ch ? '第' + ch + '章' : '');
      return '<div class="lesson" data-lesson="' + L.no + '">' +
        '<div class="lh"><span class="no">' + L.no + '</span><span class="lt">' + esc(L.sub || L.short) +
          '</span></div>' +
        '<div class="secs">' + L.sections.map((s) =>
          '<a href="#" data-sec="' + L.no + '|' + s.id + '">' + esc(s.title) +
          (s.slides && s.slides.length ? '<span class="p">p' + Math.min.apply(null, s.slides.map((x) => x.id)) +
            (s.slides.length > 1 ? '–' + Math.max.apply(null, s.slides.map((x) => x.id)) : '') + '</span>' : '') +
          '</a>').join('') + '</div></div>';
    }).join('');

    Array.prototype.forEach.call(TOC.querySelectorAll('.lh'), (el) => {
      el.addEventListener('click', () => el.parentNode.classList.toggle('open'));
    });
    Array.prototype.forEach.call(TOC.querySelectorAll('.secs a'), (a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const d = secById[a.getAttribute('data-sec')];
        if (d) previewDoc(d);
      });
    });
  }

  function openTocLesson(no, expand) {
    Array.prototype.forEach.call(TOC.querySelectorAll('.lesson'), (el) => {
      const on = Number(el.getAttribute('data-lesson')) === no;
      if (on && expand) el.classList.add('open');
    });
    const target = TOC.querySelector('.lesson[data-lesson="' + no + '"]');
    if (target) target.scrollIntoView({ block: 'start' });
  }

  /* ---------- 左栏：作业速查 ---------- */
  function renderHw() {
    const groups = {};
    (D.hw || []).forEach((h) => { (groups[h.chapter] = groups[h.chapter] || []).push(h); });
    let html = '';
    [1, 2, 3, 4, 5, 6].forEach((ch) => {
      const list = groups[ch];
      if (!list) return;
      html += '<div class="hwgroup"><h4>第 ' + ch + ' 章</h4>' + list.map((h) =>
        '<div class="hwitem" data-hw="' + h.lessonNo + '|' + h.secId + '">' +
          '<div class="t">作业' + h.hwNo + '：' + esc(h.title.replace(/^作业\d+[：:]\s*/, '')) + '</div>' +
          '<div class="s">' + esc((h.body || '').slice(0, 62)) + '…</div>' +
          '<div class="acts">' +
            '<button class="mini primary" data-act="pv">讲解</button>' +
            '<button class="mini" data-act="open">习题课</button>' +
            (h.slides && h.slides.length ? '<button class="mini" data-act="page">课件页</button>' : '') +
          '</div>' +
        '</div>').join('') + '</div>';
    });
    html += '<div class="hwgroup"><h4>六章作业全解</h4>' +
      (D.sols || []).map((s) =>
        '<div class="hwitem" data-sol="' + s.chapter + '">' +
          '<div class="t">第 ' + s.chapter + ' 章 解答</div>' +
          '<div class="acts"><button class="mini primary" data-act="pv">阅读</button></div>' +
        '</div>').join('') + '</div>';
    HW.innerHTML = html || '<div class="empty">没有作业数据</div>';

    Array.prototype.forEach.call(HW.querySelectorAll('.hwitem'), (el) => {
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        const act = btn ? btn.getAttribute('data-act') : 'pv';
        const secKey = el.getAttribute('data-hw');
        const solCh = el.getAttribute('data-sol');
        if (secKey) {
          const d = secById[secKey];
          if (!d) return;
          if (act === 'open') window.open(d.url, '_blank');
          else if (act === 'page') {
            const sl = (d.slides || [])[0];
            if (sl) window.open(d.url + '#slide-' + sl.id, '_blank');
          } else previewDoc(d);
        } else if (solCh) {
          const s = (D.sols || []).find((x) => String(x.chapter) === solCh);
          if (s) previewDoc({ kind: 'sol', chapter: s.chapter, title: (s.file || '').replace(/\.docx$/, ''), body: s.text, url: '' });
        }
      });
    });
  }

  /* ---------- 标签页 / 事件 ---------- */
  function switchTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), (b) =>
      b.classList.toggle('on', b.getAttribute('data-tab') === name));
    TOC.classList.toggle('hide', name !== 'toc');
    HW.classList.toggle('hide', name !== 'hw');
    $('p-help').classList.toggle('hide', name !== 'help');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), (b) => {
    b.addEventListener('click', () => switchTab(b.getAttribute('data-tab')));
  });

  Array.prototype.forEach.call(document.querySelectorAll('.chipbtn[data-kind]'), (b) => {
    b.addEventListener('click', () => {
      Array.prototype.forEach.call(document.querySelectorAll('.chipbtn[data-kind]'), (x) => x.classList.remove('on'));
      b.classList.add('on');
      state.kind = b.getAttribute('data-kind');
      runSearch();
    });
  });

  $('chapter').addEventListener('change', (e) => { state.chapter = Number(e.target.value); runSearch(); });

  let timer = null;
  qInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = qInput.value; runSearch(); }, 90);
  });

  $('pv-close').addEventListener('click', () => pv.classList.add('hide'));
  $('pv-prev').addEventListener('click', () => pvMove(-1));
  $('pv-next').addEventListener('click', () => pvMove(1));
  $('pv-open').addEventListener('click', () => {
    if (!state.pv) return;
    const L = D.lessons[state.pv.lessonNo - 1];
    const s = L.sections[state.pv.idx];
    window.open(L.url + '#' + s.id, '_blank');
  });
  lightbox.addEventListener('click', () => lightbox.classList.remove('on'));

  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === '/' && document.activeElement !== qInput) { e.preventDefault(); qInput.focus(); qInput.select(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') { e.preventDefault(); qInput.focus(); qInput.select(); return; }
    if (k === 'Escape') {
      if (lightbox.classList.contains('on')) { lightbox.classList.remove('on'); return; }
      if (state.q) { qInput.value = ''; state.q = ''; runSearch(); return; }
      pv.classList.add('hide');
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (!state.results.length) return;
      e.preventDefault();
      const n = state.results.length;
      let i = state.active < 0 ? (k === 'ArrowDown' ? 0 : n - 1) : state.active + (k === 'ArrowDown' ? 1 : -1);
      i = Math.max(0, Math.min(n - 1, i));
      setActive(i);
      const el = main.querySelectorAll('.card')[i];
      if (el) el.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (k === 'Enter' && state.active >= 0) {
      const d = state.results[state.active];
      if (!d) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) window.open(d.url + (d.kind === 'slide' ? '#slide-' + d.page : ''), '_blank');
      else previewDoc(d);
    }
  });

  /* ---------- 启动 ---------- */
  renderToc();
  renderHw();
  renderHome();
})();
