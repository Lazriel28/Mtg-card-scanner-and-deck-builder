'use strict';
// MTG Codex server: static UI + JSON API. Zero dependencies (node:http).
//
//   GET  /api/status              catalog sync state + collection/deck counts
//   POST /api/sync                download/build the card catalog (long)
//   GET  /api/sync/progress       SSE progress stream for the sync
//   GET  /api/cards/search?q=     catalog search / autocomplete
//   GET  /api/cards/get?name=     one card by name
//   POST /api/scan                {imageDataUrl, ocrText?} -> candidate cards
//   GET  /api/photos/<file>       snapped card photos
//   GET  /api/collection          full collection with categories
//   POST /api/collection/add      {name, qty, condition, photo}
//   POST /api/collection/set      {name, qty}
//   POST /api/collection/photo    {name, photo}
//   POST /api/collection/import   {text}   (paste a decklist)
//   GET  /api/decks               list decks
//   POST /api/decks               {name, format, commander}
//   GET  /api/decks/:id
//   PATCH /api/decks/:id          {name?, notes?, cards?, sideboard?, commander?}
//   DELETE /api/decks/:id
//   POST /api/decks/:id/card      {name, qty, sideboard}
//   DELETE /api/decks/:id/card/<name>
//   GET  /api/decks/:id/validate
//   GET  /api/decks/:id/missing   deck vs collection gaps
//   GET  /api/suggest?format=&colors=WU
//   POST /api/suggest/record      {deck:[{name,qty}], colors}  (train playstyle)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const catalog = require('./src/catalog');
const collection = require('./src/collection');
const decks = require('./src/decks');
const suggest = require('./src/suggest');
const ocr = require('./src/ocr');

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3123;
const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

catalog.setDataDir(DATA_DIR);
collection.setDataDir(DATA_DIR);
decks.setDataDir(DATA_DIR);
suggest.setDataDir(DATA_DIR);

// wire engines together
collection.attachCatalog(catalog);
decks.attachCatalog(catalog);
suggest.attachCatalog(catalog);
decks.attachHave(name => {
  const e = collection.list().find(x => x.name.toLowerCase() === name.toLowerCase());
  return e ? e.qty : 0;
});
suggest.attachCollection({ list: () => collection.list() });

// ---------- photo storage ----------

function savePhotoDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('expected a data:image URL');
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const name = `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PHOTOS_DIR, name), Buffer.from(m[2], 'base64'));
  return name;
}

// ---------- helpers ----------

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { reject(new Error('body too large (25MB max)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const b = await readBody(req);
  return b.length ? JSON.parse(b.toString('utf8')) : {};
}

function sendFile(res, filePath, type) {
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(__dirname, 'public', safe);
  if (!full.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end(); return; }
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  sendFile(res, full, type);
}

// ---------- sync progress (SSE) ----------

let syncState = { running: false, phase: '', frac: 0, msg: '', error: null, done: false };
const sseClients = new Set();

function broadcastSync() {
  const payload = `data: ${JSON.stringify(syncState)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch { /* gone */ } }
}

async function runSync() {
  if (syncState.running) return;
  syncState = { running: true, phase: 'start', frac: 0, msg: 'starting…', error: null, done: false };
  broadcastSync();
  try {
    const r = await catalog.sync((phase, frac, msg) => {
      syncState.phase = phase; syncState.frac = frac; syncState.msg = msg;
      broadcastSync();
    });
    syncState.done = true; syncState.frac = 1; syncState.msg = `${r.cards} cards ready`;
  } catch (e) {
    syncState.error = String(e.message || e);
  } finally {
    syncState.running = false;
    broadcastSync();
  }
}

// ---------- OCR + scan pipeline ----------

async function handleScan(body) {
  let text = body.ocrText;
  let photo = null;
  if (body.imageDataUrl) {
    photo = savePhotoDataUrl(body.imageDataUrl);
    if (!text) text = await ocr.recognize(path.join(PHOTOS_DIR, photo));
  }
  if (!text) throw new Error('no text could be read from the photo');
  const candidates = catalog.identifyFromText(text, 8);
  return { ocrText: text, candidates, photo };
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  try {
    if (!p.startsWith('/api/')) return serveStatic(res, p);

    // ---- status & sync ----
    if (p === '/api/status') {
      return json(res, 200, {
        catalog: catalog.status(),
        collection: { cards: collection.count(), unique: collection.list().length },
        decks: decks.listDecks().length,
        sync: syncState,
        ocr: ocr.status(),
      });
    }
    if (p === '/api/sync' && req.method === 'POST') {
      runSync();
      return json(res, 202, { started: true });
    }
    if (p === '/api/sync/progress') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(syncState)}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ---- cards ----
    if (p === '/api/cards/search') {
      return json(res, 200, catalog.search(u.searchParams.get('q') || '', 12));
    }
    if (p === '/api/cards/get') {
      const rec = catalog.get(u.searchParams.get('name') || '');
      if (!rec) return json(res, 404, { error: 'unknown card' });
      return json(res, 200, rec);
    }
    if (p === '/api/cards/thumb') {
      const rec = catalog.get(u.searchParams.get('name') || '');
      if (!rec || !rec.image) return json(res, 404, { error: 'no image' });
      const ext = path.extname(rec.image.split('?')[0]) || '.jpg';
      const cacheDir = path.join(DATA_DIR, 'imgcache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const cached = path.join(cacheDir, rec.id + ext);
      if (fs.existsSync(cached)) return sendFile(res, cached, 'image/jpeg');
      try {
        await catalog.download(rec.image, cached);
        return sendFile(res, cached, 'image/jpeg');
      } catch { return json(res, 404, { error: 'image fetch failed' }); }
    }

    // ---- scan / photos ----
    if (p === '/api/scan' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, await handleScan(body));
    }
    if (p.startsWith('/api/photos/')) {
      const name = path.basename(p.slice('/api/photos/'.length));
      return sendFile(res, path.join(PHOTOS_DIR, name), MIME[path.extname(name).toLowerCase()] || 'application/octet-stream');
    }

    // ---- collection ----
    if (p === '/api/collection' && req.method === 'GET') {
      return json(res, 200, {
        entries: collection.list(),
        stats: collection.stats(),
        byCategory: collection.byCategory(),
      });
    }
    if (p === '/api/collection/add' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, collection.addCard(body));
    }
    if (p === '/api/collection/set' && req.method === 'POST') {
      const body = await readJson(req);
      collection.setQty(body.name, body.qty);
      return json(res, 200, { ok: true, count: collection.count() });
    }
    if (p === '/api/collection/photo' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, collection.attachPhoto(body.name, body.photo));
    }
    if (p === '/api/collection/import' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, collection.importDecklist(body.text));
    }

    // ---- decks ----
    if (p === '/api/decks' && req.method === 'GET') return json(res, 200, decks.listDecks());
    if (p === '/api/decks' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, decks.createDeck(body));
    }

    const deckMatch = p.match(/^\/api\/decks\/(\d+)(\/.*)?$/);
    if (deckMatch) {
      const id = parseInt(deckMatch[1], 10);
      const rest = deckMatch[2] || '';
      if (!rest) {
        if (req.method === 'GET') return json(res, 200, decks.getDeck(id));
        if (req.method === 'PATCH') return json(res, 200, decks.updateDeck(id, await readJson(req)));
        if (req.method === 'DELETE') return json(res, 200, { ok: decks.deleteDeck(id) });
      }
      if (rest === '/card' && req.method === 'POST') {
        const b = await readJson(req);
        return json(res, 200, decks.addCardToDeck(id, b.name, b.qty || 1, !!b.sideboard));
      }
      const cardDel = rest.match(/^\/card\/(.+)$/);
      if (cardDel && req.method === 'DELETE') {
        return json(res, 200, decks.removeCardFromDeck(id, decodeURIComponent(cardDel[1])));
      }
      if (rest === '/validate') return json(res, 200, decks.validate(decks.getDeck(id)));
      if (rest === '/missing') return json(res, 200, decks.missingFromCollection(id));
    }

    // ---- suggest ----
    if (p === '/api/suggest' && req.method === 'GET') {
      const colors = (u.searchParams.get('colors') || '').split('').filter(c => 'WUBRG'.includes(c));
      const r = suggest.suggest({
        format: u.searchParams.get('format') || 'commander',
        colors: colors.length ? colors : null,
        size: u.searchParams.get('size') ? parseInt(u.searchParams.get('size'), 10) : null,
      });
      return json(res, 200, r);
    }
    if (p === '/api/suggest/record' && req.method === 'POST') {
      const b = await readJson(req);
      suggest.recordDeck(b.deck || [], b.colors || []);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: `no route: ${req.method} ${p}` });
  } catch (err) {
    return json(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  const nets = Object.values(os.networkInterfaces())
    .flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`MTG Codex listening on http://localhost:${PORT}`);
  for (const ip of nets) console.log(`  also on http://${ip}:${PORT}  (open from your phone on the same Wi-Fi)`);
});
