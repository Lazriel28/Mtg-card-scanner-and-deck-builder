'use strict';
// WorldForge layout engine: which nodes have hand-placed ("pinned") positions
// and how saved positions merge with the force layout. Pure functions.

const VERSION = 1;

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

module.exports = { normalizeLayout, pinNodes, unpinNodes, VERSION };