# CI

GitHub Actions run the same scripts a developer runs locally. Workflows only set up machines
and call `build/`.

```sh
build/install-nsh.sh          # nsh at the version app/Cargo.lock pins nsh-core to (0.5.0)
build/build.sh check          # cargo check + TypeScript
build/build.sh test           # cargo test + *.test.tsx headless (JUnit in app/.nsh/dist/test/)
build/build.sh macos          # or linux, windows, android, ios-simulator, ios, web, armv7
dev/ios-sim-smoke.sh iPad   # install + launch the simulator build on an iPad (or iPhone)
```

Packages land in `app/.nsh/dist/<target>/reel-*` (git-ignored); nsh's raw output is in `pkg/` next to them.
`REEL_VERSION` / `REEL_BUILD` override `nsh.json`'s version and build number.

## Workflows

- `ci.yml`: on push to main and on PRs. Runs `check` and `test` on macOS, then calls `build.yml`.
- `build.yml`: builds each platform and uploads it as an artifact:
  - macOS: `.app` zip
  - Linux: Ubuntu 24.04, GTK 4.14, `.tar.gz`
  - Windows: `.zip`, plus `-setup.exe` when Inno Setup is on the runner
  - Android: `.apk`
  - iOS simulator: one universal `.app`, launched on an iPhone and an iPad simulator
  - iOS device: `.ipa`, only with signing secrets
  - Web: the static site
  - Tizen core: armv7 `.so`
- `release.yml`: on a `v*` tag it runs `build.yml` with the tag as the version and `tizen.yml`,
  then `build/publish-release.sh --from` publishes the tag's GitHub Release under the names the
  site links to (`reel-macos.zip`, `reel-android.apk`, `reel-samsung-tv.wgt`, `reel-linux.tar.gz`,
  `reel-windows.zip`), each checked by `build/package-check.py`.

## Secrets

All secrets are optional. A build without them still works.

| Secret | Used for |
| --- | --- |
| `REEL_TMDB_TOKEN` | Baked in with `option_env!`. Without it the app asks the user for a key. |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD` | Release-signed APK. Without them the APK is signed with a debug key that changes on every CI run, so CI APKs cannot update each other. |
| `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD` | Signing certificate (.p12), imported into a temporary keychain. |
| `MACOS_SIGN_IDENTITY` | Developer ID Application identity for the macOS app. |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | Notarization of the macOS app. |
| `IOS_SIGN_IDENTITY`, `IOS_PROFILE_BASE64` | iOS device `.ipa`. The App Store will not accept a torrent client, so this is for sideloading or ad hoc builds. |

## iPhone and iPad

NSH's iOS packages are universal (`UIDeviceFamily` 1 and 2). `build/build.sh ios-simulator` fails if
that changes. In TSX, `platform.idiom` is `"pad"` on iPad and `"phone"` on iPhone. In Rust it is
`idiom()`. Use it to pick a density for iPad.

## Known gaps

- **Android and armv7 (OpenSSL).** librqbit's default features use `crypto-hash`, which links
  OpenSSL on Linux and Android. Linux and the armv7 job install OpenSSL. Android has nothing to link,
  so that job is `continue-on-error` for now. The fix belongs in `app/Cargo.toml`: build librqbit with
  `default-features = false` and `features = ["rust-tls", "http-api-client", "http-api",
  "tracing-subscriber-utils"]` (ring/aws-lc sha1, rustls). That removes OpenSSL everywhere.
- **Web.** The crate does not build for `wasm32-unknown-unknown`. tokio's `net` feature (librqbit,
  sockets) pulls in mio, which has no support for that target. The web job is `continue-on-error`. The
  Tizen plan (Rust core as a native `.so`, UI from the NSH web build in a WebView) needs a web build
  without the native crate, or the crate's modules behind `cfg(not(target_arch = "wasm32"))` with a
  bridge to the `.so`.
- **Tizen core (armv7).** It builds with `cargo rustc --crate-type cdylib`, so `app/Cargo.toml` needs
  no `[lib] crate-type`. It links against Debian bookworm's armel glibc, not the Tizen rootstrap, so it
  is only a toolchain smoke test and the job is `continue-on-error`. `.tpk` packaging (`build/build.sh
  tpk`, Tizen Studio CLI) is a TODO until `platforms/tizen` exists.
- **macOS** builds for the runner's architecture (arm64). Set `REEL_MACOS_ARCH=universal` for both.
