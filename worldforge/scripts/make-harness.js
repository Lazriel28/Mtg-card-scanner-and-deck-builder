'use strict';
// Generates public/harness-data.json (graph + notes) from demo-vault so the UI
// can be smoke-tested in a plain browser without Electron.
const fs = require('fs');
const path = require('path');
const { scanVault } = require('../src/vault');
const { renderMarkdown } = require('../src/md');

const demo = path.join(__dirname, '..', 'demo-vault');
const v = scanVault(demo);
const notes = {};
for (const n of v.notes) {
  const linkFor = (t, exists) => exists ? '#note:' + encodeURIComponent(v.resolve(t).id) : '#missing:' + encodeURIComponent(t);
  notes[n.id] = {
    id: n.id, title: n.title, dir: n.dir, tags: n.tags, type: n.type, raw: n.raw,
    html: renderMarkdown(n.body, t => !!v.resolve(t), linkFor),
    outgoing: [...new Set(n.outgoing)], backlinks: [...new Set(n.backlinks)],
  };
}
const out = { root: demo, graph: v.graph, notes };
fs.writeFileSync(path.join(__dirname, '..', 'public', 'harness-data.json'), JSON.stringify(out));
console.log('harness data:', v.notes.length, 'notes,', v.graph.links.length, 'links');
