import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { HELPDESK_SETTING_KEYS } from "../../../lib/helpdeskSettings";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { setSetting } from "../../people/__tests__/peopleTestHelpers";
import { autoCloseResolvedTickets } from "../service";
import { cleanupTestHelpdeskCategories, createTestHelpdeskCategory, raise, snapshotHelpdeskSettings } from "./helpdeskTestHelpers";

// The auto-close job is org-wide, so this test parks its own ticket's
// resolvedAt in 2020 and runs the job "in 2020" — no seeded or real ticket
// is ever old enough to be touched by these runs.
describe("Helpdesk auto-close job", () => {
  let org: TestOrgMasters;
  let restoreSettings: () => Promise<void>;
  const categoryIds: string[] = [];
  let raiser: { employeeId: string; employeeCode: string; userId: string };
  let token: string;
  const RESOLVED_AT = new Date("2020-01-01T10:00:00.000Z");

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    restoreSettings = await snapshotHelpdeskSettings();
    await setSetting(HELPDESK_SETTING_KEYS.autoCloseDays, 7);
    await setSetting(HELPDESK_SETTING_KEYS.reopenWindowDays, 7);
    raiser = await createFullTestEmployee(org);
    token = await loginAs(raiser.employeeCode);
    categoryIds.push((await createTestHelpdeskCategory()).id);
  });

  afterAll(async () => {
    await cleanupTestHelpdeskCategories(categoryIds);
    await cleanupFullTestEmployee(raiser.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await restoreSettings();
  });

  async function resolvedTicket() {
    const res = await raise(token, { categoryId: categoryIds[0]!, subject: "Auto-close me", body: "x" });
    await prisma.helpdeskTicket.update({ where: { id: res.body.id }, data: { status: "RESOLVED", resolvedAt: RESOLVED_AT } });
    return res.body.id as string;
  }

  it("closes exactly at the auto-close time the employee was shown — not a moment before — and is idempotent", async () => {
    const ticketId = await resolvedTicket();
    const shown = await request(app).get(`/api/helpdesk/tickets/${ticketId}`).set(...authHeader(token));
    const autoClosesAt = new Date(shown.body.autoClosesAt);
    expect(autoClosesAt.toISOString()).toBe("2020-01-08T10:00:00.000Z");

    expect(await autoCloseResolvedTickets(new Date(autoClosesAt.getTime() - 1))).toEqual({ closed: 0 });
    expect((await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("RESOLVED");

    expect(await autoCloseResolvedTickets(autoClosesAt)).toEqual({ closed: 1 });
    const closed = await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt?.toISOString()).toBe(autoClosesAt.toISOString());

    // A second run (a retried job) touches nothing.
    expect(await autoCloseResolvedTickets(autoClosesAt)).toEqual({ closed: 0 });
    expect(await prisma.auditLog.count({ where: { entityId: ticketId, action: "helpdesk.ticket.auto_closed" } })).toBe(1);
    const notes = await prisma.notification.findMany({ where: { userId: raiser.userId, type: "helpdesk.status", title: { contains: "closed automatically" } } });
    expect(notes.filter((n) => (n.payload as { ticketId?: string }).ticketId === ticketId)).toHaveLength(1);
  });

  it("follows the admin setting, and leaves non-resolved tickets alone", async () => {
    const ticketId = await resolvedTicket();
    const open = await raise(token, { categoryId: categoryIds[0]!, subject: "Still open", body: "x" });
    await prisma.helpdeskTicket.update({ where: { id: open.body.id }, data: { resolvedAt: RESOLVED_AT } }); // odd data: OPEN with a stale resolvedAt

    await setSetting(HELPDESK_SETTING_KEYS.autoCloseDays, 2);
    expect(await autoCloseResolvedTickets(new Date("2020-01-03T10:00:00.000Z"))).toEqual({ closed: 1 });
    expect((await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("CLOSED");
    expect((await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: open.body.id } })).status).toBe("OPEN");
    await setSetting(HELPDESK_SETTING_KEYS.autoCloseDays, 7);
  });
});
