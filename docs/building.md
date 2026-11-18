# Building reel

## What you need

- Rust (stable) and [NSH](https://nsh.dev): `build/install-nsh.sh` installs the version the app
  is pinned to.
- The platform's own tools: Xcode for macOS and iOS, the Android SDK for Android
  (`build/setup-android-sdk.sh`), Docker for Linux, Windows and the Samsung TV.
- A `.env` at the repository's root, from `.env.example`: everything in it is optional; a TMDB
  token makes the catalogue work out of the box.

## Run and test

```sh
cd app
set -a; . ../.env; set +a
nsh run                       # on this machine; --target ios, android, macos, linux, windows
../dev/run-mac.sh [--fresh]   # the Mac app as it ships (.env, libmpv); --fresh: as a new install
nsh check                     # types of the Rust crate and the TSX
nsh test                      # the core's and the UI's tests, headless
cargo test --workspace        # the core's crates
../dev/ui-rules.sh            # screens render content only
```

CI runs them on every PR before it merges (`.github/workflows/checks.yml`, `docs/ci.md`); locally
run what the change touches, or all of them with `dev/checks.sh`. The repo's pre-push hook runs only
the UI rules: enable it once per clone with `git config core.hooksPath .githooks`.

Screenshots of every layout, with no window on screen: `dev/screens.sh` (`--targets mac,phone`,
`--sizes`, `--screens`, `--jobs`; the matrix is `dev/screens/matrix.json`) shoots the web build in
headless Chrome against `reel-core` standing in for each device, several targets at a time, into
`out/screens/` with an `index.html` to look at them (all of it in about 2 minutes on a 12-core
Mac). It needs Google Chrome, Node and, on a Mac, Homebrew's LLVM.

## Packages

Every build writes its package to `out/<platform>/` at the repository's root.

```sh
build/build.sh macos          # out/macos/reel-macos-<arch>.zip
build/build.sh android        # out/android/reel-android-*.apk
build/build.sh ios            # signed .ipa (needs signing settings)
build/linux-docker.sh build   # out/linux/  (in Docker)
build/linux-docker.sh windows # out/windows/ (in Docker, cross-compiled)
build/tizen-docker.sh package # out/tizen/reel-tv-v<version>.wgt (in Docker)
```

Packages are reproducible archives without the build machine's paths or metadata;
`build/package-check.py` fails a package that carries them.

All of them, one after another: `build/build-all.sh` (or name the platforms).

## Release

Versions and the whole release: [releasing.md](releasing.md). In short, a release is a tag: bump
`version` and `build` in `app/nsh.json`, commit, then
`git tag v0.1.4 && git push origin v0.1.4`. CI (`.github/workflows/release.yml`) builds every
platform and the Samsung TV package and publishes them as the tag's release, under the names the
site links to. Without CI, the same from this machine:

```sh
build/publish-release.sh <version>   # the packages in out/ as a GitHub release of this repository
build/site-deploy.sh                 # the website on Fly.io
```

Installing on a Samsung TV: [tizen.md](tizen.md). CI: [ci.md](ci.md).
