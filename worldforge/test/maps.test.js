'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const maps = require('../src/maps');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maps-')); }
function png(width = 1) {
  // 1x1 transparent PNG header bytes (no decoder needed; only fs is touched)
  return Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' + '0'.repeat(8) + '0', 'hex').slice(0, 33 + width);
}

test('addImage copies into the vault, registers, and persists pins', () => {
  const vault = tmp();
  const img = path.join(tmp(), 'saltmere.png');
  fs.writeFileSync(img, png());
  const map = maps.addImage(vault, img, 'Saltmere');
  assert.ok(map.id && map.name === 'Saltmere');
  assert.ok(fs.existsSync(path.join(vault, map.file)), 'image copied into vault');

  map.pins.push({ x: 0.25, y: 0.5, noteId: 'Lazriel.md', label: 'Harbor' });
  maps.save(vault, [map]);
  const again = maps.load(vault);
  assert.strictEqual(again.length, 1);
  assert.strictEqual(again[0].pins[0].noteId, 'Lazriel.md');
  assert.strictEqual(again[0].pins[0].x, 0.25);
});

test('removeMap deletes the image file and the entry', () => {
  const vault = tmp();
  const img = path.join(tmp(), 'm.png');
  fs.writeFileSync(img, png());
  const map = maps.addImage(vault, img);
  assert.ok(maps.removeMap(vault, map.id).length === 0);
  assert.ok(!fs.existsSync(path.join(vault, map.file)));
  assert.strictEqual(maps.load(vault).length, 0);
});

test('rejects non-images and missing files', () => {
  const vault = tmp();
  const txt = path.join(tmp(), 'not.txt');
  fs.writeFileSync(txt, 'hello');
  assert.throws(() => maps.addImage(vault, txt), /not an image/);
  assert.throws(() => maps.addImage(vault, path.join(tmp(), 'nope.png')), /not found/);
});
