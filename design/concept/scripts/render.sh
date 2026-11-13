#!/bin/sh
# Render concept mockups to PNG with headless Chrome.
# Usage: design/concept/scripts/render.sh [name ...]   (default: all)
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
size() {
  case "$1" in
    tv-*) echo 1920,1080 ;;
    phone-*) echo 390,844 ;;
    mac-*) echo 1440,900 ;;
  esac
}
names="$*"
[ -z "$names" ] && names="tv-home tv-film tv-player phone-home mac-home"
mkdir -p png
for n in $names; do
  [ -f "$n.html" ] || { echo "skip $n (no html)"; continue; }
  scale=1; case "$n" in phone-*) scale=2 ;; esac
  "$CHROME" --headless=new --hide-scrollbars --disable-gpu --force-device-scale-factor=$scale \
    --virtual-time-budget=8000 --window-size="$(size "$n")" \
    --screenshot="$PWD/png/$n.png" "file://$PWD/$n.html" >/dev/null 2>&1
  echo "png/$n.png"
done
