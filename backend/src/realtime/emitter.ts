import { Emitter } from "@socket.io/redis-emitter";
import type { Redis } from "ioredis";
import { redis } from "../lib/redis";
import { setSocketServer } from "./emit";

// For the worker process, which has no Socket.IO server of
// their own: publishes every emit*() through Redis to the api servers'
// Redis adapter (same default "socket.io" key), which deliver it to the
// right rooms. See realtime/emit.ts.
let client: Redis | null = null;

export function createSocketEmitter(redisClient: Redis): Emitter {
  return new Emitter(redisClient);
}

export async function startSocketEmitter(): Promise<void> {
  client = redis.duplicate();
  await client.connect();
  setSocketServer(createSocketEmitter(client));
}

export async function stopSocketEmitter(): Promise<void> {
  setSocketServer(null);
  const c = client;
  client = null;
  if (c) await c.quit().catch(() => undefined);
}
