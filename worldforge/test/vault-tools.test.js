'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanVault } = require('../src/vault');
const t = require('../src/vault-tools');

function tmpVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tools-test-'));
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'A.md'), '# A\n\nlong enough body text for random pool selection. links [[B]] [[sub/B|subbee]] [[B#top]] [[Missing]]\n#garage\n');
  fs.writeFileSync(path.join(root, 'sub/B.md'), '# B\n\nB body text here for word counting.\n');
  return root;
}

test('fulltextSearch ranks titles above body hits', () => {
  const v = scanVault(tmpVault());
  const hits = t.fulltextSearch(v, 'B');
  assert.ok(hits[0].id.endsWith('B.md'));
  assert.ok(hits[0].score >= hits[hits.length - 1].score);
});

test('vaultStats counts words, types, links, orphans', () => {
  const v = scanVault(tmpVault());
  const s = t.vaultStats(v);
  assert.strictEqual(s.notes, 2);
  assert.ok(s.words > 5);
  assert.strictEqual(s.byType.untyped, 2);
  assert.strictEqual(s.orphans, 0);
  assert.ok(s.links >= 1);
});

test('brokenLinks reports unresolved targets, skips [[Note#heading]] and #tags', () => {
  const v = scanVault(tmpVault());
  const b = t.brokenLinks(v);
  assert.deepStrictEqual(b.map(x => x.target), ['Missing']);
});

test('rename rewrites all link spellings and keeps links working', () => {
  const root = tmpVault();
  const v = scanVault(root);
  const r = t.renameNote(v, 'sub/B.md', 'Bee');
  assert.strictEqual(r.linksUpdated, 3);
  const v2 = scanVault(root);
  assert.match(v2.notesById.get('A.md').raw, /\[\[Bee\]\]/);
  assert.ok(v2.notesById.get('A.md').raw.includes('[[sub/Bee|'));
  assert.strictEqual(t.brokenLinks(v2).length, 1); // only [[Missing]] remains
});

test('rename refuses to clobber an existing note', () => {
  const root = tmpVault();
  fs.writeFileSync(path.join(root, 'sub', 'Cee.md'), 'x');
  const v = scanVault(root);
  assert.throws(() => t.renameNote(v, 'sub/B.md', 'Cee'), /already exists/i);
});

test('move changes folder; links still resolve by name', () => {
  const root = tmpVault();
  const v = scanVault(root);
  const r = t.moveNote(v, 'sub/B.md', '.');
  assert.strictEqual(r.id, 'B.md');
  const v2 = scanVault(root);
  assert.ok(v2.notesById.get('A.md').outgoing.includes('B.md'));
});

test('duplicate creates "copy" sibling; merge combines bodies + rewrites links', () => {
  const root = tmpVault();
  const v = scanVault(root);
  const d = t.duplicateNote(v, 'sub/B.md');
  assert.strictEqual(d.id, 'sub/B copy.md');
  // a witness note links to [[B copy]] so we can verify the merge rewrite
  fs.writeFileSync(path.join(root, 'witness.md'), 'links to [[B copy]] here\n');
  const m = t.mergeNotes(scanVault(root), ['A.md', 'sub/B copy.md'], { title: 'Merged' });
  assert.strictEqual(m.trashed.length, 2);
  const v2 = scanVault(root);
  const raw = v2.notesById.get('Merged.md').raw;
  assert.match(raw, /## A/);
  assert.match(raw, /## B copy/);
  assert.match(v2.notesById.get('witness.md').raw, /\[\[Merged\]\]/);
});

test('templates: list + get from templates/', () => {
  const root = tmpVault();
  fs.mkdirSync(path.join(root, 'templates'));
  fs.writeFileSync(path.join(root, 'templates', 'Character.md'), '# New Character\n\n## Appearance\n');
  const v = scanVault(root);
  assert.deepStrictEqual(t.listTemplates(v).map(x => x.name), ['Character']);
  assert.match(t.getTemplate(v, 'character'), /Appearance/);
});

test('export: txt strips wikilinks, html renders', () => {
  const v = scanVault(tmpVault());
  const txt = t.exportNoteText(v, 'A.md', 'txt').text;
  assert.ok(!txt.includes('[['));
  assert.ok(txt.includes('links B'));
  const html = t.exportNoteText(v, 'A.md', 'html').text;
  assert.match(html, /<h1>/);
});

test('favorites toggle round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-fav-'));
  assert.strictEqual(t.toggleFavorite(dir, 'a.md').active, true);
  assert.strictEqual(t.toggleFavorite(dir, 'a.md').active, false);
});

test('streak counts today; randomNote excludes tiny/empty notes', () => {
  const v = scanVault(tmpVault());
  const s = t.writingStreak(v);
  assert.ok(s.editedToday && s.streak >= 1);
  const r = t.randomNote(v);
  assert.ok(r && r.id);
});
