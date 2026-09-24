'use strict';
// OCR: reads card names out of photos. Uses tesseract.js when it is
// installed (npm i tesseract.js — it lazy-downloads a ~15MB language model
// on first use and caches it); otherwise reports unavailable and the scan
// flow falls back to manual name entry. Keeping it optional means the app
// still installs and runs with zero dependencies.

const path = require('path');

let workerPromise = null;
let available = null; // null = unknown, true/false after first check

function tryLoad() {
  if (available !== null) return available;
  try {
    // not a hard dependency: require fails cleanly when absent
    require.resolve('tesseract.js');
    available = true;
  } catch {
    available = false;
  }
  return available;
}

function status() {
  return { available: tryLoad(), modelLoaded: !!workerPromise };
}

// recognize(imagePath) -> text
async function recognize(imagePath) {
  if (!tryLoad()) throw new Error('ocr unavailable — install with: npm i tesseract.js');
  const { createWorker } = require('tesseract.js');
  if (!workerPromise) {
    workerPromise = createWorker('eng');
  }
  const worker = await workerPromise;
  const { data } = await worker.recognize(imagePath);
  return data.text || '';
}

module.exports = { status, recognize };
