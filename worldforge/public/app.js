'use strict';
// WorldForge renderer logic (runs in sandbox; talks to Node only via window.wf).

(function () {
  const $ = id => document.getElementById(id);
  // safe wiring: a missing element logs a warning instead of killing every
  // later listener (this is how one bug used to break the whole UI)
  function on(id, ev, fn) {
    const el = $(id);
    if (el) el.addEventListener(ev, fn);
    else console.warn('[wf] missing element #' + id);
  }

  // ---------- boot ----------
  let world = null;
  let currentNote = null;
  let saveTimer = null;
  let graph = null;
  let searchQuery = '';

  // ---------- graph settings state (size / distance / repel / filters) ----------
  const GS_DEFAULTS = { size: 1, rest: 11, rep: 900, types: null, orphans: true };
  const gs = Object.assign({}, GS_DEFAULTS, JSON.parse(localStorage.getItem('wf.graphSettings') || '{}'));
  function saveGs() { localStorage.setItem('wf.graphSettings', JSON.stringify(gs)); }

  async function boot() {
    const st = await window.wf.status();
    if (!st.loaded) {
      if (st.lastVault) {
        try { await window.wf.loadVault(st.lastVault); } catch {}
      }
    }
    await refreshGraph();
  }

  async function refreshGraph() {
    const st = await window.wf.status();
    if (!st.loaded) {
      $('vault-label').textContent = 'No vault — click 📂 to choose one';
      return;
    }
    $('vault-label').textContent = st.root;
    graph = await window.wf.graph();
    $('search').disabled = false;
    // folder suggestions for the new-note bar
    const dirs = [...new Set(graph.nodes.map(n => n.dir).filter(d => d && d !== '.'))].sort();
    $('nn-folders').innerHTML = dirs.map(d => `<option value="${esc(d)}"></option>`).join('');
    await mountWorld();
  }

  // one remount path — the single place the world is (re)built
  async function mountWorld() {
    const view = world && world.getView ? world.getView() : null;
    $('scene').innerHTML = '';
    world = World3D.mount($('scene'), graph, {
      tooltipEl: $('tooltip'),
      onOpen: openNote,
      getPreview: notePreview,
      onNodeMenu: (e, u) => showNodeMenu(e.clientX, e.clientY, u),
      onCanvasMenu: (e) => showCanvasMenu(e.clientX, e.clientY),
      settings: { nodeScale: gs.size, rep: gs.rep, rest: gs.rest },
      initialView: view,
    });
    world.setFilters({ types: gs.types, orphans: gs.orphans });
    world.highlight(searchQuery);            // search survives rescans
    window.__wfWorld = world;                // test/debug handle
  }

  // ---------- note panel ----------
  async function openNote(id) {
    let n;
    try { n = await window.wf.note(id); } catch { return; }
    currentNote = n;
    $('np-crumb').textContent = n.dir && n.dir !== '.' ? n.dir : '';
    $('np-title').textContent = n.title;
    $('np-tags').innerHTML = (n.tags || []).map(t => `<a class="tagref" href="#">#${esc(t)}</a>`).join('');
    $('np-body').innerHTML = n.html;
    $('np-raw').value = n.raw || '';
    const links = [];
    if (n.backlinks && n.backlinks.length) {
      $('np-links').innerHTML =
        `<div class="grp"><h4>Backlinks</h4>${n.backlinks.map(l => linkHtml(l)).join('')}</div>` +
        (n.outgoing && n.outgoing.length ? `<div class="grp"><h4>Links out</h4>${n.outgoing.map(linkHtml).join('')}</div>` : '');
    } else if (n.outgoing && n.outgoing.length) {
      $('np-links').innerHTML = `<div class="grp"><h4>Links out</h4>${n.outgoing.map(linkHtml).join('')}</div>`;
    } else {
      $('np-links').innerHTML = '';
    }
    setEditMode(false);
    $('note-panel').classList.remove('hidden');
  }

  // hover preview: fetch once per node, cache on the world side
  async function notePreview(id) {
    try {
      const n = await window.wf.note(id);
      let body = (n.raw || '').replace(/^---\n[\s\S]*?\n---/, '').trim();
      body = body.replace(/\[\[|\]\]/g, '').replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim();
      return { title: n.title, type: n.type, dir: n.dir, snippet: body.slice(0, 240) };
    } catch { return null; }
  }

  function linkHtml(id) {
    const title = id.split('/').pop().replace(/\.md$/i, '');
    return `<a href="#" data-note-id="${esc(id)}" class="np-link">${esc(title)}</a>`;
  }

  function setEditMode(on) {
    $('np-body').classList.toggle('hidden', on);
    $('np-raw').classList.toggle('hidden', !on);
    $('np-savebar').classList.toggle('hidden', !on);
    $('np-edit').textContent = on ? 'Preview' : 'Edit';
    if (on) $('np-raw').focus();
  }

  on('np-edit', 'click', () => {
    if ($('np-raw').classList.contains('hidden')) setEditMode(true);
    else setEditMode(false);
  });
  on('np-close', 'click', () => $('note-panel').classList.add('hidden'));

  // ---------- manual (❓) ----------
  on('btn-manual', 'click', () => {
    $('manual-frame').src = 'manual.html';
    $('manual-overlay').classList.remove('hidden');
  });
  function closeManual() {
    $('manual-overlay').classList.add('hidden');
    $('manual-frame').src = 'about:blank';
    hideSuggestions();
  }
  on('manual-close', 'click', closeManual);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('manual-overlay').classList.contains('hidden')) closeManual();
      else $('note-panel').classList.add('hidden');
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !$('np-savebar').classList.contains('hidden')) {
      e.preventDefault(); save();
    }
  });
  on('np-save', 'click', save);

  async function save() {
    if (!currentNote) return;
    const wasEditing = !$('np-raw').classList.contains('hidden');
    await window.wf.saveNote(currentNote.id, $('np-raw').value);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(refreshGraph, 300); // debounce rescan
    await openNote(currentNote.id);
    if (wasEditing) setEditMode(true); // stay in the editor across saves
  }

  // link clicks inside rendered note + links list
  document.addEventListener('click', async e => {
    const wl = e.target.closest('a.wl:not(.missing)');
    if (wl && wl.getAttribute('href') && wl.getAttribute('href').startsWith('#note:')) {
      e.preventDefault();
      return openNote(decodeURIComponent(wl.getAttribute('href').slice(6)));
    }
    const np = e.target.closest('a.np-link');
    if (np) { e.preventDefault(); return openNote(np.getAttribute('data-note-id')); }
  });

  // ---------- search ----------
  on('search', 'input', e => {
    searchQuery = e.target.value.trim();
    if (world) world.highlight(searchQuery);
  });

  on('search', 'keydown', e => {
    if (e.key === 'Enter' && searchQuery && world) world.frameMatches();
  });

  // ---------- import (📥) ----------
  on('btn-import', 'click', async () => {
    const src = await window.wf.pickImport();
    if (!src) return;
    try {
      const r = await window.wf.importNotes(src, 'imports');
      world = null; $('scene').innerHTML = '';
      await refreshGraph();
      alert(`Imported ${r.imported} note${r.imported === 1 ? '' : 's'} into "imports"` +
        (r.skipped ? ` — ${r.skipped} skipped (already present, empty, or deleted long ago)` : ''));
    } catch (err) { alert('Import failed: ' + (err.message || err)); }
  });

  // ---------- link suggestions ("[[" in the editor) ----------
  let suggestBox = null, suggestItems = [], suggestIndex = 0, suggestStart = -1;
  let suggestSeq = 0; // invalidates stale async updates (they'd re-show the box after hide)
  const NOTE_LINK_RE = /\[\[([^\]\[]*)$/; // "[[" + partial, caret at end

  async function updateSuggestions() {
    const seq = ++suggestSeq;
    const ta = $('np-raw');
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = NOTE_LINK_RE.exec(upto);
    if (!m) { hideSuggestions(); return; }
    suggestStart = ta.selectionStart - m[1].length;
    const q = m[1].toLowerCase();
    let titles = [];
    try { titles = await window.wf.noteTitles(); } catch { return; }
    if (seq !== suggestSeq) return; // a newer update (or a hide) superseded us
    suggestItems = titles
      .filter(t => !q || t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
      .slice(0, 8);
    if (!suggestItems.length) { hideSuggestions(); return; }
    if (!suggestBox) {
      suggestBox = document.createElement('div');
      suggestBox.id = 'suggest-box';
      document.body.appendChild(suggestBox);
    }
    suggestBox.innerHTML = suggestItems.map((t, i) =>
      `<div class="sg-item${i === suggestIndex ? ' sel' : ''}" data-i="${i}">${esc(t.title)}</div>`).join('');
    const r = ta.getBoundingClientRect();
    suggestBox.style.display = 'block';
    suggestBox.style.left = Math.min(r.left + 40, window.innerWidth - 260) + 'px';
    suggestBox.style.top = Math.min(r.bottom - Math.min(suggestItems.length, 8) * 30 - 8, window.innerHeight - 60) + 'px';
    suggestIndex = Math.min(suggestIndex, suggestItems.length - 1);
    [...suggestBox.children].forEach((c, i) => c.classList.toggle('sel', i === suggestIndex));
  }

  function hideSuggestions() {
    suggestSeq++;
    if (suggestBox) suggestBox.style.display = 'none';
    suggestItems = []; suggestIndex = 0; suggestStart = -1;
  }

  function acceptSuggestion(idx) {
    const ta = $('np-raw');
    const t = suggestItems[idx];
    if (!t || suggestStart < 0) return hideSuggestions();
    const pos = ta.selectionStart;
    ta.value = ta.value.slice(0, suggestStart) + t.title + ']]' + ta.value.slice(pos);
    const caret = suggestStart + t.title.length + 2;
    ta.setSelectionRange(caret, caret);
    hideSuggestions();
    ta.focus();
  }

  on('np-raw', 'input', () => { suggestIndex = 0; updateSuggestions(); });
  on('np-raw', 'keydown', e => {
    if (!suggestItems.length || $('np-raw').classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); suggestIndex = (suggestIndex + 1) % suggestItems.length; updateSuggestions(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length; updateSuggestions(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSuggestion(suggestIndex); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSuggestions(); }
  });
  document.addEventListener('click', e => {
    const item = e.target.closest('.sg-item');
    if (item) { acceptSuggestion(parseInt(item.dataset.i, 10)); return; }
    if (suggestBox && !e.target.closest('#suggest-box') && e.target !== $('np-raw')) hideSuggestions();
  });

  // ---------- context menus (right-click) ----------
  const TYPE_COLORS = { Character: '#e5484d', Location: '#46a758', Item: '#f5a623', Lore: '#3b82f6' };
  let menuEl = null;

  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  function showMenu(x, y, items) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.id = 'ctx-menu';
    for (const it of items) {
      if (it.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; menuEl.appendChild(s); continue; }
      if (it.header) { const h = document.createElement('div'); h.className = 'ctx-header'; h.textContent = it.label; menuEl.appendChild(h); continue; }
      const b = document.createElement('div');
      b.className = 'ctx-item' + (it.danger ? ' danger' : '');
      b.textContent = it.label;
      if (it.color) b.style.color = it.color;
      b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); closeMenu(); it.action(); });
      menuEl.appendChild(b);
    }
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  }

  document.addEventListener('mousedown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('wheel', closeMenu, { passive: true });
  window.addEventListener('blur', closeMenu);

  function showNodeMenu(x, y, u) {
    showMenu(x, y, [
      { label: 'Open note', action: () => openNote(u.id) },
      { label: 'Edit note', action: async () => { await openNote(u.id); setEditMode(true); } },
      { label: 'Copy  [[' + u.title + ']]', action: () => window.wf.copyText('[[' + u.title + ']]') },
      { label: 'Reveal in folder', action: () => window.wf.openPath(u.dir && u.dir !== '.' ? u.dir : '.') },
      { sep: true },
      { header: 'Set type' },
      ...['Character', 'Location', 'Item', 'Lore'].map(t => ({
        label: t, color: TYPE_COLORS[t], action: () => setTypeFor(u.id, t),
      })),
      { label: 'Untyped (clear)', danger: true, action: () => setTypeFor(u.id, '') },
      { sep: true },
      { label: 'Delete note…', danger: true, action: () => {
        if (confirm('Delete "' + u.title + '"?\n\nIt moves to your vault\'s .trash folder — nothing is hard-deleted, and a backup is made first.')) deleteNoteById(u.id);
      } },
    ]);
  }

  async function setTypeFor(id, t) {
    try {
      await window.wf.setType(id, t);
      await refreshGraph();
      if (currentNote && currentNote.id === id) await openNote(id);
    } catch (err) { alert('Could not set type: ' + (err.message || err)); }
  }

  async function deleteNoteById(id) {
    try {
      await window.wf.deleteNote(id);
      if (currentNote && currentNote.id === id) { currentNote = null; $('note-panel').classList.add('hidden'); }
      world = null; $('scene').innerHTML = '';
      await refreshGraph();
    } catch (err) { alert('Could not delete note: ' + (err.message || err)); }
  }

  function showCanvasMenu(x, y) {
    showMenu(x, y, [
      { label: 'Rebuild graph (rescan vault)', action: () => { world = null; $('scene').innerHTML = ''; refreshGraph(); } },
      { label: 'Reset view', action: () => world && world.resetView() },
      { sep: true },
      { label: 'Import notes…', action: () => $('btn-import').click() },
      { label: 'Choose vault…', action: () => $('btn-vault').click() },
    ]);
  }

  // right-click on wikilinks / backlinks inside the note panel
  document.addEventListener('contextmenu', e => {
    const link = e.target.closest('a.wl, a.np-link');
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute('href') || '';
    const targetId = link.getAttribute('data-note-id') ||
      (href.startsWith('#note:') ? decodeURIComponent(href.slice(6)) : null);
    const missingTarget = link.getAttribute('data-missing');
    const label = link.textContent.trim();
    const items = [];
    if (targetId) items.push({ label: 'Open note', action: () => openNote(targetId) });
    items.push({ label: 'Copy  [[' + label + ']]', action: () => window.wf.copyText('[[' + (targetId ? targetId.split('/').pop().replace(/\.md$/i, '') : label) + ']]') });
    if (missingTarget) items.push({
      label: 'Create note “' + label + '”',
      action: async () => {
        try {
      const r = await window.wf.createNote(label, currentNote && currentNote.dir !== '.' ? currentNote.dir : '', '');
          await refreshGraph();
          await openNote(r.id);
          setEditMode(true);
        } catch (err) { alert('Could not create note: ' + (err.message || err)); }
      },
    });
    showMenu(e.clientX, e.clientY, items);
  });

  // ---------- new note (＋) ----------
  on('btn-new', 'click', () => {
    const bar = $('new-note-bar');
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) $('nn-title').focus();
  });
  on('nn-cancel', 'click', () => $('new-note-bar').classList.add('hidden'));
  on('nn-title', 'keydown', e => { if (e.key === 'Enter') createNote(); });
  on('nn-create', 'click', createNote);

  async function createNote() {
    const title = $('nn-title').value.trim();
    if (!title) { $('nn-title').focus(); return; }
    const type = $('nn-type').value;           // '' = untyped
    const folder = $('nn-folder').value.trim().replace(/^\/+|\/+$/g, '');
    try {
      const r = await window.wf.createNote(title, folder, type);
      $('new-note-bar').classList.add('hidden');
      $('nn-title').value = ''; $('nn-folder').value = ''; $('nn-type').value = '';
      await refreshGraph();
      await openNote(r.id);
      setEditMode(true);                        // write immediately
    } catch (err) { alert('Could not create note: ' + (err.message || err)); }
  }

  // ---------- rail ----------
  document.querySelectorAll('.rail-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      $('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'cards') Mtg.init(); // lazy-load the workshop
    });
  });

  // ---------- MTG workshop ----------
  const Mtg = (function () {
    const COLORS = { W: '#f5f0dc', U: '#3b7dd8', B: '#4b3a5a', R: '#d84b3b', G: '#3b9e5a', C: '#8b8b8b' };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let ready = false;
    let acItems = [], acSel = -1, acTarget = null;   // autocomplete state
    let bf = [];                                      // battlefield cards

    const mw = (name) => window.wf || (window.wfHarnessMock ? window.wfHarnessMock() : null); // bridge (harness injects a mock)

    async function init() {
      if (ready) return; ready = true;
      wireTabs(); wireSearch(); wireDeck(); wireBattlefield();
      await refreshCollection();
    }

    function wireTabs() {
      document.querySelectorAll('.mtg-tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.mtg-tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.mtg-pane').forEach(p => p.classList.remove('active'));
        t.classList.add('active');
        $('mtg-pane-' + t.dataset.mtgTab).classList.add('active');
      }));
    }

    // generic autocomplete: shared by card search and battlefield add.
    // ARIA combobox pattern: the input owns a listbox popup; options carry
    // their name and selected state for screen readers.
    let acSeq = 0;
    function attachAC(input, popup, onPick) {
      const listId = popup.id || 'mtg-ac-list-' + (++acSeq);
      if (!popup.id) popup.id = listId;
      popup.setAttribute('role', 'listbox');
      popup.setAttribute('aria-label', 'Card suggestions');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', listId);
      input.setAttribute('aria-autocomplete', 'list');
      const setExpanded = open => input.setAttribute('aria-expanded', String(open));
      let deb;
      input.addEventListener('input', () => {
        clearTimeout(deb);
        deb = setTimeout(async () => {
          const q = input.value.trim();
          if (!q) { hideAC(); setExpanded(false); return; }
          const res = await mw().mtgSearch(q);
          acItems = (res && res.ok ? res.data : []).slice(0, 12);
          acSel = -1; acTarget = input;
          popup.innerHTML = acItems.length
            ? acItems.map((c, i) => `<div class="mtg-ac-item" role="option" aria-selected="false" data-i="${i}"><span>${esc(c.name)}</span><span class="mana">${esc(c.mana || c.type || '')}</span></div>`).join('')
            : '<div class="mtg-ac-item muted" role="option" aria-selected="false">no matches</div>';
          popup.classList.remove('hidden');
          setExpanded(true);
        }, 120);
      });
      input.addEventListener('keydown', e => {
        if (popup.classList.contains('hidden')) {
          if (e.key === 'Enter') onPick(input.value.trim());
          return;
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); acSel = Math.min(acSel + 1, acItems.length - 1); paintAC(popup); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); acSel = Math.max(acSel - 1, 0); paintAC(popup); }
        else        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const pick = acSel >= 0 ? acItems[acSel] : acItems[0];
          if (pick) { input.value = pick.name; onPick(pick.name); }
          else onPick(input.value.trim());
          hideAC(); setExpanded(false);
        } else if (e.key === 'Escape') { hideAC(); setExpanded(false); e.stopPropagation(); }
      });
      popup.addEventListener('mousedown', e => {
        const item = e.target.closest('.mtg-ac-item[data-i]');
        if (item) { const pick = acItems[+item.dataset.i]; input.value = pick.name; onPick(pick.name); hideAC(); }
      });
    }
    function paintAC(popup) {
      popup.querySelectorAll('.mtg-ac-item').forEach((el, i) => {
        el.classList.toggle('sel', i === acSel);
        el.setAttribute('aria-selected', String(i === acSel));
      });
    }
    function hideAC() {
      document.querySelectorAll('.mtg-ac').forEach(p => {
        p.classList.add('hidden');
        p.querySelectorAll('[aria-selected]').forEach(el => el.setAttribute('aria-selected', 'false'));
      });
      acItems = []; acSel = -1;
    }
    document.addEventListener('click', e => {
      if (!e.target.closest('.mtg-searchbar') && !e.target.closest('.mtg-playbar')) hideAC();
    });

    function colorPips(colors) {
      return (colors && colors.length ? colors : ['C']).map(c =>
        `<span class="pip" style="background:${COLORS[c] || COLORS.C}" title="${c}" aria-hidden="true"></span>`).join('');
    }

    async function pickCard(name) {          // Enter in the card search
      if (!name) return;
      const res = await mw().mtgCard(name);
      const c = res && res.ok ? res.data : null;
      if (!c) { $('mtg-card-info').classList.add('hidden'); return; }
      const el = $('mtg-card-info');
      el.classList.remove('hidden');
      el.innerHTML = `
        ${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}
        <div class="info">
          <h3>${esc(c.name)} ${colorPips(c.colors)}</h3>
          <div class="cost">${esc(c.mana || '')} · ${esc(c.type || '')}</div>
          <div class="text">${esc(c.text || '')}</div>
          ${c.keywords && c.keywords.length ? `<div class="kw">${esc(c.keywords.join(', '))}</div>` : ''}
          ${c.faces ? `<div class="kw">faces: ${esc(c.faces.join(' / '))}</div>` : ''}
        </div>`;
      // CSP: external card images only render in Electron; harness shows text
      refreshCollection();
    }

    async function refreshCollection() {
      const res = await mw().mtgCollection();
      if (!res || !res.ok) return;
      const cards = res.data;
      $('mtg-coll-count').textContent = cards.reduce((a, c) => a + c.qty, 0);
      $('mtg-coll').innerHTML = cards.map(c => `
        <div class="mtg-coll-item">
          ${colorPips(c.colors)}
          <span class="nm" data-card="${esc(c.name)}" title="${esc(c.type || '')}">${esc(c.name)}</span>
          <input type="number" min="0" value="${c.qty}" data-qty="${esc(c.name)}" aria-label="${esc(c.name)} quantity">
          <button data-del="${esc(c.name)}" aria-label="Remove ${esc(c.name)} from collection">✕</button>
        </div>`).join('') || '<span class="muted">Collection empty — add cards above.</span>';
    }

    function wireSearch() {
      attachAC($('mtg-q'), $('mtg-ac'), pickCard);
      $('mtg-coll').addEventListener('click', async e => {
        if (e.target.dataset.del) {
          await mw().mtgCollectionSet(e.target.dataset.del, 0);
          refreshCollection();
        } else if (e.target.dataset.card) pickCard(e.target.dataset.card);
      });
      $('mtg-coll').addEventListener('change', async e => {
        if (e.target.dataset.qty !== undefined) {
          await mw().mtgCollectionSet(e.target.dataset.qty, Math.max(0, parseInt(e.target.value, 10) || 0));
          refreshCollection();
        }
      });
      $('mtg-paste-add').addEventListener('click', async () => {
        const lines = $('mtg-paste').value.split('\n').map(s => s.trim()).filter(Boolean);
        if (!lines.length) return;
        const res = await mw().mtgCollectionAdd(lines);
        if (res && res.ok) {
          const d = res.data;
          $('mtg-paste-status').textContent = `added ${d.added.length}, skipped ${d.skipped.length}${d.skipped.length ? ': ' + d.skipped.slice(0, 3).join(', ') : ''}`;
          $('mtg-paste').value = '';
          refreshCollection();
        }
      });
    }

    function wireDeck() {
      $('mtg-d-out').addEventListener('click', e => {
        const el = e.target.closest('.deck-line');
        if (el) pickCard(el.dataset.card);
      });
      $('mtg-d-build').addEventListener('click', async () => {
        const btn = $('mtg-d-build');
        btn.disabled = true; btn.textContent = 'Building…';
        try {
          const colSel = $('mtg-d-colors').value;
          const opts = { size: parseInt($('mtg-d-size').value, 10) };
          if (colSel) opts.colors = [colSel];
          const res = await mw().mtgSuggestDeck(opts);
          if (!res || !res.ok) throw new Error(res && res.error || 'failed');
          const d = res.data;
          const names = d.deck.flatMap(c => Array(c.qty).fill(c.name)); // multiplicity matters
          const cres = await mw().mtgCounters(names);
          renderDeck(d, cres && cres.ok ? cres.data : null);
        } catch (err) { $('mtg-d-out').innerHTML = `<div class="deck-notes">Build failed: ${esc(err.message)}</div>`; }
        btn.disabled = false; btn.textContent = 'Build me a deck';
        refreshCollection();
      });
    }

    function renderDeck(d, counters) {
      const curveMax = Math.max(1, ...Object.values(d.curve));
      const curve = Object.entries(d.curve).map(([k, v]) =>
        `<div style="height:${Math.round(v / curveMax * 44) + 4}px"><span>${v || ''}</span></div>`).join('');
      const line = c => `<div class="deck-line" data-card="${esc(c.name)}"><span>${esc(c.name)}</span><span class="q">${c.qty}</span></div>`;
      const nonland = d.deck.filter(c => !/Land/.test(c.type));
      const lands = d.deck.filter(c => /Land/.test(c.type));
      const groups = {};
      for (const c of nonland) {
        const k = c.colors.length ? c.colors.join('') : 'C';
        (groups[k] = groups[k] || []).push(c);
      }
      const groupHtml = Object.entries(groups).map(([k, list]) =>
        `<div class="deck-col"><h4>${esc(k)} — ${list.reduce((a, c) => a + c.qty, 0)}</h4>${list.map(line).join('')}</div>`).join('');
      $('mtg-d-out').innerHTML = `
        ${d.notes && d.notes.length ? `<div class="deck-notes"><ul>${d.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        <div class="curve">${curve}</div>
        <div class="deck-cols">${groupHtml}
          <div class="deck-col"><h4>Lands — ${lands.reduce((a, c) => a + c.qty, 0)}</h4>${lands.map(line).join('')}</div>
        </div>
        ${counters ? `
          <h4 class="mtg-vs">⚔️ What beats this deck</h4>
          <div class="deck-notes">${counters.weaknesses.map(w => `<div>• ${esc(w)}</div>`).join('') || '<div>• no obvious structural weakness found</div>'}</div>
          ${counters.counters.map(c => `<div class="counter-item"><b>${esc(c.name)}</b> ×${c.qty} — ${esc(c.why)}</div>`).join('')}
        ` : ''}`;
    }

    function wireBattlefield() {
      attachAC($('mtg-bf-add'), $('mtg-bf-ac'), addBfCard);
      $('mtg-life-plus').addEventListener('click', () => { $('mtg-life').textContent = +$('mtg-life').textContent + 1; });
      $('mtg-life-minus').addEventListener('click', () => { $('mtg-life').textContent = +$('mtg-life').textContent - 1; });
      $('mtg-d20').addEventListener('click', () => { $('mtg-bf-result').textContent = `🎲 d20: ${1 + Math.floor(Math.random() * 20)}`; });
      $('mtg-coin').addEventListener('click', () => { $('mtg-bf-result').textContent = '🪙 ' + (Math.random() < 0.5 ? 'Heads' : 'Tails'); });
      $('mtg-battlefield').addEventListener('click', e => {
        const card = e.target.closest('.bf-card');
        if (!card) return;
        const i = +card.dataset.i;
        if (e.target.dataset.act === 'tap') bf[i].tapped = !bf[i].tapped;
        else if (e.target.dataset.act === 'plus') bf[i].counters++;
        else if (e.target.dataset.act === 'minus') bf[i].counters = Math.max(0, bf[i].counters - 1);
        else if (e.target.dataset.act === 'x') { bf.splice(i, 1); }
        paintBf();
      });
    }

    async function addBfCard(name) {
      if (!name) return;
      const res = await mw().mtgCard(name);
      if (res && res.ok && res.data) {
        bf.push({ name: res.data.name, type: res.data.type || '', colors: res.data.colors || [], counters: 0, tapped: false });
        paintBf();
      }
    }

    function paintBf() {
      $('mtg-battlefield').innerHTML = bf.map((c, i) => `
        <div class="bf-card ${c.tapped ? 'tapped' : ''}" data-i="${i}">
          ${c.counters ? `<span class="cnt">${c.counters}</span>` : ''}
          <b>${esc(c.name)}</b><div class="muted">${esc(c.type)}</div>
          <div class="ctrl">
            <button data-act="tap">tap</button>
            <button data-act="plus">+1/+1</button>
            <button data-act="minus">−</button>
            <button data-act="x">✕</button>
          </div>
        </div>`).join('');
    }

    return { init };
  })();

  // ---------- mass delete ----------
  let mdSelected = new Set();
  function mdPaintCount() {
    const el = $('md-count');
    if (el) el.textContent = mdSelected.size + ' selected';
    const btn = $('md-delete');
    if (btn) btn.disabled = mdSelected.size === 0;
  }
  function mdRow(n) {
    const checked = mdSelected.has(n.id);
    return `<label class="md-item"><input type="checkbox" data-md="${esc(n.id)}" ${checked ? 'checked' : ''} aria-label="Select ${esc(n.title)} for deletion">
      <span>${esc(n.title)}</span><span class="spacer"></span><span class="dir">${esc(n.dir || '.')}</span></label>`;
  }
  function mdPaintList() {
    const q = ($('md-filter') && $('md-filter').value || '').trim().toLowerCase();
    const list = (graph ? graph.nodes : []).filter(n => !q || n.title.toLowerCase().includes(q));
    $('md-list').innerHTML = list.map(mdRow).join('') || '<div class="md-item muted">no notes match</div>';
    mdPaintCount();
  }
  function openMassDelete() {
    mdSelected = new Set();
    if ($('md-filter')) $('md-filter').value = '';
    mdPaintList();
    $('mass-delete-overlay').classList.remove('hidden');
    if ($('md-filter')) $('md-filter').focus();
  }
  on('btn-mass-delete', 'click', openMassDelete);
  on('md-close', 'click', () => $('mass-delete-overlay').classList.add('hidden'));
  on('md-filter', 'input', mdPaintList);
  on('md-list', 'change', e => {
    const id = e.target.dataset && e.target.dataset.md;
    if (!id) return;
    if (e.target.checked) mdSelected.add(id); else mdSelected.delete(id);
    mdPaintCount();
  });
  on('md-dupes', 'click', () => {
    const byTitle = {};
    for (const n of (graph ? graph.nodes : [])) (byTitle[n.title] = byTitle[n.title] || []).push(n);
    mdSelected = new Set();
    for (const list of Object.values(byTitle)) if (list.length > 1) list.forEach(n => mdSelected.add(n.id));
    mdPaintList();
  });
  on('md-delete', 'click', async () => {
    if (!mdSelected.size) return;
    const ids = [...mdSelected];
    if (!confirm(`Delete ${ids.length} note${ids.length === 1 ? '' : 's'}? They move to .trash and are recoverable.`)) return;
    try {
      const res = await window.wf.deleteNotes(ids);
      mdSelected = new Set();
      $('mass-delete-overlay').classList.add('hidden');
      await refreshGraph();
      alert(`Deleted ${res.deleted} note${res.deleted === 1 ? '' : 's'} — in .trash, recoverable.`);
    } catch (err) { alert('Mass delete failed: ' + (err.message || err)); }
  });

  // ---------- vault picker ----------
  on('btn-vault', 'click', async () => {
    const dir = await window.wf.pickVault();
    if (!dir) return;
    try {
      await window.wf.loadVault(dir);
      world = null; $('scene').innerHTML = '';
      await refreshGraph();
    } catch (err) { alert('Could not load vault: ' + (err.message || err)); }
  });

  // ---------- graph settings panel ----------
  on('btn-graph-settings', 'click', () => $('graph-settings').classList.toggle('hidden'));
  on('gs-close', 'click', () => $('graph-settings').classList.add('hidden'));
  on('gs-size', 'input', e => {
    gs.size = parseFloat(e.target.value);
    $('gs-size-val').textContent = '×' + gs.size.toFixed(2);
    if (world) world.applyScale(gs.size); // live, no re-layout
  });
  on('gs-size', 'change', () => saveGs());
  on('gs-rest', 'input', e => {
    gs.rest = parseInt(e.target.value, 10);
    $('gs-rest-val').textContent = gs.rest;
  });
  on('gs-rep', 'input', e => {
    gs.rep = parseInt(e.target.value, 10);
    $('gs-rep-val').textContent = gs.rep;
  });
  on('gs-rest', 'change', relayout);
  on('gs-rep', 'change', relayout);

  async function relayout() {
    saveGs();
    await mountWorld(); // new physics params → fresh layout (camera preserved)
  }

  function refreshChips() {
    document.querySelectorAll('.cat-chip').forEach(c => {
      if (c.dataset.type) c.classList.toggle('off', !!(gs.types && !gs.types.includes(c.dataset.type)));
      if (c.dataset.orphans) c.classList.toggle('off', !gs.orphans);
    });
  }
  document.querySelectorAll('.cat-chip').forEach(c => c.addEventListener('click', () => {
    if (c.dataset.type) {
      const cur = gs.types ? [...gs.types] : ['character', 'location', 'item', 'lore', 'untyped'];
      const t = c.dataset.type;
      const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
      gs.types = next.length === 5 ? null : next;
    } else {
      gs.orphans = !gs.orphans;
    }
    saveGs(); refreshChips();
    if (world) world.setFilters({ types: gs.types, orphans: gs.orphans });
  }));
  refreshChips();
  // init slider positions/values
  $('gs-size').value = gs.size; $('gs-size-val').textContent = '×' + Number(gs.size).toFixed(2);
  $('gs-rest').value = gs.rest; $('gs-rest-val').textContent = gs.rest;
  $('gs-rep').value = gs.rep; $('gs-rep-val').textContent = gs.rep;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  boot();
})();
