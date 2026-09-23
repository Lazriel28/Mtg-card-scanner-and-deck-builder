'use strict';
// WorldForge - local, offline, zero-dependency Node server.
// Run: node server.js   (or double-click "Start WorldForge.bat")

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { scanVault } = require('./src/vault');
const { exportSite, CSS } = require('./src/export');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT_START = parseInt(process.env.WF_PORT || '8787', 10);

let vault = null; // live scanVault() result
let config = { lastVault: '' };
try { config = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')); } catch {}

function saveConfig() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(config, null, 2));
  } catch (e) { console.error('config save failed:', e.message); }
}

/* ---------- helpers ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function err(res, code, msg) { json(res, code, { error: msg }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 64e6) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serveStatic(res, urlPath) {
  const rel = urlPath.replace(/^\/+/, '') || 'index.html';
  const full = path.normalize(path.join(PUB, rel));
  if (!full.startsWith(PUB)) return err(res, 403, 'forbidden');
  fs.readFile(full, (e, buf) => {
    if (e) return err(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function serveVaultAsset(res, relPath) {
  if (!vault) return err(res, 400, 'no vault loaded');
  const full = path.normalize(path.join(vault.root, relPath));
  if (!full.startsWith(path.normalize(vault.root))) return err(res, 403, 'forbidden');
  fs.readFile(full, (e, buf) => {
    if (e) return err(res, 404, 'not found in vault');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------- API actions ---------- */
function apiLoadVault(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) throw new Error('folder not found: ' + rootPath);
  vault = scanVault(rootPath);
  config.lastVault = rootPath;
  saveConfig();
  return { ok: true, root: vault.root, notes: vault.notes.length, links: vault.graph.links.length };
}

function apiGetNote(id) {
  if (!vault) throw new Error('no vault loaded');
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found: ' + id);
  const linkFor = (target, exists) => exists ? '#note:' + encodeURIComponent(vault.resolve(target).id) : '#missing:' + encodeURIComponent(target);
  const html = require('./src/md').renderMarkdown(n.body, t => !!vault.resolve(t), linkFor);
  return {
    id: n.id, title: n.title, dir: n.dir, tags: n.tags, html,
    raw: n.raw, outgoing: n.outgoing.map(i => vault.notesById.get(i).id),
    backlinks: [...new Set(n.backlinks)],
  };
}

function apiSaveNote(id, raw) {
  if (!vault) throw new Error('no vault loaded');
  const n = vault.notesById.get(id);
  if (!n) throw new Error('note not found');
  fs.writeFileSync(n.file, raw, 'utf8');
  // lightweight rescan to refresh links/graph
  vault = scanVault(vault.root);
  return { ok: true };
}

function apiCreateNote(title, folder, bodyText) {
  if (!vault) throw new Error('no vault loaded');
  const safe = String(title).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
  let rel = (folder && folder !== '.' ? folder + '/' : '') + safe + '.md';
  let full = path.join(vault.root, rel);
  let n = 1;
  while (fs.existsSync(full)) { rel = (folder && folder !== '.' ? folder + '/' : '') + `${safe} ${n++}.md`; full = path.join(vault.root, rel); }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bodyText || `# ${safe}\n\n`, 'utf8');
  vault = scanVault(vault.root);
  return { ok: true, id: rel };
}

function apiExportWiki() {
  if (!vault) throw new Error('no vault loaded');
  const outDir = path.join(vault.root, 'wiki-site');
  const result = exportSite(vault, outDir);
  // shared assets
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'wiki.css'), CSS);
  const vend = path.join(PUB, 'vendor');
  for (const f of ['three.module.min.js', 'graph-common.js']) {
    const src = path.join(vend, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, f));
  }
  return { ok: true, dir: outDir, pages: result.pages };
}

function apiPickFolder() {
  return new Promise((resolve) => {
    const script = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Choose your Obsidian vault folder'; if($f.ShowDialog() -eq 'OK'){ Write-Output $f.SelectedPath }";
    const p = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
    let out = '';
    const timer = setTimeout(() => { try { p.kill(); } catch {}; resolve({ path: '' }); }, 180000);
    p.stdout.on('data', d => { out += d.toString(); });
    p.on('close', () => { clearTimeout(timer); resolve({ path: out.trim() }); });
    p.on('error', () => { clearTimeout(timer); resolve({ path: '' }); });
  });
}

/* ---------- router ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (p.startsWith('/vault/')) return serveVaultAsset(res, decodeURIComponent(p.slice('/vault/'.length)));

    if (p === '/api/status') return json(res, 200, { vault: config.lastVault, loaded: !!vault, notes: vault ? vault.notes.length : 0 });

    if (p === '/api/pick-folder' && req.method === 'POST') return json(res, 200, await apiPickFolder());

    if (p === '/api/vault' && req.method === 'POST') {
      const { path: vp } = JSON.parse((await readBody(req)).toString() || '{}');
      return json(res, 200, apiLoadVault(vp));
    }

    if (p === '/api/graph') {
      if (!vault) return err(res, 400, 'no vault loaded');
      return json(res, 200, vault.graph);
    }

    if (p === '/api/note' && req.method === 'GET') return json(res, 200, apiGetNote(u.searchParams.get('id')));

    if (p === '/api/note' && req.method === 'POST') {
      const { id, raw } = JSON.parse((await readBody(req)).toString() || '{}');
      return json(res, 200, apiSaveNote(id, raw));
    }

    if (p === '/api/create-note' && req.method === 'POST') {
      const { title, folder, body } = JSON.parse((await readBody(req)).toString() || '{}');
      return json(res, 200, apiCreateNote(title, folder, body));
    }

    if (p === '/api/export' && req.method === 'POST') return json(res, 200, apiExportWiki());

    if (p === '/api/open-folder' && req.method === 'POST') {
      const { dir } = JSON.parse((await readBody(req)).toString() || '{}');
      if (dir && fs.existsSync(dir)) { spawn('explorer.exe', [dir], { detached: true }); return json(res, 200, { ok: true }); }
      return err(res, 400, 'bad dir');
    }

    if (p === '/' || p === '/index.html') return serveStatic(res, 'index.html');
    return serveStatic(res, p);
  } catch (e) {
    return err(res, 500, e.message || String(e));
  }
});

/* ---------- start (with port fallback) ---------- */
function tryListen(port, attemptsLeft) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && attemptsLeft > 0) tryListen(port + 1, attemptsLeft - 1);
    else { console.error('Could not start server:', e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`WorldForge running at ${url}  (Ctrl+C to stop)`);
    if (config.lastVault && !vault) {
      try { apiLoadVault(config.lastVault); console.log('Auto-loaded last vault:', config.lastVault); }
      catch (e) { console.error('auto-load failed:', e.message); }
    }
    if (process.env.WF_NO_BROWSER !== '1') {
      const open = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      spawn(open, { shell: true, detached: true, stdio: 'ignore' }).unref();
    }
  });
}
tryListen(PORT_START, 10);
