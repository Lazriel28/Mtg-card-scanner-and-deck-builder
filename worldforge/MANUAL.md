# WorldForge — Field Manual

*Version 1.3 · September 22, 2026 · updated with every new feature*

WorldForge is your offline worldbuilding studio. It reads your Obsidian vault
directly from disk — nothing is copied, nothing is uploaded, and Obsidian keeps
working exactly as before. Two doors, one house.

---

## 1. Color code — what the spheres mean

Every note in your vault becomes a **sphere** in the 3D world. Color tells you
**what kind of thing** it is; size tells you **how connected** it is.

| Category | Type | Meaning |
|---|---|---|
| <span class="cat" style="color:#e5484d">Character</span> | red | People: heroes, villains, nobles, NPCs |
| <span class="cat" style="color:#46a758">Location</span> | green | Places: towns, rooms, regions, streets |
| <span class="cat" style="color:#f5a623">Item</span> | amber | Things: weapons, vehicles, artifacts, ships |
| <span class="cat" style="color:#3b82f6">Lore</span> | blue | Knowledge: history, magic systems, factions, religions |
| <span class="cat" style="color:#8b949e">Untyped</span> | gray | A note without a `type` yet — type it from the ＋ Note bar or M2's Cards view |
| <span class="cat" style="color:#c678dd">Custom</span> | generated | Any other `type:` value you invent (beast, artifact…) gets its own stable hue |

**How the app decides the type (automatic!):**
1. An explicit `type:` in the note's frontmatter always wins.
2. No `type:`? It guesses from the folder name — a note in `Characters/`
   becomes red, `Locations/` green, `Items/` amber, `Lore/` blue. Imported
   notes categorize themselves this way too.
3. Otherwise: untyped gray.
Case doesn't matter (`character`, `CHARACTER` all work). Unknown values are
kept as their own color — you're free to invent types like `artifact` or
`beast`.

**Size:** bigger sphere = more links to/from it. Hub notes (like your index)
naturally grow large. Sphere thickness is the pulse of your world's social
web — the biggest spheres are your load-bearing lore.

---

## 2. Getting around the world

| Action | Control |
|---|---|
| Rotate around the world | **Left-drag** anywhere on empty space |
| Zoom in / out | **Mouse wheel** |
| Slide the camera sideways (pan) | **Right-drag** |
| Inspect a note without opening it | **Hover** the sphere — a preview card appears with the note's name, type, folder, and a text snippet |
| Open a note | **Click** the sphere — the note panel slides out on the right |
| **Right-click a sphere** | Full menu: open, edit, copy `[[wikilink]]`, reveal in folder, **set type** (recolors instantly), delete (moves to `.trash`, recoverable) |
| **Right-click empty space** | Rebuild graph, reset view, import notes, choose vault |
| **Right-click a link in a note** | Open it, copy it, or — if it's a broken link — **create the missing note** right there |
| Find something fast | **Search box** (top-left) — matching notes stay bright, everything else fades to ghosts. **Enter** flies the camera to frame the matches |

Small but important: a click only counts as a click — if you dragged to rotate,
release won't accidentally open a note.

---

## 3. Graph settings — tune the world (⚙)

The **⚙** button in the top bar opens graph settings. Everything there is saved and restored next launch.

### Sliders

- **Node size** scales every sphere, live, without disturbing the layout — good for making a dense vault readable.
- **Link distance** sets how far linked notes sit from each other (the spring rest length). Higher = airier graph.
- **Repel force** is how strongly nodes push each other apart. Higher = more spread; lower = tighter clusters.

The last two re-run the layout when you release the slider (your camera view is kept).

### Visibility filters

The colored chips switch whole categories on/off:

- **Character** (red), **Location** (green), **Item** (amber), **Lore** (blue), **Untyped** (gray)
- **Orphans** — notes with no links. Hide them to see only the connected story.

Hiding a category also hides any link touching a hidden node, and hidden nodes can't be hovered or clicked. Your search and filters combine: with `Item` hidden, searching still only highlights what's visible. Everything you set is remembered.

## 4. The note panel

Clicking a sphere opens the note panel (right side):

- **Reading:** your markdown, rendered — `[[wikilinks]]` are blue and
  clickable (they open right in the panel), `#tags` render as chips, tables,
  quotes, and code blocks all keep their shape.
- **Backlinks & links out** sit at the bottom — this is how you notice that
  your harbor town secretly connects to everything.
- **Link suggestions:** the moment you type `[[` in the editor, a menu of
  matching note titles appears — keep typing to filter, **↑/↓** to move,
  **Enter** or **Tab** to insert (the closing `]]` is added for you), **Esc**
  to dismiss. If you typed `[[Title|` it keeps your alias and closes the link.
- **Creating links:** type `[[Note Name]]` anywhere in a note — that's it. The
  moment the target note exists, the link turns blue and clickable, and the
  other note gets a **backlink** pointing back at you (shown at the bottom of
  its panel). Aliases work too: `[[Vengeance - Spectre|the smart truck]]`
  displays as *the smart truck* but still links correctly. Link to a note that
  doesn't exist yet and it shows red/dashed — hover it for the intended title;
  write the note later (even from the ＋ Note button) and the link heals on its
  own. These are the same `[[wikilinks]]` Obsidian uses, so your links work in
  both apps.
- **Editing:** press **Edit** (or just start typing after clicking into the
  raw text), then **Save** with the button or **Ctrl+S**. The graph quietly
  rebuilds a moment later.
- **Esc** closes the panel.

---

## 5. Safety — your notes are protected

- Every save **backs up the previous version first**, into
  `<your vault>/.worldforge/backups/` (last 50 versions per note kept).
- Scanning is read-only and skips `.obsidian`, `.git`, `.trash`, and hidden
  folders — your Obsidian settings are never touched.
- Your vault folder is the single source of truth. Delete WorldForge and
  you've lost nothing; everything you wrote is ordinary `.md` files.

---

## 6. Bringing notes in (📥 Import)

The **📥 Import** button (next to ＋ Note) copies notes from any folder on your
PC straight into your vault:

1. Click 📥 Import and choose a folder — your Obsidian vault, a download
   folder, an old backup, anything containing `.md` files.
2. Everything lands in an **`imports/`** folder inside your vault, with
   subfolder structure preserved, and appears in the graph immediately.
3. Nothing is ever overwritten — an incoming file with the same name as an
   existing one gets a numbered suffix (`Note 2.md`). Hidden/config folders
   (`.obsidian`, `.git`, …) are skipped.

The importer refuses to run when the chosen folder is the vault itself —
otherwise you'd duplicate everything.

## 7. Starting the app

- **`Start WorldForge.bat`** — opens the app; the black cmd window now closes
  by itself (nothing to close manually).
- **`Start WorldForge (windowless).vbs`** — same app with zero window flash.
  Pin either to your taskbar; after the one-time `npm install` no terminal is
  ever needed.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Nodes look clickable but nothing opens | You're on an old build — relaunch the app (fix shipped 2026-09-22) |
| "No vault — click 📂" | Click the folder button and choose your vault folder; it's remembered next time |
| A note is missing from the graph | It must be a `.md` file inside the vault folder (or a subfolder) |
| Graph feels cramped | Zoom out with the wheel; layout spreads as you add linked notes |
| I edited in Obsidian and the graph is stale | WorldForge rescans when you save in-app; after external edits, just re-save any note in-app or reopen WorldForge to refresh |

---

## 9. On the roadmap

Greyed-out rail buttons are promised, not dead:

1. **M2 — Cards 🃏** set a note's type in one click from the app (writes the
   frontmatter for you); a gallery of your Characters / Locations / Items / Lore.
2. **M3 — Maps 🗺️** drop pins on your hand-drawn or photo maps; pins link to
   notes; stored in the vault so they travel with it.
3. **M4 — Publish 📖** one-click export of a real wiki website (notes, tags,
   3D graph as a web page) — hostable free on GitHub Pages / Netlify /
   Cloudflare Pages. The free answer to paid wiki hosting.
4. **M5 — Book studio** arrange notes into chapters; export a typeset book:
   HTML, print-ready PDF, and **EPUB** for Kindle / Apple Books.
5. **M6 — Cinema 🎬** your book as a 3D cutscene: camera flies through the
   world, chapter text plays as subtitles — with pause, speed, fast-forward,
   scrub, and free camera control. Plus **Sim-to-Scene**: pose objects in the
   3D scene and the app writes the prose for you. Record with Win+Alt+R for
   an instant mp4.

*This manual lives at `worldforge/MANUAL.md` and is rendered into the app's ❓
help view. It is updated whenever features ship — check its version line.*
