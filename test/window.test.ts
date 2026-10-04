import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHerdrClient, parsePs, parseWmctrl, terminalPids } from "../src/window.ts";

describe("raise terminal", () => {
	it("recognises the interactive herdr client only", () => {
		assert.ok(isHerdrClient("herdr"));
		assert.ok(isHerdrClient("/home/u/.local/bin/herdr --session work"));
		assert.ok(!isHerdrClient("/home/u/.local/bin/herdr server"));
		assert.ok(!isHerdrClient("herdr agent list"));
		assert.ok(!isHerdrClient("herdr-deck"));
	});
	it("walks from the herdr client up to the process that owns a window", () => {
		const procs = parsePs(
			[
				"    1     0 /sbin/init",
				" 3616     1 gnome-shell",
				"  500  3616 /usr/bin/ghostty --gtk-single-instance=true",
				"  510   500 /bin/bash --posix",
				"  520   510 herdr",
				"  600     1 /home/u/.local/bin/herdr server",
				"  610   600 bash",
			].join("\n"),
		);
		assert.deepEqual(terminalPids(procs, new Set([3616, 500, 700])), [500]);
		assert.deepEqual(terminalPids(procs, new Set([700])), []);
	});
	it("parses wmctrl -lp", () => {
		const out = "0x02600004  0 4444   host Code\n0x04a00004 -1 262684 host herdr\n";
		assert.deepEqual(parseWmctrl(out), [
			{ id: "0x02600004", pid: 4444 },
			{ id: "0x04a00004", pid: 262684 },
		]);
	});
});
