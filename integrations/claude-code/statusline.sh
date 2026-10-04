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
	vars=$(printf '%s' "$input" | jq -r '@sh "
		session=\(.session_id // "")
		ctx_pct=\(.context_window.used_percentage // "" | if . == "" then . else floor end)
		model=\(.model.display_name // "")
		effort=\(.effort.level // "")
		usage_pct=\(.rate_limits.five_hour.used_percentage // "" | if . == "" then . else floor end)
		usage_resets=\(.rate_limits.five_hour.resets_at // "")
		usage_7d_pct=\(.rate_limits.seven_day.used_percentage // "" | if . == "" then . else floor end)
		usage_7d_resets=\(.rate_limits.seven_day.resets_at // "")
	"') || return
	eval "$vars"
	[ -n "$session" ] || return
	set -- pane report-metadata "$HERDR_PANE_ID" --source claude-statusline --ttl-ms 43200000 --token "session=$session"
	# herdr only updates the tokens it's sent, so clear any value Claude Code no longer
	# provides (e.g. context after /clear); otherwise the old one would linger.
	for name in ctx_pct model effort usage_pct usage_resets usage_7d_pct usage_7d_resets; do
		eval "value=\$$name"
		if [ -n "$value" ]; then
			set -- "$@" --token "$name=$value"
		else
			set -- "$@" --clear-token "$name"
		fi
	done
	"${HERDR_BIN_PATH:-herdr}" "$@"
}

# Detached, with its own stdio, so a slow or hung herdr never delays the status line.
# The redirections wrap the whole background job: Claude Code waits for stdout to close.
{ [ -n "$HERDR_PANE_ID" ] && report; } </dev/null >/dev/null 2>&1 &

if [ $# -gt 0 ]; then
	printf '%s' "$input" | "$@"
elif command -v jq >/dev/null 2>&1; then
	printf '%s' "$input" | jq -r '"[\(.model.display_name // "?")] \(.context_window.used_percentage // 0 | floor)% context"'
fi
