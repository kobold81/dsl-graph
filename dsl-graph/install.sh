#!/usr/bin/env bash
# Rebuild html/dsl-graph/src/ as hard links to this openHAB instance's DSL files.
# Dest names get a .txt suffix so VS Code OpenHAB language support does not
# index a second copy of every .items/.rules/.things/.sitemap file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${OPENHAB_CONF:-/etc/openhab}"
SRC="$SCRIPT_DIR/src"

if [[ ! -d "$CONF" ]]; then
  echo "openHAB conf not found: $CONF (set OPENHAB_CONF)" >&2
  exit 1
fi

rm -rf "$SRC"
mkdir -p "$SRC/items" "$SRC/rules" "$SRC/things" "$SRC/sitemaps"

shopt -s nullglob
linked=0
for pair in "items:.items" "rules:.rules" "things:.things" "sitemaps:.sitemap"; do
  dir="${pair%%:*}"
  ext="${pair##*:}"
  for srcf in "$CONF/$dir/"*"$ext"; do
    ln -f "$srcf" "$SRC/$dir/$(basename "$srcf").txt"
    linked=$((linked + 1))
  done
done

python3 - "$SRC" << 'PY'
import glob, json, os, sys
root = sys.argv[1]
files = []
for sub in ("items", "rules", "things", "sitemaps"):
    for p in sorted(glob.glob(os.path.join(root, sub, "*.txt"))):
        files.append("%s/%s" % (sub, os.path.basename(p)))
path = os.path.join(root, "manifest.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump({"files": files}, f, indent=2)
    f.write("\n")
print("wrote %s (%d files)" % (path, len(files)))
PY

echo "src/ links ready in $SRC ($linked files from $CONF)"
echo "Open: http://<host>:8080/static/dsl-graph/index.html"
