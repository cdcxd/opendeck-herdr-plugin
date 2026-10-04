// Entry point: shows herdr agent status on Stream Deck keys.

import { spawn } from "node:child_process";
import { type Agent, countByStatus, HerdrWatcher, percentToken, request, resolveSocketPath, type SocketOptions, sortByAttention } from "./herdr.ts";
import { DEFAULT_MODE, type KeySettings, nextFreeSlot, resolveAgent } from "./keys.ts";
import { msUntilCountdownLabel, msUntilNextLabel, renderAgent, renderEmpty, renderOffline, renderSummary, renderUsage } from "./render.ts";
import { parseArgs, StreamDeck } from "./streamdeck.ts";
import { raiseTerminal } from "./window.ts";

const PLUGIN = "io.github.cdcxd.herdr";
const AGENT_ACTION = `${PLUGIN}.agent`;
const SUMMARY_ACTION = `${PLUGIN}.summary`;
const USAGE_ACTION = `${PLUGIN}.usage`;
const FLASH_MS = 600;

interface GlobalSettings extends SocketOptions {
	activateCommand?: string;
	// "auto" (default) raises the terminal running herdr after a focus; "off" doesn't.
	raise?: "auto" | "off";
}

interface Key {
	action: string;
	device: string;
	settings: KeySettings;
}

if (typeof WebSocket === "undefined") {
	console.error(`herdr status plugin needs Node.js 22 or newer (running ${process.version})`);
	process.exit(1);
}

const sd = new StreamDeck(parseArgs(process.argv.slice(2)));
const log = (msg: string) => {
	console.log(msg);
	sd.log(`[herdr] ${msg}`);
};

const keys = new Map<string, Key>(); // context -> key
const lastImage = new Map<string, string>(); // context -> data URL, to skip redundant setImage calls
let globalSettings: GlobalSettings = {};
let flashOn = false;
let flashTimer: NodeJS.Timeout | null = null;

const watcher = new HerdrWatcher({ socketPath: resolveSocketPath(), log });

function imageFor(key: Key): string {
	if (!watcher.connected) return renderOffline();
	if (key.action === SUMMARY_ACTION) {
		return renderSummary(countByStatus(watcher.agents), { flashOn: Boolean(key.settings.flash) && flashOn });
	}
	if (key.action === USAGE_ACTION) return renderUsage(currentUsage());
	const agent = resolveAgent(watcher.agents, key.settings);
	if (!agent) return renderEmpty(key.settings.mode === "pinned" ? null : key.settings.slot);
	return renderAgent(agent, {
		flashOn: Boolean(key.settings.flash) && flashOn,
		showTitle: key.settings.showTitle,
		background: key.settings.background,
		contextPct: key.settings.contextBar === false ? null : percentToken(agent, "ctx_pct"),
	});
}

// Plan usage is per account, so every agent reports the same window. Usage only
// grows within a window, so the highest value from an unexpired window is the latest.
function currentUsage(now = Date.now()): { pct: number | null; resetsAt: number | null } {
	let best: { pct: number | null; resetsAt: number | null } = { pct: null, resetsAt: null };
	for (const agent of watcher.agents) {
		const pct = percentToken(agent, "usage_pct");
		const resetsAt = Number(agent.tokens.usage_resets) * 1000 || null;
		if (pct === null || (resetsAt !== null && resetsAt <= now)) continue;
		if (best.pct === null || pct > best.pct) best = { pct, resetsAt };
	}
	return best;
}

function render(context: string): void {
	const key = keys.get(context);
	if (!key) return;
	const image = imageFor(key);
	if (lastImage.get(context) === image) return;
	lastImage.set(context, image);
	sd.setImage(context, image);
}

let labelTimer: NodeJS.Timeout | undefined;

function renderAll(): void {
	for (const context of keys.keys()) render(context);
	updateFlashTimer();
	scheduleLabelUpdate();
}

// Redraw exactly when the soonest visible elapsed-time label changes.
function scheduleLabelUpdate(): void {
	clearTimeout(labelTimer);
	const now = Date.now();
	let wait = Infinity;
	for (const key of keys.values()) {
		if (key.action === USAGE_ACTION) {
			const { resetsAt } = currentUsage(now);
			if (resetsAt) wait = Math.min(wait, msUntilCountdownLabel(resetsAt - now));
			continue;
		}
		if (key.action !== AGENT_ACTION) continue;
		const agent = resolveAgent(watcher.agents, key.settings);
		if (agent?.since) wait = Math.min(wait, msUntilNextLabel(now - agent.since));
	}
	if (wait !== Infinity) labelTimer = setTimeout(renderAll, wait + 20);
}

// Blink only while some flash-enabled key is actually showing a blocked agent.
function updateFlashTimer(): void {
	const needed =
		watcher.connected &&
		[...keys.values()].some((key) => {
			if (!key.settings.flash) return false;
			if (key.action === SUMMARY_ACTION) return watcher.agents.some((a) => a.status === "blocked");
			return resolveAgent(watcher.agents, key.settings)?.status === "blocked";
		});
	if (needed && !flashTimer) {
		flashTimer = setInterval(() => {
			flashOn = !flashOn;
			for (const context of keys.keys()) render(context);
		}, FLASH_MS);
	} else if (!needed && flashTimer) {
		clearInterval(flashTimer);
		flashTimer = null;
		flashOn = false;
	}
}

function agentChoices() {
	return watcher.agents.map((a) => ({
		paneId: a.paneId,
		sessionId: a.sessionId,
		label: `${a.label} · ${a.agent}${a.title ? ` · ${a.title}` : ""} (${a.paneId})`,
	}));
}

let lastRaiseError = "";

// agent.focus only switches panes inside herdr; this brings the terminal window
// itself to the front. A custom command replaces the automatic lookup.
function activateTerminal(): void {
	const command = globalSettings.activateCommand?.trim();
	if (!command) {
		if (globalSettings.raise === "off") return;
		raiseTerminal().then(
			() => (lastRaiseError = ""),
			(err: Error) => {
				// Log each distinct failure once, not on every press.
				if (err.message !== lastRaiseError) log(`raise terminal: ${err.message}`);
				lastRaiseError = err.message;
			},
		);
		return;
	}
	const child = spawn("/bin/sh", ["-c", command], { detached: true, stdio: "ignore" });
	child.on("error", (err) => log(`activate command failed: ${err.message}`));
	child.unref();
}

async function focus(context: string, agent: Agent | null | undefined): Promise<void> {
	if (!agent) return;
	try {
		await request(watcher.socketPath, "agent.focus", { target: agent.paneId });
		activateTerminal();
		watcher.scheduleRefresh();
	} catch (err) {
		log(`focus ${agent.paneId} failed: ${(err as Error).message}`);
		sd.showAlert(context);
	}
}

sd.on("connected", () => {
	sd.getGlobalSettings();
	watcher.start();
});

// The host owns our lifetime; exit when it goes away.
sd.on("disconnected", () => process.exit(0));

sd.on("willAppear", ({ context, action, device, payload }) => {
	if (!context || !action) return;
	const settings: KeySettings = { ...(payload?.settings as KeySettings | undefined) };
	if (action === AGENT_ACTION && !settings.mode) {
		settings.mode = DEFAULT_MODE;
		settings.slot = nextFreeSlot(keys.values(), device ?? "");
		settings.flash ??= true;
		sd.setSettings(context, settings);
	}
	if (action === AGENT_ACTION && settings.contextBar === undefined) {
		settings.contextBar = true;
		sd.setSettings(context, settings);
	}
	if (action === SUMMARY_ACTION && settings.flash === undefined) {
		settings.flash = true;
		sd.setSettings(context, settings);
	}
	keys.set(context, { action, device: device ?? "", settings });
	lastImage.delete(context);
	renderAll();
});

sd.on("willDisappear", ({ context }) => {
	if (!context) return;
	keys.delete(context);
	lastImage.delete(context);
	updateFlashTimer();
});

sd.on("didReceiveSettings", ({ context, payload }) => {
	const key = context && keys.get(context);
	if (!key) return;
	key.settings = { ...(payload?.settings as KeySettings | undefined) };
	renderAll();
});

sd.on("didReceiveGlobalSettings", ({ payload }) => {
	globalSettings = (payload?.settings as GlobalSettings | undefined) ?? {};
	watcher.setSocketPath(resolveSocketPath(globalSettings));
});

sd.on("keyDown", ({ context, action }) => {
	const key = context && keys.get(context);
	if (!context || !key) return;
	if (action === SUMMARY_ACTION) {
		const top = sortByAttention(watcher.agents)[0];
		if (top && (top.status === "blocked" || top.status === "done")) void focus(context, top);
		return;
	}
	if (action === USAGE_ACTION) return;
	void focus(context, resolveAgent(watcher.agents, key.settings));
});

sd.on("sendToPlugin", ({ context, action, payload }) => {
	if (!context || !action) return;
	if (payload?.request === "agents") {
		sd.sendToPropertyInspector(context, action, {
			agents: agentChoices(),
			connected: watcher.connected,
			error: watcher.error,
			socketPath: watcher.socketPath,
		});
	}
});

watcher.on("update", () => {
	if (!watcher.connected) log(`herdr unreachable at ${watcher.socketPath}: ${watcher.error}`);
	renderAll();
});

sd.connect();
