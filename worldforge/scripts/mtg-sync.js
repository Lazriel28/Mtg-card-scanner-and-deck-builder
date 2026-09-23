'use strict';
// One-time (re-runnable) sync: Scryfall "Oracle Cards" bulk file -> compact local index.
// Data comes from Scryfall (scryfall.com), which publishes it for free use; we keep
// only the fields the app needs so the whole index stays a few dozen MB.
//
//   node scripts/mtg-sync.js            # download + compact
//   node scripts/mtg-sync.js --compact  # only re-compact an existing raw file

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RAW_FILE = path.join(DATA_DIR, 'mtg-oracle-raw.jsonl.gz');
const OUT_FILE = path.join(DATA_DIR, 'mtg-cards.json');

// Fields kept per card, under short keys to keep the file small.
// n=name, mc=mana cost, c=cmc, col=colors, t=type line, o=oracle text,
// kw=keywords, pt=power/toughness, im=image url, r=legalities (commander/standard/modern/vintage)
function compact(card) {
  return {
    n: card.name,
    mc: card.mana_cost || '',
    c: card.cmc,
    col: card.colors || [],
    t: card.type_line || '',
    o: card.oracle_text || '',
    kw: card.keywords || [],
    pt: card.power && card.toughness ? `${card.power}/${card.toughness}` : undefined,
    im: (card.image_uris && (card.image_uris.normal || card.image_uris.small)) || undefined,
    r: card.legalities || {},
    _cn: card.card_faces && card.card_faces.length
      ? card.card_faces.map(f => f.name) : undefined,
  };
}

const HEADERS = {
  'User-Agent': 'WorldForge/1.0 (offline worldbuilding app)',
  'Accept': 'application/json',
};

async function download() {
  const res = await fetch('https://api.scryfall.com/bulk-data/oracle_cards', { headers: HEADERS });
  if (!res.ok) throw new Error(`bulk-data listing failed: HTTP ${res.status}`);
  let meta = await res.json();
  // The /bulk-data/:type endpoint returns a stub whose `uri` leads to the full object.
  if (!meta.jsonl_download_uri && !meta.download_uri) {
    const full = await fetch(meta.uri, { headers: HEADERS });
    if (!full.ok) throw new Error(`bulk-data fetch failed: HTTP ${full.status}`);
    meta = await full.json();
  }
  const url = meta.jsonl_download_uri || meta.download_uri;
  console.log(`Downloading ${meta.name} (${(meta.compressed_size || meta.size || 0) / 1e6 | 0} MB, updated ${meta.updated_at})...`);
  const fileRes = await fetch(url, { headers: HEADERS });
  if (!fileRes.ok) throw new Error(`download failed: HTTP ${fileRes.status}`);
  await pipeline(Readable.fromWeb(fileRes.body), fs.createWriteStream(RAW_FILE));
}

function compactAll() {
  console.log('Compacting...');
  const text = zlib.gunzipSync(fs.readFileSync(RAW_FILE)).toString('utf8');
  const cards = text.split('\n').filter(Boolean).map(line => compact(JSON.parse(line)));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(cards));
  const mb = (fs.statSync(OUT_FILE).size / 1e6).toFixed(1);
  console.log(`Wrote ${cards.length} cards -> ${OUT_FILE} (${mb} MB)`);
}

(async () => {
  if (process.argv.includes('--compact')) { compactAll(); return; }
  await download();
  compactAll();
  console.log('Done. Index is offline-ready; delete mtg-oracle-raw.json to reclaim space.');
})().catch(e => { console.error('mtg-sync failed:', e.message); process.exit(1); });
