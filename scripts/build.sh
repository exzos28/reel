#!/usr/bin/env bash
# Builds reel for one target, the same way locally and in CI.
#
#   scripts/build.sh <target>
#
# Targets:
#   check          nsh check (cargo check of app/ + TypeScript)
#   test           nsh test (cargo test of app/, then the *.test.tsx files, headless)
#   macos          .app, zipped                       (macOS)
#   linux          directory + .tar.gz                (Linux, GTK 4.14+)
#   windows        directory .zip (+ setup.exe when Inno Setup 6 is installed)  (Windows)
#   android        .apk (debug key unless REEL_ANDROID_KEYSTORE is set)
#   ios-simulator  universal (iPhone + iPad) simulator .app, zipped  (macOS + Xcode)
#   ios            signed .ipa; needs REEL_IOS_SIGN_IDENTITY and REEL_IOS_PROFILE (macOS + Xcode)
#   web            static site, tarred
#   armv7          the Rust crate as a cdylib for armv7-unknown-linux-gnueabi (Tizen core smoke test)
#   tpk            Tizen .tpk (not implemented until hosts/tizen exists)
#
# Deliverables land in app/.nsh/dist/<target>/ as reel-<target>*.{zip,tar.gz,apk,ipa,so};
# nsh's raw output is in app/.nsh/dist/<target>/pkg/.
#
# Environment (all optional):
#   REEL_TMDB_TOKEN        baked into the binary by option_env!; without it the app asks for a key
#   REEL_VERSION           overrides nsh.json "version" (--app-version)
#   REEL_BUILD             overrides nsh.json "build" (--build)
#   REEL_MACOS_ARCH        arm64 | x86_64 | universal (default: this Mac's)
#   REEL_ANDROID_KEYSTORE  release keystore path; with REEL_ANDROID_KEY_ALIAS and NSH_KEYSTORE_PASSWORD
#   REEL_ANDROID_ABI       --abi value (default: nsh's, arm64-v8a + armeabi-v7a)
#   REEL_IOS_SIGN_IDENTITY, REEL_IOS_PROFILE   for the ios target
set -euo pipefail

target="${1:-}"
if [ -z "$target" ]; then
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
  exit 2
fi

repo="$(cd "$(dirname "$0")/.." && pwd)"
app="$repo/app"
cd "$app"

# Paths handed to nsh stay relative to app/ so they work in Git Bash on Windows too.
out=".nsh/dist/$target"
pkg="$out/pkg"

log() { printf '==> %s\n' "$*" >&2; }
die() { printf 'build.sh: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" > /dev/null 2>&1 || die "$1 not found${2:+: $2}"; }

rust_targets() {
  need rustup "install Rust with rustup"
  rustup target add "$@" > /dev/null
}

fresh_out() {
  rm -rf "$out"
  mkdir -p "$pkg"
}

package() {
  local flags=()
  # A tag such as v1.2.0 is accepted: nsh takes the version without the v.
  [ -n "${REEL_VERSION:-}" ] && flags+=(--app-version "${REEL_VERSION#v}")
  [ -n "${REEL_BUILD:-}" ] && flags+=(--build "$REEL_BUILD")
  log "nsh package . --target $1 -o $pkg ${flags[*]-} ${*:2}"
  nsh package . --target "$1" -o "$pkg" ${flags[@]+"${flags[@]}"} "${@:2}"
}

# The single file or directory nsh wrote that matches the glob, or an error.
one() {
  local matches=()
  for f in $1; do [ -e "$f" ] && matches+=("$f"); done
  [ "${#matches[@]}" -eq 1 ] || die "expected one $1, found ${#matches[@]}: ${matches[*]-}"
  printf '%s\n' "${matches[0]}"
}

tmdb_note() {
  if [ -n "${REEL_TMDB_TOKEN:-}" ]; then log "REEL_TMDB_TOKEN is set: baked into the build"
  else log "REEL_TMDB_TOKEN is not set: the app will ask the user for a TMDB key"; fi
}

need nsh "run scripts/install-nsh.sh"

case "$target" in
  check)
    nsh check .
    ;;

  test)
    mkdir -p "$out"
    nsh test . --junit "$out/junit.xml"
    ;;

  macos)
    [ "$(uname -s)" = Darwin ] || die "macos packages are built on macOS"
    tmdb_note
    fresh_out
    arch_flags=()
    if [ -n "${REEL_MACOS_ARCH:-}" ]; then
      arch_flags=(--arch "$REEL_MACOS_ARCH")
      case "$REEL_MACOS_ARCH" in
        x86_64) rust_targets x86_64-apple-darwin ;;
        universal) rust_targets x86_64-apple-darwin aarch64-apple-darwin ;;
      esac
    fi
    package macos ${arch_flags[@]+"${arch_flags[@]}"}
    bundle="$(one "$pkg/*.app")"
    arch="${REEL_MACOS_ARCH:-$(uname -m)}"
    ditto -c -k --keepParent "$bundle" "$out/reel-macos-$arch.zip"
    ;;

  linux)
    [ "$(uname -s)" = Linux ] || die "linux packages are built on Linux"
    tmdb_note
    fresh_out
    package linux
    cp "$(one "$pkg/*.tar.gz")" "$out/reel-linux-$(uname -m).tar.gz"
    ;;

  windows)
    case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) ;; *) die "windows packages are built on Windows" ;; esac
    tmdb_note
    fresh_out
    package windows
    cp "$(one "$pkg/*.zip")" "$out/reel-windows-x86_64.zip"
    for setup in "$pkg"/*-setup.exe; do
      [ -e "$setup" ] && cp "$setup" "$out/reel-windows-x86_64-setup.exe"
    done
    ;;

  android)
    tmdb_note
    [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || [ -d "$HOME/Library/Android/sdk" ] \
      || die "no Android SDK: set ANDROID_HOME (scripts/setup-android-sdk.sh installs what nsh needs)"
    rust_targets aarch64-linux-android armv7-linux-androideabi
    fresh_out
    flags=()
    [ -n "${REEL_ANDROID_ABI:-}" ] && flags+=(--abi "$REEL_ANDROID_ABI")
    if [ -n "${REEL_ANDROID_KEYSTORE:-}" ]; then
      [ -n "${REEL_ANDROID_KEY_ALIAS:-}" ] || die "REEL_ANDROID_KEYSTORE needs REEL_ANDROID_KEY_ALIAS"
      [ -n "${NSH_KEYSTORE_PASSWORD:-}" ] || die "REEL_ANDROID_KEYSTORE needs NSH_KEYSTORE_PASSWORD"
      flags+=(--keystore "$REEL_ANDROID_KEYSTORE" --key-alias "$REEL_ANDROID_KEY_ALIAS")
      suffix=release
    else
      log "no REEL_ANDROID_KEYSTORE: signing with the debug key (not for store releases)"
      suffix=debug
    fi
    package android ${flags[@]+"${flags[@]}"}
    cp "$(one "$pkg/*.apk")" "$out/reel-android-$suffix.apk"
    ;;

  ios-simulator)
    [ "$(uname -s)" = Darwin ] || die "iOS builds need macOS with Xcode"
    tmdb_note
    rust_targets aarch64-apple-ios-sim
    fresh_out
    package ios-simulator
    bundle="$(one "$pkg/*.app")"
    # The app must stay universal: UIDeviceFamily 1 (iPhone) and 2 (iPad).
    families="$(plutil -extract UIDeviceFamily json -o - "$bundle/Info.plist")"
    log "UIDeviceFamily: $families"
    case "$families" in *1*2* | *2*1*) ;; *) die "the simulator app is not universal (UIDeviceFamily $families)" ;; esac
    ditto -c -k --keepParent "$bundle" "$out/reel-ios-simulator.zip"
    ;;

  ios)
    [ "$(uname -s)" = Darwin ] || die "iOS builds need macOS with Xcode"
    [ -n "${REEL_IOS_SIGN_IDENTITY:-}" ] || die "REEL_IOS_SIGN_IDENTITY is not set (an Apple Development/Distribution identity)"
    [ -f "${REEL_IOS_PROFILE:-}" ] || die "REEL_IOS_PROFILE is not a file (a .mobileprovision)"
    tmdb_note
    rust_targets aarch64-apple-ios
    fresh_out
    package ios --sign "$REEL_IOS_SIGN_IDENTITY" --profile "$REEL_IOS_PROFILE"
    cp "$(one "$pkg/*.ipa")" "$out/reel-ios.ipa"
    ;;

  web)
    tmdb_note
    rust_targets wasm32-unknown-unknown
    fresh_out
    package web
    site="$(one "$pkg/*/")"
    tar -C "$(dirname "$site")" -czf "$out/reel-web.tar.gz" "$(basename "$site")"
    ;;

  armv7)
    # Smoke test of the Tizen core toolchain: the crate linked as a shared library for
    # armv7 Linux, soft-float calling convention (Tizen's armv7l is softfp, which is
    # ABI-compatible). app/Cargo.toml has no [lib] crate-type, so it is set here with
    # `cargo rustc --crate-type cdylib` instead of changing the manifest.
    triple=armv7-unknown-linux-gnueabi
    cc=arm-linux-gnueabi-gcc
    need "$cc" "run scripts/setup-armv7-deps.sh (Debian) for the cross compiler and armel OpenSSL"
    tmdb_note
    rust_targets "$triple"
    fresh_out
    export CARGO_TARGET_ARMV7_UNKNOWN_LINUX_GNUEABI_LINKER="$cc"
    export CC_armv7_unknown_linux_gnueabi="$cc"
    export AR_armv7_unknown_linux_gnueabi=arm-linux-gnueabi-ar
    # openssl-sys (librqbit's default sha1 backend) finds the armel OpenSSL through pkg-config.
    export PKG_CONFIG_ALLOW_CROSS=1
    export PKG_CONFIG_LIBDIR=/usr/lib/arm-linux-gnueabi/pkgconfig:/usr/share/pkgconfig
    cargo rustc --locked --release --lib --target "$triple" --crate-type cdylib
    so="${CARGO_TARGET_DIR:-target}/$triple/release/libreel_app.so"
    [ -f "$so" ] || die "no $so"
    cp "$so" "$out/reel-core-$triple.so"
    file "$out/reel-core-$triple.so" 2> /dev/null || true
    ;;

  tpk)
    # TODO(tizen): once hosts/tizen (the .NET Tizen shell) exists, build it with the
    # Tizen Studio CLI here: `tz build` / `tizen build-cs`, then `tizen package -t tpk -s <profile>`
    # with the armv7 core (.so) and the web build inside, signed with a Samsung certificate.
    [ -d "$repo/hosts/tizen" ] || die "hosts/tizen does not exist yet; nothing to package"
    die "tpk packaging is not implemented yet (see the TODO in scripts/build.sh)"
    ;;

  *)
    die "unknown target '$target' (run without arguments for the list)"
    ;;
esac

if [ -d "$out" ]; then
  log "done: $app/$out"
  ls -la "$out" >&2
fi
