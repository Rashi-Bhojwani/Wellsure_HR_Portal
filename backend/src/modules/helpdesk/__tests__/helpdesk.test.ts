import request from "supertest";
import type { Server as SocketIOServer } from "socket.io";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { HELPDESK_SETTING_KEYS } from "../../../lib/helpdeskSettings";
import { getSocketServer, setSocketServer } from "../../../realtime/emit";
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
import { cleanupTestHelpdeskCategories, createTestHelpdeskCategory, raise, reply, snapshotHelpdeskSettings } from "./helpdeskTestHelpers";

const DAY_MS = 24 * 60 * 60 * 1000;

// Helpdesk (spec §6, Phase 5 commit D). Uses the SEEDED roles (HR_ADMIN,
// HR_EXECUTIVE, MANAGER) so the permission matrix under test is the real one.
describe("Helpdesk tickets", () => {
  let org: TestOrgMasters;
  const categoryIds: string[] = [];
  let general: { id: string };
  let sensitive: { id: string };
  let restoreSettings: () => Promise<void>;
  type Person = { employeeId: string; employeeCode: string; userId: string };
  const people = {} as Record<"hrAdmin" | "hrExec" | "raiser" | "other" | "manager", Person>;
  const tokens = {} as Record<keyof typeof people, string>;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    restoreSettings = await snapshotHelpdeskSettings();
    await setSetting(HELPDESK_SETTING_KEYS.autoCloseDays, 7);
    await setSetting(HELPDESK_SETTING_KEYS.reopenWindowDays, 7);
    people.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    people.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    people.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    people.raiser = await createFullTestEmployee(org, { managerId: people.manager.employeeId });
    people.other = await createFullTestEmployee(org);
    for (const key of Object.keys(people) as Array<keyof typeof people>) tokens[key] = await loginAs(people[key].employeeCode);
    general = await createTestHelpdeskCategory();
    sensitive = await createTestHelpdeskCategory({ isSensitive: true });
    categoryIds.push(general.id, sensitive.id);
  });

  afterAll(async () => {
    await cleanupTestHelpdeskCategories(categoryIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await restoreSettings();
  });

  const get = (token: string, path: string) => request(app).get(path).set(...authHeader(token));
  const patch = (token: string, path: string, body: object) => request(app).patch(path).set(...authHeader(token)).send(body);
  const post = (token: string, path: string, body: object = {}) => request(app).post(path).set(...authHeader(token)).send(body);
  const notificationsFor = (userId: string, type: string, ticketId: string) =>
    prisma.notification.findMany({ where: { userId, type } }).then((rows) => rows.filter((n) => (n.payload as { ticketId?: string } | null)?.ticketId === ticketId));
  async function newTicket(categoryId = general.id, token = tokens.raiser, subject = "Need my address proof letter") {
    const res = await raise(token, { categoryId, subject, body: "Please send it to my email." });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("the seeded permission matrix: HR_ADMIN manages + sees sensitive, HR_EXECUTIVE manages only, nobody else", async () => {
    const roles = await prisma.role.findMany({
      where: { code: { in: ["SUPER_ADMIN", "HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "MANAGER", "EMPLOYEE"] } },
      include: { permissions: { include: { permission: true } } },
    });
    const has = (code: string, key: string) => roles.find((r) => r.code === code)!.permissions.some((p) => p.permission.key === key);
    expect(["SUPER_ADMIN", "HR_ADMIN", "HR_EXECUTIVE"].every((c) => has(c, "helpdesk.manage"))).toBe(true);
    expect(["PAYROLL_ADMIN", "MANAGER", "EMPLOYEE"].some((c) => has(c, "helpdesk.manage"))).toBe(false);
    expect(["SUPER_ADMIN", "HR_ADMIN"].every((c) => has(c, "helpdesk.sensitive.view"))).toBe(true);
    expect(["HR_EXECUTIVE", "PAYROLL_ADMIN", "MANAGER", "EMPLOYEE"].some((c) => has(c, "helpdesk.sensitive.view"))).toBe(false);
  });

  it("the seed marks Payroll & Salary and Grievance sensitive, and only those", async () => {
    const seeded = await prisma.helpdeskCategory.findMany({ where: { code: { in: ["GENERAL", "LEAVE_ATTENDANCE", "DOCUMENTS", "IT_ACCESS", "PAYROLL_SALARY", "GRIEVANCE"] } } });
    expect(seeded).toHaveLength(6);
    expect(seeded.filter((c) => c.isSensitive).map((c) => c.code).sort()).toEqual(["GRIEVANCE", "PAYROLL_SALARY"]);
  });

  it("an employee raises a ticket: HD- number, Open, audited, and in HR's queue", async () => {
    const res = await raise(tokens.raiser, { categoryId: general.id, subject: "Payslip for August", body: "Can't find it.", priority: "HIGH" });
    expect(res.status).toBe(201);
    expect(res.body.number).toMatch(/^HD-\d{6}$/);
    expect(res.body).toMatchObject({ status: "OPEN", priority: "HIGH", viewerRole: "raiser", autoClosesAt: null });
    expect(res.body.messages).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: res.body.id, action: "helpdesk.ticket.raised" } })).toBe(1);

    const queue = await get(tokens.hrExec, `/api/helpdesk/queue?categoryId=${general.id}`);
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((t: { id: string }) => t.id)).toContain(res.body.id);

    const mine = await get(tokens.raiser, "/api/helpdesk/tickets/mine");
    expect(mine.body.map((t: { id: string }) => t.id)).toContain(res.body.id);
  });

  it("rejects an inactive category and an empty subject", async () => {
    const inactive = await createTestHelpdeskCategory({ isActive: false });
    categoryIds.push(inactive.id);
    expect((await raise(tokens.raiser, { categoryId: inactive.id, subject: "Something", body: "x" })).status).toBe(400);
    expect((await raise(tokens.raiser, { categoryId: general.id, subject: "", body: "x" })).status).toBe(400);
    // …and the inactive category isn't offered to employees.
    const offered = await get(tokens.raiser, "/api/helpdesk/categories");
    expect(offered.body.map((c: { id: string }) => c.id)).not.toContain(inactive.id);
  });

  it("internal notes never reach the employee — not in the thread, not as a notification — and don't move the status", async () => {
    const ticketId = await newTicket();
    const note = await reply(tokens.hrAdmin, ticketId, { body: "INTERNAL-ONLY: check payroll export first", isInternalNote: "true" });
    expect(note.status).toBe(201);
    expect(note.body.status).toBe("OPEN");
    expect(note.body.messages.some((m: { isInternalNote?: boolean }) => m.isInternalNote)).toBe(true); // HR sees it

    const asRaiser = await get(tokens.raiser, `/api/helpdesk/tickets/${ticketId}`);
    expect(asRaiser.status).toBe(200);
    expect(JSON.stringify(asRaiser.body)).not.toContain("INTERNAL-ONLY");
    expect(asRaiser.body.messages.every((m: object) => !("isInternalNote" in m))).toBe(true);
    expect(await notificationsFor(people.raiser.userId, "helpdesk.reply", ticketId)).toHaveLength(0);

    // The raiser can't post one.
    expect((await reply(tokens.raiser, ticketId, { body: "sneaky", isInternalNote: "true" })).status).toBe(403);
  });

  it("real-time: an internal note signals only the assignee's room; a public reply reaches the employee's room", async () => {
    const ticketId = await newTicket();
    await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`, { assigneeEmployeeId: people.hrExec.employeeId });
    const sent: Array<{ rooms: string[]; event: string; payload: unknown }> = [];
    const recorder = { to: (rooms: string | string[]) => ({ emit: (event: string, payload?: unknown) => sent.push({ rooms: [rooms].flat(), event, payload }) }) };
    const previous = getSocketServer();
    setSocketServer(recorder as unknown as SocketIOServer);
    try {
      await reply(tokens.hrAdmin, ticketId, { body: "INTERNAL-ONLY note", isInternalNote: "true" });
      const raiserRoom = `user:${people.raiser.employeeId}`;
      expect(sent.some((s) => s.rooms.includes(raiserRoom))).toBe(false);
      expect(sent.find((s) => s.event === "helpdesk.ticket")?.rooms).toEqual([`user:${people.hrExec.employeeId}`]);
      // By effective permission since E1 — not a fixed list of role rooms.
      expect(sent.find((s) => s.event === "helpdesk.queue")?.rooms).toEqual(["perm:helpdesk.manage"]);
      expect(JSON.stringify(sent)).not.toContain("INTERNAL-ONLY"); // signals carry no content

      sent.length = 0;
      await reply(tokens.hrAdmin, ticketId, { body: "Public answer" });
      expect(sent.filter((s) => s.rooms.includes(raiserRoom)).map((s) => s.event).sort()).toEqual(["helpdesk.ticket", "notification.new"]);
    } finally {
      setSocketServer(previous as SocketIOServer);
    }
  });

  it("HR's first public reply picks the ticket up (In progress) and notifies the employee", async () => {
    const ticketId = await newTicket();
    const res = await reply(tokens.hrExec, ticketId, { body: "Sending it today." });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(await notificationsFor(people.raiser.userId, "helpdesk.reply", ticketId)).toHaveLength(1);
  });

  it("IDOR: another employee, a manager, and anyone without helpdesk.manage get 404/403 — never the ticket", async () => {
    const ticketId = await newTicket();
    for (const who of ["other", "manager"] as const) {
      expect((await get(tokens[who], `/api/helpdesk/tickets/${ticketId}`)).status).toBe(404);
      expect((await reply(tokens[who], ticketId, { body: "hi" })).status).toBe(404);
      expect((await post(tokens[who], `/api/helpdesk/tickets/${ticketId}/reopen`)).status).toBe(404);
      expect((await patch(tokens[who], `/api/helpdesk/tickets/${ticketId}`, { status: "RESOLVED" })).status).toBe(403);
      expect((await get(tokens[who], "/api/helpdesk/queue")).status).toBe(403);
    }
    // The raiser can't manage their own ticket either.
    expect((await patch(tokens.raiser, `/api/helpdesk/tickets/${ticketId}`, { status: "RESOLVED" })).status).toBe(403);
    // A ticket id that doesn't exist looks exactly the same as one you can't see.
    const missing = await get(tokens.other, "/api/helpdesk/tickets/does-not-exist");
    expect(missing.status).toBe(404);
  });

  it("HR never handles their own ticket: raiser view only, absent from their queue, can't update it", async () => {
    const ticketId = await newTicket(general.id, tokens.hrExec, "My own laptop issue");
    const own = await get(tokens.hrExec, `/api/helpdesk/tickets/${ticketId}`);
    expect(own.body.viewerRole).toBe("raiser");
    const queue = await get(tokens.hrExec, `/api/helpdesk/queue?categoryId=${general.id}`);
    expect(queue.body.items.map((t: { id: string }) => t.id)).not.toContain(ticketId);
    expect((await patch(tokens.hrExec, `/api/helpdesk/tickets/${ticketId}`, { status: "RESOLVED" })).status).toBe(404);
    // …but another HR person can.
    expect((await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`, { status: "IN_PROGRESS" })).status).toBe(200);
  });

  it("sensitive categories: hidden from HR_EXECUTIVE (queue and direct), visible to HR_ADMIN with an audited view", async () => {
    const ticketId = await newTicket(sensitive.id, tokens.raiser, "Salary mismatch");
    const execQueue = await get(tokens.hrExec, `/api/helpdesk/queue?categoryId=${sensitive.id}`);
    expect(execQueue.body.items).toHaveLength(0);
    expect((await get(tokens.hrExec, `/api/helpdesk/tickets/${ticketId}`)).status).toBe(404);
    expect((await reply(tokens.hrExec, ticketId, { body: "x" })).status).toBe(404);

    const adminView = await get(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`);
    expect(adminView.status).toBe(200);
    expect(adminView.body.viewerRole).toBe("hr");
    expect(await prisma.auditLog.count({ where: { entityId: ticketId, action: "helpdesk.ticket.sensitive_viewed" } })).toBe(1);
    // The raiser always sees their own, sensitive or not, and isn't audited for it.
    expect((await get(tokens.raiser, `/api/helpdesk/tickets/${ticketId}`)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: ticketId, action: "helpdesk.ticket.sensitive_viewed" } })).toBe(1);
  });

  it("toggling a category's sensitive flag immediately changes who sees its existing tickets, and is audited", async () => {
    const category = await createTestHelpdeskCategory();
    categoryIds.push(category.id);
    const ticketId = await newTicket(category.id);
    expect((await get(tokens.hrExec, `/api/helpdesk/tickets/${ticketId}`)).status).toBe(200);

    expect((await patch(tokens.hrAdmin, `/api/helpdesk/categories/${category.id}`, { isSensitive: true })).status).toBe(200);
    expect((await get(tokens.hrExec, `/api/helpdesk/tickets/${ticketId}`)).status).toBe(404);
    expect((await get(tokens.hrExec, `/api/helpdesk/queue?categoryId=${category.id}`)).body.items).toHaveLength(0);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: category.id, action: "helpdesk.category.updated" } });
    expect(audit?.before).toMatchObject({ isSensitive: false });
    expect(audit?.after).toMatchObject({ isSensitive: true });

    expect((await patch(tokens.hrAdmin, `/api/helpdesk/categories/${category.id}`, { isSensitive: false })).status).toBe(200);
    expect((await get(tokens.hrExec, `/api/helpdesk/tickets/${ticketId}`)).status).toBe(200);
  });

  it("assignment: only to people who can work the queue; the assignee is notified; changes are audited before/after", async () => {
    const ticketId = await newTicket();
    expect((await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`, { assigneeEmployeeId: people.other.employeeId })).status).toBe(400);

    const res = await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`, { assigneeEmployeeId: people.hrExec.employeeId, priority: "LOW" });
    expect(res.status).toBe(200);
    expect(res.body.assignee.id).toBe(people.hrExec.employeeId);
    expect(await notificationsFor(people.hrExec.userId, "helpdesk.assigned", ticketId)).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: ticketId, action: "helpdesk.ticket.updated" } });
    expect(audit?.before).toMatchObject({ assigneeEmployeeId: null, priority: "NORMAL" });
    expect(audit?.after).toMatchObject({ assigneeEmployeeId: people.hrExec.employeeId, priority: "LOW" });

    const mine = await get(tokens.hrExec, `/api/helpdesk/queue?assignee=me&categoryId=${general.id}`);
    expect(mine.body.items.map((t: { id: string }) => t.id)).toContain(ticketId);
    expect(mine.body.items.every((t: { assignee: { id: string } }) => t.assignee.id === people.hrExec.employeeId)).toBe(true);
  });

  it("a category's default assignee gets new tickets automatically", async () => {
    const category = await createTestHelpdeskCategory({ defaultAssigneeEmployeeId: people.hrExec.employeeId });
    categoryIds.push(category.id);
    const ticketId = await newTicket(category.id);
    const t = await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.assigneeEmployeeId).toBe(people.hrExec.employeeId);
    expect(await notificationsFor(people.hrExec.userId, "helpdesk.assigned", ticketId)).toHaveLength(1);
  });

  describe("status transitions and the reopen window", () => {
    it("Waiting on employee → the employee's reply hands it back to HR (In progress when assigned, Open when not)", async () => {
      const unassigned = await newTicket();
      await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${unassigned}`, { status: "WAITING_ON_EMPLOYEE" });
      expect((await reply(tokens.raiser, unassigned, { body: "Here you go" })).body.status).toBe("OPEN");

      const assigned = await newTicket();
      await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${assigned}`, { status: "WAITING_ON_EMPLOYEE", assigneeEmployeeId: people.hrExec.employeeId });
      const res = await reply(tokens.raiser, assigned, { body: "Here you go" });
      expect(res.body.status).toBe("IN_PROGRESS");
      expect(await notificationsFor(people.hrExec.userId, "helpdesk.reply", assigned)).toHaveLength(1);
    });

    it("Resolved shows the auto-close and reopen-until dates, and tells the employee in the notification", async () => {
      const ticketId = await newTicket();
      const res = await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`, { status: "RESOLVED" });
      expect(res.status).toBe(200);
      const resolvedAt = new Date(res.body.resolvedAt).getTime();
      expect(new Date(res.body.autoClosesAt).getTime()).toBe(resolvedAt + 7 * DAY_MS);
      expect(new Date(res.body.reopenUntil).getTime()).toBe(resolvedAt + 7 * DAY_MS);
      const asRaiser = await get(tokens.raiser, `/api/helpdesk/tickets/${ticketId}`);
      expect(asRaiser.body.autoClosesAt).toBe(res.body.autoClosesAt);
      const [note] = await notificationsFor(people.raiser.userId, "helpdesk.status", ticketId);
      expect(note?.body).toMatch(/close automatically on .+ unless you reply/);

      // The dates follow the admin setting.
      await setSetting(HELPDESK_SETTING_KEYS.autoCloseDays, 3);
      const after = await get(tokens.raiser, `/api/helpdesk/tickets/${ticketId}`);
      expect(new Date(after.body.autoClosesAt).getTime()).toBe(resolvedAt + 3 * DAY_MS);
      await setSetting(HELPDESK_SETTING_KEYS.autoCloseDays, 7);
    });

    it("replying to a Resolved ticket within the window reopens it; outside the window it's refused", async () => {
      const ticketId = await newTicket();
      await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`, { status: "RESOLVED" });
      const reopened = await reply(tokens.raiser, ticketId, { body: "Still not received" });
      expect(reopened.body.status).toBe("OPEN");
      expect(reopened.body.resolvedAt).toBeNull();
      expect(reopened.body.autoClosesAt).toBeNull();

      await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`, { status: "RESOLVED" });
      await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { resolvedAt: new Date(Date.now() - 8 * DAY_MS) } });
      expect((await reply(tokens.raiser, ticketId, { body: "Hello?" })).status).toBe(409);
      expect((await post(tokens.raiser, `/api/helpdesk/tickets/${ticketId}/reopen`)).status).toBe(409);
    });

    it("the employee can reopen a Resolved or Closed ticket within the window; a Closed one can't be replied to directly", async () => {
      const ticketId = await newTicket();
      await patch(tokens.hrAdmin, `/api/helpdesk/tickets/${ticketId}`, { status: "CLOSED" });
      const closed = await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(closed.resolvedAt).not.toBeNull(); // closing starts the reopen window
      expect((await reply(tokens.raiser, ticketId, { body: "wait" })).status).toBe(409);

      const reopened = await post(tokens.raiser, `/api/helpdesk/tickets/${ticketId}/reopen`);
      expect(reopened.status).toBe(200);
      expect(reopened.body).toMatchObject({ status: "OPEN", closedAt: null, resolvedAt: null });
      expect(await prisma.auditLog.count({ where: { entityId: ticketId, action: "helpdesk.ticket.reopened" } })).toBe(1);
      // Reopening an open ticket makes no sense.
      expect((await post(tokens.raiser, `/api/helpdesk/tickets/${ticketId}/reopen`)).status).toBe(409);
    });
  });

  describe("categories and settings admin", () => {
    it("only helpdesk.manage can list every category or create one; duplicates are refused; creation is audited", async () => {
      expect((await get(tokens.raiser, "/api/helpdesk/categories/all")).status).toBe(403);
      expect((await post(tokens.raiser, "/api/helpdesk/categories", { code: "NOPE", name: "Nope" })).status).toBe(403);

      const code = `TEST_HD_NEW_${Date.now()}`;
      const created = await post(tokens.hrExec, "/api/helpdesk/categories", { code, name: "Travel", isSensitive: true });
      expect(created.status).toBe(201);
      categoryIds.push(created.body.id);
      expect(await prisma.auditLog.count({ where: { entityId: created.body.id, action: "helpdesk.category.created" } })).toBe(1);
      expect((await post(tokens.hrExec, "/api/helpdesk/categories", { code, name: "Again" })).status).toBe(409);

      const all = await get(tokens.hrExec, "/api/helpdesk/categories/all");
      expect(all.body.find((c: { id: string }) => c.id === created.body.id)).toMatchObject({ isSensitive: true, ticketCount: 0 });
    });

    it("Helpdesk settings: settings.manage only, validated, audited", async () => {
      expect((await get(tokens.hrExec, "/api/settings/helpdesk")).status).toBe(403);
      expect((await request(app).put("/api/settings/helpdesk").set(...authHeader(tokens.hrAdmin)).send({ autoCloseDays: 0 })).status).toBe(400);
      const res = await request(app).put("/api/settings/helpdesk").set(...authHeader(tokens.hrAdmin)).send({ autoCloseDays: 10, reopenWindowDays: 14 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ autoCloseDays: 10, reopenWindowDays: 14 });
      expect((await get(tokens.hrAdmin, "/api/settings/helpdesk")).body).toEqual({ autoCloseDays: 10, reopenWindowDays: 14 });
      const audit = await prisma.auditLog.findFirst({ where: { entityId: "helpdesk", action: "settings.updated" }, orderBy: { createdAt: "desc" } });
      expect(audit?.after).toMatchObject({ autoCloseDays: 10, reopenWindowDays: 14 });
      await setSetting(HELPDESK_SETTING_KEYS.autoCloseDays, 7);
      await setSetting(HELPDESK_SETTING_KEYS.reopenWindowDays, 7);
    });
  });
});
