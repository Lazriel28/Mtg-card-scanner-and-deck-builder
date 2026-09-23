'use strict';
// WorldForge vault tools: note operations and vault intelligence that build
// directly on scanVault's structures. All disk work happens here; main.js
// just calls in. Every mutating op backs up the files it touches first.

const fs = require('fs');
const path = require('path');
const { renderMarkdown } = require('./md');

// ---------- full-text search ----------
// Title matches rank above body matches; returns a short snippet per hit.
function fulltextSearch(vault, q, limit = 30) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  for (const n of vault.notes) {
    const title = n.title.toLowerCase();
    const body = (n.body || '').toLowerCase();
    let score = 0, snippet = '';
    if (title === needle) score += 100;
    else if (title.startsWith(needle)) score += 50;
    else if (title.includes(needle)) score += 25;
    const idx = body.indexOf(needle);
    if (idx !== -1) {
      score += 10;
      const start = Math.max(0, idx - 40);
      snippet = (start > 0 ? '…' : '') + (n.body || '').slice(start, idx + needle.length + 60).replace(/\s+/g, ' ').trim() + '…';
    }
    if (score > 0) hits.push({ id: n.id, title: n.title, dir: n.dir, type: n.type, score, snippet });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}

// ---------- vault statistics ----------
function countWords(text) {
  const m = String(text || '').match(/[\p{L}\p{N}']+/gu);
  return m ? m.length : 0;
}

function vaultStats(vault) {
  const notes = vault.notes;
  let words = 0, chars = 0;
  const byType = {};
  for (const n of notes) {
    words += countWords(n.body);
    chars += (n.raw || '').length;
    byType[n.type || 'untyped'] = (byType[n.type || 'untyped'] || 0) + 1;
  }
  const now = Date.now();
  const sortedByAge = [...notes].sort((a, b) => a.mtime - b.mtime);
  const sortedBySize = [...notes].sort((a, b) => b.size - a.size);
  const last7 = notes.filter(n => now - n.mtime < 7 * 864e5).length;
  const orphans = notes.filter(n => !n.backlinks.length && !n.outgoing.length);
  const connected = notes.filter(n => n.outgoing.length + n.backlinks.length > 0).length;
  return {
    notes: notes.length,
    words, chars,
    byType,
    links: vault.graph.links.reduce((a, l) => a + l.weight, 0),
    orphans: orphans.length,
    connected,
    avgLinksPerNote: notes.length ? +(vault.graph.links.reduce((a, l) => a + l.weight, 0) / notes.length).toFixed(2) : 0,
    biggest: sortedBySize.slice(0, 5).map(n => ({ id: n.id, title: n.title, words: countWords(n.body) })),
    oldest: sortedByAge.slice(0, 5).map(n => ({ id: n.id, title: n.title, mtime: n.mtime })),
    editedLast7Days: last7,
    tags: topTags(vault, 12),
  };
}

// ---------- tags ----------
function listTags(vault) {
  const out = [];
  for (const [tag, ids] of vault.tagIndex) out.push({ tag, count: ids.size });
  out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return out;
}
function topTags(vault, limit = 12) { return listTags(vault).slice(0, limit); }
function notesWithTag(vault, tag) {
  const ids = vault.tagIndex.get(String(tag || '').replace(/^#/, ''));
  if (!ids) return [];
  return [...ids].map(id => {
    const n = vault.notesById.get(id);
    return n ? { id: n.id, title: n.title, type: n.type } : null;
  }).filter(Boolean);
}

// ---------- broken links ----------
// scanVault keeps only resolved targets in `outgoing`; outgoingRaw preserves
// what the author actually typed so unresolved ones can be reported.
function brokenLinks(vault) {
  const out = [];
  for (const n of vault.notes) {
    const seen = new Set();
    const re = /\[\[([^\][|]*(?:\|[^\][]*)?)\]\]/g;
    let m;
    const body = n.body || '';
    while ((m = re.exec(body))) {
      const inner = m[1];
      const pipe = inner.indexOf('|');
      const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      if (!target || target.startsWith('#') || seen.has(target)) continue;
      seen.add(target);
      const base = target.split('#')[0].trim(); // [[Note#heading]] resolves if Note exists
      if (!base || !vault.resolve(base)) out.push({ from: n.id, fromTitle: n.title, target });
    }
  }
  return out;
}

// ---------- link rewriting (used by rename and merge) ----------
// Rewrites [[Title]], [[Title|alias]], [[Title#sec]], and Folder/Title forms —
// case-insensitive on the exact old title, including the .md suffix if typed.
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function rewriteLinksIn(raw, oldTitle, newTitle) {
  const base = escapeRe(path.basename(oldTitle).replace(/\.md$/i, ''));
  const repl = path.basename(newTitle).replace(/\.md$/i, '');
  // "[[" + optional Folder/ segments + base, followed by | # / ]] or .md]]
  const re = new RegExp('\\[\\[\\s*(?:[^\\][|]*\\/)?' + base + '(\\.md)?(?=\\]|\\||#)', 'gi');
  let changed = 0;
  const out = raw.replace(re, (m0, ext) => {
    changed++;
    return '[[' + m0.slice(2).replace(new RegExp(escapeRe(base) + '(\\.md)?$', 'i'), repl + '$1');
  });
  return { raw: out, changed };
}

function backupRaw(vaultRoot, n) {
  const dir = path.join(vaultRoot, '.worldforge', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, path.basename(n.file) + '.' + stamp + '.bak');
  try { fs.copyFileSync(n.file, dest); } catch {}
}

// ---------- rename (with wiki-link rewrite) ----------
function renameNote(vault, id, newTitle) {
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found: ' + id);
  const safe = String(newTitle || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  if (!safe) throw new Error('empty title');
  const dir = path.dirname(n.file);
  const dest = path.join(dir, safe + '.md');
  if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(n.file)) {
    throw new Error('a note named "' + safe + '" already exists here');
  }
  backupRaw(vault.root, n);
  fs.renameSync(n.file, dest);
  const oldTitle = n.title;
  let linksUpdated = 0, filesTouched = 0;
  if (safe !== oldTitle) {
    for (const other of vault.notes) {
      if (other.id === n.id) continue;
      let raw;
      try { raw = fs.readFileSync(other.file, 'utf8'); } catch { continue; }
      const { raw: rewritten, changed } = rewriteLinksIn(raw, oldTitle, safe);
      if (changed > 0) {
        backupRaw(vault.root, other);
        fs.writeFileSync(other.file, rewritten, 'utf8');
        linksUpdated += changed; filesTouched++;
      }
    }
  }
  return { ok: true, id: relPath(vault.root, dest), linksUpdated, filesTouched };
}

// ---------- move (folder change; links resolve by name so no rewrite) ----------
function moveNote(vault, id, newDir) {
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found: ' + id);
  let clean = String(newDir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (clean === '.') clean = '';
  if (clean && clean.split('/').some(seg => seg === '.' || seg === '..' || SKIP.has(seg))) {
    throw new Error('invalid folder');
  }
  const destDir = path.join(vault.root, clean);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(n.file));
  if (fs.existsSync(dest)) throw new Error('a note with that name already exists in "' + (clean || '.') + '"');
  backupRaw(vault.root, n);
  fs.renameSync(n.file, dest);
  return { ok: true, id: relPath(vault.root, dest) };
}
const SKIP = new Set(['.obsidian', '.git', '.trash', '.worldforge', 'node_modules']);

function relPath(root, full) { return path.relative(root, full).split(path.sep).join('/'); }

// ---------- duplicate ----------
function duplicateNote(vault, id) {
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found: ' + id);
  const dir = path.dirname(n.file);
  const ext = path.extname(n.file);
  const base = path.basename(n.file, ext);
  let dest = path.join(dir, base + ' copy' + ext);
  let k = 2;
  while (fs.existsSync(dest)) dest = path.join(dir, `${base} copy ${k++}${ext}`);
  fs.copyFileSync(n.file, dest);
  return { ok: true, id: relPath(vault.root, dest) };
}

// ---------- merge ----------
// Creates (or reuses) a target note containing each source's body under a
// heading, rewrites links that pointed at the sources, and trashes them.
function mergeNotes(vault, ids, { title, folder = '', keepSources = false } = {}) {
  const sources = ids.map(i => vault.notesById.get(i)).filter(Boolean);
  if (sources.length < 2) throw new Error('select at least two notes to merge');
  const safe = String(title || '').replace(/[\\/:*?"<>|]/g, '-').trim()
    || sources[0].title + ' (merged)';
  const destRel = (folder ? folder + '/' : '') + safe + '.md';
  const destFull = path.join(vault.root, destRel);
  const destNote = vault.byPath.get(destRel.toLowerCase());
  if (!destNote) {
    fs.mkdirSync(path.dirname(destFull), { recursive: true });
    fs.writeFileSync(destFull, `# ${safe}\n\n`, 'utf8');
  }
  let destRaw = '';
  try { destRaw = fs.readFileSync(destFull, 'utf8'); } catch {}
  const bodies = [];
  for (const s of sources) {
    if (s.id === destRel) continue;
    let body = stripH1(s.body || '');
    body = body.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    bodies.push(`## ${s.title}\n\n${body}`);
  }
  const merged = destRaw.trimEnd() + '\n\n' + bodies.join('\n\n') + '\n';
  backupRaw(vault.root, destNote || { file: destFull, id: destRel });
  fs.writeFileSync(destFull, merged, 'utf8');
  // rewrite every [[sourceTitle]] in the vault to the merged title
  let linksUpdated = 0;
  for (const other of vault.notes) {
    if (sources.some(s => s.id === other.id) || other.id === destRel) continue;
    let raw;
    try { raw = fs.readFileSync(other.file, 'utf8'); } catch { continue; }
    let any = 0, current = raw;
    for (const s of sources) {
      const r = rewriteLinksIn(current, s.title, safe);
      current = r.raw; any += r.changed;
    }
    if (any > 0) {
      backupRaw(vault.root, other);
      fs.writeFileSync(other.file, current, 'utf8');
      linksUpdated += any;
    }
  }
  const trashed = [];
  if (!keepSources) {
    const trashDir = path.join(vault.root, '.trash');
    fs.mkdirSync(trashDir, { recursive: true });
    for (const s of sources) {
      if (s.id === destRel) continue;
      let dest = path.join(trashDir, path.basename(s.file));
      let k = 1;
      while (fs.existsSync(dest)) dest = path.join(trashDir, `${path.basename(s.file, path.extname(s.file))} ${k++}${path.extname(s.file)}`);
      try { fs.renameSync(s.file, dest); trashed.push(s.id); } catch {}
    }
  }
  return { ok: true, id: destRel, linksUpdated, trashed };
}

function stripH1(body) { return String(body || '').replace(/^#\s+.+\n?/, ''); }

// ---------- templates ----------
const TEMPLATE_DIRS = ['templates', 'Templates', 'Notes/Templates'];
function listTemplates(vault) {
  for (const d of TEMPLATE_DIRS) {
    const full = path.join(vault.root, d);
    if (!fs.existsSync(full)) continue;
    try {
      return fs.readdirSync(full).filter(f => /\.md$/i.test(f))
        .map(f => ({ name: f.replace(/\.md$/i, ''), file: path.join(full, f) }));
    } catch {}
  }
  return [];
}
function getTemplate(vault, name) {
  const t = listTemplates(vault).find(t => t.name.toLowerCase() === String(name || '').toLowerCase());
  if (!t) throw new Error('template not found: ' + name);
  return fs.readFileSync(t.file, 'utf8');
}

// ---------- export / copy ----------
function exportNoteText(vault, id, format = 'markdown') {
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found: ' + id);
  if (format === 'raw' || format === 'markdown') return { ok: true, text: n.raw || '' };
  if (format === 'txt') {
    const text = (n.body || '')
      .replace(/\[\[([^\][|]*)(?:\|[^\][]*)?\]\]/g, '$1')
      .replace(/[#>*_`]/g, '');
    return { ok: true, text };
  }
  if (format === 'html') {
    const linkFor = (t, exists) => exists ? '#' : '[[' + t + ']]';
    return { ok: true, text: renderMarkdown(n.body || '', t => !!vault.resolve(t), linkFor) };
  }
  throw new Error('unknown format: ' + format);
}

// ---------- favorites (app-level, survives vault switches) ----------
function favoritesFile(dataDir) { return path.join(dataDir, 'favorites.json'); }
function loadFavorites(dataDir) {
  try { return JSON.parse(fs.readFileSync(favoritesFile(dataDir), 'utf8')); } catch { return []; }
}
function saveFavorites(dataDir, ids) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(favoritesFile(dataDir), JSON.stringify([...ids], null, 2), 'utf8');
}
function toggleFavorite(dataDir, id) {
  const favs = loadFavorites(dataDir);
  const i = favs.indexOf(id);
  if (i === -1) favs.push(id); else favs.splice(i, 1);
  saveFavorites(dataDir, favs);
  return { ok: true, favorites: favs, active: i === -1 };
}

// ---------- recents / streaks / random ----------
function recentEdits(vault, limit = 10) {
  return [...vault.notes].sort((a, b) => b.mtime - a.mtime).slice(0, limit)
    .map(n => ({ id: n.id, title: n.title, type: n.type, mtime: n.mtime }));
}

function writingStreak(vault) {
  const days = new Set();
  const now = new Date();
  let todayWords = 0;
  const todayKey = now.toISOString().slice(0, 10);
  for (const n of vault.notes) {
    const d = new Date(n.mtime);
    const key = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    days.add(key);
    if (key === todayKey) todayWords += countWords(n.body);
  }
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now.getTime() - i * 864e5);
    const key = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    if (days.has(key)) streak++;
    else if (i > 0) break;
    // i === 0 with no edits today doesn't break the streak yet
  }
  return { streak, daysActive: days.size, todayWords, editedToday: days.has(todayKey) };
}

function randomNote(vault, excludeId) {
  const pool = vault.notes.filter(n => n.id !== excludeId && (n.body || '').trim().length > 40);
  if (!pool.length) return null;
  const n = pool[Math.floor(Math.random() * pool.length)];
  return { id: n.id, title: n.title, type: n.type };
}

module.exports = {
  fulltextSearch, vaultStats, listTags, topTags, notesWithTag, brokenLinks,
  renameNote, moveNote, duplicateNote, mergeNotes,
  listTemplates, getTemplate, exportNoteText,
  loadFavorites, toggleFavorite, recentEdits, writingStreak, randomNote,
};
