# To do

## Engine behind one interface: in the app or on a server

Cut the core at a `Playback` interface in Rust: search, open a release, status, timeline, close, check space, a torrent's file list, subtitles from a torrent. The catalog, settings and subtitles depend only on it, which also breaks today's catalog ↔ engine loop.

Two implementations of it:
- **Local:** the engine inside the app (librqbit), behind a cargo feature `engine`.
- **Remote:** the same JSON over HTTP to a reel server on a PC or NAS.

Why:
- Builds for iOS and the stores can ship without torrent code: the engine is the user's own server, like their Torznab source.
- A weak TV does not download itself.

Already there: on Tizen the core runs as a separate HTTP server (`platforms/tizen/core`).

Missing for it to run as a server:
- listen on the LAN when the user turns it on;
- pair the app with a code instead of the shell's token;
- give the stream URL with the server's address, not 127.0.0.1;
- make the UI's calls asynchronous: a call over the LAN takes 5–50 ms.

Not like Lampa's plugins (JS loaded by URL):
- NSH does not load modules by URL;
- logic in TS breaks the "logic in Rust" rule;
- iOS and Google Play forbid downloaded executable code.

Estimate: 1–2 weeks. Details: the research of 2026-11-14 (Lampa's plugins and TorrServer; reel's coupling between catalog, sources, engine and player).

Stage 1, done: the `Playback` port (`app/domain/src/ports.rs`), the engine in its own crate (`app/engine`, reel-engine) behind the feature `engine`, and `NoEngine` without it. The layers are in `docs/architecture.md`.

Stage 2, the remote `Playback`:
- `open(key)`: the engine asks `PlaybackHost::play_source` while the catalog still searches. A server has no catalog, so the app has to settle the release first and call `open_release`.
- The resume point for warm-up (`PlaybackHost::resume`) has to travel with `open_release`.
- `files_known` has to become something the app can poll, such as a revision.
- `Playback` is synchronous. A LAN call needs the UI's calls to be asynchronous first.
- `torrent_files` and `subtitle_files` return Rust types: they need JSON both ways (`SubFile` only serializes).
- The search source (Torznab) is in reel-engine today. Decide whether a remote setup searches on the server or in the app.
- `check_space` and `buffer_fits` would measure the server's disk, and the buffer setting would have to reach the server.
- The engine's state is process-wide: one engine per process.
## Keep films on iOS in the background through a reel server

iOS runs no app code in the background, so the phone cannot torrent there. What iOS does carry
in the background is HTTP: a background `URLSession` hands the transfer to the system
(`nsurlsessiond`), which goes on while the app is suspended or closed, waits for the network,
resumes after a break and wakes the app at the end (`handleEventsForBackgroundURLSession`).
Apps that upload or download in the background (Instagram's uploads) work this way.

So with a reel server (the remote engine above, on a PC or NAS):
- the server keeps the whole film (the offline design, `design/offline-downloads.md`);
- the phone fetches the finished file from `http://<server>/kept/<id>` with a background
  `URLSession`, into its own kept folder, and plays it offline as any kept film.

Needs: the remote engine (stage 2 above), a keep API on the server, the native background
session on iOS (Swift/ObjC beside NSH), the server reachable from where the phone is (home Wi-Fi
only at first). Webseeds (BEP 19) could go the same way, but releases from Torznab sources
rarely have them.

## Screenshots of every layout in CI

Run `dev/screens.sh` in a workflow (by hand, `workflow_dispatch`, or a PR label; not every push)
and keep `out/screens/` (the pictures and `index.html`) as an artifact, to look at every layout
of a change without building it.

- `ubuntu-latest`: Chrome and Node are there, its clang builds wasm (no Homebrew LLVM); the
  script takes Chrome from `CHROME` or finds `google-chrome`.
- `REEL_TMDB_TOKEN` from the secret, as `build.yml`; no search source (a title shows "Add a search
  source").
- 1× pixels past about 2560 pt wide: a 2× picture of an ultra-wide window is about 30 MP.
- The rule "no screenshots of commercial films": a public repo's artifacts are published, and
  TMDB's trending is commercial. In CI the core should send no picture URLs (grey stand-ins in
  their place: the layout still shows), or only free films' (a stand-in catalog). Locally
  `out/screens/` is never shared and keeps the real pictures.

## TV: a seek must not hold the app

On the TV, AVPlay's `seekTo` holds the page's thread until it has data at the target: 3–7 s on a stream still downloading (measured 2026-11-19). The shell and the NSH UI share that thread (`webapis.avplay` exists only on the page's main thread, and the TV's browser keeps the iframe in the same renderer), so the whole app stops: no keys, no Back, the loader frozen. If the pieces never come (no peers), it stops for good.

AVPlay cannot run on another thread in a web app. Only a native TV app (C#, `Tizen.Multimedia.Player`, the UI in a WebView) would move it, which rewrites the TV app.

Within the web app:
- **Done: the place first, then the seek** (every platform). The player's screen only asks `VideoSurface` to seek; the surface asks the core (`Engine.seek(job, seconds)`, async) and sends the seek to the view only once the place is on disk. The core reads the film's own index at the start (MKV Cues through the SeekHead, MP4's `moov`: `reel_domain::container`), so it knows where every player reads after a seek: from the keyframe at or before the target to the first keyframe 4 s past it. It pins those pieces in the buffer, fetches them first and answers `ready` (at once when they were in) or `replaced` (a newer seek, `close`); a film without an index (fragmented MP4, AVI) answers `unknown` and the view seeks as it is. No timeout: the viewer seeks again or goes Back.
- **Measured (2026-11-19, a 32 min MKV):** `seekTo` into a place on disk 0.7 s. The earlier guess in proportion to time missed AVPlay's reads by 40–80 MiB (the end credits at ~0.3 MB/s pull the average below the rest's ~0.88 MB/s); the index puts the place on them exactly (the local core, four seeks: each AVPlay read inside its place).
- **Done: MP4's index too** (`moov`: stts + ctts, edit lists, stss, stsc/stsz/stco|co64; the place from the lowest byte of any track at the keyframe's time). Fragmented MP4 and AVI: `unknown`.
- **Maybe later: a guard in the core.** A read of a piece that does not come could end the stream's response after a while. Careful: a 4K start legitimately waits 12 s and more for its first 8 MB, and a body cut short may look like the end of the file to AVPlay. In the engine, not in the librqbit patch.

Also seen on the TV:
- The UI calls the core's synchronous methods over a synchronous XHR (`app/ui/native-http.ts`): a slow answer stops the UI the same way (0.1–0.5 s for `Engine.status`, `Catalog.saveProgress`).
- The app's timers in NSH's realm frame fire about once a second (a 100 ms interval came every ~900 ms): the browser throttles that frame as hidden. Every delay in the UI rounds up to a second. To look at in NSH's web runtime.

## Anime episodes on trackers that number them their own way

rutracker's anime releases are named "[01-28 из 28]", "[TV] [1-12 из 12]" or "E28 of 28", not `S01E03`, and Jackett often passes them through unchanged. Two parts:
- **Search and parsing:** an episode asks by the title alone too (the other names already do since the multi-name search), and `release.rs` reads those ranges as episodes of season 1. See also PR #19 (season packs of an episode).
- **Long anime with absolute numbering** (One Piece's episode 1050 vs TMDB's S21E58): map S/E to the absolute number with the Fribb lists / AniList entries' episode counts. Harder; a step of its own.

## Releases of a whole show, anime numbering, extras

Survey and plan in `docs/release-names.md`. In short: whole-show packs (Supernatural 327, Game of Thrones 73) are never offered for seasons 2+, anime packs numbered through or with OP/ED/specials pick the wrong file, and a tracker's anime season can differ from TMDB's (Bleach TYBW). Steps there: leave extras out, read anime numbers, map S/E to the absolute number with TMDB's season sizes, let the files' season win over the title's.

## Free space on iOS

Save checks the free space with the volume's available bytes (statvfs), which on iOS leaves out
purgeable space: a phone may say "Not enough space" while Settings → Storage shows more. Use
`volumeAvailableCapacityForImportantUsageKey` there (design/offline-downloads.md, "Fit").
