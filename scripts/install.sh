#!/bin/sh
# Copies the built plugin into OpenDeck's plugin directory. It copies rather
# than symlinks: OpenDeck refuses to serve property inspector files whose real
# path is outside its plugin directory unless developer mode is on.
# Restart OpenDeck (quit from the tray, not just close the window) afterwards.
set -eu

cd "$(dirname "$0")/.."
name=io.github.cdcxd.herdr.sdPlugin

if [ -d "$HOME/.var/app/me.amankhanna.opendeck" ]; then
	plugins="$HOME/.var/app/me.amankhanna.opendeck/config/opendeck/plugins"
elif [ "$(uname)" = Darwin ]; then
	plugins="$HOME/Library/Application Support/opendeck/plugins"
else
	plugins="${XDG_CONFIG_HOME:-$HOME/.config}/opendeck/plugins"
fi

[ -f "dist/$name/manifest.json" ] || { echo "run npm run build first" >&2; exit 1; }
mkdir -p "$plugins"
rm -rf "${plugins:?}/$name"
cp -R "dist/$name" "$plugins/$name"
echo "installed $plugins/$name"
