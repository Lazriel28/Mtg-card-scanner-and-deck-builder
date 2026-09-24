# MTG Codex — scan cards, build your collection, build decks, get suggestions

Snap photos of MTG cards on your phone, and the app reads the name, matches it against the catalog, and drops it into your collection with auto-categorization. From there: build Commander (100-card, singleton) or 60-card decks, validate them, and let the app suggest full decks from *your* collection for any color combo and format.

Two front ends, one backend:

- **Web app** — a Node server (`mtg-codex/server.js`) serves a browser UI over HTTP. Open it in Safari on your phone on the same Wi-Fi for camera scanning.
- **Native iOS shell** — a SwiftUI app (`mtg-codex/ios/`) that talks to the same Node server over the LAN. MV P: Scan (AVFoundation camera → `/api/scan` → add to collection) and Collection (`/api/collection`). Decks and Suggest come after.

## What's in this repo

```
.
├── codemagic.yaml          # Codemagic iOS pipeline (builds the Xcode project)
├── README.md               # this file
├── mtg-codex/
│   ├── package.json        # manifest: start / test / electron
│   ├── .gitignore          # excludes data/imgcache, photos, node_modules, logs
│   ├── README.md           # app-scaffolding notes
│   ├── server.js           # Node HTTP server + JSON API (zero dependencies)
│   ├── src/
│   │   ├── catalog.js      # Scryfall bulk-data cache, search, fuzzy match, thumb URLs
│   │   ├── collection.js   # collection CRUD, auto-categorization, stats, decklist import
│   │   ├── decks.js        # deck store, Commander/60-card rules, validation, stats
│   │   ├── suggest.js      # suggests a deck from your collection, playstyle memory
│   │   └── ocr.js          # optional tesseract.js wrapper (scan works without it)
│   ├── public/
│   │   ├── index.html      # app shell
│   │   ├── style.css       # design tokens + layout
│   │   ├── app.js          # router, collection/decks/suggest views
│   │   └── scan.js         # camera + upload + OCR confirm flow
│   ├── electron/
│   │   └── main.js         # Electron wrapper (npm run electron)
│   ├── data/
│   │   ├── cards.jsonl     # synced Scryfall card catalog (38,244 cards)
│   │   ├── collection.json # your cards (qty, condition, photo, categories, value)
│   │   ├── decks.json      # saved decks
│   │   ├── photos/         # snapped card photos (one per card)
│   │   └── imgcache/       # cached Scryfall thumbnails (transient, gitignored)
│   ├── ios/
│   │   ├── README.md       # iOS native shell notes
│   │   ├── MTGCodex/
│   │   │   ├── AppDelegate.swift
│   │   │   ├── ConfigStore.swift   # persisted LAN server URL
│   │   │   ├── CodexAPI.swift      # shared API client matching /api/...
│   │   │   ├── ScanView.swift      # AVFoundation camera → /api/scan
│   │   │   ├── CollectionView.swift
│   │   │   ├── RootView.swift
│   │   │   ├── Info.plist          # bundle id com.mtgcodex.app, camera/photo usage
│   │   │   ├── MTGCodex.entitlements
│   │   │   └── Assets.xcassets/
│   │   └── MTGCodex.xcodeproj/
│   └── test/
│       ├── catalog.test.js   # catalog load/search/match (6 tests)
│       └── engines.test.js   # collection/decks/suggest (13 tests)
```

## Running the web app

The web app is the backend everything talks to, including the iOS shell.

```
cd mtg-codex
npm start
```

This runs `node server.js` with zero dependencies. It listens on port **3123** by default and prints the LAN address, e.g.:

```
MTG Codex listening on http://localhost:3123
  also on http://192.168.86.193:3123  (open from your phone on the same Wi-Fi)
```

Open `http://localhost:3123` in a desktop browser, or `http://<lan-ip>:3123` on your phone (same Wi-Fi) to use the camera.

The web app has four views: **Scan** (camera/upload/OCR/manual), **Collection** (auto-categorized cards, stats, import), **Decks** (create/validate/export Commander & 60-card decks), and **Suggest** (build a deck from your collection).

## Running the native iOS shell

Open `mtg-codex/ios/MTGCodex.xcodeproj` in Xcode on macOS and run it on a simulator or device. The first shell covers **Scan** (AVFoundation rear-camera capture → JPEG → base64 data URL → `POST /api/scan` → candidate chips → add to collection) and **Collection** (`/api/collection` grid with stats, category chips, qty edit, remove, add-by-name). There's a **Settings** tab to paste the LAN server URL.

The iOS app talks to the same Node server you start with `npm start`. The iPhone and the computer running the server must be on the same Wi-Fi.

Steps:
1. Start the server: `cd mtg-codex && node server.js`.
2. Note the LAN address it prints.
3. In the iOS app, open **Settings** and paste that address (keep `http://` and the port).
4. Save. The app uses that address for all API calls.

The server address is persisted in `UserDefaults` via `ConfigStore`, so you set it once.

## Card catalog

The catalog is a compact Scryfall-style JSONL dump at `mtg-codex/data/cards.jsonl`. The repo ships with a synced catalog (38,244 cards) so the app works immediately on clone.

To refresh it later, start the server and trigger a sync:
- Web app: **Sync catalog now** banner, or hit `POST /api/sync` (it streams progress via SSE at `/api/sync/progress`).
- The sync downloads Scryfall's bulk data once, builds the catalog on disk, and then everything works offline from the local `cards.jsonl`.

The catalog can be regenerated; you don't have to keep committing a fresh copy.

## API (what the iOS app uses)

The server exposes a JSON API at `/api/...`. The iOS `CodexAPI` client mirrors it exactly:

- `GET /api/status` — catalog sync state, collection/deck counts, OCR status.
- `POST /api/scan { imageDataUrl }` — send a JPEG as a base64 data URL; get `{ ocrText, candidates, photo }`.
- `GET /api/collection` — `{ entries, stats, byCategory }`.
- `POST /api/collection/add { name, qty, condition }` — add a card.
- `POST /api/collection/set { name, qty }` — set quantity.
- `GET /api/cards/search?q=&limit=` — autocomplete.
- `GET /api/cards/thumb?name=` and `GET /api/photos/<file>` — card art and saved photos.

## Codemagic CI

`codemagic.yaml` at the repo root is the Codemagic iOS pipeline. It builds the native iOS app from the Xcode project:

```
mtg-codex/ios/MTGCodex.xcodeproj   (scheme: MTGCodex)
```

The pipeline builds for:
- **iPhone 15 Simulator** (Debug, no signing required).
- **Generic iOS device** (Debug; signing is handled in Codemagic's iOS app settings when you link the repo and set an Apple team).

Build artifacts are the `.app` products, viewable in Codemagic.

To wire it up:
1. Push this branch (`ios-ci`) to GitHub.
2. In Codemagic, add the GitHub repo `Lazriel28/Mtg-card-scanner-and-deck-builder`.
3. Enable the `codemagic.yaml` iOS pipeline on the `ios-ci` branch.
4. In Codemagic's iOS app settings, set the Apple team and signing identity when you want device builds to sign. Until then the simulator build should pass.

Bundle identifier: `com.mtgcodex.app`.

## OCR

Card-name OCR is optional. The server uses `tesseract.js` when installed (`npm i tesseract.js` — it lazily downloads a language model and caches it). If it's not installed, scanning still works via manual name entry. The iOS shell does its own camera capture and sends the JPEG to the server, so OCR availability is a server-side concern.

## Tests

```
cd mtg-codex
npm test
```

This runs the engine tests (`node --test`). The current suite is 19 tests across `test/catalog.test.js` (6) and `test/engines.test.js` (13). They test the catalog, collection, decks, and suggest logic over shared fixtures.

## Electron (desktop)

An Electron wrapper is included at `mtg-codex/electron/main.js`. Run it with `npm run electron` after `npm install` (Electron is a devDependency). It boots the same Node server and shows it in a window. Desktop is an optional shell — the app still works when served over HTTP for phone use.

## Config and signing notes

- The iOS app uses an arbitrary-loads entitlement in development so the LAN server is reachable. For a real App Store build you'd tighten App Transport Security (explicit LAN origin, or HTTPS) and set a proper bundle ID / Apple team.
- The Xcode project has `CODE_SIGN_STYLE = Automatic` with an empty signing identity for Debug, so Codemagic (or you) supplies the Apple team. The bundle ID is set in both `Info.plist` and the Xcode project build settings.

## Project structure notes

The engine modules (`catalog`, `collection`, `decks`, `suggest`, `ocr`) are the logic core and are testable in isolation from the UI and the network. The server is the seam where the app becomes network-accessible. The web UI (`public/app.js`, `public/scan.js`) is thin and delegates to the server API. The iOS shell reuses the same API client contract, so adding more iOS views later is straightforward.
