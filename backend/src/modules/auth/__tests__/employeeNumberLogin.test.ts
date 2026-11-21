import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { mailService } from "../../../integrations/mail";
import { fakeReceipt } from "../../../integrations/mail/testing";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupEmployeesByCode,
  cleanupFullTestEmployee,
  clearRateLimits,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  TEST_PASSWORD,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { FORGOT_PASSWORD_MIN_DURATION_MS, LOGIN_FAILED_MESSAGE, LOGIN_FAILURE_MIN_DURATION_MS, LOGIN_TOO_MANY_MESSAGE } from "../service";
import { FORGOT_PASSWORD_REPLY } from "@shared/constants/login";
import { findEmployeeIdByLoginId } from "../loginId";

// Employee-number login (docs/plans/LOGIN_CHECKLIST.md, owner decision 2026-11-17): the employee number is the login ID and the machine ID; a new
// person sets their first password through "Forgot password"; the reply never says whether a number exists; links are random, hashed, single-use,
// expire, and go only to the email on record.

const NEW_PASSWORD = "NewPassw0rd99";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe("employee-number login", () => {
  let org: TestOrgMasters;
  const employeeIds: string[] = [];
  const createdCodes: string[] = [];
  const t: Record<string, string> = {};
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};

  // Every email the app sends in this file, so a test can read the link out of it (and check where it went).
  let sent: Array<{ to: string; text: string }> = [];
  beforeEach(async () => {
    sent = [];
    await clearRateLimits();
    vi.spyOn(mailService, "send").mockImplementation(async (m) => {
      sent.push({ to: m.to, text: `${m.text ?? ""}\n${m.html ?? ""}` });
      return { ...fakeReceipt(m.to), driver: "smtp" };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  /** A person with a chosen employee number and status (and optionally no email on record). */
  async function person(code: string, opts: { status?: "ACTIVE" | "INVITED" | "SUSPENDED"; email?: string | null; roleCode?: string } = {}) {
    const p = await createFullTestEmployee(org, opts.roleCode ? { roleCode: opts.roleCode } : {});
    employeeIds.push(p.employeeId);
    await prisma.employee.update({ where: { id: p.employeeId }, data: { employeeCode: code } });
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: p.employeeId }, data: { deviceUserId: code } });
    if (opts.status && opts.status !== "ACTIVE") await prisma.user.update({ where: { id: p.userId }, data: { status: opts.status, ...(opts.status === "INVITED" ? { passwordHash: null } : {}) } });
    if (opts.email !== undefined) await prisma.employeePersonal.update({ where: { employeeId: p.employeeId }, data: { personalEmail: opts.email ?? "" } });
    return { ...p, employeeCode: code };
  }
  const uniq = () => randomUUID().slice(0, 6).toUpperCase();
  const forgot = (employeeCode: string, extra: object = {}) => request(app).post("/api/auth/forgot-password").send({ employeeCode, ...extra });
  const login = (employeeCode: string, password = TEST_PASSWORD) => request(app).post("/api/auth/login").send({ employeeCode, password });
  // Clears only the per-IP sign-in counter (every request here comes from one address), leaving the per-number counters in place.
  const clearIpCounters = async () => {
    const { redis } = await import("../../../lib/redis");
    const keys = await redis.keys("ratelimit:auth.loginFail.ip:*");
    if (keys.length) await redis.del(...keys);
  };
  const linkToken = (text: string, kind: "reset-password" | "set-password") => {
    const m = new RegExp(`/${kind}/([0-9a-f]{64})`).exec(text);
    if (!m) throw new Error(`no ${kind} link in: ${text.slice(0, 200)}`);
    return m[1]!;
  };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["dir", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["hrx", "HR_EXECUTIVE"], ["emp", undefined], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      const p = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      employeeIds.push(p.employeeId);
      people[k] = p;
      t[k] = await loginAs(p.employeeCode);
    }
  });
  afterAll(async () => {
    await cleanupEmployeesByCode(createdCodes);
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  // ── 1. Login by number ────────────────────────────────────────────────

  describe("login by employee number", () => {
    // Changed 2026-11-18: the failure wording is now the owners' sentence and the invited case shares it (it used to be a distinct 403).
    it("golden: number login (success shape, the one failure reply for unknown / wrong / invited, lockout)", async () => {
      const code = `G${uniq()}`;
      const p = await person(code);
      const ok = await login(code);
      expect(ok.status).toBe(200);
      expect(Object.keys(ok.body).sort()).toEqual(["accessToken", "user"]);
      expect(ok.body.user).toEqual({ employeeCode: code, roleCodes: [], privacyNoticeAccepted: true });
      expect(ok.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);

      const unknown = await login(`NOPE-${uniq()}`, "whatever123");
      const wrong = await login(code, "wrong-password");
      expect([unknown.status, wrong.status]).toEqual([401, 401]);
      expect(unknown.body).toEqual(wrong.body);
      expect(wrong.body.error).toMatchObject({ code: "INVALID_CREDENTIALS", message: "The employee number or password is not correct." });

      const inv = await person(`GI${uniq()}`, { status: "INVITED" });
      const invited = await login(inv.employeeCode);
      expect(invited.status).toBe(401);
      expect(invited.body).toEqual(unknown.body);

      // The existing limit (auth.lockout: 5 failures, 15 minutes) still applies; since follow-up 2 its reply is the one over-limit reply (429), not 423.
      await clearIpCounters();
      for (let i = 0; i < 5; i++) await login(code, "wrong-password");
      const locked = await login(code);
      expect(locked.status).toBe(429);
      expect(locked.body).toEqual({ error: { code: "TOO_MANY_ATTEMPTS", message: LOGIN_TOO_MANY_MESSAGE } });
      await prisma.user.update({ where: { id: p.userId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
      await clearRateLimits();
    });

    it("an unknown number, a wrong password and an invited account are indistinguishable: body, status and timing", async () => {
      const active = await person(`IA${uniq()}`);
      const invited = await person(`II${uniq()}`, { status: "INVITED" });
      const cases = {
        unknown: () => login(`NOBODY-${uniq()}`, "Whatever123"),
        wrongPassword: () => login(active.employeeCode, "Wrong-Pass-1"),
        invited: () => login(invited.employeeCode, "Whatever123"),
      };
      const bodies: Record<string, unknown> = {};
      const statuses: Record<string, number> = {};
      const times: Record<string, number[]> = { unknown: [], wrongPassword: [], invited: [] };
      const SAMPLES = 4;
      for (let i = 0; i < SAMPLES; i++) {
        for (const [name, run] of Object.entries(cases)) {
          await clearRateLimits();
          const t0 = process.hrtime.bigint();
          const res = await run();
          times[name]!.push(Number(process.hrtime.bigint() - t0) / 1e6);
          bodies[name] = res.body;
          statuses[name] = res.status;
        }
        // Keep the wrong-password account below the lockout threshold so every sample takes the same path.
        await prisma.user.update({ where: { id: active.userId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
      }
      expect(statuses).toEqual({ unknown: 401, wrongPassword: 401, invited: 401 });
      expect(bodies.wrongPassword).toEqual(bodies.unknown);
      expect(bodies.invited).toEqual(bodies.unknown);
      expect(bodies.unknown).toEqual({ error: { code: "INVALID_CREDENTIALS", message: LOGIN_FAILED_MESSAGE } });
      expect(LOGIN_FAILED_MESSAGE).toBe("The employee number or password is not correct.");
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      for (const x of Object.values(times).flat()) expect(x).toBeGreaterThanOrEqual(LOGIN_FAILURE_MIN_DURATION_MS - 5);
      // The same tolerance as the Forgot password timing test: no consistent gap of 100 ms or more between any two cases.
      const avgs = Object.values(times).map(avg);
      expect(Math.max(...avgs) - Math.min(...avgs)).toBeLessThan(100);
    });

    // Follow-up 2: a locked real account and an over-limit number nobody holds get the same reply, with the same status and timing.
    it("over the limit, a real (locked) number and a non-existent number get an identical reply: body, status and timing", async () => {
      const real = await person(`LR${uniq()}`);
      const ghost = `LG${uniq()}`;
      await clearIpCounters();
      for (let i = 0; i < 5; i++) {
        await login(real.employeeCode, "Wrong-Pass-1");
        await login(ghost, "Wrong-Pass-1");
      }
      await clearIpCounters();
      const cases = {
        realLocked: () => login(real.employeeCode, TEST_PASSWORD), // even the right password is refused while locked
        realLockedWrong: () => login(real.employeeCode, "Wrong-Pass-1"),
        ghost: () => login(ghost, "Wrong-Pass-1"),
        ghostLowerCaseSpaces: () => login(`  ${ghost.toLowerCase()} `, "Wrong-Pass-1"), // counted as typed, normalised like login
      };
      const bodies: Record<string, unknown> = {};
      const statuses: Record<string, number> = {};
      const times: Record<string, number[]> = { realLocked: [], realLockedWrong: [], ghost: [], ghostLowerCaseSpaces: [] };
      for (let i = 0; i < 4; i++) {
        for (const [name, run] of Object.entries(cases)) {
          await clearIpCounters();
          const t0 = process.hrtime.bigint();
          const res = await run();
          times[name]!.push(Number(process.hrtime.bigint() - t0) / 1e6);
          bodies[name] = res.body;
          statuses[name] = res.status;
        }
      }
      const expected = { error: { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts. Try again later or ask HR to unlock your account." } };
      for (const name of Object.keys(cases)) {
        expect(statuses[name], name).toBe(429);
        expect(bodies[name], name).toEqual(expected);
      }
      for (const x of Object.values(times).flat()) expect(x).toBeGreaterThanOrEqual(LOGIN_FAILURE_MIN_DURATION_MS - 5);
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const avgs = Object.values(times).map(avg);
      expect(Math.max(...avgs) - Math.min(...avgs)).toBeLessThan(100);

      // HR and directors still see, on their own screen, which real account is locked.
      for (const who of ["hr", "dir"]) {
        const access = await request(app).get(`/api/access/employees/${real.employeeId}`).set(...authHeader(t[who]!));
        expect(access.status, who).toBe(200);
        expect(access.body.locked, who).toBe(true);
      }
      await clearRateLimits();
    });

    // FIX-H2 (independent audit 2026-11-20): the per-IP limit is the directors' setting (default 100 in 15 minutes); set to 10 here (two made-up directors confirm
    // it) so the test needs only ten failures. The original assertion stands: over the limit a real number with the right password and an unknown number get the
    // same reply (2026-11-21: an exemption for numbers with no failures was removed, since it let a password spray run unlimited).
    it("the per-IP limit gives the same reply, for a real number with the right password and for an unknown one", async () => {
      const setLimit = async (maxAttempts: number) => {
        const pr = await prisma.behaviourProposal.create({ data: { key: "auth.loginIpFailureLimit", value: { maxAttempts, windowSeconds: 900 }, reason: "test", proposedByUserId: "test-director-a" } });
        await prisma.behaviourConfirmation.create({ data: { proposalId: pr.id, confirmedByUserId: "test-director-b" } });
      };
      const real = await person(`IP${uniq()}`);
      await clearRateLimits();
      await setLimit(10);
      try {
        for (let i = 0; i < 10; i++) await login(`IPGHOST-${uniq()}`, "Wrong-Pass-1"); // ten different numbers: no number reaches its own limit
        const a = await login(real.employeeCode, TEST_PASSWORD);
        const b = await login(`IPGHOST-${uniq()}`, "Wrong-Pass-1");
        expect([a.status, b.status]).toEqual([429, 429]);
        expect(a.body).toEqual(b.body);
        expect(a.body.error.message).toBe(LOGIN_TOO_MANY_MESSAGE);
        expect(JSON.stringify(a.body)).not.toMatch(/employee number\.\.\.|this employee number/i);
        await clearRateLimits();
        expect((await login(real.employeeCode, TEST_PASSWORD)).status).toBe(200); // a successful sign-in is not counted or slowed
      } finally {
        await setLimit(100);
      }
    });

    it("unlock still works: a director's unlock and the automatic unlock both let the right password in again", async () => {
      const real = await person(`UL${uniq()}`);
      await clearIpCounters();
      for (let i = 0; i < 5; i++) await login(real.employeeCode, "Wrong-Pass-1");
      expect((await login(real.employeeCode)).status).toBe(429);
      // A director unlocks (with a reason); the counter goes too, so the right password works at once, and the unlock is audited.
      const unlock = await request(app).post(`/api/access/employees/${real.employeeId}/unlock`).set(...authHeader(t.dir!)).send({ reason: "Forgot the new password" });
      expect(unlock.status).toBe(200);
      expect(unlock.body.locked).toBe(false);
      expect(await prisma.auditLog.count({ where: { action: "auth.unlocked_by_admin", entityId: real.userId } })).toBe(1);
      await clearIpCounters();
      expect((await login(real.employeeCode)).status).toBe(200);

      // Locked again, then left to run out: the counter expires and the recorded lock passes, as at the end of the 15 minutes.
      await clearIpCounters();
      for (let i = 0; i < 5; i++) await login(real.employeeCode, "Wrong-Pass-1");
      expect((await login(real.employeeCode)).status).toBe(429);
      const { redis } = await import("../../../lib/redis");
      await redis.pexpire(`ratelimit:auth.loginFail.id:${real.employeeCode.toLowerCase()}`, 50);
      await prisma.user.update({ where: { id: real.userId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await clearIpCounters();
      expect((await login(real.employeeCode)).status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: real.userId } });
      expect(after.failedLoginAttempts).toBe(0);
    });

    it("matches exactly after trimming spaces and ignoring case; leading zeros and letters are kept", async () => {
      const code = `0486Ab${uniq()}`;
      await person(code);
      for (const typed of [code, `  ${code}  `, code.toLowerCase(), code.toUpperCase()]) {
        await clearRateLimits();
        const res = await login(typed);
        expect(res.status, typed).toBe(200);
        expect(res.body.user.employeeCode).toBe(code);
      }
      // Leading zeros matter: "486Ab…" is a different number from "0486Ab…".
      await clearRateLimits();
      expect((await login(code.slice(1))).status).toBe(401);
    });

    it("treats % and _ literally (no wildcard can match someone else's number)", async () => {
      const code = `W1${uniq()}`;
      await person(code);
      expect(await findEmployeeIdByLoginId(`W_${code.slice(2)}`)).toBeNull();
      expect(await findEmployeeIdByLoginId(`W1%`)).toBeNull();
      expect(await findEmployeeIdByLoginId("%")).toBeNull();
      expect((await login(`${code.slice(0, 2)}%`)).status).toBe(401);
    });

    it("the database refuses two numbers that differ only in case or spaces", async () => {
      const code = `CI${uniq()}`;
      await person(code);
      const dup = await createFullTestEmployee(org);
      employeeIds.push(dup.employeeId);
      await expect(prisma.employee.update({ where: { id: dup.employeeId }, data: { employeeCode: code.toLowerCase() } })).rejects.toThrow();
      await expect(prisma.employee.update({ where: { id: dup.employeeId }, data: { employeeCode: ` ${code}` } })).rejects.toThrow();
    });
  });

  // ── 2. Forgot password by number ──────────────────────────────────────

  describe("forgot password by employee number", () => {
    it("gives the same status and words for every case: known active, known invited, no email, suspended, unknown", async () => {
      const cases = [
        (await person(`FA${uniq()}`)).employeeCode,
        (await person(`FI${uniq()}`, { status: "INVITED" })).employeeCode,
        (await person(`FN${uniq()}`, { email: null })).employeeCode,
        (await person(`FS${uniq()}`, { status: "SUSPENDED" })).employeeCode,
        `UNKNOWN-${uniq()}`,
      ];
      const replies = [];
      for (const c of cases) {
        await clearRateLimits();
        const res = await forgot(c);
        replies.push({ status: res.status, body: res.body });
      }
      for (const r of replies) expect(r).toEqual({ status: 200, body: { message: FORGOT_PASSWORD_REPLY } });
      expect(FORGOT_PASSWORD_REPLY).toBe("If that account exists, a link has been sent to the email on record.");
    });

    it("takes the same time for a known and an unknown number (both padded to the floor, no consistent gap)", async () => {
      const known = await person(`FT${uniq()}`);
      const noEmail = await person(`FTN${uniq()}`, { email: null });
      const time = async (code: string) => {
        await clearRateLimits();
        const start = process.hrtime.bigint();
        await forgot(code);
        return Number(process.hrtime.bigint() - start) / 1e6;
      };
      const k: number[] = [];
      const u: number[] = [];
      const n: number[] = [];
      for (let i = 0; i < 4; i++) {
        k.push(await time(known.employeeCode));
        u.push(await time(`NOBODY-${uniq()}`));
        n.push(await time(noEmail.employeeCode));
      }
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      for (const x of [...k, ...u, ...n]) expect(x).toBeGreaterThanOrEqual(FORGOT_PASSWORD_MIN_DURATION_MS - 5);
      expect(Math.abs(avg(k) - avg(u))).toBeLessThan(100);
      expect(Math.abs(avg(n) - avg(u))).toBeLessThan(100);
    });

    it("sends the link only to the email on record, never to an address typed in", async () => {
      const p = await person(`FE${uniq()}`, { email: "on.record@example.com" });
      const res = await forgot(p.employeeCode, { email: "attacker@example.net", to: "attacker@example.net" });
      expect(res.status).toBe(200);
      expect(sent.map((m) => m.to)).toEqual(["on.record@example.com"]);
    });

    it("stores only a hash of the token; the raw token is nowhere in the database or the audit log", async () => {
      const p = await person(`FH${uniq()}`);
      await forgot(p.employeeCode);
      const raw = linkToken(sent[0]!.text, "reset-password");
      const rows = await prisma.passwordResetToken.findMany({ where: { userId: p.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).toBe(sha256(raw));
      expect(rows[0]!.tokenHash).not.toContain(raw);
      const audits = await prisma.auditLog.findMany({ where: { OR: [{ entityId: p.userId }, { entityId: p.employeeId }] } });
      expect(audits.map((a) => a.action)).toContain("auth.forgot_password.requested");
      expect(JSON.stringify(audits)).not.toContain(raw);
      expect(JSON.stringify(audits)).not.toContain(sha256(raw));
    });

    it("the link is single use, and expires (60 minutes by default, a setting)", async () => {
      const p = await person(`FU${uniq()}`);
      await forgot(p.employeeCode);
      const raw = linkToken(sent[0]!.text, "reset-password");
      const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: p.userId } });
      const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
      expect(minutes).toBeGreaterThan(59);
      expect(minutes).toBeLessThan(61);

      const first = await request(app).post(`/api/auth/reset-password/${raw}`).send({ password: NEW_PASSWORD });
      expect(first.status).toBe(200);
      await clearRateLimits();
      const again = await request(app).post(`/api/auth/reset-password/${raw}`).send({ password: "AnotherPass77" });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe("INVALID_RESET_TOKEN");
      await clearRateLimits();
      expect((await login(p.employeeCode, NEW_PASSWORD)).status).toBe(200);

      // An expired link is refused even though it was never used.
      await clearRateLimits();
      await forgot(p.employeeCode);
      const raw2 = linkToken(sent[1]!.text, "reset-password");
      await prisma.passwordResetToken.update({ where: { tokenHash: sha256(raw2) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await request(app).post(`/api/auth/reset-password/${raw2}`).send({ password: "AnotherPass77" });
      expect(expired.status).toBe(400);
      expect(expired.body.error.code).toBe("INVALID_RESET_TOKEN");
    });

    // Changed 2026-11-19 (final merge, audit #13; CHANGED_TESTS.md): the link lifetime is now a two-director Default behaviour
    // (auth.passwordResetLinkMinutes). This test set the old single-director System Settings key; the same check lives in signInLifetimes.test.ts.
    it("a link lasts the default 60 minutes while the director setting is not changed", async () => {
      const p = await person(`FX${uniq()}`);
      await forgot(p.employeeCode);
      const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: p.userId } });
      const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
      expect(minutes).toBeGreaterThan(59);
      expect(minutes).toBeLessThan(61);
    });

    it("a suspended account gets no link, and an old link stops working once the account is suspended", async () => {
      const p = await person(`FZ${uniq()}`);
      await forgot(p.employeeCode);
      const raw = linkToken(sent[0]!.text, "reset-password");
      await prisma.user.update({ where: { id: p.userId }, data: { status: "SUSPENDED" } });
      const res = await request(app).post(`/api/auth/reset-password/${raw}`).send({ password: NEW_PASSWORD });
      expect(res.status).toBe(400);
      await clearRateLimits();
      sent = [];
      await forgot(p.employeeCode);
      expect(sent).toHaveLength(0);
    });

    it("no email on record: sends nothing, and HR is told 'No email on record for employee <number>'", async () => {
      const p = await person(`NE${uniq()}`, { email: null });
      const res = await forgot(p.employeeCode);
      expect(res.body).toEqual({ message: FORGOT_PASSWORD_REPLY });
      expect(sent).toHaveLength(0);
      expect(await prisma.passwordResetToken.count({ where: { userId: p.userId } })).toBe(0);
      expect(await prisma.loginEmailMissingNotice.findUnique({ where: { employeeId: p.employeeId } })).toMatchObject({ requestCount: 1 });
      const note = await prisma.notification.findFirst({ where: { userId: people.hr!.userId, type: "auth.no_email_on_record", title: { contains: p.employeeCode } } });
      expect(note?.title).toBe(`No email on record for employee ${p.employeeCode}`);
      // HR sees it on the employee screen too.
      const profile = await request(app).get(`/api/employees/${p.employeeId}`).set(...authHeader(t.hr!));
      expect(profile.body).toMatchObject({ noEmailOnRecord: true });
      expect(profile.body.emailMissingRequestedAt).toBeTruthy();
      // "Send setup link" says so plainly instead of pretending to send.
      await prisma.user.update({ where: { id: p.userId }, data: { status: "INVITED", passwordHash: null } });
      const resend = await request(app).post(`/api/employees/${p.employeeId}/resend-invite`).set(...authHeader(t.hr!));
      expect(resend.status).toBe(409);
      expect(resend.body.error.message).toContain(`No email on record for employee ${p.employeeCode}`);
      expect(sent).toHaveLength(0);
    });

    it("rate limits per employee number (known or unknown alike) and per IP, with plain messages", async () => {
      const p = await person(`RL${uniq()}`);
      for (const code of [p.employeeCode, `UNKNOWN-${uniq()}`]) {
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
          await prisma.$executeRaw`SELECT 1`; // keep each request separate in time
          const keys = await import("../../../lib/redis").then(async ({ redis }) => redis.keys("ratelimit:auth.rateLimit.forgotPassword:*"));
          if (keys.length) await import("../../../lib/redis").then(async ({ redis }) => redis.del(...keys)); // clear only the per-IP counter
          statuses.push((await forgot(code)).status);
        }
        expect(statuses, code).toEqual([200, 200, 200, 429]);
      }
      const limited = await forgot(p.employeeCode);
      expect(limited.body.error.message).toBe("Too many requests for this employee number. Please wait an hour and try again, or ask HR.");

      await clearRateLimits();
      const ip: number[] = [];
      for (let i = 0; i < 6; i++) ip.push((await forgot(`IP-${uniq()}`)).status);
      expect(ip).toEqual([200, 200, 200, 200, 200, 429]);
      const ipLimited = await forgot(`IP-${uniq()}`);
      expect(ipLimited.body.error.message).toBe("Too many requests. Please try again later.");
    });
  });

  // ── 3. HR flow: create → invited → set password → log in ───────────────

  describe("HR creates the person; they set a password with their number", () => {
    function payload(code: string, email: string) {
      createdCodes.push(code);
      return {
        official: { deviceUserId: code, employeeCode: code, dateOfJoining: "2026-01-15", departmentId: org.departmentId, designationId: org.designationId, locationId: org.locationId, employmentType: "PERMANENT" as const, attendanceCapture: "DEVICE" as const },
        personal: { fullName: "Setup Person", dateOfBirth: "1995-06-01", gender: "OTHER" as const, personalEmail: email, mobile: "9876543210", currentAddress: "Some address", permanentAddress: "Some address", emergencyContactName: "Emergency Contact", emergencyContactPhone: "9876543211", emergencyContactRelation: "Parent" },
      };
    }

    it("end to end via Forgot password: invited with no password, then the number + link activates the account", async () => {
      const code = `0${Math.floor(Math.random() * 1e6)}`.padStart(7, "0");
      const created = await request(app).post("/api/employees").set(...authHeader(t.hr!)).send(payload(code, "setup.person.test@example.invalid"));
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const user = await prisma.user.findFirstOrThrow({ where: { employee: { employeeCode: code } } });
      expect([user.status, user.passwordHash]).toEqual(["INVITED", null]);
      // The setup link sent on creation lasts 7 days by default.
      const invite = await prisma.invitationToken.findFirstOrThrow({ where: { userId: user.id } });
      const hours = (invite.expiresAt.getTime() - invite.createdAt.getTime()) / 3_600_000;
      expect(hours).toBeGreaterThan(167);
      expect(hours).toBeLessThan(169);
      // HR's view: status Invited, the number labelled as login and machine ID, the machine ID matching.
      const profile = await request(app).get(`/api/employees/${created.body.id}`).set(...authHeader(t.hr!));
      expect(profile.body).toMatchObject({ accountStatus: "INVITED", employeeCode: code, deviceUserId: code, loginIdMatchesMachine: true, noEmailOnRecord: false });
      expect(JSON.stringify(profile.body)).not.toMatch(/passwordHash|tokenHash|password_hash|token_hash/);

      // The person: Forgot password with their number (typed with spaces), the link from the email, a password, then login.
      sent = [];
      await forgot(`  ${code} `);
      expect(sent.map((m) => m.to)).toEqual(["setup.person.test@example.invalid"]);
      const raw = linkToken(sent[0]!.text, "reset-password");
      const set = await request(app).post(`/api/auth/reset-password/${raw}`).send({ password: NEW_PASSWORD });
      expect(set.status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.status).toBe("ACTIVE");
      // The setup link sent earlier is used up now.
      expect((await prisma.invitationToken.findUniqueOrThrow({ where: { id: invite.id } })).usedAt).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { action: "auth.account.activated_by_reset", entityId: user.id } })).toBe(1);
      await clearRateLimits();
      const ok = await login(code, NEW_PASSWORD);
      expect(ok.status).toBe(200);
      expect((await request(app).get(`/api/employees/${created.body.id}`).set(...authHeader(t.hr!))).body.accountStatus).toBe("ACTIVE");
    });

    it("end to end via HR's Send setup link: one link, single use, then login", async () => {
      const code = `S${uniq()}`;
      const created = await request(app).post("/api/employees").set(...authHeader(t.hr!)).send(payload(code, "setup.two.test@example.invalid"));
      expect(created.status).toBe(201);
      sent = [];
      const resend = await request(app).post(`/api/employees/${created.body.id}/resend-invite`).set(...authHeader(t.hr!));
      expect(resend.status).toBe(200);
      expect(sent.map((m) => m.to)).toEqual(["setup.two.test@example.invalid"]);
      const raw = linkToken(sent[0]!.text, "set-password");
      const accept = await request(app).post(`/api/auth/invitations/${raw}/accept`).send({ password: NEW_PASSWORD });
      expect(accept.status).toBe(200);
      await clearRateLimits();
      const reuse = await request(app).post(`/api/auth/invitations/${raw}/accept`).send({ password: "AnotherPass77" });
      expect(reuse.status).toBe(400);
      await clearRateLimits();
      expect((await login(code.toLowerCase(), NEW_PASSWORD)).status).toBe(200);
    });

    it("refuses a new employee whose number differs from an existing one only by case", async () => {
      const code = `Dup${uniq()}`;
      expect((await request(app).post("/api/employees").set(...authHeader(t.hr!)).send(payload(code, "dup.one.test@example.invalid"))).status).toBe(201);
      const second = await request(app).post("/api/employees").set(...authHeader(t.hr!)).send({ ...payload(code.toUpperCase(), "dup.two.test@example.invalid"), official: { ...payload(code.toUpperCase(), "dup.x.test@example.invalid").official, deviceUserId: `${code}-2` } });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("EMPLOYEE_CODE_TAKEN");
    });
  });

  // ── 5. Permissions ────────────────────────────────────────────────────

  describe("who may do what", () => {
    it("only a director changes an employee number, with a reason, audited, warned about the machine", async () => {
      const p = await person(`CH${uniq()}`);
      const next = `CH${uniq()}`;
      const path = `/api/employees/${p.employeeId}/employee-code`;
      for (const who of ["hr", "hrx", "emp", "dev"]) {
        const res = await request(app).post(path).set(...authHeader(t[who]!)).send({ employeeCode: next, reason: "Machine ID was entered wrongly" });
        expect(res.status, who).toBe(403);
      }
      expect((await request(app).post(path).set(...authHeader(t.dir!)).send({ employeeCode: next })).status).toBe(400); // no reason
      const taken = await request(app).post(path).set(...authHeader(t.dir!)).send({ employeeCode: people.emp!.employeeCode.toLowerCase(), reason: "Trying a taken number" });
      expect(taken.status).toBe(409);

      const ok = await request(app).post(path).set(...authHeader(t.dir!)).send({ employeeCode: next, reason: "Machine ID was entered wrongly" });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ employeeCode: next, previousEmployeeCode: p.employeeCode });
      expect(ok.body.warning).toContain("must match the attendance machine");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "employee.code_changed", entityId: p.employeeId } });
      expect(audit.actorUserId).toBe(people.dir!.userId);
      expect(audit.before).toMatchObject({ employeeCode: p.employeeCode });
      expect(audit.after).toMatchObject({ employeeCode: next, reason: "Machine ID was entered wrongly" });
      // The person now signs in with the new number; the old one no longer works.
      await clearRateLimits();
      expect((await login(next)).status).toBe(200);
      await clearRateLimits();
      expect((await login(p.employeeCode)).status).toBe(401);
      // The machine ID was not changed, so the screen now warns that they differ.
      const profile = await request(app).get(`/api/employees/${p.employeeId}`).set(...authHeader(t.hr!));
      expect(profile.body).toMatchObject({ deviceUserId: p.employeeCode, loginIdMatchesMachine: false });
    });

    // The Developer can already open the profile route and sees the personal email there: that predates this work and is reported in
    // LOGIN_REPORT.md (it lives in the access resolver, which this session may not edit). What this checks is that nothing new leaks a password or token.
    it("an employee cannot read another person's record; no role sees a password hash or token", async () => {
      const other = await person(`OT${uniq()}`);
      const asEmp = await request(app).get(`/api/employees/${other.employeeId}`).set(...authHeader(t.emp!));
      expect([403, 404]).toContain(asEmp.status);
      const asDev = await request(app).get(`/api/employees/${other.employeeId}`).set(...authHeader(t.dev!));
      const devText = JSON.stringify(asDev.body);
      expect(devText).not.toMatch(/passwordHash|tokenHash|password_hash|token_hash/);
      const asHr = await request(app).get(`/api/employees/${other.employeeId}`).set(...authHeader(t.hr!));
      expect(asHr.status).toBe(200);
      expect(JSON.stringify(asHr.body)).not.toMatch(/passwordHash|tokenHash|password_hash|token_hash/);
    });
  });
});
