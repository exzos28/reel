#!/usr/bin/env bash
# Publishes the site (site/) on Fly.io (site/deploy/fly.toml): the pages only. The packages it
# links to are releases of the public downloads repository (build/publish-release.sh).
#
# Usage: build/site-deploy.sh [--dry-run]
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

log() { printf '==> %s\n' "$*" >&2; }
die() { printf 'site-deploy.sh: %s\n' "$*" >&2; exit 1; }

ctx="$(mktemp -d "${TMPDIR:-/tmp}/reel-site.XXXXXX")"
trap 'rm -rf "$ctx"' EXIT
mkdir -p "$ctx/www"
cp "$repo/site/deploy/Dockerfile" "$repo/site/deploy/nginx.conf" "$ctx/"
# The site itself (not its README, not the deploy files).
rsync -a --exclude deploy --exclude README.md "$repo/site/" "$ctx/www/"
# The links to the downloads repository name its (public) account.
python3 -I "$repo/build/package-check.py" --allow "github.com/${REEL_RELEASES_REPO:-exzos28/reel-releases}" "$ctx/www" || die "the site fails the package check (above)"
du -sh "$ctx/www" >&2
if [ "$dry" = 1 ]; then
  log "dry run: not deployed"
  exit 0
fi
command -v flyctl > /dev/null || die "flyctl not found"
# One machine: a static site needs no second one.
flyctl deploy "$ctx" --config "$repo/site/deploy/fly.toml" --remote-only --ha=false
