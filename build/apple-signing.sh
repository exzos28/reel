#!/usr/bin/env bash
# Optional Apple signing for CI, driven by environment variables (GitHub secrets).
#
#   build/apple-signing.sh keychain   import APPLE_CERT_P12_BASE64 (password APPLE_CERT_PASSWORD)
#                                       into a temporary keychain
#   build/apple-signing.sh profile    decode IOS_PROFILE_BASE64 to a .mobileprovision and print its path
#   build/apple-signing.sh macos      sign app/.nsh/dist/macos/pkg/*.app with MACOS_SIGN_IDENTITY
#                                       (Developer ID Application, hardened runtime), notarize it when
#                                       APPLE_ID, APPLE_TEAM_ID and APPLE_APP_PASSWORD are set, staple
#                                       and zip it again
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
tmp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
die() { printf 'apple-signing.sh: %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  keychain)
    [ -n "${APPLE_CERT_P12_BASE64:-}" ] || die "APPLE_CERT_P12_BASE64 is not set"
    keychain="$tmp/reel-signing.keychain-db"
    password="$(openssl rand -hex 16)"
    printf '%s' "$APPLE_CERT_P12_BASE64" | base64 --decode > "$tmp/reel-cert.p12"
    security create-keychain -p "$password" "$keychain"
    security set-keychain-settings -lut 21600 "$keychain"
    security unlock-keychain -p "$password" "$keychain"
    security import "$tmp/reel-cert.p12" -k "$keychain" -P "${APPLE_CERT_PASSWORD:-}" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$keychain" > /dev/null
    # Keep the user's keychains searchable, with ours first.
    # shellcheck disable=SC2046 # one keychain path per word
    security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
    rm -f "$tmp/reel-cert.p12"
    security find-identity -v -p codesigning "$keychain"
    ;;

  profile)
    [ -n "${IOS_PROFILE_BASE64:-}" ] || die "IOS_PROFILE_BASE64 is not set"
    profile="$tmp/reel.mobileprovision"
    printf '%s' "$IOS_PROFILE_BASE64" | base64 --decode > "$profile"
    echo "$profile"
    ;;

  macos)
    [ -n "${MACOS_SIGN_IDENTITY:-}" ] || die "MACOS_SIGN_IDENTITY is not set"
    out="$repo/app/.nsh/dist/macos"
    bundle="$(ls -d "$out"/pkg/*.app 2> /dev/null | head -n 1 || true)"
    [ -d "$bundle" ] || die "no .app in $out/pkg; run build/build.sh macos"
    codesign --force --deep --options runtime --timestamp --sign "$MACOS_SIGN_IDENTITY" "$bundle"
    codesign --verify --strict --verbose=2 "$bundle"
    zip="$(ls "$out"/reel-macos-*.zip 2> /dev/null | head -n 1 || true)"
    [ -n "$zip" ] || die "no reel-macos-*.zip in $out"
    rm -f "$zip"
    ditto -c -k --keepParent "$bundle" "$zip"
    if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ]; then
      xcrun notarytool submit "$zip" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
        --password "$APPLE_APP_PASSWORD" --wait
      xcrun stapler staple "$bundle"
      rm -f "$zip"
      ditto -c -k --keepParent "$bundle" "$zip"
    else
      echo "notarization skipped: APPLE_ID, APPLE_TEAM_ID or APPLE_APP_PASSWORD is not set" >&2
    fi
    ;;

  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
