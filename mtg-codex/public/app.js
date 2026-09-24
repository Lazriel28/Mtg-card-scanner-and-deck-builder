'use strict';
/* MTG Codex UI core: router + collection/decks/suggest views.
   Camera/OCR lives in scan.js. */

// ---------- tiny helpers ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick') n.addEventListener('click', v);
    else if (k === 'onchange') n.addEventListener('change', v);
    else if (k === 'oninput') n.addEventListener('input', v);
    else if (k === 'onerror') n.addEventListener('error', v);
    else if (k === 'class') n.className = v;
    else if (k.startsWith('data-')) n.dataset[k.slice(5)] = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
};

async function api(path, opts = {}) {
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, isError = false) {
  const t = el('div', { class: 'toast' + (isError ? ' error' : '') }, msg);
  $('#toast-holder').append(t);
  setTimeout(() => t.remove(), 3200);
}

function modal(contentEl) {
  const holder = $('#modal-holder');
  const backdrop = el('div', { class: 'backdrop', onclick: e => { if (e.target === backdrop) close(); } });
  const box = el('div', { class: 'modal' }, contentEl);
  backdrop.append(box);
  holder.append(backdrop);
  const close = () => backdrop.remove();
  return { close };
}

function esc(s) { return String(s ?? ''); }

// color letters from a card record's colors array
function colorLetters(colors) { return (colors || []).join(''); }

// ---------- status / sync ----------

let lastStatus = null;

async function refreshStatus() {
  try {
    lastStatus = await api('/api/status');
    const c = lastStatus.catalog;
    $('#topbar-status').textContent = c.synced
      ? `${c.cards.toLocaleString()} cards · ${lastStatus.collection.cards} owned · ${lastStatus.decks} decks`
      : 'catalog not synced';
    if (!c.synced && !lastStatus.sync.running) showSyncBanner('Card catalog not downloaded yet — one-time sync needed.', true);
    else if (lastStatus.sync.running) showSyncBanner(lastStatus.sync.msg, false, lastStatus.sync.frac);
    else hideSyncBanner();
  } catch { /* server hiccup; ignore */ }
}

function showSyncBanner(msg, actionable, frac = null) {
  const b = $('#sync-banner');
  b.classList.remove('hidden', 'error');
  b.textContent = '';
  b.append(msg + ' ');
  if (frac !== null) {
    const pr = el('progress', { max: '100', value: String(Math.round(frac * 100)) });
    b.append(pr);
  }
  if (actionable) {
    const btn = el('button', { class: 'primary', onclick: startSync }, 'Sync catalog now');
    b.append(btn);
  }
}

function hideSyncBanner() { $('#sync-banner').classList.add('hidden'); }

async function startSync() {
  try {
    await api('/api/sync', { method: 'POST' });
    toast('Catalog sync started — downloading Scryfall data');
    // live progress over SSE
    const es = new EventSource('/api/sync/progress');
    es.onmessage = e => {
      const st = JSON.parse(e.data);
      if (st.running) showSyncBanner(st.msg || 'syncing…', false, st.frac);
      if (st.error) { showSyncBanner('Sync failed: ' + st.error, true); es.close(); }
      if (st.done) {
        showSyncBanner(`Catalog ready — ${st.msg}`);
        es.close();
        refreshStatus();
        setTimeout(hideSyncBanner, 4000);
        if (currentView === 'collection') renderCollection();
      }
    };
    es.onerror = () => { es.close(); };
  } catch (e) { toast(e.message, true); }
}

// ---------- router ----------

let currentView = null;
const routes = { scan: renderScan, collection: renderCollection, decks: renderDecks, suggest: renderSuggest };

function nav(view) {
  if (!routes[view]) view = 'scan';
  currentView = view;
  for (const name of Object.keys(routes)) {
    $('#view-' + name).classList.toggle('hidden', name !== view);
  }
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  location.hash = view;
  routes[view]().catch(e => { toast(e.message, true); console.error(e); });
}

window.addEventListener('hashchange', () => {
  const v = location.hash.replace('#', '');
  if (v !== currentView) nav(v);
});

// ---------- collection view ----------

let collCache = null;
let activeCat = null;

async function renderCollection() {
  const view = $('#view-collection');
  view.textContent = 'Loading…';
  collCache = await api('/api/collection');
  drawCollection();
}

function drawCollection() {
  const view = $('#view-collection');
  view.textContent = '';
  const { entries, stats, byCategory } = collCache;

  // stat strip
  const strip = el('div', { class: 'statstrip' },
    el('div', { class: 'stat' }, el('div', { class: 'num' }, String(stats.totalCards)), el('div', { class: 'lbl' }, 'cards owned')),
    el('div', { class: 'stat' }, el('div', { class: 'num' }, String(stats.uniqueCards)), el('div', { class: 'lbl' }, 'unique cards')),
    el('div', { class: 'stat' }, el('div', { class: 'num' }, '$' + stats.totalValue.toFixed(2)), el('div', { class: 'lbl' }, 'approx value')),
  );

  // category chips
  const cats = Object.keys(byCategory).sort((a, b) => (byCategory[b].length - byCategory[a].length));
  const chipRow = el('div', { class: 'cats' });
  chipRow.append(el('div', { class: 'cat-chip' + (activeCat === null ? ' active' : ''), onclick: () => { activeCat = null; drawCollection(); } }, `All (${entries.length})`));
  for (const c of cats) {
    chipRow.append(el('div', { class: 'cat-chip' + (activeCat === c ? ' active' : ''), onclick: () => { activeCat = c; drawCollection(); } }, `${c} (${byCategory[c].length})`));
  }

  // add-by-name form
  const input = el('input', { placeholder: 'Add card by name…', id: 'add-name' });
  const qty = el('input', { type: 'number', value: '1', min: '1', style: 'width:64px' });
  const addBtn = el('button', {
    class: 'primary',
    onclick: async () => {
      try {
        await api('/api/collection/add', { method: 'POST', body: { name: input.value, qty: parseInt(qty.value, 10) || 1 } });
        toast('Added ' + input.value);
        input.value = ''; renderCollection();
      } catch (e) { toast(e.message, true); }
    },
  }, 'Add');
  const addForm = el('div', { class: 'panel row' }, input, qty, addBtn,
    el('span', { class: 'muted small grow' }, 'or scan a photo with the camera →'),
    el('button', { onclick: () => nav('scan') }, '📷 Scan'));

  // card tiles
  const shown = activeCat ? byCategory[activeCat] || [] : entries;
  const grid = el('div', { class: 'cardgrid' });
  for (const e of shown) {
    const img = e.photo
      ? el('img', { src: '/api/photos/' + e.photo, alt: e.name })
      : el('img', { src: '/api/cards/thumb?name=' + encodeURIComponent(e.name), alt: e.name,
          onerror: ev => { ev.target.style.visibility = 'hidden'; } });
    const tile = el('div', { class: 'cardtile' },
      el('div', { style: 'position:relative' },
        img,
        el('div', { class: 'qtybadge' }, '×' + e.qty)),
      el('div', { class: 'tilebody' },
        el('div', { class: 'tname' }, e.name),
        el('div', { class: 'tsub' }, (e.categories || []).slice(0, 3).join(' · ') + (e.value ? ` · $${e.value.toFixed(2)}` : ''))),
      el('div', { class: 'tileactions' },
        el('button', { onclick: () => changeQty(e, 1) }, '+1'),
        el('button', { onclick: () => changeQty(e, -1) }, '−1'),
        el('button', { class: 'danger', onclick: () => removeEntry(e) }, '✕')),
    );
    tile.addEventListener('click', ev => { if (!ev.target.closest('button')) showCardModal(e); });
    grid.append(tile);
  }
  if (!shown.length) grid.append(el('p', { class: 'muted' }, 'Nothing here yet — scan cards or add by name.'));

  view.append(strip, chipRow, addForm, grid);
}

async function changeQty(e, delta) {
  const q = e.qty + delta;
  await api('/api/collection/set', { method: 'POST', body: { name: e.name, qty: q } });
  renderCollection();
}

async function removeEntry(e) {
  await api('/api/collection/set', { method: 'POST', body: { name: e.name, qty: 0 } });
  toast('Removed ' + e.name);
  renderCollection();
}

function showCardModal(e) {
  const m = modal(el('div', {},
    el('h3', {}, e.name),
    el('p', { class: 'muted small' }, (e.categories || []).join(' · ')),
    el('p', {}, `Quantity: ${e.qty} · Condition: ${e.condition || 'NM'}${e.value ? ` · ~$${e.value.toFixed(2)}` : ''}`),
    e.photo ? el('img', { src: '/api/photos/' + e.photo, style: 'max-width:220px;border-radius:10px' }) : el('p', { class: 'muted small' }, 'No photo on file — scan the card to attach one.'),
  ));
  return m;
}

// bulk import modal
function showImportModal() {
  const ta = el('textarea', { rows: '10', style: 'width:100%', placeholder: '4x Lightning Bolt\n1 Black Lotus\n…' });
  const out = el('div');
  const go = async () => {
    try {
      const r = await api('/api/collection/import', { method: 'POST', body: { text: ta.value } });
      out.textContent = `Added ${r.added.length} lines` + (r.unknown.length ? ` · not recognized: ${r.unknown.join(', ')}` : '');
      renderCollection();
    } catch (e) { out.textContent = e.message; }
  };
  modal(el('div', {},
    el('h3', {}, 'Import a decklist'),
    ta,
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'primary', onclick: go }, 'Import'),
      el('button', { onclick: () => $('#modal-holder').textContent = '' }, 'Close')),
    out));
}

// ---------- decks view ----------

async function renderDecks() {
  const view = $('#view-decks');
  view.textContent = 'Loading…';
  const decks = await api('/api/decks');
  view.textContent = '';
  view.append(el('h1', {}, 'Decks'));

  const newBtn = el('button', { class: 'primary', onclick: showNewDeckModal }, '+ New deck');
  view.append(el('div', { class: 'row', style: 'margin-bottom:12px' }, newBtn,
    el('button', { onclick: showImportModal }, '📥 Import list to collection')));

  if (!decks.length) {
    view.append(el('p', { class: 'muted' }, 'No decks yet. Create one, or let Suggest build one for you.'));
    return;
  }
  for (const d of decks) {
    const item = el('div', { class: 'decklist-item', onclick: () => openDeck(d.id) },
      el('div', { class: 'grow' },
        el('div', { class: 'dname' }, d.name),
        el('div', { class: 'dsub' }, `${d.formatLabel} · ${d.size} cards${d.commander ? ' · ⭐ ' + d.commander : ''}`)),
      el('button', { class: 'danger', onclick: async ev => {
        ev.stopPropagation();
        if (confirm(`Delete deck "${d.name}"?`)) { await api('/api/decks/' + d.id, { method: 'DELETE' }); renderDecks(); }
      } }, '✕'));
    view.append(item);
  }
}

function showNewDeckModal() {
  const name = el('input', { placeholder: 'Deck name', style: 'width:100%' });
  const fmt = el('select', {},
    el('option', { value: 'commander' }, 'Commander (100, singleton)'),
    el('option', { value: 'sixty' }, '60-card (4-ofs)'));
  const cmdr = el('input', { placeholder: 'Commander name (Commander format)', style: 'width:100%' });
  const err = el('div', { class: 'muted small' });
  let closeFn = null;
  const create = async () => {
    try {
      const d = await api('/api/decks', { method: 'POST', body: { name: name.value, format: fmt.value, commander: cmdr.value || null } });
      if (closeFn) closeFn();
      openDeck(d.id);
    } catch (e) { err.textContent = e.message; }
  };
  const m = modal(el('div', {},
    el('h3', {}, 'New deck'),
    el('div', { class: 'row' }, name),
    el('div', { class: 'row', style: 'margin:8px 0' }, fmt),
    cmdr,
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { class: 'primary', onclick: create }, 'Create'),
      el('button', { onclick: () => m.close() }, 'Cancel')),
    err));
  closeFn = m.close;
}

async function openDeck(id) {
  const view = $('#view-decks');
  view.textContent = 'Loading…';
  const d = await api('/api/decks/' + id);
  const [v, missing] = await Promise.all([
    api('/api/decks/' + id + '/validate'),
    api('/api/decks/' + id + '/missing').catch(() => null),
  ]);
  view.textContent = '';
  view.append(el('h1', {}, d.name), el('p', { class: 'muted' },
    `${d.formatLabel} · ${d.size} cards${d.commander ? ' · ⭐ ' + d.commander : ''} · `,
    v.ok ? el('span', { class: 'okmark' }, '✓ legal') : el('span', { class: 'problems' }, v.problems.length + ' problems')));

  // problems block
  if (!v.ok) {
    const ul = el('ul', { class: 'problems' });
    for (const p of v.problems) ul.append(el('li', {}, p));
    view.append(el('div', { class: 'panel' }, el('strong', {}, 'Format problems'), ul));
  }

  // curve chart
  const chart = el('div', { class: 'barchart chartwrap' });
  const maxB = Math.max(1, ...Object.values(d.stats.curve));
  for (const [bucket, n] of Object.entries(d.stats.curve)) {
    const bar = el('div', { class: 'bar', style: `height:${(n / maxB) * 100}%` },
      el('span', {}, String(n)), el('div', { class: 'blab' }, bucket));
    chart.append(bar);
  }
  view.append(el('div', { class: 'panel' },
    el('strong', {}, 'Mana curve'),
    el('div', { class: 'muted small' }, `avg MV ${d.stats.avgCmc} · ${d.stats.lands} lands`),
    chart));

  // add-card row
  const addName = el('input', { placeholder: 'Add card to deck…', class: 'grow' });
  const sug = el('div', { style: 'position:relative' });
  addName.addEventListener('input', async () => {
    sug.textContent = '';
    if (addName.value.length < 2) return;
    const results = await api('/api/cards/search?q=' + encodeURIComponent(addName.value));
    const list = el('div', { style: 'position:absolute;top:100%;left:0;right:0;z-index:5;background:var(--panel2);border:1px solid var(--border);border-radius:8px;max-height:220px;overflow:auto' });
    for (const r of results) {
      list.append(el('div', { class: 'deckline', onclick: async () => {
        await api('/api/decks/' + id + '/card', { method: 'POST', body: { name: r.name } });
        openDeck(id);
      } }, el('span', { class: 'qty' }, r.manaCost || ''), r.name));
    }
    sug.append(list);
  });
  view.append(el('div', { class: 'panel row', style: 'position:relative' }, addName, sug));

  // deck lines
  const list = el('div', { class: 'panel', style: 'padding:0' });
  const ownMap = new Map((missing || []).map(x => [x.name.toLowerCase(), x]));
  for (const line of d.cards) {
    const own = ownMap.get(line.name.toLowerCase());
    list.append(el('div', { class: 'deckline' },
      el('span', { class: 'qty' }, String(line.qty)),
      el('span', { class: 'grow' }, line.name),
      own && own.missing > 0 ? el('span', { class: 'missing' }, `missing ${own.missing}`) : null,
      el('button', { onclick: async () => {
        await api('/api/decks/' + id + '/card/' + encodeURIComponent(line.name), { method: 'DELETE' });
        openDeck(id);
      } }, '✕')));
  }
  view.append(list);

  view.append(el('div', { class: 'row' },
    el('button', { onclick: renderDecks }, '← All decks'),
    el('button', { onclick: async () => {
      const r = await api('/api/suggest/record', { method: 'POST', body: { deck: d.cards, colors: v.colorIdentity } });
      toast('Recorded — suggestions will lean this way');
    } }, '🧠 Teach suggestions from this deck'),
    el('button', { class: 'primary', onclick: () => exportDeckText(d) }, '⬇ Export')));
}

function exportDeckText(d) {
  const lines = [];
  if (d.commander) lines.push(`Commander\n1 ${d.commander}\n`);
  lines.push('Deck');
  for (const c of d.cards) {
    if (d.commander && c.name === d.commander) continue;
    lines.push(`${c.qty} ${c.name}`);
  }
  if (d.sideboard && d.sideboard.length) {
    lines.push('', 'Sideboard');
    for (const c of d.sideboard) lines.push(`${c.qty} ${c.name}`);
  }
  const text = lines.join('\n');
  modal(el('div', {},
    el('h3', {}, 'Export ' + d.name),
    el('textarea', { rows: '14', style: 'width:100%' }, text),
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', { class: 'primary', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } catch { toast('Copy failed — select the text', true); }
      } }, 'Copy'),
      el('button', { onclick: () => $('#modal-holder').textContent = '' }, 'Close'))));
}

// ---------- suggest view ----------

const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

async function renderSuggest() {
  const view = $('#view-suggest');
  view.textContent = '';
  view.append(el('h1', {}, 'Deck suggestions'));

  const picks = { W: false, U: false, B: false, R: false, G: false };
  const fmtSel = el('select', {},
    el('option', { value: 'commander' }, 'Commander (100)'),
    el('option', { value: 'sixty' }, '60-card'));
  const picker = el('div', { class: 'colorpicker' });
  for (const c of Object.keys(picks)) {
    const b = el('button', { class: 'colorbtn ' + c, onclick: () => { picks[c] = !picks[c]; b.classList.toggle('on'); } }, c);
    picker.append(b);
  }
  const out = el('div');
  const go = async () => {
    out.textContent = 'Crunching your collection…';
    try {
      const colors = Object.keys(picks).filter(c => picks[c]);
      const q = new URLSearchParams({ format: fmtSel.value });
      if (colors.length) q.set('colors', colors.join(''));
      const r = await api('/api/suggest?' + q);
      drawSuggestion(out, r);
    } catch (e) { out.textContent = ''; toast(e.message, true); }
  };
  view.append(el('div', { class: 'panel row' },
    el('strong', {}, 'Format'), fmtSel,
    el('strong', {}, 'Colors'), picker,
    el('button', { class: 'primary', onclick: go }, '✨ Suggest deck'),
    el('span', { class: 'muted small' }, 'no colors = your favorites from history')));

  // learned affinity hint
  try {
    const st = await api('/api/status');
    void st; // placeholder if we later surface affinity numbers
  } catch {}
  view.append(out);
}

function drawSuggestion(out, r) {
  out.textContent = '';
  const panel = el('div', { class: 'panel' });
  panel.append(el('h2', { style: 'margin-top:0' }, `Suggested ${r.format === 'commander' ? 'Commander' : '60-card'} deck — ${r.colors.length ? r.colors.join('') : 'all colors'}`));
  panel.append(el('p', { class: 'muted small' },
    `${r.stats.size} cards · ${r.stats.lands} lands · avg MV ${r.stats.avgCmc} (nonland)`));
  for (const n of r.notes) panel.append(el('p', { class: 'muted small' }, '⚠ ' + n));

  const chart = el('div', { class: 'barchart chartwrap' });
  // build curve client-side from records? server sends none — show list instead
  const list = el('div', { style: 'columns:2;column-gap:18px' });
  for (const line of r.deck) {
    list.append(el('div', { class: 'deckline' },
      el('span', { class: 'qty' }, String(line.qty)),
      el('span', { class: 'grow' }, line.name)));
  }
  panel.append(list);

  panel.append(el('div', { class: 'row', style: 'margin-top:12px' },
    el('button', { class: 'primary', onclick: async () => {
      const name = prompt('Save this suggestion as a deck named:', `${r.colors.join('') || 'All'} ${r.format === 'commander' ? 'Commander' : 'Sixty'}`);
      if (!name) return;
      const d = await api('/api/decks', { method: 'POST', body: { name, format: r.format, commander: null } });
      // add all cards via PATCH
      await api('/api/decks/' + d.id, { method: 'PATCH', body: { cards: r.deck } });
      await api('/api/suggest/record', { method: 'POST', body: { deck: r.deck, colors: r.colors } });
      toast('Saved as "' + name + '"');
      openDeck(d.id);
    } }, 'Save as deck'),
    el('button', { onclick: () => navigator.clipboard?.writeText(r.deck.map(l => `${l.qty} ${l.name}`).join('\n')) }, 'Copy list')));
  out.append(panel);
}

// ---------- boot ----------

window.addEventListener('DOMContentLoaded', async () => {
  $$('#nav a').forEach(a => a.addEventListener('click', ev => {
    ev.preventDefault();
    nav(a.dataset.view);
  }));
  await refreshStatus();
  nav(location.hash.replace('#', '') || 'scan');
  setInterval(refreshStatus, 30000);
});
