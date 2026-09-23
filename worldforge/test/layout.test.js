'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const layoutStore = require('../src/layout');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-layout-')); }

test('layout save/load round-trips pins', () => {
  const root = tmp();
  layoutStore.save(root, layoutStore.pinNodes(layoutStore.load(root), {
    'a.md': { x: 1, y: 2, z: 3 },
    'b.md': { x: 4, y: 5, z: 6 },
  }));
  const l = layoutStore.load(root);
  assert.deepStrictEqual(l.nodes['a.md'], { x: 1, y: 2, z: 3 });
  assert.strictEqual(l.nodes['b.md'].z, 6);
});

test('unpin removes exactly the given ids', () => {
  const root = tmp();
  let l = layoutStore.pinNodes(layoutStore.load(root), { 'a.md': { x: 1, y: 1, z: 1 }, 'b.md': { x: 2, y: 2, z: 2 } });
  l = layoutStore.unpinNodes(l, ['a.md']);
  assert.strictEqual(l.nodes['a.md'], undefined);
  assert.ok(l.nodes['b.md']);
});

test('normalizeLayout drops pins for notes that no longer exist', () => {
  const graph = { nodes: [{ id: 'a.md' }], links: [] };
  const l = layoutStore.normalizeLayout(graph, { nodes: { 'a.md': { x: 1, y: 2, z: 3 }, 'gone.md': { x: 9, y: 9, z: 9 } } });
  assert.ok(l.nodes['a.md']);
  assert.strictEqual(l.nodes['gone.md'], undefined);
});

test('non-finite coords are rejected', () => {
  const l = layoutStore.pinNodes(layoutStore.load(tmp()), { 'a.md': { x: NaN, y: Infinity, z: 0 } });
  assert.deepStrictEqual(l.nodes, {});
});
