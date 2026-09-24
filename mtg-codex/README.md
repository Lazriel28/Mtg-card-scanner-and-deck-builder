# MTG Codex — app scaffolding kit

A reusable starting structure for a standalone MTG card app: photo scan → catalog match → collection, with deck building and deck suggestions. This kit gives you the folder layout, module skeletons, config stubs, manifest, and clear integration notes. The engine logic and small details are already here so you can drop in your own rendering/backend choices without rebuilding the shape.

## What's in the kit

The working copy lives in `mtg-codex/`. Treat that folder as the reference implementation. What follows is the same structure described so you can recreate or adapt it in a separate codebase.

## Project layout

Use this as the default shape. Everything is plain modules with no locked framework — swap in your stack at the boundaries.

```
mtg-codex/
  package.json            # manifest with scripts: start / test / electron
  .gitignore
  README.md               # one-line summary + run notes
  data/
    cards.jsonl           # compact card catalog dump (one JSON object per line)
    collection.json       # user's card quantities + per-card photo names
    decks.json            # saved decks (content + metadata)
    photos/               # one photo file per scanned/added card
  src/
    catalog.js            # card catalog: load, search, fuzzy match, price lookup, thumb urls
    collection.js         # collection CRUD, categorization, stats, bulk import
    decks.js              # deck store, format rules (Commander 100 / 60-card), validation, stats
    suggest.js            # draft a deck from the user's collection by color + format
    ocr.js                # optional tesseract.js wrapper for photo text extraction
  server.js               # HTTP server + JSON API for scan/upload/search/collection/decks/suggest/thumbs
  public/
    index.html            # app shell with the nav + view containers
    style.css             # design tokens and layout for the whole app
    app.js                # top-level router, modals, collection/decks/suggest views
    scan.js               # camera + upload + OCR confirm flow
  electron/
    main.js               # Electron wrapper that hosts the web app
  test/
    catalog.test.js       # catalog loading + search + match + price behavior
    engines.test.js       # collection / decks / suggest behavior over shared fixtures
```

## Module boundaries

Keep these responsibilities clean so you can replace the front end or the server without untangling everything.

### `src/catalog.js`
Responsibilities:
- Load the compact card catalog from `data/cards.jsonl` on demand.
- Provide exact search by name/set/code.
- Provide fuzzy name matching for scan results because OCR is never perfect on card titles.
- Expose card metadata needed by the rest of the app: name, mana cost, cmc, colors, type, text, keywords, set/collector number, legality per format, and a reasonable price field when available.
- Expose a stable art/thumbnail URL source for card tiles.

Integration note:
- The catalog is read-heavy and should be lazy or cached. Do not require a network call on every render. If you want offline use, treat the JSONL as the authoritative local catalog and sync it only when you choose.

### `src/collection.js`
Responsibilities:
- Add, remove, and update card quantities in `data/collection.json`.
- Attach a photo filename when a card is added from a scan or upload.
- Auto-categorize every card into useful groups: by type, by color, by mana value band, and by Commander legality.
- Compute collection stats: total count, unique cards, estimated value.
- Support bulk import from a decklist-style text paste.

Integration note:
- Categorization should be derived from catalog data, not hand-entered. That keeps it consistent as the catalog changes.

### `src/decks.js`
Responsibilities:
- Persist decks to `data/decks.json`.
- Enforce format rules:
  - Commander: 100 cards, singleton, color identity for the commander.
  - 60-card: 4-of limit for non-basic cards, optional sideboard.
- Validate a deck and return problems such as wrong count, broken singleton, or commander identity mismatch.
- Compute per-deck stats: curve, color balance, card advantage heuristics, ownership gaps against the current collection.

Integration note:
- Deck validation should use the catalog for legality and the collection for ownership, but it should not mutate either one.

### `src/suggest.js`
Responsibilities:
- Build a full deck from the user's collection for a chosen color combination and format.
- Prefer cards that fit the curve and the role mix you want, not just the cheapest cards.
- Fill nonbasic lands first, then split basics across the deck's colors as evenly as possible.
- Honestly report shortfalls: cards the user does not own enough of.

Integration note:
- Suggestions should be deterministic enough to explain, not a black box. The app should be able to say why a card was chosen and what the user is missing.

### `src/ocr.js`
Responsibilities:
- Accept an image blob or file.
- Extract text with tesseract.js if it is installed.
- Return raw text for catalog matching.
- Degrade gracefully when OCR is unavailable; scanning should still work through manual name entry.

Integration note:
- Keep OCR optional. The core flow should not require it.

### `server.js`
Responsibilities:
- Serve the static app shell.
- Provide a JSON API for:
  - catalog search and fuzzy match
  - collection read/write
  - deck read/write/validation/stats
  - suggestion generation
  - photo upload and per-card photo storage
  - card thumbnails/art proxying from the catalog source
- Accept camera or file upload for scanning.

Integration note:
- The API is the seam where the app becomes "real." If you change the server language or framework later, keep the same operations available and the front end mostly stays put.

### `public/app.js` and `public/scan.js`
Responsibilities:
- `app.js` owns the top-level navigation, view switching, modals, and the collection and decks UI.
- `scan.js` owns the camera/upload flow, OCR call, match confirmation, and adding the result to the collection.

Integration note:
- Keep view logic separate from engine logic. The front end should call the server API or local modules, not reimplement catalog matching or deck rules.

### `electron/main.js`
Responsibilities:
- Provide a desktop wrapper around the same app.
- Start or connect to the same server/backend the web version uses.
- Keep desktop concerns isolated so the app itself is still runnable in a browser.

Integration note:
- Desktop is an optional shell. The app should still make sense when served from a normal HTTP server for phone use on the same network.

## Config and manifest

### `package.json`
Should include at least:
- `start` to run the HTTP server
- `test` to run the engine tests
- `electron` to run the desktop wrapper, if you include it
- A short description and license

### `.gitignore`
Should ignore:
- runtime data files you do not want shared verbatim, if any
- logs
- dependency installs
- built/derived artifacts

### `data/` contents
- `cards.jsonl`: the catalog
- `collection.json`: the user's collection
- `decks.json`: saved decks
- `photos/`: user-uploaded card photos

## Run notes

Two ways to run the same app:
1. Browser/server mode: start the HTTP server and open the app on any device on the same network for phone camera use.
2. Desktop mode: use the Electron wrapper if you included it.

The app is designed to work without heavy dependencies. If you want OCR, install the OCR dependency separately and wire it through `src/ocr.js`; the app should still function without it.

## Data you must supply separately

This kit intentionally does not ship the full card catalog. You bring your own catalog source:
- A compact Scryfall-style JSONL dump is the expected shape for `data/cards.jsonl`.
- Sync it when you want fresh data; after that, the app can run offline from the local catalog.
- Photos live in `data/photos/` and are referenced by card identity in the collection.

## How to use this kit in your own app

1. Copy the layout above into your project.
2. Keep the engine modules (`catalog`, `collection`, `decks`, `suggest`, `ocr`) as the logic core.
3. Implement your own rendering layer around them. The kit does not commit you to a particular UI framework.
4. Implement your own server or API layer around the same operations. The same app behavior should be available whether you call it from the browser or from a desktop shell.
5. Add tests for the engine modules first. They are the easiest part to verify and the most valuable to keep correct as the UI changes.

## Files already present in the working copy

The working copy in `mtg-codex/` already contains:
- `package.json`
- `.gitignore`
- `README.md`
- `server.js`
- `src/catalog.js`, `src/collection.js`, `src/decks.js`, `src/suggest.js`, `src/ocr.js`
- `public/index.html`, `public/style.css`, `public/app.js`, `public/scan.js`
- `electron/main.js`
- `test/catalog.test.js`, `test/engines.test.js`

You can use that copy as-is, or lift its structure into a different repo and re-implement the presentation layer on top.
