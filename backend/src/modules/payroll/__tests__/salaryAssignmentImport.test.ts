import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { groupsOf } from "../salary/assignmentImport";
import { FIRST_SALARY_DAY, buildSalaryWorld, teardownSalaryWorld, type SalaryWorld } from "./salaryTestHelpers";

// IE-09 (docs/plans/A_PARITY_ROWS.md): salary assignments from our own template become ordinary revisions, each waiting for a different director. Made-up people
// and figures only.
describe("IE-09 — grouping", () => {
  it("every row lands in exactly one group, and a group's people share structure, version, CTC and date", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.record({ employeeId: fc.uuid(), structureKey: fc.constantFrom("S_A", "S_B"), structureVersion: fc.constantFrom(1, 2), annualCtc: fc.constantFrom("600000", "900000.50"), effectiveFrom: fc.constantFrom("2026-04-01", "2026-05-01") }), { selector: (r) => r.employeeId, maxLength: 60 }), (rows) => {
        const groups = groupsOf(rows);
        expect(groups.reduce((s, g) => s + g.employeeIds.length, 0)).toBe(rows.length);
        for (const r of rows) {
          const mine = groups.filter((g) => g.employeeIds.includes(r.employeeId));
          expect(mine).toHaveLength(1);
          expect(mine[0]).toMatchObject({ structureKey: r.structureKey, structureVersion: r.structureVersion, annualCtc: r.annualCtc, effectiveFrom: r.effectiveFrom });
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("IE-09 — over the routes", () => {
  let world: SalaryWorld;
  let dev: { employeeId: string; userId: string; employeeCode: string };
  const tok: Record<string, string> = {};
  const csv = (rows: string[][]) => Buffer.from(["Employee Number,Structure,Structure Version,Annual CTC,Effective From", ...rows.map((r) => r.join(","))].join("\n"));
  const upload = (t: string, path: string, file: Buffer, fields: Record<string, string> = {}) => {
    let r = request(app).post(`/api/payroll/salary/import/${path}`).set(...authHeader(t));
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach("file", file, "assignments.csv");
  };

  beforeAll(async () => {
    world = await buildSalaryWorld();
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    world.userIds.push(dev.userId);
    tok.dev = await loginAs(dev.employeeCode);
    tok.emp = await loginAs(world.staff[0]!.employeeCode);
  }, 300_000);

  afterAll(async () => {
    await cleanupFullTestEmployee(dev.employeeId);
    await teardownSalaryWorld(world);
  }, 300_000);

  it("HR, an employee and the Developer are refused the template, the preview and the commit; no sign-in is refused", async () => {
    const file = csv([[world.staff[0]!.employeeCode, world.structure, "1", "600000", FIRST_SALARY_DAY]]);
    for (const t of [world.tokens.outsider, tok.emp!, tok.dev!]) {
      expect((await request(app).get("/api/payroll/salary/import/template").set(...authHeader(t))).status).toBe(403);
      expect((await upload(t, "preview", file)).status).toBe(403);
      expect((await upload(t, "commit", file, { fingerprint: "0".repeat(64), note: "test" })).status).toBe(403);
    }
    expect((await request(app).post("/api/payroll/salary/import/preview").attach("file", file, "a.csv")).status).toBe(401);
  });

  it("the preview says what is wrong with each row and writes nothing; the commit refuses a file with problems or a different file", async () => {
    const [a, b] = world.staff;
    const bad = csv([[a!.employeeCode, world.structure, "1", "600000", FIRST_SALARY_DAY], ["NOPE999", world.structure, "1", "600000", FIRST_SALARY_DAY], [b!.employeeCode, world.structure, "9", "600000", FIRST_SALARY_DAY], [a!.employeeCode, world.structure, "1", "7,00,000", FIRST_SALARY_DAY], [a!.employeeCode, world.structure, "1", "650000", FIRST_SALARY_DAY]]);
    const before = await prisma.payrollSalaryRevision.count();
    const p = await upload(world.tokens.maker, "preview", bad);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.rows.map((r: { problem: string | null }) => r.problem === null)).toEqual([true, false, false, false, false]);
    expect(p.body.rows[4].problem).toMatch(/twice/);
    expect(p.body.rows[2].problem).toMatch(/no version 9/);
    expect(await prisma.payrollSalaryRevision.count()).toBe(before);
    expect((await upload(world.tokens.maker, "commit", bad, { fingerprint: p.body.fingerprint, note: "test file" })).body.error.code).toBe("ROWS_WITH_PROBLEMS");
    const good = csv([[a!.employeeCode, world.structure, "1", "600000", FIRST_SALARY_DAY]]);
    expect((await upload(world.tokens.maker, "commit", good, { fingerprint: p.body.fingerprint, note: "test file" })).body.error.code).toBe("PREVIEW_STALE");
    expect(await prisma.payrollSalaryRevision.count()).toBe(before);
    // All or nothing: one group that cannot be submitted (a salary from before the person joined) stops the whole file, including the clean group.
    const mixed = csv([[a!.employeeCode, world.structure, "1", "600000", FIRST_SALARY_DAY], [b!.employeeCode, world.structure, "1", "610000", "2023-06-01"]]);
    const mp = await upload(world.tokens.maker, "preview", mixed);
    expect(mp.body.groups.some((g: { blockers: string[] }) => g.blockers.length > 0), JSON.stringify(mp.body.groups)).toBe(true);
    expect((await upload(world.tokens.maker, "commit", mixed, { fingerprint: mp.body.fingerprint, note: "test file" })).body.error.code).toBe("REVISION_BLOCKED");
    expect(await prisma.payrollSalaryRevision.count()).toBe(before);
    const noCols = Buffer.from("Code,CTC\nX,1\n");
    expect((await upload(world.tokens.maker, "preview", noCols)).body.error.code).toBe("INVALID_FILE");
  });

  it("a clean file becomes one ordinary revision per group, each waiting for a different director; no salary row is written until it is decided and applied", async () => {
    const [a, b, c] = world.staff;
    const file = csv([
      [a!.employeeCode, world.structure, "1", "600000", FIRST_SALARY_DAY],
      [b!.employeeCode, world.structure, "1", "600000", FIRST_SALARY_DAY],
      [c!.employeeCode, world.structure, "1", "900000.50", FIRST_SALARY_DAY],
    ]);
    const p = await upload(world.tokens.maker, "preview", file);
    expect(p.body.groups.map((g: { people: number; blockers: string[] }) => [g.people, g.blockers.length])).toEqual([[2, 0], [1, 0]]);
    const salariesBefore = await prisma.employeeSalary.count({ where: { employeeId: { in: [a!.employeeId, b!.employeeId, c!.employeeId] } } });
    const done = await upload(world.tokens.maker, "commit", file, { fingerprint: p.body.fingerprint, note: "made-up opening salaries" });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body).toMatchObject({ people: 3 });
    expect(done.body.revisions).toHaveLength(2);
    expect(await prisma.employeeSalary.count({ where: { employeeId: { in: [a!.employeeId, b!.employeeId, c!.employeeId] } } })).toBe(salariesBefore);
    const revs = await prisma.payrollSalaryRevision.findMany({ where: { id: { in: done.body.revisions } } });
    for (const r of revs) {
      expect(r.createdByUserId).toBe(world.maker.userId);
      expect(r.note).toMatch(/^Imported from assignments\.csv/);
    }
    const approvals = await prisma.payrollApproval.findMany({ where: { subject: "SALARY_REVISION", subjectId: { in: done.body.revisions } } });
    expect(approvals.map((x) => x.status)).toEqual(["PENDING", "PENDING"]);
    // The maker cannot decide their own import's revision; a different director can.
    const detail = await request(app).get(`/api/payroll/salary/revisions/${done.body.revisions[0]}`).set(...authHeader(world.tokens.maker));
    expect((await request(app).post(`/api/payroll/salary/revisions/${done.body.revisions[0]}/decision`).set(...authHeader(world.tokens.maker)).send({ decision: "APPROVE", note: "mine", fingerprint: detail.body.fingerprint })).status).toBe(403);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.salary.assignments_imported", actorUserId: world.maker.userId } });
    expect(audit.after).toEqual({ rows: 3, revisions: 2 });
  });
});
