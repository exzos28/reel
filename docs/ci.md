# CI

GitHub Actions run the same scripts a developer runs locally. Workflows only set up machines
and call `build/`.

```sh
build/install-nsh.sh          # nsh at the version app/Cargo.lock pins nsh-core to (0.5.1)
build/build.sh ui-rules       # what screens must not do (seconds)
build/build.sh test-crates    # cargo test of reel-domain and reel-engine (no nsh, no GTK)
build/build.sh typecheck      # nsh check: cargo check of app/ + TypeScript
build/build.sh no-engine      # app/ without the torrent engine
build/build.sh test-app       # nsh test: cargo test of app/ + *.test.tsx headless (JUnit in app/.nsh/dist/test/)
build/build.sh check          # typecheck + no-engine
build/build.sh test           # test-crates + test-app
build/build.sh macos          # or linux, windows, android, ios-simulator, ios, web
dev/ios-sim-smoke.sh iPad   # install + launch the simulator build on an iPad (or iPhone)
```

Packages land in `app/.nsh/dist/<target>/reel-*` (git-ignored); nsh's raw output is in `pkg/` next to them.
The version and build come from `app/nsh.json` only (`docs/releasing.md`). `REEL_VERSION` /
`REEL_BUILD` override them for a local test build; CI never sets them.

## Workflows

- `ci.yml`: on PRs and on main. Calls `checks.yml`, which main's branch protection requires before
  a PR merges (PRs merge themselves with `gh pr merge --auto --merge`). The platform builds
  (`build.yml` and `tizen.yml`) run only on a PR with the `build` label, on a version PR (branch
  `release/*`) and by hand (`workflow_dispatch`, input `build`). A newer push to a PR cancels its
  older run; on main every commit keeps its run.
- `checks.yml`: `ui-rules`, `changeset` (a PR that changes the app adds an entry to `.changes/`,
  `build/changes.py check`; the `no-changeset` label skips it) and `test-crates` on Ubuntu, and one macOS job `app` with the steps
  `typecheck`, `no-engine` and `test-app` (one build of reel-app and one Cargo cache; a failed step
  does not skip the next). Nothing of it has to run locally before a push: the pre-push hook
  (`.githooks/pre-push`) runs only `dev/ui-rules.sh`; `dev/checks.sh` runs every check here.
- `build.yml`: builds each platform and uploads it as an artifact:
  - macOS: `.app` zip
  - Linux: Ubuntu 24.04, GTK 4.14, `.tar.gz`
  - Windows: `.zip`, plus `-setup.exe` when Inno Setup is on the runner
  - Android: `.apk`
  - iOS simulator: one universal `.app`, launched on an iPhone and an iPad simulator
  - iOS device: `.ipa`, only when the repository variable `REEL_IOS_DEVICE` is `true` and the
    signing secrets exist
  - Web: the static site
- `tizen.yml`: the Samsung TV package (`.wgt`); by hand, from `ci.yml` and from `release.yml`.
- `release.yml`: when main's `app/nsh.json` gets a version that has no release yet (a merged
  version PR, `build/release.sh`), or by hand: `checks.yml`, `build.yml` (`release: true`, a
  universal macOS app) and `tizen.yml`; when all pass, `build/publish-release.sh --from`
  publishes the release `v<version>` on that commit, its notes from `CHANGELOG.md`, under the names
  the site links to (`reel-macos.zip`, `reel-android.apk`, `reel-samsung-tv.wgt`,
  `reel-linux.tar.gz`, `reel-windows.zip`), each checked by `build/package-check.py`.

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

- **macOS** builds for the runner's architecture (arm64). Set `REEL_MACOS_ARCH=universal` for both.
