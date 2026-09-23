'use strict';
// MTG engine: offline card index (data from Scryfall), your collection,
// playstyle tracking, deck suggestions, and counter analysis. Pure logic,
// no rendering. Data dir is swappable so tests run on tiny fixtures.

const fs = require('fs');
const path = require('path');

const DECK_SIZE = 100;      // Commander-style default
const LAND_RATIO = 0.4;
const COLORLESS = 'C';

let dataDir = path.join(__dirname, '..', 'data');
let _cards = null;          // name -> compact card record
let _names = [];            // sorted names
let _lower = [];            // parallel lowercase names

function setDataDir(dir) {
  dataDir = dir;
  _cards = null;
}
const file = name => path.join(dataDir, name);

function cards() {
  if (_cards) return _cards;
  const list = JSON.parse(fs.readFileSync(file('mtg-cards.json'), 'utf8'));
  _cards = new Map();
  for (const c of list) if (!_cards.has(c.n)) _cards.set(c.n, c); // first print wins
  _names = [..._cards.keys()].sort();
  _lower = _names.map(n => n.toLowerCase());
  return _cards;
}

// ---------- card search / lookup ----------

// Autocomplete-style search: exact < prefix < word-start < substring.
function search(query, limit = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  cards();
  const scored = [];
  for (let i = 0; i < _names.length; i++) {
    const lower = _lower[i];
    let score = -1;
    if (lower === q) score = 0;
    else if (lower.startsWith(q)) score = 1;
    else {
      const idx = lower.indexOf(q);
      if (idx > 0 && /[\s,',]/.test(lower[idx - 1])) score = 2;  // word boundary
      else if (idx > 0) score = 3;
    }
    if (score >= 0) scored.push([score, _names[i]]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, limit).map(([, name]) => cardView(_cards.get(name)));
}

function get(name) { return cards().get(name) || null; }

// UI-facing projection; internal logic uses the raw record.
function cardView(c) {
  if (!c) return null;
  return {
    name: c.n, mana: c.mc, cmc: c.c, colors: c.col, type: c.t, text: c.o,
    keywords: c.kw, pt: c.pt, image: c.im,
    faces: c._cn,        // multi-face card names (MDFC/transform)
  };
}

// ---------- collection (your cards) ----------

function loadJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function saveJson(name, obj) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(obj, null, 1));
}

function loadCollection() { return loadJson('mtg-collection.json', { cards: {} }); }

// Normalize a pasted decklist line. "4x Lightning Bolt (LTR) 142 *F*" -> {name:'Lightning Bolt', qty:4}
function parseCardLine(line) {
  let l = line.trim();
  if (!l) return null;
  let qty = 1;
  const m = l.match(/^(\d+)\s*[xX]?\s+(.*)$/);
  if (m) { qty = parseInt(m[1], 10) || 1; l = m[2]; }
  l = l.replace(/\s*\[[^\]]*\]\s*$/, '');   // trailing [LTR]
  l = l.replace(/\s*\([A-Z0-9]+\)\s*\w*\s*$/, ''); // trailing (LTR) 142
  l = l.replace(/\s*\*F\*$/, '');           // foil marker
  return l ? { name: l, qty } : null;
}

function collectionAdd(names) {
  const coll = loadCollection();
  const added = [], skipped = [];
  for (const raw of names) {
    const parsed = parseCardLine(raw);
    if (!parsed) continue;
    if (!get(parsed.name)) { skipped.push(parsed.name); continue; }
    coll.cards[parsed.name] = (coll.cards[parsed.name] || 0) + parsed.qty;
    added.push(parsed.name);
  }
  saveJson('mtg-collection.json', coll);
  return { added, skipped };
}

function collectionSet(name, qty) {
  const coll = loadCollection();
  if (qty <= 0) delete coll.cards[name];
  else {
    if (!get(name)) throw new Error(`unknown card: ${name}`);
    coll.cards[name] = qty;
  }
  saveJson('mtg-collection.json', coll);
  return coll;
}

function collectionCards() {
  const coll = loadCollection();
  return Object.entries(coll.cards)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, qty]) => ({ ...cardView(get(name)), qty }));
}

// ---------- playstyle memory ----------

function loadStyle() { return loadJson('mtg-playstyle.json', { colorCounts: {}, cardUses: {} }); }

// Called whenever a deck is built/played so suggestions lean your way over time.
function recordDeck(deck) {
  const st = loadStyle();
  const seen = new Set();
  for (const c of deck) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    st.cardUses[c.name] = (st.cardUses[c.name] || 0) + 1;
    for (const col of (c.colors.length ? c.colors : [COLORLESS]))
      st.colorCounts[col] = (st.colorCounts[col] || 0) + 1;
  }
  saveJson('mtg-playstyle.json', st);
  return st;
}

function styleAffinity() {
  const { colorCounts } = loadStyle();
  const total = Object.values(colorCounts).reduce((a, b) => a + b, 0);
  return total
    ? Object.fromEntries(Object.entries(colorCounts).map(([k, v]) => [k, v / total]))
    : {};
}

// Strongest learned color; null before any history (then decks use all your cards).
function autoColors() {
  const ranked = Object.entries(styleAffinity())
    .filter(([c]) => c !== COLORLESS)
    .sort((a, b) => b[1] - a[1]);
  return ranked.length ? [ranked[0][0]] : null;
}

// ---------- deck suggester ----------

const playableIn = (c, colors) => !colors.length || c.col.every(col => colors.includes(col));
const isLand = c => ((c.t || c.type) + '').includes('Land');

const BASIC_OF = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

function suggestDeck(opts = {}) {
  const size = opts.size || DECK_SIZE;
  const colors = opts.colors !== undefined ? opts.colors : (autoColors() || []);
  const style = loadStyle();
  const pool = [];      // nonland candidates
  const landPool = [];  // land candidates
  for (const [name, qty] of Object.entries(loadCollection().cards)) {
    const c = get(name);
    if (!c || (colors.length && !playableIn(c, colors))) continue;
    if (isLand(c)) landPool.push({ card: c, qty, use: style.cardUses[name] || 0 });
    else pool.push({ card: c, qty, use: style.cardUses[name] || 0 });
  }

  // Score: cards you actually play first, then cheap + card-draw + bodies.
  for (const p of pool) {
    p.score = Math.min(p.use, 5) * 2
      + (p.card.c <= 4 ? 3 : 0)
      + (/draw .{0,20}cards?/i.test(p.card.o) ? 2 : 0)
      + (p.card.t.includes('Creature') ? 1.5 : 0)
      + Math.min(p.qty, 4) * 0.5;
  }
  pool.sort((a, b) => b.score - a.score || a.card.n.localeCompare(b.card.n));

  const targetLands = Math.round(size * LAND_RATIO);
  const targetNonland = size - targetLands;
  const picks = [];
  for (const p of pool) {
    if (picks.length >= targetNonland) break;
    const copies = Math.min(4, p.qty, targetNonland - picks.length);
    if (copies > 0) picks.push({ ...cardView(p.card), qty: copies });
  }

  // Lands: your nonbasics first (by usage), then basics split evenly across colors.
  landPool.sort((a, b) => b.use - a.use || a.card.n.localeCompare(b.card.n));
  const landPicks = [];
  let landCount = 0;
  for (const lp of landPool) {
    if (landCount >= targetLands) break;
    const max = lp.card.t.startsWith('Basic Land') ? lp.qty : Math.min(4, lp.qty);
    const copies = Math.min(max, targetLands - landCount);
    if (copies > 0) { landPicks.push({ ...cardView(lp.card), qty: copies }); landCount += copies; }
  }
  const basics = (colors.length ? colors : Object.keys(BASIC_OF)).map(c => BASIC_OF[c]).filter(Boolean);
  const notes = [];
  let short = targetLands - landCount;
  const ownedBasics = new Map(landPicks.filter(l => l.type.startsWith('Basic Land')).map(l => [l.name, l.qty]));
  for (const b of basics) {
    if (short <= 0) break;
    const want = Math.ceil(short / Math.max(1, basics.length - [...ownedBasics.keys()].filter(n => !basics.includes(n)).length)) || short;
    const already = ownedBasics.get(b) || 0;
    const more = Math.min(short, Math.max(2, want));
    const existing = landPicks.find(l => l.name === b);
    if (existing) existing.qty += more;
    else if (get(b)) landPicks.push({ ...cardView(get(b)), qty: more });
    short -= more;
  }
  if (short > 0) notes.push(`needs ${short} more land slots than your collection covers`);

  const deck = [...picks, ...landPicks];
  const total = deck.reduce((a, d) => a + d.qty, 0);
  const curve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, '5+': 0 };
  for (const d of deck) {
    if (isLand(d)) continue;
    const b = d.cmc >= 5 ? '5+' : Math.floor(d.cmc);
    curve[b] += d.qty;
  }
  const totalCopies = deck.reduce((a, d) => a + d.qty, 0);
  if (totalCopies < size) notes.push(`collection covers ${totalCopies} of ${size} cards — deck shown at ${totalCopies}`);
  if (!colors.length) notes.push('no play history yet — using every card you own; build a deck to teach me your colors');
  return { colors, size: total, deck, curve, notes };
}

// ---------- counter analysis ----------

function threatScore(c) {
  if (isLand(c)) return 0;
  let s = Math.min(c.c || 0, 8);
  if (c.t.includes('Creature')) s += 2;
  if (/enters the battlefield/.test(c.o)) s += 2;
  if (/(destroy|exile|sacrifice) .{0,30}(all|each)/.test(c.o)) s += 3;
  if (/search your library/.test(c.o)) s += 2;
  if (c.kw && c.kw.some(k => /protection|hexproof|indestructible/.test(k))) s += 2;
  return s;
}

function counterWhy(c, flags) {
  const o = c.o || '';
  if (/counter target/i.test(o)) return 'counterspells blank their key spells';
  if (/each creature|creatures? (all|each)|all creatures|each permanent/.test(o) && flags.hasCreatures)
    return 'board wipe — resets their creatures';
  if (flags.hasFlying && ((c.kw || []).includes('Reach') || /deals? \d+ damage to (each|all)/i.test(o)))
    return 'answers their flying threats';
  if ((c.kw || []).includes('Lifelink') || /you gain \d+ life/.test(o))
    return 'life gain outlasts their aggression';
  if (/exile target/.test(o)) return 'exile removes what destroy cannot';
  if (/destroy target (creature|artifact|permanent)/.test(o) || /deals? \d+ damage to any target/.test(o))
    return 'spot removal picks off their biggest threat';
  return null;
}

function analyzeCounters(deckNames) {
  const list = deckNames.map(get).filter(Boolean);
  const colors = [...new Set(list.flatMap(c => c.col))];
  const nonland = list.filter(c => !isLand(c));
  const creatures = nonland.filter(c => c.t.includes('Creature'));
  const flying = creatures.filter(c => (c.kw || []).includes('Flying') || /\bflying\b/i.test(c.o)).length;
  const reach = creatures.filter(c => (c.kw || []).includes('Reach')).length;

  const threats = nonland
    .map(c => ({ name: c.n, score: threatScore(c) }))
    .sort((a, b) => b.score - a.score).slice(0, 6);

  const weaknesses = [];
  const avgCmc = nonland.length ? nonland.reduce((a, c) => a + (c.c || 0), 0) / nonland.length : 0;
  if (creatures.length >= 12) weaknesses.push('Creature-heavy — board wipes and edicts clear the board');
  if (creatures.length < 8 && nonland.length >= 20) weaknesses.push('Spell-heavy — counterspells and discard blank their game plan');
  if (avgCmc >= 3.2) weaknesses.push(`Slow (avg mana value ${avgCmc.toFixed(1)}) — fast aggro wins the race`);
  else if (avgCmc > 0 && avgCmc <= 2.2) weaknesses.push(`Very fast (avg mana value ${avgCmc.toFixed(1)}) — midrange value grinds it out`);
  if (flying >= 8 && reach < 3) weaknesses.push(`Heavy fliers (${flying}) with little Reach support`);
  if (colors.length === 1) weaknesses.push('Mono-color — color-hose cards (e.g. circle of protection / dread of night style effects) hit everything');
  if (!colors.length) weaknesses.push('Colorless deck — colored protection does nothing; artifact hate is the angle');

  // Counter-cards from YOUR collection, castable-cheap first.
  const flags = { hasCreatures: creatures.length >= 5, hasFlying: flying >= 6 };
  const recs = [];
  for (const [name, qty] of Object.entries(loadCollection().cards)) {
    const c = get(name);
    if (!c || isLand(c) || c.c > 5) continue;
    const why = counterWhy(c, flags);
    if (why) recs.push({ ...cardView(c), qty, why });
  }
  recs.sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name));

  return {
    colors, creatureCount: creatures.length, avgCmc: Math.round(avgCmc * 10) / 10,
    threats, weaknesses, counters: recs.slice(0, 12),
  };
}

module.exports = {
  setDataDir, search, get, cardView,
  loadCollection, collectionAdd, collectionSet, collectionCards, parseCardLine,
  loadStyle, recordDeck, styleAffinity, autoColors,
  suggestDeck, analyzeCounters, threatScore, counterWhy,
  DECK_SIZE, LAND_RATIO,
};
