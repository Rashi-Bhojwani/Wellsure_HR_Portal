import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redis } from "../../lib/redis";
import { emitHelpdeskTicket, emitLetterUpdated, getSocketServer, setSocketServer } from "../emit";
import { createSocketEmitter } from "../emitter";
import { env } from "../../config/env";

// A background job runs in the WORKER process, which has no Socket.IO server.
// Its emits must still reach browsers connected to the API process: the
// worker publishes through a Redis emitter, the API's Redis adapter delivers
// to the room. (Until Phase 5 commit D2 these emits were silently dropped.)
describe("emits from the worker reach clients connected to the api (Redis emitter → adapter)", () => {
  const room = `test-${randomUUID()}`;
  const clients: Array<ReturnType<typeof redis.duplicate>> = [];
  let apiServer: Server;
  let httpServer: ReturnType<typeof createServer>;
  let browser: Socket;
  const previous = getSocketServer();

  beforeAll(async () => {
    // The "api process": a real Socket.IO server on the Redis adapter.
    const pub = redis.duplicate();
    const sub = redis.duplicate();
    const emitterClient = redis.duplicate();
    clients.push(pub, sub, emitterClient);
    await Promise.all(clients.map((c) => c.connect()));
    httpServer = createServer();
    apiServer = new Server(httpServer, { adapter: createAdapter(pub, sub, { key: env.SOCKET_IO_REDIS_KEY }) });
    apiServer.on("connection", (s) => void s.join(`user:${room}`));
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = httpServer.address() as AddressInfo;
    browser = connect(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
    await new Promise<void>((resolve) => browser.on("connect", () => resolve()));

    // The "worker process": only a Redis emitter, exactly as modes/worker.ts sets up.
    setSocketServer(createSocketEmitter(emitterClient));
  });

  afterAll(async () => {
    setSocketServer(previous);
    browser.disconnect();
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await Promise.all(clients.map((c) => c.quit().catch(() => undefined)));
  });

  const next = (event: string) => new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within 5s`)), 5000);
    browser.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  it("letter.updated reaches the issuer's browser", async () => {
    const received = next("letter.updated");
    emitLetterUpdated(room, { letterId: "L1", employeeId: "E1" });
    expect(await received).toEqual({ letterId: "L1", employeeId: "E1" });
  });

  it("helpdesk.ticket (e.g. from the auto-close job) reaches the raiser's browser", async () => {
    const received = next("helpdesk.ticket");
    emitHelpdeskTicket("T1", [room]);
    expect(await received).toEqual({ ticketId: "T1" });
  });
});
