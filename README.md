# reel

Pick a film, it plays in seconds. reel streams films and series from torrents with an engine of
its own: it fetches the start of a film first and keeps only a window of it around where you
watch, so nothing has to download before it plays and a TV's small disk is enough.

Samsung TV (Tizen), Android and Android TV, macOS, Windows, Linux; iPhone and iPad are coming.

**Website and downloads:** [reel-site.fly.dev](https://reel-site.fly.dev) ·
[releases](https://github.com/exzos28/reel-releases/releases/latest)

## How it works

- **Browse.** Films, series and anime with their pictures, ratings and episodes, from TMDB,
  AniList and Jikan.
- **Your search source.** reel searches releases on a Torznab source you enter (your own
  Jackett, Prowlarr or any Torznab endpoint), on first start or in Settings, from the TV or from
  a phone by scanning a QR code. reel comes with no source and no tracker of its own.
- **Play.** It picks the release that starts fastest on your device and plays it with mpv: every
  container and codec, audio and subtitle tracks, subtitles from the release.
- **Your data stays on the device.** No accounts, no analytics.

## Repository

```
app/              the app: UI (TSX on NSH), core (Rust: domain, engine, app), Android views, texts
platforms/tizen/  the Samsung TV app around it: shell, .NET service, the core as a library
build/            how it is built and shipped: build.sh, tizen.sh, Docker images, release
dev/              tools for development
site/             the website
design/, docs/    design and documentation
vendor/           librqbit with reel's patches
out/              (ignored) the packages a build makes, out/<target>/
```

## Building

You need Rust, [NSH](https://nsh.dev) (`build/install-nsh.sh` installs the version the app is
pinned to) and the platform's own tools. Copy `.env.example` to `.env` and fill in what you need
(a TMDB token makes the catalogue work out of the box).

```sh
cd app
nsh run                                  # run it on this machine
nsh check && nsh test && cargo test --workspace
../build/build.sh macos                  # or android, linux, windows, ios: out/<target>/
../build/linux-docker.sh windows         # Linux and Windows packages in Docker
../build/tizen-docker.sh package         # the Samsung TV package in Docker
```

The architecture (TSX is UI only, everything else is Rust) and the conventions are in
[CLAUDE.md](CLAUDE.md) and [app/ARCHITECTURE.md](app/ARCHITECTURE.md); installing on a Samsung TV
is in [docs/tizen.md](docs/tizen.md).

## Licence

reel is under the [PolyForm Noncommercial License 1.0.0](LICENSE): use it, change it and share it
for any noncommercial purpose; commercial use is not allowed. Third-party code keeps its own
licence ([NOTICE](NOTICE)): librqbit (Apache 2.0), and libmpv with FFmpeg, built without GPL
parts, under the LGPL 2.1 ([reel-libmpv](https://github.com/exzos28/reel-libmpv)).
