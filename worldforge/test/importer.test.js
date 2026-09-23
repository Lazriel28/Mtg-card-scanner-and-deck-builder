'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importNotes, collectFiles } = require('../src/importer');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-import-')); }

test('importer copies .md trees, skips hidden/config dirs, renames collisions', () => {
  const src = tmp(), vault = tmp();
  fs.writeFileSync(path.join(src, 'Note A.md'), '# A');
  fs.mkdirSync(path.join(src, 'sub'));
  fs.writeFileSync(path.join(src, 'sub', 'Note B.md'), '# B');
  fs.mkdirSync(path.join(src, '.obsidian'));
  fs.writeFileSync(path.join(src, '.obsidian', 'config.json'), '{}');
  fs.writeFileSync(path.join(src, 'ignore.txt'), 'not a note');

  const r1 = importNotes(src, vault, 'imports');
  assert.strictEqual(r1.imported, 2);
  assert.ok(fs.existsSync(path.join(vault, 'imports', 'Note A.md')));
  assert.ok(fs.existsSync(path.join(vault, 'imports', 'sub', 'Note B.md')));
  assert.ok(!fs.existsSync(path.join(vault, 'imports', 'ignore.txt')));
  assert.ok(!fs.existsSync(path.join(vault, 'imports', '.obsidian')));

  // collision: re-import same source -> numbered copies, never overwrite
  const r2 = importNotes(src, vault, 'imports');
  assert.strictEqual(r2.imported, 2);
  assert.ok(r2.renamed >= 2, 'collisions should be renamed, got ' + r2.renamed);
  assert.ok(fs.existsSync(path.join(vault, 'imports', 'Note A 2.md')));
  // original untouched
  assert.strictEqual(fs.readFileSync(path.join(vault, 'imports', 'Note A.md'), 'utf8'), '# A');
});

test('importer refuses to import the vault into itself', () => {
  const vault = tmp();
  assert.throws(() => importNotes(vault, vault, 'imports'), /OUTSIDE/);
  // also refuses when source is inside the vault
  fs.mkdirSync(path.join(vault, 'nested'));
  assert.throws(() => importNotes(path.join(vault, 'nested'), vault, 'imports'), /OUTSIDE/);
});

test('collectFiles finds .markdown too', () => {
  const src = tmp();
  fs.writeFileSync(path.join(src, 'x.markdown'), 'hi');
  fs.writeFileSync(path.join(src, 'y.md'), 'hi');
  assert.strictEqual(collectFiles(src).length, 2);
});
