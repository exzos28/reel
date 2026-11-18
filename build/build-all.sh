#!/usr/bin/env bash
# Builds every package this machine can make into out/<target>/, with .env's build settings, in two
# groups side by side: here (macOS, Android, then the iOS simulator: they share Cargo's build) and
# in Docker (Linux, Windows, then the Samsung TV: one at a time, as Docker's memory holds one heavy
# build). Then build/publish-release.sh publishes them (not the iOS simulator's: it is built so
# that an iOS break shows here, as it does in CI).
#
# Usage: build/build-all.sh [target...]     default: macos android ios-simulator linux windows tizen
#
# Each group stops at its first failure; the script fails if either did, and says how long each
# build took. The groups' output goes to out/logs/<group>.log.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$repo/.env" ] && { set -a; . "$repo/.env"; set +a; }
targets=("$@")
[ "${#targets[@]}" -gt 0 ] || targets=(macos android ios-simulator linux windows tizen)

one() {
  local t="$1" start
  start=$(date +%s)
  printf '==> %s\n' "$t"
  case "$t" in
    macos | android | ios-simulator) "$repo/build/build.sh" "$t" ;;
    linux) "$repo/build/linux-docker.sh" build "$repo/out/linux" ;;
    windows) "$repo/build/linux-docker.sh" windows "$repo/out/windows" ;;
    tizen) "$repo/build/tizen-docker.sh" package "$repo/out/tizen" ;;
    *) printf 'build-all.sh: unknown target %s\n' "$t" >&2; return 2 ;;
  esac
  printf '==> %s done in %ss\n' "$t" "$(( $(date +%s) - start ))"
}

host=() docker=()
for t in "${targets[@]}"; do
  case "$t" in macos | android | ios-simulator) host+=("$t") ;; *) docker+=("$t") ;; esac
done

mkdir -p "$repo/out/logs"
group() {
  local name="$1"; shift
  for t in "$@"; do one "$t" || return 1; done > "$repo/out/logs/$name.log" 2>&1
}
pids=()
[ "${#host[@]}" -gt 0 ] && { group host "${host[@]}" & pids+=($!); }
[ "${#docker[@]}" -gt 0 ] && { group docker "${docker[@]}" & pids+=($!); }
failed=0
for p in "${pids[@]}"; do wait "$p" || failed=1; done

grep -h '^==> .* done in' "$repo"/out/logs/*.log >&2 || true
if [ "$failed" = 1 ]; then
  echo "build-all.sh: a build failed; see out/logs/" >&2
  tail -n 15 "$repo"/out/logs/*.log >&2
  exit 1
fi
ls -la "$repo"/out/*/reel-* >&2
