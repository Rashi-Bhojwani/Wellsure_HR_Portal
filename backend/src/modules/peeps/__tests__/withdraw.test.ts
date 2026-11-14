import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { confirmSetting } from "../settings";
import { appoint, clearPeepsSettings } from "./peepsTestKit";

// Peeps Stage 3: a pending proposal (a Peeps setting version, or a Wellsure Office membership change) is withdrawn by its author or a director, with
// a reason, audited; once decided it cannot be withdrawn, and once withdrawn it cannot be confirmed (service and database).

type Who = "director" | "director2" | "preparer" | "member" | "hr" | "manager" | "emp" | "developer" | "former";

describe("withdrawing a pending proposal", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<Who, string>;
  const get = (who: Who, url: string) => request(app).get(url).set(...authHeader(tok[who]));
  const post = (who: Who, url: string, body: object = {}) => request(app).post(url).set(...authHeader(tok[who])).send(body);
  const changeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.preparer = await createFullTestEmployee(org);
    p.member = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.emp = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    p.former = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
    await prisma.user.update({ where: { id: p.former.userId }, data: { status: "DEACTIVATED" } });
    changeIds.push(await appoint(p.preparer.employeeId, ["PREPARE_SETTINGS"], p.director, p.director2));
    changeIds.push(await appoint(p.member.employeeId, ["PREPARE_SETTINGS"], p.director, p.director2));
  });

  afterAll(async () => {
    const ids = Object.values(p).map((x) => x.employeeId);
    const all = (await prisma.officeMembershipChange.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((c) => c.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: all } });
    await clearPeepsSettings();
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("a setting version: its author or a director withdraws it; nobody else; not once confirmed; a withdrawn one cannot be confirmed", async () => {
    const entered = await post("preparer", "/api/peeps/settings/unmute.sessionMinutes", { value: 30 });
    expect(entered.status).toBe(201);
    const v = entered.body.pending.version as number;
    for (const who of ["member", "hr", "manager", "emp", "developer"] as const) expect((await post(who, "/api/peeps/settings/unmute.sessionMinutes/withdraw", { version: v, reason: "not needed" })).status, who).toBe(403);
    expect((await post("former", "/api/peeps/settings/unmute.sessionMinutes/withdraw", { version: v, reason: "not needed" })).status).toBe(401);
    expect((await post("preparer", "/api/peeps/settings/unmute.sessionMinutes/withdraw", { version: v })).status).toBe(400); // a reason is required
    const done = await post("preparer", "/api/peeps/settings/unmute.sessionMinutes/withdraw", { version: v, reason: "DEMO entered by mistake" });
    expect(done.status).toBe(200);
    expect(done.body.pending).toBeNull();
    expect((await post("director", "/api/peeps/settings/unmute.sessionMinutes/confirm", { version: v })).body.error.code).toBe("WITHDRAWN");
    expect(await prisma.auditLog.count({ where: { action: "peeps.setting.withdrawn", actorUserId: p.preparer.userId } })).toBe(1);
    // A director withdraws someone else's; a confirmed one cannot be withdrawn.
    const again = (await post("preparer", "/api/peeps/settings/unmute.sessionMinutes", { value: 45 })).body.pending.version as number;
    expect((await post("director2", "/api/peeps/settings/unmute.sessionMinutes/withdraw", { version: again, reason: "DEMO director withdraws" })).status).toBe(200);
    const third = (await post("preparer", "/api/peeps/settings/unmute.sessionMinutes", { value: 50 })).body.pending.version as number;
    expect((await post("director", "/api/peeps/settings/unmute.sessionMinutes/confirm", { version: third })).status).toBe(200);
    expect((await post("director", "/api/peeps/settings/unmute.sessionMinutes/withdraw", { version: third, reason: "too late" })).body.error.code).toBe("ALREADY_DECIDED");
    const row = await prisma.peepsSettingVersion.findFirstOrThrow({ where: { key: "unmute.sessionMinutes", version: third } });
    await expect(prisma.peepsSettingWithdrawal.create({ data: { versionId: row.id, withdrawnByUserId: p.director.userId, reason: "database check" } })).rejects.toThrow(/PEEPS_ALREADY_DECIDED/);
  });

  it("confirming a setting: only a director who did not enter it; the author cannot, nor can anyone else (service 403, and the database refuses too)", async () => {
    // Found by the Stage 4 mutation check: with either service refusal removed, no test failed (the database trigger still refused, as a 500).
    const byDirector = (await post("director", "/api/peeps/settings/unmute.sessionMinutes", { value: 35 })).body.pending.version as number;
    const own = await post("director", "/api/peeps/settings/unmute.sessionMinutes/confirm", { version: byDirector });
    expect([own.status, own.body.error.code]).toEqual([403, "SAME_PERSON"]);
    for (const who of ["preparer", "member", "hr", "manager", "emp"] as const) {
      const r = await post(who, "/api/peeps/settings/unmute.sessionMinutes/confirm", { version: byDirector });
      expect([r.status, r.body.error?.code], who).toEqual([403, "FORBIDDEN"]); // the route's director guard
    }
    const byPreparer = (await post("preparer", "/api/peeps/settings/unmute.sessionMinutes", { value: 40 })).body.pending.version as number;
    // Behind the route guard, the service refuses a non-director on its own too.
    const preparerActor = { userId: p.preparer.userId, employeeId: p.preparer.employeeId, isDirector: false, isMember: true, capabilities: ["PREPARE_SETTINGS"], roleCodes: [] } as never;
    await expect(confirmSetting("unmute.sessionMinutes", { version: byPreparer }, preparerActor, { actorUserId: p.preparer.userId, ipAddress: null, userAgent: null })).rejects.toMatchObject({ status: 403, code: "DIRECTORS_ONLY" });
    const row = await prisma.peepsSettingVersion.findFirstOrThrow({ where: { key: "unmute.sessionMinutes", version: byPreparer } });
    await expect(prisma.peepsSettingConfirmation.create({ data: { versionId: row.id, confirmedByUserId: p.preparer.userId } })).rejects.toThrow(/PEEPS_SETTING_SAME_PERSON/);
    await expect(prisma.peepsSettingConfirmation.create({ data: { versionId: row.id, confirmedByUserId: p.member.userId } })).rejects.toThrow(/PEEPS_SETTING_DIRECTORS_ONLY/);
    expect(await prisma.peepsSettingConfirmation.count({ where: { versionId: row.id } })).toBe(0);
    const ok = await post("director2", "/api/peeps/settings/unmute.sessionMinutes/confirm", { version: byPreparer });
    expect(ok.status).toBe(200);
    expect(ok.body.inForce.value).toBe(40);
  });

  it("a membership change: a director withdraws it before it is confirmed; not after; a withdrawn change cannot be confirmed", async () => {
    const proposed = await post("director", "/api/peeps/office/changes", { kind: "APPOINT", employeeId: p.emp.employeeId, capabilities: ["PREPARE_SETTINGS"], reason: "DEMO trial" });
    expect(proposed.status).toBe(201);
    const id = proposed.body.id as string;
    for (const who of ["preparer", "hr", "manager", "emp", "developer"] as const) expect((await post(who, `/api/peeps/office/changes/${id}/withdraw`, { reason: "no" })).status, who).toBe(403);
    expect((await post("director2", `/api/peeps/office/changes/${id}/withdraw`, { reason: "DEMO not now" })).body).toMatchObject({ withdrawn: true, repeated: false });
    expect((await post("director2", `/api/peeps/office/changes/${id}/withdraw`, { reason: "DEMO not now" })).body).toMatchObject({ repeated: true });
    expect((await post("director2", `/api/peeps/office/changes/${id}/confirm`)).body.error.code).toBe("WITHDRAWN");
    await expect(prisma.officeMembershipConfirmation.create({ data: { changeId: id, confirmedByUserId: p.director2.userId } })).rejects.toThrow(/PEEPS_WITHDRAWN/);
    const overview = (await get("director", "/api/peeps/office/members")).body;
    expect(overview.changes.find((c: { id: string }) => c.id === id).withdrawnAt).toBeTruthy();
    expect(overview.members.some((m: { employeeId: string }) => m.employeeId === p.emp.employeeId)).toBe(false);
    expect((await post("director", `/api/peeps/office/changes/${changeIds[0]}/withdraw`, { reason: "too late" })).body.error.code).toBe("ALREADY_DECIDED");
  });
});
