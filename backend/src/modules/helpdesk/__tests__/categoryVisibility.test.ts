import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { getSocketServer, setSocketServer } from "../../../realtime/emit";
import { cleanupTestHelpdeskCategories, createTestHelpdeskCategory, pngWithExif, raise, reply } from "./helpdeskTestHelpers";
import { resolveAccess } from "../../../lib/permissions";
import { readVisibility, setVisibility } from "../categoryVisibility";

describe("general category visibility", () => {
  let org: TestOrgMasters;
  type Person = { userId: string; employeeId: string; employeeCode: string };
  const people = {} as Record<"director" | "hr" | "outsider" | "employee" | "other" | "developer" | "hrExec", Person>;
  const tokens = {} as Record<keyof typeof people, string>;
  const ids: string[] = [];
  let categoryId: string;
  const get = (who: keyof typeof people, path: string) => request(app).get(`/api/helpdesk${path}`).set(...authHeader(tokens[who]));
  const put = (who: keyof typeof people, path: string, body: object) => request(app).put(`/api/helpdesk${path}`).set(...authHeader(tokens[who])).send(body);
  const setting = (extra: object = {}) => ({ version: 0, hrRoleCodes: [], employeeIds: [people.director.employeeId], reason: "DEMO audience decision", ...extra });
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [who, roleCode] of Object.entries({ director: "SUPER_ADMIN", hr: "HR_ADMIN", outsider: "HR_ADMIN", employee: "EMPLOYEE", other: "EMPLOYEE", developer: "DEVELOPER", hrExec: "HR_EXECUTIVE" })) {
      const key = who as keyof typeof people;
      people[key] = await createFullTestEmployee(org, { roleCode });
      tokens[key] = await loginAs(people[key].employeeCode);
    }
    const c = await prisma.helpdeskCategory.create({ data: { code: `TEST_C2_${randomUUID().slice(0, 8)}`, name: "DEMO visibility" } });
    categoryId = c.id;
    ids.push(c.id);
  });
  afterAll(async () => {
    await cleanupTestHelpdeskCategories(ids);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });
  it("both new visibility routes require authentication and reject HR, employees and Developer", async () => {
    expect((await request(app).get(`/api/helpdesk/categories/${categoryId}/visibility`)).status).toBe(401);
    expect((await request(app).put(`/api/helpdesk/categories/${categoryId}/visibility`).send(setting())).status).toBe(401);
    for (const who of ["hr", "employee", "other", "developer"] as const) {
      expect((await get(who, `/categories/${categoryId}/visibility`)).status, `${who} read`).toBe(403);
      expect((await put(who, `/categories/${categoryId}/visibility`, setting())).status, `${who} write`).toBe(403);
    }
  });
  it("the service guard rejects HR even if passed a forged director permission", async () => {
    await expect(setVisibility(categoryId, setting(), { ...people.hr, permissions: new Set(["helpdesk.visibility.manage"]) }, { actorUserId: people.hr.userId })).rejects.toMatchObject({ status: 403 });
    await expect(readVisibility(categoryId, { ...people.hr, permissions: new Set(["helpdesk.visibility.manage"]) })).rejects.toMatchObject({ status: 403 });
    expect((await resolveAccess(people.hr.userId)).permissions.has("helpdesk.visibility.manage")).toBe(false);
  });
  it("a director chooses an audience with a reason, version check and immutable history", async () => {
    expect((await get("director", `/categories/${categoryId}/visibility`)).body.state).toBe("NOT_SET");
    expect((await put("director", `/categories/${categoryId}/visibility`, setting({ reason: " " }))).status).toBe(400);
    const res = await put("director", `/categories/${categoryId}/visibility`, setting());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "CONFIGURED", version: 1, employeeIds: [people.director.employeeId] });
    expect(res.body.history).toHaveLength(1);
    expect((await put("director", `/categories/${categoryId}/visibility`, setting())).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "helpdesk.visibility.changed", entityId: categoryId } })).toBe(1);
  });
  it("neither visibility route reads or configures Payroll", async () => {
    const payroll = await prisma.helpdeskCategory.findUniqueOrThrow({ where: { code: "PAYROLL_SALARY" }, select: { id: true } });
    expect((await get("director", `/categories/${payroll.id}/visibility`)).status).toBe(404);
    expect((await put("director", `/categories/${payroll.id}/visibility`, setting())).status).toBe(404);
    expect(await prisma.helpdeskCategoryVisibility.count({ where: { categoryId: payroll.id } })).toBe(0);
  });
  async function configuredCategory(employeeIds: string[], extra: object = {}) {
    const res = await request(app).post("/api/helpdesk/categories").set(...authHeader(tokens.director)).send({ code: `TEST_C2_${randomUUID().slice(0, 8).toUpperCase()}`, name: "DEMO general category", ...extra });
    expect(res.status).toBe(201);
    ids.push(res.body.id);
    expect((await put("director", `/categories/${res.body.id}/visibility`, setting({ employeeIds }))).status).toBe(200);
    return res.body.id as string;
  }
  const apiGet = (who: keyof typeof people, path: string) => request(app).get(path).set(...authHeader(tokens[who]));
  const apiPost = (who: keyof typeof people, path: string) => request(app).post(path).set(...authHeader(tokens[who])).send({});
  it("new categories refuse raising until a director chooses; legacy categories keep their queue behaviour", async () => {
    const fresh = await prisma.helpdeskCategory.create({ data: { code: `TEST_C2_${randomUUID().slice(0, 8)}`, name: "DEMO Not set" } });
    ids.push(fresh.id);
    const denied = await raise(tokens.employee, { categoryId: fresh.id, subject: "DEMO not active", body: "DEMO" });
    expect(denied.status).toBe(409);
    expect(denied.body.error.message).toBe("This category is not set up yet");
    expect(await prisma.helpdeskTicket.count({ where: { categoryId: fresh.id } })).toBe(0);
    const legacy = await createTestHelpdeskCategory();
    ids.push(legacy.id);
    expect(await prisma.helpdeskCategoryVisibility.count({ where: { categoryId: legacy.id } })).toBe(0);
    const raised = await raise(tokens.employee, { categoryId: legacy.id, subject: "DEMO legacy", body: "DEMO" });
    expect(raised.status).toBe(201);
    expect((await get("outsider", `/tickets/${raised.body.id}`)).status).toBe(200);
  });
  it("named audience controls queue, totals, Tasks, detail, attachments, persisted notifications and socket rooms", async () => {
    const categoryId = await configuredCategory([people.hr.employeeId]);
    const events: Array<{ rooms: string[]; event: string; args: unknown[] }> = [];
    const previous = getSocketServer();
    setSocketServer({ to: (room) => ({ emit: (event, ...args) => { events.push({ rooms: Array.isArray(room) ? room : [room], event, args }); } }) });
    let raised;
    try {
      raised = await raise(tokens.employee, { categoryId, subject: "DEMO-C2-PRIVATE", body: "DEMO private thread" }, [{ buffer: await pngWithExif(), filename: "demo.png", contentType: "image/png" }]);
    } finally { setSocketServer(previous); }
    expect(raised.status).toBe(201);
    const ticketId = raised.body.id as string;
    const attachmentId = raised.body.messages[0].attachments[0].id as string;
    const queueEvents = events.filter((e) => e.event === "helpdesk.queue");
    expect(queueEvents.length).toBeGreaterThan(0);
    expect(events.every((e) => !e.rooms.includes("perm:helpdesk.manage") && !e.rooms.includes(`user:${people.outsider.employeeId}`))).toBe(true);
    expect(queueEvents[0]!.rooms).toContain(`user:${people.hr.employeeId}`);
    expect(queueEvents[0]!.rooms).toContain(`user:${people.director.employeeId}`);
    const notifications = await prisma.notification.findMany({ where: { userId: people.hr.userId, type: "helpdesk.assigned" } });
    const notification = notifications.find((n) => (n.payload as { ticketId?: string })?.ticketId === ticketId)!;
    expect(notification).toBeDefined();
    expect(await prisma.notification.count({ where: { userId: people.outsider.userId, body: { contains: "DEMO-C2-PRIVATE" } } })).toBe(0);
    await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { assigneeEmployeeId: people.hr.employeeId } });
    expect(JSON.stringify((await apiGet("hr", "/api/tasks/mine")).body)).toContain(ticketId);
    const descriptor = await apiPost("hr", `/api/helpdesk/attachments/${attachmentId}/download`);
    expect(descriptor.status).toBe(200);
    expect(descriptor.body.guarded).toBe(true);
    expect((await apiPost("hr", descriptor.body.url)).status).toBe(200);
    expect((await apiPost("employee", descriptor.body.url)).status).toBe(200);
    expect((await apiPost("other", descriptor.body.url)).status).toBe(404);
    expect((await apiPost("developer", descriptor.body.url)).status).toBe(403);
    expect((await request(app).post(descriptor.body.url).send({})).status).toBe(401);
    expect((await put("director", `/categories/${categoryId}/visibility`, setting({ version: 1 }))).status).toBe(200);
    for (const who of ["hr", "outsider", "other"] as const) {
      expect((await get(who, `/tickets/${ticketId}`)).status).toBe(404);
      expect((await apiPost(who, descriptor.body.url)).status).toBe(404);
      expect((await apiPost(who, `/api/helpdesk/attachments/${attachmentId}/download`)).status).toBe(404);
    }
    expect((await reply(tokens.hr, ticketId, { body: "DEMO denied" })).status).toBe(404);
    const queue = await get("hr", `/queue?categoryId=${categoryId}`);
    expect(queue.status).toBe(200);
    expect(queue.body).toMatchObject({ items: [], total: 0 });
    expect(JSON.stringify((await apiGet("hr", "/api/tasks/mine")).body)).not.toContain(ticketId);
    const categories = await get("hr", "/categories/all");
    expect(categories.body.find((c: { id: string }) => c.id === categoryId).ticketCount).toBe(0);
    const bell = await apiGet("hr", "/api/notifications?page=1&pageSize=100");
    expect(JSON.stringify(bell.body)).not.toContain(ticketId);
    expect(bell.body.total).toBe(0);
    expect((await apiGet("hr", "/api/notifications/unread-count")).body.count).toBe(0);
    expect((await apiPost("hr", `/api/notifications/${notification.id}/read`)).status).toBe(404);
    expect((await get("employee", `/tickets/${ticketId}`)).status).toBe(200);
    expect((await get("director", `/tickets/${ticketId}`)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: ticketId, action: "helpdesk.ticket.director_opened", actorUserId: people.director.userId } })).toBeGreaterThan(0);
  });

  const move = (who: keyof typeof people, ticketId: string, body: object) => request(app).post(`/api/helpdesk/tickets/${ticketId}/move`).set(...authHeader(tokens[who])).send(body);
  it("concurrent identical moves commit one receipt, audit, system note and notification; the former handler immediately loses access", async () => {
    const source = await configuredCategory([people.hr.employeeId]);
    const target = await configuredCategory([people.director.employeeId]);
    const raised = await raise(tokens.employee, { categoryId: source, subject: "DEMO moving", body: "DEMO thread survives" }, [{ buffer: await pngWithExif(), filename: "demo.png", contentType: "image/png" }]);
    expect(raised.status).toBe(201);
    const ticketId = raised.body.id as string;
    const attachmentId = raised.body.messages[0].attachments[0].id as string;
    const descriptor = await apiPost("hr", `/api/helpdesk/attachments/${attachmentId}/download`);
    expect((await apiPost("hr", descriptor.body.url)).status).toBe(200);
    const body = { targetCategoryId: target, reason: "DEMO confidential reason", idempotencyKey: randomUUID() };
    const events: Array<{ rooms: string[]; event: string; args: unknown[] }> = [];
    const previous = getSocketServer();
    setSocketServer({ to: (room) => ({ emit: (event, ...args) => { events.push({ rooms: Array.isArray(room) ? room : [room], event, args }); } }) });
    let a, b;
    try { [a, b] = await Promise.all([move("hr", ticketId, body), move("hr", ticketId, body)]); }
    finally { setSocketServer(previous); }
    const removed = events.filter((e) => e.rooms.includes(`user:${people.hr.employeeId}`));
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((e) => e.event === "helpdesk.access.changed" && JSON.stringify(e.args) === "[{}]")).toBe(true);
    expect(events.filter((e) => e.event === "helpdesk.ticket").every((e) => !e.rooms.includes("perm:helpdesk.manage"))).toBe(true);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    expect(await prisma.helpdeskCategoryMove.count({ where: { ticketId } })).toBe(1);
    expect(await prisma.helpdeskMessage.count({ where: { ticketId, isSystem: true } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: ticketId, action: "helpdesk.ticket.moved" } })).toBe(1);
    expect((await get("hr", `/tickets/${ticketId}`)).status).toBe(404);
    expect((await get("hr", `/queue?categoryId=${target}`)).body).toMatchObject({ items: [], total: 0 });
    expect((await apiPost("hr", descriptor.body.url)).status).toBe(404);
    expect((await apiPost("employee", descriptor.body.url)).status).toBe(200);
    expect(JSON.stringify((await apiGet("hr", "/api/notifications?page=1&pageSize=100")).body)).not.toContain(ticketId);
    expect((await move("hr", ticketId, body)).body).toEqual(a.body);
    expect((await move("hr", ticketId, { ...body, reason: "DEMO different" })).status).toBe(409);
    const thread = await get("employee", `/tickets/${ticketId}`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages.map((m: { body: string }) => m.body)).toEqual(["DEMO thread survives", "Your ticket was moved to another team."]);
    expect(thread.body.messages[1].isSystem).toBe(true);
    expect(thread.body.assignee).toBeNull();
    const notices = await prisma.notification.findMany({ where: { type: "helpdesk.moved", userId: people.employee.userId } });
    const own = notices.filter((n) => (n.payload as { ticketId?: string })?.ticketId === ticketId);
    expect(own).toHaveLength(1);
    expect(own[0]!.body).toBe("Your ticket was moved to another team.");
    expect(JSON.stringify(own)).not.toContain(body.reason);
    await expect(prisma.helpdeskCategoryMove.update({ where: { id: a.body.id }, data: { reason: "changed" } })).rejects.toThrow();
  });
  it("move route enforces auth, validation, employee isolation, Developer 403 and source visibility", async () => {
    const source = await configuredCategory([people.hr.employeeId]);
    const target = await configuredCategory([people.director.employeeId]);
    const raised = await raise(tokens.employee, { categoryId: source, subject: "DEMO route guard", body: "DEMO" });
    const input = { targetCategoryId: target, reason: "DEMO", idempotencyKey: randomUUID() };
    expect((await request(app).post(`/api/helpdesk/tickets/${raised.body.id}/move`).send(input)).status).toBe(401);
    for (const who of ["employee", "other", "developer"] as const) expect((await move(who, raised.body.id, input)).status, who).toBe(403);
    expect((await move("outsider", raised.body.id, input)).status).toBe(404);
    expect((await move("hr", raised.body.id, { ...input, reason: " " })).status).toBe(400);
    expect(await prisma.helpdeskCategoryMove.count({ where: { ticketId: raised.body.id } })).toBe(0);
  });
  it("Payroll exclusion blocks moving in or out in service and database, even with forged general codes", async () => {
    const source = await configuredCategory([people.hr.employeeId]);
    const payroll = await prisma.helpdeskCategory.findUniqueOrThrow({ where: { code: "PAYROLL_SALARY" }, select: { id: true } });
    const generalTicket = await raise(tokens.employee, { categoryId: source, subject: "DEMO general", body: "DEMO" });
    const payrollTicket = await raise(tokens.employee, { categoryId: payroll.id, subject: "DEMO Payroll boundary", body: "DEMO" });
    expect(payrollTicket.status).toBe(201); // existing Session A path only
    const input = { reason: "DEMO", idempotencyKey: randomUUID() };
    expect((await move("director", generalTicket.body.id, { ...input, targetCategoryId: payroll.id })).status).toBe(404);
    expect((await move("director", payrollTicket.body.id, { ...input, targetCategoryId: source })).status).toBe(404);
    for (const [ticketId, sourceCategoryId, targetCategoryId] of [[generalTicket.body.id, source, payroll.id], [payrollTicket.body.id, payroll.id, source]]) {
      await expect(prisma.helpdeskCategoryMove.create({ data: { ticketId, sourceCategoryId, targetCategoryId, sourceCategoryCode: "FORGED", targetCategoryCode: "FORGED", actorUserId: people.director.userId, idempotencyKey: randomUUID(), requestHash: "DEMO", reason: "DEMO" } })).rejects.toThrow("peeps_move_no_payroll");
    }
    // This fixture used the pre-existing Payroll API, so its cleanup must
    // remove that test ticket without deleting the seeded category itself.
    await deleteWithDependents("HelpdeskTicket", [payrollTicket.body.id]);
  });

  it("chosen HR roles intersect the sensitive permission, while directors retain audited access", async () => {
    const categoryId = await configuredCategory([people.director.employeeId], { isSensitive: true });
    expect((await put("director", `/categories/${categoryId}/visibility`, setting({ version: 1, employeeIds: [], hrRoleCodes: ["HR_EXECUTIVE"] }))).status).toBe(200);
    const raised = await raise(tokens.employee, { categoryId, subject: "DEMO sensitive intersection", body: "DEMO" });
    expect(raised.status).toBe(201);
    expect((await get("hrExec", `/queue?categoryId=${categoryId}`)).body).toMatchObject({ items: [], total: 0 });
    expect((await get("hrExec", `/tickets/${raised.body.id}`)).status).toBe(404);
    expect((await get("hr", `/tickets/${raised.body.id}`)).status).toBe(404);
    expect((await get("director", `/tickets/${raised.body.id}`)).status).toBe(200);
    // The selected role now has a non-sensitive category it may work.
    await prisma.helpdeskCategory.update({ where: { id: categoryId }, data: { isSensitive: false } });
    expect((await get("hrExec", `/tickets/${raised.body.id}`)).status).toBe(200);
    expect((await get("hr", `/tickets/${raised.body.id}`)).status).toBe(404);
  });
  it("a Not set target refuses a move without a receipt, note, audit or category change", async () => {
    const source = await configuredCategory([people.hr.employeeId]);
    const target = await prisma.helpdeskCategory.create({ data: { code: `TEST_C2_${randomUUID().slice(0, 8)}`, name: "DEMO Not set target" } });
    ids.push(target.id);
    const raised = await raise(tokens.employee, { categoryId: source, subject: "DEMO no activation", body: "DEMO" });
    const result = await move("hr", raised.body.id, { targetCategoryId: target.id, reason: "DEMO", idempotencyKey: randomUUID() });
    expect(result.status).toBe(409);
    expect(result.body.error.message).toBe("This category is not set up yet");
    expect(await prisma.helpdeskCategoryMove.count({ where: { ticketId: raised.body.id } })).toBe(0);
    expect(await prisma.helpdeskMessage.count({ where: { ticketId: raised.body.id, isSystem: true } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: raised.body.id, action: "helpdesk.ticket.moved" } })).toBe(0);
    expect((await get("hr", `/tickets/${raised.body.id}`)).body.category.id).toBe(source);
  });

  it("moving into a legacy sensitive category removes the former handler's stored notifications too", async () => {
    const source = await configuredCategory([people.hrExec.employeeId]);
    const target = await createTestHelpdeskCategory({ isSensitive: true });
    ids.push(target.id);
    const raised = await raise(tokens.employee, { categoryId: source, subject: "DEMO legacy target", body: "DEMO" }, [{ buffer: await pngWithExif(), filename: "demo.png", contentType: "image/png" }]);
    const ticketId = raised.body.id as string;
    const attachmentId = raised.body.messages[0].attachments[0].id as string;
    const descriptor = await apiPost("hrExec", `/api/helpdesk/attachments/${attachmentId}/download`);
    expect(JSON.stringify((await apiGet("hrExec", "/api/notifications?page=1&pageSize=100")).body)).toContain(ticketId);
    const result = await move("hrExec", ticketId, { targetCategoryId: target.id, reason: "DEMO handover", idempotencyKey: randomUUID() });
    expect(result.status).toBe(200);
    expect((await get("hrExec", `/tickets/${ticketId}`)).status).toBe(404);
    expect(JSON.stringify((await apiGet("hrExec", "/api/notifications?page=1&pageSize=100")).body)).not.toContain(ticketId);
    expect((await apiPost("hrExec", descriptor.body.url)).status).toBe(404);
    expect((await apiPost("employee", descriptor.body.url)).status).toBe(200);
    expect((await apiPost("employee", `/api/helpdesk/attachments/${attachmentId}/download`)).body.guarded).toBe(true);
    const categories = await get("hrExec", "/categories/all");
    expect(categories.body.find((c: { id: string }) => c.id === target.id).ticketCount).toBe(0);
    const events: Array<{ rooms: string[]; event: string }> = [];
    const previous = getSocketServer();
    setSocketServer({ to: (room) => ({ emit: (event) => { events.push({ rooms: Array.isArray(room) ? room : [room], event }); } }) });
    try { expect((await reply(tokens.employee, ticketId, { body: "DEMO follow-up" })).status).toBe(201); }
    finally { setSocketServer(previous); }
    expect(events.every((e) => !e.rooms.includes("perm:helpdesk.manage") && !e.rooms.includes(`user:${people.hrExec.employeeId}`))).toBe(true);
  });

});
