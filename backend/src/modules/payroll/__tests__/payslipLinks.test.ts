import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { mailService } from "../../../integrations/mail";
import { fakeReceipt } from "../../../integrations/mail/testing";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { deliverPayslips } from "../run/payslipDelivery";
import { LINK_EXPIRY_KEY, openLink } from "../run/payslipLinks";
import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, driveToFinal, requestStep, resetSeams, staffWith, type Closing } from "./closeTestHelpers";
import { api, calculateRun, setRules } from "./runTestHelpers";

// Stage 5b, B4: the email after publishing carries a link and no figure. The link is for one payslip and one person, expires after the days a director set (Not set: no link),
// needs a signed-in session, and is checked again on every open. The password-protected PDF stays off.

describe("payslip links", () => {
  let world: Closing;
  let runId = "";
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let tok: { a: string; b: string; dev: string; hr: string };
  let before: unknown = null;
  const code = (n: string) => world.named[n]!.employeeCode;
  const slipOf = (n: string) => prisma.payslip.findFirstOrThrow({ where: { runId, employeeId: world.named[n]!.employeeId } });
  const open = (token: string, link: string) => request(app).post("/api/payslips/mine/links/open").set(...authHeader(token)).send({ token: link });
  const tokenIn = (html: string) => /payslip-link\/([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? "";
  const settings = (token: string, method: "get" | "put", body?: object) => request(app)[method]("/api/payroll/payslip-link-settings").set(...authHeader(token)).send(body);

  beforeAll(async () => {
    before = (await prisma.systemSetting.findUnique({ where: { key: LINK_EXPIRY_KEY } }))?.value ?? null;
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    await requestStep(world.tokens.maker, runId, "publish");
    await approve(world, world.tokens.checkerB, runId, "publish");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`)).status).toBe(201);
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    world.userIds.push(dev.userId, hr.userId);
    tok = { a: await loginAs(code("a")), b: await loginAs(code("b")), dev: await loginAs(dev.employeeCode), hr: await loginAs(hr.employeeCode) };
  }, 900_000);
  afterAll(async () => {
    resetSeams();
    vi.restoreAllMocks();
    if (before === null) await prisma.systemSetting.deleteMany({ where: { key: LINK_EXPIRY_KEY } });
    else await prisma.systemSetting.update({ where: { key: LINK_EXPIRY_KEY }, data: { value: before as never } });
    for (const x of [hr, dev]) await cleanupFullTestEmployee(x.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("the lifetime is Not set until a director sets it; only a director sees or sets it; the password-protected PDF stays off and needs the owners' approval", async () => {
    const s = await settings(world.tokens.maker, "get");
    expect(s.body).toEqual({ expiryDays: null, passwordProtectedPdf: { enabled: false, status: "NEEDS_OWNER_APPROVAL" } });
    for (const who of [tok.hr, tok.dev, tok.a]) {
      expect((await settings(who, "get")).status).toBe(403);
      expect((await settings(who, "put", { expiryDays: 7 })).status).toBe(403);
      expect((await request(app).post(`/api/payroll/runs/${runId}/payslip-links/revoke`).set(...authHeader(who)).send({})).status).toBe(403);
    }
    for (const bad of [0, 101, "7", 1.5]) expect((await settings(world.tokens.maker, "put", { expiryDays: bad })).status, String(bad)).toBe(400);
    const pdf = await settings(world.tokens.maker, "put", { expiryDays: 7, passwordProtectedPdf: true });
    expect([pdf.status, pdf.body.error.code]).toEqual([409, "NEEDS_OWNER_APPROVAL"]);
    expect((await settings(world.tokens.maker, "get")).body.expiryDays).toBeNull(); // the refused request changed nothing
  });

  it("with the lifetime Not set, the email says to sign in and carries no link", async () => {
    const send = vi.spyOn(mailService, "send").mockImplementation(async (m) => ({ ...fakeReceipt(m.to), driver: "smtp" }));
    await deliverPayslips(runId);
    expect(send).toHaveBeenCalledTimes(3);
    for (const call of send.mock.calls) {
      expect(call[0].html).not.toContain("payslip-link");
      expect(call[0].html).toContain("/app/salary/payslips");
    }
    expect(await prisma.payslipLink.count({ where: { payslip: { runId } } })).toBe(0);
    send.mockRestore();
  }, 300_000);

  it("with a lifetime set, the email carries a link and no figure; only the link's hash is kept", async () => {
    expect((await settings(world.tokens.maker, "put", { expiryDays: 7 })).body.expiryDays).toBe(7);
    expect(await prisma.auditLog.count({ where: { action: "payroll.payslip.link_settings_changed", actorUserId: world.maker.userId } })).toBe(1);
    await prisma.payslipDelivery.updateMany({ where: { payslip: { runId } }, data: { emailStatus: null, emailTo: null, emailAttemptedAt: null } });
    const send = vi.spyOn(mailService, "send").mockImplementation(async (m) => ({ ...fakeReceipt(m.to), driver: "smtp" }));
    await deliverPayslips(runId);
    expect(send).toHaveBeenCalledTimes(3);
    const nets = (await prisma.payslip.findMany({ where: { runId } })).map((p) => (p.content as { totals: { net: string } }).totals.net);
    for (const call of send.mock.calls) {
      expect(tokenIn(call[0].html)).not.toBe("");
      expect(call[0].html).not.toContain("₹");
      for (const net of nets) expect(call[0].html).not.toContain(net);
    }
    const sentToken = tokenIn(send.mock.calls[0]![0].html);
    const rows = await prisma.payslipLink.findMany({ where: { payslip: { runId } } });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(JSON.stringify(r)).not.toContain(sentToken); // the token is not stored, only its hash
      const days = (r.expiresAt.getTime() - r.createdAt.getTime()) / 86_400_000; // allow-number: a test of days
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);
    }
    send.mockRestore();
  }, 300_000);

  it("opening needs a sign-in, and only the owner of that payslip gets in; any other answer is the same 'not valid'", async () => {
    // Collect the three tokens again from the database is impossible (only hashes are kept), so a link is made for each person through the same function the email uses.
    const { createLink } = await import("../run/payslipLinks");
    const urlOf = async (n: string) => (await createLink({ id: (await slipOf(n)).id, employeeId: world.named[n]!.employeeId }))!.split("/").pop()!;
    const [ta, tb] = [await urlOf("a"), await urlOf("b")];
    expect((await request(app).post("/api/payslips/mine/links/open").send({ token: ta })).status).toBe(401); // no session
    const ok = await open(tok.a, ta);
    expect([ok.status, ok.body.payslipId]).toEqual([200, (await slipOf("a")).id]);
    const wrongPerson = await open(tok.b, ta);
    const garbage = await open(tok.a, "x".repeat(43));
    const hrTry = await open(tok.hr, ta);
    for (const r of [wrongPerson, garbage, hrTry]) expect([r.status, r.body.error.code]).toEqual([404, "LINK_INVALID"]);
    expect(wrongPerson.body).toEqual(garbage.body); // a stranger learns nothing from the answer
    expect((await open(tok.b, tb)).status).toBe(200);
    expect((await request(app).post("/api/payslips/mine/links/open").set(...authHeader(tok.a)).send({})).status).toBe(404);
    expect((await prisma.payslipLink.findFirstOrThrow({ where: { tokenHash: { not: "" }, employeeId: world.named.a!.employeeId, openedAt: { not: null } } })).openedAt).not.toBeNull();
  });

  it("it expires, is checked again when opened, and can be revoked by a director", async () => {
    const { createLink } = await import("../run/payslipLinks");
    const t = (await createLink({ id: (await slipOf("c")).id, employeeId: world.named.c!.employeeId }))!.split("/").pop()!;
    const cId = world.named.c!.employeeId;
    const soon = new Date(Date.now() + 6 * 86_400_000); // allow-clock: a test instant
    const later = new Date(Date.now() + 8 * 86_400_000); // allow-clock: a test instant
    await expect(openLink(cId, { token: t }, soon)).resolves.toMatchObject({ payslipId: (await slipOf("c")).id });
    await expect(openLink(cId, { token: t }, later)).rejects.toMatchObject({ status: 404, code: "LINK_INVALID" }); // after seven days
    // Revoking: the links of the run stop working at once.
    const t2 = (await createLink({ id: (await slipOf("c")).id, employeeId: cId }))!.split("/").pop()!;
    const cTok = await loginAs(code("c"));
    expect((await open(cTok, t2)).status).toBe(200);
    const revoked = await request(app).post(`/api/payroll/runs/${runId}/payslip-links/revoke`).set(...authHeader(world.tokens.maker)).send({});
    expect([revoked.status, revoked.body.revoked]).toEqual([200, expect.any(Number)]);
    expect(revoked.body.revoked).toBeGreaterThan(0);
    expect((await open(cTok, t2)).body.error.code).toBe("LINK_INVALID");
    expect(await prisma.auditLog.count({ where: { action: "payroll.payslip.links_revoked", entityId: runId } })).toBe(1);
    // The database holds the rest: a link's token and expiry never change, and a revoked link stays revoked.
    const row = await prisma.payslipLink.findFirstOrThrow({ where: { payslip: { runId }, revokedAt: { not: null } } });
    await expect(prisma.payslipLink.update({ where: { id: row.id }, data: { expiresAt: new Date("2099-01-01T00:00:00Z") } })).rejects.toThrow(/PAYSLIP_LINKS_FIXED/);
    await expect(prisma.payslipLink.update({ where: { id: row.id }, data: { revokedAt: null } })).rejects.toThrow(/PAYSLIP_LINKS_FIXED/);
    await expect(prisma.payslipLink.delete({ where: { id: row.id } })).rejects.toThrow(/PAYSLIP_LINKS_APPEND_ONLY/);
  });
});
