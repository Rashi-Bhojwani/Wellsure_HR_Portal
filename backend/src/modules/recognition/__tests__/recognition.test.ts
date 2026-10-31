import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVATE_NOTICE } from "@shared/constants/peeps";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import pino from "pino";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { appoint, clearPeepsSettings, setSetting } from "../../peeps/__tests__/peepsTestKit";
import { monthStart } from "../common";

// Badges and private nudges (D-28, D-29, Q-16 decided): the settings gate, who may give or send (the directors only; a widening setting, Not set, could add
// members with the capability and managers to their own team; never HR), idempotent issue, company-wide badge visibility to signed-in staff, monthly
// limits, revocation only when allowed, who reads a nudge, the director-open audit, and that a nudge's existence and text never leak into shared lists,
// search, counts, exports, notifications, logs, audit rows or sockets.

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
    it("without the catalogue, badges refuse for everyone, directors included; nudges need nothing set (Q-16: the directors send)", async () => {
      expect((await get("employee", "/api/badges/status")).body).toMatchObject({ active: false, canGive: false });
      expect((await give("director", "employee")).status).toBe(409);
      await setSetting("badges.catalogue", [{ code: "DEMO_THANKS", label: "DEMO Thank you" }], p.director, p.director2);
      expect((await get("employee", "/api/badges/status")).body).toMatchObject({ active: true, canGive: false });
      expect((await get("director", "/api/badges/status")).body).toMatchObject({ active: true, canGive: true });
      expect((await get("employee", "/api/nudges/status")).body).toMatchObject({ active: true, canSend: false });
    });
  });

  describe("who may give and send (Q-16: the directors only, to any employee)", () => {
    it("a director gives and sends to anyone; HR, a manager (even to their own report), a non-director employee, a Wellsure Office member with the capability and the Developer cannot", async () => {
      expect((await give("director", "employee")).status).toBe(201);
      expect((await give("director2", "report")).status).toBe(201);
      expect((await nudge("director", "employee")).status).toBe(201);
      const refused: Array<[Who, Who]> = [["hrAdmin", "employee"], ["hrManager", "hrReport"], ["manager", "report"], ["manager", "employee"], ["employee2", "employee"], ["member", "employee"], ["memberNoCap", "employee"], ["developer", "employee"]];
      for (const [who, to] of refused) {
        expect((await give(who, to)).status, `badge ${who} → ${to}`).toBe(403);
        expect((await nudge(who, to)).status, `nudge ${who} → ${to}`).toBe(403);
      }
      expect((await give("employee", "employee")).status).toBe(409); // never yourself
      for (const who of ["hrAdmin", "manager", "employee2", "member", "developer"] as const) {
        expect((await get(who, "/api/badges/recipients?q=")).body, who).toEqual([]);
        expect((await get(who, "/api/nudges/recipients?q=")).body, who).toEqual([]);
      }
      expect((await get("director", "/api/badges/recipients?q=")).body.length).toBeGreaterThan(0);
    });

    it("the widening setting, if the directors ever set it, lets members with the capability and managers (own team) give; HR never; back to Not-widened refuses them again", async () => {
      await setSetting("audience.badges", { givers: ["MANAGERS", "OFFICE"] }, p.director, p.director2);
      expect((await give("member", "employee")).status).toBe(201);
      expect((await give("manager", "report")).status).toBe(201);
      expect((await give("manager", "employee")).status).toBe(403); // not their team
      expect((await give("hrManager", "hrReport")).status).toBe(403); // HR never gives, not even to their own team
      expect((await give("memberNoCap", "employee")).status).toBe(403);
      expect((await get("manager", "/api/badges/recipients?q=")).body.map((x: { employeeId: string }) => x.employeeId)).toEqual([p.report.employeeId]);
      await setSetting("audience.badges", { givers: [] }, p.director, p.director2);
      expect((await give("member", "employee")).status).toBe(403);
      expect((await give("manager", "report")).status).toBe(403);
      expect((await give("director", "employee")).status).toBe(201);
    });
  });

  describe("badges", () => {
    it("issuing twice with the same key gives one badge (idempotent), also when the two calls race", async () => {
      const k = key();
      const [a, b] = await Promise.all([give("director", "employee2", { idempotencyKey: k }), give("director", "employee2", { idempotencyKey: k })]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await prisma.badgeAward.count({ where: { giverUserId: p.director.userId, idempotencyKey: k } })).toBe(1);
    });

    it("the recipient sees their own badges, from the Wellsure Office (never the director's name)", async () => {
      const mine = (await get("employee", "/api/badges/mine")).body;
      expect(mine.length).toBeGreaterThan(0);
      expect(new Set(mine.map((b: { from: string }) => b.from))).toEqual(new Set(["Wellsure Office"]));
      expect(JSON.stringify(mine)).not.toContain(p.director.employeeCode);
    });

    it("badges are visible company-wide to signed-in staff, on the profile and in the directory, without the giver's message; not to the Developer, not signed out", async () => {
      for (const who of ["employee2", "manager", "hrAdmin", "report"] as const) {
        const seen = await get(who, `/api/badges/people/${p.employee.employeeId}`);
        expect(seen.status, who).toBe(200);
        expect(seen.body.shown, who).toBe(true);
        expect(seen.body.badges.length, who).toBeGreaterThan(0);
        expect(seen.body.badges.every((b: object) => !("message" in b)), who).toBe(true);
        expect((await get(who, `/api/badges/directory?ids=${p.employee.employeeId}`)).body.counts[p.employee.employeeId], who).toBeGreaterThan(0);
      }
      expect((await get("developer", `/api/badges/people/${p.employee.employeeId}`)).status).toBe(403);
      expect((await get("developer", `/api/badges/directory?ids=${p.employee.employeeId}`)).status).toBe(403);
      expect((await get("developer", "/api/badges/mine")).status).toBe(200); // their own
      for (const path of [`/api/badges/people/${p.employee.employeeId}`, `/api/badges/directory?ids=${p.employee.employeeId}`, "/api/badges/mine", "/api/badges/admin/all"]) expect((await request(app).get(path)).status, path).toBe(401);
    });

    it("a badge reaches only the recipient's own room, with a generic notification; nothing is posted to the feed", async () => {
      const events: Array<{ room: string; event: string }> = [];
      const fake: RoomEmitter = { to: (room) => ({ emit: (event: string) => events.push({ room: String(room), event }) }) };
      setSocketServer(fake);
      try {
        expect((await give("director", "employee2", { message: "a private word" })).status).toBe(201);
      } finally {
        setSocketServer(null);
      }
      expect(events.map((e) => [e.room, e.event])).toEqual([[`user:${p.employee2.employeeId}`, "notification.new"]]);
      expect(JSON.stringify((await get("employee", "/api/engage/posts")).body)).not.toContain("a private word");
    });

    it("monthly limit and revocation follow their settings (Not set: no limit, no revocation)", async () => {
      const own = (await get("director", "/api/badges/given")).body[0];
      expect((await post("director", `/api/badges/${own.id}/revoke`, { reason: "test" })).status).toBe(409);
      await setSetting("badges.revocation", { allowed: true }, p.director, p.director2);
      expect((await post("employee2", `/api/badges/${own.id}/revoke`, { reason: "test" })).status).toBe(404);
      expect((await post("director", `/api/badges/${own.id}/revoke`, { reason: "given by mistake" })).status).toBe(200);
      expect((await post("director", `/api/badges/${own.id}/revoke`, { reason: "again" })).body).toMatchObject({ repeated: true });
      const count = await prisma.badgeAward.count({ where: { giverUserId: p.director.userId, givenAt: { gte: monthStart() } } });
      await setSetting("badges.limits", { perGiverPerMonth: count }, p.director, p.director2);
      expect((await give("director", "employee")).status).toBe(409);
    });
  });

  describe("private nudges: who reads them", () => {
    it("the sender and the recipient read it; another employee, the recipient's manager, HR, a member and the Developer do not", async () => {
      const sent = await nudge("director2", "report");
      expect(sent.status).toBe(201);
      const id = sent.body.id as string;
      expect((await get("director2", `/api/nudges/${id}`)).body.body).toContain(MARKER);
      const inbox = await get("report", "/api/nudges/mine");
      expect(inbox.body.some((n: { id: string; body: string; from: string }) => n.id === id && n.body.includes(MARKER) && n.from === "Wellsure Office")).toBe(true);
      expect(await prisma.nudgeRead.count({ where: { nudgeId: id } })).toBe(1);
      for (const who of ["employee2", "manager", "hrAdmin", "member", "memberNoCap", "developer"] as const) {
        expect((await get(who, `/api/nudges/${id}`)).status, who).toBe(404);
        expect(JSON.stringify((await get(who, "/api/nudges/mine")).body), who).not.toContain(id);
        expect((await get(who, "/api/nudges/admin/all")).status, who).toBe(403);
      }
    });

    it("a director reads any nudge, and each one opened is audited (who, what, when); never blocked", async () => {
      const target = await prisma.privateNudge.findFirstOrThrow({ where: { senderUserId: p.director2.userId } }); // not this director's own
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
        expect((await nudge("director", "employee2")).status).toBe(201);
      } finally {
        setSocketServer(null);
      }
      expect(events.map((e) => [e.room, e.event])).toEqual([[`user:${p.employee2.employeeId}`, "notification.new"]]);
      expect(JSON.stringify(events)).not.toContain(MARKER);
      expect(JSON.stringify(events)).toContain(PRIVATE_NOTICE.title);
    });

    it("not in the logs: sending, reading and a director opening a nudge print nothing of its text (request logs included)", async () => {
      const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
      const lines: string[] = [];
      const original = stream.write.bind(stream);
      stream.write = (line: string) => {
        lines.push(String(line));
        return original(line);
      };
      try {
        const sent = await nudge("director", "employee");
        expect(sent.status).toBe(201);
        await get("employee", `/api/nudges/${sent.body.id}`);
        await get("employee", "/api/nudges/mine");
        await get("director2", `/api/nudges/${sent.body.id}`);
        await get("director2", "/api/nudges/admin/all");
        logger.info({ probe: "nudge-log-check" }, "probe"); // proves the capture sees the logger's output
      } finally {
        stream.write = original;
      }
      expect(lines.some((l) => l.includes("nudge-log-check"))).toBe(true);
      expect(lines.join("\n")).not.toContain(MARKER);
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
