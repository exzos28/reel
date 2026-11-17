#!/usr/bin/env bash
# Development packages for building reel's Linux runner (Ubuntu 24.04+ / Debian trixie+):
# GTK 4.14+, WebKitGTK 6.0, GStreamer, clang (NSH, see nsh.dev/docs/linux) and OpenSSL
# (librqbit's default sha1 backend uses openssl-sys on Linux).
set -euo pipefail

sudo=""
[ "$(id -u)" -eq 0 ] || sudo=sudo

$sudo apt-get update
$sudo apt-get install -y --no-install-recommends \
  build-essential clang pkg-config \
  libgtk-4-dev libwebkitgtk-6.0-dev \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  libssl-dev

pkg-config --modversion gtk4 | awk -F. '{ if ($1 < 4 || ($1 == 4 && $2 < 14)) { print "GTK " $0 " is older than 4.14" > "/dev/stderr"; exit 1 } else print "GTK " $0 }'
