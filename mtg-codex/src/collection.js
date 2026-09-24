'use strict';
// Collection: your cards, each with quantity, condition, and (optionally) the
// photo you snapped of it. Every card is auto-categorized by type, colors,
// rarity band and value. Plain JSON on disk, tiny enough to rewrite on change.

const fs = require('fs');
const path = require('path');

let dataDir = path.join(__dirname, '..', 'data');
function setDataDir(dir) { dataDir = dir; }

const file = name => path.join(dataDir, name);
const COLLECTION = 'collection.json';

let catalog = { get: () => null };
function attachCatalog(c) { catalog = c; }

function load() {
  try { return JSON.parse(fs.readFileSync(file(COLLECTION), 'utf8')); }
  catch { return { entries: {}, history: [] }; }
}
function save(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(COLLECTION), JSON.stringify(db, null, 1));
}

// ---------- auto-categorization ----------
// Derives human-friendly categories from the card record. Pure function —
// tested directly in test/collection.test.js.

const RARITY_BAND = r => (r === 'mythic' ? 'Mythic' : r === 'rare' ? 'Rare' : r === 'uncommon' ? 'Uncommon' : 'Common');

function categoriesFor(rec) {
  if (!rec) return [];
  const cats = [];
  const t = (rec.type || '').toLowerCase();
  const isLand = t.includes('land');
  if (isLand) cats.push('Lands');
  else if (t.includes('creature')) cats.push('Creatures');
  else if (t.includes('instant')) cats.push('Instants');
  else if (t.includes('sorcery')) cats.push('Sorceries');
  else if (t.includes('enchantment')) cats.push('Enchantments');
  else if (t.includes('artifact')) cats.push('Artifacts');
  else if (t.includes('planeswalker')) cats.push('Planeswalkers');
  else cats.push('Other');

  if (rec.legal && rec.legal.commander === 'legal') cats.push('Commander-legal');

  const colors = rec.colors || [];
  if (!colors.length) cats.push('Colorless');
  else if (colors.length === 1) cats.push({ W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }[colors[0]] || colors[0]);
  else cats.push(`Multicolor (${colors.length})`);

  if (rec.cmc >= 0) {
    if (rec.cmc <= 2) cats.push('Early (0–2 MV)');
    else if (rec.cmc <= 4) cats.push('Mid (3–4 MV)');
    else cats.push('Big (5+ MV)');
  }
  return cats;
}

// ---------- CRUD ----------

function entryKey(name) { return name.toLowerCase(); }

function addCard({ name, qty = 1, condition = 'NM', photo = null, setCode = null, collector = null, note = '' }) {
  const rec = catalog.get(name);
  if (!rec) throw new Error(`unknown card: ${name}`);
  const db = load();
  const key = entryKey(rec.name);
  const existing = db.entries[key];
  if (existing) {
    existing.qty += qty;
    if (photo) existing.photo = photo;
    if (condition) existing.condition = condition;
    existing.updated = Date.now();
  } else {
    db.entries[key] = {
      name: rec.name, qty, condition, photo,
      setCode: setCode || rec.set, collector: collector || rec.collector,
      categories: categoriesFor(rec), value: rec.priceUsd || 0,
      added: Date.now(), updated: Date.now(), note,
    };
  }
  db.history.unshift({ at: Date.now(), op: existing ? 'add' : 'new', card: rec.name, qty });
  db.history = db.history.slice(0, 200);
  save(db);
  return db.entries[key];
}

function setQty(name, qty) {
  const db = load();
  const key = entryKey(name);
  const rec = catalog.get(name);
  if (!rec && qty > 0) throw new Error(`unknown card: ${name}`);
  const k = rec ? entryKey(rec.name) : key;
  const e = db.entries[k];
  if (!e) throw new Error(`not in collection: ${name}`);
  e.qty = qty;
  if (qty <= 0) delete db.entries[k];
  db.history.unshift({ at: Date.now(), op: 'set', card: e.name, qty });
  db.history = db.history.slice(0, 200);
  save(db);
  return db;
}

function removeCard(name) { return setQty(name, 0); }

function attachPhoto(name, photoPath) {
  const db = load();
  const e = db.entries[entryKey(name)];
  if (!e) throw new Error(`not in collection: ${name}`);
  e.photo = photoPath;
  e.updated = Date.now();
  save(db);
  return e;
}

function list() {
  const db = load();
  return Object.values(db.entries).sort((a, b) => a.name.localeCompare(b.name));
}

function count() { return list().reduce((a, e) => a + e.qty, 0); }

// Grouped view for the UI: categories -> cards.
function byCategory() {
  const groups = {};
  for (const e of list()) {
    for (const c of (e.categories || [])) {
      (groups[c] = groups[c] || []).push(e);
    }
  }
  return groups;
}

function stats() {
  const entries = list();
  const total = entries.reduce((a, e) => a + e.qty, 0);
  const value = entries.reduce((a, e) => a + e.qty * (e.value || 0), 0);
  const catTotals = {};
  for (const e of entries) {
    for (const c of (e.categories || [])) catTotals[c] = (catTotals[c] || 0) + e.qty;
  }
  const colorTotals = {};
  const COLOR_CATS = ['White', 'Blue', 'Black', 'Red', 'Green', 'Colorless'];
  for (const [c, n] of Object.entries(catTotals)) {
    if (COLOR_CATS.includes(c) || c.startsWith('Multicolor')) colorTotals[c] = n;
  }
  return { totalCards: total, uniqueCards: entries.length, totalValue: Math.round(value * 100) / 100, categories: catTotals, colors: colorTotals };
}

// Import a pasted decklist ("4x Lightning Bolt", "1 Savathun..." etc).
// Returns what was added and what was not recognized.
function importDecklist(text) {
  const added = [], unknown = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    let l = line.trim();
    if (!l) continue;
    let qty = 1;
    const m = l.match(/^(\d+)\s*[xX]?\s+(.*)$/);
    if (m) { qty = parseInt(m[1], 10) || 1; l = m[2]; }
    l = l.replace(/\s*\[[^\]]*\]\s*$/, '');
    l = l.replace(/\s*\([A-Z0-9]+\)\s*\w*\s*$/, '');
    l = l.replace(/\s*\*F\*$/i, '');
    l = l.trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) continue;
    try {
      addCard({ name: l, qty });
      added.push({ name: l, qty });
    } catch {
      unknown.push(l);
    }
  }
  return { added, unknown };
}

module.exports = {
  setDataDir, attachCatalog, load, save, categoriesFor,
  addCard, setQty, removeCard, attachPhoto, list, count, byCategory, stats, importDecklist,
};
