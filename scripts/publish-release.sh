#!/usr/bin/env bash
# Publishes the packages as a release of the public downloads repository (exzos28/reel-releases),
# where the site's download links point (releases/latest/download/<name>). The code stays here.
#
# Usage: scripts/publish-release.sh <version> [--dry-run]     e.g. 0.1.0
#
# Takes the newest package of each kind that scripts/build.sh (and hosts/tizen/build.sh) wrote,
# under the names the site links to:
#   reel-macos.zip         app/.nsh/dist/macos/reel-macos-*.zip
#   reel-android.apk       app/.nsh/dist/android/reel-android-*.apk
#   reel-tv.wgt            hosts/tizen/out/reel-tv-v*.wgt
#   reel-linux.tar.gz      app/.nsh/dist/linux/reel-linux-*.tar.gz, or dist-linux/
#   reel-windows-setup.exe app/.nsh/dist/windows/*-setup.exe, or dist-windows/
# Each goes through scripts/package-check.py; a kind with no package, or one that fails it, is
# left out and named. Needs gh, signed in with access to the repository.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
releases="${REEL_RELEASES_REPO:-exzos28/reel-releases}"
version="${1:?usage: $0 <version> [--dry-run]}"
version="${version#v}"
dry=0
[ "${2:-}" = "--dry-run" ] && dry=1

log() { printf '==> %s\n' "$*" >&2; }
die() { printf 'publish-release.sh: %s\n' "$*" >&2; exit 1; }

stage="$(mktemp -d "${TMPDIR:-/tmp}/reel-release.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

newest() {
  local f best=""
  for f in "$@"; do
    [ -f "$f" ] || continue
    if [ -z "$best" ] || [ "$f" -nt "$best" ]; then best="$f"; fi
  done
  printf '%s' "$best"
}

missing=()
take() {
  local name="$1"; shift
  local f; f="$(newest "$@")"
  if [ -z "$f" ]; then missing+=("$name"); return; fi
  if ! python3 -I "$repo/scripts/package-check.py" "$f"; then
    log "$name: ${f#"$repo"/} fails the package check; left out (build it again with scripts/build.sh)"
    missing+=("$name")
    return
  fi
  log "$name <- ${f#"$repo"/}"
  cp "$f" "$stage/$name"
}

take reel-macos.zip "$repo"/app/.nsh/dist/macos/reel-macos-*.zip
take reel-android.apk "$repo"/app/.nsh/dist/android/reel-android-*.apk
take reel-tv.wgt "$repo"/hosts/tizen/out/reel-tv-v*.wgt
take reel-linux.tar.gz "$repo"/app/.nsh/dist/linux/reel-linux-*.tar.gz "$repo"/dist-linux/reel-linux-*.tar.gz
take reel-windows-setup.exe "$repo"/app/.nsh/dist/windows/*-setup.exe "$repo"/dist-windows/*-setup.exe

ls "$stage"/* > /dev/null 2>&1 || die "no package to publish"
(cd "$stage" && shasum -a 256 -- * > SHA256SUMS.txt)
[ "${#missing[@]}" -eq 0 ] || log "not in this release: ${missing[*]}"
ls -la "$stage" >&2

notes="reel $version.

Packages built from the same sources, without the build machine's paths or metadata; their
checksums are in SHA256SUMS.txt. Not in this release: ${missing[*]:-nothing}."
if [ "$dry" = 1 ]; then
  log "dry run: v$version not published to $releases"
  exit 0
fi
command -v gh > /dev/null || die "gh not found"
gh release create "v$version" "$stage"/* --repo "$releases" --title "reel $version" --notes "$notes" --latest
log "published: https://github.com/$releases/releases/tag/v$version"
