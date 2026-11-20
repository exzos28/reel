#!/usr/bin/env bash
# Signs an iOS .app for devices and packs it as an .ipa: libmpv's framework inside first, then the
# app, with the entitlements its provisioning profile allows.
#
#   build/ios-sign.sh <App.app> <out.ipa> <identity> <profile.mobileprovision> [bundle id]
#
# The bundle id (optional) replaces the app's own: a developer's wildcard profile signs reel under
# an id of their own team (com.example.reel-dev) and never takes reel's.
set -euo pipefail

app="${1:?usage: $0 <App.app> <out.ipa> <identity> <profile> [bundle id]}"
out="${2:?out.ipa}"
identity="${3:?identity}"
profile="${4:?profile}"
bundle_id="${5:-}"

out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

security cms -D -i "$profile" > "$work/profile.plist"
team="$(plutil -extract TeamIdentifier.0 raw -o - "$work/profile.plist")"
[ -n "$bundle_id" ] && plutil -replace CFBundleIdentifier -string "$bundle_id" "$app/Info.plist"
id="$(plutil -extract CFBundleIdentifier raw -o - "$app/Info.plist")"

# The profile's entitlements, with its app id made this app's ("TEAM.*" -> "TEAM.<id>").
plutil -extract Entitlements xml1 -o "$work/entitlements.plist" "$work/profile.plist"
plutil -replace application-identifier -string "$team.$id" "$work/entitlements.plist"
cp "$profile" "$app/embedded.mobileprovision"

for fw in "$app"/Frameworks/*.framework; do
  [ -d "$fw" ] && codesign --force --sign "$identity" --timestamp=none "$fw"
done
codesign --force --sign "$identity" --timestamp=none --entitlements "$work/entitlements.plist" "$app"
codesign --verify --deep --strict "$app"

mkdir -p "$work/Payload"
cp -R "$app" "$work/Payload/"
rm -f "$out"
(cd "$work" && zip -qry -X "$out" Payload)
echo "$out ($id, team $team)"
