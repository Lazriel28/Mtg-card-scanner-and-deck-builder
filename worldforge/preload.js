'use strict';
// WorldForge preload: the ONLY bridge between the sandboxed renderer and Node.
// Everything the UI can do is explicitly listed here.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wf', {
  status: () => ipcRenderer.invoke('wf:status'),
  pickVault: () => ipcRenderer.invoke('wf:pick-vault'),
  loadVault: (p) => ipcRenderer.invoke('wf:load-vault', p),
  graph: () => ipcRenderer.invoke('wf:graph'),
  note: (id) => ipcRenderer.invoke('wf:note', id),
  saveNote: (id, raw) => ipcRenderer.invoke('wf:save-note', id, raw),
  createNote: (title, folder, type) => ipcRenderer.invoke('wf:create-note', title, folder, type),
  pickImport: () => ipcRenderer.invoke('wf:pick-import'),
  importNotes: (src, folder) => ipcRenderer.invoke('wf:import', src, folder),
  noteTitles: () => ipcRenderer.invoke('wf:note-titles'),
  setType: (id, type) => ipcRenderer.invoke('wf:set-type', id, type),
  copyText: (text) => ipcRenderer.invoke('wf:copy-text', text),
  deleteNote: (id) => ipcRenderer.invoke('wf:delete-note', id),
  deleteNotes: (ids) => ipcRenderer.invoke('wf:delete-notes', ids),
  openPath: (dir) => ipcRenderer.invoke('wf:open-path', dir),
  // world layout (pinned node positions)
  getLayout: () => ipcRenderer.invoke('wf:get-layout'),
  saveLayout: (l) => ipcRenderer.invoke('wf:save-layout', l),
  unpinLayout: (ids) => ipcRenderer.invoke('wf:unpin-layout', ids),
  // MTG
  mtgSearch: (q) => ipcRenderer.invoke('mtg:search', q),
  mtgCard: (name) => ipcRenderer.invoke('mtg:card', name),
  mtgCollection: () => ipcRenderer.invoke('mtg:collection'),
  mtgCollectionAdd: (names) => ipcRenderer.invoke('mtg:collection-add', names),
  mtgCollectionSet: (name, qty) => ipcRenderer.invoke('mtg:collection-set', name, qty),
  mtgSuggestDeck: (opts) => ipcRenderer.invoke('mtg:suggest-deck', opts),
  mtgCounters: (names) => ipcRenderer.invoke('mtg:counters', names),
  // Maps
  mapsList: () => ipcRenderer.invoke('maps:list'),
  mapsSave: (maps) => ipcRenderer.invoke('maps:save', maps),
  mapsPickImage: () => ipcRenderer.invoke('maps:pick-image'),
  mapsAddImage: (src, name) => ipcRenderer.invoke('maps:add-image', src, name),
  mapsRemove: (id) => ipcRenderer.invoke('maps:remove', id),
  // Publish
  publishPickDir: () => ipcRenderer.invoke('publish:pick-dir'),
  publishExport: (dir) => ipcRenderer.invoke('publish:export', dir),
  // vault tools
  searchAll: (q) => ipcRenderer.invoke('wf:search-all', q),
  stats: () => ipcRenderer.invoke('wf:stats'),
  tags: () => ipcRenderer.invoke('wf:tags'),
  tagNotes: (tag) => ipcRenderer.invoke('wf:tag-notes', tag),
  brokenLinks: () => ipcRenderer.invoke('wf:broken-links'),
  renameNote: (id, title) => ipcRenderer.invoke('wf:rename-note', id, title),
  moveNote: (id, dir) => ipcRenderer.invoke('wf:move-note', id, dir),
  duplicateNote: (id) => ipcRenderer.invoke('wf:duplicate-note', id),
  mergeNotes: (ids, opts) => ipcRenderer.invoke('wf:merge-notes', ids, opts),
  listTemplates: () => ipcRenderer.invoke('wf:list-templates'),
  getTemplate: (name) => ipcRenderer.invoke('wf:get-template', name),
  exportNote: (id, format) => ipcRenderer.invoke('wf:export-note', id, format),
  favorites: () => ipcRenderer.invoke('wf:favorites'),
  favoriteToggle: (id) => ipcRenderer.invoke('wf:favorite-toggle', id),
  recentEdits: () => ipcRenderer.invoke('wf:recent-edits'),
  streak: () => ipcRenderer.invoke('wf:streak'),
  randomNote: (exclude) => ipcRenderer.invoke('wf:random-note', exclude),
  openTrash: () => ipcRenderer.invoke('wf:open-trash'),
  openBackups: () => ipcRenderer.invoke('wf:open-backups'),
});
