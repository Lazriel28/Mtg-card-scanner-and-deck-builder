# WorldForge

An offline, free worldbuilding and authoring studio for your Obsidian vault — built
as the free replacement for paid wiki/world tools. Your vault folder stays the
single source of truth: plain `.md` files, no lock-in, no cloud.

## What it does

- **3D force-directed world graph** of your vault, with hover previews,
  right-click menus, and category color-coding (Character/Location/Item/Lore).
- **Graph settings (⚙)** — node size, link distance, repel force; filter by
  type and hide orphan notes.
- **Note panel** — read markdown in-app, click wikilinks, see backlinks and
  outgoing links, type `[[` for live note suggestions.
- **Create / edit / save notes** with backups into `.worldforge/backups/`.
- **Import notes (📥)** — copy `.md` notes from any folder on your PC into your
  vault's `imports/` folder. Duplicate-safe and deletion-aware.
- **Mass delete (🗑)** — bulk-delete notes safely (they go to `.trash/` and are
  recoverable). Includes a "Select duplicates" helper.
- **Command palette (⌘ / Ctrl+K)** — search commands, notes, and actions.
- **Vault insights (📊)** — stats, top tags, broken links, recent edits.
- **Vault tools (🔍)** — broken-link finder, duplicates helper, orphan folders,
  backups viewer.
- **3D world manipulation** — select, drag, G/R/S transforms, box select, pin
  notes in place; positions persist in `.worldforge/layout.json`.
- **MTG workshop (🃏)** — offline Magic: The Gathering card lookup, collection,
  deck builder, and playground (life counter, battlefield, counters, d20, coin).
- **Maps (🗺️)** — pin notes onto images; pins are stored in your vault.
- **Dark/light theme** toggle, remembered.
- **Favorite notes (⭐)** — starred notes surface in a favorites panel.

## Getting started

1. Double-click **Start WorldForge.bat** (or **Start WorldForge.ps1** if you
   prefer the PowerShell launcher).
2. On first run, npm install runs once to set up Electron.
3. Click **📂** and choose your Obsidian vault folder.
4. For the MTG workshop, run once:
   `node scripts/mtg-sync.js`
   after Node is available in the repo.

## Project structure

- `main.js` — Electron main process: vault scanning, importers, IPC handlers.
- `preload.js` — preload bridge for renderer IPC.
- `server.js` — optional dev harness server for the preview.
- `public/` — renderer HTML/CSS/JS and the dev harness.
- `src/` — core modules: importer, export, md rendering, layout, vault, mtg,
  maps, vault-tools, tombstones.
- `scripts/` — one-shot helpers including `mtg-sync.js`.
- `demo-vault/` — sample vault used for development and previews.
- `icon.ico` / `icon.png` — app icon files.
- `codemagic.yaml` — CI build spec for Codemagic.

## Build / CI

This repo targets **Codemagic**. The `codemagic.yaml` workflow:

- checks out the repo,
- sets up Node,
- installs dependencies,
- runs the test suite,
- builds the packaged Electron app,
- packages artifacts for download.

There is no wiki publish feature — WorldForge runs entirely offline on your own files.

## Local development

```bash
npm install
npm test
npm start
```

`npm start` runs Electron pointed at this folder.

## Manual

See `worldforge/MANUAL.md` for the full feature manual.

## License

MIT
