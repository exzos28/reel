#!/bin/sh
# Screenshots of the desktop layout in windows of several sizes and ratios, with no window on screen:
# the web build in headless Chrome, against the core running here (platforms/tizen/core's reel-core
# with a desktop's profile, a fresh data dir, the live network). Home, its shelves, Movies and a
# title's page per size go to out/screens/<size>-<screen>.png, or $REEL_SCREENS_OUT (sizes:
# dev/screens.mjs).
#
#   dev/screens.sh                 every size
#   dev/screens.sh uw              the sizes whose name contains this
#
# A browser lays out as a Linux desktop (no room for a Mac's window controls); the content column,
# hero, grids and shelves are the Mac's. Needs Google Chrome, Node, REEL_TMDB_TOKEN (.env) and on a
# Mac Homebrew's LLVM (brew install llvm: the web build's wasm C compiler).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -f "$root/.env" ]; then
  set -a
  . "$root/.env"
  set +a
fi
web="$root/out/web"
out="${REEL_SCREENS_OUT:-$root/out/screens}" # where the pictures go

# The web build compiles C (zstd) for wasm32: Apple's clang has no such target, Homebrew's LLVM does.
llvm=/opt/homebrew/opt/llvm/bin
if [ "$(uname)" = Darwin ] && [ -x "$llvm/clang" ]; then
  export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-$llvm/clang}"
  export AR_wasm32_unknown_unknown="${AR_wasm32_unknown_unknown:-$llvm/llvm-ar}"
fi

echo "screens: building the web UI"
(cd "$root/app" && nsh package . --target web -o "$web" >/dev/null)
echo "screens: building the core"
(cd "$root/platforms/tizen" && cargo build -q -p reel-tizen-core --bin reel-core)
core="$root/platforms/tizen/target/debug/reel-core"

data=$(mktemp -d "${TMPDIR:-/tmp}/reel-screens-data.XXXXXX")
# Set up already: no first-run setup over the pages (the UI language stays English).
printf '{"setupDone":true}' >"$data/settings.json"
port=47491
token=reel-screens-$$-$(date +%s) # the core wants 16 characters or more
"$core" --port "$port" --token "$token" --data-dir "$data" --cache-dir "$data/cache" --ui-dir "$web/reel" --profile mpv >"$data/core.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null; rm -rf "$data"' EXIT INT TERM
for _ in $(seq 1 50); do
  curl -sf -o /dev/null -H "X-Reel-Token: $token" "http://127.0.0.1:$port/health" && break
  sleep 0.2
done

node "$root/dev/screens.mjs" "http://127.0.0.1:$port/ui/index.html?reelToken=$token" "$out" "${1:-}"
