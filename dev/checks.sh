#!/usr/bin/env bash
# Every check CI runs before a merge (.github/workflows/checks.yml), here, one after another: the UI
# rules, the domain and engine crates' tests, nsh's type check, the Tizen core's RPC table against
# the declarations it wrote, app/ without the engine, and the app's tests. Nothing requires running
# it locally (CLAUDE.md, "Build and test"); it is for when you want the whole answer before
# pushing. Run from anywhere. Stops at the first failure.
set -euo pipefail

build="$(cd "$(dirname "$0")/.." && pwd)/build/build.sh"

step() {
  local start=$SECONDS
  printf '==> build.sh %s\n' "$1" >&2
  "$build" "$1" || { printf 'checks.sh: failed: build.sh %s\n' "$1" >&2; exit 1; }
  printf '    %ss\n' "$(( SECONDS - start ))" >&2
}

for target in ui-rules test-crates typecheck test-tizen-core no-engine test-app; do step "$target"; done
echo "checks.sh: all passed" >&2
