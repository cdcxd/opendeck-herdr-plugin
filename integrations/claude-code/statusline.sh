#!/bin/sh
# Claude Code status line adapter for the herdr Stream Deck plugin.
#
# Claude Code pipes session JSON into its statusLine command on every update. This
# forwards context use, model, effort and plan usage to herdr as pane tokens, then
# prints a status line as usual. Outside herdr it only prints the status line.
#
# ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "/path/to/statusline.sh" }
# To keep an existing status line, pass its command as arguments:
#   "command": "/path/to/statusline.sh ~/.claude/my-statusline.sh"
#
# Needs jq.

input=$(cat)

# Tokens herdr keeps for this pane (see docs/plan.md for the token names).
report() {
	command -v jq >/dev/null 2>&1 || return
	eval "$(printf '%s' "$input" | jq -r '@sh "
		session=\(.session_id // "")
		ctx=\(.context_window.used_percentage // "" | if . == "" then . else floor end)
		model=\(.model.display_name // "")
		effort=\(.effort.level // "")
		usage=\(.rate_limits.five_hour.used_percentage // "" | if . == "" then . else floor end)
		resets=\(.rate_limits.five_hour.resets_at // "")
	"')" || return
	[ -n "$session" ] || return
	set -- pane report-metadata "$HERDR_PANE_ID" --source claude-statusline --ttl-ms 43200000 --token "session=$session"
	[ -n "$ctx" ] && set -- "$@" --token "ctx_pct=$ctx"
	[ -n "$model" ] && set -- "$@" --token "model=$model"
	[ -n "$effort" ] && set -- "$@" --token "effort=$effort"
	[ -n "$usage" ] && set -- "$@" --token "usage_pct=$usage"
	[ -n "$resets" ] && set -- "$@" --token "usage_resets=$resets"
	"${HERDR_BIN_PATH:-herdr}" "$@" >/dev/null 2>&1
}

# In the background so herdr never delays the status line.
[ -n "$HERDR_PANE_ID" ] && report &

if [ $# -gt 0 ]; then
	printf '%s' "$input" | "$@"
elif command -v jq >/dev/null 2>&1; then
	printf '%s' "$input" | jq -r '"[\(.model.display_name // "?")] \(.context_window.used_percentage // 0 | floor)% context"'
fi
wait
