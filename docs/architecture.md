# The Rust core's layers

Dependencies point one way: interface → application → ports + domain ← adapters.
`src/wiring.rs` is the only place that puts adapters behind the ports.

| Layer | Where | What |
|---|---|---|
| Domain | `domain/` (reel-domain) | Types and pure logic, no I/O: keys (`tmdb:tv:1399:s1e2`), release names, episodes in packs, player profiles (`compat`), subtitle files, cues and tracks, the scrubber's timeline, discover filters, search requests, redaction. |
| Ports | `domain/src/ports.rs` | `Playback` (search releases, check the source, open a release or a catalog key, status, timeline, first frame, close, space and buffer, a torrent's files, prefetch, subtitles), `PlaybackHost` (what the engine asks the app back), `Metadata` (TMDB, AniList, Jikan behind the cache). |
| Adapters | `engine/` (reel-engine), `src/adapters/` | reel-engine implements `Playback`: librqbit, the ring-buffer cache, the Torznab source, subtitles from the torrent. `adapters/metadata` implements `Metadata` (its providers sit behind `Provider` and `TitleSource`). `adapters/no_engine` is `Playback` without the engine. `adapters/mpv` is the video view on every platform but the TV; `adapters/awake` keeps the desktops' screen on while a film plays. |
| Application | `src/application/` | The catalog (what shows, which release plays), settings, watch progress, the tracks panel. It reaches the ports through `wiring::playback()` and `wiring::metadata()`. It never names an adapter. |
| Interface | `src/lib.rs`, `src/interface/` | The NSH `#[module]`s (JSON in and out), the hosted settings page and the TV's card pictures (`/img`), which `platforms/tizen` serves over HTTP (on Android TV the app serves the settings page itself, `hosted/lan.rs`). |

## The engine feature

reel-app takes reel-engine behind the cargo feature `engine` (on by default). Built with
`--no-default-features`, `wiring::playback()` is `NoEngine`. Every `Playback` call then answers in
the shape the UI already reads for a failure, with the message "no engine on this device".
reel-domain and reel-engine are native only, as everything but `Fmt` is (wasm32, docs/tizen.md).

## Rules

- A new boundary is a trait in `domain/src/ports.rs`, implemented by an adapter and chosen in
  `wiring.rs`.
- The engine knows no catalog key's meaning. It asks `PlaybackHost`: which release a key plays,
  where the viewer stopped, and it tells it when a torrent's files are known.
- JSON shapes and module and method names are the UI's contract (`platforms/tizen/core/src/table.rs`
  checks the names).
- `docs/modules.md` maps every module and method to its JSON and its callers in the UI, generated
  and checked by `tests/modules_map.rs` (`UPDATE_MODULES_MAP=1 cargo test -p reel-app --test modules_map`).

## Tests

From `app/`: `cargo test --workspace` covers all three crates. `nsh test .` runs reel-app's tests.
`cargo build --no-default-features` checks the build without the engine.
