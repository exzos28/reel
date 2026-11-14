#!/usr/bin/env bash
# Builds reel for Samsung TVs (Tizen): one hybrid .wgt, as tizen-os-ambilight ships it:
#
#   the TV app (ui/: shell + the NSH web build of app/) and
#   the core service (service/: .NET service app that loads libreel_tizen_core.so, the
#   Rust core cross-compiled for armv7) in one package.
#
# The package is signed with the Tizen SDK's default certificate. A retail TV only takes a
# package signed for its own DUID, so it does not install as is: Apps2Samsung re-signs it for
# the user's TV. Install steps: docs/tizen.md.
#
# Usage: hosts/tizen/build.sh <command> [options]
#   check                 what is installed, what is missing (exit 1 if anything is)
#   core                  cross-compile the core: out/libreel_tizen_core.so
#   web                   the NSH web build of app/: out/web/
#   package [--shell-only] [out-dir]
#                         core + web + service + hybrid .wgt: out/reel-tv-v<version>.wgt
#                         --shell-only: no web build, the app shows its diagnostics screen
#                         (the core, the RPC and AVPlay on the TV, without the UI)
#
# Needs (check lists them with sizes):
#   core     rustup target armv7-unknown-linux-gnueabi, and a C cross toolchain: zig with
#            cargo-zigbuild (default), or REEL_TIZEN_CC=arm-linux-gnueabi-gcc (Debian, as CI)
#   web      nsh with its web runtime, and a clang that targets wasm32 for the runtime's C
#            dependencies (zstd-sys): Homebrew LLVM on macOS (Apple's clang has no wasm32)
#   package  .NET SDK 8 with the Tizen workload, the Tizen-Core CLI ($TIZEN_SDK/tools/tizen-core/tz,
#            default ~/tizen-sdk), zip, unzip, python3
#
# Environment:
#   REEL_TIZEN_CC     a gcc for armv7 Linux; set to build the core with it instead of zig
#   REEL_TIZEN_GLIBC  oldest glibc the core may need, zig builds only (default 2.28)
#   TIZEN_SDK         Tizen SDK root (default ~/tizen-sdk)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
APP="$REPO/app"
TRIPLE=armv7-unknown-linux-gnueabi   # Tizen's armv7l is softfp: soft-float calls, ABI-compatible
GLIBC="${REEL_TIZEN_GLIBC:-2.28}"
SDK="${TIZEN_SDK:-$HOME/tizen-sdk}"
TZ="$SDK/tools/tizen-core/tz"   # Tizen-Core CLI, the packager the VS Code Tizen extension uses

log() { printf '== %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" > /dev/null 2>&1; }

version() {
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$APP/nsh.json"
}

# ---- check ----

check() {
    local missing=0
    row() { # name, ok?, hint
        if [ "$2" = 1 ]; then printf '  ok       %s\n' "$1"; else printf '  MISSING  %-34s %s\n' "$1" "$3"; missing=1; fi
    }
    is() { if "$@" > /dev/null 2>&1; then echo 1; else echo 0; fi; }
    echo "core (Rust → armv7 Linux):"
    row "cargo" "$(is have cargo)" "rustup.rs"
    row "rust-std $TRIPLE" "$(is sh -c "rustup target list --installed | grep -qx $TRIPLE")" "rustup target add $TRIPLE   (download ~27 MB)"
    if [ -n "${REEL_TIZEN_CC:-}" ]; then
        row "REEL_TIZEN_CC=$REEL_TIZEN_CC" "$(is have "$REEL_TIZEN_CC")" "Debian: scripts/setup-armv7-deps.sh"
    else
        row "zig" "$(is have zig)" "brew install zig   (download ~48 MB, ~300 MB installed)"
        row "cargo-zigbuild" "$(is have cargo-zigbuild)" "cargo install --locked cargo-zigbuild   (builds from source, ~1 min)"
    fi
    echo "web (NSH web build of app/):"
    row "nsh" "$(is have nsh)" "scripts/install-nsh.sh"
    row "clang for wasm32 ($(wasm_cc))" "$(is sh -c "echo 'int x;' | '$(wasm_cc)' --target=wasm32-unknown-unknown -c -x c - -o /dev/null")" "brew install llvm   (or set CC_wasm32_unknown_unknown)"
    echo "package (service + hybrid .wgt):"
    row "dotnet (SDK 8)" "$(is have dotnet)" "https://dot.net (SDK 8 for macOS arm64: download ~200 MB, ~600 MB installed)"
    row "Tizen .NET workload" "$(is sh -c 'dotnet workload list | grep -qi tizen')" "curl -sSL https://raw.githubusercontent.com/Samsung/Tizen.NET/main/workload/scripts/workload-install.sh | bash"
    row "Tizen-Core CLI ($TZ)" "$(is test -x "$TZ")" "VS Code: Tizen extension installs ~/tizen-sdk; or Tizen Studio CLI (installer ~264 MB)"
    row "zip / unzip" "$(is sh -c 'command -v zip && command -v unzip')" ""
    return $missing
}

# ---- core ----

build_core() {
    local out="$1"
    have cargo || die "cargo not found"
    rustup target list --installed | grep -qx "$TRIPLE" || die "rust-std for $TRIPLE missing: rustup target add $TRIPLE (run '$0 check')"
    local so="$HERE/target/$TRIPLE/release/libreel_tizen_core.so"
    if [ -n "${REEL_TIZEN_CC:-}" ]; then
        have "$REEL_TIZEN_CC" || die "REEL_TIZEN_CC=$REEL_TIZEN_CC not found"
        log "core: cargo build --target $TRIPLE with $REEL_TIZEN_CC"
        local var; var="$(echo "$TRIPLE" | tr '[:lower:]-' '[:upper:]_')"
        export "CARGO_TARGET_${var}_LINKER=$REEL_TIZEN_CC"
        export "CC_${TRIPLE//-/_}=$REEL_TIZEN_CC"
        export "AR_${TRIPLE//-/_}=${REEL_TIZEN_CC%gcc}ar"
        (cd "$HERE" && cargo build --locked --release -p reel-tizen-core --lib --target "$TRIPLE")
    else
        have zig || die "zig not found (or set REEL_TIZEN_CC; run '$0 check')"
        # ring's ARM assembly needs NEON, which zig leaves off for plain armv7. Every Samsung
        # TV SoC (Cortex-A53/A73 running 32-bit) has it; cortex_a7 = ARMv7-A + NEON + VFPv4.
        export "CFLAGS_${TRIPLE//-/_}=${CFLAGS_ARMV7:--mcpu=cortex_a7}"
        # Some crates ask to link the system libatomic; zig has no such library (its
        # compiler-rt provides the atomics). Link an empty stand-in and drop it again with
        # --as-needed, so the .so does not need a libatomic on the TV either.
        local var; var="$(echo "$TRIPLE" | tr '[:lower:]-' '[:upper:]_')"
        local stub="$HERE/target/zig-stubs"
        mkdir -p "$stub"
        [ -f "$stub/libatomic.so" ] || printf '' | zig cc -target arm-linux-gnueabi -shared -x c - -o "$stub/libatomic.so"
        export "CARGO_TARGET_${var}_RUSTFLAGS=-L native=$stub -C link-arg=-Wl,--as-needed"
        have cargo-zigbuild || die "cargo-zigbuild not found (run '$0 check')"
        log "core: cargo zigbuild --target $TRIPLE.$GLIBC"
        (cd "$HERE" && cargo zigbuild --release -p reel-tizen-core --lib --target "$TRIPLE.$GLIBC")
    fi
    [ -f "$so" ] || die "no $so"
    mkdir -p "$out"
    cp "$so" "$out/libreel_tizen_core.so"
    file "$out/libreel_tizen_core.so" 2> /dev/null || true
    # What the TV's glibc must have: the newest GLIBC_x.y symbol version the library asks for.
    local readelf
    readelf="$(command -v llvm-readelf || command -v arm-linux-gnueabi-readelf || command -v readelf || true)"
    [ -x /opt/homebrew/opt/llvm/bin/llvm-readelf ] && readelf=/opt/homebrew/opt/llvm/bin/llvm-readelf
    if [ -n "$readelf" ]; then
        local need; need="$("$readelf" -V "$out/libreel_tizen_core.so" 2> /dev/null | grep -o 'GLIBC_[0-9.]*' | sort -t. -k2,2n -k3,3n -u | tail -1)"
        log "core needs ${need:-no versioned glibc symbols}"
        "$readelf" -s --dyn-syms "$out/libreel_tizen_core.so" 2> /dev/null | grep -q reel_core_start || die "reel_core_start is not exported"
    fi
    ls -l "$out/libreel_tizen_core.so"
}

# ---- web ----

# The C compiler for wasm32: CC_wasm32_unknown_unknown if set, else Homebrew LLVM's clang
# on macOS, else clang.
wasm_cc() {
    if [ -n "${CC_wasm32_unknown_unknown:-}" ]; then echo "$CC_wasm32_unknown_unknown"
    elif [ -x /opt/homebrew/opt/llvm/bin/clang ]; then echo /opt/homebrew/opt/llvm/bin/clang
    else echo clang
    fi
}

build_web() {
    local out="$1"
    have nsh || die "nsh not found (scripts/install-nsh.sh)"
    local cc; cc="$(wasm_cc)"
    export CC_wasm32_unknown_unknown="$cc"
    export AR_wasm32_unknown_unknown="${AR_wasm32_unknown_unknown:-$(dirname "$cc")/llvm-ar}"
    [ -x "$AR_wasm32_unknown_unknown" ] || AR_wasm32_unknown_unknown=llvm-ar
    log "web: nsh package --target web (app/), wasm C compiler $cc"
    local tmp; tmp="$(mktemp -d)"
    if ! (cd "$APP" && nsh package . --target web -o "$tmp"); then
        rm -rf "$tmp"
        die "the NSH web build of app/ failed. Until app/ builds for wasm32 and takes its modules from
the core over HTTP (docs/tizen.md, \"Changes in app/\"), use: $0 package --shell-only"
    fi
    # nsh writes <out>/<app name>/index.html.
    local index; index="$(find "$tmp" -maxdepth 2 -name index.html | head -n 1)"
    [ -n "$index" ] || die "nsh wrote no index.html under $tmp"
    rm -rf "$out"
    mkdir -p "$(dirname "$out")"
    mv "$(dirname "$index")" "$out"
    rm -rf "$tmp"
    du -sh "$out"
}

# ---- package ----

package() {
    local shell_only=0 out=""
    for a in "$@"; do
        case "$a" in
            --shell-only) shell_only=1 ;;
            -*) die "unknown option $a" ;;
            *) out="$a" ;;
        esac
    done
    out="${out:-$HERE/out}"
    mkdir -p "$out"
    out="$(cd "$out" && pwd)"
    [ -x "$TZ" ] || die "$TZ not found (set TIZEN_SDK; run '$0 check')"
    have dotnet || die "dotnet not found (run '$0 check')"
    have zip || die "zip is required"
    local ver; ver="$(version)"
    local work; work="$(mktemp -d)"
    # The trap runs after this function returns, when `work` is gone: keep a global copy.
    REEL_TIZEN_WORK="$work"
    trap 'rm -rf "${REEL_TIZEN_WORK:-}"' EXIT

    build_core "$out"

    log "service (.tpk), version $ver"
    rsync -a --exclude bin --exclude obj --exclude lib "$HERE/service/" "$work/service/"
    mkdir -p "$work/service/lib"
    cp "$out/libreel_tizen_core.so" "$work/service/lib/"
    sed -i.bak "s/ version=\"[^\"]*\"/ version=\"$ver\"/" "$work/service/tizen-manifest.xml" && rm "$work/service/tizen-manifest.xml.bak"
    dotnet build "$work/service/ReelCore.csproj" -c Release -v:m -nologo
    local tpk; tpk="$(find "$work/service/bin/Release" -name '*.tpk' | head -n 1)"
    [ -n "$tpk" ] || die "no .tpk built"
    for f in tizen-manifest.xml bin/ReelCore.dll lib/libreel_tizen_core.so; do
        unzip -l "$tpk" | grep -q " $f\$" || die "$f is missing from the .tpk"
    done

    log "TV app"
    mkdir -p "$work/ui"
    cp "$HERE/ui/config.xml" "$HERE/ui/index.html" "$HERE/ui/shell.js" "$work/ui/"
    sed -i.bak "s/ version=\"[^\"]*\" viewmodes/ version=\"$ver\" viewmodes/" "$work/ui/config.xml" && rm "$work/ui/config.xml.bak"
    if [ "$shell_only" = 1 ]; then
        echo "window.REEL_WEB = false;" > "$work/ui/shell-config.js"
    else
        build_web "$work/ui/web"
        echo "window.REEL_WEB = true;" > "$work/ui/shell-config.js"
    fi

    log "hybrid package"
    # As tizen-os-ambilight's tv/scripts/make_package.sh: the web app as a plain zip is the base
    # package; tz pack adds the service .tpk (hybrid) and signs with the SDK's default
    # certificate, which Apps2Samsung replaces.
    (cd "$work/ui" && zip -qr "$work/web.wgt" .)
    "$TZ" pack -t wgt -k "$tpk" -b "$work/web.wgt" -o "$work/hybrid.wgt"
    [ -f "$work/hybrid.wgt" ] || die "tz pack produced no package"
    local name="reel-tv-v$ver.wgt"
    cp "$work/hybrid.wgt" "$out/$name"
    for f in config.xml index.html shell.js shell-config.js ReelCore.dll libreel_tizen_core.so; do
        unzip -l "$out/$name" | grep -q "$f" || die "$f is missing from $name"
    done
    (cd "$out" && shasum -a 256 "$name" > "SHA256SUMS-tizen.txt")
    ls -l "$out/$name"
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
    check) check ;;
    core) build_core "${1:-$HERE/out}" ;;
    web) build_web "${1:-$HERE/out/web}" ;;
    package) package "$@" ;;
    *) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
