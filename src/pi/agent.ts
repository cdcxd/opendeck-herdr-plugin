// Property inspector for the Agent action.

import { initInspector, saveSettings } from "./pi.ts";

const pin = document.getElementById("pin") as HTMLSelectElement;
let current: Record<string, unknown> = {};

function show(id: string, on: boolean): void {
	(document.getElementById(id) as HTMLElement).style.display = on ? "" : "none";
}

pin.addEventListener("change", () => {
	const opt = pin.selectedOptions[0];
	saveSettings({ paneId: opt?.value ?? "", sessionId: opt?.dataset.session ?? "" });
});

initInspector({
	onSettings(s) {
		current = s;
		const pinned = s.mode === "pinned";
		show("slot-row", !pinned);
		show("idle-row", !pinned);
		show("pin-row", pinned);
	},
	onAgentList({ agents = [] }) {
		pin.replaceChildren(new Option("Choose an agent…", ""));
		for (const a of agents) {
			const opt = new Option(a.label, a.paneId);
			opt.dataset.session = a.sessionId ?? "";
			pin.add(opt);
		}
		const match = agents.find((a) => (current.sessionId && a.sessionId === current.sessionId) || a.paneId === current.paneId);
		if (match) pin.value = match.paneId;
		else if (typeof current.paneId === "string" && current.paneId) {
			pin.add(new Option(`${current.paneId} (not running)`, current.paneId, true, true));
		}
	},
});
