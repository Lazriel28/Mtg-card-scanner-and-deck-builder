'use strict';
// Decks: stored decks, format rules (Commander 100 singleton / 60-card 4-of),
// validation, and per-deck stats. Pure logic over the catalog; file I/O is
// limited to reading/writing the deck store JSON.

const fs = require('fs');
const path = require('path');

let dataDir = path.join(__dirname, '..', 'data');
function setDataDir(dir) { dataDir = dir; }
let catalog = { get: () => null };
function attachCatalog(c) { catalog = c; }
let haveQty = () => 0;
function attachHave(fn) { haveQty = fn; }

const file = name => path.join(dataDir, name);
const DECKS_FILE = 'decks.json';

function loadAll() {
  try { return JSON.parse(fs.readFileSync(file(DECKS_FILE), 'utf8')); }
  catch { return { nextId: 1, decks: [] }; }
}
function saveAll(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(DECKS_FILE), JSON.stringify(db, null, 1));
}

// ---------- formats ----------

const FORMATS = {
  commander: {
    label: 'Commander',
    deckMin: 100, deckMax: 100,
    maxCopies: 1,
    colorsFromCommander: true,
    needsCommander: true,
    description: '100 cards, singleton, all colors must appear on your commander',
  },
  sixty: {
    label: '60-card',
    deckMin: 60, deckMax: null, // + up to 15 sideboard
    maxCopies: 4,
    colorsFromCommander: false,
    needsCommander: false,
    description: 'minimum 60 cards, up to 4 copies of each card except basics',
  },
};

function format(name) { return FORMATS[name] || FORMATS.sixty; }

const isBasicLand = rec => !!rec && /^basic land/i.test(rec.type || '');

function deckCopies(deck) {
  const totals = new Map();
  for (const line of deck) totals.set(line.name, (totals.get(line.name) || 0) + line.qty);
  return totals;
}

// Validate a deck {format, commander, cards:[{name, qty}], sideboard:[...]}.
// Returns {ok, problems:[], warnings:[], size, colorIdentity}.
function validate(deck) {
  const f = format(deck.format);
  const problems = [];
  const warnings = [];

  const cards = Array.isArray(deck.cards) ? deck.cards : [];
  const side = Array.isArray(deck.sideboard) ? deck.sideboard : [];
  const size = cards.reduce((a, c) => a + c.qty, 0);

  // resolve color identity
  let colorIdentity = [];
  if (f.needsCommander) {
    const cmdr = deck.commander ? catalog.get(deck.commander) : null;
    if (!cmdr) problems.push('Commander required for this format');
    else {
      colorIdentity = cmdr.colors || [];
      const cmdrText = (cmdr.type || '') + ' ' + (cmdr.text || '');
      if (/commander can be your commander/i.test(cmdrText)) {
        // odds-and-ends backgrounds etc: keep identity from colors only
      }
    }
  } else {
    const seen = new Set();
    for (const c of cards) {
      const rec = catalog.get(c.name);
      if (rec) for (const col of rec.colors) seen.add(col);
    }
    colorIdentity = [...seen];
  }

  for (const line of [...cards, ...side]) {
    const rec = catalog.get(line.name);
    if (!rec) { problems.push(`Unknown card: ${line.name}`); continue; }
    if (!isBasicLand(rec) && line.qty > f.maxCopies) {
      problems.push(`${line.name}: ${line.qty} copies (max ${f.maxCopies} in ${f.label})`);
    }
    if (f.colorsFromCommander && colorIdentity.length) {
      const outside = (rec.colors || []).filter(col => !colorIdentity.includes(col));
      if (outside.length) problems.push(`${line.name}: color identity ${outside.join('')} outside commander's ${colorIdentity.join('')}`);
    }
  }

  if (size < f.deckMin) problems.push(`Deck has ${size} cards — ${f.label} needs at least ${f.deckMin}`);
  if (f.deckMax && size > f.deckMax) problems.push(`Deck has ${size} cards — max is ${f.deckMax}`);
  const sideSize = side.reduce((a, c) => a + c.qty, 0);
  if (!f.needsCommander && sideSize > 15) problems.push(`Sideboard has ${sideSize} cards — max 15`);

  if (f.needsCommander) {
    const cmdrCount = cards.concat(side).filter(c => catalog.get(c.name) === catalog.get(deck.commander)).reduce((a, c) => a + c.qty, 0);
    if (deck.commander && cmdrCount !== 1) problems.push('Commander deck must contain exactly one copy of the commander (in the command zone)');
  }

  return { ok: problems.length === 0, problems, warnings, size, sideboardSize: sideSize, colorIdentity, format: f.label };
}

// ---------- stats ----------

function curve(cards) {
  const buckets = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, '5+': 0 };
  let lands = 0, nonlandCount = 0, cmcSum = 0;
  const colors = {};
  for (const line of cards) {
    const rec = catalog.get(line.name);
    if (!rec) continue;
    if (/^basic land|land/i.test(rec.type) && (rec.type || '').includes('Land')) { lands += line.qty; continue; }
    const b = rec.cmc >= 5 ? '5+' : Math.floor(rec.cmc);
    buckets[b] += line.qty;
    nonlandCount += line.qty;
    cmcSum += rec.cmc * line.qty;
    for (const col of (rec.colors.length ? rec.colors : ['C'])) colors[col] = (colors[col] || 0) + line.qty;
  }
  return {
    buckets, lands, avgCmc: nonlandCount ? Math.round((cmcSum / nonlandCount) * 10) / 10 : 0,
    colors,
  };
}

function deckView(deck) {
  const all = [{ name: deck.commander, qty: 1 }, ...deck.cards].filter(c => c.name);
  const c = curve(all);
  return {
    id: deck.id, name: deck.name, format: deck.format,
    formatLabel: format(deck.format).label,
    commander: deck.commander || null,
    cards: deck.cards, sideboard: deck.sideboard || [],
    size: deck.cards.reduce((a, x) => a + x.qty, 0),
    stats: { curve: c.buckets, lands: c.lands, avgCmc: c.avgCmc, colors: c.colors },
    notes: deck.notes || '',
    updated: deck.updated,
  };
}

function listDecks() { return loadAll().decks.map(deckView); }

function createDeck({ name, format: fmt, commander = null, notes = '' }) {
  const db = loadAll();
  const d = {
    id: db.nextId++, name: String(name || 'New deck'), format: fmt,
    commander, cards: [], sideboard: [], notes, created: Date.now(), updated: Date.now(),
  };
  if (fmt === 'commander' && commander) d.cards.push({ name: commander, qty: 1 });
  db.decks.push(d);
  saveAll(db);
  return deckView(d);
}

function getDeck(id) {
  const d = loadAll().decks.find(x => x.id === id);
  return d ? deckView(d) : null;
}

function updateDeck(id, patch) {
  const db = loadAll();
  const d = db.decks.find(x => x.id === id);
  if (!d) throw new Error(`no deck ${id}`);
  if (patch.name !== undefined) d.name = String(patch.name);
  if (patch.notes !== undefined) d.notes = String(patch.notes);
  if (patch.commander !== undefined) d.commander = patch.commander;
  if (patch.format !== undefined && FORMATS[patch.format]) d.format = patch.format;
  if (Array.isArray(patch.cards)) d.cards = patch.cards.map(c => ({ name: String(c.name), qty: Math.max(0, c.qty | 0) })).filter(c => c.qty > 0);
  if (Array.isArray(patch.sideboard)) d.sideboard = patch.sideboard.map(c => ({ name: String(c.name), qty: Math.max(0, c.qty | 0) })).filter(c => c.qty > 0);
  d.updated = Date.now();
  saveAll(db);
  return deckView(d);
}

function deleteDeck(id) {
  const db = loadAll();
  const before = db.decks.length;
  db.decks = db.decks.filter(x => x.id !== id);
  saveAll(db);
  return db.decks.length < before;
}

// Add a card from the collection (or anywhere) into a deck.
function addCardToDeck(id, name, qty = 1, sideboard = false) {
  const db = loadAll();
  const d = db.decks.find(x => x.id === id);
  if (!d) throw new Error(`no deck ${id}`);
  const rec = catalog.get(name);
  if (!rec) throw new Error(`unknown card: ${name}`);
  const target = sideboard ? 'sideboard' : 'cards';
  const line = d[target].find(c => c.name === rec.name);
  if (line) line.qty += qty; else d[target].push({ name: rec.name, qty });
  d.updated = Date.now();
  saveAll(db);
  return deckView(d);
}

function removeCardFromDeck(id, name, sideboard = false) {
  const db = loadAll();
  const d = db.decks.find(x => x.id === id);
  if (!d) throw new Error(`no deck ${id}`);
  const target = sideboard ? 'sideboard' : 'cards';
  d[target] = d[target].filter(c => c.name !== name);
  d.updated = Date.now();
  saveAll(db);
  return deckView(d);
}

// From your collection: what you own vs what the deck needs.
function missingFromCollection(id) {
  const d = loadAll().decks.find(x => x.id === id);
  if (!d) throw new Error(`no deck ${id}`);
  const need = new Map();
  for (const c of d.cards) need.set(c.name, (need.get(c.name) || 0) + c.qty);
  return [...need.entries()]
    .map(([name, qty]) => {
      const rec = catalog.get(name);
      const owned = haveQty(name);
      return { name, qty, owned, missing: Math.max(0, qty - owned), type: rec ? rec.type : null };
    })
    .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
}

module.exports = {
  FORMATS, format, setDataDir, attachCatalog, attachHave,
  validate, curve, deckView, missingFromCollection,
  listDecks, createDeck, getDeck, updateDeck, deleteDeck,
  addCardToDeck, removeCardFromDeck,
};
