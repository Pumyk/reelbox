/* ============================================================
   Reelbox — app logic
   Catalogue: Internet Archive public-domain film & TV collections
   ============================================================ */

'use strict';

/* ------------------------------------------------------------
   Config
   ------------------------------------------------------------ */
const CFG = {
  API: 'https://archive.org/advancedsearch.php',
  META: 'https://archive.org/metadata/',
  IMG: 'https://archive.org/services/img/',
  FILE: 'https://archive.org/download/',
  CACHE: 'reelbox-media-v1',
  PAGE: 24,
};

const MOVIE_GENRES = [
  { id: 'all',      label: 'All',       q: 'collection:feature_films AND mediatype:movies AND format:"h.264"' },
  { id: 'action',   label: 'Action',    q: 'collection:feature_films AND subject:"action" AND mediatype:movies AND format:"h.264"' },
  { id: 'comedy',   label: 'Comedy',    q: 'collection:feature_films AND subject:"comedy" AND mediatype:movies AND format:"h.264"' },
  { id: 'drama',    label: 'Drama',     q: 'collection:feature_films AND subject:"drama" AND mediatype:movies AND format:"h.264"' },
  { id: 'horror',   label: 'Horror',    q: 'collection:feature_films AND subject:"horror" AND mediatype:movies AND format:"h.264"' },
  { id: 'scifi',    label: 'Sci-Fi',    q: 'collection:feature_films AND subject:"science fiction" AND mediatype:movies AND format:"h.264"' },
  { id: 'noir',     label: 'Film Noir', q: 'collection:film_noir AND mediatype:movies AND format:"h.264"' },
  { id: 'western',  label: 'Western',   q: 'collection:feature_films AND subject:"western" AND mediatype:movies AND format:"h.264"' },
  { id: 'mystery',  label: 'Mystery',   q: 'collection:feature_films AND subject:"mystery" AND mediatype:movies AND format:"h.264"' },
  { id: 'anime',    label: 'Animation', q: 'collection:animationandcartoons AND mediatype:movies AND format:"h.264"' },
];

const SERIES_GENRES = [
  { id: 'all',    label: 'All',     q: 'collection:classic_tv AND mediatype:movies AND format:"h.264"' },
  { id: 'drama',  label: 'Drama',   q: 'collection:classic_tv AND subject:"drama" AND mediatype:movies AND format:"h.264"' },
  { id: 'comedy', label: 'Comedy',  q: 'collection:classic_tv AND subject:"comedy" AND mediatype:movies AND format:"h.264"' },
  { id: 'west',   label: 'Western', q: 'collection:classic_tv AND subject:"western" AND mediatype:movies AND format:"h.264"' },
  { id: 'crime',  label: 'Crime',   q: 'collection:classic_tv AND subject:"crime" AND mediatype:movies AND format:"h.264"' },
  { id: 'kids',   label: 'Kids',    q: 'collection:classic_tv AND subject:"children" AND mediatype:movies AND format:"h.264"' },
];

/* ------------------------------------------------------------
   State
   ------------------------------------------------------------ */
const S = {
  view: 'home',
  prevView: 'home',
  movieGenre: 'all',
  seriesGenre: 'all',
  current: null,          // current detail item
  player: { item: null, files: [], activeFile: null, url: null },
  downloads: {},          // id -> record
  heroIdx: 0,
  heroTimer: null,
};

/* ------------------------------------------------------------
   Persistence
   ------------------------------------------------------------ */
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('rb_' + k); return v ? JSON.parse(v) : d; }
    catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('rb_' + k, JSON.stringify(v)); } catch {}
  },
  del(k) { try { localStorage.removeItem('rb_' + k); } catch {} },
};

let watchlist = store.get('watchlist', []);   // [{id,title,year,thumb}]
let history   = store.get('history', []);     // [{id,title,year,thumb,at}]
let prefs     = store.get('prefs', { quality: 'auto', autoplay: true, wifiOnly: false });

const saveWatchlist = () => store.set('watchlist', watchlist);
const saveHistory   = () => store.set('history', history);
const savePrefs     = () => store.set('prefs', prefs);

/* ------------------------------------------------------------
   Utilities
   ------------------------------------------------------------ */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtBytes(b) {
  if (!b) return '—';
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b > 1e6) return Math.round(b / 1e6) + ' MB';
  return Math.round(b / 1e3) + ' KB';
}

function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('div', 'toast'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function thumbUrl(id) { return `${CFG.IMG}${encodeURIComponent(id)}`; }

/* ------------------------------------------------------------
   Archive.org API
   ------------------------------------------------------------ */
async function archiveSearch(query, rows = CFG.PAGE, page = 1, sort = 'downloads desc') {
  const params = new URLSearchParams();
  params.set('q', query);
  ['identifier', 'title', 'year', 'downloads', 'subject', 'description']
    .forEach(f => params.append('fl[]', f));
  params.append('sort[]', sort);
  params.set('rows', rows);
  params.set('page', page);
  params.set('output', 'json');

  const res = await fetch(`${CFG.API}?${params}`);
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();
  const docs = data?.response?.docs || [];
  return docs
    .filter(d => d.identifier)
    .map(d => ({
      id: d.identifier,
      title: d.title || d.identifier,
      year: d.year || null,
      downloads: d.downloads || 0,
      subject: d.subject || null,
      description: d.description || '',
    }));
}

async function archiveMeta(id) {
  const res = await fetch(CFG.META + encodeURIComponent(id));
  if (!res.ok) throw new Error('Metadata failed');
  const d = await res.json();
  const m = d.metadata || {};

  const videoFiles = (d.files || [])
    .filter(f => /\.(mp4|m4v|webm|ogv)$/i.test(f.name || ''))
    .map(f => ({
      name: f.name,
      format: f.format || '',
      size: parseInt(f.size || '0', 10) || 0,
      height: parseInt(f.height || '0', 10) || 0,
      width: parseInt(f.width || '0', 10) || 0,
      url: `${CFG.FILE}${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`,
    }))
    .sort((a, b) => b.size - a.size);

  return {
    id,
    title: m.title || id,
    description: typeof m.description === 'string'
      ? m.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '',
    year: m.year || m.date || null,
    creator: m.creator || null,
    subject: Array.isArray(m.subject) ? m.subject : (m.subject ? [m.subject] : []),
    license: m.licenseurl || m.rights || null,
    runtime: m.runtime || null,
    files: videoFiles,
  };
}

/* Build quality options from available files */
function qualityOptions(files) {
  if (!files.length) return [];
  const best = files[0];
  const opts = [];

  opts.push({
    id: 'best',
    label: 'Best available',
    sub: best.format || 'Highest quality',
    size: best.size,
    file: best,
  });

  // A distinctly smaller file = a genuine lower tier
  const smallest = files[files.length - 1];
  if (files.length > 1 && smallest.size > 0 && smallest.size < best.size * 0.92) {
    opts.push({
      id: 'saver',
      label: 'Data saver',
      sub: smallest.format || 'Smaller file',
      size: smallest.size,
      file: smallest,
    });
  }

  // Any middle tiers
  files.slice(1, -1).forEach((f, i) => {
    if (f.size > 0 && f.size < best.size && f.size > smallest.size) {
      opts.push({
        id: 'mid' + i,
        label: f.height ? `${f.height}p` : (f.format || 'Standard'),
        sub: f.format || '',
        size: f.size,
        file: f,
      });
    }
  });

  return opts;
}

/* ------------------------------------------------------------
   Download manager
   ------------------------------------------------------------ */
const DL = {
  key(id, qid) { return `${id}::${qid}`; },

  record(id, qid) { return S.downloads[this.key(id, qid)]; },

  async loadAll() {
    S.downloads = store.get('downloads', {});
    Object.values(S.downloads).forEach(d => { if (d.status === 'downloading') d.status = 'paused'; });
    store.set('downloads', S.downloads);
    this.refreshStorage();
    if (S.view === 'downloads') renderDownloads();
  },

  async refreshStorage() {
    let total = 0;
    Object.values(S.downloads).forEach(d => {
      if (d.status === 'done' || d.status === 'saved') total += d.size || 0;
    });
    const pill = $('#storage-pill');
    if (pill) pill.textContent = total ? fmtBytes(total) : 'Empty';
    const stat = $('#stat-downloads');
    if (stat) stat.textContent = Object.values(S.downloads)
      .filter(d => d.status === 'done' || d.status === 'saved').length;
  },

  async start(item, opt) {
    const k = this.key(item.id, opt.id);
    if (S.downloads[k] && (S.downloads[k].status === 'done' || S.downloads[k].status === 'saved')) {
      toast('Already downloaded');
      return;
    }

    const rec = {
      key: k,
      id: item.id,
      qid: opt.id,
      title: item.title,
      year: item.year || null,
      thumb: thumbUrl(item.id),
      url: opt.file.url,
      size: opt.size,
      label: opt.label,
      status: 'downloading',
      progress: 0,
      at: Date.now(),
    };
    S.downloads[k] = rec;
    store.set('downloads', S.downloads);
    renderDownloads();
    this.refreshStorage();

    try {
      const cache = await caches.open(CFG.CACHE);

      let res;
      try {
        res = await fetch(rec.url, { mode: 'cors' });
      } catch (corsErr) {
        // Archive.org serves media without CORS headers, so an in-app cache
        // is impossible from the browser. Fall back to the device downloader,
        // which saves the file properly and works on every Android browser.
        throw { code: 'CORS' };
      }

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const total = parseInt(res.headers.get('content-length') || '0', 10) || rec.size || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;

        const pct = total ? Math.min(99, (received / total) * 100) : 0;
        rec.progress = pct;
        S.downloads[k].progress = pct;
        this.paint(k);
      }

      const blob = new Blob(chunks, {
        type: res.headers.get('content-type') || 'video/mp4',
      });

      const stored = new Response(blob, {
        headers: {
          'Content-Type': blob.type,
          'Content-Length': String(blob.size),
          'Accept-Ranges': 'bytes',
        },
      });
      await cache.put(rec.url, stored);

      rec.status = 'done';
      rec.progress = 100;
      rec.size = blob.size;
      S.downloads[k] = rec;
      store.set('downloads', S.downloads);
      renderDownloads();
      this.refreshStorage();
      toast('Downloaded · ' + item.title);
    } catch (err) {
      if (err && err.code === 'CORS') {
        // Native download: the OS saves the file to the Downloads folder.
        rec.status = 'saved';
        rec.progress = 100;
        S.downloads[k] = rec;
        store.set('downloads', S.downloads);
        renderDownloads();
        DL.refreshStorage();
        DL.nativeDownload(rec);
        toast('Saving to your device…');
        return;
      }
      console.warn('[download]', err);
      rec.status = 'failed';
      S.downloads[k] = rec;
      store.set('downloads', S.downloads);
      renderDownloads();
      toast('Download failed — try another quality');
    }
  },

  nativeDownload(rec) {
    try {
      const a = document.createElement('a');
      a.href = rec.url;
      a.download = (rec.title || 'video').replace(/[^\w\- ]+/g, '') + '.mp4';
      a.rel = 'noopener';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 600);
    } catch {
      window.open(rec.url, '_blank');
    }
  },

  paint(k) {
    const bar = document.querySelector(`[data-dl-bar="${CSS.escape(k)}"]`);
    const sub = document.querySelector(`[data-dl-sub="${CSS.escape(k)}"]`);
    const rec = S.downloads[k];
    if (!rec) return;
    if (bar) bar.style.width = rec.progress + '%';
    if (sub) {
      sub.textContent = rec.status === 'failed'
        ? 'Failed — tap to retry'
        : `Downloading ${Math.round(rec.progress)}%`;
    }
  },

  async remove(k) {
    const rec = S.downloads[k];
    if (!rec) return;
    try {
      const cache = await caches.open(CFG.CACHE);
      await cache.delete(rec.url);
    } catch {}
    delete S.downloads[k];
    store.set('downloads', S.downloads);
    renderDownloads();
    this.refreshStorage();
    toast('Removed from downloads');
  },

  async resolve(rec) {
    try {
      const cache = await caches.open(CFG.CACHE);
      const hit = await cache.match(rec.url);
      if (hit) {
        const blob = await hit.blob();
        return URL.createObjectURL(blob);
      }
    } catch {}
    return rec.url;
  },
};

/* ------------------------------------------------------------
   Watchlist / history
   ------------------------------------------------------------ */
function inWatchlist(id) { return watchlist.some(w => w.id === id); }

function toggleWatchlist(item) {
  if (inWatchlist(item.id)) {
    watchlist = watchlist.filter(w => w.id !== item.id);
    toast('Removed from watchlist');
  } else {
    watchlist.unshift({
      id: item.id,
      title: item.title,
      year: item.year || null,
      thumb: thumbUrl(item.id),
    });
    toast('Added to watchlist');
  }
  saveWatchlist();
  refreshWatchUI();
}

function pushHistory(item) {
  history = history.filter(h => h.id !== item.id);
  history.unshift({
    id: item.id,
    title: item.title,
    year: item.year || null,
    thumb: thumbUrl(item.id),
    at: Date.now(),
  });
  history = history.slice(0, 60);
  saveHistory();
}

function refreshWatchUI() {
  const isIn = S.current && inWatchlist(S.current.id);
  const btn = $('#detail-watch');
  if (btn) {
    btn.innerHTML = isIn
      ? `<svg viewBox="0 0 24 24"><path d="M4.5 12.5 10 18l9.5-11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    btn.style.color = isIn ? 'var(--gold)' : '';
  }
  const st = $('#stat-watchlist');
  if (st) st.textContent = watchlist.length;
  const sh = $('#stat-history');
  if (sh) sh.textContent = history.length;
}

/* ------------------------------------------------------------
   Components
   ------------------------------------------------------------ */
function posterCard(item, opts = {}) {
  const card = el('button', 'poster');
  card.dataset.id = item.id;

  const downloaded = Object.values(S.downloads).some(
    d => d.id === item.id && (d.status === 'done' || d.status === 'saved')
  );

  const img = el('div', 'poster-img');
  img.innerHTML = `
    <img loading="lazy" src="${thumbUrl(item.id)}" alt=""
         onerror="this.style.display='none'">
    ${downloaded ? `<div class="dl-dot"><svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>` : ''}
  `;

  card.appendChild(img);
  card.appendChild(el('div', 'poster-name', esc(item.title)));
  if (item.year) card.appendChild(el('div', 'poster-sub', esc(String(item.year).slice(0, 4))));

  card.addEventListener('click', () => openDetail(item));
  return card;
}

function skeletonRow(n = 6) {
  const track = el('div', 'row-track');
  for (let i = 0; i < n; i++) track.appendChild(el('div', 'sk sk-poster'));
  return track;
}

function rowSection(title, items, opts = {}) {
  const wrap = el('div');
  const head = el('div', 'section-head', `<h2>${esc(title)}</h2>`);

  if (opts.onMore) {
    const more = el('button', 'link-btn', 'See all');
    more.addEventListener('click', opts.onMore);
    head.appendChild(more);
  }
  wrap.appendChild(head);

  const track = el('div', `row-track${opts.wrap ? ' wrap' : ''}`);
  items.forEach(it => track.appendChild(posterCard(it)));
  wrap.appendChild(track);
  return wrap;
}

/* ------------------------------------------------------------
   Home
   ------------------------------------------------------------ */
async function renderHome() {
  const rowsWrap = $('#home-rows');
  const heroWrap = $('#home-hero');

  if (!rowsWrap.dataset.loaded) {
    heroWrap.innerHTML = '<div class="sk sk-hero"></div>';
    const sk1 = rowSection('Trending now', []);
    sk1.replaceChildren(
      el('div', 'section-head', '<h2>Trending now</h2>'),
      skeletonRow()
    );
    rowsWrap.innerHTML = '';
    rowsWrap.appendChild(sk1);
  }

  try {
    const [trending, classics, noir, comedy, animation, tv] = await Promise.all([
      archiveSearch('collection:feature_films AND mediatype:movies AND format:"h.264"', 18, 1, 'downloads desc'),
      archiveSearch('collection:feature_films AND mediatype:movies AND format:"h.264"', 18, 1, 'year desc'),
      archiveSearch('collection:film_noir AND mediatype:movies AND format:"h.264"', 18, 1, 'downloads desc'),
      archiveSearch('collection:feature_films AND subject:"comedy" AND mediatype:movies AND format:"h.264"', 18, 1, 'downloads desc'),
      archiveSearch('collection:animationandcartoons AND mediatype:movies AND format:"h.264"', 18, 1, 'downloads desc'),
      archiveSearch('collection:classic_tv AND mediatype:movies AND format:"h.264"', 18, 1, 'downloads desc'),
    ]);

    /* --- Hero carousel --- */
    const heroItems = trending.slice(0, 5);
    heroWrap.innerHTML = '';

    if (heroItems.length) {
      const slide = el('div', 'hero-slide');
      slide.innerHTML = `
        <img class="hero-bg" id="hero-img" src="${thumbUrl(heroItems[0].id)}" alt="">
        <div class="hero-content">
          <div class="hero-badge">Featured</div>
          <div class="hero-title" id="hero-title">${esc(heroItems[0].title)}</div>
          <div class="hero-meta" id="hero-meta">
            ${heroItems[0].year ? `<span>${esc(String(heroItems[0].year).slice(0, 4))}</span><i class="dot"></i>` : ''}
            <span>Public domain</span><i class="dot"></i>
            <span>HD</span>
          </div>
          <div class="hero-actions">
            <button class="btn-play" id="hero-play">
              <svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5L7 4.5Z" fill="currentColor"/></svg>
              Play now
            </button>
            <button class="btn-ghost" id="hero-info">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v6M12 7.6v.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              Info
            </button>
          </div>
        </div>
      `;
      heroWrap.appendChild(slide);

      const dots = el('div', 'hero-dots');
      heroItems.forEach((_, i) => {
        const d = el('i');
        if (i === 0) d.className = 'on';
        dots.appendChild(d);
      });
      heroWrap.appendChild(dots);

      const setHero = (i) => {
        S.heroIdx = i;
        const it = heroItems[i];
        $('#hero-img').src = thumbUrl(it.id);
        $('#hero-title').textContent = it.title;
        $('#hero-meta').innerHTML = `
          ${it.year ? `<span>${esc(String(it.year).slice(0, 4))}</span><i class="dot"></i>` : ''}
          <span>Public domain</span><i class="dot"></i><span>HD</span>
        `;
        $$('.hero-dots i').forEach((d, j) => d.className = j === i ? 'on' : '');
        $('#hero-play').onclick = () => playItem(it);
        $('#hero-info').onclick = () => openDetail(it);
      };

      setHero(0);
      clearInterval(S.heroTimer);
      S.heroTimer = setInterval(() => {
        if (S.view !== 'home') return;
        setHero((S.heroIdx + 1) % heroItems.length);
      }, 6500);
    }

    /* --- Rows --- */
    rowsWrap.innerHTML = '';
    rowsWrap.dataset.loaded = '1';

    const cont = history.slice(0, 12);
    if (cont.length) {
      rowsWrap.appendChild(rowSection('Continue watching', cont, { wrap: false }));
    }

    rowsWrap.appendChild(rowSection('Trending now', trending, {
      onMore: () => go('movies'),
    }));
    rowsWrap.appendChild(rowSection('New in the archive', classics, {
      onMore: () => go('movies'),
    }));
    if (noir.length) rowsWrap.appendChild(rowSection('Film noir', noir, { onMore: () => go('movies') }));
    if (comedy.length) rowsWrap.appendChild(rowSection('Comedy', comedy, { onMore: () => go('movies') }));
    if (animation.length) rowsWrap.appendChild(rowSection('Animation', animation, { onMore: () => go('movies') }));
    if (tv.length) rowsWrap.appendChild(rowSection('Classic TV', tv, { onMore: () => go('series') }));

    const watchRow = el('div');
    if (watchlist.length) {
      watchRow.appendChild(rowSection('My watchlist', watchlist, { wrap: false }));
      rowsWrap.appendChild(watchRow);
    }
  } catch (err) {
    console.error(err);
    rowsWrap.innerHTML = '<div class="empty">Could not load catalogue. Check your connection and try again.</div>';
    heroWrap.innerHTML = '';
  }
}

/* ------------------------------------------------------------
   Browse grids
   ------------------------------------------------------------ */
function buildChips(container, genres, activeId, onPick) {
  container.innerHTML = '';
  genres.forEach(g => {
    const c = el('button', `chip${g.id === activeId ? ' on' : ''}`, esc(g.label));
    c.addEventListener('click', () => {
      $$('.chip', container).forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      onPick(g);
    });
    container.appendChild(c);
  });
}

async function renderGrid(gridEl, genre, setLoading) {
  gridEl.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const p = el('div', 'poster');
    p.appendChild(el('div', 'sk', ''));
    $('.sk', p).style.cssText = 'width:100%;aspect-ratio:2/3;border-radius:11px';
    gridEl.appendChild(p);
  }

  try {
    const items = await archiveSearch(genre.q, 30, 1, 'downloads desc');
    gridEl.innerHTML = '';
    if (!items.length) {
      gridEl.innerHTML = '<div class="empty" style="grid-column:1/-1">Nothing here yet</div>';
      return;
    }
    items.forEach(it => gridEl.appendChild(posterCard(it)));
  } catch {
    gridEl.innerHTML = '<div class="empty" style="grid-column:1/-1">Failed to load</div>';
  }
}

function initMovies() {
  buildChips($('#movie-chips'), MOVIE_GENRES, S.movieGenre, g => {
    S.movieGenre = g.id;
    renderGrid($('#movie-grid'), g, true);
  });
  renderGrid($('#movie-grid'), MOVIE_GENRES[0], true);
}

function initSeries() {
  buildChips($('#series-chips'), SERIES_GENRES, S.seriesGenre, g => {
    S.seriesGenre = g.id;
    renderGrid($('#series-grid'), g, true);
  });
  renderGrid($('#series-grid'), SERIES_GENRES[0], true);
}

/* ------------------------------------------------------------
   Detail
   ------------------------------------------------------------ */
async function openDetail(item) {
  S.prevView = S.view === 'detail' ? S.prevView : S.view;
  S.current = item;
  S.view = 'detail';

  showView('detail');
  const body = $('#detail-body');

  body.innerHTML = `
    <div class="detail-hero">
      <img class="detail-backdrop" src="${thumbUrl(item.id)}" alt="">
      <div class="detail-head">
        <img class="detail-poster" src="${thumbUrl(item.id)}" alt="">
        <div class="detail-headtext">
          <div class="detail-title">${esc(item.title)}</div>
          <div class="detail-badges" id="detail-badges">
            ${item.year ? `<span class="badge">${esc(String(item.year).slice(0, 4))}</span>` : ''}
            <span class="badge gold">Public domain</span>
          </div>
        </div>
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn-play" id="detail-play">
        <svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5L7 4.5Z" fill="currentColor"/></svg>
        Play
      </button>
      <button class="btn-ghost" id="detail-watch"></button>
      <button class="btn-ghost" id="detail-download">
        <svg viewBox="0 0 24 24"><path d="M12 3v11m0 0 4-4m-4 4-4-4M4.5 17.5v1.5A2 2 0 0 0 6.5 21h11a2 2 0 0 0 2-2v-1.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

    <div class="detail-body">
      <div class="detail-desc clamped" id="detail-desc">Loading details…</div>
      <div class="meta-table" id="detail-meta"></div>
    </div>
  `;

  refreshWatchUI();

  $('#detail-play').addEventListener('click', () => playItem(item));
  $('#detail-watch').addEventListener('click', () => toggleWatchlist(item));
  $('#detail-download').addEventListener('click', () => openDownloadSheet(item));

  try {
    const meta = await archiveMeta(item.id);

    const desc = $('#detail-desc');
    desc.textContent = meta.description || 'No description available for this title.';
    if (meta.description && meta.description.length > 220) {
      const more = el('button', 'more-btn', 'Read more');
      more.addEventListener('click', () => {
        desc.classList.toggle('clamped');
        more.textContent = desc.classList.contains('clamped') ? 'Read more' : 'Show less';
      });
      desc.after(more);
    }

    const badges = $('#detail-badges');
    if (meta.subject.length) {
      meta.subject.slice(0, 2).forEach(s => {
        badges.appendChild(el('span', 'badge', esc(String(s).slice(0, 22))));
      });
    }

    const rows = [];
    if (meta.creator) rows.push(['Creator', Array.isArray(meta.creator) ? meta.creator.join(', ') : meta.creator]);
    if (meta.year) rows.push(['Year', meta.year]);
    if (meta.files.length) rows.push(['Available', `${meta.files.length} source file${meta.files.length > 1 ? 's' : ''}`]);
    rows.push(['Licence', 'Public domain / free to stream']);

    $('#detail-meta').innerHTML = rows.map(([k, v]) =>
      `<div class="meta-row"><div class="meta-k">${esc(k)}</div><div class="meta-v">${esc(String(v))}</div></div>`
    ).join('');

    S.current = { ...item, meta };

    const done = Object.values(S.downloads).find(d => d.id === item.id && d.status === 'done');
    if (done) {
      const btn = $('#detail-play');
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5L7 4.5Z" fill="currentColor"/></svg> Play offline`;
    }
  } catch (err) {
    console.error(err);
    $('#detail-desc').textContent = 'Could not load details for this title.';
  }
}

/* ------------------------------------------------------------
   Download sheet
   ------------------------------------------------------------ */
async function openDownloadSheet(item) {
  const sheet = $('#download-sheet');
  const opts = $('#download-options');
  $('#dl-sheet-title').textContent = 'Download quality';
  opts.innerHTML = '<div class="opt"><div class="opt-main"><div class="opt-title">Loading…</div></div></div>';
  sheet.hidden = false;

  try {
    const meta = item.meta || await archiveMeta(item.id);
    const qs = qualityOptions(meta.files);

    if (!qs.length) {
      opts.innerHTML = '<div class="opt"><div class="opt-main"><div class="opt-title">No downloadable files</div></div></div>';
      return;
    }

    opts.innerHTML = '';
    qs.forEach(q => {
      const existing = DL.record(item.id, q.id);
      const done = existing && (existing.status === 'done' || existing.status === 'saved');

      const b = el('button', `opt${done ? ' on' : ''}`);
      b.innerHTML = `
        <div class="opt-main">
          <div class="opt-title">${esc(q.label)}</div>
          <div class="opt-sub">${esc(q.sub)}${q.size ? ' · ' + fmtBytes(q.size) : ''}${done ? ' · Downloaded' : ''}</div>
        </div>
        <div class="opt-check">
          <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      `;
      b.addEventListener('click', () => {
        sheet.hidden = true;
        if (done) {
          toast('Already downloaded');
          go('downloads');
        } else {
          DL.start(item, q);
          go('downloads');
        }
      });
      opts.appendChild(b);
    });
  } catch {
    opts.innerHTML = '<div class="opt"><div class="opt-main"><div class="opt-title">Could not load qualities</div></div></div>';
  }
}

/* ------------------------------------------------------------
   Downloads view
   ------------------------------------------------------------ */
function renderDownloads() {
  const list = $('#download-list');
  if (!list) return;

  const items = Object.values(S.downloads).sort((a, b) => b.at - a.at);

  if (!items.length) {
    list.innerHTML = `
      <div class="empty">
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px">No downloads yet</div>
        Downloaded titles play without a connection.<br>Tap the download button on any title.
      </div>`;
    DL.refreshStorage();
    return;
  }

  list.innerHTML = '';
  items.forEach(rec => {
    const row = el('div', 'dl-item');
    const done = rec.status === 'done';
    const saved = rec.status === 'saved';
    const failed = rec.status === 'failed';

    row.innerHTML = `
      <img class="dl-thumb" src="${esc(rec.thumb)}" alt="" onerror="this.style.opacity=.2">
      <div class="dl-info">
        <div class="dl-name">${esc(rec.title)}</div>
        <div class="dl-sub" data-dl-sub="${esc(rec.key)}">
          ${done
            ? `${esc(rec.label)} · ${fmtBytes(rec.size)} · Ready offline`
            : saved
              ? `${esc(rec.label)} · ${fmtBytes(rec.size)} · Saved to device`
              : failed ? 'Failed — tap retry' : `Downloading ${Math.round(rec.progress)}%`}
        </div>
        ${(done || saved) ? '' : `<div class="dl-bar"><i data-dl-bar="${esc(rec.key)}" style="width:${rec.progress}%"></i></div>`}
      </div>
      <button class="dl-act ${done ? 'ready' : ''}" aria-label="Action"></button>
    `;

    const act = $('.dl-act', row);

    if (done) {
      act.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5L7 4.5Z" fill="currentColor"/></svg>`;
      act.addEventListener('click', () => playRecord(rec));
    } else if (saved) {
      act.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5L7 4.5Z" fill="currentColor"/></svg>`;
      act.addEventListener('click', () => {
        DL.nativeDownload(rec);
        toast('Check your Downloads folder');
      });
    } else if (failed) {
      act.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      act.addEventListener('click', () => toast('Quality unavailable — try another'));
    } else {
      act.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      act.addEventListener('click', () => DL.remove(rec.key));
    }

    // Long press / secondary: remove
    if (done || saved) {
      let pressTimer;
      row.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => { DL.remove(rec.key); }, 650);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
        row.addEventListener(ev, () => clearTimeout(pressTimer))
      );
    }

    list.appendChild(row);
  });

  DL.refreshStorage();
}

async function playRecord(rec) {
  showPlayer(rec.title);
  const url = await DL.resolve(rec);
  const video = $('#video');
  video.src = url;
  video.play().catch(() => {});
  S.player = { item: rec, files: [], activeFile: null, url };
}

/* ------------------------------------------------------------
   Search
   ------------------------------------------------------------ */
let searchTimer = null;

function openSearch() {
  S.prevView = S.view;
  showView('search');
  $('#search-input').value = '';
  $('#search-grid').innerHTML = '';
  $('#search-empty').hidden = true;
  setTimeout(() => $('#search-input').focus(), 120);
}

function initSearch() {
  const input = $('#search-input');

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();

    if (q.length < 2) {
      $('#search-grid').innerHTML = '';
      $('#search-empty').hidden = true;
      return;
    }

    searchTimer = setTimeout(async () => {
      const grid = $('#search-grid');
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Searching…</div>';

      try {
        const items = await archiveSearch(
          `(${q}) AND mediatype:movies AND format:"h.264"`,
          30, 1, 'downloads desc'
        );
        grid.innerHTML = '';
        $('#search-empty').hidden = items.length > 0;
        items.forEach(it => grid.appendChild(posterCard(it)));
      } catch {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Search failed</div>';
      }
    }, 420);
  });

  $('#search-cancel').addEventListener('click', () => go(S.prevView || 'home'));
  $$('[data-open-search], #btn-search-home').forEach(b =>
    b.addEventListener('click', openSearch)
  );
}

/* ------------------------------------------------------------
   Player
   ------------------------------------------------------------ */
function showPlayer(title) {
  const p = $('#player');
  p.hidden = false;
  p.classList.add('hide-ui');
  $('#player-title').textContent = title || '';
  document.body.style.overflow = 'hidden';
}

function hidePlayer() {
  const p = $('#player');
  const video = $('#video');
  p.hidden = true;
  p.classList.remove('hide-ui');
  $('#quality-sheet').hidden = true;
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (S.player.url && S.player.url.startsWith('blob:')) {
    URL.revokeObjectURL(S.player.url);
  }
  S.player = { item: null, files: [], activeFile: null, url: null };
  document.body.style.overflow = '';
}

async function playItem(item) {
  showPlayer(item.title);

  const video = $('#video');
  const p = $('#player-title');
  $('#quality-options').innerHTML = '<div class="opt"><div class="opt-main"><div class="opt-title">Loading sources…</div></div></div>';

  try {
    const meta = item.meta || await archiveMeta(item.id);
    const qs = qualityOptions(meta.files);

    if (!qs.length) {
      toast('No playable source found');
      hidePlayer();
      return;
    }

    // Offline copy takes priority
    const doneRec = Object.values(S.downloads).find(
      d => d.id === item.id && d.status === 'done'
    );

    let chosen;
    if (doneRec) {
      const url = await DL.resolve(doneRec);
      S.player = { item, files: meta.files, activeFile: doneRec, url };
      video.src = url;
      chosen = { label: 'Playback: downloaded copy' };
    } else {
      // Respect default quality pref
      if (prefs.quality === 'sd' && qs.length > 1) chosen = qs[qs.length - 1];
      else chosen = qs[0];

      S.player = { item, files: meta.files, activeFile: chosen };
      video.src = chosen.file.url;
    }

    video.play().catch(() => {
      toast('Tap play to start');
    });

    pushHistory(item);
    renderQualityOptions(meta.files, chosen);

    const badge = $('#player-quality');
    badge.style.color = 'var(--gold)';
    setTimeout(() => { badge.style.color = ''; }, 1200);
  } catch (err) {
    console.error(err);
    toast('Could not load this title');
    hidePlayer();
  }
}

function renderQualityOptions(files, active) {
  const wrap = $('#quality-options');
  const qs = qualityOptions(files);
  wrap.innerHTML = '';

  if (S.player.url && S.player.url.startsWith('blob:')) {
    const offline = el('div', 'opt on');
    offline.innerHTML = `
      <div class="opt-main">
        <div class="opt-title">Downloaded copy</div>
        <div class="opt-sub">Plays without a connection</div>
      </div>
      <div class="opt-check"><svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    `;
    wrap.appendChild(offline);
    return;
  }

  qs.forEach(q => {
    const isOn = active && active.file && active.file.name === q.file.name;
    const b = el('button', `opt${isOn ? ' on' : ''}`);
    b.innerHTML = `
      <div class="opt-main">
        <div class="opt-title">${esc(q.label)}</div>
        <div class="opt-sub">${esc(q.sub)}${q.size ? ' · ' + fmtBytes(q.size) : ''}</div>
      </div>
      <div class="opt-check"><svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    `;
    b.addEventListener('click', () => {
      const video = $('#video');
      const t = video.currentTime;
      const playing = !video.paused;

      S.player.activeFile = q;
      video.src = q.file.url;
      video.currentTime = t;
      if (playing) video.play().catch(() => {});

      $('#quality-sheet').hidden = true;
      renderQualityOptions(files, q);
      toast('Quality: ' + q.label);
    });
    wrap.appendChild(b);
  });
}

function initPlayer() {
  const video = $('#video');
  const player = $('#player');

  // Tap to toggle chrome
  player.addEventListener('click', (e) => {
    if (e.target.closest('button, input, .sheet')) return;
    player.classList.toggle('hide-ui');
  });

  $('#player-close').addEventListener('click', hidePlayer);

  $('#play-toggle').addEventListener('click', () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });

  video.addEventListener('play', () => {
    $('#play-icon').innerHTML = '<path d="M7 4.5h4v15H7zM13 4.5h4v15h-4z" fill="currentColor"/>';
  });
  video.addEventListener('pause', () => {
    $('#play-icon').innerHTML = '<path d="M7 4.5v15l13-7.5L7 4.5Z" fill="currentColor"/>';
  });

  video.addEventListener('timeupdate', () => {
    const scrub = $('#scrub');
    if (!video.duration || !isFinite(video.duration)) return;
    scrub.value = (video.currentTime / video.duration) * 100;
    $('#time-cur').textContent = fmtTime(video.currentTime);
  });

  video.addEventListener('loadedmetadata', () => {
    $('#time-dur').textContent = fmtTime(video.duration);
  });

  video.addEventListener('ended', () => {
    if (prefs.autoplay) toast('Finished');
  });

  video.addEventListener('error', () => {
    if (!video.src) return;
    toast('Source unavailable — try another quality');
  });

  $('#scrub').addEventListener('input', (e) => {
    if (!video.duration || !isFinite(video.duration)) return;
    video.currentTime = (parseFloat(e.target.value) / 100) * video.duration;
  });

  $('#seek-back').addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - 10);
  });
  $('#seek-fwd').addEventListener('click', () => {
    video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10);
  });

  const speeds = [1, 1.25, 1.5, 2, 0.75];
  let speedIdx = 0;
  $('#player-speed').addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    video.playbackRate = speeds[speedIdx];
    $('.speed-label').textContent = speeds[speedIdx] + 'x';
  });

  $('#player-mute').addEventListener('click', () => {
    video.muted = !video.muted;
    $('#player-mute').style.opacity = video.muted ? '.45' : '1';
  });

  $('#player-full').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await (player.requestFullscreen?.() || player.webkitRequestFullscreen?.());
        if (screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
      } else {
        await document.exitFullscreen();
      }
    } catch {}
  });

  $('#player-quality').addEventListener('click', () => {
    const sheet = $('#quality-sheet');
    if (!S.player.files || !S.player.files.length) {
      toast('No sources loaded');
      return;
    }
    sheet.hidden = !sheet.hidden;
  });

  $('#quality-sheet').addEventListener('click', (e) => {
    if (e.target.id === 'quality-sheet') $('#quality-sheet').hidden = true;
  });
}

/* ------------------------------------------------------------
   Profile
   ------------------------------------------------------------ */
function renderProfile() {
  refreshWatchUI();

  const hWrap = $('#profile-history');
  hWrap.innerHTML = '';
  if (!history.length) {
    hWrap.innerHTML = '<div class="empty" style="width:100%;padding:24px 0">Nothing watched yet</div>';
  } else {
    history.slice(0, 12).forEach(h => hWrap.appendChild(posterCard(h)));
  }

  const wWrap = $('#profile-watchlist');
  wWrap.innerHTML = '';
  if (!watchlist.length) {
    wWrap.innerHTML = '<div class="empty" style="width:100%;padding:24px 0">Your watchlist is empty</div>';
  } else {
    watchlist.slice(0, 12).forEach(w => wWrap.appendChild(posterCard(w)));
  }

  const sub = $('#profile-sub');
  if (sub) {
    const n = Object.values(S.downloads).filter(d => d.status === 'done').length;
    sub.textContent = n ? `${n} title${n > 1 ? 's' : ''} available offline` : 'Local profile';
  }
}

function initProfile() {
  const q = $('#pref-quality');
  q.value = prefs.quality;
  q.addEventListener('change', () => { prefs.quality = q.value; savePrefs(); });

  const ap = $('#pref-autoplay');
  ap.checked = !!prefs.autoplay;
  ap.addEventListener('change', () => { prefs.autoplay = ap.checked; savePrefs(); });

  const wf = $('#pref-wifi');
  wf.checked = !!prefs.wifiOnly;
  wf.addEventListener('change', () => { prefs.wifiOnly = wf.checked; savePrefs(); });

  $('#clear-history').addEventListener('click', () => {
    history = [];
    saveHistory();
    renderProfile();
    toast('History cleared');
  });

  $('#clear-all').addEventListener('click', async () => {
    if (!confirm('Clear downloads, watchlist and history?')) return;
    try {
      const cache = await caches.open(CFG.CACHE);
      const keys = await cache.keys();
      await Promise.all(keys.map(k => cache.delete(k)));
    } catch {}
    S.downloads = {};
    store.set('downloads', {});
    watchlist = [];
    history = [];
    saveWatchlist();
    saveHistory();
    renderProfile();
    renderDownloads();
    DL.refreshStorage();
    toast('All data cleared');
  });
}

/* ------------------------------------------------------------
   Router
   ------------------------------------------------------------ */
const VIEWS = ['home', 'movies', 'series', 'downloads', 'profile', 'detail', 'search'];

function showView(name) {
  VIEWS.forEach(v => {
    const node = document.getElementById('view-' + v);
    if (node) node.hidden = v !== name;
  });
  S.view = name;

  const navHidden = name === 'detail' || name === 'search';
  $('#bottomnav').style.display = navHidden ? 'none' : 'flex';

  $$('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.go === name);
  });

  if (name === 'profile') renderProfile();
  if (name === 'downloads') renderDownloads();

  const sc = document.querySelector(`#view-${name} .scroll`);
  if (sc) sc.scrollTop = 0;
}

function go(name) {
  if (name === 'detail' || name === 'search') return;
  showView(name);
}

function initNav() {
  $$('.nav-item').forEach(b => {
    b.addEventListener('click', () => go(b.dataset.go));
  });
  $('#detail-back').addEventListener('click', () => {
    go(S.prevView || 'home');
  });
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
async function boot() {
  initNav();
  initPlayer();
  initSearch();
  initProfile();

  await DL.loadAll();

  renderHome();
  initMovies();
  initSeries();
  renderProfile();

  showView('home');

  // Android back button / browser back
  window.addEventListener('popstate', () => {
    if (!$('#player').hidden) { hidePlayer(); return; }
    if (S.view === 'detail' || S.view === 'search') go(S.prevView || 'home');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
