# WorldForge — Implementation Plan

**Spec:** docs/superpowers/specs/2026-09-22-worldforge-design.md (approved; §11 added)
**Stack:** Electron + vendored three.js + dependency-free Node engines

## M1 — Shell + import + 3D graph  ← this milestone
1. Electron shell: `main.js` (window, IPC, config, backups), `preload.js`
   (whitelisted `wf.*` API), dark UI shell (`public/index.html`, `app.css`).
2. Vault engine: reuse `src/vault.js` + `src/md.js`; add frontmatter `type:`
   extraction (nodes carry `type` for coloring).
3. World view: `public/world.js` — force layout (hand-rolled, no deps),
   type-colored spheres sized by degree, custom orbit/zoom/pan, hover tooltip,
   search dimming, click→note.
4. Note panel: `public/app.js` — rendered HTML, Edit/Save (Ctrl+S), backlinks,
   outgoing; New Note.
5. Demo vault: `worldforge/demo-vault/` (Rezvani War Wagon, Spectre, Garage
   Comparison, World Index) wired as default sample world.
6. Verify: `node --test test/` green; browser harness (`public/harness.html` +
   mock `wf`) screenshot-verified; Electron window launches on user's desktop.

## M2 — Cards
`src/types.js` (detect + frontmatter write-back, preserve unknown keys),
cards gallery view, type dropdown. Tests: detect order, idempotent write-back.

## M3 — Maps
`src/maps.json` CRUD (`src/maps.js`), maps view (image + pins + drag),
pin→note links. Tests: CRUD round-trip, normalized coords.

## M4 — Publish
`src/export.js` extended: tag pages, `graph.html`, `maps.html`, slug collision
handling; hosting guide in-app; package portable exe (electron-packager); README.

## M5 — Book studio (spec §11.1)
`.worldforge/books.json`, builder UI, HTML/PDF/EPUB exporters + unit tests
(EPUB opens, TOC complete, chapters in order).

## M6 — Cinema mode (spec §11.2)
Cue builder from chapter text, playback engine with pause/speed/seek/scrub,
manual camera override, Sim-to-Scene heuristic writer, repackage.

## Verification cadence
Every milestone: engines unit-tested (`node --test`), UI smoke in browser
harness with screenshots, then a real launch for the user. No milestone ships
with red tests.
