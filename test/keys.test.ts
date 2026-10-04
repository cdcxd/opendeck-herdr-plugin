import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAgents } from "../src/herdr.ts";
import { type KeySettings, nextFreeSlot, resolveAgent } from "../src/keys.ts";
import { agentList, workspaceList } from "./fixtures.ts";

const agents = normalizeAgents(agentList, workspaceList);
const pane = (settings: KeySettings) => resolveAgent(agents, settings)?.paneId;
const status = (settings: KeySettings) => resolveAgent(agents, settings)?.status;

describe("resolveAgent", () => {
	it("defaults to herdr order", () => {
		assert.equal(pane({ slot: 1 }), "w1:p1");
		assert.equal(pane({}), "w1:p1");
	});
	it("supports attention order", () => {
		assert.equal(pane({ mode: "attention", slot: 1 }), "w2:p2");
		assert.equal(status({ mode: "attention" }), "blocked");
	});
	it("supports herdr order", () => {
		assert.equal(pane({ mode: "order", slot: 1 }), "w1:p1");
	});
	it("skips idle agents when asked", () => {
		assert.equal(pane({ mode: "order", slot: 1, hideIdle: true }), "w2:p1");
		assert.equal(resolveAgent(agents, { slot: 4, hideIdle: true }), null);
	});
	it("pins by session id first, then pane id", () => {
		assert.equal(pane({ mode: "pinned", sessionId: "s-1", paneId: "w9:p9" }), "w1:p1");
		assert.equal(pane({ mode: "pinned", paneId: "w3:p1" }), "w3:p1");
		assert.equal(resolveAgent(agents, { mode: "pinned", paneId: "gone" }), null);
	});
	it("returns null for empty slots", () => {
		assert.equal(resolveAgent(agents, { slot: 9 }), null);
	});
});

describe("nextFreeSlot", () => {
	it("fills gaps per device and ignores pinned keys", () => {
		const keys: { device: string; settings: KeySettings }[] = [
			{ device: "a", settings: { slot: 1 } },
			{ device: "a", settings: { slot: 3 } },
			{ device: "a", settings: { mode: "pinned", slot: 2 } },
			{ device: "b", settings: { slot: 2 } },
		];
		assert.equal(nextFreeSlot(keys, "a"), 2);
		assert.equal(nextFreeSlot(keys, "b"), 1);
	});
});
