'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tombstones = require('../src/tombstones');
const { importNotes } = require('../src/importer');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tomb-')); }

test('tombstones record, clear, and respect the grace window', () => {
  const vault = tmp();
  tombstones.record(vault, ['imports/A.md'], Date.now());
  assert.ok(tombstones.has(vault, 'imports/A.md'));
  assert.ok(tombstones.isRecent(vault, 'imports/A.md'));

  // 10 days ago -> outside the 7-day grace
  tombstones.record(vault, ['imports/B.md'], Date.now() - 10 * 24 * 3600e3);
  assert.ok(tombstones.has(vault, 'imports/B.md'));
  assert.ok(!tombstones.isRecent(vault, 'imports/B.md'));

  tombstones.clear(vault, ['imports/A.md']);
  assert.ok(!tombstones.has(vault, 'imports/A.md'));
});

test('importer restores a recent WF deletion and clears its tombstone', () => {
  const src = tmp(), vault = tmp();
  fs.writeFileSync(path.join(src, 'Note A.md'), '# A');
  const id = 'imports/Note A.md';
  tombstones.record(vault, [id]); // deleted in WF yesterday-ish: recent

  const r = importNotes(src, vault, 'imports');
  assert.strictEqual(r.imported, 1);
  assert.ok(fs.existsSync(path.join(vault, 'imports', 'Note A.md')));
  assert.ok(!tombstones.has(vault, id)); // alive again -> tombstone dropped
});

test('importer never resurrects old deletions (the Lazriel case)', () => {
  const src = tmp(), vault = tmp();
  fs.writeFileSync(path.join(src, 'Old Note.md'), '# ghost');
  const id = 'imports/Old Note.md';
  tombstones.record(vault, [id], Date.now() - 60 * 24 * 3600e3); // 60 days ago

  const r = importNotes(src, vault, 'imports');
  assert.strictEqual(r.imported, 0);
  assert.strictEqual(r.skipped, 1);
  assert.ok(!fs.existsSync(path.join(vault, 'imports', 'Old Note.md')));
});

test('importer still skips existing files and empty sources', () => {
  const src = tmp(), vault = tmp();
  fs.writeFileSync(path.join(src, 'Note A.md'), '# A');
  fs.writeFileSync(path.join(src, 'Empty.md'), '');
  assert.strictEqual(importNotes(src, vault, 'imports').imported, 1);
  assert.strictEqual(importNotes(src, vault, 'imports').imported, 0); // re-import: all exist
  assert.strictEqual(importNotes(src, vault, 'imports').skipped, 2);  // A exists, Empty is empty
});
