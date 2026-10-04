// Which agent a key shows. Pure functions so they can be unit tested.

import { type Agent, sortByAttention } from "./herdr.ts";

export type Mode = "attention" | "order" | "pinned";

export interface KeySettings {
	mode?: Mode;
	slot?: number;
	paneId?: string;
	sessionId?: string;
	hideIdle?: boolean;
	flash?: boolean;
	showTitle?: boolean;
	background?: "tint" | "plain";
	// Bar along the bottom showing the agent's context window use; on unless false.
	contextBar?: boolean;
}

export const DEFAULT_MODE: Mode = "order";

// mode "order":     slot N is the Nth agent in herdr's workspace/pane order (keys stay put).
// mode "attention": slot N is the Nth agent, most urgent first (keys reorder as states change).
// mode "pinned":    always the same agent, matched by session id, then pane id.
// `hideIdle` drops idle agents from slot modes so keys only show agents with something going on.
export function resolveAgent(agents: readonly Agent[], settings: KeySettings = {}): Agent | null {
	const mode = settings.mode || DEFAULT_MODE;
	if (mode === "pinned") {
		return (
			(settings.sessionId && agents.find((a) => a.sessionId === settings.sessionId)) ||
			(settings.paneId && agents.find((a) => a.paneId === settings.paneId)) ||
			null
		);
	}
	const slot = Number(settings.slot) || 1;
	const visible = settings.hideIdle ? agents.filter((a) => a.status !== "idle") : agents;
	const list = mode === "order" ? visible : sortByAttention(visible);
	return list[slot - 1] ?? null;
}

// Lowest slot number not already used by another slot-based key on the same device.
export function nextFreeSlot(keys: Iterable<{ device: string; settings: KeySettings }>, device: string): number {
	const used = new Set<number>();
	for (const key of keys) {
		if (key.device === device && key.settings.slot && key.settings.mode !== "pinned") used.add(Number(key.settings.slot));
	}
	let slot = 1;
	while (used.has(slot)) slot++;
	return slot;
}
