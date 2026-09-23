'use strict';
// WorldForge layout engine: which nodes have hand-placed ("pinned") positions
// and how saved positions merge with the force layout. Pure functions, plus
// load/save against <vault>/.worldforge/layout.json (vault root is a
// parameter so tests can use temp folders — same pattern as tombstones.js).

const fs = require('fs');
const path = require('path');

const VERSION = 1;

function fileFor(vaultRoot) { return path.join(vaultRoot, '.worldforge', 'layout.json'); }

function load(vaultRoot) {
  try { return JSON.parse(fs.readFileSync(fileFor(vaultRoot), 'utf8')); }
  catch { return { version: VERSION, nodes: {} }; }
}

function save(vaultRoot, layout) {
  const clean = layout && layout.nodes ? layout : { version: VERSION, nodes: {} };
  fs.mkdirSync(path.join(vaultRoot, '.worldforge'), { recursive: true });
  fs.writeFileSync(fileFor(vaultRoot), JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

// Keep only entries for notes that still exist, with finite numeric coords.
function normalizeLayout(graph, layout) {
  const ids = new Set(graph.nodes.map(n => n.id));
  const src = layout && layout.nodes ? layout.nodes : {};
  const nodes = {};
  for (const [id, p] of Object.entries(src)) {
    if (!ids.has(id) || !p) continue;
    const x = Number(p.x), y = Number(p.y), z = Number(p.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    nodes[id] = { x, y, z };
  }
  return { version: VERSION, nodes };
}

// Pin: overwrite/add positions for the given ids.
function pinNodes(layout, positions) {
  const base = layout && layout.nodes ? layout.nodes : {};
  const nodes = { ...base };
  for (const [id, p] of Object.entries(positions || {})) {
    const x = Number(p.x), y = Number(p.y), z = Number(p.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    nodes[id] = { x, y, z };
  }
  return { version: VERSION, nodes };
}

function unpinNodes(layout, ids) {
  const base = layout && layout.nodes ? { ...layout.nodes } : {};
  for (const id of ids) delete base[id];
  return { version: VERSION, nodes: base };
}

module.exports = { normalizeLayout, pinNodes, unpinNodes, load, save, fileFor, VERSION };