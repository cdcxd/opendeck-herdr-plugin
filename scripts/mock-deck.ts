// Renders a mock 15-key Stream Deck from fake agents with the plugin's own renderer,
// for docs/keys.png. Writes an HTML page; screenshot it with a headless browser:
//   node scripts/mock-deck.ts > dist/deck.html
//   google-chrome --headless=new --hide-scrollbars --window-size=760,480 \
//     --force-device-scale-factor=2 --screenshot=docs/keys.png "file://$PWD/dist/deck.html"

import type { Agent } from "../src/herdr.ts";
import { countByStatus } from "../src/herdr.ts";
import { renderAgent, renderEmpty, renderSummary, renderUsage } from "../src/render.ts";

const now = Date.now();
const min = 60_000;

type Mock = Pick<Agent, "status" | "agent" | "label"> & { ago: number; ctx?: number };

const agents: Mock[] = [
	{ status: "blocked", agent: "claude", label: "api 1", ago: 3 * min, ctx: 64 },
	{ status: "working", agent: "codex", label: "api 2", ago: 12 * min },
	{ status: "working", agent: "claude", label: "web-app", ago: 40_000, ctx: 38 },
	{ status: "done", agent: "omp", label: "docs-site", ago: 2 * min },
	{ status: "idle", agent: "claude", label: "infra", ago: 1440 * min, ctx: 12 },
	{ status: "working", agent: "codex", label: "mobile", ago: 120 * min },
	{ status: "blocked", agent: "claude", label: "reviewer", ago: 30_000, ctx: 93 },
	{ status: "idle", agent: "pi", label: "cli-tool", ago: 300 * min },
	{ status: "done", agent: "claude", label: "data-pipe", ago: 9 * min, ctx: 76 },
	{ status: "idle", agent: "opencode", label: "website", ago: 4320 * min },
];

const keys = [
	...agents.map((a, i) =>
		renderAgent(
			{ ...a, title: "", since: now - a.ago },
			// Stagger the ripple so the working keys show different frames.
			{ now, contextPct: a.ctx ?? null, spin: i % 8 },
		),
	),
	renderEmpty(11),
	renderEmpty(12),
	renderUsage({ pct: 55, resetsAt: now + 51 * min + 5_000, window: "5h", now }),
	renderUsage({ pct: 76, resetsAt: now + 4 * 1440 * min + 5_000, window: "1w", now }),
	renderSummary(countByStatus(agents as unknown as Agent[])),
];

const cell = (src: string) =>
	`<div style="width:120px;height:120px;border-radius:14px;overflow:hidden;background:#000"><img src="${src}" width="120" height="120"></div>`;

process.stdout.write(
	`<html><body style="margin:0;background:transparent">` +
		`<div style="padding:22px;background:#1c1d21;border-radius:28px;display:grid;grid-template-columns:repeat(5,120px);gap:16px;width:fit-content">` +
		keys.map(cell).join("") +
		`</div></body></html>\n`,
);
