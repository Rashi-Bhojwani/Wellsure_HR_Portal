import { Queue } from "bullmq";
import Redis from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createBullConnection } from "../../lib/redis";
import { env, isolateTestRedis, isTestRun } from "../env";

// A running dev server (api, worker, scheduler) must never be able to touch
// a test run, nor the test run the dev server. A dev worker once consumed the
// suite's queued letter jobs. config/env.ts gives the suite its own Redis
// logical database and its own Socket.IO pub/sub channel prefix.
describe("test runs are isolated from dev Redis", () => {
  const devUrl = process.env.REDIS_URL!; // REDIS_URL as configured (.env / shell), before isolation
  const opened: Queue[] = [];
  afterAll(async () => {
    for (const q of opened) await q.close().catch(() => undefined);
  });

  it("the suite uses REDIS_TEST_DB and a separate Socket.IO channel, never dev's", () => {
    expect(isTestRun()).toBe(true);
    expect(new URL(env.REDIS_URL).pathname).toBe(`/${env.REDIS_TEST_DB}`);
    expect(new URL(devUrl).pathname.replace("/", "") || "0").not.toBe(String(env.REDIS_TEST_DB));
    expect(env.SOCKET_IO_REDIS_KEY).toMatch(/-test$/);
  });

  it("a job the suite queues is invisible to a dev worker — and dev's queue is invisible to the suite", async () => {
    const name = `isolation-check-${Date.now()}`;
    const testQueue = new Queue(name, { connection: createBullConnection() });
    opened.push(testQueue);
    const devQueue = new Queue(name, { connection: new Redis(devUrl, { maxRetriesPerRequest: null }) });
    opened.push(devQueue);
    try {
      await testQueue.add("probe", { from: "test" });
      await devQueue.add("probe", { from: "dev" });
      expect((await testQueue.getJobs(["waiting"])).map((j) => j.data.from)).toEqual(["test"]);
      expect((await devQueue.getJobs(["waiting"])).map((j) => j.data.from)).toEqual(["dev"]);
    } finally {
      await testQueue.obliterate({ force: true });
      await devQueue.obliterate({ force: true });
    }
  });

  it("refuses to run if dev's REDIS_URL already points at the test database", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => isolateTestRedis({ ...env, REDIS_URL: `redis://localhost:6379/${env.REDIS_TEST_DB}` })).toThrow("exit");
      expect(isolateTestRedis({ ...env, REDIS_URL: "redis://localhost:6379", SOCKET_IO_REDIS_KEY: "socket.io" })).toMatchObject({ REDIS_URL: `redis://localhost:6379/${env.REDIS_TEST_DB}`, SOCKET_IO_REDIS_KEY: "socket.io-test" });
    } finally {
      exit.mockRestore();
      vi.restoreAllMocks();
    }
  });
});
