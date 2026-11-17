#!/usr/bin/env bash
# Fetches the reel TV app's logs from a Samsung TV on the local network (the core serves them on
# port 47392 while the app runs: platforms/tizen/core/src/logs.rs) into logs/tizen-<time>.log and
# prints where it put them.
#
#   dev/tizen-logs.sh <TV IP>
set -euo pipefail

tv="${1:-}"
[ -n "$tv" ] || { echo "usage: $0 <TV IP>" >&2; exit 2; }
here="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$here/logs"
out="$here/logs/tizen-$(date +%Y%m%d-%H%M%S).log"
if ! curl -fsS -m 10 "http://$tv:47392/logs" -o "$out"; then
    rm -f "$out"
    echo "no answer from http://$tv:47392/logs: is reel open on the TV (its core serves the logs)?" >&2
    exit 1
fi
echo "$out"
