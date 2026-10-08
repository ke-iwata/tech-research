/* DAILY (tech-radar) — data/*.json を読んで 4 画面（today / reader / radar / market）とストーリーを描く。ビルド不要。 */
(() => {
  'use strict';

  // ---------- state ----------
  const S = {
    cfg: null, stats: null, markets: null, day: null,
    date: null, view: 'today', domain: 'all', q: '',
    pickFilter: 'all',
    reader: { queue: 'inbox', cat: null, sel: 0, open: false },
    radarSel: null,
    story: null,
  };
  const CAT = {};
  const QUAD = {};
  const STORE_KEY = 'tech-radar:v1';
  const VIEWS = ['today', 'reader', 'radar', 'market'];

  const store = (() => {
    let data = { items: {}, log: {}, muted: [] };
    try { data = Object.assign(data, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { /* storage unavailable */ }
    const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } };
    return {
      get: (id) => data.items[id] || null,
      set(id, v) {
        const was = data.items[id];
        if (v) data.items[id] = v; else delete data.items[id];
        if (v === 'done' && was !== 'done') { const d = today(); data.log[d] = (data.log[d] || 0) + 1; }
        save();
      },
      log: () => data.log,
      muted: () => data.muted,
      toggleMute(cat) { data.muted = data.muted.includes(cat) ? data.muted.filter((c) => c !== cat) : data.muted.concat(cat); save(); },
      domain(v) { if (v !== undefined) { data.domain = v; save(); } return data.domain; },
      seen(key) { if (key) { data.seen = data.seen || {}; data.seen[key] = 1; save(); } return data.seen || {}; },
    };
  })();

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    for (const k of kids.flat()) if (k != null) el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }
  function today() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  }
  function mix(hex, a, base = [255, 255, 255]) {
    const n = parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) => Math.round(a * c + (1 - a) * base[i]));
    const lum = rgb.map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    return { bg: `rgb(${rgb.join(',')})`, fg: L > 0.35 ? '#0A0A0A' : '#FFFFFF' };
  }
  function hash(str) { let x = 2166136261; for (const c of str) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }
  const pct = (v, digits = 0) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(digits) + '%');
  const cls = (v) => (v == null ? 'muted' : v >= 0 ? 'up' : 'down');
  const arrow = (v) => (v == null ? '' : v >= 0 ? '▲' : '▼');
  function fmtNum(v) {
    if (v == null) return '—';
    const abs = Math.abs(v);
    const digits = abs >= 1000 ? 0 : abs >= 10 ? 2 : 3;
    return v.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: abs >= 1000 ? 0 : 2 });
  }
  function bigNum(v) {
    if (v == null) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e6) return (v / 1e6).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + 'M';
    return fmtNum(v);
  }
  function hhmm(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }); }
  function ago(iso) {
    if (!iso) return '';
    const m = (Date.now() - new Date(iso).getTime()) / 60000;
    if (!(m >= 0)) return '';
    if (m < 60) return `${Math.round(m)}m ago`;
    if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  }
  const mmdd = (d) => (d ? d.slice(5).replace('-', '.') : '');
  function weekday(date) { return new Date(date + 'T00:00:00+09:00').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Tokyo' }).toUpperCase(); }
  function spark(values, w, hh, color, area) {
    const svg = s('svg', { width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, 'aria-hidden': 'true' });
    const vs = values.filter((v) => v != null);
    if (vs.length < 2) return svg;
    const max = Math.max(...vs), min = Math.min(...vs), step = w / (vs.length - 1);
    const pts = vs.map((v, i) => [(i * step).toFixed(1), (hh - 3 - ((v - min) / ((max - min) || 1)) * (hh - 6)).toFixed(1)]);
    if (area) svg.appendChild(s('path', { d: `M0,${hh} L${pts.map((p) => p.join(',')).join(' L')} L${w},${hh} Z`, fill: mix(color, 0.18).bg }));
    svg.appendChild(s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    return svg;
  }
  const inDomain = (cat) => S.domain === 'all' || (CAT[cat] && CAT[cat].domain === S.domain);
  const visibleCats = () => S.cfg.categories.filter((c) => inDomain(c.id));
  const catOf = (id) => CAT[id] || { color: '#8A8A8A', tag: id, label: id, domain: 'tech' };
  const catChip = (cat) => { const c = catOf(cat); return h('span', { class: 'pill' }, h('span', { class: 'dot', style: { background: c.color } }), c.tag.toUpperCase()); };
  const dot = (color) => h('span', { class: 'dot', style: { background: color } });
  function matchesQ(it) {
    if (!S.q) return true;
    const q = S.q.toLowerCase();
    return [it.title, it.tldr, it.text, (it.keywords || []).join(' '), it.source].some((x) => x && x.toLowerCase().includes(q));
  }
  const kwStat = (kw) => (S.stats ? S.stats.keywords.find((k) => k.kw === kw) : null);
  const empty = (msg) => h('div', { class: 'empty' }, msg);
  const eye = (...t) => h('span', { class: 'eye' }, ...t);
  const sechead = (title, right) => h('div', { class: 'sechead' }, h('h3', null, title), right && eye(right));
  function cell(attrs, ...kids) { return h('section', Object.assign({}, attrs, { class: 'cell ' + (attrs.class || '') }), ...kids); }
  const extLink = (url, ...kids) => h('a', { href: url, target: '_blank', rel: 'noopener' }, ...kids);

  async function getJSON(url, optional) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return await r.json();
    } catch (e) {
      if (optional) return null;
      throw e;
    }
  }

  // ---------- derived ----------
  const dayItems = () => (S.day ? S.day.items.filter((it) => inDomain(it.category) && matchesQ(it)) : []);
  const dayPicks = () => dayItems().filter((it) => it.pick).sort((a, b) => b.score - a.score);
  const topKeywords = () => (S.stats ? S.stats.keywords.filter((k) => inDomain(k.category) && k.c7 > 0).sort((a, b) => b.c7 - a.c7) : []);
  const marketSeries = () => (S.markets ? S.markets.series.filter((m) => inDomain(m.category)) : []);
  const releases = () => (S.day ? S.day.releases.filter((r) => inDomain(r.category)) : []);
  const social = () => (S.day ? S.day.social.filter((p) => inDomain(p.category) && matchesQ(p)) : []);

  // ---------- today ----------
  function renderToday() {
    const root = $('#view-today');
    root.replaceChildren();
    if (!S.day) {
      root.append(cell({ class: 'span3' }, eye('status'), empty('まだ日次データがありません。ルーチンの初回実行（CLAUDE.md の日次更新ルーチン）を待っています。')));
      return;
    }
    const d = S.day;
    const items = dayItems();
    const picks = dayPicks();
    const days = S.stats ? S.stats.days.filter((x) => x.date <= S.date) : [];
    const digest = d.digest.filter((g) => inDomain(g.category));
    const kws = topKeywords();
    const ms = marketSeries();
    const rel = releases();
    const soc = social();

    // ---- stories ring ----
    const seen = store.seen();
    const ringBtn = (kind, label, glyph, cls2, n) => h('button', {
      type: 'button', class: `ring ${cls2}${seen[S.date + ':' + kind] ? ' seen' : ''}`, 'aria-label': `${label} のストーリーを開く`,
      onclick: () => openStories(kind),
    }, h('i', null, glyph), h('span', null, n != null ? `${label} ${n}` : label));
    const techPicks = picks.filter((it) => catOf(it.category).domain === 'tech');
    const moneyPicks = picks.filter((it) => catOf(it.category).domain === 'money');
    root.append(h('div', { class: 'ringrow', 'aria-label': 'ストーリー' },
      digest.length ? ringBtn('digest', '要点', digest.length, 'ink') : null,
      techPicks.length ? ringBtn('tech', 'TECH', 'T', '', techPicks.length) : null,
      moneyPicks.length ? ringBtn('money', 'MONEY', 'M', '', moneyPicks.length) : null,
      kws.length ? ringBtn('radar', 'RADAR', '◎', 'acid') : null,
      rel.length ? ringBtn('next', '予定', mmdd(rel[0].date), '', rel.length) : null,
      soc.length ? ringBtn('social', 'SNS', '#', '', soc.length) : null));

    // ---- poster row 1: three big cells ----
    const readMin = picks.reduce((a, it) => a + (it.read_min || 0), 0);
    const prev = days.length > 1 ? days[days.length - 2] : null;
    const diff = prev ? (d.stats.collected || 0) - (prev.collected || 0) : null;
    const series14 = (f) => days.slice(-14).map(f);

    let firstCell;
    if (ms.length) {
      const m = ms[0];
      firstCell = cell({ 'aria-label': m.label },
        eye(`${m.label} ・ ${m.date || ''} close`),
        h('a', { class: 'big', href: '#market' }, bigNum(m.last)),
        h('div', { class: 'pills' }, h('span', { class: `pill ${(m.d1 ?? 0) >= 0 ? 'acid' : ''}` }, `${arrow(m.d1)} ${pct(m.d1, 2)}`), h('span', { class: 'pill' }, `WEEK ${pct(m.w1, 2)}`), h('span', { class: 'pill' }, `MONTH ${pct(m.m1, 2)}`), m.stale && h('span', { class: 'pill ghost' }, 'STALE')),
        h('p', null, ms.slice(1, 5).map((x) => `${x.label} ${arrow(x.d1)}${pct(x.d1, 2)}`).join(' ・ ')));
    } else {
      firstCell = cell({ 'aria-label': '収集数' },
        eye(`collected ・ ${d.stats.sources_ok ?? '?'} / ${d.stats.sources_total ?? '?'} sources`),
        h('span', { class: 'big' }, d.stats.collected ?? '—'),
        h('div', { class: 'pills' }, h('span', { class: 'pill' }, diff == null ? 'FIRST RUN' : `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} VS PREV`), spark(series14((x) => x.collected), 120, 28, '#0A0A0A')),
        h('p', null, Object.entries(d.stats.by_group || {}).map(([g, n]) => `${g} ${n}`).join(' ・ ')));
    }
    const picksCell = cell({ class: 'acid', 'aria-label': 'ピック' },
      eye(`picks ・ ${d.stats.collected ?? '?'} collected`),
      h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' } },
        h('a', { class: 'big', href: '#reader' }, picks.length),
        h('div', { class: 'num', style: { fontSize: '12px', fontWeight: 700, lineHeight: 1.6, paddingBottom: '4px', letterSpacing: '.06em' } },
          `${items.length} SUMMARIZED`, h('br'), `NEW KW ${days.length ? days[days.length - 1].keywords_new : '—'}`, h('br'), `READ ${readMin}m`)),
      h('div', { class: 'pills' }, h('span', { class: 'pill', style: { background: '#fff' } }, diff == null ? 'FIRST RUN' : `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} ITEMS VS PREV`), spark(series14((x) => x.picks), 120, 28, '#0A0A0A')),
      h('p', null, picks[0] ? `トップ：${picks[0].title}` : 'ピックアップはありません'));
    const k1 = kws[0];
    const radarCell = cell({ 'aria-label': 'レーダー首位' },
      eye('radar #1 ・ 7 days'),
      k1 ? h('a', { class: 'big kw', href: '#radar', onclick: () => { S.radarSel = k1.kw; } }, k1.kw) : h('span', { class: 'big kw muted' }, '—'),
      k1 && h('div', { class: 'pills' }, h('span', { class: 'pill acid' }, `${k1.c7} MENTIONS`), h('span', { class: 'pill' }, `PREV ${k1.p7}`), h('span', { class: `pill ${k1.move === 'new' ? 'ink' : ''}` }, k1.move === 'new' ? 'NEW' : k1.ring)),
      h('p', null, kws.slice(1, 4).map((k, i) => `${i + 2} 位 ${k.kw} ${k.c7}`).join('　') || 'キーワードの集計はまだありません'));

    // ---- row 2: headline (span2) + markets/next ----
    const top = picks[0];
    const groups = d.stats.by_group || {};
    const gmax = Math.max(1, ...Object.values(groups));
    const gtotal = Object.values(groups).reduce((a, b) => a + b, 0) || 1;
    const headline = cell({ class: 'span2', 'aria-label': '今日の見出し' },
      top ? [
        h('div', { class: 'cellhead' }, eye(`headline ・ ${catOf(top.category).tag} ・ ${top.source} ・ score ${top.score}`), top.signal && eye(top.signal)),
        h('h2', null, extLink(top.url, top.title)),
        h('p', { style: { maxWidth: '64ch', fontSize: '14.5px' } }, top.tldr),
      ] : [eye('headline'), h('h2', null, 'ピックアップはありません')],
      h('div', { class: 'subcols' },
        h('div', null, eye('also today ・ digest'),
          digest.length ? h('div', { class: 'idx' }, digest.map((g) => {
            const st = g.keywords && g.keywords.length ? kwStat(g.keywords[0]) : null;
            return [h('span', { class: 'k' }, catOf(g.category).tag.toUpperCase()), h('span', null, g.text), h('span', { class: `r ${st && st.wow != null ? cls(st.wow) : ''}` }, st ? (st.wow == null ? 'new' : pct(st.wow)) : '')];
          })) : h('div', { class: 'muted' }, 'この領域の要点はありません')),
        h('div', null, eye(`sources ・ n=${gtotal} ・ ${d.stats.sources_ok ?? '?'}/${d.stats.sources_total ?? '?'} ok`),
          h('div', { class: 'hbars' }, Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) =>
            h('div', { class: 'hbar' }, h('span', null, g), h('div', { class: 'bar' }, h('span', { style: { width: `${(n / gmax) * 100}%` } })), h('span', { class: 'p' }, `${Math.round((n / gtotal) * 100)}%`)))),
          (d.stats.failed_sources || []).length ? h('div', { class: 'faint', style: { fontSize: '11px', fontFamily: 'var(--lat)', letterSpacing: '.06em' } }, 'FAILED ' + d.stats.failed_sources.join(', ')) : null)));

    const sideCell = cell({ 'aria-label': '市況と予定' },
      ms.length ? [eye('markets ・ close'),
        h('table', { class: 'tbl' }, h('tbody', null, ms.map((m) => h('tr', { class: 'row-link', onclick: () => { location.hash = '#market'; } },
          h('td', { class: 'l' }, m.label), h('td', { class: 'n' }, bigNum(m.last)), h('td', { class: `n ${cls(m.d1)}` }, pct(m.d1, 2))))))] : null,
      h('div', { style: { marginTop: ms.length ? 'auto' : 0, paddingTop: ms.length ? '12px' : 0, borderTop: ms.length ? '2px solid #0A0A0A' : 0, display: 'flex', flexDirection: 'column', gap: '6px' } },
        eye(`next ・ ${rel.length} releases / events`),
        rel.length ? h('div', null, rel.slice(0, 6).map((r) => h('div', { class: 'rel' },
          h('span', { class: 'd', style: { color: r.kind === 'event' ? 'var(--red)' : null } }, mmdd(r.date)),
          extLink(r.url, h('span', { class: 't' }, r.title)),
          h('span', { class: 'pill ghost', style: { padding: '1px 6px', fontSize: '9.5px' } }, (r.kind || 'release').toUpperCase()),
          r.note && h('span', { class: 'n' }, r.note)))) : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'リリース・イベントはありません')));

    root.append(h('div', { class: 'poster' }, firstCell, picksCell, radarCell, headline, sideCell));

    // ---- picks ----
    const cats = visibleCats();
    const shown = picks.filter((it) => S.pickFilter === 'all' || it.category === S.pickFilter);
    root.append(h('div', null,
      h('div', { class: 'sechead' }, h('h3', null, `PICKS ${picks.length}`), h('div', { class: 'chips' }, [{ id: 'all', tag: 'all' }].concat(cats).map((c) => h('button', {
        type: 'button', class: S.pickFilter === c.id ? 'on' : '',
        onclick: () => { S.pickFilter = c.id; renderToday(); },
      }, c.color && dot(c.color), c.tag.toUpperCase())))),
      shown.length ? h('div', { class: 'cards' }, shown.map(pickCard)) : cell({}, empty('ピックアップはありません'))));

    // ---- rest table ----
    const rest = items.filter((it) => !it.pick).sort((a, b) => b.score - a.score);
    if (rest.length) {
      root.append(h('div', null, sechead(`INDEX ${rest.length}`, 'pick 以外 ・ score 順'),
        cell({ style: { padding: '12px 16px' } }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'SCORE'), h('th', null, 'TOPIC'), h('th', null, 'TITLE'), h('th', null, 'SOURCE'), h('th', null, 'SIGNAL'))),
          h('tbody', null, rest.map((it) => h('tr', { class: 'row-link', onclick: () => window.open(it.url, '_blank', 'noopener') },
            h('td', { class: 'n' }, it.score), h('td', null, h('span', { class: 'pill', style: { padding: '1px 6px', fontSize: '9.5px' } }, dot(catOf(it.category).color), catOf(it.category).tag.toUpperCase())),
            h('td', { class: 'l' }, extLink(it.url, it.title)), h('td', { class: 'muted' }, it.source), h('td', { class: 'n', style: { fontWeight: 500 } }, it.signal || ''))))))));
    }

    // ---- heatmap + trending ----
    root.append(h('div', { class: 'poster' }, heatmapCell(days), trendingCell()));

    // ---- social ----
    root.append(h('div', null, sechead(`SOCIAL ${soc.length}`, 'X / Bluesky / HN / はてブ'),
      cell({}, soc.length ? soc.map((p) => h('div', { class: 'log' },
        h('div', { class: 'h' }, h('span', null, hhmm(p.posted_at) || '--:--'), h('span', { class: 'net' }, (p.network || '').toUpperCase()),
          extLink(p.url, h('span', { class: 'who' }, p.author || 'post')), h('span', null, catOf(p.category).tag.toUpperCase()), h('span', null, p.metrics || '')),
        h('p', null, p.text),
        p.heat != null && h('div', { class: 'heatbar' }, 'HEAT', h('div', { class: 'bar' }, h('span', { style: { width: `${p.heat}%` } })), h('b', null, p.heat)))) : empty('投稿はありません'))));
  }

  function heatmapCell(days) {
    const last = days.slice(-7);
    const prev = days.slice(-14, -7);
    const cats = visibleCats();
    const max = Math.max(1, ...last.flatMap((x) => cats.map((c) => (x.by_category || {})[c.id] || 0)));
    const head = h('div', { class: 'heat-row head' }, h('span', { class: 'name' }),
      last.map((x) => h('span', { class: 'cell' }, new Date(x.date + 'T00:00:00+09:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'Asia/Tokyo' }))),
      h('span', { class: 'sum' }, h('span', { class: 't7' }, 'Σ7D'), h('span', null, 'Δ')));
    const rows = cats.map((c) => {
      const vals = last.map((x) => (x.by_category || {})[c.id] || 0);
      const sum = vals.reduce((a, b) => a + b, 0);
      const psum = prev.reduce((a, x) => a + ((x.by_category || {})[c.id] || 0), 0);
      const dlt = prev.length >= 7 && psum ? Math.round(((sum - psum) / psum) * 100) : null;
      return h('div', { class: 'heat-row' },
        h('span', { class: 'name' }, dot(c.color), h('span', null, c.label)),
        vals.map((v) => { const m = mix('#0A0A0A', v / max); return h('span', { class: 'cell', style: { background: m.bg, color: m.fg } }, v); }),
        h('span', { class: 'sum' }, h('span', { class: 't7' }, sum), h('span', { class: cls(dlt) }, dlt == null ? '—' : pct(dlt))));
    });
    return cell({ class: 'span2', 'aria-label': '分野別ヒートマップ' },
      h('div', { class: 'cellhead' }, eye('topic heatmap ・ 分野別の記事・投稿数'), eye(last.length < 7 ? `${last.length}/7 days` : '7 days')),
      last.length ? h('div', { class: 'heat' }, head, rows) : empty('集計データがまだありません'));
  }

  function trendingCell() {
    const kws = (S.stats ? S.stats.keywords : []).filter((k) => inDomain(k.category) && k.c7 > 0)
      .sort((a, b) => ((b.wow ?? 1e4) - (a.wow ?? 1e4)) || b.c7 - a.c7).slice(0, 8);
    return cell({ 'aria-label': '上昇キーワード' },
      h('div', { class: 'cellhead' }, eye('trending ・ Δ WoW'), h('a', { href: '#radar', class: 'eye' }, 'RADAR →')),
      kws.length ? h('div', { class: 'trend' }, kws.map((k, i) => h('a', { class: 'trend-row', href: '#radar', onclick: () => { S.radarSel = k.kw; } },
        h('span', { class: 'r' }, i + 1),
        h('span', { class: 'kw' }, h('b', null, k.kw), h('span', null, `${catOf(k.category).tag.toUpperCase()} ・ ${k.c7}`)),
        spark(k.series.slice(-14), 70, 24, '#0A0A0A'),
        h('span', { class: `d ${k.wow == null ? '' : cls(k.wow)}` }, k.wow == null ? 'NEW' : pct(k.wow)))))
        : empty('キーワードの集計はまだありません'));
  }

  function pickCard(it) {
    const c = catOf(it.category);
    const later = store.get(it.id) === 'later';
    const codeLines = it.code && it.code.text ? it.code.text.split('\n').slice(0, 6).join('\n') : null;
    return h('article', { class: 'card' },
      codeLines ? h('pre', null, h('span', { class: 'faint' }, `// ${it.code.file || it.code.lang || 'snippet'}\n`), codeLines)
        : h('pre', null, h('span', { class: 'faint' }, `# ${it.source}\n`), (it.keywords || []).map((k) => '#' + k).join('  '), '\n\n', h('span', { class: 'faint' }, `score ${it.score} ・ ${it.read_min || '?'} min`)),
      h('div', { class: 'body' },
        h('div', { class: 'meta' }, catChip(it.category), h('span', null, it.source), h('span', null, ago(it.published_at)), it.read_min && h('span', { style: { marginLeft: 'auto' } }, `${it.read_min} MIN`)),
        h('h3', null, extLink(it.url, it.title)),
        h('p', null, it.tldr),
        (it.keywords || []).length ? h('div', { class: 'tags' }, it.keywords.map((k) => h('a', { class: 'tag', href: '#radar', onclick: () => { S.radarSel = k; } }, k))) : null,
        h('div', { class: 'match' }, 'MATCH', h('div', { class: 'bar' }, h('span', { style: { width: `${it.score}%` } })), h('b', null, `${it.score}%`)),
        it.why && h('span', { class: 'why' }, '↳ ' + it.why),
        h('div', { class: 'acts' },
          h('a', { class: 'btn primary', href: it.url, target: '_blank', rel: 'noopener' }, 'OPEN ↗'),
          h('button', { type: 'button', class: 'btn' + (later ? ' on' : ''), onclick: () => { store.set(it.id, later ? null : 'later'); renderToday(); } }, later ? '✓ LATER' : '+ LATER'),
          h('button', { type: 'button', class: 'btn', onclick: () => openStories(c.domain, it.id) }, 'STORY'))));
  }

  // ---------- stories ----------
  function buildSlides(kind) {
    const picks = dayPicks();
    const slide = (o) => Object.assign({ kicker: '', title: '', text: '', tags: [], item: null, big: null, bg: 'ink' }, o);
    const fromItem = (it, i) => slide({
      kicker: `${catOf(it.category).tag} ・ ${it.source} ・ score ${it.score}${it.signal ? ' ・ ' + it.signal : ''}`,
      title: it.title, text: it.tldr, tags: it.keywords || [], item: it, bg: ['ink', 'acid', 'paper'][i % 3],
    });
    if (kind === 'digest') {
      const digest = S.day.digest.filter((g) => inDomain(g.category));
      return digest.map((g, i) => {
        const rel = picks.find((it) => it.category === g.category && (it.keywords || []).some((k) => (g.keywords || []).includes(k))) || null;
        return slide({ kicker: `要点 ${i + 1} / ${digest.length} ・ ${catOf(g.category).tag}`, title: g.text, text: rel ? `関連ピック：${rel.title}` : '', tags: g.keywords || [], item: rel, bg: ['ink', 'acid', 'paper'][i % 3] });
      });
    }
    if (kind === 'tech' || kind === 'money') return picks.filter((it) => catOf(it.category).domain === kind).map(fromItem);
    if (kind === 'radar') {
      return topKeywords().slice(0, 6).map((k, i) => slide({
        kicker: `radar ${i + 1} ・ ${catOf(k.category).tag} ・ ${k.ring}${k.prev_ring && k.prev_ring !== k.ring ? ' ← ' + k.prev_ring : ''}`,
        big: k.kw, title: `${k.c7} mentions`, text: `前 7 日 ${k.p7} ・ ${k.wow == null ? '新規' : '前週比 ' + pct(k.wow)} ・ 初出 ${k.first_seen}`,
        tags: [], item: null, bg: ['ink', 'acid', 'paper'][i % 3], kw: k.kw,
      }));
    }
    if (kind === 'next') return releases().map((r, i) => slide({ kicker: `${(r.kind || 'release')} ・ ${r.repo || catOf(r.category).tag}`, big: mmdd(r.date), title: r.title, text: r.note || '', url: r.url, bg: ['acid', 'ink', 'paper'][i % 3] }));
    if (kind === 'social') return social().map((p, i) => slide({ kicker: `${(p.network || '').toUpperCase()} ・ ${p.author || 'post'} ・ ${p.metrics || ''}`, title: p.text, text: '', tags: p.keywords || [], url: p.url, bg: ['paper', 'ink', 'acid'][i % 3] }));
    return [];
  }

  function openStories(kind, itemId) {
    const slides = buildSlides(kind);
    if (!slides.length) return;
    let i = 0;
    if (itemId) i = Math.max(0, slides.findIndex((x) => x.item && x.item.id === itemId));
    S.story = { kind, slides, i, sheet: false };
    store.seen(S.date + ':' + kind);
    renderStories();
    document.body.style.overflow = 'hidden';
  }
  function closeStories() {
    S.story = null;
    $('#stories').hidden = true;
    $('#stories').replaceChildren();
    document.body.style.overflow = '';
    if (S.view === 'today') renderToday();
  }
  function renderStories() {
    const root = $('#stories');
    const st = S.story;
    if (!st) return;
    const sl = st.slides[st.i];
    const n = st.slides.length;
    const page = h('section', { class: `st-page ${sl.bg}` },
      eye(sl.kicker),
      sl.big && h('div', { class: 'st-big' }, sl.big),
      h('h2', { class: 'st-h', style: sl.big ? { fontSize: '22px' } : null }, sl.url ? extLink(sl.url, sl.title) : sl.item ? extLink(sl.item.url, sl.title) : sl.title),
      sl.text && h('p', { class: 'st-p' }, sl.text),
      sl.tags.length ? h('div', { class: 'pills' }, sl.tags.map((k) => h('a', { class: 'pill', href: '#radar', onclick: () => { S.radarSel = k; closeStories(); } }, k))) : null);
    const segs = h('div', { class: 'st-segs' }, st.slides.map((_, k) => h('span', { class: k <= st.i ? 'on' : '' })));
    const label = { digest: '要点', tech: 'TECH', money: 'MONEY', radar: 'RADAR', next: '予定', social: 'SNS' }[st.kind] || st.kind;
    const top = h('div', { class: 'st-top', style: { color: sl.bg === 'ink' ? '#E9FF3A' : '#0A0A0A' } }, segs,
      h('div', { class: 'st-meta' }, h('span', null, `${label} ・ ${S.date} ・ ${st.i + 1} / ${n}`), h('button', { type: 'button', 'aria-label': '閉じる', onclick: closeStories }, '✕')));
    const kids = [page, top];
    if (!st.sheet) {
      kids.push(h('button', { type: 'button', class: 'st-tap l', 'aria-label': '前へ', onclick: () => storyStep(-1) }, '前へ'));
      kids.push(h('button', { type: 'button', class: 'st-tap r', 'aria-label': '次へ', onclick: () => storyStep(1) }, '次へ'));
      kids.push(h('div', { class: 'st-foot', style: { color: sl.bg === 'ink' ? '#fff' : '#0A0A0A' } },
        sl.item ? h('button', { type: 'button', class: 'btn', onclick: () => { st.sheet = true; renderStories(); } }, '↑ 本文を読む') : sl.kw ? h('a', { class: 'btn', href: '#radar', onclick: () => { S.radarSel = sl.kw; closeStories(); } }, 'RADAR で見る') : h('span'),
        h('a', { class: 'eye', href: st.kind === 'next' || st.kind === 'social' ? '#today' : st.kind === 'radar' ? '#radar' : '#reader', onclick: closeStories }, st.kind === 'radar' ? 'RADAR →' : 'READ で全部 →')));
    } else {
      const it = sl.item;
      kids.push(h('div', { class: 'st-sheet' },
        h('div', { class: 'st-sh' }, eye('tldr ・ points ・ code'), h('button', { type: 'button', class: 'btn', 'aria-label': '閉じる', onclick: () => { st.sheet = false; renderStories(); } }, '↓')),
        h('h3', null, extLink(it.url, it.title)),
        h('p', null, it.tldr),
        (it.points || []).length ? h('div', { class: 'points' }, it.points.map((p) => h('div', null, p))) : null,
        it.code && it.code.text ? h('div', { class: 'code' }, h('div', { class: 'hd' }, h('span', null, it.code.file || it.code.lang || 'snippet'), h('span', null, '記事内のコード')), h('pre', null, it.code.text)) : null,
        h('div', { class: 'pills' }, h('a', { class: 'pill ink', href: it.url, target: '_blank', rel: 'noopener', onclick: () => { if (!store.get(it.id)) store.set(it.id, 'done'); } }, '原文を開く ↗'), h('span', { class: 'pill ghost' }, it.source), it.why && h('span', { class: 'pill ghost' }, it.why))));
    }
    root.replaceChildren(...kids);
    root.hidden = false;
  }
  function storyStep(dir) {
    const st = S.story;
    if (!st) return;
    const next = st.i + dir;
    if (next < 0 || next >= st.slides.length) { closeStories(); return; }
    st.i = next; st.sheet = false;
    renderStories();
  }

  // ---------- reader ----------
  function readerItems() {
    if (!S.day) return [];
    const muted = store.muted();
    return S.day.items.filter((it) => {
      if (!inDomain(it.category) || !matchesQ(it)) return false;
      if (S.reader.cat && it.category !== S.reader.cat) return false;
      const st = store.get(it.id);
      switch (S.reader.queue) {
        case 'inbox': return !st && !muted.includes(it.category);
        case 'picks': return it.pick;
        case 'later': return st === 'later';
        case 'done': return st === 'done';
        default: return true;
      }
    }).sort((a, b) => b.score - a.score);
  }

  function renderReader(opts = {}) {
    const root = $('#view-reader');
    const prevList = root.querySelector('.r-list');
    const prevTop = prevList && !opts.resetScroll ? prevList.scrollTop : 0;
    root.replaceChildren();
    if (!S.day) { root.append(cell({ style: { width: '100%' } }, empty('まだ日次データがありません。'))); return; }
    const all = S.day.items.filter((it) => inDomain(it.category));
    const muted = store.muted();
    const count = { inbox: all.filter((it) => !store.get(it.id) && !muted.includes(it.category)).length, picks: all.filter((it) => it.pick).length, later: all.filter((it) => store.get(it.id) === 'later').length, done: all.filter((it) => store.get(it.id) === 'done').length, all: all.length };
    const list = readerItems();
    if (S.reader.sel >= list.length) S.reader.sel = Math.max(0, list.length - 1);

    // reading log (12 weeks)
    const log = store.log();
    const cells = [];
    const end = new Date(today() + 'T00:00:00+09:00');
    const start = new Date(end); start.setDate(start.getDate() - 83 - end.getDay() + 6);
    let streak = 0, week = 0;
    for (let i = 0; i < 84; i++) {
      const dt = new Date(start); dt.setDate(start.getDate() + i);
      const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(dt);
      const n = log[key] || 0;
      const lv = ['#FFFFFF', '#D9D9D9', '#9A9A9A', '#4A4A4A', '#0A0A0A'][Math.min(4, Math.ceil(n / 2))];
      cells.push(h('span', { title: `${key}: ${n}`, style: { background: dt > end ? 'transparent' : lv, borderColor: dt > end ? 'transparent' : null } }));
    }
    for (let i = 0; ; i++) { const dt = new Date(end); dt.setDate(end.getDate() - i); const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(dt); if (log[key]) streak++; else if (i > 0) break; if (i > 400) break; }
    for (let i = 0; i < 7; i++) { const dt = new Date(end); dt.setDate(end.getDate() - i); week += log[new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(dt)] || 0; }

    const qbtn = (id) => h('button', { type: 'button', class: S.reader.queue === id && !S.reader.cat ? 'on' : '', onclick: () => { S.reader.queue = id; S.reader.cat = null; S.reader.sel = 0; renderReader({ resetScroll: true }); } }, h('span', null, id.toUpperCase()), h('span', { class: 'n' }, count[id]));
    const side = h('aside', { class: 'r-side' },
      h('h4', null, 'QUEUES'), ['inbox', 'picks', 'later', 'done', 'all'].map(qbtn),
      h('h4', null, 'TOPICS'), visibleCats().map((c) => {
        const n = all.filter((it) => it.category === c.id).length;
        const isMuted = muted.includes(c.id);
        return h('button', { type: 'button', class: S.reader.cat === c.id ? 'on' : '', onclick: () => { S.reader.cat = S.reader.cat === c.id ? null : c.id; S.reader.queue = 'all'; S.reader.sel = 0; renderReader({ resetScroll: true }); } },
          dot(c.color), h('span', { style: { textDecoration: isMuted ? 'line-through' : 'none' } }, c.tag.toUpperCase()), h('span', { class: 'n' }, n));
      }),
      h('div', { class: 'grass-box' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, eye('reading log'), h('span', { class: 'faint' }, '12 WEEKS')),
        h('div', { class: 'grass' }, cells),
        h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'STREAK ', h('b', null, `${streak}d`)), h('span', null, 'THIS WEEK ', h('b', null, week)))));

    const listEl = h('section', { class: 'r-list', 'aria-label': '記事一覧' },
      h('div', { class: 'lh' }, eye(S.reader.cat ? catOf(S.reader.cat).tag : S.reader.queue, ` ・ ${list.length} ・ score 順`), eye(h('kbd', null, 'j'), ' ', h('kbd', null, 'k'), ' 移動')),
      list.length ? list.map((it, i) => {
        const c = catOf(it.category);
        const st = store.get(it.id);
        return h('button', {
          type: 'button', class: `r-item${i === S.reader.sel ? ' on' : ''}`,
          onclick: () => { S.reader.open = true; selectReader(i, false); },
        },
          h('span', { class: `sc${st ? ' read' : ''}` }, it.score),
          h('span', { class: 't' }, it.title),
          h('span', { class: 'meta' }, h('b', null, c.tag.toUpperCase()), h('span', null, it.source), h('span', null, ago(it.published_at)), it.pick && h('b', null, 'PICK'), st && h('span', null, st.toUpperCase())));
      }) : empty('このキューは空です'));

    const detail = readerDetail(list);
    root.append(side, listEl, detail);
    listEl.scrollTop = prevTop;
    const on = listEl.querySelector('.r-item.on');
    if (on && opts.reveal) on.scrollIntoView({ block: 'nearest' });
  }

  function readerDetail(list) {
    const cur = list[S.reader.sel];
    const muted = store.muted();
    const open = S.reader.open ? ' open' : '';
    if (!cur) return h('article', { class: 'r-detail' }, empty('記事を選んでください'));
    const related = S.day.items.filter((x) => x.id !== cur.id && (x.keywords || []).some((k) => (cur.keywords || []).includes(k))).slice(0, 4);
    const st = store.get(cur.id);
    return h('article', { class: 'r-detail' + open },
      h('div', { class: 'scroll' },
        h('div', { class: 'meta' }, h('button', { type: 'button', class: 'btn r-close', onclick: () => { S.reader.open = false; renderReader(); } }, '← LIST'),
          catChip(cur.category), h('span', null, cur.source), h('span', null, ago(cur.published_at)), cur.read_min && h('span', null, `${cur.read_min} MIN`), cur.signal && h('span', { class: 'up' }, cur.signal), h('span', { style: { marginLeft: 'auto', fontFamily: 'var(--disp)', fontSize: '16px', color: 'var(--ink)' } }, cur.score)),
        h('h1', null, extLink(cur.url, cur.title)),
        h('div', { class: 'tldr' }, h('span', { class: 'label' }, 'TL;DR'), cur.tldr),
        (cur.points || []).length ? h('div', null, h('span', { class: 'label' }, 'KEY POINTS'), h('div', { class: 'points' }, cur.points.map((p) => h('div', null, p)))) : null,
        cur.code && cur.code.text ? h('div', { class: 'code' }, h('div', { class: 'hd' }, h('span', null, cur.code.file || cur.code.lang || 'snippet'), h('span', null, '記事内のコードを抽出')), h('pre', null, cur.code.text)) : null,
        cur.why && h('div', null, h('span', { class: 'label' }, 'WHY'), h('span', { class: 'why' }, cur.why)),
        (cur.keywords || []).length ? h('div', { class: 'tags', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, cur.keywords.map((k) => h('a', { class: 'tag', href: '#radar', onclick: () => { S.radarSel = k; } }, k))) : null,
        h('div', { class: 'related' }, h('span', { class: 'label' }, 'RELATED ・ 同じキーワードの記事'), related.length ? related.map((r) => extLink(r.url, '↳ ' + r.title)) : h('span', { class: 'faint', style: { fontSize: '12px' } }, '（なし）'))),
      h('div', { class: 'r-actions' },
        h('a', { class: 'btn primary', href: cur.url, target: '_blank', rel: 'noopener', onclick: () => { if (!st) store.set(cur.id, 'done'); } }, h('kbd', null, 'o'), 'OPEN'),
        h('button', { type: 'button', class: 'btn' + (st === 'later' ? ' on' : ''), onclick: () => act('s') }, h('kbd', null, 's'), 'LATER'),
        h('button', { type: 'button', class: 'btn' + (st === 'done' ? ' on' : ''), onclick: () => act('e') }, h('kbd', null, 'e'), 'DONE'),
        h('button', { type: 'button', class: 'btn' + (muted.includes(cur.category) ? ' on' : ''), onclick: () => act('m') }, h('kbd', null, 'm'), muted.includes(cur.category) ? 'UNMUTE' : 'MUTE TOPIC'),
        h('span', { class: 'pos' }, `${S.reader.sel + 1} / ${list.length}`)));
  }

  function selectReader(i, reveal) {
    const root = $('#view-reader');
    const listEl = root.querySelector('.r-list');
    const oldDetail = root.querySelector('.r-detail');
    if (!listEl || !oldDetail) { S.reader.sel = i; renderReader({ reveal }); return; }
    const list = readerItems();
    S.reader.sel = Math.max(0, Math.min(list.length - 1, i));
    listEl.querySelectorAll('.r-item').forEach((el, j) => el.classList.toggle('on', j === S.reader.sel));
    oldDetail.replaceWith(readerDetail(list));
    const on = listEl.querySelector('.r-item.on');
    if (on && reveal) on.scrollIntoView({ block: 'nearest' });
  }

  function act(key) {
    const list = readerItems();
    const cur = list[S.reader.sel];
    if (key === 'j' || key === 'k') { selectReader(S.reader.sel + (key === 'j' ? 1 : -1), true); return; }
    if (!cur) return;
    if (key === 'o') { window.open(cur.url, '_blank', 'noopener'); if (!store.get(cur.id)) store.set(cur.id, 'done'); }
    else if (key === 's') store.set(cur.id, store.get(cur.id) === 'later' ? null : 'later');
    else if (key === 'e') store.set(cur.id, store.get(cur.id) === 'done' ? null : 'done');
    else if (key === 'm') store.toggleMute(cur.category);
    renderReader({ reveal: true });
  }

  // ---------- radar ----------
  const RINGS = ['HOT', 'RISING', 'WATCH', 'COOLING'];
  const RING_R = [[16, 92], [102, 178], [188, 262], [272, 346]];
  const QSTART = [180, 270, 0, 90];
  const RING_NOTE = { HOT: '上位 15% かつ c7 ≥ 3', RISING: 'p7 = 0 かつ c7 ≥ 2、または ×1.3', WATCH: 'それ以外', COOLING: 'c7 ≤ p7 × 0.8' };
  const MOVE = { up: ['▲', 'var(--blue)'], down: ['▼', 'var(--red)'], new: ['NEW', 'var(--blue)'], stay: ['=', 'var(--grey)'] };

  function radarKeywords() {
    if (!S.stats) return [];
    const perQuad = {};
    return S.stats.keywords.filter((k) => inDomain(k.category) && k.ring && CAT[k.category])
      .filter((k) => { const q = CAT[k.category].quadrant; perQuad[q] = (perQuad[q] || 0) + 1; return perQuad[q] <= 8; });
  }

  function renderRadar() {
    const root = $('#view-radar');
    root.replaceChildren();
    const kws = radarKeywords();
    if (!kws.length) { root.append(cell({}, eye('radar'), empty('キーワードの集計がまだありません。数日分たまるとレーダーに表示されます。'))); return; }
    if (!S.radarSel || !kws.find((k) => k.kw === S.radarSel)) S.radarSel = kws[0].kw;

    const svg = s('svg', { viewBox: '0 0 740 740', 'aria-hidden': 'true' },
      s('circle', { cx: 370, cy: 370, r: 355, fill: '#FFFFFF', stroke: '#0A0A0A', 'stroke-width': 2 }),
      s('circle', { cx: 370, cy: 370, r: 267, fill: '#F3F3F0', stroke: '#0A0A0A', 'stroke-width': 2 }),
      s('circle', { cx: 370, cy: 370, r: 183, fill: '#E6E6E2', stroke: '#0A0A0A', 'stroke-width': 2 }),
      s('circle', { cx: 370, cy: 370, r: 97, fill: '#E9FF3A', stroke: '#0A0A0A', 'stroke-width': 2 }),
      s('path', { d: 'M370 15 V725 M15 370 H725', stroke: '#0A0A0A', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }),
      RINGS.map((r, i) => s('text', { x: 378, y: [292, 203, 118, 34][i], fill: '#0A0A0A', 'font-family': 'Archivo, sans-serif', 'font-size': 11, 'font-weight': 700, 'letter-spacing': 1 }, r)),
      S.cfg.quadrants.map((q, i) => s('text', { x: i === 1 || i === 2 ? 710 : 30, y: i < 2 ? 36 : 716, fill: '#0A0A0A', 'font-family': 'Archivo Black, sans-serif', 'font-size': 14, 'text-anchor': i === 1 || i === 2 ? 'end' : 'start' }, q.label)));

    const groups = {};
    kws.forEach((k) => { const key = CAT[k.category].quadrant + '|' + k.ring; (groups[key] = groups[key] || []).push(k); });
    const blips = [];
    Object.entries(groups).forEach(([key, arr]) => {
      const [qid, ring] = key.split('|');
      const qi = S.cfg.quadrants.findIndex((q) => q.id === qid);
      const ri = RINGS.indexOf(ring);
      arr.forEach((k, i) => {
        const t = (i + 0.5) / arr.length;
        const f = arr.length > 1 ? (i % 2 ? 0.72 : 0.28) : 0.5;
        const ang = ((QSTART[qi] + 10 + 70 * t) * Math.PI) / 180;
        const r = RING_R[ri][0] + (RING_R[ri][1] - RING_R[ri][0]) * f;
        const x = 370 + Math.cos(ang) * r, y = 370 + Math.sin(ang) * r;
        const c = CAT[k.category].color;
        const on = k.kw === S.radarSel;
        blips.push(h('button', {
          type: 'button', class: 'blip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
          style: { left: `${(x / 740) * 100}%`, top: `${(y / 740) * 100}%` },
          onclick: () => { S.radarSel = k.kw; renderRadar(); },
        }, h('i', { style: { borderColor: c, background: k.move === 'new' ? 'transparent' : c } }), k.kw, k.move !== 'stay' && h('span', { style: { color: on ? '#E9FF3A' : MOVE[k.move][1] } }, MOVE[k.move][0])));
      });
    });

    const sel = kws.find((k) => k.kw === S.radarSel);
    const c = CAT[sel.category];
    const weekly = [];
    for (let i = 0; i < 12; i++) weekly.push(sel.series.slice(i * 7, i * 7 + 7).reduce((a, b) => a + b, 0));
    const arts = S.day ? S.day.items.concat(S.day.social).filter((x) => (x.keywords || []).includes(sel.kw)) : [];
    const moves = kws.filter((k) => k.move !== 'stay').slice(0, 10);
    const young = S.stats.history_days < 14;

    root.append(h('div', { class: 'radar-wrap' },
      cell({ 'aria-label': 'レーダー' },
        h('div', { class: 'cellhead' }, eye('keyword radar ・ 中心ほど今アツい'), h('span', { class: 'radar-legend' }, h('span', null, '● STAY'), h('span', null, '○ NEW'), h('span', { class: 'up' }, '▲ IN'), h('span', { class: 'down' }, '▼ OUT'))),
        h('div', { class: 'radar' }, svg, blips),
        young && h('div', { class: 'faint', style: { fontSize: '11px' } }, `データ ${S.stats.history_days} 日分。前週比とリングの移動は 14 日分たまると正確になります`)),
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        cell({ class: 'acid', 'aria-label': '選択中のキーワード', style: { flex: 1 } },
          h('div', { class: 'cellhead' }, eye(`inspect ・ ${sel.ring}${sel.prev_ring && sel.prev_ring !== sel.ring ? ' ← ' + sel.prev_ring : ''}`), catChip(sel.category)),
          h('span', { class: 'kwname' }, sel.kw),
          h('div', { class: 'stat3' },
            h('div', null, h('span', null, 'MENTIONS 7D'), h('b', null, sel.c7)),
            h('div', null, h('span', null, 'WOW'), h('b', { class: cls(sel.wow) }, sel.wow == null ? 'NEW' : pct(sel.wow))),
            h('div', null, h('span', null, 'FIRST SEEN'), h('b', { style: { fontSize: '15px' } }, sel.first_seen))),
          h('div', null, h('span', { class: 'label' }, 'TREND 12W ・ weekly mentions'), spark(weekly, 460, 70, '#0A0A0A', true)),
          h('div', { class: 'related' }, h('span', { class: 'label' }, `ARTICLES ・ ${S.date}`), arts.length ? arts.slice(0, 6).map((x) => extLink(x.url, '↳ ' + (x.title || x.text.slice(0, 60)))) : h('span', { class: 'faint', style: { fontSize: '12px' } }, 'この日の記事はありません'))),
        cell({ 'aria-label': 'リングの移動' }, eye('moves ・ last week → now'),
          h('div', { class: 'moves' }, moves.length ? moves.map((k) => {
            const m = MOVE[k.move];
            return h('div', { class: 'tr' }, h('span', { style: { width: '34px', color: m[1], fontWeight: 700 } }, m[0]), h('span', { style: { flexGrow: 1, fontWeight: 700 } }, k.kw), h('span', { class: 'muted' }, k.prev_ring || '—'), h('span', { class: 'faint' }, '→'), h('span', { style: { color: m[1], width: '70px', fontWeight: 700 } }, k.ring));
          }) : empty('先週からの移動はありません'))))));

    // ring list (all keywords in domain, grouped by ring)
    const all = S.stats.keywords.filter((k) => inDomain(k.category) && k.ring && k.c7 > 0).sort((a, b) => b.c7 - a.c7);
    root.append(cell({ class: 'ringlist', 'aria-label': 'リング別の一覧' },
      h('div', { class: 'cellhead' }, eye(`all keywords ・ ${all.length} ・ 7d vs prev 7d`), eye('30D ・ C7/P7 ・ MOVE')),
      RINGS.map((ring, ri) => {
        const rowsAll = all.filter((k) => k.ring === ring);
        const rows = ring === 'WATCH' ? rowsAll.slice(0, 24) : rowsAll;
        if (!rows.length) return null;
        return [h('div', { class: `rh ${ri === 1 ? 'acid' : ri >= 2 ? 'paper' : ''}` }, h('b', null, ring), h('span', null, RING_NOTE[ring]), h('span', { style: { marginLeft: 'auto' } }, rows.length < rowsAll.length ? `${rows.length} / ${rowsAll.length}` : rowsAll.length)),
          rows.map((k, i) => h('button', { type: 'button', class: `kwrow${i === 0 ? ' first' : ''}`, style: { width: '100%', border: 0, borderTop: i === 0 ? 0 : null, background: k.kw === S.radarSel ? 'var(--acid)' : 'transparent', textAlign: 'left' }, onclick: () => { S.radarSel = k.kw; renderRadar(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
            h('span', { class: 'k' }, k.kw, h('small', null, catOf(k.category).tag.toUpperCase())),
            spark(k.series.slice(-30), 70, 20, k.move === 'down' ? '#C8200A' : k.move === 'up' || k.move === 'new' ? '#1849B8' : '#0A0A0A'),
            h('span', { class: 'c' }, k.c7, h('small', null, `/${k.p7}`)),
            h('span', { class: 'm', style: { color: MOVE[k.move][1], fontSize: k.move === 'new' ? '9px' : null } }, MOVE[k.move][0])))];
      })));
  }

  // ---------- market ----------
  function heatColor(d) {
    if (d == null) return { bg: '#FFFFFF', fg: '#0A0A0A' };
    const k = d >= 0 ? Math.min(1, d / 200) : Math.min(1, -d / 50);
    return mix(d >= 0 ? '#0A0A0A' : '#1849B8', 0.12 + 0.88 * k);
  }

  function renderMarket() {
    const root = $('#view-market');
    root.replaceChildren();
    const ms = marketSeries();
    const kws = S.stats ? S.stats.keywords.filter((k) => inDomain(k.category) && k.c7 > 0) : [];

    root.append(h('div', { class: 'subtabs', 'aria-label': 'マーケットの区分' }, h('a', { href: '#market-idx' }, '指数'), h('a', { href: '#market-map' }, 'キーワード地図'), h('a', { href: '#market-board' }, '騰落')));
    root.append(h('div', { class: 'ticker', 'aria-label': 'ティッカー' },
      ms.map((m) => h('span', null, h('b', null, m.label), h('span', { class: cls(m.d1) }, `${arrow(m.d1)} ${pct(m.d1, 2)}`))),
      kws.filter((k) => k.wow != null).sort((a, b) => b.wow - a.wow).slice(0, 8).map((k) => h('span', null, h('b', null, k.kw.toUpperCase()), h('span', { class: cls(k.wow) }, `${arrow(k.wow)} ${pct(k.wow)}`)))));

    if (ms.length) {
      root.append(h('div', { id: 'market-idx' }, sechead('INDICES', `${S.markets.updated_at.slice(0, 16).replace('T', ' ')} 更新 ・ Yahoo Finance`),
        cell({ style: { padding: '12px 16px' } }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'SERIES'), h('th', { class: 'sp' }, '60D'), h('th', { style: { textAlign: 'right' } }, 'LAST'), h('th', { style: { textAlign: 'right' } }, '1D'), h('th', { style: { textAlign: 'right' } }, '1W'), h('th', { style: { textAlign: 'right' } }, '1M'))),
          h('tbody', null, ms.map((m) => h('tr', null,
            h('td', { class: 'l' }, m.label, h('small', null, `${catOf(m.category).tag.toUpperCase()} ・ ${m.unit}${m.stale ? ' ・ STALE' : ''} ・ ${mmdd(m.date)}`)),
            h('td', { class: 'sp' }, spark(m.closes.slice(-60), 110, 28, (m.m1 ?? 0) >= 0 ? '#1849B8' : '#C8200A', true)),
            h('td', { class: 'n' }, fmtNum(m.last)),
            h('td', { class: `n ${cls(m.d1)}` }, pct(m.d1, 2)), h('td', { class: `n ${cls(m.w1)}` }, pct(m.w1, 2)), h('td', { class: `n ${cls(m.m1)}` }, pct(m.m1, 2)))))))));
    }

    const sectors = visibleCats().map((c) => {
      const tiles = kws.filter((k) => k.category === c.id).slice(0, 8);
      return { c, tiles, total: tiles.reduce((a, k) => a + k.c7, 0) };
    }).filter((x) => x.total > 0);
    root.append(h('div', { id: 'market-map' }, sechead('KEYWORD MAP', '面積 = 直近 7 日の言及数 ・ 色 = 前週比 ・ クリックでレーダーへ'),
      cell({}, sectors.length ? [
        h('div', { class: 'map' }, sectors.map(({ c, tiles, total }) => h('div', { class: 'sector', style: { flex: `${total} 1 0` } },
          h('div', { class: 'sh' }, h('span', null, dot(c.color), ' ', c.tag.toUpperCase()), h('span', { class: 'muted' }, total)),
          tiles.map((k) => {
            const col = heatColor(k.wow);
            const big = k.c7 / total;
            return h('a', { class: 'tile', href: '#radar', onclick: () => { S.radarSel = k.kw; }, style: { flex: `${k.c7} 1 0`, background: col.bg, color: col.fg } },
              h('b', { style: { fontSize: big > 0.3 ? '20px' : big > 0.12 ? '13px' : '11px' } }, k.kw),
              h('span', null, k.wow == null ? `NEW ・ ${k.c7}` : `${pct(k.wow)} ・ ${k.c7}`));
          })))),
        h('div', { class: 'scale' }, 'COOLING', [-50, -25, -10, 0, 50, 100, 200].map((v) => { const col = heatColor(v); return h('span', { class: 'sw', style: { background: col.bg, color: col.fg } }, pct(v)); }), 'HEATING', h('span', { class: 'sw', style: { width: 'auto', padding: '0 8px' } }, 'NEW'))]
        : empty('キーワードの集計がまだありません'))));

    const withWow = kws.filter((k) => k.wow != null);
    const board = (title, color, rows, val) => cell({}, h('div', { class: 'cellhead' }, h('span', { style: { fontFamily: 'var(--disp)', fontSize: '16px', color } }, title)),
      rows.length ? h('div', { class: 'moves' }, rows.slice(0, 6).map((k) => h('a', { class: 'tr', href: '#radar', onclick: () => { S.radarSel = k.kw; } }, dot(catOf(k.category).color), h('span', { style: { flexGrow: 1, fontWeight: 700 } }, k.kw), h('span', { class: 'muted' }, k.c7), h('span', { style: { color, width: '64px', textAlign: 'right', fontWeight: 700 } }, val(k))))) : empty('データ蓄積中'));
    root.append(h('div', { id: 'market-board' }, sechead('MOVERS', 'Δ WoW'), h('div', { class: 'boards' },
      board('▲ TOP GAINERS', 'var(--blue)', withWow.slice().sort((a, b) => b.wow - a.wow).filter((k) => k.wow > 0), (k) => pct(k.wow)),
      board('▼ TOP LOSERS', 'var(--red)', withWow.slice().sort((a, b) => a.wow - b.wow).filter((k) => k.wow < 0), (k) => pct(k.wow)),
      board('◆ MOST MENTIONED', 'var(--ink)', kws.slice().sort((a, b) => b.c7 - a.c7), (k) => k.c7))));
    root.append(h('div', { class: 'faint', style: { fontSize: '11px', fontFamily: 'var(--lat)', letterSpacing: '.08em' } }, '金融の項目は事実の要約のみ。売買の推奨や相場予想ではありません。'));
  }

  // ---------- chrome ----------
  function renderStatus() {
    const d = S.day;
    $('#statusbar').replaceChildren(
      h('span', { class: 'mode' }, S.view === 'reader' ? 'READER' : 'NORMAL'),
      h('span', { class: 'grow' }, `data/daily/${S.date || '—'}.json`),
      h('span', null, `DOMAIN ${S.domain.toUpperCase()}`),
      d && h('span', null, `${d.stats.sources_ok ?? '?'} SOURCES`),
      d && (d.stats.failed_sources || []).length ? h('span', { class: 'down' }, `FAILED ${d.stats.failed_sources.join(', ')}`) : null,
      d && h('span', null, `BUILD ${hhmm(d.generated_at)} JST`),
      h('span', null, 'GITHUB PAGES'));
  }

  function render() {
    for (const v of VIEWS) {
      $(`#view-${v}`).classList.toggle('on', v === S.view);
      document.querySelectorAll(`a[data-view="${v}"]`).forEach((a) => {
        a.classList.toggle('on', v === S.view);
        if (v === S.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
    }
    document.querySelectorAll('#domain button').forEach((b) => b.classList.toggle('on', b.dataset.domain === S.domain));
    ({ today: renderToday, reader: renderReader, radar: renderRadar, market: renderMarket })[S.view]();
    renderStatus();
  }

  async function loadDay(date) {
    S.date = date;
    S.day = date ? await getJSON(`data/daily/${date}.json`, true) : null;
    S.reader.sel = 0;
    S.reader.open = false;
    const sel = $('#date');
    if (sel.value !== date) sel.value = date;
    const dates = S.stats ? S.stats.dates : [];
    const i = dates.indexOf(date);
    $('#date-prev').disabled = i < 0 || i >= dates.length - 1;
    $('#date-next').disabled = i <= 0;
  }

  function route() {
    const v = location.hash.replace('#', '').split('/')[0];
    S.view = VIEWS.includes(v) ? v : 'today';
    if (S.story) closeStories();
    render();
    window.scrollTo(0, 0);
  }

  async function init() {
    const [cfg, stats, markets] = await Promise.all([getJSON('data/config.json'), getJSON('data/stats.json', true), getJSON('data/markets.json', true)]);
    S.cfg = cfg; S.stats = stats; S.markets = markets;
    cfg.categories.forEach((c) => { CAT[c.id] = c; });
    cfg.quadrants.forEach((q) => { QUAD[q.id] = q; });
    S.domain = ['all', 'tech', 'money'].includes(store.domain()) ? store.domain() : 'all';

    const sel = $('#date');
    const dates = stats ? stats.dates : [];
    sel.replaceChildren(...(dates.length ? dates.map((d) => h('option', { value: d }, `${d.slice(5).replace('-', '.')} ${weekday(d)}`)) : [h('option', { value: '' }, 'NO DATA')]));
    sel.addEventListener('change', async () => { await loadDay(sel.value); render(); });
    const step = async (dir) => { const i = dates.indexOf(S.date) + dir; if (i < 0 || i >= dates.length) return; await loadDay(dates[i]); render(); };
    $('#date-prev').addEventListener('click', () => step(1));
    $('#date-next').addEventListener('click', () => step(-1));
    await loadDay(dates[0] || null);

    document.querySelectorAll('#domain button').forEach((b) => b.addEventListener('click', () => { S.domain = b.dataset.domain; store.domain(S.domain); S.pickFilter = 'all'; S.reader.cat = null; render(); }));
    const q = $('#q');
    q.addEventListener('input', () => { S.q = q.value.trim(); render(); });
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape' && typing) { e.target.blur(); return; }
      if (typing) return;
      if (S.story) {
        if (e.key === 'Escape') { e.preventDefault(); closeStories(); }
        else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'j') { e.preventDefault(); storyStep(1); }
        else if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); storyStep(-1); }
        else if (e.key === 'ArrowUp' && S.story.slides[S.story.i].item) { e.preventDefault(); S.story.sheet = true; renderStories(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); S.story.sheet = false; renderStories(); }
        return;
      }
      if (e.key === '/') { e.preventDefault(); q.focus(); return; }
      if (e.key === '[') { step(1); return; }
      if (e.key === ']') { step(-1); return; }
      if (S.view === 'reader' && e.key === 'Escape' && S.reader.open) { S.reader.open = false; renderReader(); return; }
      if (S.view === 'reader' && ['j', 'k', 'o', 's', 'e', 'm'].includes(e.key)) { e.preventDefault(); act(e.key); }
    });
    window.addEventListener('hashchange', route);
    route();
  }

  init().catch((e) => {
    $('#app').replaceChildren(h('div', { class: 'view on' }, h('section', { class: 'cell' }, eye('init'), h('div', { class: 'empty' }, `読み込みに失敗しました: ${e.message}`))));
  });
})();
