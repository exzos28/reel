#!/usr/bin/env bash
# Builds reel for one target, the same way locally and in CI.
#
#   build/build.sh <target>
#
# Targets:
#   check          typecheck + no-engine
#   typecheck      nsh check (cargo check of app/ + TypeScript)
#   no-engine      app/ checked without the engine (cargo check --no-default-features)
#   test           test-crates + test-app
#   test-crates    cargo test of the domain and engine crates (no GTK, no nsh needed)
#   test-app       nsh test (cargo test of app/, then the *.test.tsx files, headless)
#   test-rust      cargo test of app/ only (test-app's first half)
#   test-ui <n>    the *.test.tsx files of part n of 3 (test-app's second half, split for CI)
#   ui-rules       dev/ui-rules.sh (what screens must not do)
#   macos          .app, zipped                       (macOS)
#   linux          directory + .tar.gz                (Linux, GTK 4.14+)
#   windows        directory .zip (+ setup.exe when Inno Setup 6 is installed)  (Windows)
#   android        .apk (debug key unless REEL_ANDROID_KEYSTORE is set)
#   ios-simulator  universal (iPhone + iPad) simulator .app, zipped  (macOS + Xcode)
#   ios            signed .ipa; needs REEL_IOS_SIGN_IDENTITY and REEL_IOS_PROFILE (macOS + Xcode)
#   web            static site, tarred
#
# Deliverables land in app/.nsh/dist/<target>/ as reel-<target>*.{zip,tar.gz,apk,ipa};
# nsh's raw output is in app/.nsh/dist/<target>/pkg/.
#
# Environment (all optional):
#   REEL_TMDB_TOKEN        baked into the binary by option_env!; without it the app asks for a key
#   REEL_VERSION           overrides nsh.json "version" (--app-version), local test builds only
#   REEL_BUILD             overrides nsh.json "build" (--build), local test builds only
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

case "$target" in
  # These need only cargo or bash, not nsh.
  test-crates)
    cargo test --locked -p reel-domain -p reel-engine
    exit 0
    ;;
  ui-rules)
    exec "$repo/dev/ui-rules.sh"
    ;;
esac

need nsh "run build/install-nsh.sh"

# No personal data in a package: the compiler writes source paths into binaries (panic messages,
# debug info), and they would name the builder's home directory. They are mapped to neutral
# ones (the last match wins, so the broad $HOME goes first); package_check fails the build on
# anything left. Cargo's build.rustflags, not RUSTFLAGS: that would override the per-target
# flags nsh sets (Windows' static CRT, the web's getrandom backend), which take precedence here.
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
export CARGO_BUILD_RUSTFLAGS="${CARGO_BUILD_RUSTFLAGS:-} --remap-path-prefix=$HOME=/home --remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=${RUSTUP_HOME:-$HOME/.rustup}=/rustup --remap-path-prefix=$repo=/reel"
# C and C++ built by crates (QuickJS, ring…) write their source paths too (assert messages).
export CFLAGS="${CFLAGS:-} -ffile-prefix-map=$HOME=/home -ffile-prefix-map=$repo=/reel"
export CXXFLAGS="${CXXFLAGS:-} -ffile-prefix-map=$HOME=/home -ffile-prefix-map=$repo=/reel"
package_check() { python3 -I "$repo/build/package-check.py" "$@" || die "the package depends on the build machine (above)"; }

case "$target" in
  check)
    "$0" typecheck
    "$0" no-engine
    ;;

  typecheck)
    nsh check .
    ;;

  no-engine)
    # Builds without the torrent engine must keep compiling (docs/architecture.md).
    cargo check --locked --no-default-features -p reel-app
    ;;

  test)
    "$0" test-crates
    "$0" test-app
    ;;

  test-app)
    # nsh test runs reel-app's own tests; the workspace's other crates are test-crates.
    out=".nsh/dist/test"
    mkdir -p "$out"
    nsh test . --junit "$out/junit.xml"
    ;;

  test-rust)
    cargo test --locked -p reel-app
    ;;

  test-ui)
    # The *.test.tsx files in three parts of about a minute each on a CI Mac (by their times
    # there): CI runs the parts side by side. A file not named here is part 3's.
    part="${2:-}"
    part1="App Hosted Touch"
    part2="Browse Search"
    case "$part" in
      1) files="$part1" ;;
      2) files="$part2" ;;
      3)
        # Everything not in parts 1 and 2 (macOS's bash 3.2 cannot parse a case inside $(…)).
        files=""
        for f in *.test.tsx; do
          n="${f%.test.tsx}"
          case " $part1 $part2 " in
            *" $n "*) ;;
            *) files="$files $n" ;;
          esac
        done
        ;;
      *) die "test-ui <1|2|3>" ;;
    esac
    out=".nsh/dist/test"
    mkdir -p "$out"
    failed=0
    for n in $files; do
      log "== $n.test.tsx"
      nsh test "$n.test.tsx" --junit "$out/junit-$n.xml" || failed=1
    done
    [ "$failed" = 0 ] || die "test-ui $part: a test failed (above)"
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
    # libmpv for the mpv video view: without it the app falls back to the system player,
    # which plays no MKV ("This file's format does not play on this device").
    "$repo/build/libmpv.sh" bundle-macos "$bundle"
    arch="${REEL_MACOS_ARCH:-$(uname -m)}"
    # Zipped without this machine's metadata (owners, extended attributes, file times).
    python3 -I "$repo/build/pack.py" zip "$bundle" "$out/reel-macos-$arch.zip"
    package_check "$out/reel-macos-$arch.zip"
    ;;

  linux)
    [ "$(uname -s)" = Linux ] || die "linux packages are built on Linux"
    tmdb_note
    fresh_out
    package linux
    # libmpv for the mpv video view, beside the runner (where the app looks first); the
    # archive is made again with it.
    app_dir="$(dirname "$(one "$pkg/*/*.desktop")")"
    mpv="$("$repo/build/libmpv.sh" fetch linux)"
    cp "$mpv" "$app_dir/libmpv.so.2"
    rm -f "$pkg"/*.tar.gz
    # Without this machine's metadata: root as the owner, the last commit's time on every file.
    tar --owner=0 --group=0 --numeric-owner --sort=name --mtime="@${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}" \
      -czf "$pkg/$(basename "$app_dir").tar.gz" -C "$(dirname "$app_dir")" "$(basename "$app_dir")"
    cp "$(one "$pkg/*.tar.gz")" "$out/reel-linux-$(uname -m).tar.gz"
    package_check "$app_dir"
    ;;

  windows)
    # On Windows, or cross-compiled with cargo-xwin (build/linux-docker.sh windows).
    case "$(uname -s)" in
      MINGW* | MSYS* | CYGWIN*) ;;
      *) command -v cargo-xwin >/dev/null || die "windows packages are built on Windows, or with cargo-xwin" ;;
    esac
    tmdb_note
    fresh_out
    package windows
    # libmpv for the mpv video view, beside reel.exe (where the app looks first); the archive
    # is made again with it.
    app_dir="$(dirname "$(one "$pkg/*/*.exe")")"
    mpv="$("$repo/build/libmpv.sh" fetch windows)"
    cp "$mpv" "$app_dir/libmpv-2.dll"
    rm -f "$pkg"/*.zip
    zip_out="$(cd "$pkg" && pwd)/$(basename "$app_dir").zip"
    # Without this machine's metadata (owners, file times).
    python3 -I "$repo/build/pack.py" zip "$app_dir" "$zip_out"
    cp "$(one "$pkg/*.zip")" "$out/reel-windows-x86_64.zip"
    for setup in "$pkg"/*-setup.exe; do
      [ -e "$setup" ] && cp "$setup" "$out/reel-windows-x86_64-setup.exe"
    done
    package_check "$out/reel-windows-x86_64.zip"
    ;;

  android)
    tmdb_note
    [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || [ -d "$HOME/Library/Android/sdk" ] \
      || die "no Android SDK: set ANDROID_HOME (build/setup-android-sdk.sh installs what nsh needs)"
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
    # reel's own Java (native views: app/android), which nsh does not package.
    "$repo/build/android-views.sh" "$(one "$pkg/*.apk")"
    cp "$(one "$pkg/*.apk")" "$out/reel-android-$suffix.apk"
    package_check "$out/reel-android-$suffix.apk"
    ;;

  ios-simulator)
    [ "$(uname -s)" = Darwin ] || die "iOS builds need macOS with Xcode"
    tmdb_note
    rust_targets aarch64-apple-ios-sim
    fresh_out
    package ios-simulator
    bundle="$(one "$pkg/*.app")"
    # The video player: libmpv's framework in the app (it plays MKV, every codec).
    "$repo/build/libmpv.sh" bundle-ios "$bundle"
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

  *)
    die "unknown target '$target' (run without arguments for the list)"
    ;;
esac

# The packages go to out/<target>/ at the repository's root, beside every other build's.
if [ -d "$out" ]; then
  final="$repo/out/$target"
  mkdir -p "$final"
  for f in "$out"/reel-*; do [ -f "$f" ] && cp "$f" "$final/"; done
  log "done: $final"
  ls -la "$final" >&2
fi
