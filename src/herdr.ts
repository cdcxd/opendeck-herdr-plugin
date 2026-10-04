// Client for the herdr socket API: newline-delimited JSON over a Unix socket.
// https://herdr.dev/docs/socket-api/

import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export type Status = "blocked" | "working" | "done" | "idle" | "unknown";

export interface Agent {
	paneId: string;
	workspaceId: string;
	sessionId: string | null;
	status: Status;
	agent: string;
	workspace: string;
	// herdr agent name, set with `herdr agent rename`.
	name: string | null;
	// What the key shows; see labelAgents.
	label: string;
	title: string;
	focused: boolean;
	stateSeq: number;
	order: number;
	// Epoch ms when this agent entered its current status, as observed by the plugin.
	// herdr exposes no timestamps, so after a plugin restart this starts from first sight.
	since: number;
	// Values harness adapters report with `herdr pane report-metadata --token`; see integrations/.
	tokens: Record<string, string>;
}

// The subset of herdr's agent.list / workspace.list responses we read.
export interface RawAgent {
	pane_id: string;
	workspace_id: string;
	tab_id?: string;
	agent_status: string;
	agent?: string;
	name?: string;
	display_agent?: string;
	title?: string;
	terminal_title_stripped?: string;
	cwd?: string;
	foreground_cwd?: string;
	focused?: boolean;
	state_change_seq?: number;
	agent_session?: { value?: string };
	tokens?: Record<string, string>;
}

export interface RawWorkspace {
	workspace_id: string;
	label?: string;
	number?: number;
}

export interface SocketOptions {
	socketPath?: string;
	session?: string;
}

type Env = Record<string, string | undefined>;

// Mirrors herdr's own resolution: HERDR_SOCKET_PATH, then HERDR_SESSION,
// then the default session under $XDG_CONFIG_HOME/herdr or ~/.config/herdr.
export function resolveSocketPath({ socketPath, session }: SocketOptions = {}, env: Env = process.env): string {
	if (socketPath) return expandHome(socketPath, env);
	if (env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
	const configDir = env.XDG_CONFIG_HOME
		? path.join(env.XDG_CONFIG_HOME, "herdr")
		: path.join(env.HOME || os.homedir(), ".config", "herdr");
	const name = session || env.HERDR_SESSION;
	return name ? path.join(configDir, "sessions", name, "herdr.sock") : path.join(configDir, "herdr.sock");
}

function expandHome(p: string, env: Env): string {
	return p.startsWith("~/") ? path.join(env.HOME || os.homedir(), p.slice(2)) : p;
}

interface Message {
	id?: string;
	result?: unknown;
	error?: { code?: string; message?: string };
	[key: string]: unknown;
}

// Splits a stream into parsed JSON lines, skipping blank and malformed ones.
function onJsonLines(sock: net.Socket, handler: (msg: Message) => void): void {
	let buf = "";
	sock.setEncoding("utf8");
	sock.on("data", (chunk: string) => {
		buf += chunk;
		let nl;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!line) continue;
			let msg: Message;
			try {
				msg = JSON.parse(line);
			} catch {
				continue;
			}
			handler(msg);
		}
	});
}

export class HerdrError extends Error {
	code: string | undefined;
	constructor(message: string, code?: string) {
		super(message);
		this.code = code;
	}
}

let nextId = 0;

export function request<T = unknown>(
	socketPath: string,
	method: string,
	params: object = {},
	{ timeoutMs = 3000 } = {},
): Promise<T> {
	return new Promise((resolve, reject) => {
		const id = `herdr-deck:${process.pid}:${++nextId}`;
		const sock = net.createConnection(socketPath);
		let settled = false;
		const finish = (err: Error | null, value?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			sock.destroy();
			if (err) reject(err);
			else resolve(value as T);
		};
		const timer = setTimeout(() => finish(new Error(`${method} timed out`)), timeoutMs);
		sock.on("connect", () => sock.write(JSON.stringify({ id, method, params }) + "\n"));
		onJsonLines(sock, (msg) => {
			if (msg.id !== id) return;
			if (msg.error) finish(new HerdrError(msg.error.message || msg.error.code || "herdr error", msg.error.code));
			else finish(null, msg.result);
		});
		sock.on("error", (err) => finish(err));
		sock.on("close", () => finish(new Error(`${method}: connection closed`)));
	});
}

const STATUSES = new Set<string>(["blocked", "working", "done", "idle"]);

// Lower rank = needs attention sooner.
export const ATTENTION_RANK: Record<Status, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };

// Joins agent.list with workspace.list into flat records in herdr's display order.
export function normalizeAgents(
	agentList: { agents?: RawAgent[] } | null | undefined,
	workspaceList: { workspaces?: RawWorkspace[] } | null | undefined,
): Agent[] {
	const workspaces = new Map<string, { label: string | undefined; number: number }>();
	(workspaceList?.workspaces ?? []).forEach((ws, i) => {
		workspaces.set(ws.workspace_id, { label: ws.label, number: ws.number ?? i + 1 });
	});
	return (agentList?.agents ?? [])
		.map((a, i): Agent => {
			const ws = workspaces.get(a.workspace_id);
			const cwd = a.foreground_cwd || a.cwd || "";
			const sessionId = a.agent_session?.value ?? null;
			return {
				paneId: a.pane_id,
				workspaceId: a.workspace_id,
				sessionId,
				status: STATUSES.has(a.agent_status) ? (a.agent_status as Status) : "unknown",
				agent: a.display_agent || a.agent || "agent",
				workspace: ws?.label || path.basename(cwd) || a.workspace_id,
				name: a.name || null,
				label: "",
				title: a.terminal_title_stripped || a.title || "",
				focused: Boolean(a.focused),
				stateSeq: a.state_change_seq ?? 0,
				order: (ws?.number ?? 1e6) * 1e4 + i,
				since: 0,
				tokens: currentTokens(a.tokens, sessionId),
			};
		})
		.sort((a, b) => a.order - b.order);
}

// herdr keeps pane tokens until their TTL runs out, even after the agent exits.
// Adapters report a `session` token; drop tokens left behind by another session.
function currentTokens(tokens: Record<string, string> | undefined, sessionId: string | null): Record<string, string> {
	if (!tokens) return {};
	if (tokens.session && sessionId && tokens.session !== sessionId) return {};
	return tokens;
}

// Percentage token as a number clamped to 0..100, or null when absent or malformed.
export function percentToken(agent: Pick<Agent, "tokens">, name: string): number | null {
	const raw = agent.tokens[name];
	if (raw === undefined || raw.trim() === "") return null;
	const n = Number(raw);
	return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

// Key label: the herdr agent name if set (`herdr agent rename`), otherwise the
// workspace, numbered in herdr order when several agents share it ("web 1", "web 2").
export function labelAgents(agents: Agent[]): Agent[] {
	const totals = new Map<string, number>();
	for (const a of agents) totals.set(a.workspaceId, (totals.get(a.workspaceId) ?? 0) + 1);
	const seen = new Map<string, number>();
	return agents.map((a) => {
		const n = (seen.get(a.workspaceId) ?? 0) + 1;
		seen.set(a.workspaceId, n);
		const label = a.name || ((totals.get(a.workspaceId) ?? 0) > 1 ? `${a.workspace} ${n}` : a.workspace);
		return { ...a, label };
	});
}

// Carries `since` over from the previous list while an agent's status is unchanged.
export function trackSince(agents: Agent[], previous: readonly Agent[], now: number): Agent[] {
	const prev = new Map(previous.map((a) => [a.paneId, a]));
	return agents.map((a) => {
		const p = prev.get(a.paneId);
		const same = p && p.status === a.status && p.agent === a.agent && p.stateSeq === a.stateSeq;
		return { ...a, since: same ? p.since : now };
	});
}

export function sortByAttention(agents: readonly Agent[]): Agent[] {
	return [...agents].sort((a, b) => ATTENTION_RANK[a.status] - ATTENTION_RANK[b.status] || a.order - b.order);
}

export function countByStatus(agents: readonly Agent[]): Record<Status, number> {
	const counts: Record<Status, number> = { blocked: 0, working: 0, done: 0, idle: 0, unknown: 0 };
	for (const a of agents) counts[a.status]++;
	return counts;
}

const LIFECYCLE_EVENTS = [
	"workspace.created",
	"workspace.closed",
	"workspace.renamed",
	"workspace.moved",
	"workspace.reordered",
	"pane.created",
	"pane.closed",
	"pane.moved",
	"pane.exited",
	"pane.agent_detected",
];

export interface WatcherOptions {
	socketPath: string;
	pollMs?: number;
	retryMs?: number;
	debounceMs?: number;
	log?: (msg: string) => void;
}

// Keeps an up-to-date agent list. Event subscriptions make updates instant;
// a slow poll covers anything the subscription misses and handles reconnects.
// Events are only used as "something changed" signals, as herdr recommends.
export class HerdrWatcher extends EventEmitter<{ update: [HerdrWatcher] }> {
	socketPath: string;
	pollMs: number;
	retryMs: number;
	debounceMs: number;
	log: (msg: string) => void;
	agents: Agent[] = [];
	connected = false;
	error: string | null = null;
	private sub: net.Socket | null = null;
	private subKey: string | null = null;
	private refreshing: Promise<void> | null = null;
	private refreshAgain = false;
	private debounceTimer: NodeJS.Timeout | undefined;
	private pollTimer: NodeJS.Timeout | undefined;
	private stopped = true;

	constructor({ socketPath, pollMs = 5000, retryMs = 3000, debounceMs = 50, log = () => {} }: WatcherOptions) {
		super();
		this.socketPath = socketPath;
		this.pollMs = pollMs;
		this.retryMs = retryMs;
		this.debounceMs = debounceMs;
		this.log = log;
	}

	start(): void {
		this.stopped = false;
		void this.refresh();
	}

	stop(): void {
		this.stopped = true;
		clearTimeout(this.pollTimer);
		clearTimeout(this.debounceTimer);
		this.closeSubscription();
	}

	setSocketPath(socketPath: string): void {
		if (socketPath === this.socketPath) return;
		this.socketPath = socketPath;
		this.closeSubscription();
		void this.refresh();
	}

	scheduleRefresh(delay = this.debounceMs): void {
		clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => void this.refresh(), delay);
	}

	// Serialized: a refresh requested mid-flight runs once more afterwards.
	refresh(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		if (this.refreshing) {
			this.refreshAgain = true;
			return this.refreshing;
		}
		this.refreshing = this.doRefresh().finally(() => {
			this.refreshing = null;
			if (this.refreshAgain) {
				this.refreshAgain = false;
				void this.refresh();
			}
		});
		return this.refreshing;
	}

	private async doRefresh(): Promise<void> {
		clearTimeout(this.pollTimer);
		try {
			const [agentList, workspaceList] = await Promise.all([
				request<{ agents?: RawAgent[] }>(this.socketPath, "agent.list"),
				request<{ workspaces?: RawWorkspace[] }>(this.socketPath, "workspace.list"),
			]);
			this.update(trackSince(labelAgents(normalizeAgents(agentList, workspaceList)), this.agents, Date.now()), true, null);
			this.ensureSubscription();
		} catch (err) {
			this.closeSubscription();
			this.update([], false, (err as Error).message);
		}
		if (!this.stopped) {
			this.pollTimer = setTimeout(() => void this.refresh(), this.connected ? this.pollMs : this.retryMs);
		}
	}

	private update(agents: Agent[], connected: boolean, error: string | null): void {
		const changed =
			connected !== this.connected || error !== this.error || JSON.stringify(agents) !== JSON.stringify(this.agents);
		this.agents = agents;
		this.connected = connected;
		this.error = error;
		if (changed) this.emit("update", this);
	}

	// Status subscriptions are per pane, so resubscribe whenever the pane set changes.
	private ensureSubscription(): void {
		const paneIds = this.agents.map((a) => a.paneId).sort();
		const key = `${this.socketPath}|${paneIds.join(",")}`;
		if (this.sub && this.subKey === key) return;
		this.closeSubscription();

		const subscriptions = [
			...LIFECYCLE_EVENTS.map((type) => ({ type })),
			...paneIds.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
		];
		const sock = net.createConnection(this.socketPath);
		this.sub = sock;
		this.subKey = key;
		sock.on("connect", () =>
			sock.write(JSON.stringify({ id: "herdr-deck:sub", method: "events.subscribe", params: { subscriptions } }) + "\n"),
		);
		onJsonLines(sock, (msg) => {
			if (msg.error) {
				// e.g. events_lost, or a pane closed before we subscribed.
				this.log(`subscription ended: ${msg.error.code || msg.error.message}`);
				this.closeSubscription();
			}
			this.scheduleRefresh();
		});
		sock.on("error", () => {});
		sock.on("close", () => {
			if (this.sub !== sock) return;
			this.sub = null;
			this.subKey = null;
			this.scheduleRefresh(this.retryMs);
		});
	}

	private closeSubscription(): void {
		const sock = this.sub;
		this.sub = null;
		this.subKey = null;
		sock?.destroy();
	}
}
