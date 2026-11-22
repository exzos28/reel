#!/usr/bin/env bash
# Publishes the packages as a release of this repository (exzos28/reel),
# where the site's download links point (releases/latest/download/<name>). The code stays here.
#
# Usage: build/publish-release.sh <version> [--dry-run] [--from <dir>]     e.g. 0.1.0
#
# Takes the newest package of each kind that build/build.sh (and build/tizen.sh) wrote, from out/
# (or from anywhere under <dir>: CI's downloaded artifacts, .github/workflows/release.yml), under
# the names the site links to:
#   reel-macos.zip         out/macos/reel-macos-*.zip
#   reel-android.apk       out/android/reel-android-*.apk
#   reel-samsung-tv.wgt            out/tizen/reel-tv-v*.wgt
#   reel-linux.tar.gz      out/linux/reel-linux-*.tar.gz
#   reel-windows.zip       out/windows/reel-windows-*.zip
#                          (build/linux-docker.sh windows)
#   reel-ios.ipa           out/ios/reel-ios-unsigned.ipa (never a signed one: AltStore and
#                          SideStore sign it with the viewer's Apple ID)
# Each goes through build/package-check.py; a kind with no package, or one that fails it, is
# left out and named. Beside the .ipa, altstore.json: the AltStore / SideStore source that lists
# it (build/altstore-source.py), which viewers add as releases/latest/download/altstore.json; a
# release without the .ipa carries the latest release's source over, so that address keeps
# working. The notes are the version's CHANGELOG.md section (build/changes.py notes).
# REEL_RELEASE_TARGET: the commit a new tag goes on (CI: the release's commit; default: gh's,
# the default branch). Needs gh, signed in with access to the repository.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
releases="${REEL_RELEASES_REPO:-exzos28/reel}"
version="${1:?usage: $0 <version> [--dry-run] [--from <dir>]}"
version="${version#v}"
shift
dry=0
from=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --from) from="${2:?--from needs a directory}"; shift ;;
    *) printf 'publish-release.sh: unknown option %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

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
  # The project's own repository is no one's personal data (build/build.sh's package_check).
  if ! python3 -I "$repo/build/package-check.py" --allow "github.com/exzos28/reel" "$f"; then
    log "$name: ${f#"$repo"/} fails the package check; left out (build it again with build/build.sh)"
    missing+=("$name")
    return
  fi
  log "$name <- ${f#"$repo"/}"
  cp "$f" "$stage/$name"
}

# The files of a kind: out/<target>/ here, anywhere under --from's directory in CI.
of() {
  local target="$1" pattern="$2"
  if [ -n "$from" ]; then
    find "$from" -type f -name "$pattern" -print0 | xargs -0 -n1 printf '%s\n'
  else
    printf '%s\n' "$repo"/out/"$target"/$pattern
  fi
}
files() {
  local list=() f
  while IFS= read -r f; do [ -n "$f" ] && list+=("$f"); done < <(of "$2" "$3")
  take "$1" ${list[@]+"${list[@]}"}
}

files reel-macos.zip macos 'reel-macos-*.zip'
files reel-android.apk android 'reel-android-*.apk'
files reel-samsung-tv.wgt tizen 'reel-tv-v*.wgt'
files reel-linux.tar.gz linux 'reel-linux-*.tar.gz'
files reel-windows.zip windows 'reel-windows-*.zip'
files reel-ios.ipa ios 'reel-ios-unsigned.ipa'

ls "$stage"/* > /dev/null 2>&1 || die "no package to publish"
if [ -f "$stage/reel-ios.ipa" ]; then
  python3 -I "$repo/build/altstore-source.py" "$stage/reel-ios.ipa" "$version" --repo "$releases" -o "$stage/altstore.json" \
    || die "could not write altstore.json for reel-ios.ipa"
  log "altstore.json <- reel-ios.ipa"
elif [ "$dry" = 0 ] && gh release download --repo "$releases" --pattern altstore.json --dir "$stage" 2> /dev/null; then
  log "altstore.json: no iOS package; the latest release's source carried over (it lists that release's .ipa)"
else
  log "altstore.json: no iOS package and no earlier source; releases/latest/download/altstore.json will not be found"
fi
(cd "$stage" && shasum -a 256 -- * > SHA256SUMS.txt)
[ "${#missing[@]}" -eq 0 ] || log "not in this release: ${missing[*]}"
ls -la "$stage" >&2

changes="$(python3 -I "$repo/build/changes.py" notes "$version")" || die "no CHANGELOG.md section for $version"
notes="$changes

Packages built from the same sources, without the build machine's paths or metadata; their
checksums are in SHA256SUMS.txt. Not in this release: ${missing[*]:-nothing}."
printf '%s\n' "$notes" >&2
if [ "$dry" = 1 ]; then
  log "dry run: v$version not published to $releases"
  exit 0
fi
command -v gh > /dev/null || die "gh not found"
# The release first, then its files one by one with a few tries each: a large upload can time
# out (HTTP 408), and gh drops the whole release when one fails during create.
# A re-run (CI's) finds the release there and only replaces its files.
gh release view "v$version" --repo "$releases" > /dev/null 2>&1 \
  || gh release create "v$version" --repo "$releases" --title "reel $version" --notes "$notes" --latest \
       ${REEL_RELEASE_TARGET:+--target "$REEL_RELEASE_TARGET"}
for f in "$stage"/*; do
  for try in 1 2 3; do
    gh release upload "v$version" "$f" --repo "$releases" --clobber && break
    [ "$try" = 3 ] && die "could not upload $(basename "$f")"
    log "retrying $(basename "$f")"
    sleep 5
  done
done
log "published: https://github.com/$releases/releases/tag/v$version"
