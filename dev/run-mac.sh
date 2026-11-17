#!/usr/bin/env bash
# Builds the Mac app as it ships (with .env's build settings and libmpv inside) and runs it.
#
# Usage: dev/run-mac.sh [--fresh]
#   --fresh  starts it as a new install: its data (settings, progress, caches) goes to the Trash
#            first, so the first-run setup shows.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(uname -s)" = Darwin ] || { echo "dev/run-mac.sh: macOS only" >&2; exit 1; }
# The build settings built into the app (TMDB's token, the partner's bot): without them it builds,
# but without the catalogue's key and the bot.
if [ -f "$repo/.env" ]; then set -a; . "$repo/.env"; set +a; else echo "dev/run-mac.sh: no .env (see .env.example)" >&2; fi

cd "$repo/app"
nsh package . --target macos
app="$repo/app/.nsh/out/reel.app"
"$repo/build/libmpv.sh" bundle-macos "$app"

pkill -f "reel.app/Contents/MacOS/reel" 2> /dev/null && sleep 1 || true
if [ "${1:-}" = "--fresh" ]; then
  trash="$HOME/.Trash/reel-$(date +%Y%m%d-%H%M%S)"
  for d in "$HOME/Library/Application Support/app.reel.concept" "$HOME/Library/Caches/app.reel.concept"; do
    [ -d "$d" ] && mkdir -p "$trash" && mv "$d" "$trash/"
  done
  echo "its data is in $trash"
fi
open "$app"
