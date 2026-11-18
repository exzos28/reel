#!/usr/bin/env bash
# The checks every commit on main must pass (CLAUDE.md, "Build and test"): the Rust tests, the
# build without default features, nsh's type check and tests, and the UI rules. Run from anywhere;
# .githooks/pre-push runs it before every push. Stops at the first failure.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo/app"

step() {
  local start=$SECONDS
  printf '==> %s\n' "$*" >&2
  "$@" || { printf 'checks.sh: failed: %s\n' "$*" >&2; exit 1; }
  printf '    %ss\n' "$(( SECONDS - start ))" >&2
}

step cargo test --workspace -q
step cargo build --no-default-features -q
step nsh check .
step nsh test .
step ../dev/ui-rules.sh
echo "checks.sh: all passed" >&2
