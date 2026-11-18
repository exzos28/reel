#!/bin/sh
# Screenshots of every layout in windows of several sizes, with no window on screen: the web build in
# headless Chrome against the core running here (platforms/tizen's reel-core), which tells the UI
# which device to stand in for (--device: mac, windows, linux, tv, tablet, phone). Per target, size
# and screen a picture in out/screens/<target>/<size>-<screen>.png, and out/screens/index.html to
# look at them all.
#
#   dev/screens.sh                                     everything in dev/screens/matrix.json
#   dev/screens.sh --targets mac,phone                 some targets
#   dev/screens.sh --targets mac --sizes fhd,uw-21x9   some of a target's sizes
#   dev/screens.sh --screens home,title                some screens
#
# Or the same through REEL_SCREENS_TARGETS, REEL_SCREENS_SIZES, REEL_SCREENS_SCREENS, and
# REEL_SCREENS_OUT for another folder. Each target's core starts from dev/screens/state (Continue
# watching, the Watchlist: free films) and the search source in .env, if any; the catalog is
# TMDB's live one. What a browser cannot be: AppKit's, UIKit's or Android's own drawing, the
# system's window controls (only their room), the video player.
#
# Needs Google Chrome, Node, REEL_TMDB_TOKEN (.env) and, on a Mac, Homebrew's LLVM (brew install
# llvm: the web build's wasm C compiler).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -f "$root/.env" ]; then
  set -a
  . "$root/.env"
  set +a
fi

targets=${REEL_SCREENS_TARGETS:-}
sizes=${REEL_SCREENS_SIZES:-}
screens=${REEL_SCREENS_SCREENS:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --targets) targets=$2; shift 2 ;;
    --sizes) sizes=$2; shift 2 ;;
    --screens) screens=$2; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "screens: unknown argument $1 (--targets, --sizes, --screens)" >&2; exit 2 ;;
  esac
done
if [ -z "$targets" ]; then
  targets=$(node -e 'console.log(Object.keys(require(process.argv[1]).targets).join(","))' "$root/dev/screens/matrix.json")
fi
out="${REEL_SCREENS_OUT:-$root/out/screens}"
web="$root/out/web"

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
rm -rf "$out"
mkdir -p "$out"

pid=
data=
stop() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  if [ -n "$data" ]; then rm -rf "$data"; fi
  pid=
  data=
}
trap stop EXIT INT TERM

failed=
for target in $(echo "$targets" | tr ',' ' '); do
  data=$(mktemp -d "${TMPDIR:-/tmp}/reel-screens-data.XXXXXX")
  cp "$root/dev/screens/state/"*.json "$data/"
  # Set up already (no first-run setup over the pages), the UI in English, the search source from
  # .env when there is one (it stays in this folder, removed after).
  node -e '
    const [file, url, key] = process.argv.slice(1);
    require("fs").writeFileSync(file, JSON.stringify({ setupDone: true, language: "en", sourceUrl: url || "", sourceKey: key || "" }));
  ' "$data/settings.json" "${REEL_TORZNAB_URL:-}" "${REEL_TORZNAB_KEY:-}"
  port=$(node -e 'const s = require("net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); })')
  token="reel-screens-$$-$(date +%s)" # the core wants 16 characters or more
  profile=mpv
  [ "$target" = tv ] && profile=tizen
  "$core" --port "$port" --token "$token" --data-dir "$data" --cache-dir "$data/cache" --ui-dir "$web/reel" --profile "$profile" --device "$target" >"$data/core.log" 2>&1 &
  pid=$!
  up=
  for _ in $(seq 1 100); do
    if curl -sf -o /dev/null -H "X-Reel-Token: $token" "http://127.0.0.1:$port/health"; then up=1; break; fi
    sleep 0.1
  done
  if [ -z "$up" ]; then
    echo "screens: the core did not start for $target:" >&2
    cat "$data/core.log" >&2
    exit 1
  fi
  node "$root/dev/screens.mjs" shoot "http://127.0.0.1:$port/ui/index.html?reelToken=$token" "$out" "$target" "$sizes" "$screens" || failed="$failed $target"
  stop
done

node "$root/dev/screens.mjs" index "$out"
if [ -n "$failed" ]; then
  echo "screens: failed on$failed (their pictures as they were: *-failed.png)" >&2
  exit 1
fi
