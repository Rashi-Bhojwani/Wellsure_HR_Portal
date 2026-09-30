import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { getActiveAnnouncementForEmployee } from "../service";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../leave/__tests__/leaveTestHelpers";

const TODAY = new Date();
function isoDaysFrom(offset: number): string {
  return new Date(TODAY.getTime() + offset * 86400000).toISOString().slice(0, 10);
}

// Announcements (spec §6/§7.7 Home banner) — precedence is explicit, not
// inferred: most-specific-scope-wins (ranked by count of non-null scope
// columns), ties broken by most recent activeFrom. Both rules get their
// own dedicated test, per the plan's own requirement.
describe("Announcements", () => {
  let org: TestOrgMasters;
  let employeeId: string;
  let employeeToken: string;
  const employeeIds: string[] = [];
  const announcementIds: string[] = [];

  afterAll(async () => {
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  afterEach(async () => {
    await prisma.announcement.deleteMany({ where: { id: { in: announcementIds } } });
    announcementIds.length = 0;
  });

  async function makeAnnouncement(data: {
    title: string;
    scopeLocationId?: string | null;
    scopeDepartmentId?: string | null;
    activeFrom: string;
  }) {
    const row = await prisma.announcement.create({
      data: {
        title: data.title,
        body: "body",
        scopeLocationId: data.scopeLocationId ?? null,
        scopeDepartmentId: data.scopeDepartmentId ?? null,
        activeFrom: new Date(data.activeFrom),
        activeTo: new Date(isoDaysFrom(30)),
        isActive: true,
        createdByUserId: "test-actor",
      },
    });
    announcementIds.push(row.id);
    return row;
  }

  it("most-specific scope wins: a both-scoped row beats an org-wide row", async () => {
    org = await createEmployeeTestOrgMasters();
    const emp = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeId = emp.employeeId;
    employeeIds.push(employeeId);
    employeeToken = await loginAs(emp.employeeCode);

    await makeAnnouncement({ title: "Org-wide", activeFrom: isoDaysFrom(-5) });
    await makeAnnouncement({
      title: "Both-scoped",
      scopeLocationId: org.locationId,
      scopeDepartmentId: org.departmentId,
      activeFrom: isoDaysFrom(-5),
    });

    const result = await getActiveAnnouncementForEmployee(employeeId);
    expect(result?.title).toBe("Both-scoped");
  });

  it("a one-scoped row beats an org-wide row but loses to a both-scoped row", async () => {
    await makeAnnouncement({ title: "Org-wide", activeFrom: isoDaysFrom(-5) });
    const oneScoped = await makeAnnouncement({ title: "Location-scoped", scopeLocationId: org.locationId, activeFrom: isoDaysFrom(-5) });

    let result = await getActiveAnnouncementForEmployee(employeeId);
    expect(result?.title).toBe("Location-scoped");

    await makeAnnouncement({
      title: "Both-scoped",
      scopeLocationId: org.locationId,
      scopeDepartmentId: org.departmentId,
      activeFrom: isoDaysFrom(-5),
    });
    result = await getActiveAnnouncementForEmployee(employeeId);
    expect(result?.title).toBe("Both-scoped");

    await prisma.announcement.delete({ where: { id: oneScoped.id } });
    announcementIds.splice(announcementIds.indexOf(oneScoped.id), 1);
  });

  it("equally-specific rows break the tie on most recent activeFrom", async () => {
    await makeAnnouncement({ title: "Older", scopeLocationId: org.locationId, activeFrom: isoDaysFrom(-10) });
    await makeAnnouncement({ title: "Newer", scopeLocationId: org.locationId, activeFrom: isoDaysFrom(-2) });

    const result = await getActiveAnnouncementForEmployee(employeeId);
    expect(result?.title).toBe("Newer");
  });

  it("a scoped row for a different location never matches", async () => {
    const otherLocation = await prisma.location.create({
      data: {
        code: `TEST-LOC-${Date.now()}`,
        name: `Other Test Location ${Date.now()}`,
        addressLine1: "Test address",
        city: "Test City",
        state: "Test State",
        pincode: "000000",
      },
    });
    await makeAnnouncement({ title: "Wrong location", scopeLocationId: otherLocation.id, activeFrom: isoDaysFrom(-1) });

    const result = await getActiveAnnouncementForEmployee(employeeId);
    expect(result?.title).not.toBe("Wrong location");

    // Deleting the branch directly is refused while an announcement is scoped
    // to it (RESTRICT, Phase 5 commit C — it used to SET NULL, silently
    // making the announcement org-wide). The cleanup engine removes the
    // scoped announcement with it.
    await deleteWithDependents("Location", [otherLocation.id]);
  });

  it("an expired or not-yet-active row never matches", async () => {
    await makeAnnouncement({ title: "Expired", activeFrom: isoDaysFrom(-30) });
    await prisma.announcement.updateMany({ where: { title: "Expired" }, data: { activeTo: new Date(isoDaysFrom(-1)) } });
    await makeAnnouncement({ title: "Future", activeFrom: isoDaysFrom(10) });

    const result = await getActiveAnnouncementForEmployee(employeeId);
    expect(result).toBeNull();
  });

  it("GET /api/announcements/active returns the resolved announcement for the caller", async () => {
    await makeAnnouncement({ title: "Visible now", activeFrom: isoDaysFrom(-1) });
    const res = await request(app).get("/api/announcements/active").set(...authHeader(employeeToken));
    expect(res.status).toBe(200);
    expect(res.body.announcement.title).toBe("Visible now");
  });

  describe("admin CRUD (announcements.manage)", () => {
    // HR_ADMIN, not a synthetic role: it already carries announcements.manage
    // from seed (prisma/seed.ts's HR_ADMIN_PERMS) — the same real-role
    // convention modules/leave/__tests__/adminGrants.test.ts uses, rather
    // than mutating a shared role's grants for the duration of this file.
    let managerToken: string;
    const roleTestEmployeeIds: string[] = [];

    afterAll(async () => {
      for (const id of [...roleTestEmployeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    });

    it("blocks a plain employee from creating an announcement", async () => {
      const res = await request(app)
        .post("/api/announcements")
        .set(...authHeader(employeeToken))
        .send({ title: "x", body: "y", activeFrom: isoDaysFrom(0), activeTo: isoDaysFrom(5) });
      expect(res.status).toBe(403);
    });

    it("lets a caller with announcements.manage create, list, update and delete", async () => {
      const manager = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
      roleTestEmployeeIds.push(manager.employeeId);
      managerToken = await loginAs(manager.employeeCode);

      const createRes = await request(app)
        .post("/api/announcements")
        .set(...authHeader(managerToken))
        .send({ title: "Managed", body: "body", activeFrom: isoDaysFrom(0), activeTo: isoDaysFrom(5) });
      expect(createRes.status).toBe(201);
      announcementIds.push(createRes.body.id);

      const listRes = await request(app).get("/api/announcements").set(...authHeader(managerToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.announcements.some((a: { title: string }) => a.title === "Managed")).toBe(true);

      const updateRes = await request(app)
        .patch(`/api/announcements/${createRes.body.id}`)
        .set(...authHeader(managerToken))
        .send({ isActive: false });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.isActive).toBe(false);

      const deleteRes = await request(app).delete(`/api/announcements/${createRes.body.id}`).set(...authHeader(managerToken));
      expect(deleteRes.status).toBe(204);
      announcementIds.splice(announcementIds.indexOf(createRes.body.id), 1);
    });

    it("rejects activeFrom after activeTo", async () => {
      const res = await request(app)
        .post("/api/announcements")
        .set(...authHeader(managerToken))
        .send({ title: "Bad range", body: "body", activeFrom: isoDaysFrom(5), activeTo: isoDaysFrom(0) });
      expect(res.status).toBe(400);
    });
  });
});
