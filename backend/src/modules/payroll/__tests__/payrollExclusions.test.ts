import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { excludedOn } from "../exclusions/service";
import { REAL_RULES, closeWorld, closingWorld, resetSeams, staffWith, type Closing } from "./closeTestHelpers";
import { CYCLE, calculateRun, setRules } from "./runTestHelpers";

// Stage 5b, B6: a person marked as not on payroll for a period, with a reason, confirmed by a different director. A run skips them and names them; HR sees nothing.

const row = (over: Partial<Parameters<typeof excludedOn>[0][number]> = {}) => ({ employeeId: "e1", kind: "EXCLUDE" as const, fromDate: "2026-08-01", toDate: null, createdAt: "2026-07-01T00:00:00Z", confirmed: true, ...over });

describe("who is excluded on a day (pure)", () => {
  it("nobody is, by default; an unconfirmed entry counts for nothing", () => {
    expect(excludedOn([], "2026-08-31").size).toBe(0);
    expect(excludedOn([row({ confirmed: false })], "2026-08-31").size).toBe(0);
  });
  it("from its start date until its end date, inclusive, or until further notice", () => {
    const r = row({ fromDate: "2026-08-10", toDate: "2026-08-20" });
    expect([excludedOn([r], "2026-08-09").size, excludedOn([r], "2026-08-10").size, excludedOn([r], "2026-08-20").size, excludedOn([r], "2026-08-21").size]).toEqual([0, 1, 1, 0]);
    expect(excludedOn([row()], "2030-01-01").size).toBe(1);
  });
  it("a later entry, in either order they arrive, decides: an INCLUDE puts the person back, an EXCLUDE again takes them off", () => {
    const rows = [row(), row({ kind: "INCLUDE", fromDate: "2026-08-15", createdAt: "2026-08-14T00:00:00Z" }), row({ fromDate: "2026-08-25", createdAt: "2026-08-24T00:00:00Z" })];
    for (const order of [rows, [...rows].reverse()]) {
      expect([excludedOn(order, "2026-08-14").size, excludedOn(order, "2026-08-15").size, excludedOn(order, "2026-08-24").size, excludedOn(order, "2026-08-25").size]).toEqual([1, 0, 0, 1]);
    }
  });
  it("on the same start date the entry made later decides", () => {
    const rows = [row({ createdAt: "2026-07-01T00:00:00Z" }), row({ kind: "INCLUDE", createdAt: "2026-07-02T00:00:00Z" })];
    expect(excludedOn(rows, "2026-08-31").size).toBe(0);
    expect(excludedOn([...rows].reverse(), "2026-08-31").size).toBe(0);
  });
});

describe("not on payroll, in a run", () => {
  let world: Closing;
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let tok: { dev: string; hr: string; employee: string };
  const who = (n: string) => world.named[n]!.employeeId;
  const maker = () => world.tokens.maker;
  const post = (t: string, path: string, body: object = {}) => request(app).post(`/api/payroll${path}`).set(...authHeader(t)).send(body);
  const get = (t: string, path: string) => request(app).get(`/api/payroll${path}`).set(...authHeader(t));
  const readiness = async () => (await get(maker(), `/runs/readiness?cycleStart=${CYCLE.start}`)).body;
  let entryId = "";
  let peopleBefore = 0;

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    world.userIds.push(dev.userId, hr.userId);
    tok = { dev: await loginAs(dev.employeeCode), hr: await loginAs(hr.employeeCode), employee: await loginAs(world.named.a!.employeeCode) };
  }, 600_000);
  afterAll(async () => {
    resetSeams();
    vi.restoreAllMocks();
    for (const x of [hr, dev]) await cleanupFullTestEmployee(x.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("directors only: HR, the Developer role and the employee are refused, and nobody is excluded by default", async () => {
    for (const t of Object.values(tok)) {
      expect((await get(t, "/exclusions")).status).toBe(403);
      expect((await post(t, "/exclusions", { employeeId: who("b"), kind: "EXCLUDE", fromDate: CYCLE.start, reason: "Not on payroll" })).status).toBe(403);
      expect((await post(t, "/exclusions/x/confirm")).status).toBe(403);
    }
    expect((await get(maker(), "/exclusions")).body.exclusions).toEqual([]);
    expect((await readiness()).skipped).toEqual([]);
    peopleBefore = (await readiness()).people; // everybody employed in the month, the directors of the test world included
  });

  it("an entry needs a reason and starts unconfirmed: the run still calculates the person until a different director confirms it", async () => {
    const body = { employeeId: who("b"), kind: "EXCLUDE", fromDate: CYCLE.start };
    expect((await post(maker(), "/exclusions", { ...body, reason: "x" })).status).toBe(400);
    expect((await post(maker(), "/exclusions", { ...body, reason: "On unpaid sabbatical", toDate: "2026-07-01" })).status).toBe(400); // ends before it starts
    expect((await post(maker(), "/exclusions", { ...body, reason: "On unpaid sabbatical", extra: 1 })).status).toBe(400);
    const added = await post(maker(), "/exclusions", { ...body, reason: "On unpaid sabbatical" });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    entryId = added.body.id;
    const r = await readiness();
    expect([r.skipped, r.people]).toEqual([[], peopleBefore]);
    const own = await post(maker(), `/exclusions/${entryId}/confirm`);
    expect([own.status, own.body.error.code]).toEqual([403, "CHECKER_IS_MAKER"]);
    // The database holds it too.
    await expect(prisma.payrollExclusion.update({ where: { id: entryId }, data: { confirmedByUserId: world.maker.userId, confirmedAt: new Date() } })).rejects.toThrow(/PAYROLL_EXCLUSION_SELF_CONFIRM/);
    await expect(prisma.payrollExclusion.update({ where: { id: entryId }, data: { reason: "changed" } })).rejects.toThrow(/PAYROLL_EXCLUSION_APPEND_ONLY/);
    await expect(prisma.payrollExclusion.delete({ where: { id: entryId } })).rejects.toThrow(/PAYROLL_EXCLUSION_APPEND_ONLY/);
    await expect(prisma.payrollExclusion.create({ data: { employeeId: who("c"), kind: "EXCLUDE", fromDate: new Date(`${CYCLE.start}T00:00:00Z`), reason: "sneaky", madeByUserId: hr.userId } })).rejects.toThrow(/PAYROLL_EXCLUSION_DIRECTORS_ONLY/);
    expect(await prisma.notification.count({ where: { userId: world.checkerA.userId, type: { contains: "director" } } })).toBeGreaterThanOrEqual(0);
  });

  let before = "";
  it("a different director confirms it; the run then skips the person and names them, and its figures change", async () => {
    const run = await post(maker(), "/runs", { cycleStart: CYCLE.start });
    const runId = run.body.id as string;
    before = (await post(maker(), `/runs/${runId}/calculate-preview`)).body.fingerprint ?? "";
    expect((await post(world.tokens.checkerA, `/exclusions/${entryId}/confirm`)).status).toBe(200);
    expect((await post(world.tokens.checkerA, `/exclusions/${entryId}/confirm`)).body.error.code).toBe("ALREADY_CONFIRMED");
    const r = await readiness();
    expect(r.people).toBe(peopleBefore - 1);
    expect(r.skipped).toEqual([expect.objectContaining({ employeeId: who("b"), reason: "On unpaid sabbatical" })]);
    const after = await post(maker(), `/runs/${runId}/calculate-preview`);
    expect(after.body.fingerprint).not.toBe(before); // an approved run cannot silently drift: the exclusion moves its hash
    expect(after.body.people).toBe(peopleBefore - 1);
    expect((await get(maker(), `/runs/${runId}`)).body.skipped).toEqual([expect.objectContaining({ employeeCode: world.named.b!.employeeCode })]);
    await post(maker(), `/runs/${runId}/void`, { reason: "test" });
    expect((await get(tok.hr, `/runs/${runId}`)).status).toBe(403); // HR sees nothing of it
  });

  it("a calculated run has no line for the skipped person, and it is effective-dated: an entry that puts them back brings them in again", async () => {
    const runId = await calculateRun(world);
    const items = (await get(maker(), `/runs/${runId}/items`)).body.items.map((i: { employeeId: string }) => i.employeeId);
    expect(items).toContain(who("a"));
    expect(items).not.toContain(who("b"));
    const back = await post(maker(), "/exclusions", { employeeId: who("b"), kind: "INCLUDE", fromDate: "2026-08-15", reason: "Back from sabbatical" });
    expect((await readiness()).skipped).toHaveLength(1); // not until confirmed
    expect((await post(world.tokens.checkerB, `/exclusions/${back.body.id}/confirm`)).status).toBe(200);
    expect((await readiness()).skipped).toEqual([]);
    expect((await get(maker(), "/exclusions")).body.exclusions.map((e: { kind: string; confirmed: boolean }) => [e.kind, e.confirmed]).sort()).toEqual([["EXCLUDE", true], ["INCLUDE", true]]);
  });
});
