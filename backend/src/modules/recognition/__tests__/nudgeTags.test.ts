import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_NUDGE_OFF_LIMITS_WORDS, DEFAULT_NUDGE_TAGS, NUDGE_LIFETIME_DAYS } from "@shared/constants/peeps";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { appoint, clearPeepsSettings, directorActor, setSetting } from "../../peeps/__tests__/peepsTestKit";
import { offLimitsWordIn } from "../../peeps/settingChecks";
import * as tagService from "../nudgeTags";
import { insertLegacyNoteFixture } from "../nudges";

// Peeps Stage 3, nudge tags: public light-hearted tags only the directors give (service and database), a week each, no free text, visible to everyone
// with the giver named; safeguards (director removal with a reason, the receiver's review request as a directors' task, off-limits words); never
// created by a system job. And the old private corrective notes: read-only, readable by the person concerned and the directors (audited), never
// written again.

type Who = "director" | "director2" | "manager" | "emp" | "other" | "hr" | "member" | "developer" | "former";
type Person = { employeeId: string; employeeCode: string; userId: string };
let seq = 0;
const key = () => `nudge-key-${Date.now()}-${(seq += 1)}`;
const NOTE_MARKER = `DEMO-LEGACY-NOTE-${Date.now()}`;

describe("nudge tags and read-only corrective notes", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  const get = (who: Who, url: string) => request(app).get(url).set(...authHeader(tok[who]));
  const post = (who: Who, url: string, body: object = {}) => request(app).post(url).set(...authHeader(tok[who])).send(body);
  const tag = (who: Who, to: Who, extra: object = {}) => post(who, "/api/nudges", { recipientEmployeeId: p[to].employeeId, tagCode: "SCROLL_MASTER", idempotencyKey: key(), ...extra });
  let noteId = "";

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.emp = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.other = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.member = await createFullTestEmployee(org);
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    p.former = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
    await prisma.user.update({ where: { id: p.former.userId }, data: { status: "DEACTIVATED" } });
    await prisma.employee.update({ where: { id: p.former.employeeId }, data: { status: "SEPARATED" } });
    await appoint(p.member.employeeId, ["SEND_NUDGES", "GIVE_BADGES"], p.director, p.director2);
    noteId = (await insertLegacyNoteFixture({ recipientEmployeeId: p.emp.employeeId, senderUserId: p.director.userId, body: `${NOTE_MARKER} an old private note`, idempotencyKey: key() })).id;
  });

  afterAll(async () => {
    vi.useRealTimers();
    setSocketServer(null);
    await clearPeepsSettings();
    const ids = Object.values(p).map((x) => x.employeeId);
    const awardIds = (await prisma.nudgeTagAward.findMany({ where: { recipientEmployeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    const changeIds = (await prisma.officeMembershipChange.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((c) => c.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...awardIds, ...changeIds, noteId, "nudges.catalogue"] } });
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("the default catalogue", () => {
    it("contains no tag about attendance, lateness, leaving early, missed work or performance, and every default tag passes the default off-limits words", () => {
      const forbidden = /late|tardy|absen|leave|early|attend|punch|miss|skip|bunk|lazy|slow|slack|idle|perform|poor|fail|warn|mistake|careless|sick|overtime|lop\b/i;
      for (const t of DEFAULT_NUDGE_TAGS) {
        expect(forbidden.test(t.label), t.label).toBe(false);
        expect(offLimitsWordIn(t.label, DEFAULT_NUDGE_OFF_LIMITS_WORDS), t.label).toBeNull();
      }
      expect(DEFAULT_NUDGE_TAGS.length).toBeGreaterThanOrEqual(5);
      expect(DEFAULT_NUDGE_TAGS.map((t) => t.label)).toEqual(expect.arrayContaining(["Chai Break Champ", "Scroll Master", "Snooze Mode", "Meeting Marathoner", "Coffee Refill Crew"]));
    });

    it("the off-limits check matches whole words in any case", () => {
      expect(offLimitsWordIn("Late Riser", ["late"])).toBe("late");
      expect(offLimitsWordIn("LATE-comer", ["late"])).toBe("late");
      expect(offLimitsWordIn("Chocolate Fan", ["late"])).toBeNull(); // not a whole word
    });
  });

  describe("giving", () => {
    it("only a director gives; never to oneself; no free text; a week each", async () => {
      const given = await tag("director", "emp");
      expect(given.status).toBe(201);
      expect(new Date(given.body.expiresAt).getTime() - new Date(given.body.givenAt).getTime()).toBe(NUDGE_LIFETIME_DAYS * 86_400_000);
      for (const who of ["manager", "emp", "other", "hr", "member", "developer"] as const) expect((await tag(who, "other")).status, who).toBe(403);
      expect((await tag("former", "other")).status).toBe(401);
      expect((await request(app).post("/api/nudges").send({})).status).toBe(401);
      expect((await tag("director", "director")).status).toBe(409);
      expect((await tag("director", "emp", { message: "free text" })).status).toBe(400);
      expect((await tag("director", "emp", { tagCode: "NOT_A_TAG" })).status).toBe(400);
      expect((await tag("director", "former")).status).toBe(404); // a former employee gets nothing
    });

    it("everyone signed in sees it (profile, counts, home), with the giver named; the receiver always sees who gave it", async () => {
      const given = await tag("director2", "other", { tagCode: "COFFEE_REFILL_CREW" });
      const name = (await prisma.employeeNameHistory.findFirstOrThrow({ where: { employeeId: p.director2.employeeId, effectiveTo: null } })).fullName;
      for (const who of ["emp", "manager", "hr", "member"] as const) {
        const prof = (await get(who, `/api/nudges/people/${p.other.employeeId}`)).body.tags as Array<{ id: string; from: string }>;
        expect(prof.find((t) => t.id === given.body.id)?.from, who).toBe(name);
        expect((await get(who, "/api/nudges/counts")).body.counts[p.other.employeeId], who).toBeGreaterThan(0);
        expect((await get(who, "/api/nudges/recent")).body.some((t: { id: string }) => t.id === given.body.id), who).toBe(true);
      }
      const mine = (await get("other", "/api/nudges/mine")).body as Array<{ id: string; from: string }>;
      expect(mine.find((t) => t.id === given.body.id)?.from).toBe(name);
      for (const url of [`/api/nudges/people/${p.other.employeeId}`, "/api/nudges/counts", "/api/nudges/recent", "/api/nudges/mine"]) {
        expect((await get("developer", url)).status, url).toBe(403);
        expect((await request(app).get(url)).status, url).toBe(401);
        expect((await get("former", url)).status, url).toBe(401);
      }
    });

    it("disappears after a week (fake clock)", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2031-03-03T06:00:00Z") });
      try {
        const g = await tagService.give(directorActor(p.director), { recipientEmployeeId: p.manager.employeeId, tagCode: "SNOOZE_MODE", idempotencyKey: key() }, { actorUserId: p.director.userId, ipAddress: null, userAgent: null });
        const shown = async () => (await tagService.forPerson(directorActor(p.director), p.manager.employeeId)).tags.some((t) => t.id === g.id);
        expect(await shown()).toBe(true);
        vi.setSystemTime(new Date("2031-03-10T05:59:00Z"));
        expect(await shown()).toBe(true);
        vi.setSystemTime(new Date("2031-03-10T06:01:00Z"));
        expect(await shown()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("one notification to the receiver's own room, generic", async () => {
      const events: Array<{ room: string; event: string; args: unknown[] }> = [];
      const fake: RoomEmitter = { to: (room) => ({ emit: (event: string, ...args: unknown[]) => events.push({ room: String(room), event, args }) }) };
      setSocketServer(fake);
      try {
        expect((await tag("director", "manager", { tagCode: "PLAYLIST_DJ" })).status).toBe(201);
      } finally {
        setSocketServer(null);
      }
      expect(events.map((e) => [e.room, e.event])).toEqual([[`user:${p.manager.employeeId}`, "notification.new"]]);
      expect(JSON.stringify(events)).not.toMatch(/Playlist|PLAYLIST/);
    });
  });

  describe("safeguards", () => {
    it("a director removes any nudge at once, with a reason (audited); nobody else can", async () => {
      const g = await tag("director", "emp", { tagCode: "EMOJI_ENTHUSIAST" });
      for (const who of ["emp", "manager", "hr", "member", "developer"] as const) expect((await post(who, `/api/nudges/${g.body.id}/remove`, { reason: "please remove" })).status, who).toBe(403);
      expect((await post("director2", `/api/nudges/${g.body.id}/remove`, {})).status).toBe(400);
      expect((await post("director2", `/api/nudges/${g.body.id}/remove`, { reason: "DEMO not appropriate" })).status).toBe(200);
      expect((await post("director2", `/api/nudges/${g.body.id}/remove`, { reason: "again" })).body).toMatchObject({ repeated: true });
      expect((await get("other", `/api/nudges/people/${p.emp.employeeId}`)).body.tags.some((t: { id: string }) => t.id === g.body.id)).toBe(false);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: g.body.id, action: "nudges.tag.removed" } });
      expect(audit.actorUserId).toBe(p.director2.userId);
      await expect(prisma.nudgeTagRemoval.deleteMany({ where: { awardId: g.body.id } })).rejects.toThrow(/PEEPS_APPEND_ONLY/);
    });

    it("the receiver asks for a review: a directors' task until a director keeps or removes it; nobody else may ask", async () => {
      const g = await tag("director", "emp", { tagCode: "MEETING_MARATHONER" });
      expect((await post("other", `/api/nudges/${g.body.id}/review`)).status).toBe(404);
      expect((await post("director", `/api/nudges/${g.body.id}/review`)).status).toBe(404);
      expect((await post("emp", `/api/nudges/${g.body.id}/review`)).status).toBe(200);
      expect((await post("emp", `/api/nudges/${g.body.id}/review`)).body).toMatchObject({ repeated: true });
      const taskIds = async (who: Who) => ((await get(who, "/api/tasks/mine")).body as Array<{ type: string; id: string; title: string; employeeName: string | null }>).filter((t) => t.type === "NUDGE_REVIEW");
      const dirTasks = await taskIds("director");
      expect(dirTasks.length).toBeGreaterThan(0);
      expect(dirTasks.every((t) => t.employeeName === null && !/meeting/i.test(t.title))).toBe(true); // the preview names no person and no tag
      for (const who of ["emp", "manager", "hr", "member"] as const) expect(await taskIds(who), who).toEqual([]);
      expect((await post("emp", `/api/nudges/${g.body.id}/review/decide`, { outcome: "KEPT" })).status).toBe(403);
      expect((await post("director2", `/api/nudges/${g.body.id}/review/decide`, { outcome: "REMOVED" })).status).toBe(400); // a reason is needed
      expect((await post("director2", `/api/nudges/${g.body.id}/review/decide`, { outcome: "KEPT" })).status).toBe(200);
      expect((await post("director2", `/api/nudges/${g.body.id}/review/decide`, { outcome: "KEPT" })).status).toBe(404); // already decided
      const mine = (await get("emp", "/api/nudges/mine")).body as Array<{ id: string; review: { outcome: string } | null }>;
      expect(mine.find((t) => t.id === g.body.id)?.review?.outcome).toBe("KEPT");
    });

    it("off-limits words block tag names, and a tag that later matches a new word can no longer be given", async () => {
      const refused = await post("director", "/api/peeps/settings/nudges.catalogue", { value: [...DEFAULT_NUDGE_TAGS, { code: "LATE_RISER", label: "Late Riser" }] });
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe("OFF_LIMITS_WORD");
      await setSetting("nudges.offLimitsWords", [...DEFAULT_NUDGE_OFF_LIMITS_WORDS, "chai"], p.director, p.director2);
      expect((await tag("director", "emp", { tagCode: "CHAI_BREAK_CHAMP" })).body.error.code).toBe("OFF_LIMITS_WORD");
      expect((await get("director", "/api/nudges/status")).body.tags.map((t: { code: string }) => t.code)).not.toContain("CHAI_BREAK_CHAMP");
      await setSetting("nudges.offLimitsWords", DEFAULT_NUDGE_OFF_LIMITS_WORDS, p.director, p.director2);
    });

    it("directors add, rename and retire tags; a given tag cannot be deleted, only retired", async () => {
      await tag("director", "emp", { tagCode: "DESK_PLANT_PARENT" });
      const next = DEFAULT_NUDGE_TAGS.map((t) => (t.code === "DESK_PLANT_PARENT" ? { ...t, label: "DEMO Plant Whisperer", retired: true } : t));
      await setSetting("nudges.catalogue", [...next, { code: "DEMO_KARAOKE_STAR", label: "DEMO Karaoke Star" }], p.director, p.director2);
      expect((await tag("director", "emp", { tagCode: "DESK_PLANT_PARENT" })).body.error.code).toBe("RETIRED");
      expect((await tag("director", "emp", { tagCode: "DEMO_KARAOKE_STAR" })).status).toBe(201);
      const dropped = await post("director", "/api/peeps/settings/nudges.catalogue", { value: next.filter((t) => t.code !== "DESK_PLANT_PARENT") });
      expect(dropped.body.error.code).toBe("RETIRE_INSTEAD");
      for (const a of ["nudges.catalogue.retired", "nudges.catalogue.renamed", "nudges.catalogue.added"]) expect(await prisma.auditLog.count({ where: { action: a } }), a).toBeGreaterThan(0);
    });
  });

  describe("never created by a system job", () => {
    it("the database refuses a nudge whose giver is not a director (a job, a manager, anyone)", async () => {
      await expect(prisma.nudgeTagAward.create({ data: { tagCode: "SCROLL_MASTER", recipientEmployeeId: p.emp.employeeId, giverUserId: p.manager.userId, idempotencyKey: key(), expiresAt: new Date(Date.now() + 86_400_000) } })).rejects.toThrow(/PEEPS_NUDGE_DIRECTORS_ONLY/);
      await expect(prisma.nudgeTagAward.create({ data: { tagCode: "SCROLL_MASTER", recipientEmployeeId: p.emp.employeeId, giverUserId: "system", idempotencyKey: key(), expiresAt: new Date(Date.now() + 86_400_000) } })).rejects.toThrow(/PEEPS_NUDGE_DIRECTORS_ONLY/);
    });

    it("the only code that writes a nudge is the director's give, reached from the route and the demo seed; no job, worker, scheduler or other module reaches it", () => {
      const root = path.resolve(__dirname, "../../..");
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const full = path.join(dir, f);
          if (statSync(full).isDirectory()) { if (f !== "__tests__" && f !== "node_modules") walk(full); }
          else if (f.endsWith(".ts")) files.push(full);
        }
      };
      walk(root);
      const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
      const writers = files.filter((f) => /nudgeTagAward\.(create|createMany|upsert)\b/.test(readFileSync(f, "utf8"))).map(rel);
      expect(writers).toEqual(["modules/recognition/nudgeTags.ts"]);
      const importers = files.filter((f) => /from ["'][./]*\/?(recognition\/)?nudgeTags["']/.test(readFileSync(f, "utf8"))).map(rel).sort();
      expect(importers).toEqual(["modules/recognition/controller.ts", "modules/recognition/demoSeed.ts", "modules/recognition/tasks.ts"]);
      expect(readFileSync(path.join(root, "modules/recognition/tasks.ts"), "utf8")).not.toMatch(/\bgive\b/);
      for (const f of files.filter((x) => rel(x).startsWith("jobs/"))) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/recognition/);
    });
  });

  describe("the old private corrective notes: read-only", () => {
    it("the person concerned and the directors read them (a director's open is audited); nobody else; reading writes nothing", async () => {
      const mine = (await get("emp", "/api/nudges/notes/mine")).body;
      expect(mine.readOnly).toBe(true);
      expect(mine.notes.some((n: { id: string; body: string }) => n.id === noteId && n.body.includes(NOTE_MARKER))).toBe(true);
      for (const who of ["other", "manager", "hr", "member"] as const) expect((await get(who, `/api/nudges/notes/${noteId}`)).status, who).toBe(404);
      expect((await get("developer", "/api/nudges/notes/mine")).status).toBe(403);
      expect((await get("former", "/api/nudges/notes/mine")).status).toBe(401);
      for (const who of ["emp", "manager", "hr", "member", "developer"] as const) expect((await get(who, "/api/nudges/notes/admin/all")).status, who).toBe(403);
      const before = await prisma.auditLog.count({ where: { action: "peeps.director.opened", entityId: noteId } });
      expect((await get("director2", `/api/nudges/notes/${noteId}`)).status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: "peeps.director.opened", entityId: noteId } })).toBe(before + 1);
      expect((await get("director2", "/api/nudges/notes/admin/all")).body.notes.some((n: { id: string }) => n.id === noteId)).toBe(true);
      expect(await prisma.nudgeRead.count({ where: { nudgeId: noteId } })).toBe(0);
    });

    it("no new note can be written: no route takes text, and the database refuses an insert", async () => {
      expect((await post("director", "/api/nudges", { recipientEmployeeId: p.emp.employeeId, body: "a new note", idempotencyKey: key() })).status).toBe(400);
      await expect(prisma.privateNudge.create({ data: { recipientEmployeeId: p.emp.employeeId, senderUserId: p.director.userId, senderKind: "DIRECTOR", bodyEncrypted: Buffer.from("x"), idempotencyKey: key() } })).rejects.toThrow(/PEEPS_NOTES_READ_ONLY/);
      await expect(prisma.nudgeRead.create({ data: { nudgeId: noteId } })).rejects.toThrow(/PEEPS_NOTES_READ_ONLY/);
      await expect(prisma.nudgeRevocation.create({ data: { nudgeId: noteId, revokedByUserId: p.director.userId, reason: "withdraw it" } })).rejects.toThrow(/PEEPS_NOTES_READ_ONLY/);
      await expect(prisma.privateNudge.deleteMany({ where: { id: noteId } })).rejects.toThrow(/PEEPS_APPEND_ONLY/);
    });

    it("a note's text never reaches a public surface, a task, the logs or a nudge response", async () => {
      const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
      const lines: string[] = [];
      const original = stream.write.bind(stream);
      stream.write = (line: string) => {
        lines.push(String(line));
        return original(line);
      };
      try {
        for (const [who, url] of [["other", `/api/nudges/people/${p.emp.employeeId}`], ["other", "/api/nudges/recent"], ["other", "/api/nudges/counts"], ["other", `/api/badges/people/${p.emp.employeeId}`], ["emp", "/api/nudges/mine"], ["director", "/api/nudges/admin/all"], ["director", "/api/tasks/mine"], ["manager", "/api/tasks/mine"], ["other", `/api/people?search=${NOTE_MARKER}`]] as const) {
          const text = JSON.stringify((await get(who, url)).body);
          expect(text.includes(NOTE_MARKER), `${who} ${url}`).toBe(false);
        }
        await get("emp", "/api/nudges/notes/mine");
        logger.info({ probe: "note-log-check" }, "probe");
      } finally {
        stream.write = original;
      }
      expect(lines.join("\n")).toContain("note-log-check");
      expect(lines.join("\n")).not.toContain(NOTE_MARKER);
    });
  });
});
