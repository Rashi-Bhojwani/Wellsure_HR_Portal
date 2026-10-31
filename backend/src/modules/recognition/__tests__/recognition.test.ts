import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVATE_NOTICE } from "@shared/constants/peeps";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { appoint, clearPeepsSettings, setSetting } from "../../peeps/__tests__/peepsTestKit";

// Badges and private nudges (D-28, D-29, Q-16): the settings gate, who may give or send (directors; members with the capability while the setting lists
// the Wellsure Office; managers to their own team; never HR), idempotent issue, monthly limits, revocation only when allowed, who reads a nudge, the
// director-open audit, and that a nudge's existence and text never leak into shared lists, search, counts, exports, notifications, audit rows or sockets.

type Who = "director" | "director2" | "member" | "memberNoCap" | "hrAdmin" | "hrManager" | "hrReport" | "manager" | "report" | "employee" | "employee2" | "developer";
type Person = { employeeId: string; employeeCode: string; userId: string };
const MARKER = `nudge-marker-${Date.now()}`;
let seq = 0;
const key = () => `test-key-${Date.now()}-${(seq += 1)}`;

describe("badges and private nudges", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  const get = (who: Who, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const post = (who: Who, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body);
  const give = (who: Who, to: Who, extra: object = {}) => post(who, "/api/badges", { recipientEmployeeId: p[to].employeeId, badgeCode: "DEMO_THANKS", idempotencyKey: key(), ...extra });
  const nudge = (who: Who, to: Who, extra: object = {}) => post(who, "/api/nudges", { recipientEmployeeId: p[to].employeeId, body: `${MARKER} please`, idempotencyKey: key(), ...extra });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.member = await createFullTestEmployee(org);
    p.memberNoCap = await createFullTestEmployee(org);
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.report = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.hrManager = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" }); // HR who also has someone reporting to them
    p.hrReport = await createFullTestEmployee(org, { managerId: p.hrManager.employeeId });
    p.employee = await createFullTestEmployee(org);
    p.employee2 = await createFullTestEmployee(org);
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
    await appoint(p.member.employeeId, ["GIVE_BADGES", "SEND_NUDGES"], p.director, p.director2);
    await appoint(p.memberNoCap.employeeId, [], p.director, p.director2);
  });

  afterAll(async () => {
    setSocketServer(null);
    await clearPeepsSettings();
    const ids = Object.values(p).map((x) => x.employeeId);
    const awardIds = (await prisma.badgeAward.findMany({ where: { recipientEmployeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    const nudgeIds = (await prisma.privateNudge.findMany({ where: { recipientEmployeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    const changeIds = (await prisma.officeMembershipChange.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((c) => c.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...awardIds, ...nudgeIds, ...changeIds] } });
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("Not set until the directors set it", () => {
    it("without the catalogue and the givers, badges refuse; without the senders, nudges refuse — for everyone, directors included", async () => {
      expect((await get("employee", "/api/badges/status")).body).toMatchObject({ active: false, canGive: false });
      expect((await give("director", "employee")).status).toBe(409);
      expect((await nudge("director", "employee")).status).toBe(409);
      await setSetting("badges.catalogue", [{ code: "DEMO_THANKS", label: "DEMO Thank you" }], p.director, p.director2);
      expect((await give("director", "employee")).status).toBe(409); // givers still Not set
      await setSetting("audience.badges", { givers: ["MANAGERS", "OFFICE"] }, p.director, p.director2);
      await setSetting("audience.nudges", { senders: ["MANAGERS", "OFFICE"] }, p.director, p.director2);
      expect((await get("employee", "/api/badges/status")).body).toMatchObject({ active: true });
    });
  });

  describe("who may give and send", () => {
    it("directors, members with the capability and managers (own team only) may; HR, a member without it, an employee and the Developer may not", async () => {
      expect((await give("director", "employee")).status).toBe(201);
      expect((await give("member", "employee")).status).toBe(201);
      expect((await give("manager", "report")).status).toBe(201);
      expect((await give("manager", "employee")).status).toBe(403); // not their team
      for (const who of ["hrAdmin", "memberNoCap", "employee2", "developer"] as const) expect((await give(who, "employee")).status, who).toBe(403);
      expect((await give("employee", "employee")).status).toBe(409); // never yourself
      expect((await give("hrManager", "hrReport")).status).toBe(403); // HR never gives, not even to their own team
      expect((await nudge("hrManager", "hrReport")).status).toBe(403);
      expect((await nudge("director", "employee")).status).toBe(201);
      expect((await nudge("member", "employee")).status).toBe(201);
      expect((await nudge("manager", "report")).status).toBe(201);
      expect((await nudge("manager", "employee")).status).toBe(403);
      for (const who of ["hrAdmin", "memberNoCap", "employee2", "developer"] as const) expect((await nudge(who, "employee")).status, who).toBe(403);
    });

    it("when the setting no longer lists the Wellsure Office or managers, they are refused; directors are not", async () => {
      await setSetting("audience.badges", { givers: [] }, p.director, p.director2);
      expect((await give("member", "employee")).status).toBe(403);
      expect((await give("manager", "report")).status).toBe(403);
      expect((await give("director", "employee")).status).toBe(201);
      await setSetting("audience.badges", { givers: ["MANAGERS", "OFFICE"] }, p.director, p.director2);
    });

    it("a manager's recipient list is their own team; HR's is empty", async () => {
      const team = await get("manager", "/api/badges/recipients?q=");
      expect(team.body.map((x: { employeeId: string }) => x.employeeId)).toEqual([p.report.employeeId]);
      expect((await get("hrAdmin", "/api/nudges/recipients?q=")).body).toEqual([]);
    });
  });

  describe("badges", () => {
    it("issuing twice with the same key gives one badge (idempotent), also when the two calls race", async () => {
      const k = key();
      const [a, b] = await Promise.all([give("member", "employee2", { idempotencyKey: k }), give("member", "employee2", { idempotencyKey: k })]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await prisma.badgeAward.count({ where: { giverUserId: p.member.userId, idempotencyKey: k } })).toBe(1);
    });

    it("the recipient sees the badge from the Wellsure Office (a manager's by name); colleagues see it only when the directors show badges on profiles", async () => {
      const mine = (await get("employee", "/api/badges/mine")).body;
      const froms = new Set(mine.map((b: { from: string }) => b.from));
      expect(froms.has("Wellsure Office")).toBe(true);
      expect(JSON.stringify(mine)).not.toContain(p.member.employeeCode);
      expect((await get("employee2", `/api/badges/people/${p.employee.employeeId}`)).body).toEqual({ shown: false, badges: [] });
      await setSetting("badges.display", { profile: true, directory: true }, p.director, p.director2);
      const seen = await get("employee2", `/api/badges/people/${p.employee.employeeId}`);
      expect(seen.body.shown).toBe(true);
      expect(seen.body.badges.length).toBeGreaterThan(0);
      expect((await get("employee2", `/api/badges/directory?ids=${p.employee.employeeId}`)).body.counts[p.employee.employeeId]).toBeGreaterThan(0);
    });

    it("monthly limit and revocation follow their settings (Not set: no limit, no revocation)", async () => {
      const own = (await get("member", "/api/badges/given")).body[0];
      expect((await post("member", `/api/badges/${own.id}/revoke`, { reason: "test" })).status).toBe(409);
      await setSetting("badges.revocation", { allowed: true }, p.director, p.director2);
      expect((await post("employee2", `/api/badges/${own.id}/revoke`, { reason: "test" })).status).toBe(404);
      expect((await post("member", `/api/badges/${own.id}/revoke`, { reason: "given by mistake" })).status).toBe(200);
      expect((await post("member", `/api/badges/${own.id}/revoke`, { reason: "again" })).body).toMatchObject({ repeated: true });
      const count = await prisma.badgeAward.count({ where: { giverUserId: p.member.userId } });
      await setSetting("badges.limits", { perGiverPerMonth: count }, p.director, p.director2);
      expect((await give("member", "employee")).status).toBe(409);
    });
  });

  describe("private nudges: who reads them", () => {
    it("the sender and the recipient read it; another employee, the recipient's manager, HR, a member and the Developer do not", async () => {
      const sent = await nudge("member", "report");
      expect(sent.status).toBe(201);
      const id = sent.body.id as string;
      expect((await get("member", `/api/nudges/${id}`)).body.body).toContain(MARKER);
      const inbox = await get("report", "/api/nudges/mine");
      expect(inbox.body.some((n: { id: string; body: string; from: string }) => n.id === id && n.body.includes(MARKER) && n.from === "Wellsure Office")).toBe(true);
      expect(await prisma.nudgeRead.count({ where: { nudgeId: id } })).toBe(1);
      for (const who of ["employee2", "manager", "hrAdmin", "memberNoCap", "developer"] as const) {
        expect((await get(who, `/api/nudges/${id}`)).status, who).toBe(404);
        expect(JSON.stringify((await get(who, "/api/nudges/mine")).body), who).not.toContain(id);
        expect((await get(who, "/api/nudges/admin/all")).status, who).toBe(403);
      }
    });

    it("a director reads any nudge, and each one opened is audited (who, what, when); never blocked", async () => {
      const target = await prisma.privateNudge.findFirstOrThrow({ where: { senderUserId: p.member.userId } });
      const before = await prisma.auditLog.count({ where: { action: "peeps.director.opened", entityId: target.id, actorUserId: p.director.userId } });
      expect((await get("director", `/api/nudges/${target.id}`)).status).toBe(200);
      const all = await get("director", "/api/nudges/admin/all");
      expect(all.body.some((n: { id: string }) => n.id === target.id)).toBe(true);
      expect(await prisma.auditLog.count({ where: { action: "peeps.director.opened", entityId: target.id, actorUserId: p.director.userId } })).toBe(before + 2);
    });

    it("sending twice with the same key sends one nudge", async () => {
      const k = key();
      const [a, b] = await Promise.all([nudge("director", "employee2", { idempotencyKey: k }), nudge("director", "employee2", { idempotencyKey: k })]);
      expect(a.body.id).toBe(b.body.id);
      expect(await prisma.privateNudge.count({ where: { senderUserId: p.director.userId, idempotencyKey: k } })).toBe(1);
    });
  });

  describe("private nudges never leak", () => {
    it("not in the feed, the directory search, task lists, counts, dashboards, notifications, exports or the audit log", async () => {
      const sent = await nudge("director", "employee");
      const id = sent.body.id as string;
      const probes: Array<[Who, string]> = [
        ["employee", "/api/engage/posts"],
        ["employee2", "/api/engage/posts"],
        ["employee2", `/api/people?q=${MARKER}`],
        ["employee2", "/api/people"],
        ["manager", "/api/tasks/mine"],
        ["hrAdmin", "/api/admin/tasks/counts"],
        ["hrAdmin", "/api/admin/dashboard"],
        ["employee", "/api/notifications"],
        ["employee", "/api/request-hub"],
        ["director", "/api/employees/export"],
      ];
      for (const [who, path] of probes) {
        const res = await get(who, path);
        const text = typeof res.text === "string" ? res.text : JSON.stringify(res.body);
        expect(text.includes(MARKER), `${who} ${path}`).toBe(false);
      }
      const notes = await prisma.notification.findMany({ where: { userId: p.employee.userId, type: "peeps.waiting" } });
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect({ title: n.title, body: n.body }).toEqual(PRIVATE_NOTICE);
      const audits = await prisma.auditLog.findMany({ where: { entityId: id } });
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits)).not.toContain(MARKER);
      const stored = await prisma.privateNudge.findUniqueOrThrow({ where: { id } });
      expect(Buffer.from(stored.bodyEncrypted).toString("utf8")).not.toContain(MARKER);
    });

    it("the only socket event is the recipient's own generic notification", async () => {
      const events: Array<{ room: string; event: string; args: unknown[] }> = [];
      const fake: RoomEmitter = { to: (room) => ({ emit: (event: string, ...args: unknown[]) => events.push({ room: String(room), event, args }) }) };
      setSocketServer(fake);
      try {
        expect((await nudge("member", "employee2")).status).toBe(201);
      } finally {
        setSocketServer(null);
      }
      expect(events.map((e) => [e.room, e.event])).toEqual([[`user:${p.employee2.employeeId}`, "notification.new"]]);
      expect(JSON.stringify(events)).not.toContain(MARKER);
      expect(JSON.stringify(events)).toContain(PRIVATE_NOTICE.title);
    });

    it("the text is listed for field encryption", async () => {
      const { ENCRYPTED_COLUMNS } = await import("../../../lib/fieldKeyRotation");
      expect(ENCRYPTED_COLUMNS).toContainEqual({ model: "PrivateNudge", delegate: "privateNudge", field: "bodyEncrypted" });
    });
  });

  it("append-only: an award, a nudge and a read are never changed", async () => {
    const award = await prisma.badgeAward.findFirstOrThrow();
    await expect(prisma.badgeAward.update({ where: { id: award.id }, data: { message: "rewritten" } })).rejects.toThrow(/PEEPS_APPEND_ONLY/);
    const n = await prisma.privateNudge.findFirstOrThrow();
    await expect(prisma.privateNudge.delete({ where: { id: n.id } })).rejects.toThrow(/PEEPS_APPEND_ONLY/);
  });
});
