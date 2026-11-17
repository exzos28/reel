#!/usr/bin/env bash
# Publishes the site (site/) with the packages it links to (downloads/) on Fly.io
# (site/deploy/fly.toml). Until the downloads move to GitHub Releases (docs/todo.md), the files
# are copied into the image.
#
# Usage: scripts/site-deploy.sh [--dry-run]
#
# Takes the newest package of each kind that scripts/build.sh (and hosts/tizen/build.sh) wrote,
# under the names the site links to:
#   reel-macos.zip        app/.nsh/dist/macos/reel-macos-*.zip
#   reel-android.apk      app/.nsh/dist/android/reel-android-*.apk
#   reel-tv.wgt           hosts/tizen/out/reel-tv-v*.wgt
#   reel-linux.tar.gz     app/.nsh/dist/linux/reel-linux-*.tar.gz, or dist-linux/
#   reel-windows-setup.exe app/.nsh/dist/windows/*-setup.exe, or dist-windows/
# A kind with no package is left out (its link answers 404) and named in the output. Every file
# goes through scripts/privacy-check.py first. --dry-run builds the context and stops there.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

log() { printf '==> %s\n' "$*" >&2; }
die() { printf 'site-deploy.sh: %s\n' "$*" >&2; exit 1; }

ctx="$(mktemp -d "${TMPDIR:-/tmp}/reel-site.XXXXXX")"
trap 'rm -rf "$ctx"' EXIT
mkdir -p "$ctx/www/downloads"
cp "$repo/site/deploy/Dockerfile" "$repo/site/deploy/nginx.conf" "$ctx/"
# The site itself (not its README, not the deploy files).
(cd "$repo/site" && find . -type f ! -path './deploy/*' ! -name README.md -exec cp --parents {} "$ctx/www/" \; 2> /dev/null) \
  || (cd "$repo/site" && rsync -a --exclude deploy --exclude README.md ./ "$ctx/www/")

# The newest file matching any of the globs, or nothing.
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
  log "$name <- ${f#"$repo"/}"
  cp "$f" "$ctx/www/downloads/$name"
}

take reel-macos.zip "$repo"/app/.nsh/dist/macos/reel-macos-*.zip
take reel-android.apk "$repo"/app/.nsh/dist/android/reel-android-*.apk
take reel-tv.wgt "$repo"/hosts/tizen/out/reel-tv-v*.wgt
take reel-linux.tar.gz "$repo"/app/.nsh/dist/linux/reel-linux-*.tar.gz "$repo"/dist-linux/reel-linux-*.tar.gz
take reel-windows-setup.exe "$repo"/app/.nsh/dist/windows/*-setup.exe "$repo"/dist-windows/*-setup.exe

python3 -I "$repo/scripts/privacy-check.py" "$ctx/www" || die "personal data in what would be published (above)"
(cd "$ctx/www/downloads" && shasum -a 256 -- * > SHA256SUMS.txt 2> /dev/null) || true

[ "${#missing[@]}" -eq 0 ] || log "no package for: ${missing[*]} (their links answer 404)"
du -sh "$ctx/www/downloads" >&2
if [ "$dry" = 1 ]; then
  ls -la "$ctx/www/downloads" >&2
  log "dry run: not deployed"
  exit 0
fi
command -v flyctl > /dev/null || die "flyctl not found"
flyctl deploy "$ctx" --config "$repo/site/deploy/fly.toml" --remote-only
