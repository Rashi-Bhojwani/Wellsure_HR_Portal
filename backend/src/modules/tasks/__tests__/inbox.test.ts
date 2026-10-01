import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestHubItem, TaskItem } from "@shared/types/inbox";
import { prisma } from "../../../lib/prisma";
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
import { cleanupTestHelpdeskCategories, createTestHelpdeskCategory, raise } from "../../helpdesk/__tests__/helpdeskTestHelpers";

// Request Hub (my requests, every module) and the Tasks inbox (things
// waiting on me) — Phase 5 commit D. Both are read-only aggregations; what
// matters is that each source is scoped exactly like the screen that owns it.
describe("Request Hub and Tasks inbox", () => {
  let org: TestOrgMasters;
  const categoryIds: string[] = [];
  type Person = { employeeId: string; employeeCode: string; userId: string };
  const people = {} as Record<"hrAdmin" | "hrExec" | "manager" | "report" | "outsider", Person>;
  const tokens = {} as Record<keyof typeof people, string>;
  let plTypeId: string;
  const ids = {} as Record<"reportLeave" | "outsiderLeave" | "managerLeave" | "reportChange" | "reportTicket" | "resolvedTicket" | "sensitiveTicket", string>;

  async function pendingLeave(person: Person, from: string) {
    const row = await prisma.leaveRequest.create({
      data: { employeeId: person.employeeId, leaveTypeId: plTypeId, fromDate: new Date(from), toDate: new Date(from), totalDays: 1, appliedByUserId: person.userId, reason: "test" },
    });
    return row.id;
  }

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    plTypeId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
    people.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    people.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    people.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    people.report = await createFullTestEmployee(org, { managerId: people.manager.employeeId });
    people.outsider = await createFullTestEmployee(org);
    for (const key of Object.keys(people) as Array<keyof typeof people>) tokens[key] = await loginAs(people[key].employeeCode);

    ids.reportLeave = await pendingLeave(people.report, "2031-03-02");
    ids.outsiderLeave = await pendingLeave(people.outsider, "2031-03-03");
    ids.managerLeave = await pendingLeave(people.manager, "2031-03-04");
    ids.reportChange = (
      await prisma.profileChangeRequest.create({
        data: { employeeId: people.report.employeeId, requestedByUserId: people.report.userId, fieldGroup: "personal", changesJson: { personalEmail: "x@example.com" } },
      })
    ).id;

    const general = await createTestHelpdeskCategory();
    const sensitive = await createTestHelpdeskCategory({ isSensitive: true });
    categoryIds.push(general.id, sensitive.id);
    ids.reportTicket = (await raise(tokens.report, { categoryId: general.id, subject: "Laptop", body: "x" })).body.id;
    ids.resolvedTicket = (await raise(tokens.report, { categoryId: general.id, subject: "Old question", body: "x" })).body.id;
    ids.sensitiveTicket = (await raise(tokens.report, { categoryId: sensitive.id, subject: "Pay", body: "x" })).body.id;
    // All three assigned to hrExec — the sensitive one as if assigned before
    // the category was flagged; the resolved one is no longer HR's move.
    await prisma.helpdeskTicket.updateMany({ where: { id: { in: [ids.reportTicket, ids.resolvedTicket, ids.sensitiveTicket] } }, data: { assigneeEmployeeId: people.hrExec.employeeId } });
    await prisma.helpdeskTicket.update({ where: { id: ids.resolvedTicket }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  });

  afterAll(async () => {
    await cleanupTestHelpdeskCategories(categoryIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const hub = (token: string, query = "") => request(app).get(`/api/request-hub${query}`).set(...authHeader(token));
  const tasks = (token: string) => request(app).get("/api/tasks/mine").set(...authHeader(token));

  describe("Request Hub", () => {
    it("lists my leave, profile changes and tickets as one list — and nobody else's", async () => {
      const res = await hub(tokens.report);
      expect(res.status).toBe(200);
      const items = res.body as RequestHubItem[];
      const byType = (t: string) => items.filter((i) => i.type === t).map((i) => i.id);
      expect(byType("LEAVE")).toEqual([ids.reportLeave]);
      expect(byType("PROFILE_CHANGE")).toEqual([ids.reportChange]);
      expect(byType("HELPDESK").sort()).toEqual([ids.reportTicket, ids.resolvedTicket, ids.sensitiveTicket].sort());
      // Newest activity first.
      const times = items.map((i) => i.updatedAt);
      expect([...times].sort().reverse()).toEqual(times);

      const outsider = (await hub(tokens.outsider)).body as RequestHubItem[];
      expect(outsider.map((i) => i.id)).toEqual([ids.outsiderLeave]);
    });

    it("filters by type and by open/closed, and a resolved ticket carries its auto-close time", async () => {
      const tickets = (await hub(tokens.report, "?type=HELPDESK")).body as RequestHubItem[];
      expect(tickets.every((i) => i.type === "HELPDESK")).toBe(true);

      const closed = (await hub(tokens.report, "?state=CLOSED")).body as RequestHubItem[];
      expect(closed.map((i) => i.id)).toEqual([ids.resolvedTicket]);
      expect(closed[0]!.autoClosesAt).not.toBeNull();
      expect(closed[0]!.link).toBe(`/app/helpdesk/${ids.resolvedTicket}`);

      const open = (await hub(tokens.report, "?state=OPEN")).body as RequestHubItem[];
      expect(open.map((i) => i.id)).not.toContain(ids.resolvedTicket);
      expect(open.every((i) => i.autoClosesAt === null)).toBe(true);

      expect((await hub(tokens.report, "?type=NOPE")).status).toBe(400);
    });
  });

  describe("Tasks inbox", () => {
    it("a manager sees their team's pending leave — not their own, not outside their team", async () => {
      const items = (await tasks(tokens.manager)).body as TaskItem[];
      const leave = items.filter((i) => i.type === "LEAVE_APPROVAL").map((i) => i.id);
      expect(leave).toContain(ids.reportLeave);
      expect(leave).not.toContain(ids.managerLeave);
      expect(leave).not.toContain(ids.outsiderLeave);
      expect(items.some((i) => i.type !== "LEAVE_APPROVAL")).toBe(false); // no helpdesk/profile permissions
    });

    it("HR_EXECUTIVE: change requests to approve and open tickets assigned to them — never resolved or sensitive ones", async () => {
      const items = (await tasks(tokens.hrExec)).body as TaskItem[];
      expect(items.filter((i) => i.type === "PROFILE_CHANGE_APPROVAL").map((i) => i.id)).toContain(ids.reportChange);
      const assigned = items.filter((i) => i.type === "HELPDESK_ASSIGNED").map((i) => i.id);
      expect(assigned).toContain(ids.reportTicket);
      expect(assigned).not.toContain(ids.resolvedTicket);
      expect(assigned).not.toContain(ids.sensitiveTicket);
      const ticket = items.find((i) => i.id === ids.reportTicket)!;
      expect(ticket.adminLink).toBe(`/admin/employee/helpdesk/${ids.reportTicket}`);
      expect(ticket.employeeName).toMatch(/^Test Employee/);
    });

    it("HR_ADMIN (ALL scope) sees pending leave org-wide, minus their own; oldest-waiting first", async () => {
      const items = (await tasks(tokens.hrAdmin)).body as TaskItem[];
      const leave = items.filter((i) => i.type === "LEAVE_APPROVAL").map((i) => i.id);
      expect(leave).toEqual(expect.arrayContaining([ids.reportLeave, ids.outsiderLeave, ids.managerLeave]));
      const times = items.map((i) => i.waitingSince);
      expect([...times].sort()).toEqual(times);
    });

    it("a plain employee has nothing waiting on them", async () => {
      expect((await tasks(tokens.outsider)).body).toEqual([]);
    });
  });
});
