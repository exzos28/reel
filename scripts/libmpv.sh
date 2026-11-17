#!/usr/bin/env bash
# libmpv for reel's video player, prebuilt as LGPL in https://github.com/exzos28/reel-libmpv
# (its scripts build it; see its README). Downloaded once per release into the cache, checked
# against the checksums pinned here.
#
#   scripts/libmpv.sh fetch android        # prints the directory with <abi>/*.so
#   scripts/libmpv.sh fetch macos          # prints the path of libmpv.2.dylib
#   scripts/libmpv.sh fetch linux          # prints the path of libmpv.so.2 for this machine's arch
#                                          # (REEL_LIBMPV_LINUX: a local one instead, for a build
#                                          # not released yet)
#   scripts/libmpv.sh bundle-macos <App.app>   # copies it into Contents/Frameworks, re-signs ad hoc
set -euo pipefail

REPO="exzos28/reel-libmpv"
TAG="mpv0.42-ffmpeg9.0.2-3"
SHA_ANDROID_ARM64="0b1b152692cd95f04319df61f7373ed872728fb422abb093f96c586456105578"
SHA_ANDROID_ARMV7="3dbb452564b8db40a9cf0e7cc0de75c1439a53775e450c58bea7574dd33152f0"
SHA_MACOS="734062af58e5545e731bb3c2d9af54b64bd12ccf9f484aa41b277c34669c5c94"
SHA_LINUX_X86_64="4e082e49d3a5eaa2a425ddcce59ccd6a3045ad811c6672dc5acd4146ea2358b3"
SHA_LINUX_AARCH64="da81036c566acd10f610e26370b2d1106ebd1d4cb3a46592dd5aa3adc4b78228"
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

linux() {
  if [ -n "${REEL_LIBMPV_LINUX:-}" ]; then
    echo "$REEL_LIBMPV_LINUX"
    return
  fi
  local arch sha
  case "$(uname -m)" in
    x86_64) arch=x86_64; sha="$SHA_LINUX_X86_64" ;;
    aarch64 | arm64) arch=aarch64; sha="$SHA_LINUX_AARCH64" ;;
    *) echo "libmpv: no Linux build for $(uname -m)" >&2; exit 1 ;;
  esac
  [ -n "$sha" ] || { echo "libmpv: release $TAG has no Linux build" >&2; exit 1; }
  local so="$CACHE/linux-$arch/libmpv.so.2"
  if [ ! -f "$so" ]; then
    local archive; archive="$(get "libmpv-linux-$arch.tar.gz" "$sha")"
    mkdir -p "$CACHE/linux-$arch" && tar -xzf "$archive" -C "$CACHE/linux-$arch"
  fi
  echo "$so"
}

case "${1:-}" in
  fetch)
    case "${2:-}" in
      android) android ;;
      macos) macos ;;
      linux) linux ;;
      *) echo "usage: $0 fetch android|macos|linux" >&2; exit 2 ;;
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
