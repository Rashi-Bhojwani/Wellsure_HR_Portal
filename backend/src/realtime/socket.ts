import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "../config/env";
import { verifyAccessToken } from "../lib/jwt";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { setSocketServer } from "./emit";

// Socket.IO server with the Redis adapter (spec §8), so multiple api
// instances can broadcast to each other's connected clients. Handshake
// auth mirrors middleware/authenticate.ts (same access token, same
// active-account re-check) since a socket connection is just as much an
// authenticated session as an HTTP request. Rooms: `user:{id}`,
// `manager:{id}`, `dept:{id}`, `location:{id}`, `role:{role}`, `org` — a
// socket joins the room *named after itself* for each (its own employeeId
// for user/manager, its current department/location, each held role),
// so server code emitting to e.g. `manager:{id}` reaches the one
// connected socket belonging to the employee who IS manager `id`.
export interface SocketAuthData {
  userId: string;
  employeeId: string;
  roleCodes: string[];
  departmentId: string | null;
  locationId: string | null;
}

// Exported for direct unit testing (see realtime/__tests__/socket.test.ts)
// — the io.use() middleware around it is Socket.IO plumbing, this
// function is where the actual auth decision (valid token? active
// account? which rooms?) is made.
export async function authenticateSocketToken(token: string): Promise<SocketAuthData> {
  const userId = verifyAccessToken(token);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new Error("Account is not active");
  }
  const jobHistory = await prisma.employeeJobHistory.findFirst({
    where: { employeeId: user.employeeId, effectiveTo: null },
    select: { departmentId: true, locationId: true },
  });
  return {
    userId: user.id,
    employeeId: user.employeeId,
    roleCodes: user.roles.map((r) => r.role.code),
    departmentId: jobHistory?.departmentId ?? null,
    locationId: jobHistory?.locationId ?? null,
  };
}

export async function createSocketServer(httpServer: HttpServer): Promise<SocketIOServer> {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN.split(","), credentials: true },
    adapter: createAdapter(pubClient, subClient),
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) {
      next(new Error("Authentication required"));
      return;
    }
    authenticateSocketToken(token)
      .then((data) => {
        Object.assign(socket.data as SocketAuthData, data);
        next();
      })
      .catch(() => next(new Error("Invalid or expired access token")));
  });

  io.on("connection", (socket) => {
    const { userId, employeeId, roleCodes, departmentId, locationId } = socket.data as SocketAuthData;
    void socket.join(`user:${employeeId}`);
    void socket.join(`manager:${employeeId}`);
    void socket.join("org");
    for (const role of roleCodes) {
      void socket.join(`role:${role}`);
    }
    if (departmentId) void socket.join(`dept:${departmentId}`);
    if (locationId) void socket.join(`location:${locationId}`);

    logger.debug({ socketId: socket.id, userId }, "socket connected");
    socket.on("disconnect", (reason) => {
      logger.debug({ socketId: socket.id, userId, reason }, "socket disconnected");
    });
  });

  setSocketServer(io);
  return io;
}
