import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";

// Socket.IO server skeleton with the Redis adapter (spec §8), so multiple
// api instances can broadcast to each other's connected clients. Handshake
// auth and rooms (user:{id}, manager:{id}, dept:{id}, location:{id},
// role:{role}, org) land in Phase 1+ once real sessions exist.
export async function createSocketServer(httpServer: HttpServer): Promise<SocketIOServer> {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN.split(","), credentials: true },
    adapter: createAdapter(pubClient, subClient),
  });

  io.use((_socket, next) => {
    // Placeholder handshake auth — real access-token verification lands in
    // Phase 1, once auth/sessions exist.
    next();
  });

  io.on("connection", (socket) => {
    logger.debug({ socketId: socket.id }, "socket connected");
    socket.on("disconnect", (reason) => {
      logger.debug({ socketId: socket.id, reason }, "socket disconnected");
    });
  });

  return io;
}
