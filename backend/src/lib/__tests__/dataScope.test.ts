import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEmployeeScopeWhere, getTeamEmployeeIds } from "../dataScope";
import { createTestEmployee, createTestOrgMasters, cleanupTestData, type TestOrgMasters } from "./testHelpers";

describe("data scope (SELF / TEAM / ALL)", () => {
  let org: TestOrgMasters;
  // Chain: manager -> directReport -> indirectReport, plus an unrelated
  // employee who reports to no one in this chain.
  let managerId: string;
  let directReportId: string;
  let indirectReportId: string;
  let unrelatedId: string;

  beforeAll(async () => {
    org = await createTestOrgMasters();
    ({ employeeId: managerId } = await createTestEmployee({ org }));
    ({ employeeId: directReportId } = await createTestEmployee({ org, managerId }));
    ({ employeeId: indirectReportId } = await createTestEmployee({ org, managerId: directReportId }));
    ({ employeeId: unrelatedId } = await createTestEmployee({ org }));
  });

  afterAll(async () => {
    await cleanupTestData({
      employeeIds: [managerId, directReportId, indirectReportId, unrelatedId],
      org,
    });
  });

  it("getTeamEmployeeIds walks direct and indirect reports, excluding the manager and unrelated employees", async () => {
    const team = await getTeamEmployeeIds(managerId);
    expect(team.sort()).toEqual([directReportId, indirectReportId].sort());
    expect(team).not.toContain(managerId);
    expect(team).not.toContain(unrelatedId);
  });

  it("getTeamEmployeeIds for a lower-level manager only returns their own subtree", async () => {
    const team = await getTeamEmployeeIds(directReportId);
    expect(team).toEqual([indirectReportId]);
  });

  it("getTeamEmployeeIds returns an empty array for an individual contributor", async () => {
    const team = await getTeamEmployeeIds(indirectReportId);
    expect(team).toEqual([]);
  });

  it("buildEmployeeScopeWhere SELF scopes to only the requesting employee", async () => {
    const where = await buildEmployeeScopeWhere(managerId, "SELF");
    expect(where).toEqual({ id: managerId });
  });

  it("buildEmployeeScopeWhere ALL applies no filter", async () => {
    const where = await buildEmployeeScopeWhere(managerId, "ALL");
    expect(where).toEqual({});
  });

  it("buildEmployeeScopeWhere TEAM includes the manager plus their full reporting chain", async () => {
    const where = await buildEmployeeScopeWhere(managerId, "TEAM");
    expect(where.id).toHaveProperty("in");
    const ids = (where.id as { in: string[] }).in;
    expect(ids.sort()).toEqual([managerId, directReportId, indirectReportId].sort());
    expect(ids).not.toContain(unrelatedId);
  });
});
