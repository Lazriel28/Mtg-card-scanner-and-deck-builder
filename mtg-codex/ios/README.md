# MTG Codex — iOS native shell (SwiftUI)

A native iOS app shell that talks to the existing `mtg-codex` Node server over the LAN. The first shell covers **Scan** (AVFoundation camera → `/api/scan` → add to collection) and **Collection** (`/api/collection`), with a settings row for the server address. Decks and Suggest come after this MVP.

This is **not** an App Store submission yet. It is the buildable native client that becomes the App Store binary once you add the remaining views, sign it with a real team, and go through the App Store connect flow.

## What's in here

```
mtg-codex/ios/
  README.md              # this file
  MTGCodex/
    AppDelegate.swift    # app entry + delegate
    ConfigStore.swift    # persisted server URL + catalog-synced flag
    CodexAPI.swift       # shared API client matching /api/... on the Node server
    ScanView.swift       # AVFoundation camera capture + /api/scan + candidates
    CollectionView.swift # /api/collection grid + stats + add-by-name + edit/remove
    RootView.swift       # tab-based root: Scan, Collection, Settings
    Info.plist           # bundle id, camera/photo-library usage descriptions
    MTGCodex.entitlements
    Assets.xcassets/
      Contents.json
      AppIcon.appiconset/Contents.json
      LaunchColor.colorset/Contents.json
  MTGCodex.xcodeproj/
    project.pbxproj
```

## Open in Xcode

1. Open `mtg-codex/ios/MTGCodex.xcodeproj` in Xcode on macOS.
2. Pick a run destination: iPhone or iPad (the project targets both via `TARGETED_DEVICE_FAMILY = 1,2`).
3. Set a development team in the Signing & Capabilities tab if you want to run on a device. The simulator runs without a team.
4. Build and run.

If Xcode complains about the asset catalog or any missing source, confirm that `Assets.xcassets/Contents.json` and the source files are present in `MTGCodex/`.

## Configure the server address

The iPhone and the computer running `mtg-codex/server.js` must be on the same Wi-Fi.

1. Start the server on the computer: `cd mtg-codex && node server.js`.
2. Note the LAN address it prints, e.g. `also on http://192.168.86.193:3123`.
3. In the iOS app, open **Settings** and paste that address into the LAN server field (keep the `http://` prefix and the port).
4. Save. The app will point all API calls at that address from then on.

The server address is persisted in `UserDefaults` via `ConfigStore`, so you set it once and the app remembers it.

## How the app talks to the server

`CodexAPI` is the single client. It builds requests against whatever base URL is saved in `ConfigStore`, and its models mirror the existing server JSON exactly:

- `GET /api/status` → `CodexStatus`
- `POST /api/scan { imageDataUrl }` → `ScanResult { ocrText, candidates, photo }`
- `GET /api/collection` → `Collection { entries, stats, byCategory }`
- `POST /api/collection/add { name, qty, condition }` → `CollectionEntry`
- `POST /api/collection/set { name, qty }`
- `GET /api/cards/search?q=&limit=` → `[CardRecord]`
- `GET /api/cards/thumb?name=` and `GET /api/photos/<file>` for card art / saved photos

Scan sends the captured JPEG as a base64 data URL so the server can keep its existing image handling.

## Scan flow (AVFoundation)

1. The camera session opens the rear wide-angle camera in photo preset.
2. The preview is shown through an `AVCaptureVideoPreviewLayer` bridged into SwiftUI.
3. Tapping **Capture card** fires a still-photo capture.
4. The JPEG is encoded at high quality, base64-encoded, sent to `/api/scan`.
5. Candidate cards come back; tapping a candidate adds it to the collection.

If the rear camera isn't available, the session surfaces a warning and the capture button is disabled. A photo-library fallback is present via `PhotosPicker`, and it hits the same `/api/scan` endpoint.

## Collection flow

1. `GET /api/collection` fills the store.
2. The stat strip shows owned cards, unique cards, and approximate value.
3. Category chips let you filter by the auto-categorized groups.
4. Each tile shows card art (photo if you have one, otherwise the Scryfall thumbnail), name, qty badge, categories, and edit/remove actions.

## What the first shell does **not** yet do

- Decks and Suggest views.
- Manual card lookup from the scan view (the lookup button is disabled in this MVP; it can be wired to `/api/cards/search` after the camera path is solid).
- Offline mode. This shell assumes the server is reachable on the LAN.

## Entitlements and app transport security

The entitlements file currently allows arbitrary loads so the LAN server is reachable during development. For a real App Store build you would tighten that: allow only the specific LAN origin you need, or move to HTTPS and a clear domain. The camera and photo-library usage descriptions are already in `Info.plist`.

## App Store notes

To ship this as a native App Store app you would:

1. Add the remaining views and clean up the UI/UX for the App Store review.
2. Sign the app with an Apple Developer team and set a proper bundle ID.
3. Disable arbitrary-loads and use HTTPS / a real endpoint if the server is public, or keep the LAN-only model and make the server-config behavior defensible for review.
4. Go through App Store Connect submission and review.

That is a later step. This shell is the buildable iOS client that makes the App Store path possible.
