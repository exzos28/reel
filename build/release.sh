#!/usr/bin/env bash
# Attaches the packages in DIR to the draft GitHub Release of TAG, creating the draft if it
# does not exist (re-runs replace the files). Needs the gh CLI, authenticated (GH_TOKEN in CI).
#
#   build/release.sh v0.2.0 dist
set -euo pipefail

tag="${1:?usage: build/release.sh <tag> <dir>}"
dir="${2:?usage: build/release.sh <tag> <dir>}"

files=()
while IFS= read -r -d '' f; do files+=("$f"); done < <(find "$dir" -type f -name 'reel-*' -print0 | sort -z)
[ "${#files[@]}" -gt 0 ] || { echo "release.sh: no reel-* files in $dir" >&2; exit 1; }
printf 'attaching %s\n' "${files[@]}" >&2

if gh release view "$tag" > /dev/null 2>&1; then
  gh release upload "$tag" "${files[@]}" --clobber
else
  gh release create "$tag" "${files[@]}" --draft --title "reel ${tag#v}" --generate-notes --verify-tag
fi
