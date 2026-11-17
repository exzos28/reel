#!/usr/bin/env bash
# Installs the nsh CLI at the version app/Cargo.lock pins nsh-core to (the CLI builds the
# app's runners with NSH's crates at its own version, so the two must match).
# Does nothing when that nsh is already on PATH. Works on macOS, Linux and Windows (Git Bash).
#
#   build/install-nsh.sh            install if needed, print the bin directory
#   build/install-nsh.sh --version  print the pinned version only
#
# In GitHub Actions the bin directory is added to GITHUB_PATH.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
version="$(awk '/^name = "nsh-core"$/ { getline; gsub(/[^0-9.]/, ""); print; exit }' "$repo/app/Cargo.lock")"
[ -n "$version" ] || { echo "install-nsh.sh: nsh-core not found in app/Cargo.lock" >&2; exit 1; }

if [ "${1:-}" = --version ]; then
  echo "$version"
  exit 0
fi

tag="v$version"
base="https://github.com/longbridge/nsh/releases/download/$tag"

has_version() { "$1" -V 2> /dev/null | grep -q "^nsh $version "; }

windows=false
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) windows=true ;; esac

if $windows; then
  bin="$(cygpath -u "$LOCALAPPDATA")/nsh/bin"
  exe="$bin/nsh.exe"
else
  bin="${NSH_INSTALL_DIR:-$HOME/.nsh}/bin"
  exe="$bin/nsh"
fi

if command -v nsh > /dev/null 2>&1 && has_version nsh; then
  echo "nsh $version is already on PATH ($(command -v nsh))" >&2
  bin="$(dirname "$(command -v nsh)")"
elif [ -x "$exe" ] && has_version "$exe"; then
  echo "nsh $version is already installed in $bin" >&2
else
  echo "installing nsh $tag" >&2
  if $windows; then
    NSH_VERSION="$tag" powershell -NoProfile -ExecutionPolicy Bypass -Command "irm $base/install.ps1 | iex"
  else
    curl -fsSL "$base/install.sh" | NSH_VERSION="$tag" sh
  fi
  has_version "$exe" || { echo "install-nsh.sh: $exe is not nsh $version" >&2; exit 1; }
fi

if [ -n "${GITHUB_PATH:-}" ]; then
  if $windows; then cygpath -w "$bin" >> "$GITHUB_PATH"; else echo "$bin" >> "$GITHUB_PATH"; fi
fi
echo "$bin"
