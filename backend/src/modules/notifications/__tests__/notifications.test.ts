import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { createNotification } from "../service";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../leave/__tests__/leaveTestHelpers";

// Notifications (spec §8) — self-serve only, every row implicitly scoped
// to the caller's own userId. createNotification is the persistence path
// every other module's write path calls directly (see requests.ts); these
// tests exercise it plus the read/mark-read endpoints.
describe("Notifications", () => {
  let org: TestOrgMasters;
  let userAId: string;
  let tokenA: string;
  let tokenB: string;
  const employeeIds: string[] = [];

  afterAll(async () => {
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("createNotification persists a row with readAt null", async () => {
    org = await createEmployeeTestOrgMasters();
    const a = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    userAId = a.userId;
    employeeIds.push(a.employeeId);
    tokenA = await loginAs(a.employeeCode);

    const b = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(b.employeeId);
    tokenB = await loginAs(b.employeeCode);

    const notification = await createNotification({
      userId: userAId,
      type: "test.event",
      title: "Test title",
      body: "Test body",
      link: "/app/home",
    });
    expect(notification.readAt).toBeNull();
    expect(notification.userId).toBe(userAId);
  });

  it("lists the caller's own notifications, unread-first then newest-first", async () => {
    await createNotification({ userId: userAId, type: "test.event", title: "Second", body: "b" });

    const res = await request(app).get("/api/notifications").set(...authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.unreadCount).toBeGreaterThanOrEqual(2);
    expect(res.body.rows[0].title).toBe("Second"); // newest of the unread group
  });

  it("never returns another user's notifications", async () => {
    const res = await request(app).get("/api/notifications").set(...authHeader(tokenB));
    expect(res.status).toBe(200);
    expect(res.body.rows.every((r: { title: string }) => r.title !== "Second")).toBe(true);
  });

  it("unread-count reflects only the caller's unread rows", async () => {
    const res = await request(app).get("/api/notifications/unread-count").set(...authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(2);

    const resB = await request(app).get("/api/notifications/unread-count").set(...authHeader(tokenB));
    expect(resB.body.count).toBe(0);
  });

  it("marking another user's notification as read 404s (never a 403 that confirms existence)", async () => {
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: userAId } });
    const res = await request(app).post(`/api/notifications/${row.id}/read`).set(...authHeader(tokenB));
    expect(res.status).toBe(404);
  });

  it("marks one notification as read", async () => {
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: userAId, readAt: null } });
    const res = await request(app).post(`/api/notifications/${row.id}/read`).set(...authHeader(tokenA));
    expect(res.status).toBe(204);

    const reloaded = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(reloaded.readAt).not.toBeNull();
  });

  it("mark-all-read clears every remaining unread row for the caller only", async () => {
    const res = await request(app).post("/api/notifications/read-all").set(...authHeader(tokenA));
    expect(res.status).toBe(204);

    const unreadRes = await request(app).get("/api/notifications/unread-count").set(...authHeader(tokenA));
    expect(unreadRes.body.count).toBe(0);
  });

  it("404s marking a non-existent notification id", async () => {
    const res = await request(app).post("/api/notifications/not-a-real-id/read").set(...authHeader(tokenA));
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });
});
