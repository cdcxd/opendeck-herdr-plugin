#!/bin/sh
# Starts plugin.js with a Node.js new enough for it (22+).
# Hosts launched from a desktop session usually don't see nvm/fnm/volta/mise
# installs, so look there too. Set HERDR_DECK_NODE to force a specific binary.

dir=$(cd "$(dirname "$0")/.." && pwd)
min=22

major() {
	"$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

for node in \
	"$HERDR_DECK_NODE" \
	"$(command -v node 2>/dev/null)" \
	$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -rV) \
	$(ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node 2>/dev/null | sort -rV) \
	$(ls -d "$HOME"/.local/share/mise/installs/node/*/bin/node 2>/dev/null | sort -rV) \
	"$HOME/.volta/bin/node" \
	/opt/homebrew/bin/node \
	/usr/local/bin/node \
	/usr/bin/node; do
	[ -n "$node" ] && [ -x "$node" ] || continue
	v=$(major "$node")
	if [ -n "$v" ] && [ "$v" -ge "$min" ]; then
		exec "$node" "$dir/plugin.js" "$@"
	fi
done

echo "herdr status plugin: no Node.js $min+ found (set HERDR_DECK_NODE)" >&2
exit 1
