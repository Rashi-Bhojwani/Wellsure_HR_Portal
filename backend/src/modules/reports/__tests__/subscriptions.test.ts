import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { mailService } from "../../../integrations/mail";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { sendDueReports } from "../subscriptions";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  cleanupTestRole,
  grantPermissions,
  loginAs,
  revokePermissions,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// RP-13 (M session): "email me this report" — own schedules only, a report one may open, sent with one's access at the time, no rows in the email.
describe("scheduled reports by email", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const u: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const MONDAY = new Date("2026-11-16T00:00:00Z"); // a Monday, not the 1st
  const FIRST = new Date("2026-12-01T00:00:00Z"); // the 1st, a Tuesday
  const sent: Array<{ to: string; subject: string; html?: string }> = [];
  const original = mailService.send.bind(mailService);
  const sub = (who: string, body: object) => request(app).post("/api/reports/subscriptions/mine").set(...authHeader(t[who]!)).send(body);

  const RPT_ROLE = `TEST_RPT_${Date.now()}`;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(RPT_ROLE, ["reports.view"]);
    for (const [k, roleCode] of [["dir", "SUPER_ADMIN"], ["dir2", "SUPER_ADMIN"], ["emp", undefined], ["dev", DEVELOPER_ROLE_CODE], ["rpt", RPT_ROLE]] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      u[k] = e;
      t[k] = await loginAs(e.employeeCode);
    }
    (mailService as { send: typeof mailService.send }).send = async (m) => {
      sent.push(m as { to: string; subject: string; html?: string });
      return { status: "SENT", messageId: "test" } as never;
    };
  });
  afterAll(async () => {
    (mailService as { send: typeof mailService.send }).send = original;
    await prisma.reportSubscription.deleteMany({ where: { userId: { in: Object.values(u).map((x) => x.userId) } } });
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupTestRole(RPT_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("only someone who may open the report schedules it, for themselves", async () => {
    expect((await sub("emp", { reportKey: "headcount", frequency: "WEEKLY" })).status).toBe(403);
    expect((await sub("dev", { reportKey: "leave-liability", frequency: "WEEKLY" })).status).toBe(403);
    expect((await sub("dir", { reportKey: "headcount", frequency: "WEEKLY", filters: { asOf: "2026-01-01" } })).status).toBe(400); // dates are worked out at send time
    const ok = await sub("dir", { reportKey: "headcount", frequency: "WEEKLY" });
    expect(ok.status).toBe(200);
    expect((await sub("dir", { reportKey: "joiners", frequency: "MONTHLY" })).status).toBe(200);
    const other = await request(app).get("/api/reports/subscriptions/mine").set(...authHeader(t.dir2!));
    expect(other.body.subscriptions).toEqual([]);
    const id = ok.body.subscriptions[0].id as string;
    expect((await request(app).delete(`/api/reports/subscriptions/mine/${id}`).set(...authHeader(t.dir2!))).status).toBe(404);
  });

  it("on a Monday the weekly one is sent once: a row count and a link, never the rows", async () => {
    sent.length = 0;
    const r = await sendDueReports(MONDAY);
    const mine = sent.filter((m) => m.subject.startsWith("Headcount"));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toMatch(/^Headcount: \d+ rows?$/);
    expect(mine[0]!.html).toContain("/admin/reports/headcount?asOf=2026-11-16");
    expect(mine[0]!.html).not.toContain(u.emp!.employeeCode);
    expect(sent.some((m) => m.subject.startsWith("Joiners"))).toBe(false); // monthly: not on a Monday
    expect(r.sent).toBeGreaterThanOrEqual(1);
    sent.length = 0;
    await sendDueReports(MONDAY);
    expect(sent.filter((m) => m.subject.startsWith("Headcount"))).toHaveLength(0); // once a day
  });

  it("on the 1st the monthly one covers the last calendar month", async () => {
    sent.length = 0;
    await sendDueReports(FIRST);
    const m = sent.find((x) => x.subject.startsWith("Joiners"));
    expect(m?.html).toContain("from=2026-11-01");
    expect(m?.html).toContain("to=2026-11-30");
  });

  it("someone who can no longer open the report, or whose account is suspended, is stopped with the reason and sent nothing", async () => {
    expect((await sub("rpt", { reportKey: "headcount", frequency: "WEEKLY" })).status).toBe(200);
    await revokePermissions(RPT_ROLE, ["reports.view"]);
    await prisma.user.update({ where: { id: u.dir!.userId }, data: { status: "SUSPENDED" } });
    sent.length = 0;
    await sendDueReports(new Date("2026-11-23T00:00:00Z"));
    expect(sent.map((m) => m.subject)).toEqual([]);
    const rows = await prisma.reportSubscription.findMany({ where: { userId: { in: [u.rpt!.userId, u.dir!.userId] }, reportKey: "headcount" } });
    expect(rows.find((r) => r.userId === u.rpt!.userId)).toMatchObject({ active: false, stoppedWhy: "You can no longer open this report." });
    expect(rows.find((r) => r.userId === u.dir!.userId)).toMatchObject({ active: false, stoppedWhy: "The account is no longer active." });
    await prisma.user.update({ where: { id: u.dir!.userId }, data: { status: "ACTIVE" } });
  });
});
