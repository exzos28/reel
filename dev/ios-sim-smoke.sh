#!/usr/bin/env bash
# Installs the simulator build (build/build.sh ios-simulator) on an iOS simulator of the
# given family, launches it and checks it is still running after a few seconds (on failure it
# prints the app's crash report or its last log lines).
#
#   dev/ios-sim-smoke.sh iPhone
#   dev/ios-sim-smoke.sh iPad
#
# Picks the newest available iOS runtime and the first device whose name starts with the
# family; boots it if needed and shuts it down afterwards only if this script booted it.
set -euo pipefail

family="${1:?usage: dev/ios-sim-smoke.sh iPhone|iPad}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$repo/app/.nsh/dist/ios-simulator/pkg"
bundle="$(ls -d "$pkg"/*.app 2> /dev/null | head -n 1 || true)"
[ -d "$bundle" ] || { echo "ios-sim-smoke.sh: no .app in $pkg; run build/build.sh ios-simulator" >&2; exit 1; }
id="$(plutil -extract CFBundleIdentifier raw -o - "$bundle/Info.plist")"

read -r udid state name < <(xcrun simctl list devices available -j | python3 -I -c '
import json, sys
family = sys.argv[1]
devices = json.load(sys.stdin)["devices"]
def version(runtime):
    tail = runtime.rsplit("iOS-", 1)[-1]
    return tuple(int(p) for p in tail.split("-") if p.isdigit())
for runtime in sorted((r for r in devices if ".iOS-" in r), key=version, reverse=True):
    for d in devices[runtime]:
        if d["name"].startswith(family):
            print(d["udid"], d["state"], d["name"].replace(" ", "_"))
            sys.exit(0)
sys.exit("no available " + family + " simulator")
' "$family") || true
[ -n "${udid:-}" ] || { echo "ios-sim-smoke.sh: no available $family simulator" >&2; exit 1; }

echo "==> $family: ${name//_/ } ($udid), $state" >&2
booted_here=false
if [ "$state" != Booted ]; then
  xcrun simctl boot "$udid"
  booted_here=true
fi
cleanup() { $booted_here && xcrun simctl shutdown "$udid" || true; }
trap cleanup EXIT
xcrun simctl bootstatus "$udid" -b > /dev/null

xcrun simctl install "$udid" "$bundle"
# A CI simulator just booted is slow: launch it again if the first launch timed out, then the
# app must still be running after REEL_SMOKE_SECONDS (it has had time to crash by then).
since="$(date -u +%Y-%m-%dT%H:%M:%S)"
xcrun simctl launch --terminate-running-process "$udid" "$id" ||
  { sleep 20; xcrun simctl launch --terminate-running-process "$udid" "$id"; }
sleep "${REEL_SMOKE_SECONDS:-20}"

# grep reads the whole list (not -q): -q stops at the match, launchctl dies of SIGPIPE and, with
# pipefail, a running app counts as not running.
running() { xcrun simctl spawn "$udid" launchctl list | grep "UIKitApplication:$id" > /dev/null; }
if running; then
  echo "==> $id is running on ${name//_/ }" >&2
  xcrun simctl io "$udid" screenshot "$repo/app/.nsh/dist/ios-simulator/screenshot-$family.png" > /dev/null 2>&1 || true
else
  echo "ios-sim-smoke.sh: $id is not running on ${name//_/ } after launch" >&2
  # Why: the app's crash report (written on the host), else its last log lines.
  report="$(ls -t "$HOME"/Library/Logs/DiagnosticReports/reel*.ips 2> /dev/null | head -n 1 || true)"
  if [ -n "$report" ]; then
    echo "--- $report" >&2
    head -c 6000 "$report" >&2
  else
    xcrun simctl spawn "$udid" log show --start "${since/T/ }" --style compact \
      --predicate 'process == "reel"' 2> /dev/null | tail -n 60 >&2 || true
  fi
  exit 1
fi
