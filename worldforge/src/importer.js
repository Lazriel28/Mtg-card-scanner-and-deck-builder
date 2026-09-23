'use strict';
// WorldForge importer: copies .md notes from any source folder into the
// working vault (usually an <imports/> subfolder). Duplicate-safe: a file
// that already exists at the destination is skipped, so re-importing the
// same folder restores only notes you deleted in between. Never overwrites.

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.worldforge', 'wiki-site', '.freebuff', '.stfolder']);

function collectFiles(root) {
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (/\.(md|markdown)$/i.test(e.name)) {
        out.push(full);
      }
    }
  })(root);
  return out;
}

function importNotes(srcRoot, vaultRoot, destFolder) {
  srcRoot = path.resolve(srcRoot);
  vaultRoot = path.resolve(vaultRoot);
  if (srcRoot === vaultRoot || srcRoot.startsWith(vaultRoot + path.sep) || vaultRoot.startsWith(srcRoot + path.sep)) {
    throw new Error('choose a folder OUTSIDE the current vault (importing into yourself would duplicate everything)');
  }
  const rel = (destFolder && String(destFolder).trim()) || 'imports';
  const destRoot = path.join(vaultRoot, rel);
  const files = collectFiles(srcRoot);
  let imported = 0, renamed = 0, skipped = 0;
  for (const f of files) {
    const relPath = path.relative(srcRoot, f);
    const dest = path.join(destRoot, relPath);
    try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch { skipped++; continue; }
    if (fs.existsSync(dest)) { skipped++; continue; } // already imported
    try { fs.copyFileSync(f, dest); imported++; } catch { skipped++; }
  }
  return { imported, renamed, skipped, dest: destRoot, total: files.length };
}

module.exports = { importNotes, collectFiles };
