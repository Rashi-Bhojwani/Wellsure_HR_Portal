import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planDays, planMonth } from "@shared/attendance/simulator/month";
import { buildRoster } from "@shared/attendance/simulator/roster";
import { FileRoute, PushRoute } from "../routes";
import { assertDaysUntouched, punchLinesOf, sendablePlan } from "../run";
import { assertDevelopmentServer, RefusedError, ServerApi } from "../serverApi";

// The simulator's safety and its routes' wire shapes (docs/plans/PHASE_2.md
// "P2-G, commit G2 build design"): it must refuse anything that looks like
// production before sending a byte, and each route must say what the real
// server expects. The routes against the real server are exercised by the
// backend's route replays; here a stub records what was sent.

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function stub(handler: (req: Seen, res: http.ServerResponse) => void): Promise<{ api: ServerApi; seen: Seen[]; close(): Promise<void> }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const s = { method: req.method!, url: req.url!, headers: req.headers, body };
      seen.push(s);
      handler(s, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const api = new ServerApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  return { api, seen, close: () => new Promise((r) => server.close(() => r())) };
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

let open: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of open) await c();
  open = [];
});

describe("the simulator refuses to run against anything that looks like production", () => {
  it("refuses a server that is not this machine before it says anything to it", async () => {
    const api = new ServerApi("https://hr.example.com");
    await expect(assertDevelopmentServer(api, { allowRemote: false, probeFrom: "2026-10-01", probeTo: "2026-10-01" })).rejects.toThrow(/not this machine/);
  });

  it("refuses a server without the simulator endpoints: that is what a production build looks like", async () => {
    const s = await stub((_req, res) => json(res, 404, { error: { code: "NOT_FOUND" } }));
    open.push(s.close);
    await expect(assertDevelopmentServer(s.api, { allowRemote: false, probeFrom: "2026-10-01", probeTo: "2026-10-01" })).rejects.toThrow(/no simulator endpoints/);
    expect(s.seen.map((x) => x.url)).toEqual(["/api/dev/simulator/roster?from=2026-10-01&to=2026-10-01&seed=1"]);
  });

  it("refuses a server that says it is production, even though it answered", async () => {
    const s = await stub((_req, res) => json(res, 200, { appEnv: "production", roster: {}, skipped: [] }));
    open.push(s.close);
    await expect(assertDevelopmentServer(s.api, { allowRemote: true, probeFrom: "2026-10-01", probeTo: "2026-10-01" })).rejects.toBeInstanceOf(RefusedError);
  });

  it("goes ahead for a development server", async () => {
    const s = await stub((_req, res) => json(res, 200, { appEnv: "development", roster: { employees: [] }, skipped: [] }));
    open.push(s.close);
    await expect(assertDevelopmentServer(s.api, { allowRemote: false, probeFrom: "2026-10-01", probeTo: "2026-10-01" })).resolves.toMatchObject({ appEnv: "development" });
  });

  it("refuses to add punches to employee-days that already have some, because it cannot take them away", async () => {
    const roster = buildRoster({ seed: 3, month: "2026-08", employees: 6 });
    const plan = planMonth(roster);
    const first = plan.days[0]!;
    const s = await stub((_req, res) => json(res, 200, { days: { [`${first.employee}|${first.date}`]: { punchCount: 2 } } }));
    open.push(s.close);
    await expect(assertDaysUntouched(s.api, plan)).rejects.toThrow(/already have punches/);
  });
});

describe("the routes say what the server expects", () => {
  const lines = [
    { deviceUserId: "7", localTime: "2026-08-03 09:58:01", line: "7\t2026-08-03 09:58:01\t1\t255\t1\t0" },
    { deviceUserId: "8", localTime: "2026-08-03 10:01:00", line: "8\t2026-08-03 10:01:00\t1\t255\t1\t0" },
  ];

  it("push: one handshake, then the lines as an ATTLOG upload keyed by serial, with no user sign-in", async () => {
    const s = await stub((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });
    open.push(s.close);
    s.api.token = "should-not-be-sent";
    const route = new PushRoute(s.api, "SIM PUSH 1", 1);
    await route.send(lines);
    await route.send([lines[0]!]);
    expect(s.seen.map((x) => `${x.method} ${x.url.split("&")[0]}`)).toEqual(["GET /iclock/cdata?SN=SIM%20PUSH%201", "POST /iclock/cdata?SN=SIM%20PUSH%201", "POST /iclock/cdata?SN=SIM%20PUSH%201", "POST /iclock/cdata?SN=SIM%20PUSH%201"]);
    expect(s.seen[1]!.url).toContain("table=ATTLOG");
    expect(s.seen[1]!.body).toBe(lines[0]!.line);
    expect(s.seen.every((x) => !x.headers.authorization)).toBe(true);
  });

  it("file: writes the ATTLOG file, and with a device uploads it the way Import Center does (preview, then commit with a reason)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sim-file-"));
    open.push(async () => rmSync(dir, { recursive: true, force: true }));
    const s = await stub((req, res) => (req.url!.endsWith("/preview") ? json(res, 200, { batchId: "b1" }) : json(res, 200, { ok: true })));
    open.push(s.close);
    s.api.token = "t";
    await new FileRoute({ api: s.api, deviceId: "dev1", writeTo: path.join(dir, "nested", "attlog.txt") }).send(lines);
    expect(readFileSync(path.join(dir, "nested", "attlog.txt"), "utf8")).toBe(`${lines[0]!.line}\n${lines[1]!.line}\n`);
    expect(s.seen.map((x) => `${x.method} ${x.url}`)).toEqual(["POST /api/biometric/import/preview", "POST /api/biometric/import/b1/commit"]);
    expect(s.seen[0]!.body).toContain('name="deviceId"');
    expect(s.seen[0]!.body).toContain(lines[1]!.line);
    expect(JSON.parse(s.seen[1]!.body).reason).toMatch(/simulator/i);
    expect(s.seen[1]!.headers.authorization).toBe("Bearer t");
  });
});

describe("planning for the CLI", () => {
  const roster = buildRoster({ seed: 11, month: "2026-08", employees: 60 });

  it("a named scenario applies to every working day of the people asked for, and the calendar still decides first", () => {
    const people = roster.employees.filter((e) => e.archetype === "day-std" && e.leaves.length === 0).slice(0, 3).map((e) => e.code);
    const plan = planDays(roster, { scenario: "late-arrival", employees: people, dates: ["2026-08-04", "2026-08-09", "2026-08-15"] });
    expect(plan.problems).toEqual([]);
    expect(plan.days).toHaveLength(9);
    const byDate = (d: string) => new Set(plan.days.filter((x) => x.date === d).map((x) => x.scenario));
    expect(byDate("2026-08-04")).toEqual(new Set(["late-arrival"])); // a Tuesday
    expect(byDate("2026-08-09")).toEqual(new Set(["off-day-quiet", "weekoff-work"].filter((s) => byDate("2026-08-09").has(s)))); // a Sunday: a week-off, whatever was asked
    expect(byDate("2026-08-15").has("late-arrival")).toBe(false); // Independence Day is a holiday in the seed calendar
  });

  it("leaves out the days whose punches arrive late, and says how many", () => {
    const plan = planMonth(roster);
    const { plan: sendable, leftOut } = sendablePlan(plan);
    expect(leftOut).toBeGreaterThan(0);
    expect(sendable.days.length + leftOut).toBe(plan.days.length);
    expect(sendable.days.every((d) => [...d.punches, ...d.outside, ...d.unmapped].every((p) => p.delivery === "live"))).toBe(true);
    const lines = punchLinesOf(sendable);
    expect(lines.length).toBeGreaterThan(300);
    expect([...lines].sort((a, b) => a.localTime.localeCompare(b.localTime))).toEqual(lines.map((l) => l)); // in the order a device records them
    expect(lines[0]!.line).toMatch(/^\d+\t2026-08-\d\d \d\d:\d\d:\d\d\t1\t255\t1\t0$/);
  });
});
