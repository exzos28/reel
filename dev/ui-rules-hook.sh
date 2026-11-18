#!/usr/bin/env bash
# Claude Code PostToolUse hook (.claude/settings.json): after an edit under app/ui/, runs
# dev/ui-rules.sh of the checkout the file is in (the repo or a worktree) and hands a failure
# back to the agent (exit 2, the output on stderr). Reads the hook's JSON on stdin.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
case "$file" in
  */app/ui/*) ;;
  *) exit 0 ;;
esac

rules="${file%%/app/ui/*}/dev/ui-rules.sh"
[ -x "$rules" ] || exit 0

if ! out=$("$rules" 2>&1); then
  echo "$out" >&2
  exit 2
fi
exit 0
