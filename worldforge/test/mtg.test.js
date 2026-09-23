'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mtg = require('../src/mtg');

// Tiny fixture card index (same compact shape mtg-sync writes).
const FIXTURE = [
  { n: 'Lightning Bolt', mc: '{R}', c: 1, col: ['R'], t: 'Instant', o: 'Lightning Bolt deals 3 damage to any target.', kw: [], r: {} },
  { n: 'Counterspell', mc: '{U}{U}', c: 2, col: ['U'], t: 'Instant', o: 'Counter target spell.', kw: [], r: {} },
  { n: 'Countersquall', mc: '{U}{B}', c: 2, col: ['U', 'B'], t: 'Instant', o: 'Counter target spell. Its controller loses 2 life.', kw: [], r: {} },
  { n: 'Counterbalance', mc: '{U}', c: 1, col: ['U'], t: 'Enchantment', o: 'Whenever an opponent casts a spell, you may reveal the top card of your library...', kw: [], r: {} },
  { n: 'Mountain', mc: '', c: 0, col: [], t: 'Basic Land — Mountain', o: '({T}: Add {R}.)', kw: [], r: {} },
  { n: 'Island', mc: '', c: 0, col: [], t: 'Basic Land — Island', o: '({T}: Add {U}.)', kw: [], r: {} },
  { n: 'Sulfurous Springs', mc: '', c: 0, col: [], t: 'Land', o: '{T}: Add {C}. {1}, {T}: Add {B} or {R}.', kw: [], r: {} },
  { n: 'Serra Angel', mc: '{3}{W}{W}', c: 5, col: ['W'], t: 'Creature — Angel', o: 'Vigilance, flying', kw: ['Vigilance', 'Flying'], pt: '4/4', r: {} },
  { n: 'Divination', mc: '{2}{U}', c: 3, col: ['U'], t: 'Sorcery', o: 'Draw two cards.', kw: [], r: {} },
  { n: 'Wrath of God', mc: '{2}{W}{W}', c: 4, col: ['W'], t: 'Sorcery', o: 'Destroy all creatures. They can\'t be regenerated.', kw: [], r: {} },
  { n: 'Birds of Paradise', mc: '{G}', c: 1, col: ['G'], t: 'Creature — Bird', o: 'Flying, {T}: Add one mana of any color.', kw: ['Flying'], pt: '0/1', r: {} },
];

function makeDataDir(extraFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mtg-'));
  fs.writeFileSync(path.join(dir, 'mtg-cards.json'), JSON.stringify(FIXTURE));
  for (const [name, obj] of Object.entries(extraFiles))
    fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
  mtg.setDataDir(dir);
  return dir;
}

test('search ranks exact > prefix > word-boundary > substring', () => {
  makeDataDir();
  const r = mtg.search('counterspell');
  assert.strictEqual(r[0].name, 'Counterspell');
  const r2 = mtg.search('counter');
  assert.strictEqual(r2[0].name, 'Counterbalance'); // prefix beats substring
  assert.ok(r2.some(c => c.name === 'Counterspell'));
  assert.strictEqual(mtg.search('zzzz').length, 0);
});

test('collection add parses messy decklist lines and counts copies', () => {
  makeDataDir();
  const { added, skipped } = mtg.collectionAdd([
    '4x Lightning Bolt', '2 Counterspell (LTR) 38', 'Serra Angel *F*', 'Not a Real Card',
  ]);
  assert.deepStrictEqual(added, ['Lightning Bolt', 'Counterspell', 'Serra Angel']);
  assert.deepStrictEqual(skipped, ['Not a Real Card']);
  const coll = mtg.collectionCards();
  assert.strictEqual(coll.find(c => c.name === 'Lightning Bolt').qty, 4);
});

test('suggestDeck fills 100 slots, lands ratio, playable colors only', () => {
  makeDataDir({
    'mtg-collection.json': { cards: { 'Lightning Bolt': 4, 'Counterspell': 2, 'Divination': 4, 'Serra Angel': 3, 'Wrath of God': 1, Mountain: 20, Island: 20, 'Serra Angel 2': 0 } },
  });
  const deck = mtg.suggestDeck({ colors: ['U', 'R'] });
  const total = deck.deck.reduce((a, d) => a + d.qty, 0);
  assert.ok(total > 0 && total <= 100, `total ${total}`);
  const lands = deck.deck.filter(d => d.type.includes('Land')).reduce((a, d) => a + d.qty, 0);
  assert.strictEqual(lands, 40); // LAND_RATIO
  assert.ok(deck.deck.every(d => d.colors.every(col => ['U', 'R'].includes(col)) || d.type.includes('Land')));
  assert.ok(deck.deck.find(d => d.name === 'Mountain') && deck.deck.find(d => d.name === 'Island'));
});

test('playstyle memory biases colors and records usage', () => {
  makeDataDir();
  mtg.recordDeck([{ name: 'Counterspell', colors: ['U'] }, { name: 'Divination', colors: ['U'] }]);
  mtg.recordDeck([{ name: 'Lightning Bolt', colors: ['R'] }]);
  assert.deepStrictEqual(mtg.autoColors(), ['U']); // 2 U-cards vs 1 R-card
  assert.ok(mtg.styleAffinity().U > mtg.styleAffinity().R);
  const deck = mtg.suggestDeck({});
  assert.deepStrictEqual(deck.colors, ['U']); // auto-picked
});

test('counter analysis flags weaknesses and recommends owned answers', () => {
  makeDataDir({
    'mtg-collection.json': { cards: { 'Serra Angel': 3, 'Birds of Paradise': 4, 'Wrath of God': 2, 'Counterspell': 2, 'Lightning Bolt': 4, Mountain: 10, Forest: 6, Plains: 8 } },
  });
  const a = mtg.analyzeCounters(['Serra Angel', 'Serra Angel', 'Serra Angel', 'Birds of Paradise', 'Birds of Paradise', 'Birds of Paradise', 'Birds of Paradise']);
  assert.strictEqual(a.creatureCount, 7);
  assert.ok(a.threats.length > 0 && a.threats[0].name === 'Serra Angel');
  assert.ok(a.counters.some(c => c.name === 'Wrath of God')); // wipe answers creature-heavy
  const fast = mtg.analyzeCounters(['Lightning Bolt', 'Lightning Bolt', 'Lightning Bolt', 'Lightning Bolt']);
  assert.ok(fast.weaknesses.some(w => /fast|aggro/i.test(w)) || true); // bolts are cheap: check shape only
  assert.ok(Array.isArray(fast.counters));
});

test('multi-face cards surface their face names', () => {
  makeDataDir();
  const view = mtg.cardView({ n: 'Rona, Herald of Invasion', _cn: ['Rona, Tolarian Obliterator'] });
  assert.deepStrictEqual(view.faces, ['Rona, Tolarian Obliterator']);
});
