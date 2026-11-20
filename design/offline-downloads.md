# Saving films to watch offline

reel saves a film or episodes on the device and plays them without the internet. macOS, Windows,
Linux, Android phones and tablets, iOS / iPadOS; not the Samsung TV and not Android TV
(`Library.supported()` is false there and no Save control shows). Saving runs while the app is
open; in the background it pauses and goes on when the app is open again (background saving:
later, and on iOS through a reel server, `docs/todo.md`). iOS builds are not for the App Store.

Words: **Save** and **Saved**, never "Download". Mockups: `concept/mac-saved.html`,
`mac-series-saved.html`, `mac-series-save.html`, `phone-film-saving.html`, `phone-saved.html`,
`phone-settings-storage.html` (styles in `concept/saved.css`).

## What the user gets

- **Save** between Play and Add to List. On a film it names what it takes ("Save · 700 MB") and
  saves the release the catalog picks at once (another release: from the release list); when
  that does not fit (see Fit) it does not start but asks: "Not enough space" / "Needs 25 GB,
  19 GB free on this device." with Cancel and the smaller release the core picks among those
  that fit ("Save 720p · 1.4 GB"; Play's release stays as it was), or "Other releases" when
  none fits. On a series it opens the **Save drawer** (a sheet on the phone): seasons as tabs
  ("5 of 12 on Mac"), "Whole season", episodes with checkboxes and sizes, the free space at the
  foot ("4.5 GB · 19 GB free"), and "Save 4 episodes"; ticked episodes that do not fit turn the
  line red ("Not enough space: needs 25 GB, 19 GB free") and Save off. While an episode's size
  is not known yet (the pack's files are still being read) the drawer does not judge.
- Reopened while saving, the drawer shows what is saved or saving checked and locked, with its
  state; the button counts only what is new. The drawer only adds; removing is on the Saved
  screen. While episodes of a season are saved, new ones come from the same release (a season
  pack gets more files selected, not a second torrent).
- The hero button shows the state: Save → "Saving 2 of 5" (a ring) → Saved.
- Episode rows: a round button (save · progress ring · white check).
- **Saved**: a round icon top right (on a tablet left of Settings; on a phone a tab), with a ring
  of the overall progress while something saves. Without a network at start the app opens on it
  when something is saved (`Library.opening`). The screen: space used and free, the folder (Change folder); "Saving" rows
  with Pause and Remove; "Ready to watch" cards; films on a disk that is not connected are grey.
- Library, Saved plays; the rest of the app says it is offline.
- Settings: where to save (desktops: any folder, the system dialog; Android: phone or SD card;
  iOS: no choice), space used, Remove all.
- Playing: the same Play and Resume, the same player (mpv, AVPlayer on iOS). A saved film plays
  from its file (`file://`), with no search, torrent or network; one being saved plays from the
  torrent that saves it.

Saving progress uses the player's "ready" tone (snow 45 %), not the watched one.

## Architecture

Neither streaming nor saving owns a torrent: a registry in the engine does, and they lease it.

```
engine/src/
  engine.rs    the session, jobs (streams): lease + ring cache; close() releases the lease
  keep.rs      saved items: lease + files in the user's folder; remove() releases and deletes
  (registry)   torrent id -> leases; deletes a torrent at the last release, its files only for the ring
```

- librqbit holds an infohash once and answers a second add with the handle it has
  (`AlreadyManaged`, `session.rs:1348`). Without leases closing the player would delete a
  film being saved.
- A torrent's storage is fixed when it is added. A torrent being saved is on files and a stream
  of it reads them, no ring. Save while the same torrent streams on the ring waits for the
  stream to close.
- Port `Keep` beside `Playback` (`domain/src/ports.rs`): a remote engine keeps films on the
  server. Implementations: reel-engine and `NoKeep` (no engine, TVs). Module `Offline` for the UI;
  every number and word choice comes ready in its JSON.
- `open(key)` looks for a saved file before `check_space()`, so a full disk still plays what is
  saved.

## Engine

- **Files**: librqbit's filesystem storage, `only_files` = the video (`episode::pick`) and the
  subtitle files beside it, in `<folder>/<Title (year)>/`. librqbit creates every file of the
  torrent (sparse) and edge pieces write into neighbours: the unselected files are deleted when
  the item is complete.
- **Library**: `<dataDir>/saved/library.json` (write temp, fsync, rename): id, catalog key,
  title, infohash, the .torrent file, file indexes, the folder, sizes, state, `next_id`. The
  source link is never stored (Jackett links carry the API key): only the infohash and the
  .torrent bytes (`torrent_bytes`, rebuilt for magnets). A manifest `.reel-saved.json` in each
  folder holds the same, so the library is rebuilt after a crash or a move.
- **Folder**: default `<dataDir>/saved`, on Windows `%LOCALAPPDATA%` (NSH's `dataDir` there is the
  roaming `%APPDATA%`). Changing it moves nothing: old items stay, new ones go there. A missing
  folder (disk unplugged) makes its items `unavailable`, not removed.
- **Restart**: unfinished items are added again from their .torrent, with the bitfield of verified
  pieces stored beside it (`<hash>.bitv`, librqbit's `fastresume_folder`, no session
  persistence), so they go on without hashing the files again. A bitfield the files do not hold
  (a file missing or short, a sampled piece that fails) means a full check.
- **With streaming**: while a stream plays, saving is paused except the torrent the stream reads.
- **Space**: measured on the folder's volume: what is left of every active item plus a reserve. A
  write error is `waiting_space`, not `failed`.
- **Sharing**: while saving, as when streaming. Complete: removed from the session with the files
  kept (`delete(id, false)`).

## Application

- The release to save: the one Play uses (iOS: MP4/MOV; the user's pick wins), saved only when
  it fits the free space; else the viewer chooses the smaller one the core names (above). An
  episode from a season pack saves only its file.

## Fit

What Play (and so Save) picks by itself depends on the device (`domain/src/fit.rs`): the UI
reports its platform family once (`Settings.setFamily`), the core decides.

- **Phone and tablet**: up to 1080p (what the screen shows) and up to 5 GB per hour of runtime
  (about 11 Mbit/s): every 1080p WEB-DL (2–4 GB/h) and the usual BluRay encodes (3–5 GB/h) are in,
  a 1080p remux or an untouched disc (12–20 GB/h) and any 4K are out; a two-hour film is at most
  10 GB. Within that: the best that plays now, else the best that 10 or more share, and only
  then whatever plays now. A pack counts its share per episode; a runtime the catalog lacks counts
  as 120 min (film) or 45 (episode). Big releases stay in the release list to pick by hand.
- **TV and desktop**: no limits, as before (the best that plays now, else the most shared).
- **Free space**: an item starts only when its size, a fiftieth of it more (pieces at the edges of
  a file write into its neighbours, subtitles), what is left of every unfinished item, what is
  set aside for items whose torrent is not read yet, and a reserve of 1 GiB fit on the folder's
  volume. A size or a free space not known lets it start (the engine waits for space if the disk
  fills, `waiting_space`). Free space is the volume's available bytes (iOS: without purgeable
  space, so it may say less than Settings → Storage; `docs/todo.md`).
- Metadata within TMDB's 6 months (`cache.rs`): refreshed while online; older than that offline,
  the library's own title and year are shown.

## Stages

1. Leases in the engine instead of deleting in `close()`.
2. Saving in the engine: the `Keep` port, `keep.rs`, the library, restart, playing a saved file.
3. macOS end to end: the `Offline` module, Save, the drawer, Saved, the folder.
4. Windows and Linux. 5. Android (storage volumes, pause in the background). 6. iOS
   (`file://` in AVPlayer, MP4 ranking, screen on while saving).

Later: background saving, Wi-Fi only, remove after watching, moving saved films to another
folder, a speed limit instead of the pause while streaming, the bitfield patch.
