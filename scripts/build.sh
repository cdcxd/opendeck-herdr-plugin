#!/bin/sh
# Compiles src/ and copies assets/ into dist/io.github.cdcxd.herdr.sdPlugin,
# the folder layout OpenDeck and the Stream Deck app load.
set -eu

cd "$(dirname "$0")/.."
out=dist/io.github.cdcxd.herdr.sdPlugin

rm -rf "$out"
npx tsc -p tsconfig.json
cp -R assets/. "$out/"
echo '{ "type": "module" }' > "$out/package.json"
chmod +x "$out/bin/launch.sh"
echo "built $out"
