# Releasing reel

## Versions

- **`version`** in `app/nsh.json`, `MAJOR.MINOR.PATCH`:
  - PATCH: fixes only, nothing new for the viewer to learn (0.1.3 → 0.1.4);
  - MINOR: something new: a screen, a platform, a setting (0.1.4 → 0.2.0);
  - MAJOR: stays 0 until reel is called finished; then for changes that break what a viewer
    kept (settings, progress) or an older TV package.
- **`build`** in `app/nsh.json`: a whole number, one more on every release, never reused. Android
  installs a package over another only when its build is higher; Apple's builds want the same.
- **The tag** is `v` + `version` (`v0.1.4`). The TV package takes its version from `nsh.json`, so
  the two must match.

## Steps

1. Everything for the release is on `main` and its checks pass (`dev/checks.sh`, which the
   pre-push hook runs).
2. Bump `version` and `build` in `app/nsh.json`; commit: `Version 0.1.4`.
3. Tag and push the tag:
   ```sh
   git tag v0.1.4 && git push origin main v0.1.4
   ```
4. CI (`.github/workflows/release.yml`) builds every platform and the Samsung TV package, checks
   each package (`build/package-check.py`: no build machine paths, owners or file metadata) and
   publishes the tag's release under fixed names:

   | File | For |
   |---|---|
   | `reel-macos.zip` | macOS, Apple silicon and Intel |
   | `reel-android.apk` | Android phones, tablets and TVs |
   | `reel-samsung-tv.wgt` | Samsung TV (Tizen) |
   | `reel-linux.tar.gz` | Linux x86_64 |
   | `reel-windows.zip` | Windows x64 |

5. Nothing else to update: the website, the README and the Apps2Samsung catalog point at
   `releases/latest/download/<file>`, so they serve the new release at once.

## Without CI

The same from a Mac with Docker (about ten minutes: macOS and Android here, Linux, Windows and the
TV in Docker, side by side):

```sh
build/build-all.sh                 # every package into out/<target>/
build/publish-release.sh 0.1.4     # the release, from out/ (--dry-run shows what it would take)
```

Linux comes out for this machine's architecture (ARM64 on Apple silicon).

## Fixing a release

- A package missing or broken: run the release again (re-running the workflow, or
  `publish-release.sh` with the same version), which replaces the release's files.
- Never move a tag that was published: make the next PATCH version instead.

## Signing

- macOS: ad-hoc, no certificate (macOS asks to confirm the first start).
- Android: the release key from the repository's secrets (`ANDROID_KEYSTORE_*`, its owner `CN=reel`);
  on the maintainer's machine it and its password are in `.local/secrets/` (a link to a folder
  outside the repository) and `.env` points at them;
  without them a debug key, which differs on every CI run, so such APKs do not update each other.
- Samsung TV: the Tizen SDK's default certificate; Apps2Samsung signs it again for each TV.
