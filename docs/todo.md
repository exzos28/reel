# To do

## Engine behind one interface: in the app or on a server

Cut the core at a `Playback` interface in Rust: search, open a release, status, timeline, close, check space, a torrent's file list, subtitles from a torrent. The catalog, settings and subtitles depend only on it, which also breaks today's catalog ↔ engine loop.

Two implementations of it:
- **Local:** the engine inside the app (librqbit), behind a cargo feature `engine`.
- **Remote:** the same JSON over HTTP to a reel server on a PC or NAS.

Why:
- Builds for iOS and the stores can ship without torrent code: the engine is the user's own server, like their Torznab source.
- A weak TV does not download itself.

Already there: on Tizen the core runs as a separate HTTP server (`hosts/tizen/core`).

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
