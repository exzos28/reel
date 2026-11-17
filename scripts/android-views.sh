#!/usr/bin/env bash
# reel's own native views on Android (app/android/java: the mpv video view and others), added to
# an APK that `nsh package android` built: NSH packages its own Java only, so this compiles
# reel's, adds it as the next classesN.dex, adds libmpv and what it needs for the APK's ABIs
# (scripts/libmpv.sh: the reel-libmpv release), aligns and signs the APK again with the
# key scripts/build.sh signs with (REEL_ANDROID_KEYSTORE, else the debug key).
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

# reel's dex: the one already there from an earlier run (replaced), else the next free one.
n=2
while unzip -l "$apk" "classes$n.dex" >/dev/null 2>&1; do
  unzip -p "$apk" "classes$n.dex" | grep -q "Lapp/reel/views/" && break
  n=$((n + 1))
done
cp "$work/dex/classes.dex" "$work/classes$n.dex"
cp "$apk" "$work/in.apk"
(cd "$work" && zip -q in.apk "classes$n.dex")

# libmpv and its libraries, stored uncompressed (the APK keeps native libraries in place).
libs="$("$repo/scripts/libmpv.sh" fetch android)"
for dir in "$libs"/*/; do
  [ -d "$dir" ] || continue
  abi="$(basename "$dir")"
  unzip -l "$apk" "lib/$abi/*" >/dev/null 2>&1 || continue   # an ABI this APK does not have
  mkdir -p "$work/lib/$abi"
  cp "$dir"*.so "$work/lib/$abi/"
  (cd "$work" && zip -q -0 in.apk lib/"$abi"/*.so)
  echo "reel views: libmpv for $abi ($(ls "$dir" | wc -l | tr -d ' ') libraries)"
done

# Align (16 KiB pages for the native libraries) and sign again.
"$bt/zipalign" -f -P 16 4 "$work/in.apk" "$work/aligned.apk"
if [ -n "${REEL_ANDROID_KEYSTORE:-}" ]; then
  "$bt/apksigner" sign --ks "$REEL_ANDROID_KEYSTORE" --ks-key-alias "${REEL_ANDROID_KEY_ALIAS:?}" \
    --ks-pass env:NSH_KEYSTORE_PASSWORD --out "$apk" "$work/aligned.apk"
else
  "$bt/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out "$apk" "$work/aligned.apk"
fi
echo "reel views: classes$n.dex in $(basename "$apk")"
