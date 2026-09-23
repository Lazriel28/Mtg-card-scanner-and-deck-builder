# WorldForge — Design Spec

**Date:** 2026-09-22 · **Status:** Approved in chat, pending spec review
**Owner:** the user ("free VVD alternative") · **Platform:** Windows (primary)

## 1. Purpose

VVD (vvd.world) is a paid worldbuilding platform. Its Obsidian import requires a
subscription. WorldForge is a free, offline desktop app that:

1. Imports an Obsidian vault (notes, `[[wikilinks]]`, tags) — **no data copy**; the
   vault on disk is the single source of truth.
2. Renders the vault as an interactive **3D graph**.
3. Shows **cards** (Character / Location / Item / Lore) via auto-detected or
   user-assigned note types, editable in-app with frontmatter write-back.
4. Hosts **interactive maps** with pins linked to notes.
5. **Publishes** the vault as a static wiki website (hostable free: GitHub Pages /
   Netlify / Cloudflare Pages) — the free replacement for `*.vvd.world` pages.

Success criteria: the user double-clicks an .exe, picks their vault, sees their
world in 3D within seconds, can edit notes in-app, and can export a wiki website —
all without internet after the one-time build.

## 2. Constraints & decisions (from interview)

- **Offline:** after one-time build (downloads Electron toolchain), zero network use.
- **Free:** no paid services anywhere in the pipeline.
- **Editing model:** "Both apps, one house" — WorldForge reads live and writes back
  plain .md; Obsidian unaffected. All edits are plain-text safe.
- **Card types:** auto-detect (frontmatter `type:` → folder name → Untyped), with
  in-app override that writes back to frontmatter.
- **Shell:** Electron, packaged as a **portable exe** (no installer).
- **Not in v1:** real-time collaboration, accounts, sync, plugins, VVD's writing
  tools (Quill), custom domains, search-engine features.

## 3. Architecture

```
WorldForge.exe (portable Electron)
├── Main process (Node, private)        ← all disk I/O lives here
│   ├── vault engine   src/vault.js     scan, link resolve, backlinks, graph JSON
│   ├── markdown       src/md.js        [[wikilinks]], #tags → clickable HTML
│   ├── types engine   src/types.js     card-type detect + frontmatter write-back
│   ├── maps engine    src/maps.js      maps.json read/write, pin CRUD
│   ├── publish engine src/export.js    wiki-site generator
│   └── backup         main.js          pre-write timestamped copies
├── Renderer (UI, no Node access)       ← window.chrome? none; IPC only
│   ├── world view     public/world.js  three.js 3D graph (vendored locally)
│   ├── cards view     public/cards.js  gallery by type, type dropdown
│   ├── maps view      public/maps.js   image + pin editor (canvas/SVG)
│   ├── note view      public/note.js   read/edit pane, save via IPC
│   └── index.html + app.css
└── dist/  WorldForge-<version>-portable.exe
```

- IPC surface (contextIsolation on, preload exposes `wf.*` API):
  `pickVault, getStatus, getGraph, getNote, saveNote, createNote, setType,
  getTypes, listMaps, addMap, removeMap, getPins, addPin, movePin, removePin,
  linkPin, exportWiki, openExternal(folder)`.
- Preload whitelist only; renderer never receives raw `fs`.

## 4. Data model

- **Vault source of truth:** user's Obsidian folder. `.md`/`.markdown` files are notes.
- **WorldForge metadata:** `.worldforge/` inside the vault:
  - `maps.json` — `{ maps: [{ id, name, image: "vault-relative/path", pins:
    [{ id, x, y (0–1 normalized), noteId | null, label }] }] }`
  - `backups/` — `note-<name>-<timestamp>.md` written before every overwrite.
- **Card types:** `types.js` resolution order:
  1. frontmatter `type:` (case-insensitive match to known set or free value)
  2. folder name match (Characters/People → Character, Locations/Places → Location,
     Items → Item, Lore/World → Lore)
  3. `untyped`
  The four canonical types + `untyped` get fixed colors; unknown frontmatter values
  render as their own color hash. In-app change writes frontmatter (creates it if
  absent; preserves existing keys).
- **Graph:** nodes = notes `{id(path), title, dir, type, tags, size, mtime}`;
  links = undirected unique pairs with weight.

## 5. UI

- **Window:** dark theme, left icon rail: World / Cards / Maps / Publish. Main area
  shows the active view; a right-side note panel opens on any node/card/pin click.
- **World:** three.js scene. Spheres sized by `log(1+links)`, colored by card type.
  OrbitControls (rotate/zoom/pan), hover tooltip (title + type), search box dims
  non-matches, click opens note panel. Camera auto-frames the graph.
- **Cards:** four + untyped columns; card shows icon, title, tags, link counts.
  Dropdown on card changes type (writes frontmatter). Search filter.
- **Maps:** left list of maps + "Add map from vault" (file picker filters to images);
  main canvas shows image; click to add pin (prompt for note link), drag pins,
  right-click delete; pin labels shown; clicking pin opens linked note.
- **Note view (right panel):** rendered HTML with clickable `[[wikilinks]]`,
  `#tags`, broken-link styling; Edit toggle → textarea; Save (Ctrl+S) writes via
  main (with backup); New Note button; backlinks and outgoing links listed.
- **Publish:** shows export path + "Export now" + "Open folder" + short free-hosting
  guide (GitHub Pages / Netlify Drop / Cloudflare Pages).

## 6. Publish engine (wiki-site/)

Output written to `<vault>/wiki-site/`:

- `index.html` — home: tag cloud, all notes.
- `page-<slug>.html` — one per note (flat filenames; nested vault paths flatten to
  slugified basenames, collisions suffixed `-2`, `-3`): rendered markdown, tags,
  backlinks, outgoing.
- `tag-<tag>.html` — per-tag page listing notes.
- `graph.html` — 3D graph as a web page (same three.js bundle).
- `maps.html` — each map image with pins (image-map links to note pages).
- `wiki.css`, `three.module.min.js`, `graph-common.js`.
- Sidebar lists all notes; clean relative hrefs; works offline by double-click.
- Windows reserved-name slugs guarded; collision-suffixed (`-2`, `-3`).

Free-hosting note (in-app): GitHub Pages / Netlify Drop / Cloudflare Pages steps,
three sentences each.

## 7. Error handling & safety

- Pre-write backup to `.worldforge/backups/` (keep last 50 per note).
- Scans skip `.obsidian`, `.git`, `.trash`, `.worldforge`, `node_modules`, hidden dirs.
- Malformed frontmatter → treated as absent (never crash).
- Unresolvable wikilink → styled "missing" link (red, dashed underline), no crash.
- Vault moved/deleted after load → friendly banner + re-pick dialog.
- Saving from Obsidian while app open → 2s-debounced rescan keeps views fresh.

## 8. Testing

- **Engine unit tests (plain Node, no Electron):** `test/*.test.js` with Node's
  built-in runner — vault scan/link resolution/backlinks, md rendering (wikilinks,
  tags, code fences, tables→p), type detect + frontmatter write-back (idempotent,
  preserves unknown keys), maps.json CRUD, export (pages exist, hrefs resolve,
  no orphan links, slug collisions).
- **UI smoke harness:** run renderer in a plain browser with a `window.wf` mock so
  world/cards/note views are screenshot-verified before packaging.
- **Packaging check:** portable exe launches, loads demo vault, graph renders.

## 9. Milestones

1. **M1 — Shell + import + 3D graph.** Electron main + preload + window; vault
   engine wired; world view live.
2. **M2 — Cards.** types engine + cards view + frontmatter write-back.
3. **M3 — Maps.** maps engine + maps view + pins.
4. **M4 — Publish.** export engine final + hosting guide + packaging + README.
5. **M5 — Book studio.** book builder + HTML/PDF/EPUB export (see §11).
6. **M6 — Cinema mode.** controllable playback + Sim-to-Scene (see §11); repackage exe.

Each milestone: unit tests green + UI smoke, then user tries the app.

## 11. Books & Cinema (added after authoring interview, approved 2026-09-22)

The user writes books from vault content. Two additions, same engines:

### 11.1 Book studio (M5)
- **Builder:** pick notes in order as chapters (drag to reorder); book metadata
  (title, author, cover color) stored in `.worldforge/books.json`.
- **Exports:** polished HTML book (title page, TOC, chapters), print-ready PDF
  (via print stylesheet), and **EPUB** (zipped XHTML — no paid tools).
- IPC: `getBooks, saveBook, exportBook`.

### 11.2 Cinema mode (M6)
- **Cinematic walkthrough:** camera flies through the 3D world; chapter text plays
  as subtitles scene-by-scene; nodes light up as mentioned.
- **Full playback controls** (user requirement): pause, speed (0.5–4x), fast
  forward, seek back/forward, scrub timeline.
- **Camera control:** user can grab and move the camera at any time (manual orbit
  overrides autopilot until released).
- **Sim-to-Scene (reverse mode):** user places/moves nodes and props in the 3D
  scene, presses "Write scene", and the app interprets the arrangement (which
  nodes present, distances, who's near whom) and drafts a prose scene into a new
  note. Heuristic templating first; LLM-free and offline.
- mp4 capture: documented Win+Alt+R path; optional bundled ffmpeg renderer later.
- IPC: `playChapter, getCues, writeScene`.

## 10. Open questions (answered in M-order, non-blocking)

- Icon art: temporary glyph until user provides one (M4).
- Demo vault content: small fantasy sample (M1).
