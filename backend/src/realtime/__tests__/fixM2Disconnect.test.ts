import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { Server as SocketIOServer } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { createSocketServer } from "../socket";
import { getSocketServer, setSocketServer, type RoomEmitter } from "../emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../modules/employee/__tests__/employeeTestHelpers";

// FIX-M2 (independent audit 2026-11-20, finding M2): "A suspended user's live Socket.IO connection stays open and keeps receiving events (reproduced)."
// Now suspending, deactivating or separating someone, or changing their roles, disconnects their live connections at once; a suspended or deactivated account
// cannot reconnect (the handshake checks the account and its session version).
type P = { employeeId: string; employeeCode: string; userId: string };

describe("FIX-M2: access changes close live connections at once", () => {
  let org: TestOrgMasters;
  let director: P, target: P, other: P;
  let tDirector: string;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let previous: RoomEmitter | null;
  let port: number;

  const open = async (p: P): Promise<Socket> => {
    const s = connect(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false, auth: { token: signAccessToken(p.userId, (await prisma.user.findUniqueOrThrow({ where: { id: p.userId } })).sessionVersion) } });
    await new Promise<void>((resolve, reject) => {
      s.on("connect", () => resolve());
      s.on("connect_error", reject);
    });
    return s;
  };
  const closed = (s: Socket, ms = 3000) => new Promise<boolean>((resolve) => {
    if (s.disconnected) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    s.on("disconnect", () => { clearTimeout(t); resolve(true); });
  });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    target = await createFullTestEmployee(org);
    other = await createFullTestEmployee(org);
    tDirector = await loginAs(director.employeeCode);
    previous = getSocketServer();
    httpServer = createServer();
    ioServer = await createSocketServer(httpServer);
    setSocketServer(ioServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    port = (httpServer.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => void ioServer.close(() => resolve()));
    setSocketServer(previous);
    for (const p of [director, target, other]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the audit's case: turning off portal access disconnects the person's open socket, and it cannot reconnect", async () => {
    const s = await open(target);
    const bystander = await open(other);
    const res = await request(app).post(`/api/access/employees/${target.employeeId}/portal-access`).set(...authHeader(tDirector)).send({ enabled: false, reason: "test: suspend" });
    expect(res.status).toBe(200);
    expect(await closed(s)).toBe(true);
    expect(bystander.connected).toBe(true); // nobody else is touched
    await expect(open(target)).rejects.toBeTruthy();
    bystander.disconnect();
    await request(app).post(`/api/access/employees/${target.employeeId}/portal-access`).set(...authHeader(tDirector)).send({ enabled: true, reason: "test: back on" }).expect(200);
  });

  it("a role change disconnects the person's open socket (they reconnect under the new roles)", async () => {
    const s = await open(target);
    const res = await request(app).post(`/api/access/employees/${target.employeeId}/roles`).set(...authHeader(tDirector)).send({ code: "HR_EXECUTIVE" });
    expect(res.status).toBe(200);
    expect(await closed(s)).toBe(true);
    const again = await open(target); // reconnecting is allowed: the account is active
    expect(again.connected).toBe(true);
    again.disconnect();
  });

  it("deactivation through a separation disconnects the person", async () => {
    const s = await open(other);
    const { markSeparatedInTx } = await import("../../modules/employee/separations");
    await prisma.$transaction((tx) => markSeparatedInTx(tx, other.employeeId, new Date("2026-01-31"), "test"));
    expect(await closed(s)).toBe(true);
    await expect(open(other)).rejects.toBeTruthy();
  });
});
