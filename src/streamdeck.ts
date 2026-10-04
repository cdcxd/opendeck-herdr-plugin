// Minimal Stream Deck SDK v2 plugin connection (also spoken by OpenDeck).
// Uses the WebSocket global, which needs Node.js 22+.

import { EventEmitter } from "node:events";

export interface LaunchArgs {
	port: string | undefined;
	uuid: string | undefined;
	registerEvent: string | undefined;
	info: string | undefined;
}

export function parseArgs(argv: readonly string[]): LaunchArgs {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length - 1; i++) {
		const flag = argv[i] as string;
		if (flag.startsWith("-")) args[flag.replace(/^-+/, "")] = argv[++i] as string;
	}
	return { port: args.port, uuid: args.pluginUUID, registerEvent: args.registerEvent, info: args.info };
}

// The fields we use from host -> plugin events.
export interface InboundEvent {
	event: string;
	action?: string;
	context?: string;
	device?: string;
	payload?: {
		settings?: Record<string, unknown>;
		[key: string]: unknown;
	};
}

type Events = { connected: []; disconnected: [] } & Record<string, [InboundEvent]>;

export class StreamDeck extends EventEmitter<Events> {
	private readonly args: LaunchArgs;
	private ws: WebSocket | null = null;

	constructor(args: LaunchArgs) {
		super();
		this.args = args;
	}

	get uuid(): string {
		return this.args.uuid ?? "";
	}

	connect(): void {
		const ws = new WebSocket(`ws://127.0.0.1:${this.args.port}`);
		this.ws = ws;
		ws.addEventListener("open", () => {
			ws.send(JSON.stringify({ event: this.args.registerEvent, uuid: this.args.uuid }));
			this.emit("connected");
		});
		ws.addEventListener("message", (e) => {
			let msg: InboundEvent;
			try {
				msg = JSON.parse(String(e.data));
			} catch {
				return;
			}
			if (msg.event) this.emit(msg.event, msg);
		});
		ws.addEventListener("close", () => this.emit("disconnected"));
		ws.addEventListener("error", () => {});
	}

	send(message: object): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
	}

	setImage(context: string, image: string): void {
		this.send({ event: "setImage", context, payload: { image, target: 0 } });
	}

	setSettings(context: string, settings: object): void {
		this.send({ event: "setSettings", context, payload: settings });
	}

	getGlobalSettings(): void {
		this.send({ event: "getGlobalSettings", context: this.uuid });
	}

	sendToPropertyInspector(context: string, action: string, payload: object): void {
		this.send({ event: "sendToPropertyInspector", action, context, payload });
	}

	showAlert(context: string): void {
		this.send({ event: "showAlert", context });
	}

	log(message: string): void {
		this.send({ event: "logMessage", payload: { message } });
	}
}
