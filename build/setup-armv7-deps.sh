#!/usr/bin/env bash
# Cross toolchain for the TV's core with gcc instead of zig (`REEL_TIZEN_CC=arm-linux-gnueabi-gcc
# build/tizen.sh core`) on Debian (bookworm or later): the armel (soft-float,
# armv7-unknown-linux-gnueabi) GCC and OpenSSL, and Rust via rustup when missing.
# Ubuntu has no armel port, so run this in a Debian container (CI) or VM.
set -euo pipefail

sudo=""
[ "$(id -u)" -eq 0 ] || sudo=sudo

$sudo dpkg --add-architecture armel
$sudo apt-get update
# libssl3 is Multi-Arch: same, so the host's and armel's must be the same version. Debian's
# security archive has no armel, so the host would take a newer libssl3 than armel can have:
# both are pinned to armel's.
ssl="$(apt-cache policy libssl-dev:armel | sed -n 's/ *Candidate: //p')"
[ -n "$ssl" ] && [ "$ssl" != "(none)" ] || { echo "no libssl-dev:armel in the apt sources" >&2; exit 1; }
$sudo apt-get install -y --no-install-recommends --allow-downgrades \
  ca-certificates curl git file pkg-config build-essential cmake \
  gcc-arm-linux-gnueabi libc6-dev-armel-cross \
  "libssl3=$ssl" "libssl3:armel=$ssl" "libssl-dev:armel=$ssl"

if ! command -v rustup > /dev/null 2>&1; then
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
  echo "Rust installed in ~/.cargo/bin; add it to PATH" >&2
  [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"
fi
