import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { differences } from "@shared/attendance/simulator/diff";
import { buildRoster } from "@shared/attendance/simulator/roster";
import { linesOf, planDays, planMonth } from "@shared/attendance/simulator/month";
import { deleteWithDependents } from "../../../../lib/__tests__/cleanup";
import { prisma } from "../../../../lib/prisma";
import { app, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, TEST_PASSWORD } from "../../../employee/__tests__/employeeTestHelpers";
import { buildSimulatorRoster, observedDay } from "../../../dev/simulatorService";
import { recomputeWorld } from "./replay";
import { createWorld, existingHolidays, manualEntriesOf } from "./world";

// The golden replay through each REAL ROUTE over real HTTP (docs/plans/PHASE_2.md
// "P2-G, commit G2 build design", item 5): the shipped `simulate` CLI sends the
// month, by the real agent (a child process reading a simulated device), by
// ADMS push posts, or by HR's file upload, to this process's real HTTP server.
// Then the month is recomputed and every day compared with its scenario, as in
// G1. The CLI runs as a separate process, so nothing here is faked.
//
// Only days whose punches reach the server as they happen can be sent over HTTP
// (the server stamps arrival with its own clock; moving it is not something
// production code may allow). The others stay covered by the G1 replay.

const SEED = 20260801;
const MONTH = "2026-08";
const FROM = "2026-08-01";
const TO = "2026-08-31";
const AGENT_DIR = path.resolve(import.meta.dirname, "../../../../../../biometric-agent");

function cli(args: string[], env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(path.join(AGENT_DIR, "node_modules/.bin/tsx"), ["src/simulator/cli.ts", ...args], { cwd: AGENT_DIR, env: { ...process.env, ...env } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("the month replay through each real route", () => {
  it.each(["push", "file", "agent"] as const)("%s: every day the route can deliver is stored exactly as its scenario says", async (route) => {
    const tag = `${route[0]}${Date.now().toString(36).slice(-4)}`;
    const roster = buildRoster({ seed: SEED, month: MONTH, employees: 40, existingHolidays: await existingHolidays(MONTH) });
    const world = await createWorld(roster, tag, manualEntriesOf(planMonth(roster)));
    const org = await createEmployeeTestOrgMasters();
    const hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    const home = mkdtempSync(path.join(os.tmpdir(), "sim-home-"));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // The punch-age window is an ordinary admin setting: a fixed past month must not be "too old".
    const policy = await prisma.attendancePolicy.findUniqueOrThrow({ where: { code: "DEFAULT" } });
    await prisma.attendancePolicy.update({ where: { id: policy.id }, data: { maxPunchAgeDays: 5000 } });
    const env = { SIM_API_URL: apiUrl, SIM_USER: hr.employeeCode, SIM_PASSWORD: TEST_PASSWORD, SIM_HOME: home };

    try {
      const setup = await cli(["setup"], env);
      expect(setup.output).toContain("Registered");
      // Only this world's people: the test database also holds the seed's employees.
      const wanted = roster.employees.map((e) => `${e.code}-${tag}`);
      const sent = await cli(["replay", "--route", route, "--from", FROM, "--to", TO, "--seed", String(SEED), "--employee", wanted.join(","), ...(route === "file" ? ["--commit"] : [])], env);
      expect(sent.code, sent.output).toBe(0);
      expect(sent.output).toContain(`punch(es) by the ${route} route`);

      // What the CLI planned: the same call, the same seed, so the same days.
      const server_roster = (await buildSimulatorRoster(FROM, TO, SEED, "development")).roster;
      server_roster.employees = server_roster.employees.filter((e) => wanted.includes(e.code));
      const planned = planDays(server_roster);
      expect(planned.problems.slice(0, 3)).toEqual([]);
      const sendable = planned.days.filter((d) => [...d.punches, ...d.outside, ...d.unmapped].every((p) => p.delivery === "live"));
      expect(new Set(sendable.map((d) => d.employee)).size).toBeGreaterThan(20);
      expect(new Set(sendable.map((d) => d.scenario)).size, "the replay should exercise many scenarios").toBeGreaterThan(14);

      // Every punch the plan has went in, once.
      const device = await prisma.device.findFirstOrThrow({ where: { serialNumber: `SIM-${route.toUpperCase()}-DEV` } });
      const lines = linesOf({ ...planned, days: sendable });
      expect(await prisma.rawPunch.count({ where: { deviceId: device.id } })).toBe(lines.length);

      await recomputeWorld(world);
      const rows = await prisma.dailyAttendance.findMany({ where: { employeeId: { in: world.employeeIds }, date: { gte: new Date(`${FROM}T00:00:00Z`), lte: new Date(`${TO}T00:00:00Z`) } } });
      const stored = new Map(rows.map((r) => [`${world.codeOf.get(r.employeeId)}-${tag}|${r.date.toISOString().slice(0, 10)}`, observedDay(r)]));
      const bad: string[] = [];
      for (const d of sendable) {
        const diff = differences(d.expected, (stored.get(`${d.employee}|${d.date}`) as Record<string, unknown> | undefined) ?? null);
        if (diff.length) bad.push(`${d.employee} ${d.date} ${d.scenario}: ${diff.map((x) => `${x.field} expected ${JSON.stringify(x.expected)} got ${JSON.stringify(x.actual)}`).join("; ")}`);
      }
      expect(bad.slice(0, 8).join("\n") || "no differences").toBe("no differences");
    } finally {
      await prisma.attendancePolicy.update({ where: { id: policy.id }, data: { maxPunchAgeDays: policy.maxPunchAgeDays } });
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(home, { recursive: true, force: true });
      // Torn down now, not at the end: the next route's world reuses the same device user IDs.
      const devices = await prisma.device.findMany({ where: { serialNumber: { startsWith: "SIM-" }, isSimulated: true }, select: { id: true, agentId: true } });
      const agentIds = [...new Set(devices.map((d) => d.agentId).filter((x): x is string => !!x))];
      await world.cleanup();
      await cleanupFullTestEmployee(hr.employeeId);
      await cleanupEmployeeTestOrgMasters(org);
      if (devices.length) await deleteWithDependents("Device", devices.map((d) => d.id));
      if (agentIds.length) await deleteWithDependents("BiometricAgent", agentIds);
    }
  }, 600_000);
});
