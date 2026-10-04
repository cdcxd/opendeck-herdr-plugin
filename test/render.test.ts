import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COLORS, formatElapsed, levelColor, msUntilCountdownLabel, msUntilNextLabel, renderAgent, renderEmpty, renderOffline, renderSummary, renderUsage, truncate } from "../src/render.ts";

const decode = (url: string) => {
	assert.match(url, /^data:image\/svg\+xml;charset=utf8,/);
	return decodeURIComponent(url.slice(url.indexOf(",") + 1));
};

describe("render", () => {
	const agent = { status: "blocked", agent: "claude", label: "a<b>&c", title: "t", since: 1_000 } as const;
	it("draws the status color and escapes text", () => {
		const svg = decode(renderAgent(agent));
		assert.ok(svg.includes(COLORS.blocked));
		assert.ok(svg.includes("a&lt;b&gt;&amp;c"));
	});
	it("shows time in the current status", () => {
		assert.ok(decode(renderAgent(agent, { now: 1_000 + 7 * 60_000 })).includes(">7m<"));
		assert.ok(!decode(renderAgent({ ...agent, since: 0 })).includes(">0s<"));
	});
	it("tints the background by default, except when idle", () => {
		assert.ok(decode(renderAgent(agent)).includes('opacity="0.28"'));
		assert.ok(!decode(renderAgent(agent, { background: "plain" })).includes('opacity="0.28"'));
		assert.ok(!decode(renderAgent({ ...agent, status: "idle" })).includes('opacity="0.28"'));
	});
	it("draws idle as a hollow dot", () => {
		const svg = decode(renderAgent({ ...agent, status: "idle" }));
		assert.match(svg, new RegExp(`<circle [^>]*fill="none" stroke="${COLORS.idle}"`));
		assert.doesNotMatch(svg, new RegExp(`<circle [^>]*fill="${COLORS.idle}"`));
	});
	it("formats elapsed time compactly", () => {
		assert.deepEqual([4e3, 45e3, 7 * 60e3, 3 * 3600e3, 2 * 86400e3].map(formatElapsed), ["0s", "40s", "7m", "3h", "2d"]);
	});
	it("knows when the label next changes", () => {
		assert.equal(msUntilNextLabel(0), 10_000);
		assert.equal(msUntilNextLabel(43_000), 7_000);
		assert.equal(msUntilNextLabel(90_000), 30_000);
		assert.equal(msUntilNextLabel(3_600_000), 3_600_000);
	});
	it("flash changes the blocked image only", () => {
		assert.notEqual(renderAgent(agent, { flashOn: true }), renderAgent(agent));
		const working = { ...agent, status: "working" } as const;
		assert.equal(renderAgent(working, { flashOn: true }), renderAgent(working));
	});
	it("draws a context bar only when context use is known", () => {
		assert.ok(!decode(renderAgent(agent)).includes(`opacity="0.15"`));
		assert.ok(decode(renderAgent(agent, { contextPct: 50 })).includes(`fill="${levelColor(50)}"`));
		assert.equal(levelColor(75), "#f5a524");
		assert.equal(levelColor(95), COLORS.blocked);
	});
	it("renders plan usage with time until reset", () => {
		const svg = decode(renderUsage({ pct: 63, resetsAt: 2 * 3_600_000 + 5_000, now: 0 }));
		assert.ok(svg.includes(">63%<") && svg.includes(">resets 2h<"));
		assert.ok(decode(renderUsage({ pct: null })).includes("no data"));
		assert.equal(msUntilCountdownLabel(2 * 3_600_000 + 5_000), 5_001);
		assert.equal(msUntilCountdownLabel(0), Infinity);
	});
	it("summary lists only non-zero statuses", () => {
		const svg = decode(renderSummary({ blocked: 0, working: 2, done: 0, idle: 1 }));
		assert.ok(svg.includes("working") && svg.includes("idle") && !svg.includes("blocked"));
		assert.ok(decode(renderSummary({ blocked: 0, working: 0, done: 0, idle: 0 })).includes("no agents"));
	});
	it("renders placeholders", () => {
		assert.ok(decode(renderEmpty(3)).includes("slot 3"));
		assert.ok(decode(renderOffline()).includes("offline"));
	});
	it("truncates by characters", () => {
		assert.equal(truncate("abcdef", 4), "abc…");
		assert.equal(truncate("abc", 4), "abc");
	});
});
