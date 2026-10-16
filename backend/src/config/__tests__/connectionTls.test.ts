import Redis from "ioredis";
import { describe, expect, it } from "vitest";

// Staging/production connect to Redis with rediss:// and an auth token (config/productionGuard.ts requires both). Locally Redis has neither, so the
// first real proof is the first deploy; this pins what the client does with such a URL, so a library change cannot silently drop TLS.
describe("a rediss:// URL", () => {
  it("turns on TLS and carries the auth token", () => {
    const client = new Redis("rediss://:s3cr3t-token@cache.example.org:6379/0", { lazyConnect: true });
    expect(client.options.tls).toBeDefined();
    expect(client.options.password).toBe("s3cr3t-token");
    expect(client.options.host).toBe("cache.example.org");
    client.disconnect();
  });
  it("and a plain redis:// URL does not", () => {
    const client = new Redis("redis://localhost:6379/0", { lazyConnect: true });
    expect(client.options.tls).toBeUndefined();
    client.disconnect();
  });
});
