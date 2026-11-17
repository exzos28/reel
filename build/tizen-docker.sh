#!/usr/bin/env bash
# The TV core built in Docker, so the host needs nothing but Docker (build/docker/tizen).
#
#   build/tizen-docker.sh core [out-dir]   build libreel_tizen_core.so (default: out/tizen);
#                                            the project's TMDB key goes in from REEL_TMDB_TOKEN (.env)
#   build/tizen-docker.sh package [out-dir]
#                                            the whole TV package, .wgt (build/tizen.sh package),
#                                            as CI builds it (build/docker/tizen/Dockerfile.package,
#                                            amd64); TMDB's key and the partner's bot from .env
#   build/tizen-docker.sh clean            remove the image and its cache volumes
#
# Cargo's registry and the build's target dir live in Docker volumes (reel-tizen-*), not in the
# repo: platforms/tizen/target stays the host's own.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
image=reel-tizen-build
volumes=(reel-tizen-cargo reel-tizen-target reel-tizen-pkg-src reel-tizen-pkg-cargo reel-tizen-pkg-home reel-tizen-pkg-nuget)
package_image=reel-tizen-package

case "${1:-}" in
    core)
        out="${2:-$here/out/tizen}"
        mkdir -p "$out"
        out="$(cd "$out" && pwd)"
        docker build -t "$image" "$here/build/docker/tizen"
        docker run --rm \
            -v "$here:/reel" \
            -v "$out:/out" \
            -v reel-tizen-cargo:/usr/local/cargo/registry \
            -v reel-tizen-target:/target \
            -e CARGO_TARGET_DIR=/target \
            -e REEL_TMDB_TOKEN \
            -e REEL_DEFAULT_SOURCE_URL \
            -e REEL_DEFAULT_SOURCE_KEY \
            "$image" build/tizen.sh core /out
        echo "$out/libreel_tizen_core.so"
        ;;
    package)
        out="${2:-$here/out/tizen}"
        mkdir -p "$out"
        out="$(cd "$out" && pwd)"
        [ -f "$here/.env" ] && { set -a; . "$here/.env"; set +a; }
        docker build --platform linux/amd64 -t "$package_image" -f "$here/build/docker/tizen/Dockerfile.package" "$here/build/docker/tizen"
        # The sources are copied into a volume (the build writes into app/ and platforms/tizen/).
        docker run --rm --platform linux/amd64 \
            -v "$here:/reel:ro" \
            -v "$out:/out" \
            -v reel-tizen-pkg-src:/src \
            -v reel-tizen-pkg-cargo:/usr/local/cargo/registry \
            -v reel-tizen-pkg-home:/opt/home -e HOME=/opt/home \
            -v reel-tizen-pkg-nuget:/opt/home/.nuget \
            -e REEL_TMDB_TOKEN -e REEL_PARTNER_BOT \
            -e SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$here" log -1 --format=%ct)}" \
            "$package_image" bash -euo pipefail -c '
              rsync -a --delete --exclude .git --exclude "app/.nsh" --exclude "app/target" --exclude "platforms/*/target" \
                --exclude "/out" --exclude node_modules /reel/ /src/
              export PATH="$(build/install-nsh.sh):$PATH"
              build/tizen.sh package /out'
        ls -la "$out"/*.wgt
        ;;
    clean)
        docker image rm -f "$image" "$package_image" 2> /dev/null || true
        docker volume rm -f "${volumes[@]}" 2> /dev/null || true
        echo "removed $image and ${volumes[*]}"
        ;;
    *)
        sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
