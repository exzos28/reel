#!/usr/bin/env bash
# Screens render content only: the frame (ui/layout/PageFrame, metrics) owns what is over and
# under a page, the kit owns sizes and the ring's room. This fails when a screen works any of
# it out itself. Run from anywhere: scripts/ui-rules.sh
set -euo pipefail
cd "$(dirname "$0")/../app/ui/screens"

# What a screen must not read or do, and why.
rules=(
  '\bsafeArea\(|the system bars: metrics / PageFrame'
  '\bnavRoom\(|what is over a page: metrics'
  '\bringRoom\(|the ring'"'"'s room: Rail, kit'
  'from "(\.\./)+layout/chrome"|the family: ask caps or the frame'
  'position: "absolute"|overlays: the frame places them'
)

bad=0
for rule in "${rules[@]}"; do
  # The pattern itself may hold "|": the reason is after the last one.
  pattern="${rule%|*}"
  why="${rule##*|}"
  if hits=$(grep -rnE "$pattern" . 2>/dev/null); then
    echo "screens must not: ${why}"
    echo "$hits" | sed 's/^/  /'
    bad=1
  fi
done
[ "$bad" = 0 ] && echo "ui rules: screens render content only"
exit "$bad"
