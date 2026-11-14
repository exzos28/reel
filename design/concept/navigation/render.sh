#!/bin/sh
# Render the navigation mockups to PNG, one per frame, with headless Chrome.
# Usage: design/concept/navigation/render.sh <out-dir> [tv|desktop|tablet|phone ...]
# The PNGs are previews: keep them out of the repo (rasters in git need 1x/@2x/@3x).
# A frame is `<section class="frame" id="..." data-size="W,H" data-scale="N">`.
set -e
[ -n "$1" ] || { echo "usage: $0 <out-dir> [file ...]" >&2; exit 1; }
out=$(cd "$1" 2>/dev/null && pwd) || { mkdir -p "$1"; out=$(cd "$1" && pwd); }
shift
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# A fresh profile per run, so an edited nav.css is never served from the cache.
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT
files="$*"
[ -z "$files" ] && files="tv desktop tablet phone"
for f in $files; do
  grep -o '<section class="frame" id="[^"]*" data-size="[^"]*" data-scale="[^"]*"' "$f.html" |
    sed 's/.*id="\([^"]*\)" data-size="\([^"]*\)" data-scale="\([^"]*\)"/\1 \2 \3/' |
    while read -r id size scale; do
      "$CHROME" --headless=new --hide-scrollbars --disable-gpu --user-data-dir="$profile" --force-device-scale-factor="$scale" \
        --virtual-time-budget=6000 --window-size="$size" \
        --screenshot="$out/$f-$id.png" "file://$PWD/$f.html#$id" >/dev/null 2>&1
      echo "$out/$f-$id.png"
    done
done
