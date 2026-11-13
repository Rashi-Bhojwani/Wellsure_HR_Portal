import request from "supertest";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { appoint, clearPeepsSettings, setSetting } from "../../peeps/__tests__/peepsTestKit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// Peeps Stage 3: an employee asks for an asset type; HR and the directors (who run the register) see and decide it; the employee sees only their own
// requests and their status; nobody else sees any request. Permission matrix over every route, the state machine, idempotency, cancel, the task, and
// no request note in a notification, a task preview, the audit log or the logs.

type Who = "director" | "director2" | "emp" | "empManager" | "otherManager" | "other" | "hr" | "hrExec" | "member" | "nonMember" | "developer" | "former";
let seq = 0;
const key = () => `asset-req-${Date.now()}-${(seq += 1)}`;
const NOTE = `DEMO-ASSET-NOTE-${Date.now()}`;

describe("asset requests", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<Who, string>;
  const get = (who: Who, url: string) => request(app).get(url).set(...authHeader(tok[who]));
  const post = (who: Who, url: string, body: object = {}) => request(app).post(url).set(...authHeader(tok[who])).send(body);
  const ask = (who: Who, extra: object = {}) => post(who, "/api/assets/requests", { categoryCode: "DEMO_LAPTOP", idempotencyKey: key(), ...extra });
  const versionIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.empManager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.emp = await createFullTestEmployee(org, { managerId: p.empManager.employeeId });
    p.otherManager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.other = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.member = await createFullTestEmployee(org);
    p.nonMember = await createFullTestEmployee(org);
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    p.former = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
    await prisma.user.update({ where: { id: p.former.userId }, data: { status: "DEACTIVATED" } });
    await appoint(p.member.employeeId, ["MANAGE_ASSETS"], p.director, p.director2);
  });

  afterAll(async () => {
    const ids = Object.values(p).map((x) => x.employeeId);
    const reqIds = (await prisma.assetRequest.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...reqIds, ...versionIds] } });
    await deleteWithDependents("AssetRequest", reqIds);
    const versions = await prisma.assetSettingVersion.findMany({ select: { id: true } });
    await purgeAppendOnly("AuditLog", { entityId: { in: versions.map((v) => v.id) } });
    await deleteWithDependents("AssetSettingVersion", versions.map((v) => v.id));
    await clearPeepsSettings();
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("refuses while the asset categories are Not set, and says so", async () => {
    expect((await get("emp", "/api/assets/requests/options")).body).toMatchObject({ ready: false, categories: [] });
    const res = await ask("emp");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_SET_UP");
    expect((await post("director", "/api/assets/settings/CATEGORIES", { items: [{ code: "DEMO_LAPTOP", label: "DEMO Laptop" }, { code: "DEMO_PHONE", label: "DEMO Phone" }] })).status).toBe(201);
    expect((await post("director2", "/api/assets/settings/CATEGORIES/confirm", { version: 1 })).status).toBe(200);
    expect((await get("emp", "/api/assets/requests/options")).body.ready).toBe(true);
  });

  it("an employee asks (idempotent on their key) and sees only their own requests", async () => {
    const k = key();
    const [x, y] = await Promise.all([ask("emp", { idempotencyKey: k, note: NOTE }), ask("emp", { idempotencyKey: k, note: NOTE })]);
    expect([x.status, y.status].sort()).toEqual([200, 201]);
    expect(x.body.id).toBe(y.body.id);
    expect(x.body).toMatchObject({ category: "DEMO Laptop", status: "SUBMITTED" });
    expect((await ask("other", { categoryCode: "DEMO_PHONE" })).status).toBe(201);
    expect((await ask("emp", { categoryCode: "NOT_A_TYPE" })).status).toBe(400);
    const mine = (await get("emp", "/api/assets/requests/mine")).body as Array<{ id: string }>;
    expect(mine.map((r) => r.id)).toContain(x.body.id);
    const othersMine = (await get("other", "/api/assets/requests/mine")).body as Array<{ id: string }>;
    expect(othersMine.map((r) => r.id)).not.toContain(x.body.id);
  });

  it("permission matrix: the list and decisions are for the register's managers only", async () => {
    const id = (await ask("emp")).body.id as string;
    const expectList: Record<Who, number> = { director: 200, director2: 200, hr: 200, hrExec: 200, emp: 403, empManager: 403, otherManager: 403, other: 403, member: 403, nonMember: 403, developer: 403, former: 401 };
    for (const who of Object.keys(expectList) as Who[]) expect((await get(who, "/api/assets/requests")).status, who).toBe(expectList[who]);
    expect((await request(app).get("/api/assets/requests")).status).toBe(401);
    for (const who of ["emp", "empManager", "otherManager", "other", "member", "nonMember", "developer"] as const) expect((await post(who, `/api/assets/requests/${id}/decide`, { outcome: "APPROVED" })).status, who).toBe(403);
    expect((await post("former", `/api/assets/requests/${id}/decide`, { outcome: "APPROVED" })).status).toBe(401);
    for (const who of ["empManager", "other", "hr", "director"] as const) expect((await post(who, `/api/assets/requests/${id}/cancel`)).status, who).toBe(404); // not theirs
    for (const url of ["/api/assets/requests/mine", "/api/assets/requests/options"]) {
      expect((await request(app).get(url)).status, url).toBe(401);
      expect((await get("former", url)).status, url).toBe(401);
    }
    // Opening the register to the Office lets a member with "Manage the asset register" in too.
    await setSetting("audience.assets", { officeManages: true }, p.director, p.director2);
    expect((await get("member", "/api/assets/requests")).status).toBe(200);
    expect((await get("nonMember", "/api/assets/requests")).status).toBe(403);
    await setSetting("audience.assets", { officeManages: false }, p.director, p.director2);
    expect((await get("member", "/api/assets/requests")).status).toBe(403);
  });

  it("states: approve then fulfil, or decline; a decided request cannot change back; the employee cancels only while waiting; never your own", async () => {
    const a = (await ask("emp")).body.id as string;
    expect((await post("hr", `/api/assets/requests/${a}/decide`, { outcome: "APPROVED", note: "DEMO ordering one" })).body.status).toBe("APPROVED");
    expect((await post("emp", `/api/assets/requests/${a}/cancel`)).status).toBe(409);
    expect((await post("hr", `/api/assets/requests/${a}/decide`, { outcome: "DECLINED" })).status).toBe(409);
    expect((await post("hrExec", `/api/assets/requests/${a}/decide`, { outcome: "FULFILLED" })).body.status).toBe("FULFILLED");
    const b = (await ask("emp")).body.id as string;
    expect((await post("director", `/api/assets/requests/${b}/decide`, { outcome: "DECLINED" })).body.status).toBe("DECLINED");
    expect((await post("director", `/api/assets/requests/${b}/decide`, { outcome: "APPROVED" })).status).toBe(409);
    const c = (await ask("emp")).body.id as string;
    expect((await post("emp", `/api/assets/requests/${c}/cancel`)).body.status).toBe("CANCELLED");
    expect((await post("hr", `/api/assets/requests/${c}/decide`, { outcome: "APPROVED" })).status).toBe(409);
    const own = (await ask("hr")).body.id as string;
    expect((await post("hr", `/api/assets/requests/${own}/decide`, { outcome: "APPROVED" })).status).toBe(403);
    await expect(prisma.assetRequestEvent.create({ data: { requestId: own, kind: "CANCELLED", byUserId: p.director.userId } })).rejects.toThrow(/PEEPS_ASSET_REQUEST_CANCEL/);
    await expect(prisma.assetRequest.deleteMany({ where: { id: own } })).rejects.toThrow(/PEEPS_APPEND_ONLY/);
    const mine = (await get("emp", "/api/assets/requests/mine")).body as Array<{ id: string; status: string; decisionNote: string | null }>;
    expect(mine.find((r) => r.id === a)).toMatchObject({ status: "FULFILLED" });
  });

  it("a task for HR and the directors (never the requester's own; not for managers or employees); the note stays out of tasks, notifications, audit rows and logs", async () => {
    const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
    const lines: string[] = [];
    const original = stream.write.bind(stream);
    stream.write = (line: string) => {
      lines.push(String(line));
      return original(line);
    };
    const events: Array<{ room: string; event: string; args: unknown[] }> = [];
    const fake: RoomEmitter = { to: (room) => ({ emit: (event: string, ...args: unknown[]) => events.push({ room: String(room), event, args }) }) };
    setSocketServer(fake);
    let id = "";
    try {
      id = (await ask("other", { note: NOTE })).body.id;
      const tasks = async (who: Who) => ((await get(who, "/api/tasks/mine")).body as Array<{ type: string; id: string; detail: string | null; title: string }>).filter((t) => t.type === "ASSET_REQUEST");
      for (const who of ["hr", "hrExec", "director"] as const) expect((await tasks(who)).some((t) => t.id === id), who).toBe(true);
      for (const who of ["other", "emp", "empManager", "otherManager", "member", "developer"] as const) expect((await tasks(who)).some((t) => t.id === id), who).toBe(false);
      expect(JSON.stringify(await tasks("hr"))).not.toContain(NOTE);
      await post("hr", `/api/assets/requests/${id}/decide`, { outcome: "DECLINED", note: "DEMO none in stock" });
      logger.info({ probe: "asset-request-log" }, "probe");
    } finally {
      stream.write = original;
      setSocketServer(null);
    }
    expect(events.map((e) => [e.room, e.event])).toEqual([[`user:${p.other.employeeId}`, "notification.new"]]);
    expect(JSON.stringify(events)).not.toContain(NOTE);
    expect(JSON.stringify(events)).not.toContain("none in stock");
    expect(lines.join("\n")).toContain("asset-request-log");
    expect(lines.join("\n")).not.toContain(NOTE);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: id } }))).not.toContain(NOTE);
  });
});
