import request from "supertest";
import pino from "pino";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRIVATE_NOTICE } from "@shared/constants/peeps";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { appoint, clearPeepsSettings, directorActor, setSetting } from "../../peeps/__tests__/peepsTestKit";
import * as badgeService from "../badges";
import { expiryFor, monthStart } from "../common";

// Badges and cheers follow the reporting line (D-36): downward to anyone below the giver, upward along their chain to the directors, directors to
// anyone, Wellsure Office members to anyone only when allowed; never to peers or another line; the Developer never. Corrective notes (D-37): the
// directors only, behind a switch, and never on a public surface. Plus limits, repeats, expiry, revoke, visibility and idempotent issue.

type Who =
  | "director" | "director2" | "managerA" | "a1" | "a2" | "a3" | "managerB" | "b1" | "hr" | "hrReport" | "loner" | "member" | "developer";
type Person = { employeeId: string; employeeCode: string; userId: string };
const MARKER = `corrective-marker-${Date.now()}`;
let seq = 0;
const key = () => `test-key-${Date.now()}-${(seq += 1)}`;
const CATALOGUE = [
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

describe("badges, cheers and corrective notes", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  const get = (who: Who, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const post = (who: Who, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body);
  const give = (who: Who, to: Who, extra: object = {}) => post(who, "/api/badges", { recipientEmployeeId: p[to].employeeId, badgeCode: "DEMO_FOREVER", idempotencyKey: key(), ...extra });
  const note = (who: Who, to: Who) => post(who, "/api/nudges", { recipientEmployeeId: p[to].employeeId, body: `${MARKER} please`, idempotencyKey: key() });

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
    const nudgeIds = (await prisma.privateNudge.findMany({ where: { recipientEmployeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    const changeIds = (await prisma.officeMembershipChange.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((c) => c.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...awardIds, ...nudgeIds, ...changeIds, "badges.catalogue"] } });
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("Not set until the directors set it", () => {
    it("without the catalogue nobody gives, directors included; the starter catalogue is a director's one click, entered for a second director to confirm, never preloaded", async () => {
      expect((await give("director", "a1")).status).toBe(409);
      expect((await post("managerA", "/api/badges/catalogue/starter")).status).toBe(403);
      const loaded = await post("director", "/api/badges/catalogue/starter");
      expect(loaded.status).toBe(201);
      expect(loaded.body.pending.version).toBeGreaterThan(0);
      expect((await get("a1", "/api/badges/status")).body.active).toBe(false); // entered, not confirmed: still Not set
      expect(await prisma.auditLog.count({ where: { action: "badges.catalogue.starter_loaded", actorUserId: p.director.userId } })).toBe(1);
      // The owners choose their own catalogue (this test's DEMO set) through the normal two-director setting.
      await setSetting("badges.catalogue", CATALOGUE, p.director, p.director2);
      expect((await get("a1", "/api/badges/status")).body.active).toBe(true);
    });
  });

  describe("who may give: the reporting line (D-36)", () => {
    it("downward to anyone below, upward along the chain to a director; never a peer or another line; directors to anyone", async () => {
      const allowed: Array<[Who, Who]> = [["managerA", "a1"], ["managerA", "a2"], ["a1", "a2"], ["a2", "a1"], ["a2", "managerA"], ["a2", "director"], ["managerA", "director"], ["director", "b1"], ["director", "loner"], ["hr", "hrReport"], ["hr", "director"], ["hrReport", "hr"]];
      for (const [from, to] of allowed) expect((await give(from, to)).status, `${from} → ${to}`).toBe(201);
      const refused: Array<[Who, Who]> = [["managerA", "b1"], ["managerA", "managerB"], ["a2", "a3"], ["a1", "b1"], ["b1", "a1"], ["b1", "managerA"], ["hr", "b1"], ["hr", "a1"], ["hrReport", "b1"], ["member", "b1"], ["developer", "a1"], ["developer", "director"]];
      for (const [from, to] of refused) expect((await give(from, to)).status, `${from} → ${to}`).toBe(403);
      expect((await give("a1", "a1")).status).toBe(409); // never yourself
    });

    it("a manager of one department cannot give to another department's people, even when the line is the same shape", async () => {
      // managerB's report moves to another department: still in managerB's line, so managerB may give; managerA may not, whatever the department.
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

    it("someone with no manager reaches nobody above while the fallback is Not set; set to the directors, they may give upward", async () => {
      expect((await give("loner", "director")).status).toBe(403);
      await setSetting("badges.noManagerFallback", { upTo: "DIRECTORS" }, p.director, p.director2);
      expect((await give("loner", "director")).status).toBe(201);
      expect((await give("loner", "b1")).status).toBe(403); // still not across to another line
      await setSetting("badges.noManagerFallback", { upTo: "NOBODY" }, p.director, p.director2);
      expect((await give("loner", "director")).status).toBe(403);
    });

    it("a Wellsure Office member gives to anyone only while the directors allow it", async () => {
      expect((await give("member", "b1")).status).toBe(403);
      await setSetting("audience.badges", { officeGivesToAnyone: true }, p.director, p.director2);
      expect((await give("member", "b1")).status).toBe(201);
      await setSetting("audience.badges", { officeGivesToAnyone: false }, p.director, p.director2);
      expect((await give("member", "b1")).status).toBe(403);
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
    it("the monthly limit applies only when set", async () => {
      for (let i = 0; i < 3; i += 1) expect((await give("managerB", "b1")).status).toBe(201); // Not set: no limit
      const count = await prisma.badgeAward.count({ where: { giverUserId: p.managerB.userId, givenAt: { gte: monthStart() } } });
      await setSetting("badges.limits", { perGiverPerMonth: count }, p.director, p.director2);
      const over = await give("managerB", "b1");
      expect(over.status).toBe(409);
      expect(JSON.stringify(over.body)).toContain("LIMIT_REACHED");
      await setSetting("badges.limits", { perGiverPerMonth: 1000 }, p.director, p.director2);
    });

    it("repeats: allowed while Not set; once the directors refuse them, the same giver cannot give the same active badge to the same person again", async () => {
      expect((await give("a1", "a3", { badgeCode: "DEMO_MONTH" })).status).toBe(201);
      expect((await give("a1", "a3", { badgeCode: "DEMO_MONTH" })).status).toBe(201);
      await setSetting("badges.repeat", { allowed: false }, p.director, p.director2);
      const again = await give("a1", "a3", { badgeCode: "DEMO_MONTH" });
      expect(again.status).toBe(409);
      expect(JSON.stringify(again.body)).toContain("REPEAT_NOT_ALLOWED");
      expect((await give("a1", "a3", { badgeCode: "DEMO_WEEK" })).status).toBe(201); // another badge is fine
      await setSetting("badges.repeat", { allowed: true }, p.director, p.director2);
    });

    it("weekly and monthly items expire when their period ends (fake clock); permanent ones stay", async () => {
      expect(expiryFor("WEEK", new Date("2030-01-09T06:00:00Z"))!.toISOString()).toBe("2030-01-13T18:29:59.999Z"); // Sunday 23:59:59.999 IST
      expect(expiryFor("MONTH", new Date("2030-01-09T06:00:00Z"))!.toISOString()).toBe("2030-01-31T18:29:59.999Z");
      expect(expiryFor("PERMANENT", new Date("2030-01-09T06:00:00Z"))).toBeNull();
      const director = directorActor(p.director);
      const meta = { actorUserId: p.director.userId, ipAddress: null, userAgent: null };
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2030-01-09T06:00:00Z") }); // a Wednesday
      try {
        for (const code of ["DEMO_WEEK", "DEMO_MONTH", "DEMO_FOREVER"]) await badgeService.give(director, { recipientEmployeeId: p.a3.employeeId, badgeCode: code, idempotencyKey: key() }, meta);
        const at = async () => (await badgeService.forPerson(director, p.a3.employeeId)).badges.filter((b) => b.givenAt.startsWith("2030-01-09")).map((b) => b.badgeCode).sort();
        expect(await at()).toEqual(["DEMO_FOREVER", "DEMO_MONTH", "DEMO_WEEK"]);
        vi.setSystemTime(new Date("2030-01-13T18:29:00Z")); // Sunday 23:59 IST: still this week
        expect(await at()).toEqual(["DEMO_FOREVER", "DEMO_MONTH", "DEMO_WEEK"]);
        vi.setSystemTime(new Date("2030-01-13T18:31:00Z")); // Monday 00:01 IST
        expect(await at()).toEqual(["DEMO_FOREVER", "DEMO_MONTH"]);
        vi.setSystemTime(new Date("2030-02-01T00:00:00Z")); // 1 Feb, 05:30 IST
        expect(await at()).toEqual(["DEMO_FOREVER"]);
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
    it("every signed-in member of staff sees badges on profiles, the directory and the home page; the giver and message only when the directors say so", async () => {
      for (const who of ["b1", "managerB", "hr", "loner"] as const) {
        const prof = await get(who, `/api/badges/people/${p.a1.employeeId}`);
        expect(prof.status, who).toBe(200);
        expect(prof.body.badges.length, who).toBeGreaterThan(0);
        expect(prof.body.badges.every((b: object) => !("from" in b) && !("message" in b)), who).toBe(true);
        expect((await get(who, "/api/badges/counts")).body.counts[p.a1.employeeId], who).toBeGreaterThan(0);
        expect((await get(who, "/api/badges/recent")).body.length, who).toBeGreaterThan(0);
      }
      await setSetting("badges.publicDetails", { giver: true, reason: false }, p.director, p.director2);
      const shown = (await get("b1", `/api/badges/people/${p.a1.employeeId}`)).body.badges;
      expect(shown.every((b: object) => "from" in b && !("message" in b))).toBe(true);
      const mine = (await get("a1", "/api/badges/mine")).body;
      expect(mine.some((b: { from?: string }) => typeof b.from === "string")).toBe(true); // the recipient always sees who gave it
    });

    it("nobody outside: signed out 401, the Developer 403", async () => {
      for (const path of [`/api/badges/people/${p.a1.employeeId}`, "/api/badges/counts", "/api/badges/recent", "/api/badges/mine"]) expect((await request(app).get(path)).status, path).toBe(401);
      for (const path of [`/api/badges/people/${p.a1.employeeId}`, "/api/badges/counts", "/api/badges/recent"]) expect((await get("developer", path)).status, path).toBe(403);
    });

    it("a badge reaches only the recipient's own room, with a generic notification", async () => {
      const events: Array<{ room: string; event: string }> = [];
      const fake: RoomEmitter = { to: (room) => ({ emit: (event: string) => events.push({ room: String(room), event }) }) };
      setSocketServer(fake);
      try {
        expect((await give("managerA", "a1", { message: "a private word" })).status).toBe(201);
      } finally {
        setSocketServer(null);
      }
      expect(events.map((e) => [e.room, e.event])).toEqual([[`user:${p.a1.employeeId}`, "notification.new"]]);
    });
  });

  describe("corrective notes (D-37)", () => {
    it("switched off until the directors switch them on; then only directors send them", async () => {
      expect((await note("director", "a1")).status).toBe(409);
      await setSetting("nudges.enabled", { enabled: true }, p.director, p.director2);
      expect((await note("director", "a1")).status).toBe(201);
      for (const who of ["managerA", "hr", "member", "a2", "developer"] as const) expect((await note(who, "a1")).status, who).toBe(403);
      await setSetting("audience.badges", { officeGivesToAnyone: true }, p.director, p.director2); // widening badges never widens notes
      expect((await note("member", "a1")).status).toBe(403);
      await setSetting("audience.badges", { officeGivesToAnyone: false }, p.director, p.director2);
    });

    it('two identical corrective-note requests racing create one record and return the same note', async () => {
      const k = key();
      const body = { recipientEmployeeId: p.a2.employeeId, body: `${MARKER} DEMO note`, idempotencyKey: k };
      const [x, y] = await Promise.all([post('director', '/api/nudges', body), post('director', '/api/nudges', body)]);
      expect([x.status, y.status].sort()).toEqual([200, 201]);
      const { repeated: _first, ...first } = x.body;
      const { repeated: _second, ...second } = y.body;
      expect(first).toEqual(second);
      expect(await prisma.privateNudge.count({ where: { senderUserId: p.director.userId, idempotencyKey: k } })).toBe(1);
    });

    it.each(['P2002', 'P2034'] as const)('corrective-note same-key race returns the winner for %s', async (code) => {
      const k = key();
      const body = { recipientEmployeeId: p.a2.employeeId, body: `${MARKER} DEMO note`, idempotencyKey: k };
      const [x, y] = await withRaceConflict(code, () => Promise.all([post('director', '/api/nudges', body), post('director', '/api/nudges', body)]));
      expect([x.status, y.status].sort()).toEqual([200, 201]);
      const { repeated: _first, ...first } = x.body;
      const { repeated: _second, ...second } = y.body;
      expect(first).toEqual(second);
      expect(await prisma.privateNudge.count({ where: { senderUserId: p.director.userId, idempotencyKey: k } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: x.body.id, action: 'nudges.sent' } })).toBe(1);
    });

    it("read by the sender, the recipient and the directors only (a director opening someone else's is audited)", async () => {
      const sent = await note("director2", "a2");
      const id = sent.body.id as string;
      expect((await get("a2", "/api/nudges/mine")).body.some((n: { id: string; body: string }) => n.id === id && n.body.includes(MARKER))).toBe(true);
      for (const who of ["a1", "managerA", "hr", "member", "developer"] as const) expect((await get(who, `/api/nudges/${id}`)).status, who).toBe(404);
      const before = await prisma.auditLog.count({ where: { action: "peeps.director.opened", entityId: id } });
      expect((await get("director", `/api/nudges/${id}`)).status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: "peeps.director.opened", entityId: id } })).toBe(before + 1);
    });

    it("no corrective note ever appears on a public surface: profiles, the directory, badge counts, the home page, the feed, search", async () => {
      await note("director", "b1");
      const probes: Array<[Who, string]> = [
        ["a1", `/api/badges/people/${p.b1.employeeId}`],
        ["a1", "/api/badges/recent"],
        ["a1", "/api/badges/counts"],
        ["a1", `/api/people/${p.b1.employeeId}`],
        ["a1", "/api/people?pageSize=100"],
        ["a1", `/api/people?search=${MARKER}`],
        ["a1", "/api/engage/posts"],
        ["managerB", "/api/tasks/mine"],
        ["hr", "/api/admin/dashboard"],
      ];
      const noteIds = (await prisma.privateNudge.findMany({ where: { recipientEmployeeId: p.b1.employeeId }, select: { id: true } })).map((n) => n.id);
      for (const [who, path] of probes) {
        const text = JSON.stringify((await get(who, path)).body);
        expect(text.includes(MARKER), `${who} ${path}`).toBe(false);
        for (const id of noteIds) expect(text.includes(id), `${who} ${path}`).toBe(false);
      }
      const recentCount = (await get("a1", "/api/badges/recent")).body.length;
      expect(recentCount).toBeLessThanOrEqual(20);
    });

    it("never in notification text, logs, audit rows or sockets beyond the recipient's generic notice", async () => {
      const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
      const lines: string[] = [];
      const original = stream.write.bind(stream);
      stream.write = (line: string) => {
        lines.push(String(line));
        return original(line);
      };
      const events: Array<{ room: string; event: string; args: unknown[] }> = [];
      setSocketServer({ to: (room) => ({ emit: (event: string, ...args: unknown[]) => events.push({ room: String(room), event, args }) }) });
      let id = "";
      try {
        const sent = await note("director", "a3");
        id = sent.body.id;
        await get("a3", "/api/nudges/mine");
        logger.info({ probe: "note-log-check" }, "probe");
      } finally {
        stream.write = original;
        setSocketServer(null);
      }
      expect(lines.join("\n")).toContain("note-log-check");
      expect(lines.join("\n")).not.toContain(MARKER);
      expect(events.map((e) => [e.room, e.event])).toEqual([[`user:${p.a3.employeeId}`, "notification.new"]]);
      expect(JSON.stringify(events)).toContain(PRIVATE_NOTICE.title);
      expect(JSON.stringify(events)).not.toContain(MARKER);
      expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: id } }))).not.toContain(MARKER);
      const stored = await prisma.privateNudge.findUniqueOrThrow({ where: { id } });
      expect(Buffer.from(stored.bodyEncrypted).toString("utf8")).not.toContain(MARKER);
    });
  });
});
