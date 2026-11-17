#!/usr/bin/env bash
# reel's Linux app built and run in Docker, so a Mac needs nothing but Docker (dev/linux). The
# image's architecture is the host's (arm64 on Apple Silicon: no emulation).
#
#   scripts/linux-docker.sh build [out-dir]   the app (scripts/build.sh linux) into out-dir
#                                             (default: dist-linux); TMDB's key from .env;
#                                             REEL_LIBMPV_LINUX: a local libmpv.so.2 to bundle
#   scripts/linux-docker.sh run [out-dir] [seconds] [shot.png]
#                                             runs it on a virtual display, screenshots it
#   scripts/linux-docker.sh clean             removes the image and its volumes
#
# The sources are copied into a volume (not built in app/.nsh, which the Mac's builds use);
# Cargo's registry, the build and nsh live in volumes too (reel-linux-*).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
image=reel-linux-build
volumes=(reel-linux-src reel-linux-cargo reel-linux-home)

docker_run() {
  docker run --rm \
    -v "$here:/reel:ro" \
    -v reel-linux-src:/src \
    -v reel-linux-cargo:/usr/local/cargo/registry \
    -v reel-linux-home:/opt/home -e HOME=/opt/home \
    -e REEL_TMDB_TOKEN -e REEL_TORZNAB_URL -e REEL_TORZNAB_KEY \
    "$@"
}

case "${1:-}" in
  build)
    out="${2:-$here/dist-linux}"
    mkdir -p "$out" && out="$(cd "$out" && pwd)"
    [ -f "$here/.env" ] && { set -a; . "$here/.env"; set +a; }
    docker build -q -t "$image" "$here/dev/linux" >/dev/null
    # A local libmpv (REEL_LIBMPV_LINUX, see scripts/libmpv.sh) goes in as a file.
    local_mpv=()
    if [ -n "${REEL_LIBMPV_LINUX:-}" ]; then
      local_mpv=(-v "$REEL_LIBMPV_LINUX:/libmpv/libmpv.so.2:ro" -e REEL_LIBMPV_LINUX=/libmpv/libmpv.so.2)
    fi
    docker_run -v "$out:/out" ${local_mpv[@]+"${local_mpv[@]}"} "$image" bash -euo pipefail -c '
      rsync -a --delete --exclude .git --exclude "app/.nsh" --exclude "app/target" --exclude "hosts/*/target" \
        --exclude "dist-*" --exclude node_modules /reel/ /src/
      export PATH="$(scripts/install-nsh.sh):$PATH"
      scripts/build.sh linux
      cp app/.nsh/dist/linux/*.tar.gz /out/
      ls -la /out'
    ;;
  run)
    out="${2:-$here/dist-linux}"; secs="${3:-20}"; shot="${4:-$out/shot.png}"
    out="$(cd "$out" && pwd)"
    docker run --rm -v "$out:/out" "$image" bash -euo pipefail -c "
      mkdir -p /app && tar -xzf /out/*.tar.gz -C /app
      Xvfb :99 -screen 0 1600x1000x24 >/dev/null 2>&1 &
      export DISPLAY=:99 GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1
      sleep 2
      runner=\$(find /app -maxdepth 3 -type f -executable ! -name '*.so*' | head -1)
      echo \"running \$runner\"
      dbus-launch \"\$runner\" > /out/run.log 2>&1 &
      sleep $secs
      import -window root /out/$(basename "$shot")
      tail -20 /out/run.log"
    echo "$out/$(basename "$shot")"
    ;;
  clean)
    docker image rm -f "$image" 2>/dev/null || true
    docker volume rm -f "${volumes[@]}" 2>/dev/null || true
    ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
