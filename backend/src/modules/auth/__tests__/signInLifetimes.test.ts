import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { hashRefreshToken } from "../tokens";
import {
  TEST_PASSWORD,
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  clearRateLimits,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// Final merge 2026-11-19 (audit #13, docs/plans/FINAL_MERGE_REPORT.md): the Forgot-password link lifetime and "stay signed in" are director settings in Default
// behaviours (one director proposes, a different one confirms), shown as "Default in use: ..." until then; the refresh cookie expires exactly when the token row
// does, so the two can never disagree. Made-up people.
const DAY = 24 * 60 * 60 * 1000;

describe("sign-in lifetimes are director settings, and the cookie follows the session", () => {
  let org: TestOrgMasters;
  const p: Record<string, { employeeId: string; employeeCode: string; userId: string }> = {};
  const t: Record<string, string> = {};
  const proposals: string[] = [];

  const login = async (code: string) => {
    await clearRateLimits();
    return request(app).post("/api/auth/login").send({ employeeCode: code, password: TEST_PASSWORD });
  };
  const cookieOf = (res: request.Response) => {
    const raw = (res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith("refreshToken="));
    if (!raw) throw new Error("no refresh cookie");
    const value = raw.split(";")[0]!.slice("refreshToken=".length);
    const expires = /Expires=([^;]+)/i.exec(raw)?.[1];
    return { pair: raw.split(";")[0]!, value, expires: expires ? new Date(expires).getTime() : NaN };
  };
  const rowFor = (raw: string) => prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(raw) } });
  const propose = async (who: string, key: string, value: unknown) => {
    const res = await request(app).post(`/api/behaviours/${key}/proposals`).set(...authHeader(t[who]!)).send({ value, reason: "TEST value for the test" });
    if (res.status === 201) proposals.push(res.body.id as string);
    return res;
  };
  const confirm = (who: string, id: string) => request(app).post(`/api/behaviours/proposals/${id}/confirm`).set(...authHeader(t[who]!));

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE], ["emp", undefined]] as const) {
      p[k] = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      t[k] = await loginAs(p[k]!.employeeCode);
    }
  }, 120_000);

  afterAll(async () => {
    await deleteWithDependents("BehaviourProposal", proposals);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("until set: both are listed as \"Default in use\" with the conventional value, and the session and its cookie last 30 days", async () => {
    const list = (await request(app).get("/api/behaviours").set(...authHeader(t.d1!))).body.behaviours as Array<{ key: string; state: string; label: string; value: unknown }>;
    expect(list.find((b) => b.key === "auth.passwordResetLinkMinutes")).toMatchObject({ state: "DEFAULT", label: "Default in use: 60 minutes (1 hour)", value: 60 });
    expect(list.find((b) => b.key === "auth.staySignedInDays")).toMatchObject({ state: "DEFAULT", label: "Default in use: 30 days", value: 30 });
    const res = await login(p.emp!.employeeCode);
    expect(res.status).toBe(200);
    const c = cookieOf(res);
    const row = await rowFor(c.value);
    expect(Math.abs(c.expires - row.expiresAt.getTime())).toBeLessThan(1500); // the cookie header has second precision
    expect((row.expiresAt.getTime() - row.createdAt.getTime()) / DAY).toBeCloseTo(30, 1);
  });

  it("only a director proposes; HR, an employee and the Developer are refused; the proposer never confirms; out-of-range values are refused", async () => {
    expect((await propose("hr", "auth.staySignedInDays", 7)).status).toBe(403);
    expect((await propose("emp", "auth.staySignedInDays", 7)).status).toBe(403);
    expect((await propose("dev", "auth.staySignedInDays", 7)).status).toBe(403);
    expect((await propose("d1", "auth.staySignedInDays", 0)).status).toBe(400);
    expect((await propose("d1", "auth.staySignedInDays", 91)).status).toBe(400);
    expect((await propose("d1", "auth.passwordResetLinkMinutes", 4)).status).toBe(400);
    const ok = await propose("d1", "auth.staySignedInDays", 7);
    expect(ok.status).toBe(201);
    expect((await confirm("d1", ok.body.id)).status).toBe(403);
    // Waiting for a second director: still 30 days.
    const before = await rowFor(cookieOf(await login(p.emp!.employeeCode)).value);
    expect((before.expiresAt.getTime() - before.createdAt.getTime()) / DAY).toBeCloseTo(30, 1);
    expect((await confirm("hr", ok.body.id)).status).toBe(403);
    expect((await confirm("d2", ok.body.id)).status).toBe(200);
  });

  it("once confirmed: a new session, and a refreshed one, last the new number of days, and the cookie always equals the token row", async () => {
    const res = await login(p.emp!.employeeCode);
    const c = cookieOf(res);
    const row = await rowFor(c.value);
    expect((row.expiresAt.getTime() - row.createdAt.getTime()) / DAY).toBeCloseTo(7, 1);
    expect(Math.abs(c.expires - row.expiresAt.getTime())).toBeLessThan(1500);
    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", c.pair);
    expect(refreshed.status).toBe(200);
    const c2 = cookieOf(refreshed);
    const row2 = await rowFor(c2.value);
    expect((row2.expiresAt.getTime() - row2.createdAt.getTime()) / DAY).toBeCloseTo(7, 1);
    expect(Math.abs(c2.expires - row2.expiresAt.getTime())).toBeLessThan(1500);
    const list = (await request(app).get("/api/behaviours").set(...authHeader(t.d1!))).body.behaviours as Array<{ key: string; state: string; label: string | null }>;
    expect(list.find((b) => b.key === "auth.staySignedInDays")).toMatchObject({ state: "CONFIRMED", label: null });
    // Put the conventional value back for the rest of the suite (append-only: a newer confirmed proposal; the rows are purged in afterAll).
    const back = await propose("d2", "auth.staySignedInDays", 30);
    expect((await confirm("d1", back.body.id)).status).toBe(200);
  });

  it("the Forgot-password link follows the confirmed number of minutes", async () => {
    const ok = await propose("d1", "auth.passwordResetLinkMinutes", 15);
    expect((await confirm("d2", ok.body.id)).status).toBe(200);
    try {
      await clearRateLimits();
      expect((await request(app).post("/api/auth/forgot-password").send({ employeeCode: p.emp!.employeeCode })).status).toBe(200);
      const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: p.emp!.userId }, orderBy: { createdAt: "desc" } });
      const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThan(16);
    } finally {
      const back = await propose("d2", "auth.passwordResetLinkMinutes", 60);
      await confirm("d1", back.body.id);
    }
  });

  it("the old single-director System Settings field is gone: not shown, and sending it changes nothing", async () => {
    expect((await request(app).get("/api/settings/security").set(...authHeader(t.d1!))).body).not.toHaveProperty("passwordResetTtlMinutes");
    const stored = async () => (await prisma.systemSetting.findUnique({ where: { key: "auth.passwordResetTtlMinutes" } }))?.value ?? null;
    const before = await stored();
    await request(app).put("/api/settings/security").set(...authHeader(t.d1!)).send({ passwordResetTtlMinutes: 15 });
    expect(await stored()).toEqual(before);
  });
});
