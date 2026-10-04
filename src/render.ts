// Key images as SVG data URLs. Drawn on a 144x144 canvas; the host scales to the device.

import type { Agent, Status } from "./herdr.ts";

export const COLORS: Record<Status | "off", string> = {
	blocked: "#e5484d",
	working: "#3e8ef7",
	done: "#30a46c",
	idle: "#7c818c",
	unknown: "#7c818c",
	off: "#4a4d55",
};

const AMBER = "#f5a524";
const BG = "#141518";
const BG_ALERT = "#4a1216";
const FONT = "font-family=\"Inter, 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif\"";

function escapeXml(s: string): string {
	return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);
}

// Font size that fits `s` across roughly `width` px (bold sans is ~0.62em per char).
function fitSize(s: string, width: number, max: number, min: number): number {
	const len = [...String(s)].length || 1;
	return Math.max(min, Math.min(max, Math.floor(width / (len * 0.62))));
}

// Rough fit by character count; good enough for a fixed-size key.
export function truncate(s: string, max: number): string {
	const chars = [...String(s)];
	return chars.length <= max ? chars.join("") : chars.slice(0, max - 1).join("") + "…";
}

function toDataUrl(svg: string): string {
	return "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);
}

function svg(bg: string, body: string): string {
	return toDataUrl(
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
			`<rect width="144" height="144" fill="${bg}"/>${body}</svg>`,
	);
}

function text(x: number, y: number, size: number, fill: string, content: string, { weight = 400, anchor = "start" } = {}): string {
	return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${FONT}>${escapeXml(content)}</text>`;
}

// Label granularity: 10s steps for the first minute, then minutes, hours, days.
function elapsedStep(ms: number): number {
	if (ms < 60_000) return 10_000;
	if (ms < 3_600_000) return 60_000;
	if (ms < 86_400_000) return 3_600_000;
	return 86_400_000;
}

// Compact elapsed time: 0s, 10s … 50s, 7m, 3h, 2d.
export function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${Math.floor(s / 10) * 10}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

// Milliseconds until formatElapsed(ms) next changes.
export function msUntilNextLabel(ms: number): number {
	const elapsed = Math.max(0, ms);
	const step = elapsedStep(elapsed);
	return step - (elapsed % step);
}

// Milliseconds until formatElapsed(remaining) next changes while counting down.
export function msUntilCountdownLabel(remaining: number): number {
	if (remaining <= 0) return Infinity;
	return (remaining % elapsedStep(remaining)) + 1;
}

export const SPIN_FRAMES = 8;

// Working, animated: a small drop with two ripples spreading out and fading,
// half a cycle apart so there's always one in flight.
function ripple(cx: number, cy: number, r: number, color: string, frame: number): string {
	let rings = "";
	for (const offset of [0, 0.5]) {
		const p = ((frame % SPIN_FRAMES) / SPIN_FRAMES + offset) % 1;
		const radius = (r * (0.6 + 0.7 * p)).toFixed(1);
		rings += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="3.5" opacity="${(1 - p).toFixed(2)}"/>`;
	}
	return rings + `<circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.35)}" fill="${color}"/>`;
}

// Filled dot for active states, hollow for idle (as herdr draws it).
// With a `spin` frame (0..SPIN_FRAMES-1), working draws the ripple instead.
function dot(cx: number, cy: number, r: number, status: Status, spin: number | null = null): string {
	const color = COLORS[status];
	if (status === "idle" || status === "unknown") {
		return `<circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="none" stroke="${color}" stroke-width="4"/>`;
	}
	if (status === "working" && spin !== null) return ripple(cx, cy, r, color, spin);
	return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
}

export interface AgentKeyOptions {
	flashOn?: boolean;
	// Animation frame for a working agent; null draws a static dot.
	spin?: number | null;
	showTitle?: boolean;
	now?: number;
	// "tint": background washed with the status color; "plain": dark key.
	background?: "plain" | "tint";
	// Context window used, 0..100. Draws a bar along the bottom edge; null hides it.
	contextPct?: number | null;
}

// Grey while there's room, amber above 70%, red above 90%.
export function levelColor(pct: number): string {
	if (pct >= 90) return COLORS.blocked;
	if (pct >= 70) return AMBER;
	return "#c9ccd3";
}

function bar(x: number, y: number, width: number, height: number, pct: number): string {
	const fill = Math.round((width * Math.min(100, Math.max(0, pct))) / 100);
	const r = height / 2;
	return (
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${r}" fill="#ffffff" opacity="0.15"/>` +
		(fill > 0 ? `<rect x="${x}" y="${y}" width="${Math.max(fill, height)}" height="${height}" rx="${r}" fill="${levelColor(pct)}"/>` : "")
	);
}

// One agent: status dot + agent type, label, time in current status.
// `flashOn` swaps to the alert background so a blocked key can blink.
export function renderAgent(
	agent: Pick<Agent, "status" | "agent" | "label" | "title" | "since">,
	{ flashOn = false, spin = null, showTitle = false, now = Date.now(), background = "tint", contextPct = null }: AgentKeyOptions = {},
): string {
	const color = COLORS[agent.status];
	const alert = agent.status === "blocked";
	const tinted = background === "tint" && agent.status !== "idle" && agent.status !== "unknown";
	const bg = alert && flashOn ? BG_ALERT : BG;
	const second = showTitle && agent.title ? agent.title : agent.agent;
	const label = truncate(agent.label, 11);
	const hasBar = contextPct !== null && contextPct !== undefined;
	return svg(
		bg,
		(tinted ? `<rect width="144" height="144" fill="${color}" opacity="0.28"/>` : "") +
			(alert ? `<rect x="3" y="3" width="138" height="138" rx="10" fill="none" stroke="${color}" stroke-width="6"/>` : "") +
			dot(30, 32, 15, agent.status, spin) +
			text(54, 39, 19, "#c9ccd3", truncate(second, 7)) +
			text(72, 88, fitSize(label, 128, 28, 18), "#ffffff", label, { weight: 700, anchor: "middle" }) +
			(agent.since
				? text(72, hasBar ? 120 : 126, 22, tinted ? "#ffffff" : color, formatElapsed(now - agent.since), { weight: 700, anchor: "middle" })
				: "") +
			(hasBar ? bar(16, 128, 112, 6, contextPct) : ""),
	);
}

export function renderEmpty(slot: number | null | undefined): string {
	return svg(
		BG,
		`<circle cx="30" cy="32" r="15" fill="none" stroke="${COLORS.off}" stroke-width="3"/>` +
			text(72, 90, 24, COLORS.off, slot ? `slot ${slot}` : "no agent", { weight: 700, anchor: "middle" }) +
			text(72, 126, 18, COLORS.off, "no agent", { anchor: "middle" }),
	);
}

export function renderOffline(): string {
	return svg(
		BG,
		`<circle cx="30" cy="32" r="15" fill="none" stroke="${COLORS.blocked}" stroke-width="3"/>` +
			text(72, 90, 26, "#c9ccd3", "herdr", { weight: 700, anchor: "middle" }) +
			text(72, 126, 20, COLORS.off, "offline", { anchor: "middle" }),
	);
}

// Counts in a fixed 2x2 grid (idle, working / blocked, done), number under the dot, so
// each status always sits in the same corner. Dots match the agent keys (static);
// zero counts are dimmed, dot included. A red outline marks blocked agents; it
// doesn't blink, the agent keys do that.
export function renderSummary(counts: Partial<Record<Status, number>>): string {
	const total = (["blocked", "done", "working", "idle"] as const).reduce((n, s) => n + (counts[s] ?? 0), 0);
	if (total === 0) {
		return svg(BG, text(72, 66, 26, "#c9ccd3", "herdr", { weight: 700, anchor: "middle" }) + text(72, 98, 18, COLORS.off, "no agents", { anchor: "middle" }));
	}
	const cells = [
		["idle", 0, 0],
		["working", 72, 0],
		["blocked", 0, 72],
		["done", 72, 72],
	] as const;
	const body = cells
		.map(([status, x, y]) => {
			const n = counts[status] ?? 0;
			const label = n > 99 ? "99+" : String(n);
			const cx = x + 36;
			const cy = y + 27;
			// Zero counts keep their color, dimmed, so the grid still reads by color.
			const mark = n > 0 ? dot(cx, cy, 15, status) : `<g opacity="0.35">${dot(cx, cy, 15, status)}</g>`;
			return mark + text(cx, y + 65, label.length > 2 ? 20 : 26, n > 0 ? "#ffffff" : COLORS.off, label, { weight: 700, anchor: "middle" });
		})
		.join("");
	const border = (counts.blocked ?? 0) > 0 ? `<rect x="3" y="3" width="138" height="138" rx="10" fill="none" stroke="${COLORS.blocked}" stroke-width="6"/>` : "";
	return svg(BG, border + body);
}

const CLAUDE_ORANGE = "#d97757";

// Claude plan usage for one window ("5h" or "1w"), over a faint orange "CC" watermark.
export function renderUsage({
	pct,
	resetsAt,
	window = "5h",
	now = Date.now(),
}: { pct: number | null; resetsAt?: number | null; window?: string; now?: number }): string {
	const mark = text(72, 100, 78, CLAUDE_ORANGE, "CC", { weight: 800, anchor: "middle" }).replace("<text ", '<text opacity="0.22" ');
	const header =
		`<text x="72" y="30" font-size="20" font-weight="700" text-anchor="middle" ${FONT}>` +
		`<tspan fill="${CLAUDE_ORANGE}">claude</tspan><tspan fill="#c9ccd3"> ${escapeXml(window)}</tspan></text>`;
	if (pct === null) {
		return svg(BG, mark + header + text(72, 92, 20, COLORS.off, "no data", { anchor: "middle" }));
	}
	const color = levelColor(pct);
	return svg(
		BG,
		mark +
			header +
			text(72, 72, 34, pct >= 70 ? color : "#ffffff", `${Math.round(pct)}%`, { weight: 700, anchor: "middle" }) +
			bar(16, 84, 112, 8, pct) +
			(resetsAt && resetsAt > now
				? text(72, 126, 22, "#c9ccd3", `in ${formatElapsed(resetsAt - now)}`, { weight: 700, anchor: "middle" })
				: ""),
	);
}
