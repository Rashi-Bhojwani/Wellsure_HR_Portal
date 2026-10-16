import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { TestRunAlreadyActiveError, acquireTestRunLock } from "../../../scripts/lib/testRunLock";

// A second test run against the same test database must refuse to start (it dropped and rebuilt the database under the first, in Phase 1.5 commit A).
const adminUrl = (() => {
  const u = new URL(env.DATABASE_URL);
  u.pathname = "/postgres";
  return u.toString();
})();
const fresh = () => ({ database: `lock_test_${randomBytes(4).toString("hex")}`, redis: `lock-test-${randomBytes(4).toString("hex")}` });

describe("the test-run lock", () => {
  it("refuses a second holder of the same test database, with a message that says why, and lets go on release", async () => {
    const res = fresh();
    const first = await acquireTestRunLock(adminUrl, res);
    await expect(acquireTestRunLock(adminUrl, res)).rejects.toBeInstanceOf(TestRunAlreadyActiveError);
    await expect(acquireTestRunLock(adminUrl, res)).rejects.toThrow(/another test run is already using this test environment/);
    await first.release();
    const second = await acquireTestRunLock(adminUrl, res);
    await second.release();
  });

  it("refuses when only the Redis database is shared", async () => {
    const a = fresh();
    const first = await acquireTestRunLock(adminUrl, a);
    await expect(acquireTestRunLock(adminUrl, { database: `lock_test_other_${randomBytes(3).toString("hex")}`, redis: a.redis })).rejects.toThrow(/Redis test database/);
    await first.release();
  });

  it("different databases and Redis databases do not block each other (the clock audit can run beside a normal run)", async () => {
    const [a, b] = [await acquireTestRunLock(adminUrl, fresh()), await acquireTestRunLock(adminUrl, fresh())];
    await a.release();
    await b.release();
  });

  it("a refused attempt leaves nothing held: after it, the first holder's release frees everything", async () => {
    const res = fresh();
    const first = await acquireTestRunLock(adminUrl, res);
    await expect(acquireTestRunLock(adminUrl, { ...res, redis: `other-${res.redis}` })).rejects.toBeInstanceOf(TestRunAlreadyActiveError);
    await first.release();
    // If the refused attempt had kept the Redis lock it took before failing on the database lock, this would now be refused.
    const again = await acquireTestRunLock(adminUrl, { database: `lock_test_${randomBytes(3).toString("hex")}`, redis: `other-${res.redis}` });
    await again.release();
  });

  it("the real run holds its own lock for the whole run: a second run of THIS database is refused", async () => {
    const u = new URL(env.DATABASE_URL);
    const database = decodeURIComponent(u.pathname.slice(1));
    const r = new URL(env.REDIS_URL);
    await expect(acquireTestRunLock(adminUrl, { database, redis: `${r.host}${r.pathname}` })).rejects.toBeInstanceOf(TestRunAlreadyActiveError);
  });
});
