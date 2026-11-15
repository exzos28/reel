#!/usr/bin/env bash
# reel's own native views on Android (app/android/java: the mpv video view and others), added to
# an APK that `nsh package android` built: NSH packages its own Java only, so this compiles
# reel's, adds it as the next classesN.dex, aligns and signs the APK again with the key
# scripts/build.sh signs with (REEL_ANDROID_KEYSTORE, else the debug key).
#
#   scripts/android-views.sh <app.apk>
set -euo pipefail

apk="$(cd "$(dirname "${1:?usage: $0 <app.apk>}")" && pwd)/$(basename "$1")"
repo="$(cd "$(dirname "$0")/.." && pwd)"
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
bt="$(ls -d "$sdk"/build-tools/*/ | sort -V | tail -1)"
jar="$(ls -d "$sdk"/platforms/android-*/android.jar | sort -V | tail -1)"
src="$repo/app/android"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Compile reel's classes against Android and NSH's (stubs, compile only: the runtime has them).
mkdir -p "$work/stubs" "$work/classes" "$work/dex"
javac --release 11 -nowarn -d "$work/stubs" -classpath "$jar" $(find "$src/stubs" -name '*.java')
javac --release 11 -nowarn -d "$work/classes" -classpath "$jar:$work/stubs" $(find "$src/java" -name '*.java')
"$bt/d8" --release --min-api 26 --lib "$jar" --classpath "$work/stubs" --output "$work/dex" $(find "$work/classes" -name '*.class')

# The next free classesN.dex in the APK.
n=2
while unzip -l "$apk" "classes$n.dex" >/dev/null 2>&1; do n=$((n + 1)); done
cp "$work/dex/classes.dex" "$work/classes$n.dex"
cp "$apk" "$work/in.apk"
(cd "$work" && zip -q in.apk "classes$n.dex")

# Align (16 KiB pages for the native libraries) and sign again.
"$bt/zipalign" -f -P 16 4 "$work/in.apk" "$work/aligned.apk"
if [ -n "${REEL_ANDROID_KEYSTORE:-}" ]; then
  "$bt/apksigner" sign --ks "$REEL_ANDROID_KEYSTORE" --ks-key-alias "${REEL_ANDROID_KEY_ALIAS:?}" \
    --ks-pass env:NSH_KEYSTORE_PASSWORD --out "$apk" "$work/aligned.apk"
else
  "$bt/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out "$apk" "$work/aligned.apk"
fi
echo "reel views: classes$n.dex in $(basename "$apk")"
