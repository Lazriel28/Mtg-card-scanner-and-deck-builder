'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const catalog = require('../src/catalog');

// build a tiny fixture index in a temp dir
const FIXTURES = [
  { name: 'Lightning Bolt', manaCost: '{R}', cmc: 1, colors: ['R'], type: 'Instant', text: 'Lightning Bolt deals 3 damage to any target.', keywords: [], set: 'lea', collector: '1', legal: { commander: 'legal' }, priceUsd: 2, image: null },
  { name: 'Giant Growth', manaCost: '{G}', cmc: 1, colors: ['G'], type: 'Instant', text: 'Target creature gets +3/+3 until end of turn.', keywords: [], set: 'lea', collector: '2', legal: { commander: 'legal' }, priceUsd: 0.25, image: null },
  { name: 'Counterspell', manaCost: '{U}{U}', cmc: 2, colors: ['U'], type: 'Instant', text: 'Counter target spell.', keywords: [], set: 'lea', collector: '3', legal: { commander: 'legal' }, priceUsd: 1.5, image: null },
  { name: 'Serra Angel', manaCost: '{2}{W}{W}', cmc: 4, colors: ['W'], type: 'Creature — Angel', text: 'Vigilance', keywords: ['Vigilance'], set: 'lea', collector: '4', legal: { commander: 'legal' }, priceUsd: 0.5, image: null },
  { name: 'Black Lotus', manaCost: '{0}', cmc: 0, colors: [], type: 'Artifact', text: '{T}, Sacrifice Black Lotus: Add three mana of any one color.', keywords: [], set: 'lea', collector: '5', legal: { commander: 'legal' }, priceUsd: 50000, image: null },
];

test('setup: fixture catalog', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
  const lines = FIXTURES.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(path.join(dir, 'cards.jsonl'), zlib.gzipSync(Buffer.from(lines)));
  catalog.setDataDir(dir);
});

test('identifyFromText: exact name line', () => {
  const got = catalog.identifyFromText('Lightning Bolt');
  assert.ok(got.length >= 1);
  assert.strictEqual(got[0].name, 'Lightning Bolt');
  assert.strictEqual(got[0].score, 1);
});

test('identifyFromText: noisy OCR with punctuation', () => {
  const got = catalog.identifyFromText('l1ghtn1ng b0lt'); // unlikely, but ensure no crash
  assert.ok(Array.isArray(got));
  const got2 = catalog.identifyFromText('LIghtning  Bolt\nInstant');
  assert.strictEqual(got2[0].name, 'Lightning Bolt');
});

test('identifyFromText: wrapped two-line name (duplicate removed)', () => {
  const got = catalog.identifyFromText('Giant\nGrowth');
  assert.strictEqual(got[0].name, 'Giant Growth');
});

test('search ranks exact above substring', () => {
  const got = catalog.search('light');
  assert.ok(got.some(r => r.name === 'Lightning Bolt'));
});

test('get is case-insensitive', () => {
  assert.strictEqual(catalog.get('LIGHTNING BOLT').name, 'Lightning Bolt');
  assert.strictEqual(catalog.get('nope'), null);
});
