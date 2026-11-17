#!/usr/bin/env bash
# Cross toolchain for `build/build.sh armv7` on Debian (bookworm or later): the armel
# (soft-float, armv7-unknown-linux-gnueabi) GCC and OpenSSL, and Rust via rustup when missing.
# Ubuntu has no armel port, so run this in a Debian container (CI) or VM.
set -euo pipefail

sudo=""
[ "$(id -u)" -eq 0 ] || sudo=sudo

$sudo dpkg --add-architecture armel
$sudo apt-get update
$sudo apt-get install -y --no-install-recommends \
  ca-certificates curl git file pkg-config build-essential cmake \
  gcc-arm-linux-gnueabi libc6-dev-armel-cross \
  libssl-dev:armel

if ! command -v rustup > /dev/null 2>&1; then
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
  echo "Rust installed in ~/.cargo/bin; add it to PATH" >&2
  [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"
fi
