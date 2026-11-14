# Builds the TV core (libreel_tizen_core.so, armv7 glibc 2.28) without installing anything on the
# host: Rust, zig and cargo-zigbuild as in .github/workflows/tizen.yml. Native to the host's
# architecture (arm64 on Apple silicon), so no emulation. Used by scripts/tizen-docker.sh.
FROM rust:1-bookworm

ARG ZIG_VERSION=0.13.0
RUN set -eux; \
    arch="$(uname -m)"; \
    curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-${arch}-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz; \
    mkdir -p /opt/zig && tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 && rm /tmp/zig.tar.xz; \
    ln -s /opt/zig/zig /usr/local/bin/zig; \
    apt-get update && apt-get install -y --no-install-recommends file binutils && rm -rf /var/lib/apt/lists/*; \
    rustup target add armv7-unknown-linux-gnueabi; \
    cargo install --locked cargo-zigbuild; \
    rm -rf /usr/local/cargo/registry

WORKDIR /reel
