import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { signAccessToken } from "../../lib/jwt";
import { authenticateSocketToken } from "../socket";
import {
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  type TestOrgMasters,
} from "../../modules/leave/__tests__/leaveTestHelpers";

// Socket.IO handshake auth (spec §8) — authenticateSocketToken is the
// actual auth decision behind io.use()'s middleware (see socket.ts):
// same access-token verification and live active-account re-check as
// middleware/authenticate.ts, plus resolving the room-relevant ids
// (employeeId, roleCodes, current department/location).
describe("realtime socket handshake auth", () => {
  let org: TestOrgMasters;
  const employeeIds: string[] = [];

  afterAll(async () => {
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("resolves userId/employeeId/roleCodes/department/location for a valid token and an active account with a role and job history", async () => {
    org ??= await createEmployeeTestOrgMasters();
    const fixture = await createLoginableTestEmployee(org, { roleCode: "MANAGER" });
    employeeIds.push(fixture.employeeId);
    const token = signAccessToken(fixture.userId);

    const data = await authenticateSocketToken(token);
    expect(data.userId).toBe(fixture.userId);
    expect(data.employeeId).toBe(fixture.employeeId);
    expect(data.roleCodes).toContain("MANAGER");
    expect(data.departmentId).toBe(org.departmentId);
    expect(data.locationId).toBe(org.locationId);
  });

  it("rejects a malformed/garbage token", async () => {
    await expect(authenticateSocketToken("not-a-real-jwt")).rejects.toThrow();
  });

  it("rejects a token for an account that is no longer ACTIVE", async () => {
    org ??= await createEmployeeTestOrgMasters();
    const fixture = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(fixture.employeeId);
    const token = signAccessToken(fixture.userId);
    await prisma.user.update({ where: { id: fixture.userId }, data: { status: "SUSPENDED" } });

    await expect(authenticateSocketToken(token)).rejects.toThrow("Account is not active");
  });

  it("rejects a token for a user id that no longer exists", async () => {
    const token = signAccessToken("not-a-real-user-id");
    await expect(authenticateSocketToken(token)).rejects.toThrow("Account is not active");
  });
});
