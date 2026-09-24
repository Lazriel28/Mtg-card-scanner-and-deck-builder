'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

// shared fixture catalog for collection/decks/suggest tests
const catalog = require('../src/catalog');
const collection = require('../src/collection');
const decks = require('../src/decks');
const suggest = require('../src/suggest');

const FIXTURES = [
  { name: 'Lightning Bolt', manaCost: '{R}', cmc: 1, colors: ['R'], type: 'Instant', text: 'Lightning Bolt deals 3 damage to any target.', keywords: [], set: 'lea', collector: '1', legal: { commander: 'legal' }, priceUsd: 2, image: null },
  { name: 'Giant Growth', manaCost: '{G}', cmc: 1, colors: ['G'], type: 'Instant', text: 'Target creature gets +3/+3 until end of turn.', keywords: [], set: 'lea', collector: '2', legal: { commander: 'legal' }, priceUsd: 0.25, image: null },
  { name: 'Counterspell', manaCost: '{U}{U}', cmc: 2, colors: ['U'], type: 'Instant', text: 'Counter target spell.', keywords: [], set: 'lea', collector: '3', legal: { commander: 'legal' }, priceUsd: 1.5, image: null },
  { name: 'Serra Angel', manaCost: '{2}{W}{W}', cmc: 4, colors: ['W'], type: 'Creature — Angel', text: 'Vigilance', keywords: ['Vigilance'], set: 'lea', collector: '4', legal: { commander: 'legal' }, priceUsd: 0.5, image: null },
  { name: 'Hill Giant', manaCost: '{3}{R}', cmc: 4, colors: ['R'], type: 'Creature — Giant', text: '', keywords: [], set: 'lea', collector: '5', legal: { commander: 'legal' }, priceUsd: 0.25, image: null },
  { name: 'Mountain', manaCost: '', cmc: 0, colors: [], type: 'Basic Land — Mountain', text: '({T}: Add {R}.)', keywords: [], set: 'lea', collector: '6', legal: { commander: 'legal' }, priceUsd: 1.5, image: null },
  { name: 'Island', manaCost: '', cmc: 0, colors: [], type: 'Basic Land — Island', text: '({T}: Add {U}.)', keywords: [], set: 'lea', collector: '7', legal: { commander: 'legal' }, priceUsd: 1.2, image: null },
];

test('setup: fixture catalog for engine tests', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-engine-'));
  const lines = FIXTURES.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(path.join(dir, 'cards.jsonl'), zlib.gzipSync(Buffer.from(lines)));
  catalog.setDataDir(dir);
  collection.setDataDir(dir);
  decks.setDataDir(dir);
  suggest.setDataDir(dir);
  collection.attachCatalog(catalog);
  decks.attachCatalog(catalog);
  suggest.attachCatalog(catalog);
  suggest.attachCollection({ list: () => collection.list() });
  decks.attachHave(name => {
    const e = collection.list().find(x => x.name.toLowerCase() === name.toLowerCase());
    return e ? e.qty : 0;
  });
});

// ---------- collection ----------

test('collection: add, categorize, stats', () => {
  collection.addCard({ name: 'Lightning Bolt', qty: 3 });
  collection.addCard({ name: 'Mountain', qty: 10 });
  collection.addCard({ name: 'Counterspell', qty: 1 });

  const list = collection.list();
  const bolt = list.find(x => x.name === 'Lightning Bolt');
  assert.strictEqual(bolt.qty, 3);
  assert.ok(bolt.categories.includes('Instants'));
  assert.ok(bolt.categories.includes('Red'));

  const groups = collection.byCategory();
  assert.ok(groups.Instants.some(x => x.name === 'Lightning Bolt'));
  assert.ok(groups.Lands.some(x => x.name === 'Mountain'));

  const stats = collection.stats();
  assert.strictEqual(stats.totalCards, 14);
  assert.ok(stats.totalValue > 0);
});

test('collection: quantity ops', () => {
  collection.setQty('Lightning Bolt', 5);
  assert.strictEqual(collection.list().find(x => x.name === 'Lightning Bolt').qty, 5);
  collection.removeCard('Counterspell');
  assert.ok(!collection.list().some(x => x.name === 'Counterspell'));
  collection.setQty('Lightning Bolt', 3); // restore for later tests
});

test('collection: decklist import with set codes and foils', () => {
  const r = collection.importDecklist('2 Giant Growth (LEA) 2\n1 Serra Angel *F*\n// comment\n999x Not A Real Card');
  assert.deepStrictEqual(r.added.map(a => a.name), ['Giant Growth', 'Serra Angel']);
  assert.deepStrictEqual(r.unknown, ['999x Not A Real Card'.replace(/^999x\s+/, '')]);
  collection.removeCard('Giant Growth');
  collection.removeCard('Serra Angel');
});

test('collection: unknown card rejected', () => {
  assert.throws(() => collection.addCard({ name: 'Fake Card' }), /unknown card/i);
});

// ---------- decks ----------

test('decks: create, add cards, validate commander format', () => {
  const d = decks.createDeck({ name: 'Bolt Storm', format: 'commander', commander: null });
  // commander with singleton enforcement
  decks.updateDeck(d.id, { commander: 'Lightning Bolt' }); // not a real commander, fine for logic
  decks.addCardToDeck(d.id, 'Mountain', 30);
  const v = decks.validate(decks.getDeck(d.id));
  assert.ok(!v.ok); // under 100 cards
  assert.ok(v.problems.some(p => /at least 100/.test(p)));

  decks.removeCardFromDeck(d.id, 'Mountain');
  decks.deleteDeck(d.id);
});

test('decks: 4-of rule and color identity', () => {
  const d = decks.createDeck({ name: 'Sixty', format: 'sixty' });
  decks.addCardToDeck(d.id, 'Lightning Bolt', 5);
  let v = decks.validate(decks.getDeck(d.id));
  assert.ok(v.problems.some(p => /max 4/.test(p)));

  decks.removeCardFromDeck(d.id, 'Lightning Bolt');
  decks.addCardToDeck(d.id, 'Counterspell', 2);
  decks.addCardToDeck(d.id, 'Lightning Bolt', 4);
  v = decks.validate(decks.getDeck(d.id));
  assert.ok(!v.problems.some(p => /max 4/.test(p)));
  assert.ok(v.colorIdentity.includes('U') || v.colorIdentity.includes('R'));

  decks.deleteDeck(d.id);
});

test('decks: curve stats', () => {
  const c = decks.curve([
    { name: 'Lightning Bolt', qty: 4 },
    { name: 'Serra Angel', qty: 2 },
    { name: 'Mountain', qty: 10 },
  ]);
  assert.strictEqual(c.buckets[1], 4);
  assert.strictEqual(c.buckets[4], 2);
  assert.strictEqual(c.lands, 10);
  assert.ok(c.avgCmc > 0);
});

test('decks: missing-from-collection gaps', () => {
  const d = decks.createDeck({ name: 'Gaps', format: 'sixty' });
  decks.addCardToDeck(d.id, 'Counterspell', 2); // removed from collection in an earlier test
  const miss = decks.missingFromCollection(d.id);
  const cs = miss.find(x => x.name === 'Counterspell');
  assert.strictEqual(cs.missing, 2);
  decks.deleteDeck(d.id);
});

// ---------- suggest ----------

test('suggest: builds a mono-red 60-card deck from collection', () => {
  // stack the collection: 12 bolts, 8 hills, 40 mountains
  collection.addCard({ name: 'Lightning Bolt', qty: 12 });
  collection.addCard({ name: 'Hill Giant', qty: 8 });
  collection.addCard({ name: 'Mountain', qty: 40 });

  const r = suggest.suggest({ format: 'sixty', colors: ['R'] });
  assert.strictEqual(r.format, 'sixty');
  const names = new Set(r.deck.map(l => l.name));
  assert.ok(names.has('Lightning Bolt'));
  assert.ok(names.has('Mountain'));

  // 4-of cap respected for nonlands
  const bolt = r.deck.find(l => l.name === 'Lightning Bolt');
  assert.ok(bolt.qty <= 4);

  // only 8 unique nonland cards owned -> deck is honest about the shortfall
  const size = r.deck.reduce((a, l) => a + l.qty, 0);
  assert.strictEqual(size, 32);
  assert.ok(r.notes.some(n => /nonland slots/.test(n)));
});

test('suggest: commander singleton (basics exempt)', () => {
  const r = suggest.suggest({ format: 'commander', colors: ['R'] });
  for (const line of r.deck) {
    const rec = catalog.get(line.name);
    if (!rec || /^basic land/i.test(rec.type)) continue;
    assert.ok(line.qty <= 1, `singleton violated: ${line.name} x${line.qty}`);
  }
});

test('suggest: color mismatch explains itself', () => {
  assert.throws(() => suggest.suggest({ format: 'sixty', colors: ['G'] }), /no collection cards match/i);
});

test('suggest: playstyle memory learns', () => {
  suggest.recordDeck([{ name: 'Lightning Bolt', qty: 4 }], ['R']);
  const aff = suggest.styleAffinity();
  assert.ok(aff.R > 0);
  assert.deepStrictEqual(suggest.favoriteColors(), ['R']);
});
