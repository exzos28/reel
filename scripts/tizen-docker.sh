#!/usr/bin/env bash
# The TV core built in Docker, so the host needs nothing but Docker (hosts/tizen/docker).
#
#   scripts/tizen-docker.sh core [out-dir]   build libreel_tizen_core.so (default: hosts/tizen/out);
#                                            the project's TMDB key goes in from REEL_TMDB_TOKEN (.env)
#   scripts/tizen-docker.sh clean            remove the image and its cache volumes
#
# Cargo's registry and the build's target dir live in Docker volumes (reel-tizen-*), not in the
# repo: hosts/tizen/target stays the host's own.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
image=reel-tizen-build
volumes=(reel-tizen-cargo reel-tizen-target)

case "${1:-}" in
    core)
        out="${2:-$here/hosts/tizen/out}"
        mkdir -p "$out"
        out="$(cd "$out" && pwd)"
        docker build -t "$image" "$here/hosts/tizen/docker"
        docker run --rm \
            -v "$here:/reel" \
            -v "$out:/out" \
            -v reel-tizen-cargo:/usr/local/cargo/registry \
            -v reel-tizen-target:/target \
            -e CARGO_TARGET_DIR=/target \
            -e REEL_TMDB_TOKEN \
            "$image" hosts/tizen/build.sh core /out
        echo "$out/libreel_tizen_core.so"
        ;;
    clean)
        docker image rm -f "$image" 2> /dev/null || true
        docker volume rm -f "${volumes[@]}" 2> /dev/null || true
        echo "removed $image and ${volumes[*]}"
        ;;
    *)
        sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
