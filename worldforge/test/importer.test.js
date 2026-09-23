'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importNotes, collectFiles } = require('../src/importer');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-import-')); }

test('importer copies .md trees, skips hidden/config dirs, never overwrites', () => {
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

  // duplicate protection: re-import same source -> everything skipped
  const r2 = importNotes(src, vault, 'imports');
  assert.strictEqual(r2.imported, 0);
  assert.strictEqual(r2.skipped, 2);
  // originals untouched
  assert.strictEqual(fs.readFileSync(path.join(vault, 'imports', 'Note A.md'), 'utf8'), '# A');
  assert.strictEqual(fs.readFileSync(path.join(vault, 'imports', 'sub', 'Note B.md'), 'utf8'), '# B');
});

test('re-import restores only notes deleted since the last import', () => {
  const src = tmp(), vault = tmp();
  fs.writeFileSync(path.join(src, 'Note A.md'), '# A');
  fs.writeFileSync(path.join(src, 'Note B.md'), '# B');
  fs.writeFileSync(path.join(src, 'Note C.md'), '# C');
  assert.strictEqual(importNotes(src, vault, 'imports').imported, 3);

  // user deletes one note in the vault
  fs.rmSync(path.join(vault, 'imports', 'Note B.md'));

  const r2 = importNotes(src, vault, 'imports');
  assert.strictEqual(r2.imported, 1);            // only the missing one
  assert.strictEqual(r2.skipped, 2);             // the rest untouched
  assert.ok(fs.existsSync(path.join(vault, 'imports', 'Note B.md')), 'deleted note restored');
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
