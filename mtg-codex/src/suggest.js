'use strict';
// Suggester: given a color combo, format, and your collection, proposes a
// full deck. Deterministic heuristics (no network needed): score every
// eligible card on curve position, keyword density, removal/draw density,
// then fill lands. Learns from decks you build (playstyle memory).

const fs = require('fs');
const path = require('path');

let dataDir = path.join(__dirname, '..', 'data');
function setDataDir(dir) { dataDir = dir; }
let catalog = { get: () => null };
function attachCatalog(c) { catalog = c; }
let collectionApi = { list: () => [] };
function attachCollection(c) { collectionApi = c; }

const file = name => path.join(dataDir, name);
const STYLE_FILE = 'playstyle.json';

function loadStyle() {
  try { return JSON.parse(fs.readFileSync(file(STYLE_FILE), 'utf8')); }
  catch { return { colorCounts: {}, cardUses: {} }; }
}
function saveStyle(st) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(STYLE_FILE), JSON.stringify(st, null, 1));
}

// Call after building/keeping a deck so future suggestions lean your way.
function recordDeck(deckCards, colors) {
  const st = loadStyle();
  const seen = new Set();
  for (const line of deckCards) {
    if (seen.has(line.name)) continue;
    seen.add(line.name);
    st.cardUses[line.name] = (st.cardUses[line.name] || 0) + line.qty;
    const rec = catalog.get(line.name);
    for (const col of (rec && rec.colors.length ? rec.colors : ['C'])) {
      st.colorCounts[col] = (st.colorCounts[col] || 0) + 1;
    }

  }
  saveStyle(st);
  return st;
}

function styleAffinity() {
  const { colorCounts } = loadStyle();
  const total = Object.values(colorCounts).reduce((a, b) => a + b, 0);
  return total ? Object.fromEntries(Object.entries(colorCounts).map(([k, v]) => [k, v / total])) : {};
}

// Strongest learned color, or null before any history.
function favoriteColors() {
  return Object.entries(styleAffinity())
    .filter(([c]) => c !== 'C')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([c]) => c);
}

// ---------- scoring ----------

function scoreCard(rec, opts) {
  let s = 0;
  const text = rec.text || '';
  const t = rec.type || '';

  // playstyle memory
  const uses = opts.uses.get(rec.name.toLowerCase()) || 0;
  s += Math.min(uses, 5) * 1.5;

  // curve: reward cheap-ish spells
  if (rec.cmc <= 2) s += 3;
  else if (rec.cmc <= 4) s += 2;
  else if (rec.cmc <= 6) s += 0.5;

  // role detection
  if (t.includes('Creature')) s += 2;
  if (t.includes('Instant') || t.includes('Sorcery')) s += 0.5;
  if (/destroy target|exile target|deals? \d+ damage to any target/i.test(text)) s += 2;     // removal
  if (/counter target/i.test(text)) s += 1.5;                                                  // permission
  if (/draw |investigate|surveil|scry/i.test(text)) s += 1.5;                                  // card advantage
  if (/(gain \d+ life|lifelink)/i.test(text)) s += 0.5;
  if (rec.keywords && rec.keywords.length) s += Math.min(rec.keywords.length, 3) * 0.3;
  if (t.includes('Land')) s -= 4; // lands handled separately

  // rarity proxy for power (records carry no power/toughness in text)
  if (rec.legal && rec.legal.commander === 'legal') s += 0.2;

  return s;
}

// Even basic-land split across the deck's colors. Basics are effectively free,
// so mana balance wins over ownership — shortfalls are noted, not padded.
function pickBasics(colors, need, owned, notes) {
  const BASIC_OF = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest', C: 'Wastes' };
  const out = [];
  if (need <= 0 || !colors.length) return out;
  const each = Math.floor(need / colors.length);
  const wants = colors
    .map((c, i) => ({ basic: BASIC_OF[c], want: each + (i < need % colors.length ? 1 : 0) }))
    .filter(w => w.want > 0 && w.basic && catalog.get(w.basic));
  for (const w of wants) {
    const ownedQty = owned.get(w.basic) || 0;
    if (ownedQty < w.want) notes.push(`you own ${ownedQty}× ${w.basic} — the deck wants ${w.want} (basics are cheap)`);
    out.push({ name: w.basic, qty: w.want });
  }
  return out;
}

// Build a whole deck suggestion.
function suggest({ format: fmt = 'commander', colors = null, size = null } = {}) {
  const f = fmt === 'commander'
    ? { deckSize: 100, maxCopies: 1, landFrac: 0.38, singleton: true }
    : { deckSize: 60, maxCopies: 4, landFrac: 0.4, singleton: false };
  if (size) f.deckSize = size;

  // resolve colors: explicit > favorites > all
  colors = colors && colors.length ? colors : favoriteColors();
  const st = loadStyle();
  const uses = new Map(Object.entries(st.cardUses).map(([k, v]) => [k.toLowerCase(), v]));

  // candidate pool from the collection
  const entries = collectionApi.list();
  if (!entries.length) throw new Error('your collection is empty — scan some cards first');

  const pool = [];
  for (const e of entries) {
    const rec = catalog.get(e.name);
    if (!rec) continue;
    if (/land/i.test(rec.type)) continue; // lands handled separately
    if (colors.length && !(rec.colors || []).every(c => colors.includes(c))) continue;
    pool.push({ rec, qty: e.qty, score: scoreCard(rec, { uses }) });
  }
  if (!pool.length) throw new Error(
    `no collection cards match colors ${colors.join('')} — try different colors or clear the color filter`);

  pool.sort((a, b) => b.score - a.score || a.rec.name.localeCompare(b.rec.name));

  const targetLands = Math.round(f.deckSize * f.landFrac);
  const targetNonland = f.deckSize - targetLands;

  const picks = [];
  let nonland = 0;
  let cmcSum = 0;
  for (const p of pool) {
    if (nonland >= targetNonland) break;
    const max = f.singleton ? 1 : Math.min(4, p.qty);
    const take = Math.min(max, targetNonland - nonland);
    if (take > 0) { picks.push({ name: p.rec.name, qty: take }); nonland += take; cmcSum += p.rec.cmc * take; }
  }
  // log a note when the collection is too small
  const notes = [];
  if (nonland < targetNonland) notes.push(`collection only fills ${nonland}/${targetNonland} nonland slots`);

  // lands: your nonbasics first (price order — they're the ones worth showing
  // off), then an even basic split across the deck's colors.
  const ownedBasics = new Map();
  const landEntries = entries
    .map(e => ({ e, rec: catalog.get(e.name) }))
    .filter(({ rec }) => rec && /land/i.test(rec.type) && (!colors.length || (rec.colors || []).every(c => colors.includes(c))))
    .sort((a, b) => (b.rec.priceUsd || 0) - (a.rec.priceUsd || 0));
  const landPicks = [];
  let landCount = 0;
  for (const { e, rec } of landEntries) {
    const basic = /^basic land/i.test(rec.type);
    if (basic) { ownedBasics.set(rec.name, (ownedBasics.get(rec.name) || 0) + e.qty); if (colors.length) continue; }
    if (landCount >= targetLands) break;
    // basics are exempt from copy limits; nonbasics follow the format
    const max = basic ? e.qty : (f.singleton ? 1 : Math.min(4, e.qty));
    const take = Math.min(max, targetLands - landCount);
    if (take > 0) { landPicks.push({ name: rec.name, qty: take }); landCount += take; }
  }
  for (const l of pickBasics(colors, targetLands - landCount, ownedBasics, notes)) {
    landPicks.push(l);
    landCount += l.qty;
  }
  if (landCount < targetLands) notes.push(`only ${landCount}/${targetLands} lands fillable`);

  return {
    format: fmt,
    colors,
    deck: [...picks, ...landPicks],
    stats: {
      size: nonland + landCount,
      targetSize: f.deckSize,
      lands: landCount,
      avgCmc: nonland ? Math.round(cmcSum / nonland * 10) / 10 : 0,
    },
    notes,
  };
}

module.exports = {
  setDataDir, attachCatalog, attachCollection,
  recordDeck, styleAffinity, favoriteColors, scoreCard, suggest,
};
