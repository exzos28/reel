#!/usr/bin/env bash
# The TV package without GitHub: the web UI built here, the core built in Docker
# (scripts/tizen-docker.sh), the .NET service taken from an earlier package (CI's
# reel-tv .wgt; the service rarely changes). Optionally installs it on a TV through
# apps2samsung-cli, and removes the Docker image and its caches afterwards.
#
#   scripts/tizen-local.sh <base.wgt> <out.wgt> [--tv <ip>] [--clean]
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
base="${1:-}"; out="${2:-}"
[ -f "$base" ] && [ -n "$out" ] || { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2; }
shift 2
tv=""; clean=0
while [ $# -gt 0 ]; do
    case "$1" in
        --tv) tv="$2"; shift 2 ;;
        --clean) clean=1; shift ;;
        *) echo "unknown argument $1" >&2; exit 2 ;;
    esac
done
base="$(cd "$(dirname "$base")" && pwd)/$(basename "$base")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== web UI"
(set -a; [ -f "$here/.env" ] && . "$here/.env"; set +a; "$here/hosts/tizen/build.sh" web "$work/web")
echo "== core (Docker)"
"$here/scripts/tizen-docker.sh" core "$work/core"

echo "== package"
mkdir "$work/pkg"
(cd "$work/pkg" && unzip -q "$base")
# The signatures of the base no longer match: the installer signs the package again.
rm -f "$work/pkg/author-signature.xml" "$work/pkg/signature1.xml"
cp "$work/core/libreel_tizen_core.so" "$work/pkg/lib/libreel_tizen_core.so"
rm -rf "$work/pkg/res/wgt/web" && cp -R "$work/web" "$work/pkg/res/wgt/web"
cp "$here/hosts/tizen/ui/shell.js" "$here/hosts/tizen/ui/index.html" "$work/pkg/res/wgt/"
cp "$here/app/icon/icon.png" "$work/pkg/res/wgt/icon.png"
echo "window.REEL_WEB = true;" > "$work/pkg/res/wgt/shell-config.js"
grep -q '<icon ' "$work/pkg/res/wgt/config.xml" || \
    sed -i.bak 's#<content src="index.html"></content>#<content src="index.html"></content><icon src="icon.png"></icon>#' "$work/pkg/res/wgt/config.xml"
rm -f "$work/pkg/res/wgt/config.xml.bak"
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
rm -f "$out"
(cd "$work/pkg" && zip -qr "$out" .)
ls -l "$out"

if [ -n "$tv" ]; then
    echo "== install on $tv"
    "${APPS2SAMSUNG:-$HOME/.local/bin/apps2samsung-cli}" install "$out" --tv "$tv"
fi
if [ "$clean" = 1 ]; then
    echo "== clean"
    "$here/scripts/tizen-docker.sh" clean
fi
