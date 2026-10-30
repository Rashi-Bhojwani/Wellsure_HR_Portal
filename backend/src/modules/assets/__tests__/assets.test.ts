import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// The asset register (Peeps module 1). One describe, sequential, sharing fixtures: the setting lists are global (one register per company), so the
// file enters and confirms them once, through the API, and removes them at the end.

type Who = "director" | "director2" | "hrAdmin" | "hrExec" | "manager" | "employee" | "other" | "developer" | "teamViewer" | "teamMember" | "outsider";
type Person = { employeeId: string; employeeCode: string; userId: string };

const CATEGORIES = [{ code: "DEMO_LAPTOP", label: "DEMO Laptop" }, { code: "DEMO_PHONE", label: "DEMO Phone" }];
const STATUSES = [{ code: "DEMO_STOCK", label: "DEMO In stock", issuable: true }, { code: "DEMO_REPAIR", label: "DEMO Under repair", issuable: false }, { code: "DEMO_GONE", label: "DEMO Written off", issuable: false }];
const CONDITIONS = [{ code: "DEMO_GOOD", label: "DEMO Good" }, { code: "DEMO_WORN", label: "DEMO Worn" }, { code: "DEMO_BROKEN", label: "DEMO Broken" }];
const TEAM_ROLE = "TEST_ASSETS_TEAM_VIEWER";

describe("asset register", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  const assetIds: string[] = [];
  const get = (who: Who, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const post = (who: Who, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body);
  const patch = (who: Who, path: string, body: object = {}) => request(app).patch(path).set(...authHeader(tok[who])).send(body);

  async function newAsset(name = "DEMO asset", status = "DEMO_STOCK"): Promise<string> {
    const res = await post("hrExec", "/api/assets", { name, categoryCode: "DEMO_LAPTOP", statusCode: status, serialNumber: "DEMO-SN-0001" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    assetIds.push(res.body.id);
    return res.body.id as string;
  }
  const openRows = (assetId: string) => prisma.assetAssignment.count({ where: { assetId, endedAt: null } });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.employee = await createFullTestEmployee(org);
    p.other = await createFullTestEmployee(org);
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    // A viewer whose data scope is TEAM (a custom role an owner could make), managing one team member; the outsider is not in the team.
    await grantPermissions(TEAM_ROLE, ["assets.view", "assets.manage"]);
    await prisma.role.update({ where: { code: TEAM_ROLE }, data: { dataScope: "TEAM" } });
    p.teamViewer = await createFullTestEmployee(org, { roleCode: TEAM_ROLE });
    p.teamMember = await createFullTestEmployee(org, { managerId: p.teamViewer.employeeId });
    p.outsider = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
  });

  afterAll(async () => {
    await purgeAppendOnly("AuditLog", { entityId: { in: assetIds } });
    await deleteWithDependents("Asset", assetIds);
    const versions = await prisma.assetSettingVersion.findMany({ select: { id: true } });
    await purgeAppendOnly("AuditLog", { entityId: { in: versions.map((v) => v.id) } });
    await deleteWithDependents("AssetSettingVersion", versions.map((v) => v.id));
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupTestRole(TEAM_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("settings: Not set until entered and confirmed by a different director", () => {
    it("with no settings the register is empty, says what is missing, and refuses to take an asset", async () => {
      const list = await get("hrExec", "/api/assets");
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ total: 0, ready: false, missing: ["CATEGORIES", "STATUSES", "CONDITIONS"] });
      const create = await post("hrExec", "/api/assets", { name: "x", categoryCode: "DEMO_LAPTOP", statusCode: "DEMO_STOCK" });
      expect(create.status).toBe(409);
      expect(create.body.code ?? create.body.error?.code).toBe("ASSETS_NOT_SET_UP");
    });

    it("HR Admin enters a list; HR Executive cannot; the list is not used until confirmed", async () => {
      expect((await post("hrExec", "/api/assets/settings/CATEGORIES", { items: CATEGORIES })).status).toBe(403);
      const entered = await post("hrAdmin", "/api/assets/settings/CATEGORIES", { items: CATEGORIES, note: "DEMO" });
      expect(entered.status).toBe(201);
      expect(entered.body).toMatchObject({ kind: "CATEGORIES", inForce: null, pending: { version: 1 } });
      expect((await get("hrAdmin", "/api/assets/settings")).body.ready).toBe(false);
    });

    it("HR Admin cannot confirm (not a director); the entering director cannot confirm their own list; another director can", async () => {
      expect((await post("hrAdmin", "/api/assets/settings/CATEGORIES/confirm", { version: 1 })).status).toBe(403);
      const byDirector = await post("director", "/api/assets/settings/STATUSES", { items: STATUSES });
      expect(byDirector.status).toBe(201);
      const self = await post("director", "/api/assets/settings/STATUSES/confirm", { version: 1 });
      expect(self.status).toBe(403);
      expect((await post("director2", "/api/assets/settings/STATUSES/confirm", { version: 1 })).status).toBe(200);
      expect((await post("director", "/api/assets/settings/CATEGORIES/confirm", { version: 1 })).status).toBe(200);
      expect((await post("director", "/api/assets/settings/CATEGORIES/confirm", { version: 1 })).status).toBe(409); // already confirmed
    });

    it("the database refuses a confirmation by the enterer or by a non-director, whatever the code does", async () => {
      const v = await prisma.assetSettingVersion.create({ data: { kind: "CONDITIONS", version: 99, value: CONDITIONS, enteredByUserId: p.director.userId } });
      await expect(prisma.assetSettingConfirmation.create({ data: { versionId: v.id, confirmedByUserId: p.director.userId } })).rejects.toThrow(/ASSET_SETTING_SAME_PERSON/);
      await expect(prisma.assetSettingConfirmation.create({ data: { versionId: v.id, confirmedByUserId: p.hrAdmin.userId } })).rejects.toThrow(/ASSET_SETTING_DIRECTORS_ONLY/);
      await expect(prisma.assetSettingVersion.update({ where: { id: v.id }, data: { note: "changed" } })).rejects.toThrow(/ASSETS_APPEND_ONLY/);
      await deleteWithDependents("AssetSettingVersion", [v.id]);
    });

    it("a status list with nothing issuable, or a duplicate code, is refused", async () => {
      expect((await post("hrAdmin", "/api/assets/settings/STATUSES", { items: [{ code: "DEMO_X", label: "DEMO X", issuable: false }] })).status).toBe(400);
      expect((await post("hrAdmin", "/api/assets/settings/CONDITIONS", { items: [CONDITIONS[0], CONDITIONS[0]] })).status).toBe(400);
    });

    it("with all three confirmed the register is ready", async () => {
      expect((await post("hrAdmin", "/api/assets/settings/CONDITIONS", { items: CONDITIONS })).status).toBe(201);
      expect((await post("director2", "/api/assets/settings/CONDITIONS/confirm", { version: 1 })).status).toBe(200);
      expect((await get("hrAdmin", "/api/assets/settings")).body).toMatchObject({ ready: true, missing: [] });
    });

    it("a new version cannot drop a code an asset still uses", async () => {
      await newAsset("DEMO phone in use");
      const res = await post("hrAdmin", "/api/assets/settings/CATEGORIES", { items: [CATEGORIES[1]] });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain("DEMO_LAPTOP");
    });
  });

  describe("permission matrix (every route; Developer refused everywhere but their own list)", () => {
    const routes = (assetId: string): Array<[string, () => (who: Who) => request.Test]> => [
      ["GET /api/assets", () => (w) => get(w, "/api/assets")],
      ["GET /api/assets/:id", () => (w) => get(w, `/api/assets/${assetId}`)],
      ["GET /api/assets/employees/:employeeId", () => (w) => get(w, `/api/assets/employees/${p.employee.employeeId}`)],
      ["GET /api/assets/holders", () => (w) => get(w, "/api/assets/holders?q=TEST")],
      ["POST /api/assets", () => (w) => post(w, "/api/assets", {})], // 400 on input once let in
      ["PATCH /api/assets/:id", () => (w) => patch(w, `/api/assets/${assetId}`, {})],
      ["POST /api/assets/:id/issue", () => (w) => post(w, `/api/assets/${assetId}/issue`, {})],
      ["POST /api/assets/:id/return", () => (w) => post(w, `/api/assets/${assetId}/return`, {})],
      ["POST /api/assets/:id/transfer", () => (w) => post(w, `/api/assets/${assetId}/transfer`, {})],
      ["POST /api/assets/:id/lost", () => (w) => post(w, `/api/assets/${assetId}/lost`, {})],
      ["POST /api/assets/:id/damaged", () => (w) => post(w, `/api/assets/${assetId}/damaged`, {})],
      ["GET /api/assets/settings", () => (w) => get(w, "/api/assets/settings")],
      ["POST /api/assets/settings/:kind", () => (w) => post(w, "/api/assets/settings/CATEGORIES", {})],
      ["POST /api/assets/settings/:kind/confirm", () => (w) => post(w, "/api/assets/settings/CATEGORIES/confirm", {})],
    ];
    const settingsRoute = (id: string) => id.includes("/settings");

    it("employee, manager and Developer get 403 on every register and settings route", async () => {
      const assetId = await newAsset();
      for (const [id, door] of routes(assetId)) for (const who of ["employee", "manager", "developer"] as const) expect((await door()(who)).status, `${who} ${id}`).toBe(403);
    });

    it("HR Executive reads and manages the register but not the settings; HR Admin also the settings; directors everything", async () => {
      const assetId = await newAsset();
      for (const [id, door] of routes(assetId)) {
        const hrExec = (await door()("hrExec")).status;
        if (settingsRoute(id)) expect(hrExec, `hrExec ${id}`).toBe(403);
        else expect(hrExec, `hrExec ${id}`).not.toBe(403);
        for (const who of ["hrAdmin", "director"] as const) expect((await door()(who)).status, `${who} ${id}`).not.toBe(403);
      }
    });

    it("unauthenticated requests are refused", async () => {
      expect((await request(app).get("/api/assets")).status).toBe(401);
      expect((await request(app).get("/api/assets/mine")).status).toBe(401);
    });
  });

  describe("issue, acknowledge, return, transfer, lost, damaged", () => {
    it("issues to an employee, who sees it in their own list and acknowledges it once", async () => {
      const assetId = await newAsset("DEMO laptop for employee");
      const issued = await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_GOOD", note: "DEMO" });
      expect(issued.status, JSON.stringify(issued.body)).toBe(200);
      expect(issued.body.holder).toMatchObject({ employeeId: p.employee.employeeId });
      const mine = await get("employee", "/api/assets/mine");
      const row = mine.body.current.find((a: { name: string }) => a.name === "DEMO laptop for employee");
      expect(row).toMatchObject({ acknowledgedAt: null, category: "DEMO Laptop", issueCondition: "DEMO Good" });
      expect((await post("employee", `/api/assets/mine/${row.assignmentId}/acknowledge`)).status).toBe(200);
      const again = await post("employee", `/api/assets/mine/${row.assignmentId}/acknowledge`);
      expect(again.status).toBe(200);
      expect(await prisma.assetEvent.count({ where: { assetId, kind: "ACKNOWLEDGED" } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: p.employee.userId, type: "assets.issued" } })).toBeGreaterThanOrEqual(1);
    });

    it("an employee cannot read or acknowledge someone else's asset", async () => {
      const assetId = await newAsset();
      await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.other.employeeId, conditionCode: "DEMO_GOOD" });
      const assignment = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId, endedAt: null } });
      expect((await get("employee", `/api/assets/${assetId}`)).status).toBe(403);
      expect((await get("employee", `/api/assets/employees/${p.other.employeeId}`)).status).toBe(403);
      expect((await post("employee", `/api/assets/mine/${assignment.id}/acknowledge`)).status).toBe(404);
      const mine = await get("employee", "/api/assets/mine");
      expect([...mine.body.current, ...mine.body.past].some((a: { assignmentId: string }) => a.assignmentId === assignment.id)).toBe(false);
      expect((await get("developer", "/api/assets/mine")).body).toEqual({ current: [], past: [] });
    });

    it("cannot issue an asset whose status is not issuable, nor with a condition that is not in the confirmed list", async () => {
      const assetId = await newAsset("DEMO in repair", "DEMO_REPAIR");
      expect((await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_GOOD" })).status).toBe(409);
      expect((await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "NOT_A_CODE" })).status).toBe(400);
    });

    it("return is idempotent: a second return of the same assignment changes nothing", async () => {
      const assetId = await newAsset();
      await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_GOOD" });
      const { id: assignmentId } = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId, endedAt: null } });
      const first = await post("hrExec", `/api/assets/${assetId}/return`, { assignmentId, conditionCode: "DEMO_WORN" });
      expect(first.status).toBe(200);
      expect(first.body.alreadyReturned).toBe(false);
      const auditsAfterFirst = await prisma.auditLog.count({ where: { entityId: assetId } });
      const [second, third] = await Promise.all([
        post("hrExec", `/api/assets/${assetId}/return`, { assignmentId, conditionCode: "DEMO_WORN" }),
        post("hrAdmin", `/api/assets/${assetId}/return`, { assignmentId, conditionCode: "DEMO_BROKEN" }),
      ]);
      expect([second.status, third.status]).toEqual([200, 200]);
      expect(second.body.alreadyReturned && third.body.alreadyReturned).toBe(true);
      expect(await prisma.assetEvent.count({ where: { assetId, kind: "RETURNED" } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: assetId } })).toBe(auditsAfterFirst);
      const row = await prisma.assetAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      expect(row).toMatchObject({ endReason: "RETURNED", returnConditionCode: "DEMO_WORN" });
    });

    it("transfer closes one assignment and opens the next in one step, and tells both people", async () => {
      const assetId = await newAsset();
      await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_GOOD" });
      const moved = await post("hrExec", `/api/assets/${assetId}/transfer`, { toEmployeeId: p.other.employeeId, conditionCode: "DEMO_GOOD" });
      expect(moved.status).toBe(200);
      expect(moved.body.holder).toMatchObject({ employeeId: p.other.employeeId });
      expect(await openRows(assetId)).toBe(1);
      const ended = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId, employeeId: p.employee.employeeId } });
      expect(ended.endReason).toBe("TRANSFERRED");
      expect(await prisma.notification.count({ where: { type: "assets.transferred", userId: { in: [p.employee.userId, p.other.userId] } } })).toBeGreaterThanOrEqual(2);
      expect((await post("hrExec", `/api/assets/${assetId}/transfer`, { toEmployeeId: p.other.employeeId, conditionCode: "DEMO_GOOD" })).status).toBe(409);
    });

    it("lost ends the assignment and needs a status that cannot be issued; damaged keeps the holder; neither carries an amount", async () => {
      const assetId = await newAsset();
      await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_GOOD" });
      const damaged = await post("hrExec", `/api/assets/${assetId}/damaged`, { conditionCode: "DEMO_BROKEN", note: "DEMO cracked screen" });
      expect(damaged.status).toBe(200);
      expect(damaged.body.holder).toMatchObject({ employeeId: p.employee.employeeId });
      expect((await post("hrExec", `/api/assets/${assetId}/lost`, { statusCode: "DEMO_STOCK", note: "DEMO lost" })).status).toBe(400);
      expect((await post("hrExec", `/api/assets/${assetId}/lost`, { statusCode: "DEMO_GONE", note: "DEMO lost", amount: 1000 })).status).toBe(400); // no money field exists
      const lost = await post("hrExec", `/api/assets/${assetId}/lost`, { statusCode: "DEMO_GONE", note: "DEMO lost on travel" });
      expect(lost.status).toBe(200);
      expect(lost.body.holder).toBeNull();
      expect(lost.body.status.code).toBe("DEMO_GONE");
      expect((await prisma.assetAssignment.findFirstOrThrow({ where: { assetId } })).endReason).toBe("LOST");
      for (const type of ["assets.damaged", "assets.lost"]) expect(await prisma.notification.count({ where: { userId: p.employee.userId, type } })).toBeGreaterThanOrEqual(1);
    });

    it("every action is in the event log and the audit log, one for one", async () => {
      const assetId = await newAsset();
      await patch("hrExec", `/api/assets/${assetId}`, { model: "DEMO model 2" });
      await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_GOOD" });
      const { id: a1 } = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId, endedAt: null } });
      await post("employee", `/api/assets/mine/${a1}/acknowledge`);
      await post("hrExec", `/api/assets/${assetId}/damaged`, { conditionCode: "DEMO_WORN", note: "DEMO scratch" });
      await post("hrExec", `/api/assets/${assetId}/transfer`, { toEmployeeId: p.other.employeeId, conditionCode: "DEMO_WORN" });
      const { id: a2 } = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId, endedAt: null } });
      await post("hrExec", `/api/assets/${assetId}/return`, { assignmentId: a2, conditionCode: "DEMO_WORN" });
      await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_WORN" });
      await post("hrExec", `/api/assets/${assetId}/lost`, { statusCode: "DEMO_GONE", note: "DEMO gone" });
      const events = await prisma.assetEvent.findMany({ where: { assetId }, orderBy: { at: "asc" } });
      expect(events.map((e) => e.kind)).toEqual(["CREATED", "EDITED", "ISSUED", "ACKNOWLEDGED", "DAMAGED", "TRANSFERRED", "RETURNED", "ISSUED", "LOST"]);
      const audits = await prisma.auditLog.findMany({ where: { entityType: "Asset", entityId: assetId } });
      expect(audits.map((a) => a.action).sort()).toEqual(events.map((e) => `assets.${e.kind.toLowerCase()}`).sort());
      for (const a of audits) expect(a.actorUserId).toBeTruthy();
      const detail = await get("director", `/api/assets/${assetId}`);
      expect(detail.body.events).toHaveLength(events.length);
      expect(detail.body.assignments).toHaveLength(3);
    });
  });

  describe("one open assignment per asset", () => {
    it("twenty concurrent issues of one asset to different people: exactly one succeeds, the rest are refused", async () => {
      const assetId = await newAsset("DEMO contended");
      const people = [p.employee, p.other, p.hrExec, p.hrAdmin, p.manager];
      const attempts = Array.from({ length: 20 }, (_, i) =>
        post(i % 2 ? "hrAdmin" : "hrExec", `/api/assets/${assetId}/issue`, { employeeId: people[i % people.length]!.employeeId, conditionCode: "DEMO_GOOD" }),
      );
      const statuses = (await Promise.all(attempts)).map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(19);
      expect(await openRows(assetId)).toBe(1);
      expect(await prisma.assetEvent.count({ where: { assetId, kind: "ISSUED" } })).toBe(1);
    });

    it("the database alone refuses a second open assignment (the service and its lock bypassed)", async () => {
      const assetId = await newAsset("DEMO raw");
      const row = (employeeId: string) => ({ assetId, employeeId, issuedByUserId: p.hrExec.userId, issueConditionCode: "DEMO_GOOD" });
      const results = await Promise.allSettled([p.employee, p.other, p.manager, p.hrAdmin].map((x) => prisma.assetAssignment.create({ data: row(x.employeeId) })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect((r.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      expect(await openRows(assetId)).toBe(1);
    });

    it("concurrent transfer and return of the same assignment leave exactly one consistent outcome", async () => {
      const assetId = await newAsset("DEMO race");
      await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_GOOD" });
      const { id: assignmentId } = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId, endedAt: null } });
      await Promise.all([
        post("hrExec", `/api/assets/${assetId}/transfer`, { toEmployeeId: p.other.employeeId, conditionCode: "DEMO_GOOD" }),
        post("hrAdmin", `/api/assets/${assetId}/return`, { assignmentId, conditionCode: "DEMO_GOOD" }),
      ]);
      expect(await openRows(assetId)).toBeLessThanOrEqual(1);
      const first = await prisma.assetAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      expect(first.endedAt).not.toBeNull();
    });
  });

  describe("append-only history", () => {
    it("an assignment's issue details never change, it closes once, and it is never deleted; events never change", async () => {
      const assetId = await newAsset();
      await post("hrExec", `/api/assets/${assetId}/issue`, { employeeId: p.employee.employeeId, conditionCode: "DEMO_GOOD" });
      const a = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId, endedAt: null } });
      await expect(prisma.assetAssignment.update({ where: { id: a.id }, data: { employeeId: p.other.employeeId } })).rejects.toThrow(/ASSET_ASSIGNMENTS_APPEND_ONLY/);
      await expect(prisma.assetAssignment.delete({ where: { id: a.id } })).rejects.toThrow(/ASSET_ASSIGNMENTS_APPEND_ONLY/);
      await post("hrExec", `/api/assets/${assetId}/return`, { assignmentId: a.id, conditionCode: "DEMO_GOOD" });
      await expect(prisma.assetAssignment.update({ where: { id: a.id }, data: { endedAt: null, endedByUserId: null, endReason: null, returnConditionCode: null } })).rejects.toThrow(/ASSET_ASSIGNMENTS_APPEND_ONLY/);
      const ev = await prisma.assetEvent.findFirstOrThrow({ where: { assetId } });
      await expect(prisma.assetEvent.update({ where: { id: ev.id }, data: { note: "rewritten" } })).rejects.toThrow(/ASSETS_APPEND_ONLY/);
      await expect(prisma.assetEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/ASSETS_APPEND_ONLY/);
      await expect(prisma.asset.delete({ where: { id: assetId } })).rejects.toThrow(/ASSETS_NO_DELETE/);
    });
  });

  describe("data scope", () => {
    it("a TEAM-scoped viewer sees and acts only on assets held by their team; others look absent and are never named", async () => {
      const inTeam = await newAsset("DEMO team asset");
      const outside = await newAsset("DEMO outside asset");
      await post("hrExec", `/api/assets/${inTeam}/issue`, { employeeId: p.teamMember.employeeId, conditionCode: "DEMO_GOOD" });
      await post("hrExec", `/api/assets/${outside}/issue`, { employeeId: p.outsider.employeeId, conditionCode: "DEMO_GOOD" });
      const list = await get("teamViewer", "/api/assets?pageSize=200");
      expect(list.status).toBe(200);
      const ids = list.body.items.map((a: { id: string }) => a.id);
      expect(ids).toContain(inTeam);
      expect(ids).not.toContain(outside);
      expect(JSON.stringify(list.body)).not.toContain(p.outsider.employeeCode);
      expect((await get("teamViewer", `/api/assets/${outside}`)).status).toBe(404);
      expect((await get("teamViewer", `/api/assets/employees/${p.outsider.employeeId}`)).status).toBe(404);
      expect((await post("teamViewer", `/api/assets/${inTeam}/transfer`, { toEmployeeId: p.outsider.employeeId, conditionCode: "DEMO_GOOD" })).status).toBe(404);
      const holders = await get("teamViewer", "/api/assets/holders?q=TEST");
      expect(holders.body.map((h: { employeeId: string }) => h.employeeId)).not.toContain(p.outsider.employeeId);
      const outsideAssignment = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId: outside, endedAt: null } });
      expect((await post("teamViewer", `/api/assets/${outside}/return`, { assignmentId: outsideAssignment.id, conditionCode: "DEMO_GOOD" })).status).toBe(404);
    });
  });
});
