'use strict';
// Card catalog: a local, plain-JSONL cache of Magic card names/meta from
// Scryfall's free bulk data. Synced on demand (first run downloads ~40-80MB
// once, stored compressed on disk), then everything works offline.
//
// Storage is line-delimited JSON so the cache can be incrementally updated
// and streamed without holding the whole set in memory at parse time.

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const readline = require('readline');

const CARDS_FILE = 'cards.jsonl';

const isGzipMagic = buf => buf && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
// Scryfall API policy: identify yourself, or get a 400.
const API_HEADERS = {
  'User-Agent': 'MTGCodex/0.1 (local personal collection app)',
  'Accept': 'application/json',
};

let dataDir = path.join(__dirname, '..', 'data');
function setDataDir(dir) { dataDir = dir; }

const file = name => path.join(dataDir, name);
const exists = () => fs.existsSync(file(CARDS_FILE));

let _index = null; // name(lower) -> record

function recordFromCard(c) {
  return {
    id: c.id,
    name: c.name,
    manaCost: c.mana_cost || (c.card_faces && c.card_faces[0] && c.card_faces[0].mana_cost) || '',
    cmc: c.cmc || 0,
    colors: c.colors || (c.card_faces ? [...new Set(c.card_faces.flatMap(f => f.colors || []))] : []),
    type: c.type_line || '',
    text: (c.oracle_text || (c.card_faces ? c.card_faces.map(f => f.oracle_text).join(' // ') : '')),
    keywords: c.keywords || [],
    pt: c.power ? `${c.power}/${c.toughness}` : (c.card_faces && c.card_faces[0] && c.card_faces[0].power ? `${c.card_faces[0].power}/${c.card_faces[0].toughness}` : null),
    image: c.image_uris ? c.image_uris.small : (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris ? c.card_faces[0].image_uris.small : null),
    set: c.set,
    collector: c.collector_number,
    legal: c.legalities || {},
    priceUsd: c.prices && c.prices.usd ? parseFloat(c.prices.usd) : null,
    released: c.released_at,
  };
}

function loadIndex() {
  if (_index) return _index;
  _index = new Map();
  if (!exists()) return _index;
  // Byte-level line splitting: the file can be tens of MB, and turning it
  // into one giant JS string would hit V8's max-string limit.
  const raw = fs.readFileSync(file(CARDS_FILE));
  const buf = isGzipMagic(raw) ? zlib.gunzipSync(raw) : raw;
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start); // \n
    if (end === -1) end = buf.length;
    if (end > start) {
      try {
        const r = JSON.parse(buf.slice(start, end).toString('utf8'));
        _index.set(r.name.toLowerCase(), r);
      } catch { /* skip corrupt line */ }
    }
    start = end + 1;
  }
  return _index;
}

// https GET that follows redirects, streams to a file, and VERIFIES the byte
// count against content-length — a silently truncated download would otherwise
// corrupt the catalog and only blow up later, mid-gzip.
function download(url, dest, onProgress) {
  const attempt = (retriesLeft) => new Promise((resolve, reject) => {
    const get = u => https.get(u, { headers: API_HEADERS, family: 4 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${u}`)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let seen = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', chunk => {
        seen += chunk.length;
        if (onProgress && total) onProgress(seen / total, seen, total);
      });
      res.pipe(out);
      out.on('finish', () => {
        if (total && seen !== total) {
          out.close(() => reject(new Error(`download truncated: got ${seen} of ${total} bytes`)));
        } else out.close(resolve);
      });
      out.on('error', reject);
      res.on('error', err => { out.close(); reject(err); });
    });
    get(url).on('error', reject);
  }).catch(err => {
    if (retriesLeft > 0) {
      return new Promise(r => setTimeout(r, 1500)).then(() => attempt(retriesLeft - 1));
    }
    throw err;
  });
  return attempt(2);
}

async function fetchJson(url) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    const get = u => https.get(u, { headers: API_HEADERS, family: 4 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return get(res.headers.location); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${u}`)); }
      res.on('data', d => chunks.push(d));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    get(url).on('error', reject);
  });
}

// One-time sync from Scryfall bulk data. Progress: (phase, frac, msg)
async function sync(onProgress) {
  const p = (phase, frac, msg) => { if (onProgress) onProgress(phase, frac, msg); };
  p('meta', 0.05, 'contacting Scryfall…');
  const meta = await fetchJson('https://api.scryfall.com/bulk-data');
  const entry = meta.data.find(b => b.type === 'default_cards') || meta.data[0];
  const dlUri = entry.download_uri || entry.jsonl_download_uri;
  const sizeMb = Math.round((entry.size || entry.compressed_size || 0) / 1e6);
  p('download', 0.1, `downloading ${entry.name} (${sizeMb} MB)…`);
  const tmpGz = file(CARDS_FILE + '.tmp');
  const tmpJson = file('bulk.tmp.json');
  try {
    await download(dlUri, tmpGz, (frac, seen, total) =>
      p('download', 0.1 + frac * 0.7, `downloading… ${Math.round(seen / 1e6)}/${total ? Math.round(total / 1e6) : sizeMb} MB`));
    p('process', 0.85, 'building card index…');
    // Scryfall bulk files are newline-delimited JSON, gzipped or not depending
    // on the endpoint — detect the magic bytes and stream either way so we
    // never hold the whole payload in memory.
    await new Promise((resolve, reject) => {
      const seenNames = new Set();
      const out = fs.createWriteStream(tmpJson);
      const probe = fs.openSync(tmpGz, 'r');
      const magic = Buffer.alloc(2);
      fs.readSync(probe, magic, 0, 2, 0);
      fs.closeSync(probe);
      let src = fs.createReadStream(tmpGz);
      if (isGzipMagic(magic)) src = src.pipe(zlib.createGunzip());
      const rl = readline.createInterface({ input: src, crlfDelay: Infinity });
      let n = 0;
      let malformed = 0;
      let firstLine = '';
      rl.on('line', line => {
        if (!line.trim()) return;
        if (!firstLine) firstLine = line.slice(0, 200);
        try {
          const c = JSON.parse(line);
          if (c.object === 'error') throw new Error(`Scryfall error body: ${line.slice(0, 200)}`);
          if (seenNames.has(c.name)) return; // keep first print
          seenNames.add(c.name);
          out.write(JSON.stringify(recordFromCard(c)) + '\n');
          if (++n % 10000 === 0) p('process', Math.min(0.99, 0.85 + n / 1.2e6), `indexed ${n} cards…`);
        } catch (e) {
          if (/Scryfall error body/.test(e.message)) { rl.close(); out.end(() => reject(e)); return; }
          malformed++;
        }
      });
      rl.on('close', () => {
        out.end(() => {
          if (n === 0) reject(new Error(`no cards parsed from bulk file (${malformed} malformed lines) — first bytes: ${firstLine || '(empty)'}`));
          else resolve();
        });
      });
      rl.on('error', reject);
      out.on('error', reject);
    });
    fs.renameSync(tmpJson, file(CARDS_FILE));
    fs.rmSync(tmpGz, { force: true });
  } catch (err) {
    // never leave a half-built catalog or stale temps behind
    fs.rmSync(tmpGz, { force: true });
    fs.rmSync(tmpJson, { force: true });
    throw err;
  }
  _index = null; // force reload
  const n = loadIndex().size;
  p('done', 1, `${n} cards ready`);
  return { cards: n };
}

function status() {
  const i = loadIndex();
  let count = 0;
  if (exists()) count = i.size;
  return { synced: count > 0, cards: count };
}

// ---------- lookup & search ----------

function get(name) {
  const r = loadIndex().get(String(name).trim().toLowerCase());
  return r || null;
}

// Autocomplete-style search: exact < prefix < word-start < substring.
function search(query, limit = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const idx = loadIndex();
  const scored = [];
  for (const [lower, rec] of idx) {
    let score = -1;
    if (lower === q) score = 0;
    else if (lower.startsWith(q)) score = 1;
    else {
      const at = lower.indexOf(q);
      if (at > 0 && /[\s,',]/.test(lower[at - 1])) score = 2;
      else if (at > 0) score = 3;
    }
    if (score >= 0) scored.push([score, rec]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, r]) => r);
}

// OCR text is noisy: strip set symbols, punctuation, line breaks and fix
// common misreads ("fi", "l" vs "I", doubled spaces). Returns normalized text.
function normalizeOcr(text) {
  return String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '')
    .replace(/[|]/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();
}

// Candidate card names for noisy OCR text of a card. Tries, in order:
//  1. line-by-line exact match against the name index
//  2. fuzzy match of each 2-3 line window (Levenshtein)
//  3. substring/fuzzy word match
// Returns [{name, score}] sorted best-first. Score 1.0 == exact.
function identifyFromText(text, limit = 8) {
  const idx = loadIndex();
  if (!idx.size) throw new Error('card catalog not synced yet — run sync first');
  const norm = normalizeOcr(text);
  const lines = norm.split(/\s*\n\s*/).filter(Boolean);
  const flatWords = norm.split(/\s+/).filter(w => w.length > 1);
  const results = new Map();
  const push = (name, score) => {
    const prev = results.get(name);
    if (!prev || prev.score < score) results.set(name, { name, score });
  };

  const lev = (a, b) => {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 4) return 1e9;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  };
  const sim = (a, b) => {
    const d = lev(a, b);
    return 1 - d / Math.max(a.length, b.length, 1);
  };

  // 1. exact line hits (OCR usually puts the name on one or two lines)
  for (const line of lines) {
    const l = line.toLowerCase().replace(/[^a-z' ]/g, '').trim();
    if (l.length < 3) continue;
    const rec = idx.get(l);
    if (rec) { push(rec.name, 1); continue; }
    // two consecutive lines joined (long names wrap)
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const joined = (lines[i] + ' ' + lines[i + 1]).toLowerCase().replace(/[^a-z' ]/g, '').trim();
    const rec = idx.get(joined);
    if (rec) push(rec.name, 1);
  }

  // 2. fuzzy line/window match (cheap guard: only lines with plausible length)
  const windows = [];
  for (const line of lines) if (line.length >= 4) windows.push(line);
  for (let i = 0; i + 1 < lines.length; i++) {
    const j = lines[i] + ' ' + lines[i + 1];
    if (j.length >= 6 && j.length <= 40) windows.push(j);
  }
  for (const w of windows) {
    const wn = w.toLowerCase().replace(/[^a-z' ]/g, '').trim();
    if (wn.length < 4) continue;
    // narrow candidates by first letter to keep this fast
    for (const [lower, rec] of idx) {
      if (lower[0] !== wn[0]) continue;
      const s = sim(wn, lower);
      if (s >= 0.8) push(rec.name, s * 0.95);
    }
  }

  // 3. fuzzy over sliding word windows in the flat OCR text
  for (let i = 0; i < flatWords.length; i++) {
    for (let len = 1; len <= 4 && i + len <= flatWords.length; len++) {
      const phrase = flatWords.slice(i, i + len).join(' ').toLowerCase().replace(/[^a-z' ]/g, '').trim();
      if (phrase.length < 4) continue;
      for (const [lower, rec] of idx) {
        if (lower[0] !== phrase[0]) continue;
        const s = sim(phrase, lower);
        if (s >= 0.85) push(rec.name, s * 0.9);
      }
    }
  }

  const out = [...results.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}

module.exports = { setDataDir, sync, status, exists, get, search, identifyFromText, normalizeOcr, recordFromCard, download };
