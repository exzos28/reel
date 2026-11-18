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
#   dev/screens.sh --jobs 2                            two targets at a time (default: what this
#                                                      machine's cores and memory allow)
#
# Or the same through REEL_SCREENS_TARGETS, REEL_SCREENS_SIZES, REEL_SCREENS_SCREENS,
# REEL_SCREENS_JOBS, and
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
jobs=${REEL_SCREENS_JOBS:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --targets) targets=$2; shift 2 ;;
    --sizes) sizes=$2; shift 2 ;;
    --screens) screens=$2; shift 2 ;;
    --jobs) jobs=$2; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "screens: unknown argument $1 (--targets, --sizes, --screens, --jobs)" >&2; exit 2 ;;
  esac
done
if [ -z "$targets" ]; then
  targets=$(node -e 'console.log(Object.keys(require(process.argv[1]).targets).join(","))' "$root/dev/screens/matrix.json")
fi
case "$jobs" in
  ''|*[!0-9]*|0) [ -z "$jobs" ] || { echo "screens: --jobs is a number of targets at a time, 1 or more" >&2; exit 2; } ;;
esac
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

# One target: its own data dir, core (on a port of its own) and Chrome; its log in
# <out>/<target>.log. Run for every target at once (they share nothing but the web build).
shoot() {
  target=$1
  log="$out/$target.log"
  data=$(mktemp -d "${TMPDIR:-/tmp}/reel-screens-data.XXXXXX")
  pid=
  trap 'if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi; rm -rf "$data"' EXIT
  cp "$root/dev/screens/state/"*.json "$data/"
  # Set up already (no first-run setup over the pages), the UI in English, the search source from
  # .env when there is one (it stays in this folder, removed after).
  node -e '
    const [file, url, key] = process.argv.slice(1);
    require("fs").writeFileSync(file, JSON.stringify({ setupDone: true, language: "en", sourceUrl: url || "", sourceKey: key || "" }));
  ' "$data/settings.json" "${REEL_TORZNAB_URL:-}" "${REEL_TORZNAB_KEY:-}"
  token="reel-screens-$$-$target-$(date +%s)" # the core wants 16 characters or more
  profile=mpv
  if [ "$target" = tv ]; then profile=tizen; fi
  # Port 0: the system picks a free one, which the core prints ("reel core on http://127.0.0.1:N").
  "$core" --port 0 --token "$token" --data-dir "$data" --cache-dir "$data/cache" --ui-dir "$web/reel" --profile "$profile" --device "$target" >"$data/core.log" 2>&1 &
  pid=$!
  port=
  for _ in $(seq 1 100); do
    port=$(sed -n 's|^reel core on http://127.0.0.1:\([0-9]*\) .*|\1|p' "$data/core.log")
    if [ -n "$port" ] && curl -sf -o /dev/null -H "X-Reel-Token: $token" "http://127.0.0.1:$port/health"; then break; fi
    port=
    sleep 0.1
  done
  if [ -z "$port" ]; then
    echo "screens: the core did not start for $target:" >"$log"
    cat "$data/core.log" >>"$log"
    return 1
  fi
  node "$root/dev/screens.mjs" shoot "http://127.0.0.1:$port/ui/index.html?reelToken=$token" "$out" "$target" "$sizes" "$screens" >"$log" 2>&1
}

# How many targets at a time: as asked, else half the cores (each target is a Chrome and a core,
# a picture of a wide window takes a core for a moment) and about 1.5 GB of memory each, at most
# one per target.
count=$(echo "$targets" | tr ',' '\n' | grep -c .)
if [ -z "$jobs" ]; then
  if [ "$(uname)" = Darwin ]; then
    cores=$(sysctl -n hw.ncpu)
    memory=$(( $(sysctl -n hw.memsize) / 1048576 ))
  else
    cores=$(nproc)
    memory=$(( $(sed -n 's/^MemAvailable: *\([0-9]*\) kB/\1/p' /proc/meminfo) / 1024 ))
  fi
  jobs=$(( cores / 2 ))
  if [ $(( memory / 1536 )) -lt "$jobs" ]; then jobs=$(( memory / 1536 )); fi
  if [ "$jobs" -lt 1 ]; then jobs=1; fi
  how="from $cores cores and $(( memory / 1024 )) GB"
else
  how="as asked"
fi
if [ "$jobs" -gt "$count" ]; then jobs=$count; fi
echo "screens: $count targets, $jobs at a time ($how); each target's log: $out/<target>.log"

# The targets running (target:pid), oldest first; one is waited for when they are as many as jobs.
running=
failed=
trap 'for r in $running; do kill "${r#*:}" 2>/dev/null || true; done' INT TERM
finish() {
  r=$1
  target=${r%%:*}
  if wait "${r#*:}"; then
    echo "screens: $target: $(grep -c '\.png$' "$out/$target.log" || true) pictures"
  else
    failed="$failed $target"
    echo "screens: $target failed:" >&2
    tail -n 5 "$out/$target.log" >&2
  fi
}
for target in $(echo "$targets" | tr ',' ' '); do
  # shellcheck disable=SC2086
  set -- $running
  if [ $# -ge "$jobs" ]; then
    finish "$1"
    shift
    running="$*"
  fi
  (shoot "$target") &
  running="$running $target:$!"
done
for r in $running; do finish "$r"; done

node "$root/dev/screens.mjs" index "$out"
if [ -n "$failed" ]; then
  echo "screens: failed on$failed (their pictures as they were: *-failed.png)" >&2
  exit 1
fi
