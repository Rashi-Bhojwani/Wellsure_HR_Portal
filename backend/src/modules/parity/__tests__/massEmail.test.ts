import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { mailService } from "../../../integrations/mail";
import { fakeReceipt } from "../../../integrations/mail/testing";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  revokePermissions,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { privateDataProblem } from "../massEmail";

// A-9 G5 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 15): mass email. Made-up people and words; the mail interface is replaced so nothing is sent.

type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const TEAM_ROLE = `TEST_A9_MAIL_${Date.now()}`;

describe("A-9 G5 — mass email", () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const emailIds: string[] = [];
  const segIds: string[] = [];
  const call = (who: string, method: "get" | "post" | "patch", path: string, body?: object) => request(app)[method](`/api/mass-email${path}`).set(...authHeader(tok[who]!)).send(body);
  const draft = async (who: string, body: object) => {
    const res = await call(who, "post", "", { subject: "Office closed on Friday", body: "The office is closed this Friday for maintenance.\nPlease work from home.", category: "Facilities", ...body });
    if (res.status === 201) emailIds.push(res.body.id);
    return res;
  };
  const sendSpy = () => vi.spyOn(mailService, "send").mockImplementation(async (m) => fakeReceipt(m.to));

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    await prisma.role.create({ data: { code: TEAM_ROLE, name: TEAM_ROLE, dataScope: "TEAM" } });
    await grantPermissions(TEAM_ROLE, ["communication.mass.send", "employee.segments.manage"]);
    p.lead = await createFullTestEmployee(org, { roleCode: TEAM_ROLE });
    p.report = await createFullTestEmployee(org, { managerId: p.lead.employeeId });
    p.report2 = await createFullTestEmployee(org, { managerId: p.lead.employeeId });
    p.outsider = await createFullTestEmployee(otherOrg);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
  }, 120_000);

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await deleteWithDependents("MassEmail", emailIds);
    await deleteWithDependents("EmployeeSegment", segIds);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupTestRole(TEAM_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  }, 120_000);

  it("refuses pay and private data in the subject or the text", () => {
    expect(privateDataProblem("Salary credited", "hello")).toMatch(/subject mentions pay/);
    expect(privateDataProblem("Hello", "Your bonus is 12,000")).toMatch(/message mentions pay/);
    expect(privateDataProblem("Hello", "PAN ABCDE1234F on file")).toMatch(/PAN/);
    expect(privateDataProblem("Hello", "account 123456789012 updated")).toMatch(/Aadhaar|long number/);
    expect(privateDataProblem("Team lunch", "Lunch is at one o'clock in the canteen.")).toBeNull();
  });

  it("the key is the directors' until an owner grants it: HR without it, an employee and the Developer are refused on every route", async () => {
    const own = await draft("director", { audience: "ALL" });
    expect(own.status).toBe(201);
    const id = own.body.id as string;
    const routes: Array<["get" | "post" | "patch", string, object?]> = [["get", ""], ["post", "", { subject: "x", body: "y", audience: "ALL" }], ["get", `/${id}`], ["patch", `/${id}`, { subject: "x" }], ["post", `/${id}/discard`], ["get", `/${id}/count`], ["post", `/${id}/send`, { expectedCount: 1 }]];
    for (const who of ["hr", "emp", "dev"]) for (const [m, path, body] of routes) expect((await call(who, m, path, body)).status, `${who} ${m} ${path}`).toBe(403);
    expect((await request(app).get("/api/mass-email")).status).toBe(401);
  });

  it("the audience is resolved on the server inside the sender's scope; the confirmed count must equal what is sent; one recipient row per person", async () => {
    // A team-scoped sender who asks for "everyone" reaches their own team only.
    const res = await draft("lead", { audience: "ALL" });
    const count = await call("lead", "get", `/${res.body.id}/count`);
    expect(count.body).toEqual({ count: 3, withoutAddress: 0 }); // the lead and two reports
    const stale = await call("lead", "post", `/${res.body.id}/send`, { expectedCount: 4 });
    expect([stale.status, stale.body.error.code]).toEqual([409, "AUDIENCE_CHANGED"]);
    const spy = sendSpy();
    const sent = await call("lead", "post", `/${res.body.id}/send`, { expectedCount: 3 });
    expect([sent.status, sent.body.status, sent.body.recipientCount, sent.body.deliveredCount]).toEqual([200, "SENT", 3, 3]);
    expect(spy).toHaveBeenCalledTimes(3);
    const to = new Set(spy.mock.calls.map(([m]) => m.to));
    const outsider = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: p.outsider!.employeeId } });
    expect(to.has(outsider.personalEmail)).toBe(false);
    expect(await prisma.massEmailRecipient.count({ where: { massEmailId: res.body.id } })).toBe(3);
    // Sending twice sends once.
    const again = await call("lead", "post", `/${res.body.id}/send`, { expectedCount: 3 });
    expect(again.body.status).toBe("SENT");
    expect(spy).toHaveBeenCalledTimes(3);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "communication.mass.sent", entityId: res.body.id } });
    expect(audit.after).toMatchObject({ recipients: 3, delivered: 3 });
    // The text is escaped, never HTML.
    expect(spy.mock.calls[0]![0].html).not.toContain("<script");
  });

  it("chosen people outside the scope are refused when the draft is saved; a segment resolves inside the sender's scope; former staff are never sent to", async () => {
    const out = await draft("lead", { audience: "PEOPLE", employeeIds: [p.report!.employeeId, p.outsider!.employeeId] });
    expect([out.status, out.body.error.code]).toEqual([404, "NOT_FOUND"]);
    const seg = await request(app).post("/api/employee-segments").set(...authHeader(tok.director!)).send({ kind: "LIST", name: `A9 mail ${Date.now()}`, shared: true, employeeIds: [p.report!.employeeId, p.outsider!.employeeId, p.report2!.employeeId] });
    segIds.push(seg.body.id);
    await prisma.employee.update({ where: { id: p.report2!.employeeId }, data: { status: "SEPARATED" } });
    try {
      const viaSeg = await draft("lead", { audience: "SEGMENT", segmentId: seg.body.id });
      expect((await call("lead", "get", `/${viaSeg.body.id}/count`)).body.count).toBe(1); // the report only: not the outsider, not the leaver
      expect((await call("director", "get", `/${viaSeg.body.id}/count`)).body.count).toBe(2); // the same segment, a director's scope
    } finally {
      await prisma.employee.update({ where: { id: p.report2!.employeeId }, data: { status: "ACTIVE" } });
    }
  });

  it("a draft can be changed or discarded before sending (kept, never deleted); a sent one cannot; private data is refused on save too", async () => {
    const d = await draft("director", { audience: "PEOPLE", employeeIds: [p.emp!.employeeId] });
    expect((await call("director", "patch", `/${d.body.id}`, { body: "Your increment letter is ready" })).body.error.code).toBe("PRIVATE_DATA");
    expect((await draft("director", { audience: "ALL", body: "CTC revised to 9,00,000" })).body.error.code).toBe("PRIVATE_DATA");
    expect((await call("director", "patch", `/${d.body.id}`, { subject: "Office closed on Monday" })).body.subject).toBe("Office closed on Monday");
    expect((await call("director", "post", `/${d.body.id}/discard`)).status).toBe(204);
    expect((await call("director", "get", `/${d.body.id}`)).status).toBe(404);
    expect(await prisma.massEmail.findUniqueOrThrow({ where: { id: d.body.id } })).toMatchObject({ status: "DISCARDED" });
    const s = await draft("director", { audience: "PEOPLE", employeeIds: [p.emp!.employeeId] });
    sendSpy();
    expect((await call("director", "post", `/${s.body.id}/send`, { expectedCount: 1 })).body.status).toBe("SENT");
    expect((await call("director", "patch", `/${s.body.id}`, { subject: "changed" })).body.error.code).toBe("NOT_DRAFT");
    expect((await call("director", "post", `/${s.body.id}/discard`)).body.error.code).toBe("NOT_DRAFT");
    // The send checks the text again: a draft that reached the database some other way is still refused.
    const sneaked = await prisma.massEmail.create({ data: { subject: "Note", body: "Your salary slip is attached", audience: "ALL", createdByUserId: p.director!.userId } });
    emailIds.push(sneaked.id);
    const refused = await call("director", "post", `/${sneaked.id}/send`, { expectedCount: 1 });
    expect([refused.status, refused.body.error.code]).toEqual([400, "PRIVATE_DATA"]);
    const history = await call("director", "get", "?status=SENT&pageSize=100");
    expect(history.body.rows.map((r: { id: string }) => r.id)).toContain(s.body.id);
  });

  it("withdrawing the key takes effect on the next request", async () => {
    expect((await call("lead", "get", "")).status).toBe(200);
    await revokePermissions(TEAM_ROLE, ["communication.mass.send"]);
    expect((await call("lead", "get", "")).status).toBe(403);
  });
});
