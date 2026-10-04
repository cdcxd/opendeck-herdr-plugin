#!/bin/sh
# Zips the built plugin into dist/io.github.cdcxd.herdr.streamDeckPlugin,
# which OpenDeck installs from file or from a GitHub release asset.
set -eu

cd "$(dirname "$0")/../dist"
name=io.github.cdcxd.herdr

[ -f "$name.sdPlugin/manifest.json" ] || { echo "run npm run build first" >&2; exit 1; }
rm -f "$name.streamDeckPlugin"
zip -qr -X "$name.streamDeckPlugin" "$name.sdPlugin" -x '*.DS_Store'
echo "wrote dist/$name.streamDeckPlugin"
