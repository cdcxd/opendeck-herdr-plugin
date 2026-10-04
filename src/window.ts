// Brings the terminal running herdr to the front after a key press.
// agent.focus only switches panes inside herdr; the terminal window itself may be
// behind a browser or minimized. We find it from the process tree: the herdr client
// process runs inside the terminal, so the nearest ancestor that owns a window is it.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// A timeout so a stuck X server or a pending macOS permission prompt can't pile up
// hung children, one per key press.
function run(file: string, args: string[], options: { maxBuffer?: number } = {}) {
	return execFileAsync(file, args, { timeout: 3000, ...options });
}

export interface Proc {
	pid: number;
	ppid: number;
	args: string;
}

// `ps -eo pid=,ppid=,args=` output, on Linux and macOS.
export function parsePs(out: string): Proc[] {
	const procs: Proc[] = [];
	for (const line of out.split("\n")) {
		const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
		if (m) procs.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] as string });
	}
	return procs;
}

// The interactive herdr client: `herdr` with no subcommand (flags allowed), not
// `herdr server` or a one-off CLI call like `herdr agent list`.
export function isHerdrClient(args: string): boolean {
	const [exe = "", sub] = args.trim().split(/\s+/);
	return exe.split("/").pop() === "herdr" && (sub === undefined || sub.startsWith("-"));
}

// Window owner pids for each herdr client's nearest windowed ancestor, newest client first.
export function terminalPids(procs: readonly Proc[], windowPids: ReadonlySet<number>): number[] {
	const byPid = new Map(procs.map((p) => [p.pid, p]));
	const found: number[] = [];
	const clients = procs.filter((p) => isHerdrClient(p.args)).sort((a, b) => b.pid - a.pid);
	for (const client of clients) {
		for (let p = byPid.get(client.ppid), depth = 0; p && depth < 32; p = byPid.get(p.ppid), depth++) {
			if (windowPids.has(p.pid)) {
				if (!found.includes(p.pid)) found.push(p.pid);
				break;
			}
		}
	}
	return found;
}

// `wmctrl -lp` lines: "<window id> <desktop> <pid> <host> <title>".
export function parseWmctrl(out: string): { id: string; pid: number }[] {
	const windows: { id: string; pid: number }[] = [];
	for (const line of out.split("\n")) {
		const m = /^(0x[0-9a-f]+)\s+-?\d+\s+(\d+)\s/i.exec(line);
		if (m) windows.push({ id: m[1] as string, pid: Number(m[2]) });
	}
	return windows;
}

async function processes(): Promise<Proc[]> {
	// -ww: BSD ps cuts args to the terminal width otherwise.
	const { stdout } = await run("ps", ["-ww", "-eo", "pid=,ppid=,args="], { maxBuffer: 8 << 20 });
	return parsePs(stdout);
}

async function raiseX11(): Promise<string> {
	let listing: string;
	try {
		listing = (await run("wmctrl", ["-lp"])).stdout;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error("install wmctrl to bring the terminal to the front");
		throw new Error(`wmctrl failed: ${(err as Error).message}`);
	}
	const windows = parseWmctrl(listing);
	const [pid] = terminalPids(await processes(), new Set(windows.map((w) => w.pid)));
	if (pid === undefined) throw new Error("no terminal window running a herdr client found");
	// Last in wmctrl's list is the most recently mapped window of that terminal.
	const id = windows.filter((w) => w.pid === pid).at(-1)?.id as string;
	await run("wmctrl", ["-i", "-a", id]);
	return id;
}

// Bundle path of a process running from an app, e.g. "/Applications/iTerm.app".
export function appBundle(args: string): string | null {
	const i = args.indexOf(".app/");
	return i < 0 ? null : args.slice(0, i + 4);
}

// The app's main process for a helper inside its bundle (iTerm2 runs shells under
// iTerm.app/Contents/MacOS/iTermServer-*, which System Events can't bring forward).
export function bundleMainPid(procs: readonly Proc[], pid: number): number {
	const bundle = appBundle(procs.find((p) => p.pid === pid)?.args ?? "");
	if (!bundle) return pid;
	// The app itself is launched by launchd (ppid 1); helpers like wezterm-mux-server
	// or a CLI started from a shell are not. Lowest pid breaks any remaining tie.
	const main = procs
		.filter((p) => p.args.startsWith(`${bundle}/Contents/MacOS/`) && !p.args.slice(bundle.length).includes(".app/"))
		.sort((a, b) => Number(b.ppid === 1) - Number(a.ppid === 1) || a.pid - b.pid)[0];
	return main?.pid ?? pid;
}

async function raiseMac(): Promise<string> {
	const procs = await processes();
	// Every process inside an app bundle is a candidate.
	const [found] = terminalPids(procs, new Set(procs.filter((p) => appBundle(p.args)).map((p) => p.pid)));
	if (found === undefined) throw new Error("no terminal app running a herdr client found");
	const pid = bundleMainPid(procs, found);
	await run("osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`]);
	return String(pid);
}

// Raises the terminal window; returns what was raised. Throws with a readable reason.
export function raiseTerminal(env: Record<string, string | undefined> = process.env): Promise<string> {
	if (process.platform === "darwin") return raiseMac();
	if (env.DISPLAY && env.XDG_SESSION_TYPE !== "wayland") return raiseX11();
	return Promise.reject(new Error("automatic raise needs X11; set a custom command for Wayland"));
}
