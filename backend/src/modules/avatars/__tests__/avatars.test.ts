import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIRECTORY_TOGGLEABLE_FIELDS } from "@shared/constants/peopleDocuments";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { getTeamEmployeeIds } from "../../../lib/dataScope";
import { PEOPLE_DOCUMENTS_SETTING_KEYS } from "../../../lib/peopleDocumentsSettings";
import { prisma } from "../../../lib/prisma";
import { setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { setSetting as setSystemSetting, snapshotPeopleDocumentsSettings } from "../../people/__tests__/peopleTestHelpers";
import { clearPeepsSettings, setSetting } from "../../peeps/__tests__/peepsTestKit";

// Avatars and the directory (Peeps, owner decisions D-28, D-29): only the owner adds, changes or removes their own photo; HR and the directors remove
// someone else's with a reason (audited) and never replace it; the directory shows contact fields only as the directors' setting allows (Not set = none),
// never personal email or any pay, bank, statutory, health or private Peeps data; badges show company-wide; department is not a team.

type Who = "director" | "director2" | "hrAdmin" | "hrExec" | "manager" | "report" | "employee" | "colleague" | "developer";
type Person = { employeeId: string; employeeCode: string; userId: string };

describe("avatars and directory", () => {
  let org: TestOrgMasters;
  let restoreSystemSettings: () => Promise<void>;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  let png: Buffer;
  const get = (who: Who, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const putPhoto = (who: Who, target: "me" | Who) =>
    request(app)
      .put(`/api/employees/${target === "me" ? "me" : p[target].employeeId}/photo`)
      .set(...authHeader(tok[who]))
      .attach("file", png, { filename: "a.png", contentType: "image/png" });
  const removeAs = (who: Who, target: Who, body: object = { reason: "not a photo of the person" }) => request(app).post(`/api/avatars/${p[target].employeeId}/remove`).set(...authHeader(tok[who])).send(body);
  const version = async (who: Who) => (await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: p[who].employeeId } })).photoVersion;

  beforeAll(async () => {
    restoreSystemSettings = await snapshotPeopleDocumentsSettings();
    png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 120, b: 120 } } }).png().toBuffer();
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.report = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.employee = await createFullTestEmployee(org);
    p.colleague = await createFullTestEmployee(org); // same department as the manager, not their report
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
  });

  afterAll(async () => {
    setSocketServer(null);
    await purgeAppendOnly("AuditLog", { entityId: { in: Object.values(p).map((x) => x.employeeId) } });
    await clearPeepsSettings();
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await restoreSystemSettings();
  });

  describe("photos: the owner's own", () => {
    it("an employee adds, changes and removes only their own photo; nobody else's, by either route", async () => {
      expect((await putPhoto("employee", "me")).status).toBe(200);
      const first = await version("employee");
      expect(first).not.toBeNull();
      expect((await putPhoto("employee", "me")).status).toBe(200);
      expect(await version("employee")).not.toBe(first);
      expect((await putPhoto("employee", "employee")).status).toBe(403); // the by-id route still needs employee.edit; an employee uses /me
      const other = await putPhoto("employee", "colleague");
      expect(other.status).toBe(403);
      expect(JSON.stringify(other.body)).toContain("PHOTO_OWNER_ONLY");
      expect((await request(app).delete(`/api/employees/${p.colleague.employeeId}/photo`).set(...authHeader(tok.employee))).status).toBe(403);
      expect((await request(app).delete("/api/employees/me/photo").set(...authHeader(tok.employee))).status).toBe(204);
      expect(await version("employee")).toBeNull();
    });

    it("an employee without a photo still has an avatar: the directory gives no photo version, so the screens draw their initials", async () => {
      const entry = await get("colleague", `/api/people/${p.employee.employeeId}`);
      expect(entry.status).toBe(200);
      expect(entry.body).toMatchObject({ name: expect.stringContaining("Test Employee"), photoVersion: null });
    });
  });

  describe("photos: HR and the directors remove, never replace", () => {
    it("HR (both roles) and a director cannot put a photo on someone else's profile, nor remove one without a reason", async () => {
      expect((await putPhoto("colleague", "me")).status).toBe(200);
      for (const who of ["hrAdmin", "hrExec", "director"] as const) {
        expect((await putPhoto(who, "colleague")).status, who).toBe(403);
        expect((await request(app).delete(`/api/employees/${p.colleague.employeeId}/photo`).set(...authHeader(tok[who]))).status, who).toBe(403);
        expect((await removeAs(who, "colleague", {})).status, who).toBe(400);
        expect((await removeAs(who, "colleague", { reason: " " })).status, who).toBe(400);
      }
      expect(await version("colleague")).not.toBeNull();
    });

    it("HR removes it with a reason: audited with the reason, the person told in general words, only their own room; again changes nothing", async () => {
      const before = await version("colleague");
      const events: Array<{ room: string; event: string; args: unknown[] }> = [];
      const fake: RoomEmitter = { to: (room) => ({ emit: (event: string, ...args: unknown[]) => events.push({ room: String(room), event, args }) }) };
      setSocketServer(fake);
      try {
        const res = await removeAs("hrExec", "colleague", { reason: "DEMO reason: not a photo of a person" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toEqual({ removed: true });
      } finally {
        setSocketServer(null);
      }
      expect(await version("colleague")).toBeNull();
      const audits = await prisma.auditLog.findMany({ where: { entityId: p.colleague.employeeId, actorUserId: p.hrExec.userId } });
      expect(audits.map((a) => a.action).sort()).toEqual(["peeps.avatar.removal_reason", "peeps.avatar.removed_by_moderator"]);
      expect(audits.find((a) => a.action === "peeps.avatar.removal_reason")!.after).toMatchObject({ reason: "DEMO reason: not a photo of a person", removedVersion: before });
      const note = await prisma.notification.findFirstOrThrow({ where: { userId: p.colleague.userId, type: "peeps.avatar.removed" } });
      expect(`${note.title} ${note.body}`).not.toContain("DEMO reason");
      expect(events.map((e) => e.room)).toEqual([`user:${p.colleague.employeeId}`]);
      expect((await removeAs("hrExec", "colleague")).body).toEqual({ removed: false });
    });

    it("a director removes one too; their own photo is theirs to change on their profile", async () => {
      expect((await putPhoto("report", "me")).status).toBe(200);
      expect((await removeAs("director", "report")).body).toEqual({ removed: true });
      expect((await removeAs("director", "director")).status).toBe(409);
    });

    it("an employee, a manager (even for their own report), the Developer and a signed-out caller cannot remove anyone's photo", async () => {
      expect((await putPhoto("report", "me")).status).toBe(200);
      for (const who of ["employee", "manager", "developer"] as const) expect((await removeAs(who, "report")).status, who).toBe(403);
      expect((await request(app).post(`/api/avatars/${p.report.employeeId}/remove`).send({ reason: "x x x" })).status).toBe(401);
      expect(await version("report")).not.toBeNull();
    });
  });

  describe("the directory", () => {
    const everything = async (who: Who) => {
      const [list, one, chart] = await Promise.all([get(who, `/api/people?search=${p.employee.employeeCode}`), get(who, `/api/people/${p.employee.employeeId}`), get(who, "/api/people/org-chart")]);
      for (const r of [list, one, chart]) expect(r.status).toBe(200);
      return { list: list.body, one: one.body, text: JSON.stringify([list.body, one.body, chart.body]) };
    };

    it("with the directors' contact-field setting Not set, no work email, phone or birthday shows, even with every System Settings toggle on", async () => {
      await setSystemSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.directoryVisibleFields, [...DIRECTORY_TOGGLEABLE_FIELDS]);
      const { one } = await everything("colleague");
      for (const field of ["officialEmail", "mobile", "birthday", "personalEmail"]) expect(one, field).not.toHaveProperty(field);
    });

    it("once set, exactly the chosen fields show; personal email never does", async () => {
      await setSetting("directory.contactFields", ["officialEmail", "birthday"], p.director, p.director2);
      const { one, text } = await everything("colleague");
      expect(one).toHaveProperty("officialEmail");
      expect(one.birthday).toMatch(/^\d{2}-\d{2}$/); // day and month, never the year
      expect(one).not.toHaveProperty("mobile");
      expect(one).not.toHaveProperty("personalEmail");
      expect(text).not.toContain("@gmail.com"); // the fixtures' personal email
      await setSetting("directory.contactFields", ["officialEmail", "mobile", "birthday"], p.director, p.director2);
      const all = (await everything("colleague")).one;
      expect(all).toHaveProperty("mobile");
      expect(all).not.toHaveProperty("personalEmail");
    });

    it("never carries pay, bank, statutory, health, address or private Peeps data, for anyone looking (a director included)", async () => {
      for (const who of ["colleague", "manager", "hrAdmin", "director"] as const) {
        const { text } = await everything(who);
        expect(text, who).not.toMatch(/salary|ctc|ifsc|accountNumber|bank|\bpan\b|aadhaar|\buan\b|\besi\b|bloodGroup|gender|address|emergency|nudge|booking|unmute|asset/i);
        expect(text, who).not.toContain("Test address");
      }
    });

    it("searches by name, code and department", async () => {
      const dept = await prisma.department.findUniqueOrThrow({ where: { id: org.departmentId } });
      const byDept = await get("colleague", `/api/people?search=${encodeURIComponent(dept.name)}&pageSize=100`);
      expect(byDept.body.items.map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining([p.employee.employeeId, p.manager.employeeId]));
      const name = (await prisma.employeeNameHistory.findFirstOrThrow({ where: { employeeId: p.employee.employeeId } })).fullName;
      expect((await get("colleague", `/api/people?search=${encodeURIComponent(name)}`)).body.items.map((e: { id: string }) => e.id)).toContain(p.employee.employeeId);
    });

    it("badges show company-wide: everyone's count in one request for the directory and the org chart; the Developer is refused", async () => {
      await setSetting("badges.catalogue", [{ code: "DEMO_THANKS", label: "DEMO Thank you" }], p.director, p.director2);
      expect((await request(app).post("/api/badges").set(...authHeader(tok.director)).send({ recipientEmployeeId: p.employee.employeeId, badgeCode: "DEMO_THANKS", idempotencyKey: `avatars-${Date.now()}` })).status).toBe(201);
      for (const who of ["colleague", "manager", "hrExec"] as const) expect((await get(who, "/api/badges/counts")).body.counts[p.employee.employeeId], who).toBe(1);
      expect((await get("developer", "/api/badges/counts")).status).toBe(403);
      expect((await request(app).get("/api/badges/counts")).status).toBe(401);
      expect(JSON.stringify((await get("colleague", "/api/badges/counts")).body)).not.toMatch(/message|from|giver/i);
    });

    it("department and reporting team are separate: a manager's team is their reports, not everyone in their department", async () => {
      const team = await getTeamEmployeeIds(p.manager.employeeId);
      expect(team).toContain(p.report.employeeId);
      expect(team).not.toContain(p.colleague.employeeId);
      expect(team).not.toContain(p.employee.employeeId);
    });
  });
});
