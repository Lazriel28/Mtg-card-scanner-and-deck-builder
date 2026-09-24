'use strict';
// WorldForge - scans an Obsidian vault on disk and builds a link graph.
// Plain Node built-ins only: fs, path.

const fs = require('fs');
const path = require('path');
const { extractTags, basenameNoExt, esc } = require('./md');
const { guessTypeFromContent } = require('./types');

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.venv',  '.smart-env', '.freebuff', '.stfolder']);

// AUTO-CATEGORIZE: when a note has no explicit type:, the type is guessed
// from the note's own content (text + tags) — never from its folder name.
// See guessTypeFromContent in types.js.

function stripFrontmatter(src) {
  if (src.startsWith('---')) {
    const end = src.indexOf('\n---', 3);
    if (end !== -1) {
      const nl = src.indexOf('\n', end + 1);
      return nl === -1 ? '' : src.slice(nl + 1);
    }
  }
  return src;
}

// A wikilink resolves if a note exists whose basename matches the target
// (case-insensitive), optionally after appending .md or a trailing subpath.
function makeResolver(byName, byPath) {
  return function resolve(target) {
    const t = String(target || '').trim().replace(/^#/, '');
    if (!t) return null;
    let hit = byName.get(t.toLowerCase());
    if (hit) return hit;
    hit = byPath.get(t.toLowerCase());
    if (hit) return hit;
    if (!/\.[a-z0-9]+$/i.test(t)) {
      hit = byName.get(t.toLowerCase() + '.md');
      if (hit) return hit;
      hit = byName.get(t.toLowerCase() + '.markdown');
      if (hit) return hit;
    }
    // "Folder/Name" -> match any note whose full path ends with "/name" (case-insensitive)
    const last = basenameNoExt(t).toLowerCase();
    hit = byName.get(last + '.md') || byName.get(last + '.markdown') || byName.get(last);
    if (hit) return hit;
    return null;
  };
}

function scanVault(root) {
  const notes = [];
  const byName = new Map(); // "basename.md" lowercase -> note
  const byPath = new Map(); // "folder/basename.md" lowercase -> note

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (/\.(md|markdown)$/i.test(e.name)) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        const note = { id: rel, rel, title: basenameNoExt(e.name), dir: path.dirname(rel).split(path.sep).join('/'), file: full, mtime: 0 };
        try { note.mtime = fs.statSync(full).mtimeMs; } catch {}
        notes.push(note);
        byName.set(e.name.toLowerCase(), note);
        byPath.set(rel.toLowerCase(), note);
      }
    }
  }
  walk(root);
  notes.sort((a, b) => a.rel.localeCompare(b.rel));

  // Pass 2: read contents, extract links & tags.
  const tagIndex = new Map(); // tag -> Set(note.id)
  const notesById = new Map();
  for (const n of notes) notesById.set(n.id, n);

  for (const n of notes) {
    let raw = '';
    try { raw = fs.readFileSync(n.file, 'utf8'); } catch { raw = ''; }
    n.raw = raw;
    const body = stripFrontmatter(raw);
    n.body = body;
    n.tags = extractTags(body);
    // card type: explicit frontmatter wins, then the note's own content,
    // then untyped. Folder names are deliberately ignored — moving a note
    // can't change what it is.
    const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
    const tm = fm ? /^type:\s*(.+)$/im.exec(fm[1]) : null;
    n.type = tm ? tm[1].trim().toLowerCase() : (guessTypeFromContent(body, n.tags) || 'untyped');
    n.size = raw.length;
    n.outgoing = [];
    const seen = new Set();
    const re = /\[\[([^\][|]*(?:\|[^\][]*)?)\]\]/g;
    let m;
    while ((m = re.exec(body))) {
      const inner = m[1];
      const pipe = inner.indexOf('|');
      const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      if (!target || target.startsWith('#')) continue; // heading-only links
      if (seen.has(target)) continue;
      seen.add(target);
      const resolved = makeResolver(byName, byPath)(target);
      if (resolved && resolved.id !== n.id) n.outgoing.push(resolved.id);
    }
    for (const t of n.tags) {
      if (!tagIndex.has(t)) tagIndex.set(t, new Set());
      tagIndex.get(t).add(n.id);
    }
  }

  // Backlinks
  for (const n of notes) n.backlinks = [];
  for (const n of notes) {
    for (const to of n.outgoing) {
      const t = notesById.get(to);
      if (t) t.backlinks.push(n.id);
    }
  }

  // Graph JSON
  const nodes = notes.map(n => ({ id: n.id, title: n.title, dir: n.dir, type: n.type, tags: n.tags, size: n.size, mtime: n.mtime }));
  const linkSet = new Map();
  for (const n of notes) {
    for (const to of n.outgoing) {
      const key = n.id < to ? n.id + '\u0000' + to : to + '\u0000' + n.id;
      linkSet.set(key, (linkSet.get(key) || 0) + 1);
    }
  }
  const links = [...linkSet.entries()].map(([k, w]) => {
    const [s, t] = k.split('\u0000');
    return { source: s, target: t, weight: w };
  });

  return { root, notes, notesById, byName, byPath, resolve: makeResolver(byName, byPath), tagIndex, graph: { nodes, links } };
}

module.exports = { scanVault, SKIP_DIRS };
