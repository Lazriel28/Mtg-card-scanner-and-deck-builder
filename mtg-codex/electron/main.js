'use strict';
// Electron shell: boots the same Node server, then shows it in a window.
// Run with: npm run electron  (after npm install)

const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const freePort = () => new Promise(resolve => {
  const srv = require('net').createServer();
  srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
});

async function waitForServer(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 700 }, res => {
          res.resume();
          res.statusCode === 200 ? resolve() : reject(new Error('status ' + res.statusCode));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      return;
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('server did not start');
}

app.whenReady().then(async () => {
  const port = await freePort();

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  child.on('exit', () => app.quit());

  await waitForServer(port);

  const win = new BrowserWindow({
    width: 1380, height: 900,
    backgroundColor: '#12100e',
    title: 'MTG Codex',
    autoHideMenuBar: true,
  });
  win.loadURL(`http://127.0.0.1:${port}/`);

  app.on('window-all-closed', () => app.quit());
});
