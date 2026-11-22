# Releasing reel

## Versions

- **`version`** in `app/nsh.json`, `MAJOR.MINOR.PATCH`:
  - PATCH: fixes only, nothing new for the viewer to learn (0.1.3 → 0.1.4);
  - MINOR: something new: a screen, a platform, a setting (0.1.4 → 0.2.0);
  - MAJOR: stays 0 until reel is called finished; then for changes that break what a viewer
    kept (settings, progress) or an older TV package.
- **`build`** in `app/nsh.json`: a whole number, one more on every release, never reused. Android
  installs a package over another only when its build is higher; Apple's builds want the same.
- **The only source of both is `app/nsh.json`.** CI never overrides them; every package and the
  TV's take them from there, and `build/changes.py` is what changes them.
- **The tag** is `v` + `version` (`v0.3.0`), made by the release on the commit that set it.

## Every PR: an entry in `.changes/`

A PR that changes what the viewer sees adds a file to `.changes/` with its bump and one line for
the viewer (`.changes/README.md`):

```md
---
bump: patch
---
Subtitles no longer stall on a slow connection.
```

The PR's `changeset` check fails when it changes the app (`app/`, `platforms/`, not only tests) and
adds none; label the PR `no-changeset` when the viewer sees no difference. Several PRs' entries
wait in `.changes/` until the next version.

## Branches

- `develop` (the default branch): every PR goes here and merges as soon as it is reviewed, without
  waiting for its checks; the run on `develop` after the merge says what broke, and it is fixed
  there.
- `main`: releases only. It changes through a version PR from `develop` (below), which must pass
  the checks; after the release, `release.yml` merges `main` back into `develop`.

## Releasing a version

1. See what is waiting: `build/changes.py status` (the entries and the version they make: the
   biggest bump wins).
2. Open the version PR: `build/release.sh` (`--dry-run` to only look). In a worktree of its own it
   bumps `version` and `build` in `app/nsh.json`, writes the version's section at the top of
   `CHANGELOG.md`, removes the entries, commits `Version 0.3.0` on `release/v0.3.0` (from
   `develop`) and opens the PR into `main`.
3. The version PR runs the checks and every platform build. Edit `CHANGELOG.md` on its branch if a
   line wants better words. When everything passes, merge it (`gh pr merge --merge`).
4. The merge changes `app/nsh.json` on main, which starts `.github/workflows/release.yml` (and at
   its end merges `main` back into `develop`): the
   checks once more, every platform and the Samsung TV package, each package checked
   (`build/package-check.py`), then the release `v0.3.0` on that commit, with the version's
   `CHANGELOG.md` section as its notes, under fixed names:

   | File | For |
   |---|---|
   | `reel-macos.zip` | macOS, Apple silicon and Intel |
   | `reel-android.apk` | Android phones, tablets and TVs |
   | `reel-samsung-tv.wgt` | Samsung TV (Tizen) |
   | `reel-linux.tar.gz` | Linux x86_64 |
   | `reel-windows.zip` | Windows x64 |
   | `reel-ios.ipa` | iPhone and iPad, unsigned: AltStore or SideStore signs it with the viewer's Apple ID |
   | `altstore.json` | The AltStore / SideStore source: lists this release's `reel-ios.ipa` (below) |

5. Nothing else to update: the website, the README, the Apps2Samsung catalog and the AltStore
   source point at `releases/latest/download/<file>`, so they serve the new release at once.

## iPhone and iPad: AltStore and SideStore

A viewer adds one source in AltStore (Classic: AltStore PAL, the EU's, installs only apps Apple
notarized) or SideStore (Sources, +), once:
`https://github.com/exzos28/reel/releases/latest/download/altstore.json`. Both fetch it
following GitHub's redirect to the latest release's file and keep the address they were given as
the source's identity, so it stays the same source from release to release; each release's
`altstore.json` lists that release's `reel-ios.ipa`, and AltStore offers it as an update when its
version or build is new. They install it signed with the viewer's own Apple ID (with a free one,
again every 7 days: AltStore through AltServer on a computer, SideStore on the device itself);
the releases carry no signature of ours.

`build/publish-release.sh` writes it with `build/altstore-source.py` from the `.ipa` it publishes:
what AltStore checks against the app (bundle id, version and build, the lowest iOS, entitlements,
the Info.plist's privacy texts) is read from the `.ipa`, the notes are the version's
`CHANGELOG.md` section, and only that version is listed. A release without the `.ipa` carries the
previous release's `altstore.json` over, so the source keeps working. To look at one:
`build/altstore-source.py out/ios/reel-ios-unsigned.ipa <version>`.

## Without CI

The same from a Mac with Docker (macOS, Android and iOS here, Linux, Windows and the TV in
Docker, side by side):

```sh
build/build-all.sh                 # every package into out/<target>/
build/publish-release.sh 0.3.0     # the release, from out/ (--dry-run shows what it would take)
```

Linux comes out for this machine's architecture (ARM64 on Apple silicon).

## Fixing a release

- A package missing or broken: run the release again (re-run the failed jobs, or `release` by hand
  from the Actions tab: it publishes main's version again), which replaces the release's files.
- A release that failed before publishing anything: fix it in a PR; the next version PR (or
  `release` by hand) publishes it.
- Never move a tag that was published: make the next PATCH version instead.

## Signing

- macOS: ad-hoc, no certificate (macOS asks to confirm the first start).
- Android: the release key from the repository's secrets (`ANDROID_KEYSTORE_*`, its owner `CN=reel`);
  on the maintainer's machine it and its password are in `.local/secrets/` (a link to a folder
  outside the repository) and `.env` points at them;
  without them a debug key, which differs on every CI run, so such APKs do not update each other.
- Samsung TV: the Tizen SDK's default certificate; Apps2Samsung signs it again for each TV.
- iPhone and iPad: unsigned; AltStore or SideStore signs it with the viewer's Apple ID.
