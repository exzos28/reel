# Building and running reel's Linux app in Docker (scripts/linux-docker.sh): Ubuntu 24.04 (GTK 4.14,
# WebKitGTK 6.0, GStreamer), Rust, and a virtual display (Xvfb) to run the app without a screen.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential clang pkg-config curl ca-certificates git rsync xz-utils \
      libgtk-4-dev libwebkitgtk-6.0-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libssl-dev \
      xvfb x11-utils xdotool imagemagick dbus-x11 mesa-utils libgl1-mesa-dri \
      libass9 libfribidi0 libharfbuzz0b libfontconfig1 libasound2t64 libpulse0 libva2 libva-drm2 libva-x11-2 libvdpau1 \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
WORKDIR /src
