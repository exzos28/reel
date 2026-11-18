# reel

Source-available app (PolyForm Noncommercial 1.0.0: no commercial use; `LICENSE`, `NOTICE`) that streams films and series from torrents with a built-in engine. Targets:
Samsung Tizen TV (first), macOS, Android / Android TV, iOS / iPadOS, Windows, Linux. UI in NSH
(nsh.dev, TSX on QuickJS with native views); core in Rust (`app/src`, `app/domain`,
`app/engine`).

## Layout

The app in `app/` and `platforms/tizen/`, its build and release in `build/`, development tools in
`dev/`, packages in `out/` (ignored): `docs/structure.md`. Building: `docs/building.md`.

## Architecture rule: TS/TSX is UI only, everything else is Rust

- TS/TSX renders screens, handles focus, keys and pointer, animations, and words text with `t()`.
  Nothing else.
- Everything that is not UI lives in the Rust crate and is exposed through NSH `#[module]`s that
  return JSON: data and catalogs, decisions (which release plays, what is supported, what to show
  next), calculations (sizes, times, timelines), parsing, networking, persistence, the torrent
  engine, settings.
- Why: performance (QuickJS is an interpreter; Rust is native on every platform), one
  implementation of the logic for all platforms, and the same core can later run as a remote
  server behind the same API.
- If a screen needs a value that takes more than picking a translation key or a style, add it to
  the core's JSON instead of computing it in TS.
- NSH limits to know: `t!()` and `nsh_core::storage` do not work inside `#[module]` functions (they
  run off the UI thread), so all UI text is translated in TS, and the core persists to its own files
  in the data dir the UI passes once (`process.dataDir`). QuickJS has no `Intl.DisplayNames`.

## Product rules

- Streams only. No downloads feature, screen, shelf or button. The engine's data is a cache.
- reel ships no content sources: no tracker addresses, no tracker-specific modules, no public
  indexer instances, anywhere in the repo or its history. Releases come only from the search source
  the user enters in Settings (a Torznab endpoint: their own Jackett, Prowlarr, JacRed…).
  No "watch for free" wording, no screenshots of commercial films; demo imagery is public domain.
- Metadata: TMDB (project key at build time via `REEL_TMDB_TOKEN`, plus a user key), AniList and
  Jikan for anime, Fribb anime-lists for ID mapping. Only sources without a key or with a free key
  without a daily quota.
- UI language: English by default; translations in `app/locales/*.yml`.
- Filter out releases the current device cannot play (audio/video codecs, HDR formats, container)
  in the core, per platform profile.

## UI

- UI rules (design, TV focus, components, `PageFrame`) are in `app/ui/CLAUDE.md`; it loads when you
  touch a file there.

## Navigating the code

- Search content with `grep`/`rg` from a specific directory (`app/src`, `app/ui`, `docs`…); don't
  run `find` over the repo root: it walks ignored build dirs (`app/target`, `out`) and worktrees.
- `ast-grep` (`sg`) does structural search over Rust/TS/TSX; prefer it to regex for code-shape
  queries (calls, impls, JSX props).
- Core ↔ UI module map: `docs/modules.md` (generated; see its header for how to regenerate).

## Secrets

- Never commit keys or tokens. Local ones live in `.env` at the repo root (git-ignored; `.env.example` says what each is):
  `REEL_TMDB_TOKEN`, `REEL_TORZNAB_URL`, `REEL_TORZNAB_KEY`. Load with `set -a; . ../.env; set +a`
  from `app/`. Never print them.

## Build and test (from `app/`)

- `cargo test --workspace`, `cargo build --no-default-features`, `nsh check .`, `nsh test .` and
  `../dev/ui-rules.sh` must pass before every commit. The layers and crates (reel-domain, reel-engine, reel-app) are in
  `docs/architecture.md`.
- `nsh package . --target macos` (with `.env` loaded) for a demo build; `build/build.sh <target>`
  is what CI runs.
- Network tests are `#[ignore]` and run explicitly with `cargo test -- --ignored <name>`.
- Local search source for development: your own Torznab endpoint in `.env` (`.env.example`).

## Git

- Commit after every working step; keep main building.
- Stage only your own files (several agents work in this repo): never `git add -A`, `git add .` or
  `git commit -a`, and check `git diff --cached --stat` before committing.
- Tizen installs go through Apps2Samsung from GitHub Releases (`.tpk`), never the Samsung store.
