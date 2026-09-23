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
    const layout = await window.wf.getLayout();
    $('scene').innerHTML = '';
    world = World3D.mount($('scene'), graph, {
      tooltipEl: $('tooltip'),
      onOpen: openNote,
      getPreview: notePreview,
      onNodeMenu: (e, u) => showNodeMenu(e.clientX, e.clientY, u),
      onCanvasMenu: (e) => showCanvasMenu(e.clientX, e.clientY),
      settings: { nodeScale: gs.size, rep: gs.rep, rest: gs.rest },
      initialView: view,
      initialLayout: layout,
      onSaveLayout: (l) => window.wf.saveLayout({ nodes: l.nodes }),
      onUnpin: (ids) => window.wf.unpinLayout(ids),
      onDelete: deleteNotes,
    });
    world.setFilters({ types: gs.types, orphans: gs.orphans });
    world.highlight(searchQuery);            // search survives rescans
    window.__wfWorld = world;                // test/debug handle
  }

  // batch delete with confirm + flash; used by mass-delete and world selection
  async function deleteNotes(ids) {
    if (!ids || !ids.length) return;
    const label = ids.length === 1 ? `“${String(ids[0]).split('/').pop().replace(/\.md$/, '')}”` : `${ids.length} notes`;
    if (!confirm(`Delete ${label}? It goes to .trash — recoverable.`)) return;
    const r = await window.wf.deleteNotes(ids);
    const moved = r && r.moved ? r.moved.length : ids.length;
    alert(`Deleted ${moved} note${moved === 1 ? '' : 's'} — in .trash, recoverable.`);
    await refreshGraph();
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
      else if (world && world.handleKey && world.handleKey(e)) return; // world consumed Esc
      else $('note-panel').classList.add('hidden');
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !$('np-savebar').classList.contains('hidden')) {
      e.preventDefault(); save();
    }
  });

  // world hotkeys — single dispatch point, skipped while typing in inputs
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    if (['g', 'r', 's', 'a', 'delete', 'backspace'].includes(k) || e.key === 'Delete' || e.key === 'Backspace') {
      if (world && world.handleKey && world.handleKey(e)) e.preventDefault();
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
      { label: u.pinned ? '📌 Unpin (release node)' : '📌 Pin in place', action: () => {
        if (u.pinned) world.unpinAt(u.id);
        else world.pinAt(u.id);
      } },
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
      if (btn.dataset.view === 'maps') MapsView.init();
    });
  });

  // ---------- maps view ----------
  const MapsView = (function () {
    let ready = false, maps = [], current = null, placing = false;
    const wf = () => window.wf;
    const esc2 = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    async function init() {
      if (ready) return; ready = true;
      on('map-add', 'click', addMap);
      on('map-delete', 'click', removeCurrent);
      on('map-select', 'change', e => { current = maps.find(m => m.id === e.target.value) || null; paint(); });
      await reload();
      current = maps[0] || null;
      paint();
    }

    async function addMap() {
      try {
        const src = await wf().mapsPickImage();
        if (!src) return;
        const m = await wf().mapsAddImage(src);
        await reload();
        current = maps.find(x => x.id === m.id) || maps[maps.length - 1];
        paint();
      } catch (err) { alert('Could not add map: ' + (err.message || err)); }
    }

    async function removeCurrent() {
      if (!current) return;
      if (!confirm(`Remove map "${current.name}" and its pins? (The original image stays wherever you got it from.)`)) return;
      await wf().mapsRemove(current.id);
      await reload();
      current = maps[0] || null;
      paint();
    }

    async function reload() {
      const res = await wf().mapsList();
      maps = res && res.ok ? res.data : [];
    }

    function paint() {
      const sel = $('map-select');
      sel.innerHTML = maps.map(m => `<option value="${esc2(m.id)}" ${current && current.id === m.id ? 'selected' : ''}>${esc2(m.name)}</option>`).join('');
      if (current && !sel.value && maps.length) { sel.value = current.id; }
      const stage = $('map-stage');
      $('map-delete').disabled = !current;
      if (!current) { stage.innerHTML = '<p class="muted pad" id="map-empty">No maps yet — click <b>🗺 Add map image</b> to bring in a hand-drawn map, photo, or floor plan. Then click the image to pin a note there.</p>'; $('map-hint').textContent = ''; return; }
      $('map-hint').textContent = placing ? 'Click on the map to place the pin…' : 'Click the map to pin a note · click a pin to open the note · right-click a pin to remove it';
      stage.innerHTML = `<img class="map-img" src="vault-asset:///${String(current.file).replace(/\\/g, '/')}" alt="${esc2(current.name)}">`;
      for (const p of (current.pins || [])) stage.appendChild(pinEl(p));
      stage.onclick = onStageClick;
      stage.oncontextmenu = e => {
        const pinElm = e.target.closest('.map-pin');
        if (!pinElm) return;
        e.preventDefault();
        const p = current.pins[+pinElm.dataset.i];
        current.pins.splice(+pinElm.dataset.i, 1);
        savePins(); paint();
      };
    }

    function pinEl(p, i) {
      const d = document.createElement('div');
      d.className = 'map-pin'; d.dataset.i = i;
      d.style.left = (p.x * 100) + '%'; d.style.top = (p.y * 100) + '%';
      d.title = p.label || p.noteId || 'pin';
      d.innerHTML = `<span class="lbl">${esc2(p.label || '')}</span>`;
      d.onclick = e => { e.stopPropagation(); openNote(p.noteId); };
      return d;
    }

    function onStageClick(e) {
      if (!current) return;
      if (e.target.closest('.map-pin')) return;
      const stage = $('map-stage');
      const rect = stage.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
      askNoteForPin(x, y, e);
    }

    function askNoteForPin(x, y, ev) {
      // small popup with a note-title autocomplete (reuses wf.noteTitles)
      const stage = $('map-stage');
      const old = document.getElementById('map-pin-ac');
      if (old) old.remove();
      const box = document.createElement('div');
      box.id = 'map-pin-ac';
      box.innerHTML = `<input placeholder="Which note lives here? (Enter to pin)"><div class="mtg-ac hidden"></div>`;
      stage.appendChild(box);
      const rect = stage.getBoundingClientRect();
      box.style.left = Math.min(x * rect.width + 12, rect.width - 250) + 'px';
      box.style.top = Math.min(y * rect.height + 12, rect.height - 90) + 'px';
      const input = box.querySelector('input');
      const popup = box.querySelector('.mtg-ac');
      input.focus();
      let titles = [];
      wf().noteTitles().then(t => { titles = t; });
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        const hits = q ? titles.filter(t => t.title.toLowerCase().includes(q)).slice(0, 8) : titles.slice(0, 8);
        popup.innerHTML = hits.map((t, i) => `<div class="mtg-ac-item" data-id="${esc2(t.id)}"><span>${esc2(t.title)}</span></div>`).join('');
        popup.classList.toggle('hidden', !hits.length);
      });
      const commit = (noteId) => {
        if (!noteId) { box.remove(); return; }
        const t = titles.find(t => t.id === noteId);
        current.pins.push({ x, y, noteId, label: t ? t.title : noteId });
        savePins();
        box.remove(); paint();
      };
      popup.addEventListener('mousedown', e => {
        const item = e.target.closest('.mtg-ac-item');
        if (item) { commit(item.dataset.id); }
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const first = popup.querySelector('.mtg-ac-item');
          commit(first ? first.dataset.id : null);
        } else if (e.key === 'Escape') { box.remove(); }
      });
      setTimeout(() => {
        document.addEventListener('click', function away(ev) {
          if (!box.contains(ev.target)) { box.remove(); document.removeEventListener('click', away); }
        });
      }, 0);
    }

    async function savePins() {
      const res = await wf().mapsSave(maps);
      if (res && !res.ok) alert('Could not save pins: ' + res.error);
    }

    return { init };
  })();

  // ---------- publish view ----------
  on('pub-export', 'click', async () => {
    const btn = $('pub-export'), status = $('pub-status');
    try {
      const dir = await window.wf.publishPickDir();
      if (!dir) return;
      btn.disabled = true; status.textContent = 'Building…';
      const res = await window.wf.publishExport(dir);
      status.textContent = res.ok ? `Done — ${res.data.pages} pages in ${res.data.outDir}` : ('Failed: ' + res.error);
    } catch (err) { status.textContent = 'Failed: ' + (err.message || err); }
    btn.disabled = false;
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
      wireTabs(); wireSearch(); wireDeck(); wireBattlefield(); wireExtras();
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

    // ---- MTG extras ----
    function copyDeck() {
      const lines = [...document.querySelectorAll('#mtg-d-out .deck-line')]
        .map(el => el.querySelector('.q').textContent + ' ' + el.dataset.card);
      if (!lines.length) { alert('Build a deck first.'); return; }
      mw().copyText(lines.join('\n'));
      const btn = $('mtg-deck-copy');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = '📋 Copy decklist'; }, 1200); }
    }

    async function randomChallenge() {
      const res = await mw().mtgSearch('');
      const pool = res && res.ok ? res.data : [];
      if (!pool.length) return;
      const c = pool[Math.floor(Math.random() * pool.length)];
      const col = ['W', 'U', 'B', 'R', 'G'][Math.floor(Math.random() * 5)];
      $('mtg-d-colors').value = col;
      alert(`🎲 Challenge: build a ${col}-colored deck around "${c.name}" (${c.mana || c.type || ''}).\n\nPick that color in the deck builder and see what it suggests from your collection!`);
    }

    function cardFullscreen(name) {
      const info = $('mtg-card-info');
      if (!info || info.classList.contains('hidden')) return;
      const img = info.querySelector('img');
      if (!img) return;
      const ov = document.createElement('div');
      ov.id = 'mtg-fs';
      ov.innerHTML = `<img src="${img.src}" alt="${esc(name || 'card')}">`;
      ov.addEventListener('click', () => ov.remove());
      document.body.appendChild(ov);
    }

    function wireExtras() {
      const row = $('mtg-deck-actions');
      if (!row) return;
      $('mtg-deck-copy').addEventListener('click', copyDeck);
      $('mtg-deck-random').addEventListener('click', randomChallenge);
      $('mtg-bf-reset').addEventListener('click', () => { bf = []; paintBf(); $('mtg-bf-result').textContent = 'battlefield cleared'; });
      $('mtg-life-reset').addEventListener('click', () => { $('mtg-life').textContent = '20'; });
      $('mtg-life-log').addEventListener('click', () => {
        const v = $('mtg-life').textContent;
        const log = $('mtg-life-log-list');
        if (log) log.textContent = 'life at ' + new Date().toLocaleTimeString() + ': ' + v;
      });
      document.getElementById('mtg-card-info').addEventListener('dblclick', e => {
        cardFullscreen(e.target.closest('img') ? undefined : null);
      });
    }

    return { init, wireExtras };
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
    // Old importer renamed collisions to "Note 2", "Note 2 3" — strip those
    // trailing number suffixes before grouping, so "Koda" and "Koda 2" group
    // together. Within each family, the LARGEST note (the real content) is
    // kept and the rest are selected for deletion — empty "Koda 2" clones
    // never outrank the original.
    const baseOf = t => String(t).replace(/( \d+)+$/, '').trim().toLowerCase();
    const groups = {};
    for (const n of (graph ? graph.nodes : [])) (groups[baseOf(n.title)] = groups[baseOf(n.title)] || []).push(n);
    mdSelected = new Set();
    let families = 0;
    for (const list of Object.values(groups)) {
      if (list.length < 2) continue;
      families++;
      const keep = [...list].sort((a, b) => (b.size || 0) - (a.size || 0))[0];
      for (const n of list) if (n !== keep) mdSelected.add(n.id);
    }
    mdPaintList();
    if ($('md-count')) $('md-count').textContent = mdSelected.size + ' selected (' + families + ' duplicate families)';
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

  // ==================== command palette (Ctrl+K) ====================
  const cpCommands = [
    { label: 'New note', run: () => $('btn-new').click() },
    { label: 'Import notes from folder', run: () => $('btn-import').click() },
    { label: 'Mass delete notes', run: () => $('btn-mass-delete').click() },
    { label: 'Vault insights (stats, tags)', run: () => openInsights() },
    { label: 'Vault tools (broken links, backups)', run: () => openInspector() },
    { label: 'Graph settings', run: () => $('btn-graph-settings').click() },
    { label: 'Publish wiki site', run: () => switchView('publish') },
    { label: 'Maps', run: () => switchView('maps') },
    { label: 'MTG workshop', run: () => switchView('cards') },
    { label: 'Open field manual', run: () => $('btn-manual').click() },
    { label: 'Choose vault folder', run: () => $('btn-vault').click() },
    { label: 'Reset world view', run: () => { if (world) world.resetView(); } },
    { label: 'Select all visible nodes', run: () => { if (world && world.handleKey) world.handleKey({ key: 'a', target: document.body, preventDefault() {} }); } },
    { label: 'Save positions (pin world)', run: () => { const b = $('sel-pin'); if (b && !$('sel-panel').classList.contains('hidden')) b.click(); } },
    { label: 'Arrange selection in a circle', run: () => arrangeSelection('circle') },
    { label: 'Arrange selection in a line', run: () => arrangeSelection('line') },
    { label: 'Isolate selection neighborhood', run: () => isolateSelection() },
    { label: 'Save world as PNG image', run: () => snapshotPNG() },
    { label: 'Toggle light/dark theme', run: () => toggleTheme() },
    { label: 'Writing sprint timer', run: () => startSprint() },
    { label: 'Random note', run: () => openRandom() },
    { label: 'Daily note', run: () => createDailyNote() },
    { label: 'Open .trash folder', run: () => window.wf.openTrash() },
    { label: 'Open backups folder', run: () => window.wf.openBackups() },
    { label: 'Find & replace in current note', run: () => subFindReplace() },
    { label: 'Note outline (table of contents)', run: () => subTOC() },
    { label: 'Insert template…', run: () => subTemplate() },
    { label: 'Copy note as plain text', run: () => exportNote('txt') },
    { label: 'Copy note as raw markdown', run: () => exportNote('raw') },
    { label: 'Duplicate current note', run: () => duplicateCurrent() },
    { label: 'Rename current note…', run: () => subRename() },
    { label: 'Move current note…', run: () => subMove() },
  ];
  let cpOpen = false, cpIdx = 0, cpFiltered = [];
  function openPalette() {
    cpOpen = true; cpIdx = 0;
    $('cmd-palette').classList.remove('hidden');
    $('cp-input').value = '';
    cpPaint('');
    $('cp-input').focus();
  }
  function closePalette() {
    cpOpen = false;
    $('cmd-palette').classList.add('hidden');
  }
  function cpPaint(q) {
    const needle = q.trim().toLowerCase();
    cpFiltered = cpCommands.filter(c => !needle || c.label.toLowerCase().includes(needle));
    cpIdx = Math.min(cpIdx, Math.max(0, cpFiltered.length - 1));
    $('cp-list').innerHTML = cpFiltered.map((c, i) =>
      `<div class="cp-item${i === cpIdx ? ' active' : ''}" role="option" aria-selected="${i === cpIdx}" data-i="${i}"><span>${esc(c.label)}</span></div>`).join('');
  }
  on('btn-palette', 'click', openPalette);
  on('cp-input', 'input', e => { cpIdx = 0; cpPaint(e.target.value); });
  on('cp-input', 'keydown', e => {
    if (e.key === 'Escape') { closePalette(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { cpIdx = Math.min(cpIdx + 1, cpFiltered.length - 1); cpPaint($('cp-input').value); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { cpIdx = Math.max(cpIdx - 1, 0); cpPaint($('cp-input').value); e.preventDefault(); }
    else if (e.key === 'Enter') {
      const c = cpFiltered[cpIdx];
      closePalette();
      if (c) c.run();
      e.preventDefault();
    }
  });
  on('cp-list', 'click', e => {
    const item = e.target.closest('.cp-item');
    if (!item) return;
    const c = cpFiltered[+item.dataset.i];
    closePalette();
    if (c) c.run();
  });
  document.addEventListener('mousedown', e => {
    if (cpOpen && !$('cmd-palette').contains(e.target) && e.target.id !== 'btn-palette') closePalette();
  });

  // ==================== insights panel (📊) ====================
  async function openInsights() {
    $('insights-overlay').classList.remove('hidden');
    $('inspector-overlay').classList.add('hidden');
    $('insights-body').innerHTML = '<span class="muted">Crunching…</span>';
    const [s, tags, recent, streak] = await Promise.all([
      window.wf.stats(), window.wf.tags(), window.wf.recentEdits(), window.wf.streak(),
    ]);
    const d = s.ok ? s.data : s;
    const tg = tags.ok ? tags.data : tags;
    const rc = recent.ok ? recent.data : recent;
    const st = streak.ok ? streak.data : streak;
    const fmt = n => (n || 0).toLocaleString();
    $('insights-body').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><b>${fmt(d.notes)}</b><span>notes</span></div>
        <div class="stat"><b>${fmt(d.words)}</b><span>words written</span></div>
        <div class="stat"><b>${fmt(d.links)}</b><span>wiki links</span></div>
        <div class="stat"><b>${st.streak}🔥</b><span>day streak</span></div>
        <div class="stat"><b>${fmt(d.orphans)}</b><span>orphan notes</span></div>
        <div class="stat"><b>${fmt(d.editedLast7Days)}</b><span>edited this week</span></div>
      </div>
      <div class="ins-sec"><h4>Types</h4><div class="tagbar">${Object.entries(d.byType).map(([t, c]) => `<span class="tag-pill">${esc(t)} × ${c}</span>`).join('')}</div></div>
      <div class="ins-sec"><h4>Top tags</h4><div class="tagbar">${tg.slice(0, 14).map(x => `<span class="tag-pill" data-tag="${esc(x.tag)}">${esc(x.tag)} × ${x.count}</span>`).join('') || '<span class="muted">none yet</span>'}</div></div>
      <div class="ins-sec"><h4>Biggest notes</h4><ul class="ins-list">${d.biggest.map(n => `<li><a data-open="${esc(n.id)}">${esc(n.title)}</a> <span class="muted">${fmt(n.words)} words</span></li>`).join('')}</ul></div>
      <div class="ins-sec"><h4>Recently edited</h4><ul class="ins-list">${rc.map(n => `<li><a data-open="${esc(n.id)}">${esc(n.title)}</a></li>`).join('')}</ul></div>`;
    wireInsLinks();
    $('insights-body').querySelectorAll('[data-tag]').forEach(p =>
      p.addEventListener('click', async () => {
        const r = await window.wf.tagNotes(p.dataset.tag);
        const notes = r.ok ? r.data : r;
        $('insights-body').innerHTML = `<div class="ov-head"><b>#${esc(p.dataset.tag)}</b><button id="tag-back" class="hud-btn">← back</button></div>
          <ul class="ins-list">${notes.map(n => `<li><a data-open="${esc(n.id)}">${esc(n.title)}</a></li>`).join('')}</ul>`;
        wireInsLinks();
        on('tag-back', 'click', openInsights);
      }));
  }
  function wireInsLinks() {
    $('insights-body').querySelectorAll('[data-open]').forEach(a =>
      a.addEventListener('click', () => { $('insights-overlay').classList.add('hidden'); openNote(a.dataset.open); }));
  }
  on('btn-insights', 'click', openInsights);
  on('insights-close', 'click', () => $('insights-overlay').classList.add('hidden'));

  // ==================== inspector — vault tools (🔍) ====================
  async function openInspector() {
    $('inspector-overlay').classList.remove('hidden');
    $('insights-overlay').classList.add('hidden');
    $('inspector-body').innerHTML = '<span class="muted">Scanning…</span>';
    const [broken, stats] = await Promise.all([window.wf.brokenLinks(), window.wf.stats()]);
    const bk = broken.ok ? broken.data : broken;
    const st = stats.ok ? stats.data : stats;
    const groups = {};
    for (const b of bk) (groups[b.target] = groups[b.target] || []).push(b);
    $('inspector-body').innerHTML = `
      <div class="ins-sec"><h4>Broken links (${bk.length})</h4>
        ${bk.length ? `<ul class="ins-list">${Object.entries(groups).slice(0, 20).map(([target, uses]) =>
          `<li>[[${esc(target)}]] — used in ${uses.map(u => `<a data-open="${esc(u.from)}">${esc(u.fromTitle)}</a>`).join(', ')}</li>`).join('')}</ul>
          <div class="row" style="margin-top:8px"><button id="fix-first-broken" class="hud-btn">Create first missing note</button></div>` : '<span class="muted">None — every link resolves. 🎉</span>'}
      </div>
      <div class="ins-sec"><h4>Vault hygiene</h4>
        <ul class="ins-list">
          <li><a id="ins-open-trash">Open .trash folder</a> — deleted notes live here</li>
          <li><a id="ins-open-backups">Open backups folder</a> — automatic safety copies</li>
          <li>Orphan notes: <b>${st.orphans}</b> (hide via ⚙ Orphans chip)</li>
        </ul>
      </div>`;
    $('inspector-body').querySelectorAll('[data-open]').forEach(a =>
      a.addEventListener('click', () => { $('inspector-overlay').classList.add('hidden'); openNote(a.dataset.open); }));
    const mk = $('fix-first-broken');
    if (mk) mk.addEventListener('click', async () => {
      const title = Object.keys(groups)[0].split('#')[0];
      await window.wf.createNote(title, '', '');
      $('inspector-overlay').classList.add('hidden');
      await refreshGraph();
      openNote(title + '.md');
    });
    on('ins-open-trash', 'click', () => window.wf.openTrash());
    on('ins-open-backups', 'click', () => window.wf.openBackups());
  }
  on('btn-inspector', 'click', openInspector);
  on('inspector-close', 'click', () => $('inspector-overlay').classList.add('hidden'));

  // ==================== note tool row ====================
  function curId() { return currentNote ? currentNote.id : null; }
  function subbar(html) { $('np-subbar').innerHTML = html; $('np-subbar').classList.remove('hidden'); }
  function subbarHide() { $('np-subbar').classList.add('hidden'); $('np-subbar').innerHTML = ''; }

  function subTOC() {
    if (!currentNote) return;
    const body = currentNote.raw || '';
    const hs = [];
    const re = /^(#{1,3})\s+(.+)$/gm;
    let m;
    while ((m = re.exec(body))) hs.push({ level: m[1].length, text: m[2].trim() });
    if (!hs.length) { subbar('<span class="muted">No headings in this note.</span>'); return; }
    subbar(hs.map(h => `<span class="toc-link l${h.level}" data-h="${esc(h.text)}">${'·'.repeat(h.level - 1)} ${esc(h.text)}</span>`).join(''));
    $('np-subbar').querySelectorAll('.toc-link').forEach(a =>
      a.addEventListener('click', () => {
        subbarHide();
        setEditMode(false);
        const el = [...$('np-body').querySelectorAll('h1,h2,h3')]
          .find(e => e.textContent.trim() === a.dataset.h);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
  }

  function subFindReplace() {
    if (!currentNote) return;
    setEditMode(true);
    subbar(`<div class="row"><input id="fr-find" placeholder="Find…" aria-label="Find"><input id="fr-replace" placeholder="Replace with…" aria-label="Replace with"><button id="fr-count" class="hud-btn">Count</button><button id="fr-all" class="hud-btn">Replace all</button></div><span id="fr-status" class="muted" aria-live="polite"></span>`);
    const status = $('fr-status');
    $('fr-count').addEventListener('click', () => {
      const n = countOccurrences($('np-raw').value, $('fr-find').value);
      status.textContent = `${n} match${n === 1 ? '' : 'es'}`;
    });
    $('fr-all').addEventListener('click', () => {
      const f = $('fr-find').value;
      if (!f) { status.textContent = 'Type something to find.'; return; }
      const n = countOccurrences($('np-raw').value, f);
      $('np-raw').value = $('np-raw').value.split(f).join($('fr-replace').value);
      status.textContent = `Replaced ${n} — remember to save (Ctrl+S)`;
    });
    $('fr-find').focus();
  }
  function countOccurrences(hay, needle) { return needle ? hay.split(needle).length - 1 : 0; }

  async function subTemplate() {
    if (!currentNote) return;
    const r = await window.wf.listTemplates();
    const ts = r.ok ? r.data : r;
    if (!ts.length) { alert('No templates yet.\n\nCreate a "templates" folder in your vault with .md files in it — they will appear here.'); return; }
    subbar(`<div class="row"><select id="tpl-pick" aria-label="Template">${ts.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}</select><button id="tpl-insert" class="hud-btn">Insert</button></div>`);
    $('tpl-insert').addEventListener('click', async () => {
      const t = await window.wf.getTemplate($('tpl-pick').value);
      const text = t.ok ? t.data : t;
      setEditMode(true);
      const ta = $('np-raw');
      const at = ta.selectionStart || ta.value.length;
      ta.value = ta.value.slice(0, at) + text + ta.value.slice(at);
      subbarHide();
      alert('Template inserted — remember to save (Ctrl+S).');
    });
  }

  function subRename() {
    if (!currentNote) return;
    subbar(`<div class="row"><input id="rn-input" value="${esc(currentNote.title)}" aria-label="New title"><button id="rn-go" class="hud-btn">Rename</button></div><span class="muted">Every [[link]] to this note is rewritten automatically.</span>`);
    $('rn-input').focus(); $('rn-input').select();
    const go = async () => {
      try {
        const r = await window.wf.renameNote(curId(), $('rn-input').value);
        const d = r.ok ? r.data : r;
        subbarHide();
        await refreshGraph();
        openNote(d.id);
      } catch (err) { alert('Rename failed: ' + (err.message || err)); }
    };
    $('rn-go').addEventListener('click', go);
    $('rn-input').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function subMove() {
    if (!currentNote) return;
    subbar(`<div class="row"><input id="mv-input" value="${esc(currentNote.dir === '.' ? '' : currentNote.dir)}" placeholder="folder (blank = vault root)" aria-label="Destination folder"><button id="mv-go" class="hud-btn">Move</button></div><span class="muted">Links keep working — they resolve by note name.</span>`);
    $('mv-input').focus();
    const go = async () => {
      try {
        const r = await window.wf.moveNote(curId(), $('mv-input').value);
        const d = r.ok ? r.data : r;
        subbarHide();
        await refreshGraph();
        openNote(d.id);
      } catch (err) { alert('Move failed: ' + (err.message || err)); }
    };
    $('mv-go').addEventListener('click', go);
    $('mv-input').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  async function duplicateCurrent() {
    if (!currentNote) return;
    const r = await window.wf.duplicateNote(curId());
    const d = r.ok ? r.data : r;
    await refreshGraph();
    openNote(d.id);
  }

  async function exportNote(format) {
    if (!currentNote) return;
    const r = await window.wf.exportNote(curId(), format);
    const d = r.ok ? r.data : r;
    await window.wf.copyText(d.text);
    alert(`Copied as ${format === 'txt' ? 'plain text' : 'raw markdown'} — paste anywhere.`);
  }

  async function toggleStar() {
    if (!currentNote) return;
    const r = await window.wf.favoriteToggle(curId());
    const d = r.ok ? r.data : r;
    $('np-star').textContent = d.active ? '★' : '☆';
    $('np-star').title = d.active ? 'Remove from favorites' : 'Favorite this note (star)';
  }
  async function paintStar() {
    if (!currentNote) return;
    try {
      const r = await window.wf.favorites();
      const favs = r.ok ? r.data : r;
      $('np-star').textContent = favs.includes(curId()) ? '★' : '☆';
    } catch { $('np-star').textContent = '☆'; }
  }

  function subWordCount() {
    if (!currentNote) return;
    const text = currentNote.raw || '';
    const words = (text.match(/[\p{L}\p{N}']+/gu) || []).length;
    subbar(`<span class="muted" aria-live="polite"><b>${words.toLocaleString()}</b> words · <b>${text.length.toLocaleString()}</b> characters · <b>${Math.max(1, Math.round(words / 220))}</b> min read</span>`);
    clearTimeout(subWordCount._t);
    subWordCount._t = setTimeout(subbarHide, 4000);
  }

  on('np-toc', 'click', subTOC);
  on('np-find', 'click', subFindReplace);
  on('np-template', 'click', subTemplate);
  on('np-wordcount', 'click', subWordCount);
  on('np-rename', 'click', subRename);
  on('np-move', 'click', subMove);
  on('np-duplicate', 'click', duplicateCurrent);
  on('np-export', 'click', () => exportNote('txt'));
  on('np-star', 'click', toggleStar);
  on('np-delete2', 'click', () => {
    if (currentNote && confirm(`Delete "${currentNote.title}"? It moves to .trash — recoverable.`)) deleteNoteById(curId());
  });

  const _openNoteBase = openNote;
  openNote = async function (id) { await _openNoteBase(id); paintStar(); subbarHide(); };

  // ==================== world: undo/redo, arrange, isolate, snapshot ====================
  const undoStack = [], redoStack = [];
  function worldSnapshot() {
    if (!world) return null;
    const ids = world.getSelected();
    return ids.length ? ids.map(id => ({ id, pos: world.nodePos(id) })) : null;
  }
  function worldUndo() {
    const s = undoStack.pop();
    if (s && world.applyPositions) { redoStack.push(worldSnapshot()); world.applyPositions(s, true); }
  }
  function worldRedo() {
    const s = redoStack.pop();
    if (s && world.applyPositions) { undoStack.push(worldSnapshot()); world.applyPositions(s, true); }
  }

  function arrangeSelection(kind) {
    if (!world) return;
    if (!world.getSelected().length) { alert('Select nodes first — click, box-drag, or A.'); return; }
    if (world.arrange(kind)) alert('Arranged — 💾 Save positions to keep.');
  }
  function isolateSelection() {
    if (!world) return;
    const sel = world.getSelected();
    if (!sel.length) { alert('Select at least one node to isolate its neighborhood.'); return; }
    world.isolate(sel);
  }
  function snapshotPNG() {
    const canvas = document.querySelector('#scene canvas');
    if (!canvas) { alert('No world rendered yet.'); return; }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'worldforge-' + new Date().toISOString().slice(0, 10) + '.png';
    a.click();
  }

  async function openRandom() {
    const r = await window.wf.randomNote(currentNote ? currentNote.id : null);
    const n = r.ok ? r.data : r;
    if (!n) { alert('Not enough notes yet.'); return; }
    openNote(n.id);
  }

  async function createDailyNote() {
    const title = new Date().toISOString().slice(0, 10) + ' Daily';
    try {
      const r = await window.wf.createNote(title, 'Daily', '');
      const id = r.ok ? r.data.id : r.id;
      await refreshGraph();
      openNote(id);
    } catch (err) { alert('Could not create daily note: ' + (err.message || err)); }
  }

  // ==================== sprint timer ====================
  let sprintTimer = null;
  function startSprint() {
    const existing = document.getElementById('sprint-box');
    if (existing) { existing.remove(); clearInterval(sprintTimer); sprintTimer = null; return; }
    const box = document.createElement('div');
    box.id = 'sprint-box';
    box.innerHTML = `<div id="sprint-time">15:00</div>
      <div class="row" style="gap:4px; justify-content:center; margin-top:4px">
        <button id="sprint-pause" class="hud-btn" title="Pause/resume">⏯</button>
        <button id="sprint-end" class="hud-btn" title="End sprint">✕</button>
      </div>
      <div class="muted" style="font-size:11px" aria-live="polite">writing sprint — 15 min</div>`;
    document.getElementById('view-world').appendChild(box);
    let left = 15 * 60, paused = false;
    sprintTimer = setInterval(() => {
      if (paused) return;
      left--;
      const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
      const t = document.getElementById('sprint-time');
      if (t) t.textContent = `${mm}:${ss}`;
      if (left <= 0) {
        clearInterval(sprintTimer); sprintTimer = null;
        alert('⏰ Sprint done — stretch those fingers.');
        box.remove();
      }
    }, 1000);
    document.getElementById('sprint-pause').addEventListener('click', () => { paused = !paused; });
    document.getElementById('sprint-end').addEventListener('click', () => { clearInterval(sprintTimer); sprintTimer = null; box.remove(); });
  }

  // ==================== theme ====================
  function toggleTheme() {
    document.body.classList.toggle('wf-light');
    const light = document.body.classList.contains('wf-light');
    try { localStorage.setItem('wf.theme', light ? 'light' : 'dark'); } catch {}
    $('btn-theme').textContent = light ? '☀️' : '🌙';
  }
  on('btn-theme', 'click', toggleTheme);
  try {
    if (localStorage.getItem('wf.theme') === 'light') {
      document.body.classList.add('wf-light');
      $('btn-theme').textContent = '☀️';
    }
  } catch {}

  on('btn-trashed', 'click', () => window.wf.openTrash());

  // Ctrl+K palette · Ctrl+Z / Ctrl+Y world undo · ? opens the manual
  document.addEventListener('keydown', e => {
    const typing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cpOpen ? closePalette() : openPalette(); }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) worldUndo();
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !typing) worldRedo();
    if (e.key === '?' && !typing) $('btn-manual').click();
  });

  boot();
})();

