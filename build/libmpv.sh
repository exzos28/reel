#!/usr/bin/env bash
# libmpv for reel's video player, prebuilt as LGPL in https://github.com/exzos28/reel-libmpv
# (its scripts build it; see its README). Downloaded once per release into the cache, checked
# against the checksums pinned here.
#
#   build/libmpv.sh fetch android        # prints the directory with <abi>/*.so
#   build/libmpv.sh fetch macos          # prints the path of libmpv.2.dylib
#   build/libmpv.sh fetch windows        # prints the path of libmpv-2.dll (x86_64)
#   build/libmpv.sh fetch linux          # prints the path of libmpv.so.2 for this machine's arch
#                                          # (REEL_LIBMPV_LINUX: a local one instead, for a build
#                                          # not released yet)
#   build/libmpv.sh fetch apple          # prints the path of Libmpv.xcframework (iOS, simulator)
#                                          # (REEL_LIBMPV_APPLE: a local one instead, for a build
#                                          # not released yet: reel-libmpv's apple/build.sh)
#   build/libmpv.sh bundle-macos <App.app>   # copies it into Contents/Frameworks, re-signs ad hoc
#   build/libmpv.sh bundle-ios <App.app> [simulator|device]
#                                            # that slice into <App>/Frameworks; the simulator's is
#                                            # signed ad hoc, a device's by build/ios-sign.sh after
set -euo pipefail

REPO="exzos28/reel-libmpv"
TAG="mpv0.42-ffmpeg9.0.2-5"
SHA_ANDROID_ARM64="79cae9a5725b75b0cad809b657fa504cb72f6057c16a4e2e5f0b45c2964a7158"
SHA_ANDROID_ARMV7="710a3d5954113d17efdda178dc35b38c741c8cda16ac9cde48ecde1664826df4"
SHA_MACOS="734062af58e5545e731bb3c2d9af54b64bd12ccf9f484aa41b277c34669c5c94"
SHA_LINUX_X86_64="28ee336bdd40805fdbfe00f6e588410a0f532f9f5643d50c8bd91d817d145988"
SHA_WINDOWS_X86_64="81c991359f08c9cabf1a256d3f47ca6ed92c5b30037420c474e76fa5ed2f6363"
SHA_APPLE="9a07a7eeacbbf3fe16160691986e4dd885f2fe87a328e2dd532f9293bb2890ba"
SHA_LINUX_AARCH64="dbe51a1b0a59a5de1b8916d236c617f0184bc9e827627aa56dca2fe2cc006044"
CACHE="${REEL_LIBMPV_CACHE:-$HOME/Library/Caches/reel/libmpv/$TAG}"

# Checks "<sha256>  <file>" lines on stdin: sha256sum where there is no shasum (Git Bash on Windows).
sha256_check() {
  if command -v shasum > /dev/null 2>&1; then shasum -a 256 -c -; else sha256sum -c -; fi
}

# Downloads a release file once and checks it.
get() {
  local name="$1" sha="$2" file="$CACHE/$1"
  if [ ! -f "$file" ] || ! echo "$sha  $file" | sha256_check >/dev/null 2>&1; then
    mkdir -p "$CACHE"
    curl -fsSL "https://github.com/$REPO/releases/download/$TAG/$name" -o "$file.part"
    echo "$sha  $file.part" | sha256_check >/dev/null || { rm -f "$file.part"; echo "libmpv: $name does not match its checksum" >&2; exit 1; }
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

windows() {
  if [ -n "${REEL_LIBMPV_WINDOWS:-}" ]; then
    echo "$REEL_LIBMPV_WINDOWS"
    return
  fi
  local dll="$CACHE/windows-x86_64/libmpv-2.dll"
  if [ ! -f "$dll" ]; then
    local archive; archive="$(get libmpv-windows-x86_64.zip "$SHA_WINDOWS_X86_64")"
    mkdir -p "$CACHE/windows-x86_64" && unzip -q -o "$archive" -d "$CACHE/windows-x86_64"
  fi
  echo "$dll"
}

apple() {
  if [ -n "${REEL_LIBMPV_APPLE:-}" ]; then
    echo "$REEL_LIBMPV_APPLE"
    return
  fi
  local xc="$CACHE/apple/Libmpv.xcframework"
  if [ ! -d "$xc" ]; then
    local archive; archive="$(get libmpv-apple.zip "$SHA_APPLE")"
    mkdir -p "$CACHE/apple" && unzip -q -o "$archive" -d "$CACHE/apple"
  fi
  echo "$xc"
}

case "${1:-}" in
  fetch)
    case "${2:-}" in
      android) android ;;
      macos) macos ;;
      linux) linux ;;
      windows) windows ;;
      apple) apple ;;
      *) echo "usage: $0 fetch android|macos|linux|windows|apple" >&2; exit 2 ;;
    esac
    ;;
  bundle-macos)
    app="${2:?usage: $0 bundle-macos <App.app>}"
    dylib="$(macos)"
    mkdir -p "$app/Contents/Frameworks"
    cp "$dylib" "$app/Contents/Frameworks/libmpv.2.dylib"
    # Its debug data names the paths it was built in (a home directory among them): the app
    # does not need it.
    strip -S -x "$app/Contents/Frameworks/libmpv.2.dylib" 2>/dev/null
    codesign --force --sign - "$app/Contents/Frameworks/libmpv.2.dylib"
    codesign --force --sign - --preserve-metadata=entitlements "$app"
    ;;
  bundle-ios)
    app="${2:?usage: $0 bundle-ios <App.app> [simulator|device]}"
    kind="${3:-simulator}"
    xc="$(apple)"
    case "$kind" in
      simulator) slice="$(find "$xc" -maxdepth 1 -type d -name 'ios-*simulator' | head -1)" ;;
      device) slice="$xc/ios-arm64" ;;
      *) echo "libmpv: bundle-ios takes simulator or device, not $kind" >&2; exit 2 ;;
    esac
    [ -d "$slice/Libmpv.framework" ] || { echo "libmpv: no $kind slice in $xc" >&2; exit 1; }
    mkdir -p "$app/Frameworks"
    rm -rf "$app/Frameworks/Libmpv.framework"
    cp -R "$slice/Libmpv.framework" "$app/Frameworks/"
    strip -S -x "$app/Frameworks/Libmpv.framework/Libmpv" 2>/dev/null
    if [ "$kind" = simulator ]; then
      codesign --force --sign - "$app/Frameworks/Libmpv.framework"
      codesign --force --sign - --preserve-metadata=entitlements "$app"
    fi
    ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
