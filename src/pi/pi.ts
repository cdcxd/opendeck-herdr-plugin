// Shared property inspector logic. Each page marks inputs with
// data-setting (per key) or data-global (plugin-wide) and calls initInspector().

type Settings = Record<string, unknown>;

export interface AgentChoice {
	paneId: string;
	sessionId: string | null;
	label: string;
}

export interface PluginState {
	agents?: AgentChoice[];
	connected?: boolean;
	error?: string | null;
	socketPath?: string;
}

interface ActionInfo {
	action: string;
	context: string;
	payload?: { settings?: Settings };
}

declare global {
	interface Window {
		connectElgatoStreamDeckSocket: (port: string, uuid: string, registerEvent: string, info: string, actionInfo: string) => void;
	}
}

type Field = HTMLInputElement | HTMLSelectElement;

let ws: WebSocket | undefined;
let ctx = "";
let actionInfo: ActionInfo | undefined;
let settings: Settings = {};
let globals: Settings = {};

function send(event: string, payload?: unknown): void {
	ws?.send(JSON.stringify({ event, context: ctx, action: actionInfo?.action, payload }));
}

function read(el: Field): unknown {
	if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
	if (el.type === "number") return Number(el.value) || 1;
	return el.value;
}

function write(el: Field, value: unknown): void {
	if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(value);
	else if (value !== undefined) el.value = String(value);
}

function fields(attr: "data-setting" | "data-global"): Field[] {
	return [...document.querySelectorAll<Field>(`[${attr}]`)];
}

function fill(attr: "data-setting" | "data-global", values: Settings): void {
	for (const el of fields(attr)) write(el, values[el.getAttribute(attr) as string]);
}

export function saveSettings(patch: Settings = {}): void {
	for (const el of fields("data-setting")) settings[el.dataset.setting as string] = read(el);
	Object.assign(settings, patch);
	send("setSettings", settings);
}

function saveGlobals(): void {
	for (const el of fields("data-global")) globals[el.dataset.global as string] = read(el);
	send("setGlobalSettings", globals);
}

export function initInspector({
	onSettings = (_s: Settings) => {},
	onAgentList = (_state: PluginState) => {},
} = {}): void {
	window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, inActionInfo) => {
		ctx = uuid;
		actionInfo = JSON.parse(inActionInfo) as ActionInfo;
		settings = actionInfo.payload?.settings ?? {};
		fill("data-setting", settings);
		onSettings(settings);

		const socket = new WebSocket(`ws://localhost:${port}`);
		ws = socket;
		socket.onopen = () => {
			socket.send(JSON.stringify({ event: registerEvent, uuid }));
			send("getGlobalSettings");
			send("sendToPlugin", { request: "agents" });
		};
		socket.onmessage = (e) => {
			const msg = JSON.parse(String(e.data)) as { event: string; payload?: { settings?: Settings } & PluginState };
			if (msg.event === "didReceiveGlobalSettings") {
				globals = msg.payload?.settings ?? {};
				fill("data-global", globals);
			} else if (msg.event === "didReceiveSettings") {
				settings = msg.payload?.settings ?? {};
				fill("data-setting", settings);
				onSettings(settings);
			} else if (msg.event === "sendToPropertyInspector") {
				const state = msg.payload ?? {};
				const status = document.getElementById("status");
				if (status) {
					status.textContent = state.connected
						? `Connected: ${state.socketPath}`
						: `herdr not reachable at ${state.socketPath}`;
				}
				onAgentList(state);
			}
		};
	};

	for (const el of fields("data-setting")) {
		el.addEventListener("change", () => {
			saveSettings();
			onSettings(settings);
		});
	}
	for (const el of fields("data-global")) el.addEventListener("change", saveGlobals);
}
