'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { scanVault } = require('../src/vault');
const { renderMarkdown } = require('../src/md');

const DEMO = path.join(__dirname, '..', 'demo-vault');

test('vault scan finds the Rezvani demo notes', () => {
  const v = scanVault(DEMO);
  assert.ok(v.notes.length >= 4, 'expected >=4 notes, got ' + v.notes.length);
  const titles = v.notes.map(n => n.title);
  assert.ok(titles.includes('Vengeance - War Wagon'));
  assert.ok(titles.includes('Vengeance - Spectre'));
  assert.ok(titles.includes('Garage Comparison'));
  assert.ok(titles.includes('World Index'));
});

test('wikilinks resolve between demo notes (undirected graph)', () => {
  const v = scanVault(DEMO);
  const comp = v.notes.find(n => n.title === 'Garage Comparison');
  assert.ok(comp.outgoing.length >= 2, 'comparison should link to both vehicles');
  const wagon = v.notes.find(n => n.title === 'Vengeance - War Wagon');
  assert.ok(wagon.backlinks.length >= 1, 'vehicles should have backlinks');
  assert.ok(v.graph.links.length >= 3, 'graph has links');
});

test('card type detected from frontmatter', () => {
  const v = scanVault(DEMO);
  const wagon = v.notes.find(n => n.title === 'Vengeance - War Wagon');
  assert.strictEqual(wagon.type, 'item');
  const idx = v.notes.find(n => n.title === 'World Index');
  assert.strictEqual(idx.type, 'untyped');
  assert.ok(v.graph.nodes.every(n => 'type' in n));
});

test('auto-categorize: note content decides type, folder names are ignored', () => {
  const fs = require('fs'), os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-content-'));
  fs.mkdirSync(path.join(tmp, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'Locations'), { recursive: true });
  // A character sitting in Locations/ and a location in Characters/: the
  // folders would mislabel both; the content gets both right.
  fs.writeFileSync(path.join(tmp, 'Locations', 'Hero.md'),
    '# Hero\n\nAppearance: tall. Personality: grim. Backstory: born on the road. Goals: survive.');
  fs.writeFileSync(path.join(tmp, 'Characters', 'Tavern.md'),
    '# Tavern\n\nPopulation: 12. Located by the river. Notable places: the tap room.');
  fs.writeFileSync(path.join(tmp, 'Random.md'), '# Random');
  const v = scanVault(tmp);
  assert.strictEqual(v.notes.find(n => n.title === 'Hero').type, 'character');
  assert.strictEqual(v.notes.find(n => n.title === 'Tavern').type, 'location');
  assert.strictEqual(v.notes.find(n => n.title === 'Random').type, 'untyped');
  // explicit frontmatter still wins over content guessing
  fs.writeFileSync(path.join(tmp, 'Locations', 'Ship.md'), '---\ntype: Item\n---\n# Ship\n\nPopulation of the crew.');
  const v2 = scanVault(tmp);
  assert.strictEqual(v2.notes.find(n => n.title === 'Ship').type, 'item');
});

test('markdown renders wikilinks (existing + missing) and tags', () => {
  const html = renderMarkdown('# Hi\n\nSee [[World Index]] and [[Does Not Exist]] and #cool.',
    t => t === 'World Index');
  assert.ok(html.includes('class="wl" href="'), 'existing wikilink is an anchor');
  assert.ok(html.includes('class="wl missing"'), 'missing link styled');
  assert.ok(html.includes('tagref'), 'tag rendered');
  assert.ok(!html.includes('[[Does Not Exist]]') || html.includes('data-missing'), 'no raw brackets shown for missing');
});

test('code fences are escaped, not executed', () => {
  const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert'));
});
