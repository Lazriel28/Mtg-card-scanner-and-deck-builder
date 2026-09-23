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
  // MTG
  mtgSearch: (q) => ipcRenderer.invoke('mtg:search', q),
  mtgCard: (name) => ipcRenderer.invoke('mtg:card', name),
  mtgCollection: () => ipcRenderer.invoke('mtg:collection'),
  mtgCollectionAdd: (names) => ipcRenderer.invoke('mtg:collection-add', names),
  mtgCollectionSet: (name, qty) => ipcRenderer.invoke('mtg:collection-set', name, qty),
  mtgSuggestDeck: (opts) => ipcRenderer.invoke('mtg:suggest-deck', opts),
  mtgCounters: (names) => ipcRenderer.invoke('mtg:counters', names),
});
