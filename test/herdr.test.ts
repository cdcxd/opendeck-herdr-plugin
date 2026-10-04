import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { countByStatus, HerdrWatcher, labelAgents, normalizeAgents, percentToken, request, resolveSocketPath, sortByAttention, trackSince } from "../src/herdr.ts";
import { agentList, workspaceList } from "./fixtures.ts";

describe("resolveSocketPath", () => {
	it("prefers an explicit path and expands ~", () => {
		assert.equal(resolveSocketPath({ socketPath: "~/x.sock" }, { HOME: "/h" }), "/h/x.sock");
	});
	it("honours HERDR_SOCKET_PATH, then sessions, then XDG_CONFIG_HOME", () => {
		assert.equal(resolveSocketPath({}, { HERDR_SOCKET_PATH: "/s.sock", HOME: "/h" }), "/s.sock");
		assert.equal(resolveSocketPath({ session: "work" }, { HOME: "/h" }), "/h/.config/herdr/sessions/work/herdr.sock");
		assert.equal(resolveSocketPath({}, { HOME: "/h", HERDR_SESSION: "b" }), "/h/.config/herdr/sessions/b/herdr.sock");
		assert.equal(resolveSocketPath({}, { HOME: "/h", XDG_CONFIG_HOME: "/x" }), "/x/herdr/herdr.sock");
		assert.equal(resolveSocketPath({}, { HOME: "/h" }), "/h/.config/herdr/herdr.sock");
	});
});

describe("normalizeAgents", () => {
	const agents = normalizeAgents(agentList, workspaceList);
	it("orders by workspace number, then herdr's list order", () => {
		assert.deepEqual(agents.map((a) => a.paneId), ["w1:p1", "w2:p1", "w2:p2", "w3:p1"]);
	});
	it("labels with the workspace name, falling back to the cwd", () => {
		assert.deepEqual(agents.map((a) => a.workspace), ["api", "web", "web", "docs"]);
	});
	it("numbers agents that share a workspace and prefers herdr agent names", () => {
		assert.deepEqual(labelAgents(agents).map((a) => a.label), ["api", "web 1", "web 2", "docs"]);
		const named = agents.map((a) => (a.paneId === "w2:p2" ? { ...a, name: "reviewer" } : a));
		assert.deepEqual(labelAgents(named).map((a) => a.label), ["api", "web 1", "reviewer", "docs"]);
	});
	it("maps unrecognised statuses to unknown", () => {
		const [a] = normalizeAgents({ agents: [{ agent_status: "weird", pane_id: "p", workspace_id: "w" }] }, null);
		assert.equal(a?.status, "unknown");
	});
	it("keeps since while the status is unchanged", () => {
		const first = trackSince(agents, [], 100);
		const changed = agents.map((a) => (a.paneId === "w1:p1" ? { ...a, status: "working" as const } : a));
		const second = trackSince(changed, first, 200);
		assert.deepEqual(second.map((a) => a.since), [200, 100, 100, 100]);
	});
	it("keeps tokens only from the agent's own session", () => {
		const raw = (session: string) => ({ agent_status: "idle", pane_id: "p", workspace_id: "w", agent_session: { value: "s-1" }, tokens: { session, ctx_pct: "42" } });
		assert.equal(normalizeAgents({ agents: [raw("s-1")] }, null)[0]?.tokens.ctx_pct, "42");
		assert.deepEqual(normalizeAgents({ agents: [raw("old")] }, null)[0]?.tokens, {});
		assert.deepEqual(normalizeAgents({ agents: [{ agent_status: "idle", pane_id: "p", workspace_id: "w" }] }, null)[0]?.tokens, {});
	});
	it("reads percentage tokens", () => {
		assert.equal(percentToken({ tokens: { ctx_pct: "42" } }, "ctx_pct"), 42);
		assert.equal(percentToken({ tokens: { ctx_pct: "140" } }, "ctx_pct"), 100);
		assert.equal(percentToken({ tokens: { ctx_pct: "n/a" } }, "ctx_pct"), null);
		assert.equal(percentToken({ tokens: {} }, "ctx_pct"), null);
	});
	it("sorts by attention and counts", () => {
		assert.deepEqual(sortByAttention(agents).map((a) => a.status), ["blocked", "done", "working", "idle"]);
		assert.deepEqual(countByStatus(agents), { blocked: 1, working: 1, done: 1, idle: 1, unknown: 0 });
	});
});

interface Fake {
	server: net.Server;
	state: { agents: typeof agentList; subscribers: Set<net.Socket>; requests: string[] };
}

// A fake herdr server speaking newline-delimited JSON.
function fakeHerdr(socketPath: string): Promise<Fake> {
	const state: Fake["state"] = { agents: structuredClone(agentList), subscribers: new Set(), requests: [] };
	const server = net.createServer((sock) => {
		let buf = "";
		sock.on("data", (chunk) => {
			buf += chunk;
			let nl;
			while ((nl = buf.indexOf("\n")) >= 0) {
				const msg = JSON.parse(buf.slice(0, nl));
				buf = buf.slice(nl + 1);
				state.requests.push(msg.method);
				const reply = (result: unknown) => sock.write(JSON.stringify({ id: msg.id, result }) + "\n");
				if (msg.method === "agent.list") reply(state.agents);
				else if (msg.method === "workspace.list") reply(workspaceList);
				else if (msg.method === "agent.focus") reply({ type: "ok", target: msg.params.target });
				else if (msg.method === "events.subscribe") {
					state.subscribers.add(sock);
					sock.on("close", () => state.subscribers.delete(sock));
					reply({ type: "subscription_started" });
				} else sock.write(JSON.stringify({ id: msg.id, error: { code: "unknown_method", message: "nope" } }) + "\n");
			}
		});
		sock.on("error", () => {});
	});
	return new Promise((resolve) => server.listen(socketPath, () => resolve({ server, state })));
}

describe("against a fake herdr", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deck-"));
	const socketPath = path.join(dir, "herdr.sock");
	let fake: Fake;
	before(async () => (fake = await fakeHerdr(socketPath)));
	after(() => {
		fake.server.close();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("request returns results and surfaces errors", async () => {
		assert.equal((await request<{ target: string }>(socketPath, "agent.focus", { target: "w1:p1" })).target, "w1:p1");
		await assert.rejects(request(socketPath, "bogus"), { code: "unknown_method" });
	});

	it("request rejects when herdr is not running", async () => {
		await assert.rejects(request(path.join(dir, "missing.sock"), "agent.list"));
	});

	it("watcher loads agents, subscribes, and refreshes on events", async () => {
		const watcher = new HerdrWatcher({ socketPath, pollMs: 60_000 });
		const nextUpdate = () => new Promise((resolve) => watcher.once("update", resolve));
		let updated = nextUpdate();
		watcher.start();
		await updated;
		assert.equal(watcher.connected, true);
		assert.equal(watcher.agents.length, 4);

		while (fake.state.subscribers.size === 0) await new Promise((r) => setTimeout(r, 10));
		fake.state.agents.agents[0]!.agent_status = "blocked";
		updated = nextUpdate();
		for (const sock of fake.state.subscribers) {
			sock.write(JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: "w1:p1" } }) + "\n");
		}
		await updated;
		assert.equal(watcher.agents.find((a) => a.paneId === "w1:p1")?.status, "blocked");
		watcher.stop();
	});

	it("watcher reports offline when the socket is missing", async () => {
		const watcher = new HerdrWatcher({ socketPath: path.join(dir, "missing.sock"), retryMs: 60_000 });
		watcher.connected = true; // force a change so update fires
		const updated = new Promise((resolve) => watcher.once("update", resolve));
		watcher.start();
		await updated;
		assert.equal(watcher.connected, false);
		assert.ok(watcher.error);
		watcher.stop();
	});
});
