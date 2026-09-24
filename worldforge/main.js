'use strict';
// WorldForge - Electron main process. All disk I/O lives here; the renderer
// never touches fs directly (contextIsolation + preload whitelist).

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { scanVault } = require('./src/vault');
const { renderMarkdown } = require('./src/md');
const { importNotes } = require('./src/importer');
const { setTypeInRaw } = require('./src/types');
const mtg = require('./src/mtg');
const tombstones = require('./src/tombstones');
const mapsStore = require('./src/maps');
const layoutStore = require('./src/layout');
const tools = require('./src/vault-tools');

const DATA_DIR = path.join(__dirname, 'data');
mtg.setDataDir(DATA_DIR); // MTG card index + collection live alongside vault config
const CONFIG = path.join(DATA_DIR, 'config.json');

let vault = null;
let win = null;

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
}

function backupNote(vaultRoot, id) {
  const src = path.join(vaultRoot, id);
  if (!fs.existsSync(src)) return null;
  const dir = path.join(vaultRoot, '.worldforge', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, id.replace(/[\\/]/g, '__') + '.' + stamp + '.bak');
  fs.copyFileSync(src, dest);
  pruneBackups(dir);
  return dest;
}

function pruneBackups(dir, keep = 50) {
  try {
    const files = fs.readdirSync(dir).map(f => {
      const full = path.join(dir, f);
      return { full, m: fs.statSync(full).mtimeMs };
    }).sort((a, b) => b.m - a.m);
    for (const f of files.slice(keep)) fs.unlinkSync(f.full);
  } catch {}
}

// Move a note's file to the vault's .trash (with backup first). Recoverable.
// Records a tombstone so re-import restores it (within the grace window)
// but doesn't resurrect long-gone notes.
function trashNote(vaultRoot, n) {
  backupNote(vaultRoot, n.id);
  const trashDir = path.join(vaultRoot, '.trash');
  fs.mkdirSync(trashDir, { recursive: true });
  let dest = path.join(trashDir, path.basename(n.file));
  let k = 1;
  while (fs.existsSync(dest)) {
    const ext = path.extname(n.file);
    dest = path.join(trashDir, path.basename(n.file, ext) + ' ' + (k++) + ext);
  }
  fs.renameSync(n.file, dest);
  try { tombstones.record(vaultRoot, [n.id]); } catch {}
  return dest;
}

function doLoadVault(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) throw new Error('folder not found: ' + rootPath);
  vault = scanVault(rootPath);
  const cfg = loadConfig(); cfg.lastVault = rootPath; saveConfig(cfg);
  return { root: vault.root, notes: vault.notes.length, links: vault.graph.links.length };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640,
    backgroundColor: '#0d1117',
    title: 'WorldForge',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'public', 'index.html'));
}

app.whenReady().then(() => {
  // auto-load last vault so the user lands in their world immediately
  const cfg = loadConfig();
  if (cfg.lastVault) {
    try { doLoadVault(cfg.lastVault); } catch (e) { console.error('auto-load failed:', e.message); }
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });

/* ---------------- IPC ---------------- */

ipcMain.handle('wf:status', () => ({
  loaded: !!vault, root: vault ? vault.root : null,
  notes: vault ? vault.notes.length : 0, lastVault: loadConfig().lastVault || null,
}));

ipcMain.handle('wf:pick-vault', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose your Obsidian vault (or any notes folder)',
    properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('wf:load-vault', (e, p) => doLoadVault(p));

ipcMain.handle('wf:graph', () => {
  if (!vault) throw new Error('no vault loaded');
  return vault.graph;
});

ipcMain.handle('wf:note', (e, id) => {
  if (!vault) throw new Error('no vault loaded');
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found: ' + id);
  const linkFor = (target, exists) => exists
    ? '#note:' + encodeURIComponent(vault.resolve(target).id)
    : '#missing:' + encodeURIComponent(target);
  return {
    id: n.id, title: n.title, dir: n.dir, tags: n.tags, type: n.type || 'untyped',
    html: renderMarkdown(n.body, t => !!vault.resolve(t), linkFor),
    raw: n.raw,
    outgoing: [...new Set(n.outgoing)],
    backlinks: [...new Set(n.backlinks)],
  };
});

ipcMain.handle('wf:save-note', (e, id, raw) => {
  if (!vault) throw new Error('no vault loaded');
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found');
  backupNote(vault.root, id);
  fs.writeFileSync(n.file, String(raw), 'utf8');
  vault = scanVault(vault.root); // debounced on renderer side
  return { ok: true };
});

ipcMain.handle('wf:create-note', (e, title, folder, type) => {
  if (!vault) throw new Error('no vault loaded');
  const safe = String(title || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
  const dir = folder && folder !== '.' ? folder : '';
  let rel = (dir ? dir + '/' : '') + safe + '.md';
  let full = path.join(vault.root, rel);
  let k = 1;
  while (fs.existsSync(full)) { rel = (dir ? dir + '/' : '') + `${safe} ${++k}.md`; full = path.join(vault.root, rel); }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fm = type ? `---\ntype: ${type}\ntags: []\n---\n\n` : '';
  fs.writeFileSync(full, `${fm}# ${safe}\n\n`, 'utf8');
  tombstones.clear(vault.root, [rel]); // recreated path: any old tombstone is stale
  vault = scanVault(vault.root);
  return { ok: true, id: rel };
});

ipcMain.handle('wf:pick-import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose the folder of .md notes to import (e.g. your Obsidian vault)',
    properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('wf:import', (e, srcPath, destFolder) => {
  if (!vault) throw new Error('no vault loaded');
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('source folder not found');
  const r = importNotes(srcPath, vault.root, destFolder);
  vault = scanVault(vault.root);
  return r;
});

ipcMain.handle('wf:note-titles', () => {
  if (!vault) return [];
  return vault.notes.map(n => ({ id: n.id, title: n.title }));
});

ipcMain.handle('wf:set-type', (e, id, type) => {
  if (!vault) throw new Error('no vault loaded');
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found');
  backupNote(vault.root, id);
  const raw = fs.readFileSync(n.file, 'utf8');
  fs.writeFileSync(n.file, setTypeInRaw(raw, type || ''), 'utf8');
  vault = scanVault(vault.root);
  return { ok: true, type: type || 'untyped' };
});

ipcMain.handle('wf:copy-text', (e, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });

ipcMain.handle('wf:delete-note', (e, id) => {
  if (!vault) throw new Error('no vault loaded');
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found');
  const movedTo = trashNote(vault.root, n);
  vault = scanVault(vault.root);
  return { ok: true, movedTo };
});

// Batch delete: trash every id that still exists; rescan once at the end.
ipcMain.handle('wf:delete-notes', (e, ids) => {
  if (!vault) throw new Error('no vault loaded');
  const moved = [], missing = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const n = vault.notesById.get(id);
    if (!n) { missing.push(id); continue; }
    try { trashNote(vault.root, n); moved.push(id); } catch { missing.push(id); }
  }
  if (moved.length) vault = scanVault(vault.root);
  return { ok: true, deleted: moved.length, missing };
});

ipcMain.handle('wf:open-path', (e, dir) => {
  if (dir && fs.existsSync(dir)) { shell.openPath(dir); return { ok: true }; }
  return { ok: false };
});

// ---------- MTG ----------
const wrap = fn => async (e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
};

// ---------- World layout (pinned node positions) ----------
// <vault>/.worldforge/layout.json — hand-placed node positions survive
// rescans and restarts. normalizeLayout drops entries for deleted notes.
// Raw return values (no wrap envelope) — the world consumes them directly.
ipcMain.handle('wf:get-layout', () => {
  if (!vault) throw new Error('no vault loaded');
  return layoutStore.normalizeLayout(vault.graph, layoutStore.load(vault.root));
});
ipcMain.handle('wf:save-layout', (e, l) => {
  if (!vault) throw new Error('no vault loaded');
  return layoutStore.save(vault.root, layoutStore.pinNodes(layoutStore.load(vault.root), l.nodes));
});
ipcMain.handle('wf:unpin-layout', (e, ids) => {
  if (!vault) throw new Error('no vault loaded');
  return layoutStore.save(vault.root, layoutStore.unpinNodes(layoutStore.load(vault.root), ids));
});

// ---------- Maps ----------
ipcMain.handle('maps:list', wrap(() => {
  if (!vault) throw new Error('no vault loaded');
  return mapsStore.load(vault.root);
}));
ipcMain.handle('maps:save', wrap((maps) => {
  if (!vault) throw new Error('no vault loaded');
  return mapsStore.save(vault.root, Array.isArray(maps) ? maps : []);
}));
ipcMain.handle('maps:pick-image', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a map image (png, jpg, gif, webp, svg)',
    properties: ['openDirectory' === 'x' ? undefined : 'openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('maps:add-image', wrap((srcPath, name) => {
  if (!vault) throw new Error('no vault loaded');
  return mapsStore.addImage(vault.root, srcPath, name);
}));
ipcMain.handle('maps:remove', wrap((mapId) => {
  if (!vault) throw new Error('no vault loaded');
  return mapsStore.removeMap(vault.root, mapId);
}));


ipcMain.handle('mtg:search', wrap(q => mtg.search(q, 12)));
ipcMain.handle('mtg:card', wrap(name => mtg.cardView(mtg.get(name))));
ipcMain.handle('mtg:collection', wrap(() => mtg.collectionCards()));
ipcMain.handle('mtg:collection-add', wrap(names => mtg.collectionAdd(names)));
ipcMain.handle('mtg:collection-set', wrap((name, qty) => mtg.collectionSet(name, qty)));
ipcMain.handle('mtg:suggest-deck', wrap(opts => {
  const deck = mtg.suggestDeck(opts);
  mtg.recordDeck(deck.deck); // every build teaches the suggester your taste
  return deck;
}));
ipcMain.handle('mtg:counters', wrap(names => mtg.analyzeCounters(names)));

// ---------- vault tools (note ops, search, stats) ----------
const needVault = () => { if (!vault) throw new Error('no vault loaded'); return vault; };

ipcMain.handle('wf:search-all', wrap(q => tools.fulltextSearch(needVault(), q, 40)));
ipcMain.handle('wf:stats', wrap(() => tools.vaultStats(needVault())));
ipcMain.handle('wf:tags', wrap(() => tools.listTags(needVault())));
ipcMain.handle('wf:tag-notes', wrap(tag => tools.notesWithTag(needVault(), tag)));
ipcMain.handle('wf:broken-links', wrap(() => tools.brokenLinks(needVault())));
ipcMain.handle('wf:rename-note', wrap((id, title) => {
  const r = tools.renameNote(needVault(), id, title);
  vault = scanVault(vault.root); return r;
}));
ipcMain.handle('wf:move-note', wrap((id, dir) => {
  const r = tools.moveNote(needVault(), id, dir);
  vault = scanVault(vault.root); return r;
}));
ipcMain.handle('wf:duplicate-note', wrap(id => {
  const r = tools.duplicateNote(needVault(), id);
  vault = scanVault(vault.root); return r;
}));
ipcMain.handle('wf:merge-notes', wrap((ids, opts) => {
  const r = tools.mergeNotes(needVault(), ids, opts || {});
  vault = scanVault(vault.root); return r;
}));
ipcMain.handle('wf:list-templates', wrap(() => tools.listTemplates(needVault())));
ipcMain.handle('wf:get-template', wrap(name => tools.getTemplate(needVault(), name)));
ipcMain.handle('wf:export-note', wrap((id, format) => tools.exportNoteText(needVault(), id, format)));
ipcMain.handle('wf:favorites', wrap(() => tools.loadFavorites(DATA_DIR)));
ipcMain.handle('wf:favorite-toggle', wrap(id => tools.toggleFavorite(DATA_DIR, id)));
ipcMain.handle('wf:recent-edits', wrap(() => tools.recentEdits(needVault(), 12)));
ipcMain.handle('wf:streak', wrap(() => tools.writingStreak(needVault())));
ipcMain.handle('wf:random-note', wrap(excludeId => tools.randomNote(needVault(), excludeId)));
ipcMain.handle('wf:open-trash', wrap(async () => {
  if (!vault) throw new Error('no vault loaded');
  const t = path.join(vault.root, '.trash');
  fs.mkdirSync(t, { recursive: true });
  shell.openPath(t); return { ok: true };
}));
ipcMain.handle('wf:open-backups', wrap(async () => {
  if (!vault) throw new Error('no vault loaded');
  const b = path.join(vault.root, '.worldforge', 'backups');
  shell.openPath(b); return { ok: true };
}));
