import type { RawAgent, RawWorkspace } from "../src/herdr.ts";

export const agentList: { type: string; agents: RawAgent[] } = {
	type: "agent_list",
	agents: [
		{ agent: "claude", agent_status: "idle", pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", focused: false, cwd: "/src/api", terminal_title_stripped: "Claude Code", agent_session: { value: "s-1" } },
		{ agent: "codex", agent_status: "working", pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", focused: true, cwd: "/src/web", terminal_title_stripped: "Fix login" },
		{ agent: "claude", agent_status: "blocked", pane_id: "w2:p2", workspace_id: "w2", tab_id: "w2:t1", focused: false, cwd: "/src/web", agent_session: { value: "s-3" } },
		{ agent: "pi", agent_status: "done", pane_id: "w3:p1", workspace_id: "w3", tab_id: "w3:t1", focused: false, foreground_cwd: "/src/docs" },
	],
};

export const workspaceList: { type: string; workspaces: RawWorkspace[] } = {
	type: "workspace_list",
	workspaces: [
		{ workspace_id: "w2", label: "web", number: 2 },
		{ workspace_id: "w1", label: "api", number: 1 },
	],
};
