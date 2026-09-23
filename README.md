# WorldForge

An offline, free worldbuilding and authoring studio for your Obsidian vault — built
as the free replacement for paid wiki/world tools. Your vault folder stays the
single source of truth: plain `.md` files, no lock-in, no cloud.

## Features (current)

- **3D force-directed world graph** of your vault, with hover previews,
  right-click menus, and category color-coding (Character/Location/Item/Lore).
- **Graph settings (⚙)** — node size, link distance, repel force; per-category
  visibility filters and an orphan toggle; all persisted across restarts.
- **Zoom-to-match** — press Enter in the search box and the camera flies to
  frame the matching notes.
- **Notes** — create, edit (with `[[wikilink]]` autocomplete), delete to a
  recoverable `.trash/`; automatic backups on every save.
- **Import** — pull `.md` files from any folder (e.g. another Obsidian vault);
  collisions never overwrite.
- **Field manual (❓)** — built-in documentation, updated with every feature.

## Running

```bat
Start WorldForge.bat
```

(First time only: `npm install` inside `worldforge/`.)

## Development

```bash
cd worldforge
npm install
npm test          # engine test suite
node scripts/make-harness.js   # regenerate browser-test fixtures
```

- `worldforge/src/` — pure Node engines (vault scan, markdown, importer, layout, types)
- `worldforge/main.js` — Electron main process (all disk I/O)
- `worldforge/public/` — renderer UI (three.js vendored, fully offline)

See `worldforge/MANUAL.md` for the user manual and `docs/superpowers/specs/` for the design.
