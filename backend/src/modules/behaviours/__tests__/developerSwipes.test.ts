import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// D-37 item 6 (docs/plans/D37_DEFAULTS.md): the Developer role does not see Employee Swipes by default; a director's switch, confirmed by a different director,
// turns it on; turning it off again takes it away. Made-up people only.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;

describe("D-37 item 6 — the Developer and Employee Swipes", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const swipes = (who: string) => request(app).get("/api/attendance/swipes?from=2026-09-01&to=2026-09-02").set(...authHeader(tok[who]!));
  const setSwitch = async (on: boolean) => {
    const prop = await request(app).post("/api/behaviours/access.developerSeesSwipes/proposals").set(...authHeader(tok.d1!)).send({ value: on, reason: "made up for a test" });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    expect((await request(app).post(`/api/behaviours/proposals/${prop.body.id}/confirm`).set(...authHeader(tok.d2!))).status).toBe(200);
  };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.d1 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.d2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
  }, 180_000);

  afterAll(async () => {
    await deleteWithDependents("BehaviourProposal", (await prisma.behaviourProposal.findMany({ where: { proposedByUserId: p.d1!.userId }, select: { id: true } })).map((x) => x.id));
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("by default the Developer is refused Employee Swipes (route and resolved access); HR still sees it", async () => {
    expect((await swipes("dev")).status).toBe(403);
    expect((await request(app).get("/api/attendance/swipes/export?from=2026-09-01&to=2026-09-02").set(...authHeader(tok.dev!))).status).toBe(403);
    expect((await resolveAccess(p.dev!.userId)).permissions.has("attendance.swipes.view")).toBe(false);
    expect((await swipes("hr")).status).toBe(200);
  });

  it("the Developer cannot change the switch; a proposal alone changes nothing", async () => {
    expect((await request(app).post("/api/behaviours/access.developerSeesSwipes/proposals").set(...authHeader(tok.dev!)).send({ value: true, reason: "let me in" })).status).toBe(403);
    expect((await request(app).post("/api/behaviours/access.developerSeesSwipes/proposals").set(...authHeader(tok.hr!)).send({ value: true, reason: "let them in" })).status).toBe(403);
    const prop = await request(app).post("/api/behaviours/access.developerSeesSwipes/proposals").set(...authHeader(tok.d1!)).send({ value: true, reason: "made up: waiting" });
    expect(prop.status).toBe(201);
    expect((await swipes("dev")).status).toBe(403); // not confirmed yet
  });

  it("switched on by a director and confirmed by a different one, the Developer sees it; switched off again, refused", async () => {
    await setSwitch(true);
    expect((await swipes("dev")).status).toBe(200);
    await setSwitch(false);
    expect((await swipes("dev")).status).toBe(403);
  });
});
