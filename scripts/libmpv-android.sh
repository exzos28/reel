#!/usr/bin/env bash
# libmpv for Android (the `reel/mpv` video view), built with mpv-android's build scripts
# (https://github.com/mpv-android/mpv-android) in Docker, as LGPL: ffmpeg without
# --enable-gpl, mpv with -Dgpl=false (as the macOS libmpv, scripts/libmpv-macos.sh).
# The work tree (the SDK and NDK the scripts download, sources, builds) lives in a Docker
# volume: the NDK has headers that differ only in case, which a Mac's disk cannot hold.
# The libraries come out to $CACHE/libs/<abi>.
#
#   scripts/libmpv-android.sh image                  # the build image
#   scripts/libmpv-android.sh deps                   # mpv-android's scripts, SDK and NDK, sources
#   scripts/libmpv-android.sh build <arch> [target]  # arch: arm64 | armv7l; target: mpv (default) or a dependency
#   scripts/libmpv-android.sh libs                   # copy the .so files out
#   scripts/libmpv-android.sh clean                  # remove the volume
set -euo pipefail

COMMIT="ebf1b3f"   # mpv-android, 2026-11-08
IMAGE="reel-libmpv-android:3"
VOLUME="reel-libmpv-android"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${REEL_LIBMPV_ANDROID_CACHE:-$HOME/Library/Caches/reel/libmpv-android}"

run() {
  docker run --rm --platform linux/amd64 -v "$VOLUME:/work" -v "$CACHE:/out" -w /work "$IMAGE" bash -euo pipefail -c "$1"
}

case "${1:-}" in
  image)
    docker build --platform linux/amd64 -t "$IMAGE" "$ROOT/scripts/libmpv-android"
    ;;
  deps)
    mkdir -p "$CACHE"
    run "
      [ -d mpv-android/.git ] || git clone -q https://github.com/mpv-android/mpv-android.git
      cd mpv-android && git fetch -q origin && git checkout -q $COMMIT && cd buildscripts
      # LGPL: no GPL parts in ffmpeg or mpv.
      sed -i 's/--enable-{gpl,version3}/--enable-version3/' scripts/ffmpeg.sh
      grep -q -- -Dgpl=false scripts/mpv.sh || sed -i 's/-Dlibmpv=true -Dcplayer=false/-Dlibmpv=true -Dcplayer=false -Dgpl=false/' scripts/mpv.sh
      grep -n 'enable-version3' scripts/ffmpeg.sh; grep -n 'gpl' scripts/mpv.sh
      IN_CI=1 ./download.sh
    "
    ;;
  build)
    arch="${2:?arm64 or armv7l}"
    run "cd mpv-android/buildscripts && ./buildall.sh --arch $arch ${3:-mpv}"
    ;;
  libs)
    mkdir -p "$CACHE"
    run "
      for pair in arm64:arm64-v8a armv7l:armeabi-v7a; do
        arch=\${pair%%:*}; abi=\${pair##*:}
        [ -f mpv-android/buildscripts/prefix/\$arch/lib/libmpv.so ] || continue   # not built
        mkdir -p /out/libs/\$abi
        cp -L mpv-android/buildscripts/prefix/\$arch/lib/*.so /out/libs/\$abi/
        # libmpv links the NDK's shared C++ library: it goes in the APK beside it.
        triple=\$([ \$arch = arm64 ] && echo aarch64-linux-android || echo arm-linux-androideabi)
        cp -L mpv-android/buildscripts/sdk/android-ndk-r30/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/\$triple/libc++_shared.so /out/libs/\$abi/
        # Without their debug symbols (what goes in the APK).
        mpv-android/buildscripts/sdk/android-ndk-r30/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip --strip-unneeded /out/libs/\$abi/*.so
      done
    "
    ls -la "$CACHE/libs"/*
    ;;
  clean)
    docker volume rm "$VOLUME"
    ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
