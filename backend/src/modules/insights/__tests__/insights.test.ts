import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import request from "supertest";
import pino from "pino";
import { logger } from "../../../lib/logger";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { appoint, removeMember } from "../../peeps/__tests__/peepsTestKit";
import { fixture, app, prisma } from "../../recruitment/__tests__/fixtures";
import { SETTING_SCHEMAS, type SettingKey } from "../service";

// Insights (stage 2). Fixture values are fictional and labelled DEMO.
type F = Awaited<ReturnType<typeof fixture>>;
type Who = keyof F["people"];
const SECRET = "DEMO-INSIGHTS-PRIVATE-REASON-TEXT"; // free text that must never reach Insights
const METRICS = ["turnover", "tenure", "exit-reasons", "hiring-funnel"] as const;

describe("DEMO Insights: audience, Not set refusal, suppression on real output, no individual data", () => {
  let f: F;
  const call = (who: Who, method: "get" | "put", path: string, body: object = {}) => request(app)[method]("/api/insights" + path).set("Authorization", `Bearer ${f.tokens[who]}`).send(body);
  const setInsights = async (key: SettingKey, value: unknown) => {
    const v = (await call("director", "get", "/settings")).body.settings.find((s: { key: string }) => s.key === key).version;
    const r = await call("director", "put", `/settings/${key}`, { value, version: v, reason: "DEMO choice" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  let separationId = "";

  beforeAll(async () => {
    f = await fixture();
    await appoint(f.people.office.employeeId, ["VIEW_INSIGHTS"], f.people.director, f.people.second);
    // A leaver with free-text reasons that Insights must never read or show.
    const s = await prisma.separation.create({ data: { employeeId: f.people.interviewer.employeeId, lastWorkingDate: new Date(Date.now() - 5 * 86400000), reason: SECRET, notes: SECRET, status: "INITIATED", initiatedByUserId: f.people.director.userId } });
    separationId = s.id;
  });
  afterAll(async () => {
    await deleteWithDependents("Separation", [separationId]);
    const ids = (await prisma.insightsSettingVersion.findMany({ where: { changedByUserId: { in: Object.values(f.people).map((p) => p.userId) } }, select: { id: true } })).map((r) => r.id);
    await deleteWithDependents("InsightsSettingVersion", ids);
    await removeMember(f.people.office.employeeId, f.people.director, f.people.second);
    await f.cleanup();
  });

  it("every Insights route: anonymous 401, Developer 403, and the enumeration matches the router", async () => {
    const routes: Array<[method: "get" | "put", path: string, body: object]> = [["get", "/status", {}], ["get", "/settings", {}], ["put", "/settings/window", { value: { months: 12 }, version: 0, reason: "DEMO" }], ["get", "/metrics/turnover", {}], ["get", "/metrics/turnover/export", {}]];
    const source = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    expect(routes.map(([m, p]) => `${m} ${p.replace("/settings/window", "/settings/:key").replace(/\/metrics\/turnover/, "/metrics/:metric")}`).sort()).toEqual([...source.matchAll(/insightsRouter\.(get|put)\("([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`).sort());
    for (const [m, p, b] of routes) {
      expect((await request(app)[m]("/api/insights" + p).send(b)).status, `${m} ${p} anonymous`).toBe(401);
      expect((await call("developer", m, p, b)).status, `${m} ${p} Developer`).toBe(403);
    }
  });

  it("matrix: director and Office member with VIEW_INSIGHTS may look; employee, manager, HR and a non-member may not; only a director sets", async () => {
    for (const who of ["employee", "manager", "hr", "interviewer"] as Who[]) {
      expect((await call(who, "get", "/status")).body).toEqual({ allowed: false, isDirector: false, missing: {} });
      expect((await call(who, "get", "/settings")).status, who).toBe(403);
      for (const m of METRICS) { expect((await call(who, "get", `/metrics/${m}`)).status, `${who} ${m}`).toBe(403); expect((await call(who, "get", `/metrics/${m}/export`)).status).toBe(403); }
    }
    for (const who of ["director", "office"] as Who[]) expect((await call(who, "get", "/settings")).status, who).toBe(200);
    for (const who of ["office", "hr", "employee"] as Who[]) expect((await call(who, "put", "/settings/window", { value: { months: 12 }, version: 0, reason: "DEMO" })).status, who).toBe(403);
    await expect(prisma.insightsSettingVersion.create({ data: { key: "window", version: 99, value: { months: 1 }, reason: "DEMO", changedByUserId: f.people.office.userId } })).rejects.toThrow(/INSIGHTS_DIRECTOR_ONLY/);
  });

  it("while Not set, every metric refuses and names the missing settings", async () => {
    const status = (await call("director", "get", "/status")).body;
    expect(status.allowed).toBe(true);
    for (const m of METRICS) {
      const r = await call("office", "get", `/metrics/${m}`);
      expect([r.status, r.body.error.code]).toEqual([409, "INSIGHTS_NOT_SET"]);
      for (const k of status.missing[m]) expect(r.body.error.message).toContain(k);
      expect((await call("director", "get", `/metrics/${m}/export`)).status).toBe(409);
    }
    expect(Object.keys(SETTING_SCHEMAS).sort()).toEqual(["earlyAttrition", "exitReasons", "hiringFunnel", "minimumGroupSize", "tenure", "turnover", "window"]);
  });

  it("once chosen: no published figure is a small group and subtraction never recovers fewer than k; views and exports are audited", async () => {
    await setInsights("window", { months: 24 });
    await setInsights("earlyAttrition", { months: 6 });
    await setInsights("turnover", { denominator: "AVERAGE_HEADCOUNT" });
    await setInsights("tenure", { basis: "ACTIVE_AT_END" });
    await setInsights("exitReasons", { source: "SEPARATION_MODE" });
    await setInsights("hiringFunnel", { basis: "FURTHEST_STAGE" });
    for (const k of [3, 5, 1000]) {
      await setInsights("minimumGroupSize", { n: k });
      for (const m of METRICS) {
        const r = await call("office", "get", `/metrics/${m}`);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const t = r.body.table as { cells: Array<{ suppressed: boolean; n: number | null }>; total: { suppressed: boolean; n: number | null } };
        for (const c of t.cells) if (!c.suppressed) expect(c.n === 0 || c.n! >= k, `${m} k=${k} visible cell ${c.n}`).toBe(true);
        if (!t.total.suppressed) { const hidden = t.total.n! - t.cells.filter((c) => !c.suppressed).reduce((s, c) => s + c.n!, 0); expect(hidden === 0 || hidden >= k, `${m} k=${k} hidden ${hidden}`).toBe(true); expect(t.total.n === 0 || t.total.n! >= k).toBe(true); }
        if (k === 1000) expect(t.total.suppressed || t.total.n === 0, `${m}: a table smaller than k shows no total`).toBe(true);
      }
    }
    expect(await prisma.auditLog.count({ where: { action: "insights.viewed", actorUserId: f.people.office.userId } })).toBeGreaterThanOrEqual(12);
    const csv = await call("director", "get", "/metrics/turnover/export");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(await prisma.auditLog.count({ where: { action: "insights.exported", actorUserId: f.people.director.userId } })).toBe(1);
  });

  it("no exit-interview text, free-text reason, person name or pay appears in any response, export or log line", async () => {
    await setInsights("minimumGroupSize", { n: 2 });
    const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
    const lines: string[] = [];
    const original = stream.write.bind(stream);
    stream.write = (line: string) => { lines.push(String(line)); return original(line); };
    const bodies: string[] = [];
    try {
      for (const m of METRICS) for (const who of ["director", "office"] as Who[]) { bodies.push(JSON.stringify((await call(who, "get", `/metrics/${m}`)).body)); bodies.push((await call(who, "get", `/metrics/${m}/export`)).text); }
    } finally { stream.write = original; }
    const names = await prisma.employeeNameHistory.findMany({ where: { employeeId: { in: Object.values(f.people).map((p) => p.employeeId) } }, select: { fullName: true } });
    for (const text of [...bodies, ...lines]) {
      expect(text).not.toContain(SECRET);
      for (const n of names) expect(text.includes(n.fullName)).toBe(false);
      expect(text).not.toMatch(/salary|ctc|employeeId|"answers"|interview/i);
    }
    // The module never reads exit interviews or pay at all.
    const src = readFileSync(new URL("../service.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/exitInterview|employeeSalary|payroll|offerCompensation|expectedPay/);
  });
});
