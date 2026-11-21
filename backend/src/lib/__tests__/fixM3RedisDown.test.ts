import Redis from "ioredis";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { prisma } from "../prisma";
import { redis, REDIS_COMMAND_TIMEOUT_MS } from "../redis";
import { SIGN_IN_UNAVAILABLE_MESSAGE } from "../../modules/auth/service";

// FIX-M3 (independent audit 2026-11-20, finding M3): "With Redis down, /ready and every login hang (over 10-15 s) instead of failing fast." Now Redis commands
// time out at 1.5 s and retry at most once; /ready answers 503 within 2 s when Redis or the database is down; sign-in answers a plain 503 within 2 s and fails
// closed when the failed-sign-in store is down.
const app = createApp();
const never = () => new Promise<never>(() => undefined);

describe("FIX-M3: a Redis or database outage fails fast", () => {
  afterEach(() => vi.restoreAllMocks());

  it("the Redis client has a command timeout and at most one retry; a dead Redis is refused within 2 s", async () => {
    expect(redis.options.commandTimeout).toBe(REDIS_COMMAND_TIMEOUT_MS);
    expect(redis.options.maxRetriesPerRequest).toBe(1);
    const dead = new Redis("redis://127.0.0.1:1", { ...redis.options, lazyConnect: true, host: "127.0.0.1", port: 1, retryStrategy: () => null });
    const started = Date.now();
    await expect(dead.ping()).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(2000);
    dead.disconnect();
  });

  it("/ready answers 503 within 2 s when Redis hangs, and when the database hangs", async () => {
    vi.spyOn(redis, "ping").mockImplementation(never as never);
    let started = Date.now();
    let res = await request(app).get("/ready");
    expect([res.status, res.body.redis]).toEqual([503, false]);
    expect(Date.now() - started).toBeLessThan(2000);
    vi.restoreAllMocks();
    vi.spyOn(prisma, "$queryRaw").mockImplementation(never as never);
    started = Date.now();
    res = await request(app).get("/ready");
    expect([res.status, res.body.db]).toEqual([503, false]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("sign-in answers a plain 503 within 2 s and lets nobody in when the rate-limit store is down (fails closed)", async () => {
    vi.spyOn(redis, "mget").mockImplementation(never as never);
    const started = Date.now();
    const res = await request(app).post("/api/auth/login").send({ employeeCode: "1000", password: "anything-at-all" });
    expect(Date.now() - started).toBeLessThan(2000);
    expect([res.status, res.body.error?.message, res.body.accessToken]).toEqual([503, SIGN_IN_UNAVAILABLE_MESSAGE, undefined]);
    vi.restoreAllMocks();
    vi.spyOn(redis, "mget").mockRejectedValue(new Error("connection refused"));
    const refused = await request(app).post("/api/auth/login").send({ employeeCode: "1000", password: "anything-at-all" });
    expect(refused.status).toBe(503);
  });
});
