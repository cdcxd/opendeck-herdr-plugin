# Plan

Ideas and decisions that aren't built yet. Shipped behaviour is described in the README.

## Principles

- **herdr is the hub.** The deck talks only to herdr's socket API. Agent harnesses feed extra data into herdr, not into the deck.
- **A short press never changes an agent.** It only focuses. Anything that sends input to an agent needs a deliberate gesture *and* you looking at the agent in your terminal.
- **One plugin, one repo.** Harness adapters live under `integrations/<harness>/`. They share only herdr token names (below), so there's no package split.

## 1. Release

Published at github.com/cdcxd/opendeck-herdr-plugin. Tag `v0.1.0` when ready; CI then attaches the `.streamDeckPlugin` to a release.

## 2. Harness metadata: model, effort, context

herdr already carries arbitrary per-pane **tokens** (`pane.report_metadata`, with TTL). These come back in `agent.list`, so the deck needs no new connection.

Token names (shared contract between adapters and the plugin):

| token        | example  | meaning                          |
| ------------ | -------- | -------------------------------- |
| `ctx_pct`    | `42`     | context window used, percent     |
| `model`      | `opus`   | short model name                 |
| `effort`     | `high`   | reasoning effort, if any         |
| `usage_pct`  | `63`     | plan usage in the current window |
| `usage_resets` | `1791112015` | when that window resets, epoch seconds |
| `usage_7d_pct`, `usage_7d_resets` | `18` | the same for the weekly window |
| `session`    | `d0e1…`  | agent session id; the plugin ignores tokens from another session |

herdr keeps tokens until their TTL expires, even after the agent exits, so a new agent in the same pane could inherit them; the `session` token prevents that. Adapters use a 12 h TTL.

Adapters:

- **Claude Code**: done, `integrations/claude-code/statusline.sh`.
- **Codex, omp**: investigate their hook/statusline mechanisms; same token names.

Deck side:

- Done: context bar on agent keys, and the Usage action.
- herdr has no event for token changes, so they arrive with the 5 s poll. Ask herdr for a metadata event if that lag matters.
- Model/effort: shown in the key's settings preview and, on devices with a screen strip, in the detail panel (see Devices). Not on the 72 px key; too small.

## 3. Approve from the deck

Agents block on permission prompts with long commands, so the key can't show enough to approve safely. Flow:

1. Short press on a blocked agent's key: focus it (as today). You read the prompt in your terminal.
2. **Long press on the same key** (≥ 600 ms) approves, but only if all of these hold:
   - the agent is `blocked` and is herdr's **focused** pane,
   - it was focused within the last ~2 minutes,
   - a known permission prompt is on screen (`pane.read`, matched per harness).

   Otherwise the long press does nothing and the key shows an alert.
3. While the key is held, the key fills with a progress ring so you can let go to cancel.

Keystrokes differ per harness and prompt, so approve is per-harness and starts with Claude Code only. Reject: just type in the terminal; you're already there. A deck reject key isn't worth the risk of mixing up the two.

## 4. Labels

Done: herdr agent name (`herdr agent rename`) if set, otherwise the workspace, numbered when several agents share it (`web 1`, `web 2`).

Later: optionally use the tab label when the user has renamed the tab (herdr's default tab labels are just numbers).

## 5. Visual ideas

- Tint deepens the longer an agent has been blocked (e.g. after 5 minutes), so stale requests stand out.
- Agent type stays text. Brand logos are trademarks and would need art for every agent herdr supports.

## Devices

The plugin targets keys, so it works on every Stream Deck with keys. Notes on other hardware:

- **MK.2 / original (15 keys)**: one agent per key; the main target.
- **XL (32 keys)**: more agents and room for usage/summary keys. Nothing to build.
- **Stream Deck+ (8 keys, 4 dials, touch strip)**: the strip is 800×100 px, much more room than a key. A useful design for herdr:
  - Dial 1 *rotates through agents*; its strip panel shows the selected agent large: label, full title, model, context bar, elapsed time. Press focuses it.
  - Dial 2 scrolls the selected agent's pane output (`pane.read`) on the strip, to glance at what it's doing without switching windows.
  - Tap a strip panel to focus that agent.

  That's nice, but the 15-key MK.2 already shows 15 agents at once, which suits herdr better than one-at-a-time dials. Dials mainly suit continuous values (volume, lighting). Not worth buying hardware for; support it if someone asks.
- **Neo (8 keys + 2 touch points)**: touch points could page through agents when there are more than 8.

## Open questions

- Should `done` count as needing attention on the Summary key, or only `blocked`?
- herdr bug to report: once, a hook-reported agent (omp) stayed in `agent list` after exiting until herdr was restarted. Couldn't reproduce afterwards.
