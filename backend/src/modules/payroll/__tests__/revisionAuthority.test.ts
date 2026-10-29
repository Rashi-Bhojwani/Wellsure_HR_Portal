import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { useSecondDirectorChecks } from "./payrollTestHelpers";
import { FIRST_SALARY_DAY, buildSalaryWorld, teardownSalaryWorld, type SalaryWorld } from "./salaryTestHelpers";

// A salary revision on a director's own authority (docs/plans/DIRECTOR_AUTHORITY.md §5.5, D2): the director who prepares it decides it in the same act, applies it, and the other
// director is told. A director's own pay is always set by the other director, in either mode.

describe("a salary revision on director authority", () => {
  let world: SalaryWorld;
  let restore: () => Promise<void>;
  const call = (token: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/payroll${path}`).set(...authHeader(token)).send(body);
  const inputFor = (employeeId: string, annual: string) => ({ selection: { kind: "EMPLOYEES", employeeIds: [employeeId] }, change: { ctc: { mode: "SET", annual }, structure: { key: world.structure, version: 1 } }, effectiveFrom: FIRST_SALARY_DAY, note: "test" });
  const create = async (token: string, employeeId: string, annual = "720000") => {
    const input = inputFor(employeeId, annual);
    const preview = await call(token, "post", "/salary/revisions/preview", { input });
    if (preview.status !== 200) throw new Error(JSON.stringify(preview.body));
    return { preview, created: await call(token, "post", "/salary/revisions", { input, fingerprint: preview.body.fingerprint }) };
  };

  beforeAll(async () => {
    world = await buildSalaryWorld();
    restore = await useSecondDirectorChecks(false);
  }, 300_000);
  afterAll(async () => {
    await restore();
    await teardownSalaryWorld(world);
  });

  it("is decided in the act that makes it, by the same director, and applied by them; the other directors are told, with counts only", async () => {
    const e = world.staff[0]!.employeeId;
    const { preview, created } = await create(world.tokens.maker, e);
    expect(preview.body.checkers.state).toBe("SELF");
    expect(created.status).toBe(201);
    const approval = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "SALARY_REVISION", subjectId: created.body.id } });
    expect([approval.status, approval.authority, approval.makerUserId, approval.checkerUserId]).toEqual(["APPROVED", "DIRECTOR_AUTHORITY", world.maker.userId, world.maker.userId]);
    expect((await call(world.tokens.maker, "post", `/salary/revisions/${created.body.id}/apply`)).status).toBe(200);
    expect((await prisma.payrollSalaryRevision.findUniqueOrThrow({ where: { id: created.body.id } })).appliedAt).not.toBeNull();
    const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { step: "SALARY_REVISION", subjectId: created.body.id }, include: { receipts: true } });
    expect(notice.receipts.map((r) => r.recipientUserId)).not.toContain(world.maker.userId);
    expect(JSON.stringify(notice)).not.toContain("720000");
    expect(notice.itemCount).toBe(1);
  });

  it("somebody who is not a director cannot make one", async () => {
    const r = await call(world.tokens.outsider, "post", "/salary/revisions/preview", { input: inputFor(world.staff[1]!.employeeId, "600000") });
    expect(r.status).toBe(403);
  });

  it("a director's own pay is never set by that director: the other one does it, on authority, at once", async () => {
    const own = world.maker.employeeId;
    const refused = await call(world.tokens.maker, "post", "/salary/revisions/preview", { input: inputFor(own, "9000000") });
    expect(refused.status).toBe(403);
    const { created } = await create(world.tokens.checkerA, own, "900000");
    expect(created.status).toBe(201);
    const approval = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "SALARY_REVISION", subjectId: created.body.id } });
    expect([approval.status, approval.authority, approval.makerUserId]).toEqual(["APPROVED", "DIRECTOR_AUTHORITY", world.checkerA.userId]);
    // The director whose pay it is may neither apply nor cancel it.
    const own1 = await call(world.tokens.maker, "post", `/salary/revisions/${created.body.id}/apply`);
    expect(own1.status).toBe(403);
    expect((await call(world.tokens.checkerA, "post", `/salary/revisions/${created.body.id}/apply`)).status).toBe(200);
  });

  it("with the check switched on for salary revisions it waits for the other director, as it always did", async () => {
    const undo = await useSecondDirectorChecks({ SALARY_REVISION: true });
    try {
      const e = world.staff[2]!.employeeId;
      const { created } = await create(world.tokens.maker, e, "660000");
      expect(created.status).toBe(201);
      const a = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "SALARY_REVISION", subjectId: created.body.id } });
      expect([a.status, a.authority]).toEqual(["PENDING", "SECOND_DIRECTOR"]);
      expect((await call(world.tokens.maker, "post", `/salary/revisions/${created.body.id}/apply`)).body.error.code).toBe("APPROVAL_REQUIRED");
    } finally {
      await undo();
    }
  });
});
