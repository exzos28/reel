#!/usr/bin/env bash
# Puts reel's launch screen into an iOS .app: reel's dark background with the logotype in the
# middle (NSH's own is an empty UILaunchScreen, which shows white). Before the app is signed.
#
#   platforms/ios/launch/apply.sh <App.app>
#
# The logotype's images come from logo.swift (Geist, reel's red, @1x @2x @3x).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="${1:?usage: $0 <App.app>}"
xcrun ibtool --compile "$app/LaunchScreen.storyboardc" "$here/LaunchScreen.storyboard" \
  --target-device iphone --target-device ipad --minimum-deployment-target 15.0 >/dev/null
cp "$here"/launch-logo.png "$here"/launch-logo@2x.png "$here"/launch-logo@3x.png "$app/"
plutil -remove UILaunchScreen "$app/Info.plist" 2>/dev/null || true
plutil -replace UILaunchStoryboardName -string LaunchScreen "$app/Info.plist"
