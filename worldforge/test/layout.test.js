'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeLayout, pinNodes, unpinNodes } = require('../src/layout');

const graph = { nodes: [{ id: 'a.md' }, { id: 'b.md' }] };

test('normalize drops unknown ids and non-finite coords', () => {
  const out = normalizeLayout(graph, { nodes: {
    'a.md': { x: 1, y: 2, z: 3 },
    'gone.md': { x: 0, y: 0, z: 0 },
    'b.md': { x: NaN, y: 2, z: 3 },
  } });
  assert.deepStrictEqual(Object.keys(out.nodes), ['a.md']);
  assert.strictEqual(out.version, 1);
  assert.strictEqual(Object.keys(normalizeLayout(graph, null).nodes).length, 0);
});

test('pin overwrites and adds; unpin removes', () => {
  let l = normalizeLayout(graph, { nodes: { 'a.md': { x: 1, y: 2, z: 3 } } });
  l = pinNodes(l, { 'a.md': { x: 9, y: 9, z: 9 }, 'b.md': { x: 4, y: 5, z: 6 } });
  assert.deepStrictEqual(l.nodes['a.md'], { x: 9, y: 9, z: 9 });
  assert.deepStrictEqual(l.nodes['b.md'], { x: 4, y: 5, z: 6 });
  l = unpinNodes(l, ['a.md']);
  assert.strictEqual(l.nodes['a.md'], undefined);
  assert.ok(l.nodes['b.md']);
});

test('pin ignores non-finite input', () => {
  const l = pinNodes(null, { 'a.md': { x: Infinity, y: 0, z: 0 } });
  assert.strictEqual(l.nodes['a.md'], undefined);
});