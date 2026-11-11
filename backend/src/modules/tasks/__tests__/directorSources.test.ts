import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// LC-14 and M task 1: the Tasks inbox lists reimbursement claims and held bank / statutory changes to a director who may decide them, and to nobody else.
describe("Tasks inbox: claims and held identity changes, directors only", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const u: Record<string, { employeeId: string; userId: string }> = {};
  const claimIds: string[] = [];
  const tasksOf = async (who: string) => {
    const res = await request(app).get("/api/tasks/mine").set(...authHeader(t[who]!));
    expect(res.status).toBe(200);
    return res.body as Array<{ type: string; id: string; detail: string | null }>;
  };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [
      ["d1", "SUPER_ADMIN"],
      ["d2", "SUPER_ADMIN"],
      ["hr", "HR_ADMIN"],
      ["mgr", "MANAGER"],
      ["emp", undefined],
      ["dev", DEVELOPER_ROLE_CODE],
    ] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      u[k] = e;
      t[k] = await loginAs(e.employeeCode);
    }
    // Two claims: the employee's and director d1's own.
    for (const who of ["emp", "d1"]) {
      const c = await prisma.reimbursementClaim.create({ data: { employeeId: u[who]!.employeeId, typeKey: "TESTCLAIM", typeVersion: 1, spentOn: new Date("2026-10-01"), amount: new Prisma.Decimal("1234.50"), description: "made up" } });
      claimIds.push(c.id);
    }
  });

  afterAll(async () => {
    await deleteWithDependents("ReimbursementClaim", claimIds);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("a director sees the claim waiting for a decision, never their own, and no amount", async () => {
    const d1 = await tasksOf("d1");
    const claims = d1.filter((x) => x.type === "CLAIM_DECISION");
    expect(claims.map((c) => c.id)).toContain(claimIds[0]);
    expect(claims.map((c) => c.id)).not.toContain(claimIds[1]);
    expect(JSON.stringify(claims)).not.toContain("1234");
    expect((await tasksOf("d2")).filter((x) => x.type === "CLAIM_DECISION").map((c) => c.id)).toEqual(expect.arrayContaining([claimIds[0], claimIds[1]]));
  });

  it("a held bank change shows to a director who may decide it: not the one who entered it, not on their own record", async () => {
    const held = await request(app)
      .patch(`/api/employees/${u.d2!.employeeId}/bank`)
      .set(...authHeader(t.hr!))
      .send({ accountHolderName: "Made Up", accountNumber: "50000000007777", accountNumberConfirm: "50000000007777", ifsc: "TEST0000123", bankName: "Test Bank", branchName: "Test" });
    expect(held.status).toBe(202);
    const forD1 = (await tasksOf("d1")).filter((x) => x.type === "IDENTITY_CONFIRMATION");
    expect(forD1.map((x) => x.id)).toContain(held.body.id);
    expect(JSON.stringify(forD1)).not.toContain("7777");
    // d2's own record: not offered to d2.
    expect((await tasksOf("d2")).filter((x) => x.type === "IDENTITY_CONFIRMATION").map((x) => x.id)).not.toContain(held.body.id);
  });

  it("HR, a manager, an employee and the Developer see neither", async () => {
    for (const who of ["hr", "mgr", "emp", "dev"]) {
      const types = (await tasksOf(who)).map((x) => x.type);
      expect(types, who).not.toContain("CLAIM_DECISION");
      expect(types, who).not.toContain("IDENTITY_CONFIRMATION");
    }
  });
});
