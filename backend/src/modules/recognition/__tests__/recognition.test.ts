import request from "supertest";
import pino from "pino";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_BADGE_CATALOGUE } from "@shared/constants/peeps";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { appoint, clearPeepsSettings, directorActor, setSetting } from "../../peeps/__tests__/peepsTestKit";
import * as badgeService from "../badges";
import { expiryFor, monthStart } from "../common";

// Badges and cheers (D-36, Peeps Stage 3) follow the reporting line: downward to anyone below the giver, upward along their chain to the directors,
// directors to anyone; never to peers or another line, never to oneself; Wellsure Office members have no extra reach; the Developer never gives. A
// reason is required. The catalogue (12 conventional badges), the limits (5 a month per giver, 1 a month per pair), repeats, the no-manager fallback
// and the public details ship as defaults; directors change them. Plus expiry, revoke, retire, visibility and idempotent issue. Nudge tags and the
// read-only corrective notes are in nudgeTags.test.ts.

type Who =
  | "director" | "director2" | "managerA" | "a1" | "a2" | "a3" | "managerB" | "b1" | "hr" | "hrReport" | "loner" | "member" | "developer";
type Person = { employeeId: string; employeeCode: string; userId: string };
let seq = 0;
const key = () => `test-key-${Date.now()}-${(seq += 1)}`;
const CATALOGUE = [
  ...DEFAULT_BADGE_CATALOGUE,
  { code: "DEMO_WEEK", label: "DEMO Thanks this week", duration: "WEEK" },
  { code: "DEMO_MONTH", label: "DEMO Star of the month", duration: "MONTH" },
  { code: "DEMO_FOREVER", label: "DEMO Milestone", duration: "PERMANENT" },
];

// Make both real HTTP calls reach their transactions before committing the winner.
// The loser then receives the selected Prisma conflict, independent of PostgreSQL's
// scheduler. The separate unmocked races exercise real concurrent transactions too.
async function withRaceConflict<T>(code: 'P2002' | 'P2034', run: () => Promise<T>): Promise<T> {
  const original = prisma.$transaction.bind(prisma);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  let winner: Promise<unknown>;
  let calls = 0;
  const spy = vi.spyOn(prisma, '$transaction');
  spy.mockImplementation(((...args: Parameters<typeof prisma.$transaction>) => {
    calls += 1;
    if (calls === 1) {
      winner = ready.then(() => original(...args));
      return winner;
    }
    if (calls === 2) {
      release();
      return winner.then(() => {
        throw new Prisma.PrismaClientKnownRequestError('DEMO concurrent request conflict', { code, clientVersion: Prisma.prismaVersion.client });
      });
    }
    return original(...args);
  }) as typeof prisma.$transaction);
  try {
    const out = await run();
    expect(calls).toBe(2);
    return out;
  } finally {
    release();
    spy.mockRestore();
  }
}

describe("badges and cheers", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  const get = (who: Who, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const post = (who: Who, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body);
  const give = (who: Who, to: Who, extra: object = {}) => post(who, "/api/badges", { recipientEmployeeId: p[to].employeeId, badgeCode: "DEMO_FOREVER", message: "DEMO thanks for the help", idempotencyKey: key(), ...extra });
  const roomy = () => setSetting("badges.limits", { perGiverPerMonth: 1000, perPairPerMonth: 100 }, p.director, p.director2);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    // Line A: managerA → a1 → a2, and a3 (a2's peer under a1). Line B: managerB → b1. All in the same department: department is never the test.
    p.managerA = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.a1 = await createFullTestEmployee(org, { managerId: p.managerA.employeeId });
    p.a2 = await createFullTestEmployee(org, { managerId: p.a1.employeeId });
    p.a3 = await createFullTestEmployee(org, { managerId: p.a1.employeeId });
    p.managerB = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.b1 = await createFullTestEmployee(org, { managerId: p.managerB.employeeId });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" }); // top level: reports to the directors by design
    p.hrReport = await createFullTestEmployee(org, { managerId: p.hr.employeeId });
    p.loner = await createFullTestEmployee(org); // no manager, not a manager or HR Admin
    p.member = await createFullTestEmployee(org);
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
    await appoint(p.member.employeeId, ["GIVE_BADGES"], p.director, p.director2);
  });

  afterAll(async () => {
    vi.useRealTimers();
    setSocketServer(null);
    await clearPeepsSettings();
    const ids = Object.values(p).map((x) => x.employeeId);
    const awardIds = (await prisma.badgeAward.findMany({ where: { recipientEmployeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    const changeIds = (await prisma.officeMembershipChange.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((c) => c.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...awardIds, ...changeIds, "badges.catalogue"] } });
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("shipped defaults (Default, change in settings)", () => {
    it("with nothing set, the 12 default badges are givable and the settings list shows them as defaults", async () => {
      const status = (await get("a1", "/api/badges/status")).body;
      expect(status.active).toBe(true);
      expect(status.catalogue.map((c: { code: string }) => c.code)).toEqual(DEFAULT_BADGE_CATALOGUE.map((c) => c.code));
      expect(DEFAULT_BADGE_CATALOGUE).toHaveLength(12);
      expect(DEFAULT_BADGE_CATALOGUE.some((c) => /time|attendance|punctual/i.test(c.label))).toBe(false); // nothing about attendance
      const settings = (await get("director", "/api/peeps/settings")).body as Array<{ key: string; state: string }>;
      for (const k of ["badges.catalogue", "badges.limits", "badges.repeat", "badges.noManagerFallback", "badges.publicDetails"]) expect(settings.find((x) => x.key === k)?.state, k).toBe("DEFAULT");
      expect((await give("managerA", "a1", { badgeCode: "TEAM_PLAYER" })).status).toBe(201);
    });

    it("default limits: one badge per giver-receiver pair a month, five gives per giver a month", async () => {
      expect((await give("managerA", "a1", { badgeCode: "MENTOR" })).body.error?.code ?? "").toBe("PAIR_LIMIT_REACHED"); // a1 already had one this month
      for (const to of ["a2", "a3", "director", "director2"] as const) expect((await give("managerA", to, { badgeCode: "ON_FIRE" })).status, to).toBe(201);
      const sixth = await give("managerA", "hr", { badgeCode: "ON_FIRE" });
      expect([403, 409]).toContain(sixth.status); // hr is not in managerA's line: refused anyway
      const fifthTarget = await give("managerA", "director", { badgeCode: "LIFESAVER" });
      expect(fifthTarget.body.error?.code).toMatch(/LIMIT_REACHED/); // five already given this month
    });

    it("a reason is required", async () => {
      await roomy();
      expect((await give("managerB", "b1", { message: undefined })).status).toBe(400);
      expect((await give("managerB", "b1", { message: "  " })).status).toBe(400);
      expect((await give("managerB", "b1", { message: "DEMO well done" })).status).toBe(201);
    });

    it("directors change the catalogue: rename, retire, add; a retired badge cannot be given and stays on past awards; a given badge cannot be deleted", async () => {
      await roomy();
      const given = await give("managerB", "b1", { badgeCode: "IDEA_SPARK" });
      expect(given.status).toBe(201);
      const renamedRetired = DEFAULT_BADGE_CATALOGUE.map((c) => (c.code === "IDEA_SPARK" ? { ...c, label: "DEMO Bright Idea", retired: true } : c));
      await setSetting("badges.catalogue", [...renamedRetired, { code: "DEMO_FOREVER", label: "DEMO Milestone", duration: "PERMANENT" }], p.director, p.director2);
      expect((await give("managerB", "b1", { badgeCode: "IDEA_SPARK" })).body.error?.code).toBe("RETIRED");
      const mine = (await get("b1", "/api/badges/mine")).body as Array<{ id: string; badge: string; retiredBadge: boolean }>;
      expect(mine.find((b) => b.id === given.body.id)).toMatchObject({ badge: "DEMO Bright Idea", retiredBadge: true });
      expect(await prisma.auditLog.count({ where: { action: "badges.catalogue.retired", entityId: "badges.catalogue" } })).toBeGreaterThanOrEqual(1);
      expect(await prisma.auditLog.count({ where: { action: "badges.catalogue.renamed", entityId: "badges.catalogue" } })).toBeGreaterThanOrEqual(1);
      const withoutIt = renamedRetired.filter((c) => c.code !== "IDEA_SPARK");
      const refused = await post("director", "/api/peeps/settings/badges.catalogue", { value: withoutIt });
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe("RETIRE_INSTEAD");
      await setSetting("badges.catalogue", CATALOGUE, p.director, p.director2);
    });
  });

  describe("who may give: the reporting line (D-36)", () => {
    it("downward to anyone below, upward along the chain to a director; never a peer or another line; directors to anyone", async () => {
      await roomy();
      const allowed: Array<[Who, Who]> = [["managerA", "a1"], ["managerA", "a2"], ["a1", "a2"], ["a2", "a1"], ["a2", "managerA"], ["a2", "director"], ["managerA", "director"], ["director", "b1"], ["director", "loner"], ["hr", "hrReport"], ["hr", "director"], ["hrReport", "hr"]];
      for (const [from, to] of allowed) expect((await give(from, to)).status, `${from} → ${to}`).toBe(201);
      const refused: Array<[Who, Who]> = [["managerA", "b1"], ["managerA", "managerB"], ["a2", "a3"], ["a1", "b1"], ["b1", "a1"], ["b1", "managerA"], ["hr", "b1"], ["hr", "a1"], ["hrReport", "b1"], ["member", "b1"], ["developer", "a1"], ["developer", "director"]];
      for (const [from, to] of refused) expect((await give(from, to)).status, `${from} → ${to}`).toBe(403);
      expect((await give("a1", "a1")).status).toBe(409); // never yourself
    });

    it("a manager of one department cannot give to another department's people, even when the line is the same shape", async () => {
      const otherDept = await prisma.department.create({ data: { code: `TEST-D-${Date.now()}`, name: `Test other dept ${Date.now()}` } });
      try {
        await prisma.employeeJobHistory.updateMany({ where: { employeeId: p.b1.employeeId, effectiveTo: null }, data: { departmentId: otherDept.id } });
        expect((await give("managerB", "b1")).status).toBe(201);
        expect((await give("managerA", "b1")).status).toBe(403);
      } finally {
        await prisma.employeeJobHistory.updateMany({ where: { employeeId: p.b1.employeeId, effectiveTo: null }, data: { departmentId: org.departmentId } });
        await prisma.department.delete({ where: { id: otherDept.id } });
      }
    });

    it("someone with no manager gives up to the directors by default; set to Nobody, they reach nobody above", async () => {
      expect((await give("loner", "director")).status).toBe(201);
      expect((await give("loner", "b1")).status).toBe(403); // never across to another line
      await setSetting("badges.noManagerFallback", { upTo: "NOBODY" }, p.director, p.director2);
      expect((await give("loner", "director")).status).toBe(403);
      await setSetting("badges.noManagerFallback", { upTo: "DIRECTORS" }, p.director, p.director2);
    });

    it("a Wellsure Office member with \"Give badges\" has no extra reach (Stage 3)", async () => {
      expect((await give("member", "b1")).status).toBe(403);
      expect((await give("member", "director")).status).toBe(201); // up to the directors, like anyone with no manager
    });

    it("the picker lists only the people along the giver's line", async () => {
      const ids = (await get("a1", "/api/badges/recipients?q=")).body.map((x: { employeeId: string }) => x.employeeId);
      expect(ids).toEqual(expect.arrayContaining([p.a2.employeeId, p.a3.employeeId, p.managerA.employeeId, p.director.employeeId]));
      expect(ids).not.toContain(p.b1.employeeId);
      expect(ids).not.toContain(p.managerB.employeeId);
      expect((await get("developer", "/api/badges/recipients?q=")).body).toEqual([]);
    });
  });

  describe("limits, repeats, expiry, revoke", () => {
    it("the monthly limit per giver applies as set", async () => {
      await roomy();
      for (let i = 0; i < 3; i += 1) expect((await give("managerB", "b1")).status).toBe(201);
      const count = await prisma.badgeAward.count({ where: { giverUserId: p.managerB.userId, givenAt: { gte: monthStart() } } });
      await setSetting("badges.limits", { perGiverPerMonth: count, perPairPerMonth: 100 }, p.director, p.director2);
      const over = await give("managerB", "b1");
      expect(over.status).toBe(409);
      expect(over.body.error.code).toBe("LIMIT_REACHED");
      await roomy();
    });

    it("the pair limit holds under two simultaneous gives: exactly one wins", async () => {
      await setSetting("badges.limits", { perGiverPerMonth: 1000, perPairPerMonth: 1 }, p.director, p.director2);
      const before = await prisma.badgeAward.count({ where: { giverUserId: p.hr.userId, recipientEmployeeId: p.hrReport.employeeId, givenAt: { gte: monthStart() } } });
      if (before > 0) await setSetting("badges.limits", { perGiverPerMonth: 1000, perPairPerMonth: before + 1 }, p.director, p.director2);
      const [x, y] = await Promise.all([give("hr", "hrReport", { badgeCode: "DEMO_WEEK" }), give("hr", "hrReport", { badgeCode: "DEMO_MONTH" })]);
      expect([x.status, y.status].sort()).toEqual([201, 409]);
      expect(await prisma.badgeAward.count({ where: { giverUserId: p.hr.userId, recipientEmployeeId: p.hrReport.employeeId, givenAt: { gte: monthStart() } } })).toBe(before + 1);
      await roomy();
    });

    it("the monthly limit holds under simultaneous gives to different people", async () => {
      const used = await prisma.badgeAward.count({ where: { giverUserId: p.director2.userId, givenAt: { gte: monthStart() } } });
      await setSetting("badges.limits", { perGiverPerMonth: used + 1, perPairPerMonth: 100 }, p.director, p.director2);
      const res = await Promise.all((["a1", "a2", "a3", "b1"] as const).map((to) => give("director2", to)));
      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await prisma.badgeAward.count({ where: { giverUserId: p.director2.userId, givenAt: { gte: monthStart() } } })).toBe(used + 1);
      await roomy();
    });

    it("repeats: allowed by default; once the directors refuse them, the same giver cannot give the same active badge to the same person again", async () => {
      expect((await give("a1", "a3", { badgeCode: "DEMO_MONTH" })).status).toBe(201);
      expect((await give("a1", "a3", { badgeCode: "DEMO_MONTH" })).status).toBe(201);
      await setSetting("badges.repeat", { allowed: false }, p.director, p.director2);
      const again = await give("a1", "a3", { badgeCode: "DEMO_MONTH" });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("REPEAT_NOT_ALLOWED");
      expect((await give("a1", "a3", { badgeCode: "DEMO_WEEK" })).status).toBe(201);
      await setSetting("badges.repeat", { allowed: true }, p.director, p.director2);
    });

    it("weekly and monthly items expire when their period ends in India time (fake clock); permanent ones stay", async () => {
      expect(expiryFor("WEEK", new Date("2030-01-09T06:00:00Z"))!.toISOString()).toBe("2030-01-13T18:29:59.999Z"); // Sunday 23:59:59.999 IST
      expect(expiryFor("MONTH", new Date("2030-01-09T06:00:00Z"))!.toISOString()).toBe("2030-01-31T18:29:59.999Z");
      expect(expiryFor("PERMANENT", new Date("2030-01-09T06:00:00Z"))).toBeNull();
      // The India boundary: Sunday 20:00 UTC is already Monday 01:30 IST, so a weekly badge given then lasts the whole next week.
      expect(expiryFor("WEEK", new Date("2030-01-13T20:00:00Z"))!.toISOString()).toBe("2030-01-20T18:29:59.999Z");
      // 31 Jan 19:00 UTC is 1 Feb 00:30 IST: a monthly badge then is February's.
      expect(expiryFor("MONTH", new Date("2030-01-31T19:00:00Z"))!.toISOString()).toBe("2030-02-28T18:29:59.999Z");
      expect(monthStart(new Date("2030-01-31T19:00:00Z")).toISOString()).toBe("2030-01-31T18:30:00.000Z");
      const director = directorActor(p.director);
      const meta = { actorUserId: p.director.userId, ipAddress: null, userAgent: null };
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2030-01-09T06:00:00Z") }); // a Wednesday
      try {
        for (const code of ["DEMO_WEEK", "DEMO_MONTH", "DEMO_FOREVER"]) await badgeService.give(director, { recipientEmployeeId: p.a3.employeeId, badgeCode: code, message: "DEMO fake clock", idempotencyKey: key() }, meta);
        const at = async () => (await badgeService.forPerson(director, p.a3.employeeId)).badges.filter((b) => b.givenAt.startsWith("2030-01-09")).map((b) => b.badgeCode).sort();
        expect(await at()).toEqual(["DEMO_FOREVER", "DEMO_MONTH", "DEMO_WEEK"]);
        vi.setSystemTime(new Date("2030-01-13T18:29:00Z")); // Sunday 23:59 IST: still this week
        expect(await at()).toEqual(["DEMO_FOREVER", "DEMO_MONTH", "DEMO_WEEK"]);
        vi.setSystemTime(new Date("2030-01-13T18:31:00Z")); // Monday 00:01 IST
        expect(await at()).toEqual(["DEMO_FOREVER", "DEMO_MONTH"]);
        vi.setSystemTime(new Date("2030-01-31T18:29:00Z")); // 31 Jan 23:59 IST: still January
        expect(await at()).toEqual(["DEMO_FOREVER", "DEMO_MONTH"]);
        vi.setSystemTime(new Date("2030-01-31T18:31:00Z")); // 1 Feb 00:01 IST
        expect(await at()).toEqual(["DEMO_FOREVER"]);
        const counts = (await badgeService.allCounts(director)).counts[p.a3.employeeId] ?? 0;
        const permanent = await prisma.badgeAward.count({ where: { recipientEmployeeId: p.a3.employeeId, expiresAt: null, revocation: null } });
        expect(counts).toBe(permanent); // the directory count drops expired badges too
      } finally {
        vi.useRealTimers();
      }
    });

    it("directors revoke any badge with a reason (audited); nobody else can, the giver included", async () => {
      const given = await give("managerA", "a1");
      expect((await post("managerA", `/api/badges/${given.body.id}/revoke`, { reason: "given by mistake" })).status).toBe(403);
      expect((await post("hr", `/api/badges/${given.body.id}/revoke`, { reason: "given by mistake" })).status).toBe(403);
      expect((await post("director", `/api/badges/${given.body.id}/revoke`, {})).status).toBe(400);
      expect((await post("director", `/api/badges/${given.body.id}/revoke`, { reason: "DEMO: given by mistake" })).status).toBe(200);
      expect((await post("director", `/api/badges/${given.body.id}/revoke`, { reason: "again" })).body).toMatchObject({ repeated: true });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: given.body.id, action: "badges.revoked" } });
      expect(audit.actorUserId).toBe(p.director.userId);
      expect(audit.after).toMatchObject({ reason: "DEMO: given by mistake" });
      await expect(prisma.badgeRevocation.deleteMany({ where: { awardId: given.body.id } })).rejects.toThrow(/PEEPS_APPEND_ONLY/);
    });

    it("every give is audited with ids only (never the reason)", async () => {
      const given = await give("managerA", "a2", { message: "DEMO-REASON-MARKER for the audit check" });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: given.body.id, action: "badges.given" } });
      expect(JSON.stringify(audit)).not.toContain("DEMO-REASON-MARKER");
    });

    it("issuing twice with the same key gives one badge, also when the two calls race", async () => {
      const k = key();
      const [x, y] = await Promise.all([give("managerA", "a2", { idempotencyKey: k }), give("managerA", "a2", { idempotencyKey: k })]);
      expect([x.status, y.status].sort()).toEqual([200, 201]);
      expect(x.body.id).toBe(y.body.id);
      const { repeated: _first, ...first } = x.body;
      const { repeated: _second, ...second } = y.body;
      expect(first).toEqual(second);
      expect(await prisma.badgeAward.count({ where: { giverUserId: p.managerA.userId, idempotencyKey: k } })).toBe(1);
    });

    it.each(['P2002', 'P2034'] as const)('badge same-key race returns the winner for %s', async (code) => {
      const k = key();
      const [x, y] = await withRaceConflict(code, () => Promise.all([give('managerA', 'a2', { idempotencyKey: k }), give('managerA', 'a2', { idempotencyKey: k })]));
      expect([x.status, y.status].sort()).toEqual([200, 201]);
      const { repeated: _first, ...first } = x.body;
      const { repeated: _second, ...second } = y.body;
      expect(first).toEqual(second);
      expect(await prisma.badgeAward.count({ where: { giverUserId: p.managerA.userId, idempotencyKey: k } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: x.body.id, action: 'badges.given' } })).toBe(1);
    });
  });

  describe("visibility", () => {
    it("every signed-in member of staff sees badges on profiles, the directory and the home page, with who gave it and why by default; the directors can hide those", async () => {
      for (const who of ["b1", "managerB", "hr", "loner"] as const) {
        const prof = await get(who, `/api/badges/people/${p.a1.employeeId}`);
        expect(prof.status, who).toBe(200);
        expect(prof.body.badges.length, who).toBeGreaterThan(0);
        expect(prof.body.badges.every((b: object) => "from" in b && "message" in b), who).toBe(true);
        expect((await get(who, "/api/badges/counts")).body.counts[p.a1.employeeId], who).toBeGreaterThan(0);
        expect((await get(who, "/api/badges/recent")).body.length, who).toBeGreaterThan(0);
      }
      await setSetting("badges.publicDetails", { giver: false, reason: false }, p.director, p.director2);
      const hidden = (await get("b1", `/api/badges/people/${p.a1.employeeId}`)).body.badges;
      expect(hidden.every((b: object) => !("from" in b) && !("message" in b))).toBe(true);
      const mine = (await get("a1", "/api/badges/mine")).body as Array<{ from?: string; message?: string; givenAt: string }>;
      expect(mine.every((b) => typeof b.from === "string" && typeof b.message === "string")).toBe(true); // the recipient always sees who gave it and why
      await setSetting("badges.publicDetails", { giver: true, reason: true }, p.director, p.director2);
    });

    it("the recipient sees a director's badge with the director's name (who gave each)", async () => {
      const given = await give("director", "b1", { badgeCode: "DEMO_WEEK" });
      const mine = (await get("b1", "/api/badges/mine")).body as Array<{ id: string; from: string }>;
      const name = (await prisma.employeeNameHistory.findFirstOrThrow({ where: { employeeId: p.director.employeeId, effectiveTo: null } })).fullName;
      expect(mine.find((b) => b.id === given.body.id)?.from).toBe(name);
    });

    it("nobody outside: signed out 401, the Developer 403", async () => {
      for (const path of [`/api/badges/people/${p.a1.employeeId}`, "/api/badges/counts", "/api/badges/recent", "/api/badges/mine"]) expect((await request(app).get(path)).status, path).toBe(401);
      for (const path of [`/api/badges/people/${p.a1.employeeId}`, "/api/badges/counts", "/api/badges/recent"]) expect((await get("developer", path)).status, path).toBe(403);
    });

    it("a badge reaches only the recipient's own room, with a generic notification", async () => {
      const events: Array<{ room: string; event: string; args: unknown[] }> = [];
      const fake: RoomEmitter = { to: (room) => ({ emit: (event: string, ...args: unknown[]) => events.push({ room: String(room), event, args }) }) };
      setSocketServer(fake);
      try {
        expect((await give("managerA", "a1", { message: "DEMO-PRIVATE-WORD in the reason" })).status).toBe(201);
      } finally {
        setSocketServer(null);
      }
      expect(events.map((e) => [e.room, e.event])).toEqual([[`user:${p.a1.employeeId}`, "notification.new"]]);
      expect(JSON.stringify(events)).not.toContain("DEMO-PRIVATE-WORD");
    });

    it("the reason never reaches the logs", async () => {
      const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
      const lines: string[] = [];
      const original = stream.write.bind(stream);
      stream.write = (line: string) => {
        lines.push(String(line));
        return original(line);
      };
      try {
        await give("managerA", "a2", { message: "DEMO-LOG-MARKER reason" });
        logger.info({ probe: "badge-log-check" }, "probe");
      } finally {
        stream.write = original;
      }
      expect(lines.join("\n")).toContain("badge-log-check");
      expect(lines.join("\n")).not.toContain("DEMO-LOG-MARKER");
    });
  });
});
