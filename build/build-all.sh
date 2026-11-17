#!/usr/bin/env bash
# Builds every package this machine can make, one after another, into out/<target>/, with .env's
# build settings: macOS and Android here, Linux, Windows and the Samsung TV in Docker. Then
# build/publish-release.sh publishes them.
#
# Usage: build/build-all.sh [target...]     default: macos android linux windows tizen
#
# Stops at the first build that fails, and says how long each one took.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$repo/.env" ] && { set -a; . "$repo/.env"; set +a; }
targets=("$@")
[ "${#targets[@]}" -gt 0 ] || targets=(macos android linux windows tizen)

for t in "${targets[@]}"; do
  start=$(date +%s)
  printf '==> %s\n' "$t" >&2
  case "$t" in
    macos | android) "$repo/build/build.sh" "$t" ;;
    linux) "$repo/build/linux-docker.sh" build "$repo/out/linux" ;;
    windows) "$repo/build/linux-docker.sh" windows "$repo/out/windows" ;;
    tizen) "$repo/build/tizen-docker.sh" package "$repo/out/tizen" ;;
    *) printf 'build-all.sh: unknown target %s\n' "$t" >&2; exit 2 ;;
  esac
  printf '==> %s done in %ss\n' "$t" "$(( $(date +%s) - start ))" >&2
done
ls -la "$repo"/out/*/ >&2
