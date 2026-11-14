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

## Review the security of the settings page on the TV

The settings page the TV serves on the local network (`http://<TV>:47392/settings`, opened by
the QR code in Settings) works without pairing for now: anyone on the same network who opens it
can change the search source, the language and the buffer. The pairing with a code on the
screen is built and tested (`app/src/hosted/pairing.rs`, docs/hosted-settings.md) but off
(`PAIRING_REQUIRED` in `app/src/hosted/mod.rs`). To decide: turn pairing back on (or a one-time
key in the QR code, so scanning still pairs without typing), plain HTTP on the LAN, and `/logs`
on the same port, which is open without any check.

## Decide how open the code is

The repository is private; the licence is PolyForm Noncommercial (`LICENSE`). To decide: whether
and when to make the code public, under which terms, and what the site says about it (its
"Open code, no accounts" section and the links to GitHub are hidden until then).
