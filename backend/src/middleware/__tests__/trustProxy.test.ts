import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, trustProxyHopsFor } from "../../app";
import { clearRateLimits } from "../../modules/auth/__tests__/authTestHelpers";
import { redis } from "../../lib/redis";

// Behind the ALB the client's address is the entry the ALB appended to X-Forwarded-For; anything a client writes to the left of it is
// the client's own claim. The login rate limit is keyed by req.ip, so a forged header must neither dodge it nor frame somebody else.
const LOGIN_KEYS = "ratelimit:auth.rateLimit.login:*";
const attempt = (app: ReturnType<typeof createApp>, xff?: string) => {
  const r = request(app).post("/api/auth/login").send({ employeeCode: "NOPE", password: "wrong-password-1" });
  return xff ? r.set("X-Forwarded-For", xff) : r;
};

describe("trust proxy: exactly one hop", () => {
  beforeEach(clearRateLimits);

  it("defaults to one hop outside development and none in development", () => {
    expect([trustProxyHopsFor("staging", undefined), trustProxyHopsFor("production", undefined), trustProxyHopsFor("development", undefined)]).toEqual([1, 1, 0]);
    expect(trustProxyHopsFor("production", 2)).toBe(2);
    expect(trustProxyHopsFor("staging", 0)).toBe(0);
  });

  it("keys the limit on the address the ALB appended, ignoring forged entries to its left", async () => {
    const app = createApp({ trustProxyHops: 1 });
    // Eleven wrong passwords, each claiming a different origin on the left of the real one. The limit is 10 per window.
    let last = 0;
    for (let i = 1; i <= 11; i++) last = (await attempt(app, `198.51.100.${i}, 203.0.113.7`)).status;
    expect(last).toBe(429);
    const keys = await redis.keys(LOGIN_KEYS);
    expect(keys).toEqual(["ratelimit:auth.rateLimit.login:203.0.113.7"]);
  });

  it("one person failing does not lock out a different person behind the same ALB", async () => {
    const app = createApp({ trustProxyHops: 1 });
    for (let i = 0; i < 11; i++) await attempt(app, "203.0.113.7");
    expect((await attempt(app, "203.0.113.7")).status).toBe(429);
    expect((await attempt(app, "203.0.113.99")).status).toBe(401); // a different client: wrong password, not rate limited
  });

  it("with no proxy trusted, the header is ignored entirely (development, tests)", async () => {
    const app = createApp({ trustProxyHops: 0 });
    for (let i = 1; i <= 11; i++) await attempt(app, `198.51.100.${i}`);
    const keys = await redis.keys(LOGIN_KEYS);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("198.51.100");
  });
});
