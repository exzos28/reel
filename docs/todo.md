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
