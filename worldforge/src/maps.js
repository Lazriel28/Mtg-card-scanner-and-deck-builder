'use strict';
// Maps: pin notes onto images (hand-drawn maps, photos, floor plans).
// Data lives in <vault>/.worldforge/maps.json; images are COPIED into
// <vault>/.worldforge/maps/ so the whole thing travels with the vault.
// Pins store x/y as fractions (0..1) of the image so any window size works.

const fs = require('fs');
const path = require('path');

const DATA_FILE = '.worldforge/maps.json';
const IMG_DIR = '.worldforge/maps';

function dataFile(vaultRoot) { return path.join(vaultRoot, DATA_FILE); }
function imgDir(vaultRoot) { return path.join(vaultRoot, IMG_DIR); }

function load(vaultRoot) {
  try {
    const j = JSON.parse(fs.readFileSync(dataFile(vaultRoot), 'utf8'));
    return Array.isArray(j.maps) ? j.maps : [];
  } catch { return []; }
}

function save(vaultRoot, maps) {
  fs.mkdirSync(path.dirname(dataFile(vaultRoot)), { recursive: true });
  fs.writeFileSync(dataFile(vaultRoot), JSON.stringify({ maps }, null, 1));
  return maps;
}

// Copy an image into the vault and return a new map entry for it.
function addImage(vaultRoot, srcImagePath, name) {
  if (!srcImagePath || !fs.existsSync(srcImagePath)) throw new Error('image not found');
  const ext = path.extname(srcImagePath).toLowerCase() || '.png';
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext))
    throw new Error('not an image file');
  fs.mkdirSync(imgDir(vaultRoot), { recursive: true });
  const id = 'map-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const dest = path.join(imgDir(vaultRoot), id + ext);
  fs.copyFileSync(srcImagePath, dest);
  const map = {
    id,
    name: String(name || path.basename(srcImagePath, ext)).trim() || 'Map',
    file: IMG_DIR + '/' + id + ext,   // vault-relative, forward slashes
    pins: [],
  };
  const maps = load(vaultRoot);
  maps.push(map);
  save(vaultRoot, maps);
  return map;
}

function removeMap(vaultRoot, mapId) {
  const maps = load(vaultRoot);
  const m = maps.find(x => x.id === mapId);
  if (!m) return maps;
  try { fs.unlinkSync(path.join(vaultRoot, m.file)); } catch {}
  const next = maps.filter(x => x.id !== mapId);
  save(vaultRoot, next);
  return next;
}

module.exports = { load, save, addImage, removeMap };
