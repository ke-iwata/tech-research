/* tech-radar — data/*.json を読んで 4 画面（today / reader / radar / market）を描く。ビルド不要。 */
(() => {
  'use strict';

  // ---------- state ----------
  const S = {
    cfg: null, stats: null, markets: null, day: null,
    date: null, view: 'today', domain: 'all', q: '',
    pickFilter: 'all',
    reader: { queue: 'inbox', cat: null, sel: 0 },
    radarSel: null,
  };
  const CAT = {};
  const QUAD = {};
  const STORE_KEY = 'tech-radar:v1';

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
  function mix(hex, a, base = [17, 21, 28]) {
    const n = parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) => Math.round(a * c + (1 - a) * base[i]));
    const lum = rgb.map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    return { bg: `rgb(${rgb.join(',')})`, fg: L > 0.3 ? '#0B0E14' : '#E6EDF3' };
  }
  const tint = (hex) => mix(hex, 0.18).bg;
  function hash(str) { let x = 2166136261; for (const c of str) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }
  const shortHash = (str) => hash(str).toString(16).padStart(8, '0').slice(0, 7);
  const pct = (v, digits = 0) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(digits) + '%');
  const cls = (v) => (v == null ? 'muted' : v >= 0 ? 'up' : 'down');
  function fmtNum(v) {
    const abs = Math.abs(v);
    const digits = abs >= 1000 ? 0 : abs >= 10 ? 2 : 3;
    return v.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: abs >= 1000 ? 0 : 2 });
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
  function spark(values, w, h, color, area) {
    const svg = s('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
    const vs = values.filter((v) => v != null);
    if (vs.length < 2) return svg;
    const max = Math.max(...vs), min = Math.min(...vs), step = w / (vs.length - 1);
    const pts = vs.map((v, i) => [(i * step).toFixed(1), (h - 3 - ((v - min) / ((max - min) || 1)) * (h - 6)).toFixed(1)]);
    if (area) svg.appendChild(s('path', { d: `M0,${h} L${pts.map((p) => p.join(',')).join(' L')} L${w},${h} Z`, fill: tint(color) }));
    svg.appendChild(s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    return svg;
  }
  const inDomain = (cat) => S.domain === 'all' || (CAT[cat] && CAT[cat].domain === S.domain);
  const visibleCats = () => S.cfg.categories.filter((c) => inDomain(c.id));
  const catChip = (cat) => { const c = CAT[cat] || { color: '#8B95A7', tag: cat }; return h('span', { class: 'chip', style: { background: tint(c.color), color: c.color } }, c.tag); };
  function matchesQ(it) {
    if (!S.q) return true;
    const q = S.q.toLowerCase();
    return [it.title, it.tldr, it.text, (it.keywords || []).join(' '), it.source].some((x) => x && x.toLowerCase().includes(q));
  }
  const kwStat = (kw) => (S.stats ? S.stats.keywords.find((k) => k.kw === kw) : null);
  function panel(head, ...body) { return h('div', { class: 'panel' }, head && h('div', { class: 'panel-head' }, head), ...body); }
  function panel2(left, right, ...body) { return h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, left, right), ...body); }
  const cmd = (text, note) => h('span', null, h('span', { class: 'k' }, '$ '), text, note && h('span', { class: 'k' }, '  // ' + note));
  const pnl = (name, note) => h('span', null, h('span', { class: 'k' }, 'panel: '), name, note && h('span', { class: 'k' }, '  // ' + note));
  const empty = (msg) => h('div', { class: 'empty' }, msg);

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

  // ---------- today ----------
  function renderToday() {
    const root = $('#view-today');
    root.replaceChildren();
    if (!S.day) {
      root.append(panel(cmd('radar status'), empty('まだ日次データがありません。ルーチンの初回実行（CLAUDE.md の日次更新ルーチン）を待っています。')));
      return;
    }
    const d = S.day;
    const items = d.items.filter((it) => inDomain(it.category) && matchesQ(it));
    const picks = items.filter((it) => it.pick).sort((a, b) => b.score - a.score);
    const days = S.stats ? S.stats.days.filter((x) => x.date <= S.date) : [];

    // row 1: digest + kpis
    const digest = d.digest.filter((g) => inDomain(g.category));
    const wd = new Date(S.date + 'T00:00:00+09:00').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Tokyo' });
    const digestPanel = panel2(
      h('span', null, h('span', { class: 'k' }, '~/radar/digest/'), `${S.date}.md`), h('span', { class: 'k' }, wd),
      h('div', { class: 'digest' },
        h('div', { class: 'prompt' }, `radar digest --since 24h --domain ${S.domain}`),
        h('div', { class: 'muted' }, `collected ${d.stats.collected ?? '?'} items from ${d.stats.sources_ok ?? '?'} sources · picked ${d.items.length} · ${d.social.length} social`),
        digest.length ? digest.map((g) => {
          const st = g.keywords && g.keywords.length ? kwStat(g.keywords[0]) : null;
          const c = CAT[g.category] || {};
          return h('div', { class: 'digest-row' }, catChip(g.category), h('span', { class: 'txt' }, g.text),
            st && h('span', { class: 'd', style: { color: c.color } }, st.wow != null ? pct(st.wow) : 'new'));
        }) : h('div', { class: 'muted' }, 'この領域の要点はありません'),
        h('div', null, h('span', { class: 'prompt' }), h('span', { class: 'cursor' }))));

    const series = (f) => days.slice(-14).map(f);
    const readMin = picks.reduce((a, it) => a + (it.read_min || 0), 0);
    const kpi = (label, value, sub, vals, color) => h('div', { class: 'panel kpi' },
      h('span', { class: 'l' }, label),
      h('div', { class: 'row' }, h('span', { class: 'v' }, value), vals && spark(vals, 84, 28, color)),
      h('span', { class: 's', style: { color } }, sub));
    const prev = days.length > 1 ? days[days.length - 2] : null;
    const diff = prev ? (d.stats.collected || 0) - (prev.collected || 0) : null;
    const kpis = h('div', { class: 'kpis' },
      kpi('items_collected', d.stats.collected ?? '—', diff == null ? 'first run' : `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} vs prev`, series((x) => x.collected), '#7EE787'),
      kpi('picks', picks.length, `${items.length} summarized`, series((x) => x.picks), '#58A6FF'),
      kpi('new_keywords', days.length ? days[days.length - 1].keywords_new : '—', 'first seen today', series((x) => x.keywords_new), '#E3B341'),
      kpi('read_time', `${readMin}m`, `${picks.length} picks`, null, '#BC8CFF'));

    const groups = d.stats.by_group || {};
    const gmax = Math.max(1, ...Object.values(groups));
    const gtotal = Object.values(groups).reduce((a, b) => a + b, 0) || 1;
    const breakdown = panel2(h('span', null, h('span', { class: 'k' }, 'sources.breakdown')), h('span', { class: 'k' }, `n=${gtotal}`),
      h('div', { class: 'panel-body hbars' }, Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) =>
        h('div', { class: 'hbar' }, h('span', { class: 'n' }, g), h('div', { class: 'bar' }, h('span', { style: { width: `${(n / gmax) * 100}%`, background: 'var(--accent)' } })), h('span', { class: 'p' }, `${Math.round((n / gtotal) * 100)}%`)))));

    root.append(h('div', { class: 'grid' },
      h('div', { class: 'span-7 stack' }, digestPanel),
      h('div', { class: 'span-5 stack' }, kpis, breakdown)));

    // markets strip
    if (S.markets && S.domain !== 'tech') {
      const ms = S.markets.series.filter((m) => inDomain(m.category));
      root.append(panel2(h('span', null, pnl('markets'), h('span', { class: 'k' }, '  // 前日比・直近30営業日')), h('a', { href: '#market', class: 'k' }, 'market.map →'),
        h('div', { class: 'tickers' }, ms.map((m) => h('a', { class: 'tick', href: '#market' },
          h('span', { class: 'l' }, h('span', { class: 'dot', style: { background: (CAT[m.category] || {}).color } }), m.label, m.stale && h('span', { class: 'stale' }, 'stale')),
          h('div', { class: 'row' }, h('span', { class: 'v' }, fmtNum(m.last)), spark(m.closes.slice(-30), 72, 24, (m.m1 ?? 0) >= 0 ? '#7EE787' : '#FF7B72')),
          h('span', { class: `c ${cls(m.d1)}` }, `${m.d1 >= 0 ? '▲' : '▼'} ${pct(m.d1, 2)}`))))));
    }

    // row 2: heatmap + trending
    root.append(h('div', { class: 'grid' },
      h('div', { class: 'span-8 stack' }, heatmapPanel(days)),
      h('div', { class: 'span-4 stack' }, trendingPanel())));

    // picks
    const cats = visibleCats();
    const shown = picks.filter((it) => S.pickFilter === 'all' || it.category === S.pickFilter);
    root.append(h('div', { class: 'cmdline' },
      h('span', null, h('span', { class: 'prompt' }), 'radar picks --rank=match', h('span', { class: 'muted' }, '  // 関心キーワードとの一致度順')),
      h('div', { class: 'chips' }, [{ id: 'all', tag: 'all' }].concat(cats).map((c) => h('button', {
        type: 'button', class: S.pickFilter === c.id ? 'on' : '', style: c.color && S.pickFilter !== c.id ? { color: c.color } : null,
        onclick: () => { S.pickFilter = c.id; renderToday(); },
      }, c.tag)))));
    root.append(shown.length ? h('div', { class: 'cards' }, shown.map(pickCard)) : panel(null, empty('ピックアップはありません')));

    const rest = items.filter((it) => !it.pick).sort((a, b) => b.score - a.score);
    if (rest.length) {
      root.append(panel(null, h('div', { class: 'table' },
        h('div', { class: 'th' }, h('span', { class: 'c1' }, 'TOPIC'), h('span', { class: 'c2' }, 'SOURCE'), h('span', { class: 'c3' }, 'TITLE'), h('span', { class: 'c4' }, 'SIGNAL')),
        rest.map((it) => h('a', { class: 'tr', href: it.url, target: '_blank', rel: 'noopener' },
          h('span', { class: 'c1', style: { color: (CAT[it.category] || {}).color } }, (CAT[it.category] || {}).tag),
          h('span', { class: 'c2' }, it.source), h('span', { class: 'c3' }, it.title), h('span', { class: 'c4' }, it.signal || ''))))));
    }

    // row 4: social + releases
    const social = d.social.filter((p) => inDomain(p.category) && matchesQ(p));
    const rel = d.releases.filter((r) => inDomain(r.category));
    root.append(h('div', { class: 'grid' },
      h('div', { class: 'span-7 stack' }, panel2(h('span', null, cmd('tail -f social.log')), h('span', { class: 'k' }, 'X / Bluesky / HN / はてブ'),
        social.length ? social.map((p) => h('div', { class: 'log' },
          h('div', { class: 'h' }, h('span', { class: 'muted' }, hhmm(p.posted_at) || '--:--'), h('span', { class: 'net' }, (p.network || '').toUpperCase()),
            h('a', { class: 'who', href: p.url, target: '_blank', rel: 'noopener' }, p.author || 'post'),
            h('span', { style: { color: (CAT[p.category] || {}).color } }, `[${(CAT[p.category] || {}).tag}]`), h('span', { class: 'm' }, p.metrics || '')),
          h('p', null, p.text),
          h('div', { class: 'heat' }, 'heat', h('div', { class: 'bar' }, h('span', { style: { width: `${p.heat || 0}%`, background: (CAT[p.category] || {}).color } })), h('span', { style: { color: 'var(--text)' } }, p.heat ?? '')))) : empty('投稿はありません'))),
      h('div', { class: 'span-5 stack' }, panel2(h('span', null, cmd('git log --graph releases')), h('span', { class: 'k' }, `${rel.length} entries`),
        rel.length ? h('div', { class: 'gitlog' }, rel.map((r) => {
          const c = (CAT[r.category] || {}).color || '#8B95A7';
          return h('div', { class: 'commit' },
            h('div', { class: 'rail' }, h('i', { style: { borderColor: c, background: r.kind === 'event' ? 'transparent' : c } }), h('b')),
            h('div', { class: 'c' },
              h('div', { class: 'h' }, h('span', { class: 'hash' }, shortHash(r.title + r.date)), h('span', { class: 'muted' }, (r.date || '').slice(5)), h('span', { class: 'kind', style: { color: c, borderColor: c } }, r.kind || 'release')),
              h('a', { class: 't', href: r.url, target: '_blank', rel: 'noopener' }, r.title),
              r.note && h('span', { class: 'n' }, r.note)));
        })) : empty('リリース・イベントはありません')))));
  }

  function heatmapPanel(days) {
    const last = days.slice(-7);
    const prev = days.slice(-14, -7);
    const cats = visibleCats();
    const max = Math.max(1, ...last.flatMap((x) => cats.map((c) => (x.by_category || {})[c.id] || 0)));
    const head = h('div', { class: 'heat-row head' }, h('span', { class: 'name' }),
      last.map((x) => h('span', { class: 'cell' }, new Date(x.date + 'T00:00:00+09:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'Asia/Tokyo' }))),
      h('span', { class: 'sum' }, h('span', { class: 't7' }, 'Σ7d'), h('span', null, 'Δ')));
    const rows = cats.map((c) => {
      const vals = last.map((x) => (x.by_category || {})[c.id] || 0);
      const sum = vals.reduce((a, b) => a + b, 0);
      const psum = prev.reduce((a, x) => a + ((x.by_category || {})[c.id] || 0), 0);
      const dlt = prev.length >= 7 && psum ? Math.round(((sum - psum) / psum) * 100) : null;
      return h('div', { class: 'heat-row' },
        h('span', { class: 'name' }, h('span', { class: 'dot', style: { background: c.color } }), h('span', null, c.label)),
        vals.map((v) => { const m = mix(c.color, 0.1 + 0.85 * (v / max)); return h('span', { class: 'cell', style: { background: m.bg, color: m.fg } }, v); }),
        h('span', { class: 'sum' }, h('span', { class: 't7' }, sum), h('span', { class: cls(dlt), style: { width: '48px', textAlign: 'right' } }, dlt == null ? '—' : pct(dlt))));
    });
    return panel2(h('span', null, pnl('topic_heatmap', '分野別の記事・投稿数')), h('span', { class: 'k' }, last.length < 7 ? `${last.length}/7 days` : '7d'),
      last.length ? h('div', { class: 'heat' }, head, rows) : empty('集計データがまだありません'));
  }

  function trendingPanel() {
    const kws = (S.stats ? S.stats.keywords : []).filter((k) => inDomain(k.category) && k.c7 > 0)
      .sort((a, b) => ((b.wow ?? 1e4) - (a.wow ?? 1e4)) || b.c7 - a.c7).slice(0, 8);
    return panel2(pnl('trending_keywords'), h('span', { class: 'k' }, 'Δ WoW'),
      kws.length ? [h('div', { class: 'trend-head' }, h('span', { style: { width: '18px' } }, '#'), h('span', { style: { flexGrow: 1 } }, 'KEYWORD'), h('span', { style: { width: '70px' } }, '14D'), h('span', { style: { width: '58px', textAlign: 'right' } }, 'Δ')),
        kws.map((k, i) => h('a', { class: 'trend-row', href: '#radar', onclick: () => { S.radarSel = k.kw; } },
          h('span', { class: 'r' }, i + 1),
          h('span', { class: 'kw' }, h('b', null, k.kw), h('span', { style: { color: (CAT[k.category] || {}).color } }, `${(CAT[k.category] || {}).tag} · ${k.c7}`)),
          spark(k.series.slice(-14), 70, 26, (CAT[k.category] || {}).color || '#8B95A7'),
          h('span', { class: `d ${k.wow == null ? '' : cls(k.wow)}` }, k.wow == null ? 'new' : pct(k.wow))))]
        : empty('キーワードの集計はまだありません'));
  }

  function pickCard(it) {
    const c = CAT[it.category] || { color: '#8B95A7', tag: it.category };
    const later = store.get(it.id) === 'later';
    const codeLines = it.code && it.code.text ? it.code.text.split('\n').slice(0, 5).join('\n') : null;
    return h('article', { class: 'panel card' },
      h('div', { class: 'visual' },
        codeLines ? h('pre', null, h('span', { class: 'faint' }, `// ${it.code.file || it.code.lang || 'snippet'}\n`), codeLines)
          : h('pre', null, h('span', { class: 'faint' }, `# ${it.source}\n`), h('span', { style: { color: c.color } }, (it.keywords || []).map((k) => '#' + k).join(' '))),
        h('span', { class: 'glyph', style: { color: c.color } }, c.tag.toUpperCase())),
      h('div', { class: 'body' },
        h('div', { class: 'meta' }, catChip(it.category), h('span', null, it.source), h('span', null, ago(it.published_at)), it.read_min && h('span', { style: { marginLeft: 'auto' } }, `${it.read_min} min`)),
        h('h3', null, h('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.title)),
        h('p', null, it.tldr),
        (it.keywords || []).length ? h('div', { class: 'tags' }, it.keywords.map((k) => h('span', { class: 'tag' }, '#' + k))) : null,
        h('div', { class: 'match' }, h('span', { class: 'muted' }, 'match'), h('div', { class: 'bar' }, h('span', { style: { width: `${it.score}%`, background: 'var(--accent)' } })), h('b', { style: { color: 'var(--accent)' } }, `${it.score}%`)),
        it.why && h('span', { class: 'why' }, '↳ ' + it.why),
        h('div', { class: 'acts' },
          h('a', { class: 'btn primary', href: it.url, target: '_blank', rel: 'noopener' }, 'open ↗'),
          h('button', { type: 'button', class: 'btn' + (later ? ' on' : ''), onclick: () => { store.set(it.id, later ? null : 'later'); renderToday(); } }, later ? '✓ later' : '+ later'))));
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

  function renderReader() {
    const root = $('#view-reader');
    root.replaceChildren();
    if (!S.day) { root.append(h('div', { class: 'empty' }, 'まだ日次データがありません。')); return; }
    const all = S.day.items.filter((it) => inDomain(it.category));
    const muted = store.muted();
    const count = { inbox: all.filter((it) => !store.get(it.id) && !muted.includes(it.category)).length, picks: all.filter((it) => it.pick).length, later: all.filter((it) => store.get(it.id) === 'later').length, done: all.filter((it) => store.get(it.id) === 'done').length, all: all.length };
    const list = readerItems();
    if (S.reader.sel >= list.length) S.reader.sel = Math.max(0, list.length - 1);

    // side
    const log = store.log();
    const cells = [];
    const end = new Date(today() + 'T00:00:00+09:00');
    const start = new Date(end); start.setDate(start.getDate() - 83 - end.getDay() + 6);
    let streak = 0, week = 0;
    for (let i = 0; i < 84; i++) {
      const dt = new Date(start); dt.setDate(start.getDate() + i);
      const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(dt);
      const n = log[key] || 0;
      const lv = ['#1A2029', '#1E4A34', '#2E7A4F', '#4FB96F', '#7EE787'][Math.min(4, Math.ceil(n / 2))];
      cells.push(h('span', { title: `${key}: ${n}`, style: { background: dt > end ? 'transparent' : lv } }));
    }
    for (let i = 0; ; i++) { const dt = new Date(end); dt.setDate(end.getDate() - i); const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(dt); if (log[key]) streak++; else if (i > 0) break; if (i > 400) break; }
    for (let i = 0; i < 7; i++) { const dt = new Date(end); dt.setDate(end.getDate() - i); week += log[new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(dt)] || 0; }

    const qbtn = (id) => h('button', { type: 'button', class: S.reader.queue === id && !S.reader.cat ? 'on' : '', onclick: () => { S.reader.queue = id; S.reader.cat = null; S.reader.sel = 0; renderReader(); } }, h('span', null, id), h('span', { class: 'n' }, count[id]));
    const side = h('aside', { class: 'r-side' },
      h('h4', null, 'QUEUES'), ['inbox', 'picks', 'later', 'done', 'all'].map(qbtn),
      h('h4', null, 'TOPICS'), visibleCats().map((c) => {
        const n = all.filter((it) => it.category === c.id).length;
        const isMuted = muted.includes(c.id);
        return h('button', { type: 'button', class: S.reader.cat === c.id ? 'on' : '', onclick: () => { S.reader.cat = S.reader.cat === c.id ? null : c.id; S.reader.queue = 'all'; S.reader.sel = 0; renderReader(); } },
          h('span', { class: 'dot', style: { background: c.color } }), h('span', { style: { textDecoration: isMuted ? 'line-through' : 'none' } }, c.tag), h('span', { class: 'n' }, n));
      }),
      h('div', { class: 'grass-box' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', { class: 'muted' }, 'reading_log'), h('span', { class: 'faint' }, '12 weeks')),
        h('div', { class: 'grass' }, cells),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px' }, class: 'muted' }, h('span', null, 'streak ', h('b', { style: { color: 'var(--text)' } }, `${streak}d`)), h('span', null, 'this week ', h('b', { style: { color: 'var(--text)' } }, week), ' read'))));

    const listEl = h('section', { class: 'r-list', 'aria-label': '記事一覧' },
      h('div', { class: 'panel-head' }, h('span', null, S.reader.cat ? (CAT[S.reader.cat] || {}).tag : S.reader.queue, h('span', { class: 'k' }, ' · sorted by match')), h('span', { class: 'k' }, 'j/k で移動')),
      list.length ? list.map((it, i) => {
        const c = CAT[it.category] || {};
        return h('button', {
          type: 'button', class: `r-item${i === S.reader.sel ? ' on' : ''}${store.get(it.id) ? '' : ' unread'}`,
          onclick: () => { S.reader.sel = i; renderReader(); if (window.innerWidth <= 860) $('.r-detail').scrollIntoView({ behavior: 'smooth' }); },
        },
          h('span', { class: 'u', style: { background: store.get(it.id) ? 'transparent' : 'var(--accent)' } }),
          h('span', { class: 'b' },
            h('span', { class: 'meta' }, h('span', { style: { color: c.color } }, c.tag), h('span', null, it.source), h('span', { class: 'w' }, ago(it.published_at))),
            h('span', { class: 't' }, it.title),
            h('span', { class: 'sc' }, h('span', { class: 'bar' }, h('span', { style: { width: `${it.score}%`, background: 'var(--accent)' } })), `${it.score}% · ${it.read_min || '?'} min`)));
      }) : empty('このキューは空です'));

    const cur = list[S.reader.sel];
    let detail;
    if (!cur) {
      detail = h('article', { class: 'r-detail' }, empty('記事を選んでください'));
    } else {
      const c = CAT[cur.category] || { color: '#8B95A7' };
      const related = S.day.items.filter((x) => x.id !== cur.id && (x.keywords || []).some((k) => (cur.keywords || []).includes(k))).slice(0, 4);
      const st = store.get(cur.id);
      detail = h('article', { class: 'r-detail', style: { '--cc': c.color } },
        h('div', { class: 'scroll' },
          h('div', { class: 'meta', style: { display: 'flex', gap: '10px', alignItems: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted)', flexWrap: 'wrap' } },
            catChip(cur.category), h('span', null, cur.source), h('span', null, '·'), h('span', null, ago(cur.published_at)), cur.read_min && h('span', null, `· ${cur.read_min} min`), cur.signal && h('span', { class: 'up' }, `· ${cur.signal}`)),
          h('h1', null, h('a', { href: cur.url, target: '_blank', rel: 'noopener' }, cur.title)),
          h('div', { class: 'panel tldr' }, h('span', { class: 'label' }, 'TL;DR'), h('div', null, cur.tldr)),
          (cur.points || []).length ? h('div', { class: 'points' }, h('span', { class: 'label' }, 'KEY POINTS'), cur.points.map((p) => h('div', null, p))) : null,
          cur.code && cur.code.text ? h('div', { class: 'code' }, h('div', { class: 'hd' }, h('span', null, cur.code.file || cur.code.lang || 'snippet'), h('span', null, '記事内のコードを抽出')), h('pre', null, cur.code.text)) : null,
          (cur.keywords || []).length ? h('div', { class: 'tags', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, cur.keywords.map((k) => h('a', { class: 'tag', href: '#radar', onclick: () => { S.radarSel = k; } }, '#' + k))) : null,
          h('div', { class: 'related' }, h('span', { class: 'label' }, 'RELATED · 同じキーワードの記事'), related.length ? related.map((r) => h('a', { href: r.url, target: '_blank', rel: 'noopener' }, '↳ ' + r.title)) : h('div', { class: 'faint', style: { fontSize: '12px' } }, '（なし）'))),
        h('div', { class: 'r-actions' },
          h('a', { class: 'btn primary', href: cur.url, target: '_blank', rel: 'noopener', onclick: () => { if (!st) store.set(cur.id, 'done'); } }, h('kbd', null, 'o'), 'open'),
          h('button', { type: 'button', class: 'btn' + (st === 'later' ? ' on' : ''), onclick: () => act('s') }, h('kbd', null, 's'), 'later'),
          h('button', { type: 'button', class: 'btn' + (st === 'done' ? ' on' : ''), onclick: () => act('e') }, h('kbd', null, 'e'), 'done'),
          h('button', { type: 'button', class: 'btn' + (muted.includes(cur.category) ? ' on' : ''), onclick: () => act('m') }, h('kbd', null, 'm'), muted.includes(cur.category) ? 'unmute topic' : 'mute topic'),
          h('span', { class: 'pos' }, `${S.reader.sel + 1} / ${list.length}`)));
    }
    root.append(side, listEl, detail);
    const on = listEl.querySelector('.r-item.on');
    if (on && on.scrollIntoViewIfNeeded) on.scrollIntoViewIfNeeded(false);
  }

  function act(key) {
    const list = readerItems();
    const cur = list[S.reader.sel];
    if (key === 'j') S.reader.sel = Math.min(list.length - 1, S.reader.sel + 1);
    else if (key === 'k') S.reader.sel = Math.max(0, S.reader.sel - 1);
    else if (!cur) return;
    else if (key === 'o') { window.open(cur.url, '_blank', 'noopener'); if (!store.get(cur.id)) store.set(cur.id, 'done'); }
    else if (key === 's') store.set(cur.id, store.get(cur.id) === 'later' ? null : 'later');
    else if (key === 'e') store.set(cur.id, store.get(cur.id) === 'done' ? null : 'done');
    else if (key === 'm') store.toggleMute(cur.category);
    renderReader();
  }

  // ---------- radar ----------
  const RINGS = ['HOT', 'RISING', 'WATCH', 'COOLING'];
  const RING_R = [[16, 92], [102, 178], [188, 262], [272, 346]];
  const QSTART = [180, 270, 0, 90];

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
    if (!kws.length) { root.append(panel(cmd('radar render'), empty('キーワードの集計がまだありません。数日分たまるとレーダーに表示されます。'))); return; }
    if (!S.radarSel || !kws.find((k) => k.kw === S.radarSel)) S.radarSel = kws[0].kw;

    const svg = s('svg', { viewBox: '0 0 740 740', 'aria-hidden': 'true' },
      s('circle', { cx: 370, cy: 370, r: 355, fill: '#0D1117', stroke: '#222A36' }),
      s('circle', { cx: 370, cy: 370, r: 267, fill: '#0F141B', stroke: '#222A36' }),
      s('circle', { cx: 370, cy: 370, r: 183, fill: '#121822', stroke: '#2A3341' }),
      s('circle', { cx: 370, cy: 370, r: 97, fill: '#172030', stroke: '#3A4556' }),
      s('path', { d: 'M370 15 V725 M15 370 H725', stroke: '#2A3341', 'stroke-width': 1.5 }),
      RINGS.map((r, i) => s('text', { x: 378, y: [292, 203, 118, 34][i], fill: i === 0 ? '#7EE787' : i === 3 ? '#5C6678' : '#8B95A7', 'font-family': 'JetBrains Mono, monospace', 'font-size': 11 }, r)),
      S.cfg.quadrants.map((q, i) => s('text', { x: i === 1 || i === 2 ? 710 : 30, y: i < 2 ? 36 : 716, fill: q.color, 'font-family': 'JetBrains Mono, monospace', 'font-size': 13, 'font-weight': 700, 'text-anchor': i === 1 || i === 2 ? 'end' : 'start' }, q.label)));

    // place blips: 同じ象限・同じリングのキーワードを角度方向に等間隔で並べる
    const groups = {};
    kws.forEach((k) => { const key = CAT[k.category].quadrant + '|' + k.ring; (groups[key] = groups[key] || []).push(k); });
    const MOVE = { up: ['▲', 'var(--up)'], down: ['▼', 'var(--down)'], new: ['+', 'var(--text)'], stay: ['', ''] };
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
          style: { left: `${(x / 740) * 100}%`, top: `${(y / 740) * 100}%`, borderColor: on ? c : null, background: on ? mix(c, 0.28).bg : null },
          onclick: () => { S.radarSel = k.kw; renderRadar(); },
        }, h('i', { style: { borderColor: c, background: k.move === 'new' ? 'transparent' : c } }), k.kw, MOVE[k.move] && MOVE[k.move][0] && h('span', { style: { color: MOVE[k.move][1] } }, MOVE[k.move][0])));
      });
    });

    const sel = kws.find((k) => k.kw === S.radarSel);
    const c = CAT[sel.category];
    const weekly = [];
    for (let i = 0; i < 12; i++) weekly.push(sel.series.slice(i * 7, i * 7 + 7).reduce((a, b) => a + b, 0));
    const items = S.day ? S.day.items.concat(S.day.social).filter((x) => (x.keywords || []).includes(sel.kw)) : [];
    const moves = kws.filter((k) => k.move !== 'stay').slice(0, 10);
    const young = S.stats.history_days < 14;

    root.append(h('div', { class: 'radar-wrap' },
      h('div', { class: 'panel radar-panel' },
        h('div', { class: 'panel-head' }, pnl('keyword_radar', '中心ほど今アツい。点を選ぶと詳細'),
          h('span', { class: 'radar-legend' }, h('span', null, '● stay'), h('span', null, '○ new'), h('span', { class: 'up' }, '▲ in'), h('span', { class: 'down' }, '▼ out'))),
        h('div', { style: { padding: '0 16px' } }, h('div', { class: 'radar' }, svg, blips)),
        young && h('div', { class: 'hint', style: { padding: '0 16px 14px' } }, `// データ ${S.stats.history_days} 日分。前週比とリングの移動は 14 日分たまると正確になります`)),
      h('div', { class: 'stack', style: { flexGrow: 1 } },
        h('div', { class: 'panel inspect', style: { borderColor: c.color } },
          h('div', { class: 'panel-head' }, cmd(`radar inspect ${sel.kw}`), catChip(sel.category)),
          h('div', { class: 'panel-body', style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' } }, h('span', { class: 'kwname' }, sel.kw), h('span', { class: 'mono up' }, `${sel.ring} ${sel.prev_ring && sel.prev_ring !== sel.ring ? '← ' + sel.prev_ring : ''}`)),
            h('div', { class: 'stat3' },
              h('div', null, h('span', null, 'mentions_7d'), h('b', null, sel.c7)),
              h('div', null, h('span', null, 'wow'), h('b', { class: cls(sel.wow) }, sel.wow == null ? 'new' : pct(sel.wow))),
              h('div', null, h('span', null, 'first_seen'), h('b', { style: { fontSize: '15px' } }, sel.first_seen))),
            h('div', null, h('span', { class: 'label' }, 'trend_12w (weekly mentions)'), spark(weekly, 500, 80, c.color, true)),
            h('div', { class: 'related' }, h('span', { class: 'label' }, `ARTICLES · ${S.date}`), items.length ? items.slice(0, 6).map((x) => h('a', { href: x.url, target: '_blank', rel: 'noopener' }, '↳ ' + (x.title || x.text.slice(0, 60)))) : h('div', { class: 'faint', style: { fontSize: '12px' } }, 'この日の記事はありません')))),
        panel(cmd('git diff radar@last-week radar@now --stat'),
          h('div', { class: 'moves' }, moves.length ? moves.map((k) => {
            const m = MOVE[k.move];
            return h('div', { class: 'tr' }, h('span', { style: { width: '16px', color: m[1], fontWeight: 700 } }, m[0]), h('span', { style: { flexGrow: 1 } }, k.kw), h('span', { class: 'muted' }, k.prev_ring || '—'), h('span', { class: 'faint' }, '→'), h('span', { style: { color: m[1], width: '70px' } }, k.ring));
          }) : empty('先週からの移動はありません'))))));
  }

  // ---------- market ----------
  function heatColor(d) {
    if (d == null) return { bg: '#2A3341', fg: '#E6EDF3' };
    const k = d >= 0 ? Math.min(1, d / 200) : Math.min(1, -d / 50);
    return mix(d >= 0 ? '#FF8A3D' : '#3B82F6', 0.18 + 0.75 * k, [26, 32, 41]);
  }

  function renderMarket() {
    const root = $('#view-market');
    root.replaceChildren();
    const ms = S.markets ? S.markets.series.filter((m) => inDomain(m.category)) : [];
    const kws = S.stats ? S.stats.keywords.filter((k) => inDomain(k.category) && k.c7 > 0) : [];

    root.append(h('div', { class: 'ticker', 'aria-label': 'ティッカー' },
      ms.map((m) => h('span', null, h('b', null, m.label), h('span', { class: cls(m.d1) }, `${(m.d1 ?? 0) >= 0 ? '▲' : '▼'} ${pct(m.d1, 2)}`))),
      kws.filter((k) => k.wow != null).sort((a, b) => b.wow - a.wow).slice(0, 8).map((k) => h('span', null, h('b', null, k.kw.toUpperCase()), h('span', { style: { color: k.wow >= 0 ? '#FF9F5A' : '#6CA8FF' } }, `${k.wow >= 0 ? '▲' : '▼'} ${pct(k.wow)}`)))));

    if (ms.length) {
      root.append(panel2(h('span', null, pnl('market_indices'), h('span', { class: 'k' }, `  // ${S.markets.updated_at.slice(0, 16).replace('T', ' ')} 更新 · 1D / 1W / 1M`)), h('span', { class: 'k' }, 'source: Yahoo Finance'),
        h('div', { class: 'idx' }, ms.map((m) => {
          const c = (CAT[m.category] || {}).color;
          return h('div', { class: 'idx-card' },
            h('div', { class: 'top' }, h('span', { class: 'l' }, h('span', { class: 'dot', style: { background: c } }), m.label, m.stale && h('span', { class: 'stale' }, 'stale')), h('span', { class: 'faint', style: { fontSize: '10px' } }, m.date)),
            h('div', { class: 'top' }, h('span', { class: 'v', style: { fontSize: fmtNum(m.last).length > 9 ? '16px' : null } }, fmtNum(m.last), h('span', { class: 'faint', style: { fontSize: '11px', marginLeft: '4px' } }, m.unit)), spark(m.closes.slice(-60), 110, 34, (m.m1 ?? 0) >= 0 ? '#7EE787' : '#FF7B72', true)),
            h('div', { class: 'chg' }, [['1D', m.d1], ['1W', m.w1], ['1M', m.m1]].map(([l, v]) => h('span', null, l + ' ', h('b', { class: cls(v) }, pct(v, 2))))));
        }))));
    }

    const sectors = visibleCats().map((c) => {
      const tiles = kws.filter((k) => k.category === c.id).slice(0, 8);
      return { c, tiles, total: tiles.reduce((a, k) => a + k.c7, 0) };
    }).filter((x) => x.total > 0);
    root.append(panel2(h('span', null, pnl('keyword_market_map', '面積 = 直近7日の言及数、色 = 前週比')), h('span', { class: 'k' }, 'クリックでレーダーの詳細へ'),
      sectors.length ? h('div', { class: 'panel-body', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        h('div', { class: 'map' }, sectors.map(({ c, tiles, total }) => h('div', { class: 'sector', style: { flex: `${total} 1 0` } },
          h('div', { class: 'sh' }, h('span', { style: { color: c.color } }, c.tag), h('span', { class: 'muted' }, total)),
          tiles.map((k) => {
            const col = heatColor(k.wow);
            const big = k.c7 / total;
            return h('a', { class: 'tile', href: '#radar', onclick: () => { S.radarSel = k.kw; }, style: { flex: `${k.c7} 1 0`, background: col.bg, color: col.fg } },
              h('b', { style: { fontSize: big > 0.3 ? '18px' : big > 0.12 ? '13px' : '11px' } }, k.kw),
              h('span', { style: { fontSize: big > 0.3 ? '13px' : '10px' } }, k.wow == null ? `new · ${k.c7}` : `${pct(k.wow)} · ${k.c7}`));
          })))),
        h('div', { class: 'scale' }, 'cooling', [-50, -25, -10, 0, 50, 100, 200].map((v) => { const col = heatColor(v); return h('span', { class: 'sw', style: { background: col.bg, color: col.fg } }, pct(v)); }), 'heating', h('span', { class: 'sw', style: { background: '#2A3341', width: 'auto', padding: '0 8px' } }, 'new')))
        : empty('キーワードの集計がまだありません')));

    const withWow = kws.filter((k) => k.wow != null);
    const board = (title, color, rows, val) => h('div', { class: 'span-4 stack' }, panel(h('span', { style: { color, fontWeight: 700 } }, title),
      rows.length ? h('div', { class: 'moves' }, rows.slice(0, 6).map((k) => h('a', { class: 'tr', href: '#radar', onclick: () => { S.radarSel = k.kw; } }, h('span', { class: 'dot', style: { background: (CAT[k.category] || {}).color } }), h('span', { style: { flexGrow: 1 } }, k.kw), h('span', { class: 'muted' }, k.c7), h('span', { style: { color, width: '64px', textAlign: 'right', fontWeight: 700 } }, val(k))))) : empty('データ蓄積中')));
    root.append(h('div', { class: 'grid' },
      board('▲ top gainers', '#FF9F5A', withWow.slice().sort((a, b) => b.wow - a.wow).filter((k) => k.wow > 0), (k) => pct(k.wow)),
      board('▼ top losers', '#6CA8FF', withWow.slice().sort((a, b) => a.wow - b.wow).filter((k) => k.wow < 0), (k) => pct(k.wow)),
      board('◆ most mentioned', '#E6EDF3', kws.slice().sort((a, b) => b.c7 - a.c7), (k) => k.c7)));
  }

  // ---------- chrome ----------
  function renderStatus() {
    const d = S.day;
    $('#statusbar').replaceChildren(
      h('span', { class: 'mode' }, S.view === 'reader' ? 'READER' : 'NORMAL'),
      h('span', null, 'main'),
      h('span', { class: 'grow' }, `data/daily/${S.date || '—'}.json`),
      h('span', null, `domain:${S.domain}`),
      d && h('span', null, `${d.stats.sources_ok ?? '?'} sources`),
      d && h('span', null, `build ${hhmm(d.generated_at)} JST`),
      h('span', null, 'GitHub Pages'));
  }

  function render() {
    for (const v of ['today', 'reader', 'radar', 'market']) {
      $(`#view-${v}`).classList.toggle('on', v === S.view);
      const a = document.querySelector(`.tabs a[data-view="${v}"]`);
      a.classList.toggle('on', v === S.view);
      if (v === S.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    document.querySelectorAll('#domain button').forEach((b) => b.classList.toggle('on', b.dataset.domain === S.domain));
    ({ today: renderToday, reader: renderReader, radar: renderRadar, market: renderMarket })[S.view]();
    renderStatus();
  }

  async function loadDay(date) {
    S.date = date;
    S.day = date ? await getJSON(`data/daily/${date}.json`, true) : null;
    S.reader.sel = 0;
  }

  function route() {
    const v = location.hash.replace('#', '');
    S.view = ['today', 'reader', 'radar', 'market'].includes(v) ? v : 'today';
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
    sel.replaceChildren(...(dates.length ? dates.map((d) => h('option', { value: d }, d)) : [h('option', { value: '' }, 'no data')]));
    sel.addEventListener('change', async () => { await loadDay(sel.value); render(); });
    await loadDay(dates[0] || null);

    document.querySelectorAll('#domain button').forEach((b) => b.addEventListener('click', () => { S.domain = b.dataset.domain; store.domain(S.domain); S.pickFilter = 'all'; S.reader.cat = null; render(); }));
    const q = $('#q');
    q.addEventListener('input', () => { S.q = q.value.trim(); render(); });
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape' && typing) { e.target.blur(); return; }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); q.focus(); return; }
      if (S.view === 'reader' && ['j', 'k', 'o', 's', 'e', 'm'].includes(e.key)) { e.preventDefault(); act(e.key); }
    });
    window.addEventListener('hashchange', route);
    route();
  }

  init().catch((e) => {
    $('#app').replaceChildren(h('div', { class: 'view on' }, panel(cmd('radar init'), h('div', { class: 'empty' }, `読み込みに失敗しました: ${e.message}`))));
  });
})();
