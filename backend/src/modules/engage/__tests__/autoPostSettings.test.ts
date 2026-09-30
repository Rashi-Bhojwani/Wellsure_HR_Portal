import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  authHeader,
  cleanupAutoPostSetting,
  cleanupDailyRunHourSetting,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "./engageTestHelpers";

describe("Engage — auto-post settings (engage.autopost.manage)", () => {
  let org: TestOrgMasters;
  let tokenEmployee: string;
  let tokenAdmin: string;
  const employeeIds: string[] = [];

  afterAll(async () => {
    await cleanupAutoPostSetting("BIRTHDAY");
    await cleanupAutoPostSetting("JOINING");
    await cleanupAutoPostSetting("ANNIVERSARY");
    await cleanupDailyRunHourSetting();
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("blocks a plain employee from viewing or changing settings", async () => {
    org = await createEmployeeTestOrgMasters();
    const emp = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(emp.employeeId);
    tokenEmployee = await loginAs(emp.employeeCode);

    const admin = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(admin.employeeId);
    tokenAdmin = await loginAs(admin.employeeCode);

    const getRes = await request(app).get("/api/engage/autopost-settings").set(...authHeader(tokenEmployee));
    expect(getRes.status).toBe(403);

    const patchRes = await request(app)
      .patch("/api/engage/autopost-settings/BIRTHDAY")
      .set(...authHeader(tokenEmployee))
      .send({ enabled: false });
    expect(patchRes.status).toBe(403);
  });

  it("lists the 3-row closed catalog with defensive defaults when unconfigured", async () => {
    const res = await request(app).get("/api/engage/autopost-settings").set(...authHeader(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.settings).toHaveLength(3);
    expect(res.body.settings.map((s: { kind: string }) => s.kind).sort()).toEqual(["ANNIVERSARY", "BIRTHDAY", "JOINING"]);
    expect(res.body.settings.every((s: { enabled: boolean }) => s.enabled === true)).toBe(true);
    expect(res.body.dailyRunHour).toBe(8); // spec §8's daily 08:00 default
  });

  it("updates a kind's template and enabled flag", async () => {
    const res = await request(app)
      .patch("/api/engage/autopost-settings/BIRTHDAY")
      .set(...authHeader(tokenAdmin))
      .send({ template: "Happy birthday {name}!", enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.template).toBe("Happy birthday {name}!");
    expect(res.body.enabled).toBe(false);

    const listRes = await request(app).get("/api/engage/autopost-settings").set(...authHeader(tokenAdmin));
    const birthday = listRes.body.settings.find((s: { kind: string }) => s.kind === "BIRTHDAY");
    expect(birthday.template).toBe("Happy birthday {name}!");
    expect(birthday.enabled).toBe(false);
  });

  it("updates the shared daily run hour, validated to 0-23", async () => {
    const res = await request(app)
      .put("/api/engage/autopost-settings/daily-run-hour")
      .set(...authHeader(tokenAdmin))
      .send({ dailyRunHour: 6 });
    expect(res.status).toBe(200);
    expect(res.body.dailyRunHour).toBe(6);

    const badRes = await request(app)
      .put("/api/engage/autopost-settings/daily-run-hour")
      .set(...authHeader(tokenAdmin))
      .send({ dailyRunHour: 25 });
    expect(badRes.status).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/engage/autopost-settings");
    expect(res.status).toBe(401);
  });
});
