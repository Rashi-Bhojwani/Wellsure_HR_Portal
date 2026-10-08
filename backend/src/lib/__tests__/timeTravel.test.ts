import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { setBusinessTodayForTests } from "../businessDate";
import { getTeamEmployeeIds } from "../dataScope";
import { writeJobChange, writeNameChange } from "../effectiveDating";
import { deleteWithDependents } from "./cleanup";
import { grantManager } from "./testHelpers";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../modules/employee/__tests__/employeeTestHelpers";

// EF2: every read is "in force today". A change scheduled for D+7 is
// invisible before D+7 and in force from it — team scope (who a manager can
// see and approve), department filters, names — with "today" moved by the
// vitest-only clock.
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const D = "2026-03-02";
const D7 = "2026-03-09";

describe("time travel: scheduled changes take effect on their day, not before", () => {
  let org: TestOrgMasters;
  type Person = { employeeId: string; employeeCode: string; userId: string };
  const p = {} as Record<"hr" | "mgrA" | "mgrB" | "member", Person>;
  const tok = {} as Record<keyof typeof p, string>;
  let newDeptId = "";

  const get = (who: keyof typeof p, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const at = (iso: string) => setBusinessTodayForTests(day(iso));

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.mgrA = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.mgrB = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.member = await createFullTestEmployee(org, { managerId: p.mgrA.employeeId });
    for (const m of [p.mgrA, p.mgrB]) await grantManager(m.userId, ["employee.view"]);
    newDeptId = (await prisma.department.create({ data: { code: `TT-${Date.now()}`, name: `Time Travel ${Date.now()}` } })).id;
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);

    // On D, HR schedules for D+7: a move to manager B in the new department, and a new name.
    at(D);
    await prisma.$transaction((tx) =>
      writeJobChange(tx, p.member.employeeId, day(D7), { reportingManagerId: p.mgrB.employeeId, departmentId: newDeptId }, { createdByUserId: p.hr.userId, changeReason: "Transfer" }),
    );
    await prisma.$transaction((tx) => writeNameChange(tx, p.member.employeeId, day(D7), "Renamed Person", { createdByUserId: p.hr.userId, changeReason: "Marriage" }));
  });
  afterEach(() => setBusinessTodayForTests(null));
  afterAll(async () => {
    setBusinessTodayForTests(null);
    await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: [p.mgrA.userId, p.mgrB.userId] } } });
    for (const k of ["member", "mgrA", "mgrB", "hr"] as const) await cleanupFullTestEmployee(p[k].employeeId);
    await deleteWithDependents("Department", [newDeptId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("team scope: manager A until D+7, manager B from D+7", async () => {
    at(D);
    expect(await getTeamEmployeeIds(p.mgrA.employeeId)).toContain(p.member.employeeId);
    expect(await getTeamEmployeeIds(p.mgrB.employeeId)).not.toContain(p.member.employeeId);
    expect((await get("mgrA", `/api/employees/${p.member.employeeId}`)).status).toBe(200);
    expect((await get("mgrB", `/api/employees/${p.member.employeeId}`)).status).toBe(404);

    at("2026-03-08"); // the day before
    expect((await get("mgrB", `/api/employees/${p.member.employeeId}`)).status).toBe(404);

    at(D7);
    expect(await getTeamEmployeeIds(p.mgrB.employeeId)).toContain(p.member.employeeId);
    expect(await getTeamEmployeeIds(p.mgrA.employeeId)).not.toContain(p.member.employeeId);
    expect((await get("mgrB", `/api/employees/${p.member.employeeId}`)).status).toBe(200);
    expect((await get("mgrA", `/api/employees/${p.member.employeeId}`)).status).toBe(404);
  });

  it("department filter and name: the old ones until D+7, the new ones from D+7", async () => {
    const inNewDept = async () => ((await get("hr", `/api/employees?departmentId=${newDeptId}&pageSize=200`)).body.rows as Array<{ id: string }>).map((r) => r.id);
    const shownName = async () => ((await get("hr", `/api/employees?search=${p.member.employeeCode}&pageSize=10`)).body.rows as Array<{ id: string; fullName: string }>).find((r) => r.id === p.member.employeeId)?.fullName;

    at(D);
    expect(await inNewDept()).not.toContain(p.member.employeeId);
    expect(await shownName()).not.toBe("Renamed Person");
    at(D7);
    expect(await inNewDept()).toContain(p.member.employeeId);
    expect(await shownName()).toBe("Renamed Person");
  });

  it("a pre-joiner is named and in their manager's team from the day they're added", async () => {
    at(D);
    const res = await request(app)
      .post("/api/employees")
      .set(...authHeader(tok.hr))
      .send({
        official: {
          employeeCode: `TT${Date.now().toString().slice(-6)}`,
          deviceUserId: `TT${Date.now().toString().slice(-6)}`,
          dateOfJoining: "2026-04-01", // a month after "today"
          employmentType: "PERMANENT",
          departmentId: org.departmentId,
          designationId: org.designationId,
          locationId: org.locationId,
          reportingManagerId: p.mgrA.employeeId,
        },
        personal: {
          fullName: "Pre Joiner",
          dateOfBirth: "1995-05-05",
          gender: "FEMALE",
          personalEmail: `prejoiner.${Date.now()}@gmail.com`,
          mobile: "9876500011",
          currentAddress: "Somewhere",
          permanentAddress: "Somewhere",
          emergencyContactName: "Someone",
          emergencyContactPhone: "9876500012",
          emergencyContactRelation: "Parent",
        },
      });
    expect(res.status).toBe(201);
    const id = res.body.id ?? res.body.employee?.id;
    try {
      expect(await getTeamEmployeeIds(p.mgrA.employeeId)).toContain(id);
      const name = await prisma.employeeNameHistory.findFirstOrThrow({ where: { employeeId: id } });
      expect(name.effectiveFrom.toISOString().slice(0, 10)).toBe(D); // added on D, joins 1 Apr
    } finally {
      await cleanupFullTestEmployee(id);
    }
  });
});
