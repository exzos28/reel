#!/usr/bin/env bash
# Installs the Android SDK packages `nsh package --target android` needs for an app with a
# Rust crate: platform 35, build tools (aapt2, zipalign, apksigner), platform-tools and an NDK.
# Needs ANDROID_HOME (or ANDROID_SDK_ROOT) with cmdline-tools, and a JDK.
# Exports ANDROID_NDK_HOME to GITHUB_ENV in GitHub Actions.
set -euo pipefail

ndk="${REEL_ANDROID_NDK:-27.2.12479018}"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
[ -d "$sdk" ] || { echo "setup-android-sdk.sh: no Android SDK at $sdk; set ANDROID_HOME" >&2; exit 1; }

sdkmanager="$(command -v sdkmanager || true)"
[ -n "$sdkmanager" ] || sdkmanager="$sdk/cmdline-tools/latest/bin/sdkmanager"
[ -x "$sdkmanager" ] || { echo "setup-android-sdk.sh: sdkmanager not found (install cmdline-tools)" >&2; exit 1; }

yes | "$sdkmanager" --licenses > /dev/null || true
"$sdkmanager" --install "platforms;android-35" "build-tools;35.0.1" "platform-tools" "ndk;$ndk"

echo "ANDROID_NDK_HOME=$sdk/ndk/$ndk"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "ANDROID_HOME=$sdk" >> "$GITHUB_ENV"
  echo "ANDROID_NDK_HOME=$sdk/ndk/$ndk" >> "$GITHUB_ENV"
fi
