#!/usr/bin/env bash
# libmpv for the macOS app (the `reel/mpv` video view, app/src/adapters/mpv), from
# MPVKit's LGPL build (https://github.com/mpvkit/MPVKit, product "MPVKit",
# not "MPVKit-GPL"). MPVKit ships static XCFrameworks; this links their macOS
# slices into one dynamic libmpv.2.dylib, so the app keeps libmpv (LGPL)
# replaceable, and puts it in the app bundle.
#
#   scripts/libmpv-macos.sh build            # downloads ~200 MB once (checksums checked), links
#   scripts/libmpv-macos.sh bundle <App.app> # copies the dylib into Contents/Frameworks, re-signs ad hoc
#
# NOTE: not run yet end to end (the download was held back for approval);
# the app falls back to NSH's <Video> while no libmpv is found.
set -euo pipefail

TAG="1.1.0-n9.0.2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${REEL_LIBMPV_CACHE:-$HOME/Library/Caches/reel/libmpv-$TAG}"
OUT="$CACHE/libmpv.2.dylib"

build() {
  mkdir -p "$CACHE/zips" "$CACHE/xc"
  curl -fsSL "https://raw.githubusercontent.com/mpvkit/MPVKit/$TAG/Package.swift" -o "$CACHE/Package.swift"
  # The binary targets of the LGPL product: everything except *-GPL and Libsmbclient (GPL only).
  python3 -I - "$CACHE/Package.swift" > "$CACHE/targets.tsv" <<'EOF'
import re, sys
text = open(sys.argv[1]).read()
for name, url, checksum in re.findall(r'\.binaryTarget\(\s*name:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*checksum:\s*"([^"]+)"', text):
    if name.endswith("-GPL") or name == "Libsmbclient":
        continue
    print(f"{name}\t{url}\t{checksum}")
EOF
  archives=()
  while IFS=$'\t' read -r name url checksum; do
    zip="$CACHE/zips/$name.zip"
    [ -f "$zip" ] || curl -fsSL "$url" -o "$zip"
    echo "$checksum  $zip" | shasum -a 256 -c - >/dev/null
    rm -rf "$CACHE/xc/$name"
    unzip -q "$zip" -d "$CACHE/xc/$name"
    # The macOS slice: a .a, or a framework whose binary is a static archive at
    # <Name>.framework/Versions/A/<Name> (no extension, not executable).
    lib="$(find "$CACHE/xc/$name" -path '*macos-*' -type f \( -name '*.a' -o -path '*.framework/Versions/A/*' \) \
      ! -path '*/Headers/*' ! -path '*/Modules/*' ! -path '*/Resources/*' ! -name '*.plist' | head -1)"
    [ -n "$lib" ] || { echo "no macOS slice in $name" >&2; exit 1; }
    archives+=("$lib")
  done < "$CACHE/targets.tsv"

  local mpv; mpv="$(printf '%s\n' "${archives[@]}" | grep '/Libmpv' | head -1)"
  local sdk; sdk="$(xcrun --sdk macosx --show-sdk-path)"
  local others=()
  for a in "${archives[@]}"; do [ "$a" = "$mpv" ] || others+=("$a"); done
  xcrun clang -dynamiclib -arch arm64 -arch x86_64 -mmacosx-version-min=14.0 \
    -install_name @rpath/libmpv.2.dylib -o "$OUT" \
    -Wl,-force_load,"$mpv" "${others[@]}" \
    -L"$sdk/usr/lib/swift" -L"$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx" \
    -framework AVFoundation -framework AudioToolbox -framework CoreAudio -framework CoreFoundation \
    -framework CoreMedia -framework CoreVideo -framework VideoToolbox -framework Metal -framework IOSurface \
    -framework OpenGL -framework QuartzCore -framework IOKit -framework Cocoa -framework Security \
    -lbz2 -liconv -lexpat -lresolv -lxml2 -lz -lc++
  echo "$OUT ($(du -h "$OUT" | cut -f1))"
}

bundle() {
  local app="${1:?usage: $0 bundle <App.app>}"
  [ -f "$OUT" ] || { echo "run '$0 build' first" >&2; exit 1; }
  mkdir -p "$app/Contents/Frameworks"
  cp "$OUT" "$app/Contents/Frameworks/libmpv.2.dylib"
  codesign --force --sign - "$app/Contents/Frameworks/libmpv.2.dylib"
  codesign --force --sign - --preserve-metadata=entitlements "$app"
}

case "${1:-}" in
  build) build ;;
  bundle) shift; bundle "$@" ;;
  *) echo "usage: $0 build | bundle <App.app>" >&2; exit 2 ;;
esac
