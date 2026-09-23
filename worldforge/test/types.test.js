'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { setTypeInRaw, getTypeFromRaw } = require('../src/types');

test('inserts frontmatter when the note has none', () => {
  const raw = '# My Note\n\nBody text.';
  const out = setTypeInRaw(raw, 'Character');
  assert.ok(out.startsWith('---\ntype: Character\n---'), out);
  assert.strictEqual(getTypeFromRaw(out), 'Character');
  assert.ok(out.includes('# My Note'));
});

test('replaces an existing type, preserving other keys and body', () => {
  const raw = '---\ntype: Item\ntags: [vehicle]\nstatus: wip\n---\n\n# Body\n[[link]]';
  const out = setTypeInRaw(raw, 'Location');
  assert.strictEqual(getTypeFromRaw(out), 'Location');
  assert.ok(out.includes('tags: [vehicle]'), 'other keys preserved');
  assert.ok(out.includes('status: wip'), 'other keys preserved');
  assert.ok(out.includes('[[link]]'), 'body untouched');
});

test('clearing type removes the key but keeps the frontmatter block', () => {
  const raw = '---\ntype: Item\ntags: [a]\n---\n\nBody';
  const out = setTypeInRaw(raw, '');
  assert.strictEqual(getTypeFromRaw(out), null);
  assert.ok(out.includes('tags: [a]'));
  assert.ok(out.includes('Body'));
});

test('clearing type on a note without frontmatter is a no-op', () => {
  const raw = '# Plain note';
  assert.strictEqual(setTypeInRaw(raw, ''), raw);
});
