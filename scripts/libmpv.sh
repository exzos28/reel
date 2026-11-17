#!/usr/bin/env bash
# libmpv for reel's video player, prebuilt as LGPL in https://github.com/exzos28/reel-libmpv
# (its scripts build it; see its README). Downloaded once per release into the cache, checked
# against the checksums pinned here.
#
#   scripts/libmpv.sh fetch android        # prints the directory with <abi>/*.so
#   scripts/libmpv.sh fetch macos          # prints the path of libmpv.2.dylib
#   scripts/libmpv.sh bundle-macos <App.app>   # copies it into Contents/Frameworks, re-signs ad hoc
set -euo pipefail

REPO="exzos28/reel-libmpv"
TAG="mpv0.42-ffmpeg9.0.2-1"
SHA_ANDROID_ARM64="2162b4504e3520d24187cd5cac729fbc67da33266df73455413c73c763651900"
SHA_ANDROID_ARMV7="77c508203cdec5ea5145dc87eb0748f047fb6f5d9ee8619f9041b56d5e16234d"
SHA_MACOS="2609cdcb1cac4e80c3faa5e6646ce6b156f97d8b4a295be334454f5a8a2d620d"
CACHE="${REEL_LIBMPV_CACHE:-$HOME/Library/Caches/reel/libmpv/$TAG}"

# Downloads a release file once and checks it.
get() {
  local name="$1" sha="$2" file="$CACHE/$1"
  if [ ! -f "$file" ] || ! echo "$sha  $file" | shasum -a 256 -c - >/dev/null 2>&1; then
    mkdir -p "$CACHE"
    curl -fsSL "https://github.com/$REPO/releases/download/$TAG/$name" -o "$file.part"
    echo "$sha  $file.part" | shasum -a 256 -c - >/dev/null || { rm -f "$file.part"; echo "libmpv: $name does not match its checksum" >&2; exit 1; }
    mv "$file.part" "$file"
  fi
  echo "$file"
}

android() {
  local out="$CACHE/android"
  for pair in "arm64-v8a:$SHA_ANDROID_ARM64" "armeabi-v7a:$SHA_ANDROID_ARMV7"; do
    local abi="${pair%%:*}" sha="${pair##*:}"
    [ -f "$out/$abi/libmpv.so" ] && continue
    local archive; archive="$(get "libmpv-android-$abi.tar.gz" "$sha")"
    mkdir -p "$out/$abi" && tar -xzf "$archive" -C "$out/$abi"
  done
  echo "$out"
}

macos() {
  local dylib="$CACHE/macos/libmpv.2.dylib"
  if [ ! -f "$dylib" ]; then
    local archive; archive="$(get libmpv-macos.zip "$SHA_MACOS")"
    mkdir -p "$CACHE/macos" && unzip -q -o "$archive" -d "$CACHE/macos"
  fi
  echo "$dylib"
}

case "${1:-}" in
  fetch)
    case "${2:-}" in
      android) android ;;
      macos) macos ;;
      *) echo "usage: $0 fetch android|macos" >&2; exit 2 ;;
    esac
    ;;
  bundle-macos)
    app="${2:?usage: $0 bundle-macos <App.app>}"
    dylib="$(macos)"
    mkdir -p "$app/Contents/Frameworks"
    cp "$dylib" "$app/Contents/Frameworks/libmpv.2.dylib"
    codesign --force --sign - "$app/Contents/Frameworks/libmpv.2.dylib"
    codesign --force --sign - --preserve-metadata=entitlements "$app"
    ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
