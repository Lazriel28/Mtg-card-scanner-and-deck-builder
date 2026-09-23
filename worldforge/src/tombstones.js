'use strict';
// Tombstone log: records notes deleted from inside WorldForge, with dates.
// Used by the importer to tell "deleted in WorldForge recently" (safe to
// restore on re-import) apart from "gone for a while" (never resurrect).
// Stored in <vault>/.worldforge/ so Obsidian and the vault scanner ignore it.
// Pure fs; vault root is a parameter so tests can use temp folders.

const fs = require('fs');
const path = require('path');

const FILE = '.worldforge/tombstones.json';
const DAY_MS = 24 * 60 * 60 * 1000;
// Re-import restores a WorldForge deletion only within this grace window;
// after that, deleting + re-importing no longer brings it back.
const GRACE_DAYS = 7;

function tombFile(vaultRoot) { return path.join(vaultRoot, FILE); }

function load(vaultRoot) {
  try { return JSON.parse(fs.readFileSync(tombFile(vaultRoot), 'utf8')); }
  catch { return {}; } // id -> ISO timestamp of deletion
}

function save(vaultRoot, tombs) {
  fs.mkdirSync(path.dirname(tombFile(vaultRoot)), { recursive: true });
  fs.writeFileSync(tombFile(vaultRoot), JSON.stringify(tombs, null, 1));
}

// Record a deletion (called by the trash flow). id: vault-relative path.
function record(vaultRoot, ids, when = Date.now()) {
  const tombs = load(vaultRoot);
  for (const id of ids) tombs[id] = new Date(when).toISOString();
  save(vaultRoot, tombs);
  return tombs;
}

// Remove tombstones for ids that exist again (restored or recreated).
function clear(vaultRoot, ids) {
  const tombs = load(vaultRoot);
  let changed = false;
  for (const id of ids) if (id in tombs) { delete tombs[id]; changed = true; }
  if (changed) save(vaultRoot, tombs);
}

// Is this id a *recent* WorldForge deletion? (restore is allowed)
function isRecent(vaultRoot, id, now = Date.now(), graceDays = GRACE_DAYS) {
  const t = load(vaultRoot)[id];
  if (!t) return false;
  const age = now - Date.parse(t);
  return Number.isFinite(age) && age >= 0 && age <= graceDays * DAY_MS;
}

// Is this id tombstoned at all (recent or old)? (resurrection forbidden)
function has(vaultRoot, id) { return id in load(vaultRoot); }

module.exports = { record, clear, isRecent, has, load, GRACE_DAYS };
