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

// Filled dot for active states, hollow for idle (as herdr draws it).
function dot(cx: number, cy: number, r: number, status: Status): string {
	const color = COLORS[status];
	return status === "idle" || status === "unknown"
		? `<circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="none" stroke="${color}" stroke-width="4"/>`
		: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
}

export interface AgentKeyOptions {
	flashOn?: boolean;
	showTitle?: boolean;
	now?: number;
	// "tint": background washed with the status color; "plain": dark key.
	background?: "plain" | "tint";
}

// One agent: status dot + agent type, label, time in current status.
// `flashOn` swaps to the alert background so a blocked key can blink.
export function renderAgent(
	agent: Pick<Agent, "status" | "agent" | "label" | "title" | "since">,
	{ flashOn = false, showTitle = false, now = Date.now(), background = "tint" }: AgentKeyOptions = {},
): string {
	const color = COLORS[agent.status];
	const alert = agent.status === "blocked";
	const tinted = background === "tint" && agent.status !== "idle" && agent.status !== "unknown";
	const bg = alert && flashOn ? BG_ALERT : BG;
	const second = showTitle && agent.title ? agent.title : agent.agent;
	const label = truncate(agent.label, 11);
	return svg(
		bg,
		(tinted ? `<rect width="144" height="144" fill="${color}" opacity="0.28"/>` : "") +
			(alert ? `<rect x="3" y="3" width="138" height="138" rx="10" fill="none" stroke="${color}" stroke-width="6"/>` : "") +
			dot(30, 32, 15, agent.status) +
			text(54, 39, 19, "#c9ccd3", truncate(second, 7)) +
			text(72, 88, fitSize(label, 128, 28, 18), "#ffffff", label, { weight: 700, anchor: "middle" }) +
			(agent.since ? text(72, 126, 22, tinted ? "#ffffff" : color, formatElapsed(now - agent.since), { weight: 700, anchor: "middle" }) : ""),
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

// Counts for every status that has at least one agent; blocked first.
export function renderSummary(counts: Partial<Record<Status, number>>, { flashOn = false } = {}): string {
	const rows = (["blocked", "done", "working", "idle"] as const).filter((s) => (counts[s] ?? 0) > 0);
	const alert = (counts.blocked ?? 0) > 0;
	const bg = alert && flashOn ? BG_ALERT : BG;
	if (rows.length === 0) {
		return svg(bg, text(72, 66, 26, "#c9ccd3", "herdr", { weight: 700, anchor: "middle" }) + text(72, 98, 18, COLORS.off, "no agents", { anchor: "middle" }));
	}
	const words = { blocked: "blocked", done: "done", working: "working", idle: "idle" } as const;
	const step = 144 / (rows.length + 1);
	const body = rows
		.map((s, i) => {
			const y = step * (i + 1);
			return (
				dot(22, y, 9, s) +
				text(52, y + 9, 26, "#ffffff", String(counts[s] ?? 0), { weight: 700, anchor: "middle" }) +
				text(70, y + 6, 15, "#c9ccd3", words[s])
			);
		})
		.join("");
	const border = alert ? `<rect x="3" y="3" width="138" height="138" rx="10" fill="none" stroke="${COLORS.blocked}" stroke-width="6"/>` : "";
	return svg(bg, border + body);
}
