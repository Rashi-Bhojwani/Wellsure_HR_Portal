import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { mailService } from "../../../integrations/mail";
import { fakeReceipt } from "../../../integrations/mail/testing";
import { createEmployee } from "../service";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupEmployeesByCode,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "./employeeTestHelpers";

// The invitation email on every path (the wizard, the HR-triggered batch after an import, resend), and above all that a failed email is never reported as sent: the screen
// is told what really happened, and so is the record behind it.

describe("invitation emails: what really happened is what HR is told", () => {
  const roleCode = `TEST_HR_INVITE_${Date.now()}`;
  let org: TestOrgMasters;
  let hrToken: string;
  let hrUserId: string;
  const employeeIds: string[] = [];
  const codes: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(roleCode, ["employee.create", "employee.view"]);
    await prisma.role.update({ where: { code: roleCode }, data: { dataScope: "ALL" } });
    const hr = await createFullTestEmployee(org, { roleCode });
    employeeIds.push(hr.employeeId);
    hrUserId = hr.userId;
    hrToken = await loginAs(hr.employeeCode);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await cleanupEmployeesByCode(codes);
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(roleCode);
    await cleanupEmployeeTestOrgMasters(org);
  });

  function payload(email = `hire.${randomUUID().slice(0, 8)}@gmail.com`) {
    const suffix = randomUUID().slice(0, 8);
    const code = `INV-${suffix}`;
    codes.push(code);
    return {
      official: { deviceUserId: code, employeeCode: code, dateOfJoining: "2026-01-15", departmentId: org.departmentId, designationId: org.designationId, locationId: org.locationId, employmentType: "PERMANENT" as const },
      personal: { fullName: `Invite Hire ${suffix}`, dateOfBirth: "1995-06-01", gender: "MALE" as const, personalEmail: email, mobile: "9876543210", currentAddress: "Some address", permanentAddress: "Some address", emergencyContactName: "Emergency Contact", emergencyContactPhone: "9876543211", emergencyContactRelation: "Parent" },
    };
  }
  const create = (body: object) => request(app).post("/api/employees").set(...authHeader(hrToken)).send(body);
  const tokenOf = async (code: string) => prisma.invitationToken.findFirstOrThrow({ where: { user: { employee: { employeeCode: code } } }, orderBy: { createdAt: "desc" } });

  it("the wizard: when a mail server accepts it, the answer says SENT, to which address, and the record says so", async () => {
    const send = vi.spyOn(mailService, "send").mockImplementation(async (m) => ({ ...fakeReceipt(m.to), driver: "smtp" }));
    const p = payload("someone@gmail.com");
    const res = await create(p);
    expect(res.status).toBe(201);
    expect(res.body.invitation).toMatchObject({ status: "SENT", to: "someone@gmail.com", driver: "smtp" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: "someone@gmail.com", subject: expect.stringContaining("set your password") });
    const token = await tokenOf(p.official.employeeCode);
    expect([token.emailTo, token.emailSentAt !== null, token.emailError]).toEqual(["someone@gmail.com", true, null]);
  });

  it("the wizard: when the system only writes the email to a file (development), it says FILE_ONLY and that nothing was sent", async () => {
    // The default test driver is the console one, which writes a file and sends nothing.
    const p = payload();
    const res = await create(p);
    expect(res.status).toBe(201);
    expect(res.body.invitation).toMatchObject({ status: "FILE_ONLY", driver: "console" });
    const token = await tokenOf(p.official.employeeCode);
    expect([token.emailAttemptedAt !== null, token.emailSentAt, token.emailError]).toEqual([true, null, null]);
  });

  it("the wizard: when sending fails, the employee is still created, the answer says FAILED and why, and nothing pretends it worked", async () => {
    vi.spyOn(mailService, "send").mockRejectedValue(Object.assign(new Error("Invalid login"), { code: "EAUTH" }));
    const p = payload("unreachable@gmail.com");
    const res = await create(p);
    expect(res.status).toBe(201);
    expect(res.body.invitation.status).toBe("FAILED");
    expect(res.body.invitation.error).toMatch(/refused the sign-in/);
    expect(res.body.invitation.sentAt).toBeUndefined();
    const token = await tokenOf(p.official.employeeCode);
    expect([token.emailSentAt, token.emailError]).toEqual([null, expect.stringMatching(/refused the sign-in/)]);
    const profile = await request(app).get(`/api/employees/${res.body.id}`).set(...authHeader(hrToken));
    expect([profile.status, profile.body.accountStatus]).toEqual([200, "INVITED"]);
    expect(profile.body.invitation).toMatchObject({ status: "FAILED", to: "unreachable@gmail.com" });
  });

  it("resend: returns what happened, replaces the old link, and a failure is audited as a failure", async () => {
    const p = payload();
    const made = await create(p);
    const first = await tokenOf(p.official.employeeCode);
    vi.spyOn(mailService, "send").mockRejectedValueOnce(Object.assign(new Error("down"), { code: "ECONNECTION" }));
    const failed = await request(app).post(`/api/employees/${made.body.id}/resend-invite`).set(...authHeader(hrToken));
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ status: "FAILED", to: p.personal.personalEmail });
    expect((await prisma.invitationToken.findUniqueOrThrow({ where: { id: first.id } })).usedAt).not.toBeNull(); // the earlier link stops working
    vi.spyOn(mailService, "send").mockImplementation(async (m) => ({ ...fakeReceipt(m.to), driver: "smtp" }));
    const ok = await request(app).post(`/api/employees/${made.body.id}/resend-invite`).set(...authHeader(hrToken));
    expect(ok.body).toMatchObject({ status: "SENT" });
    const audits = await prisma.auditLog.findMany({ where: { action: "employee.invite_resent", entityId: made.body.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => (a.after as { outcome: string }).outcome)).toEqual(["FAILED", "SENT"]);
    // Somebody who has already activated is told so, not "sent".
    await prisma.user.updateMany({ where: { employeeId: made.body.id }, data: { status: "ACTIVE" } });
    expect((await request(app).post(`/api/employees/${made.body.id}/resend-invite`).set(...authHeader(hrToken))).status).toBe(400);
  });

  it("an import never invites: people created without an invitation are listed as NOT_SENT, and HR sends their invitations in a batch, each with its own result", async () => {
    const meta = { actorUserId: hrUserId, ipAddress: null, userAgent: null };
    const a = payload("batch.a@gmail.com");
    const b = payload("batch.b@gmail.com");
    const c = payload("batch.c@gmail.com");
    const send = vi.spyOn(mailService, "send");
    const ids: string[] = [];
    for (const p of [a, b, c]) ids.push((await createEmployee(p as never, meta, { sendInvitation: false })).id); // what the Import Center's commit does
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.invitationToken.count({ where: { user: { employeeId: { in: ids } } } })).toBe(0);

    const pending = await request(app).get("/api/employees/invitations?pageSize=100").set(...authHeader(hrToken));
    expect(pending.status).toBe(200);
    const mine = pending.body.items.filter((i: { employeeId: string }) => ids.includes(i.employeeId));
    expect(mine.map((i: { delivery: { status: string } }) => i.delivery.status)).toEqual(["NOT_SENT", "NOT_SENT", "NOT_SENT"]);

    // One address is refused by the server; the other two go, and the refused one is reported as failed, not sent.
    send.mockImplementation(async (m) => {
      if (m.to === "batch.b@gmail.com") throw Object.assign(new Error("550"), { code: "EENVELOPE", message: "550 mailbox unavailable" });
      return { ...fakeReceipt(m.to), driver: "smtp" };
    });
    const res = await request(app).post("/api/employees/invitations/send").set(...authHeader(hrToken)).send({ employeeIds: ids });
    expect(res.status).toBe(200);
    expect([res.body.requested, res.body.sent, res.body.failed, res.body.fileOnly]).toEqual([3, 2, 1, 0]);
    const byEmail = Object.fromEntries(res.body.results.map((r: { email: string; delivery: { status: string; error?: string } }) => [r.email, r.delivery]));
    expect(byEmail["batch.a@gmail.com"].status).toBe("SENT");
    expect(byEmail["batch.b@gmail.com"]).toMatchObject({ status: "FAILED", error: expect.stringMatching(/did not accept/) });
    expect(byEmail["batch.c@gmail.com"].status).toBe("SENT");
    const after = await request(app).get("/api/employees/invitations?pageSize=100").set(...authHeader(hrToken));
    const status = (id: string) => after.body.items.find((i: { employeeId: string }) => i.employeeId === id).delivery.status;
    expect(ids.map(status)).toEqual(["SENT", "FAILED", "SENT"]);
    expect(await prisma.auditLog.count({ where: { action: "employee.invite_sent", entityId: { in: ids } } })).toBe(3);
  });

  it("the batch skips people who have already activated, says so, and is limited to 100 and to people with employee.create", async () => {
    const p = payload();
    const made = await create(p);
    await prisma.user.updateMany({ where: { employeeId: made.body.id }, data: { status: "ACTIVE" } });
    vi.spyOn(mailService, "send").mockImplementation(async (m) => fakeReceipt(m.to));
    const res = await request(app).post("/api/employees/invitations/send").set(...authHeader(hrToken)).send({ employeeIds: [made.body.id] });
    expect(res.body.sent).toBe(0);
    expect(res.body.results[0].skipped).toMatch(/Already activated/);
    expect((await request(app).post("/api/employees/invitations/send").set(...authHeader(hrToken)).send({ employeeIds: [] })).status).toBe(400);
    expect((await request(app).post("/api/employees/invitations/send").set(...authHeader(hrToken)).send({ employeeIds: Array.from({ length: 101 }, (_, i) => `x${i}`) })).status).toBe(400);
    const plain = await createFullTestEmployee(org);
    employeeIds.push(plain.employeeId);
    const plainToken = await loginAs(plain.employeeCode);
    expect((await request(app).post("/api/employees/invitations/send").set(...authHeader(plainToken)).send({ employeeIds: [made.body.id] })).status).toBe(403);
    expect((await request(app).get("/api/employees/invitations").set(...authHeader(plainToken))).status).toBe(403);
  });
});
