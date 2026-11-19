#!/usr/bin/env bash
# Opens the version PR: the entries in .changes/ on origin/main become the next version
# (build/changes.py apply: app/nsh.json's version and build, a CHANGELOG.md section), committed as
# "Version X.Y.Z" on branch release/vX.Y.Z and pushed. Merge it by hand once its checks and
# platform builds pass; the merge into main publishes the release (.github/workflows/release.yml).
#
#   build/release.sh [--dry-run]     --dry-run: show the version and the section, change nothing
#
# Works in a worktree of its own (under $TMPDIR), so the checkout it runs from is not touched.
# Needs git, gh (signed in) and python3.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dry=0
case "${1:-}" in
  "") ;;
  --dry-run) dry=1 ;;
  *) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

log() { printf '==> %s\n' "$*" >&2; }
die() { printf 'release.sh: %s\n' "$*" >&2; exit 1; }

git -C "$repo" fetch -q origin main
tree="$(mktemp -d "${TMPDIR:-/tmp}/reel-release.XXXXXX")"
cleanup() { git -C "$repo" worktree remove --force "$tree" > /dev/null 2>&1 || rm -rf "$tree"; }
trap cleanup EXIT
git -C "$repo" worktree add -q --detach "$tree" origin/main

python3 -I "$tree/build/changes.py" status >&2
version="$(python3 -I "$tree/build/changes.py" apply)" || die "nothing to release"
python3 -I "$tree/build/changes.py" notes "$version" >&2

if [ "$dry" = 1 ]; then
  log "dry run: release/v$version not made"
  exit 0
fi

branch="release/v$version"
git -C "$repo" ls-remote --exit-code --heads origin "$branch" > /dev/null 2>&1 \
  && die "$branch is already on origin: merge or close its PR first"
cd "$tree"
git switch -q -c "$branch"
git add -A .changes CHANGELOG.md app/nsh.json
git commit -q -m "Version $version"
git push -q -u origin "$branch"
notes="$(python3 -I build/changes.py notes "$version")"
url="$(gh pr create --base main --head "$branch" --title "Version $version" --body "$notes")"
log "$url: merge it once its checks and builds pass (gh pr merge --merge); the merge publishes v$version"
