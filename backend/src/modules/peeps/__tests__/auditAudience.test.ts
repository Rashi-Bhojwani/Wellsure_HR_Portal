import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeAuditLogs } from "../../../lib/audit";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { PEEPS_PRIVATE_AUDIT_PREFIXES } from "../auditAudience";

// Peeps Stage 4, independent review finding 2: the audit log must not tell HR or the Developer who booked an Unmute session, who asked for a
// nudge review, who attached or opened a leave document, or which private item a director opened. The directors still see every row.

describe("private Peeps rows in the audit log", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"director" | "hr" | "developer" | "employee", Awaited<ReturnType<typeof createFullTestEmployee>>>;
  const tok = {} as Record<keyof typeof p, string>;
  const entityId = `audit-audience-${Date.now()}`;
  const PRIVATE = ["unmute.booking.created", "unmute.booking.cancelled", "nudges.review.requested", "nudges.review.decided", "leave.document.attached", "leave.document.opened", "peeps.director.opened"];
  const OPEN = ["unmute.slot.created", "nudges.tag.given", "peeps.setting.entered"];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    p.employee = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as (keyof typeof p)[]) tok[k] = await loginAs(p[k].employeeCode);
    await writeAuditLogs([...PRIVATE, ...OPEN].map((action) => ({ actorUserId: p.employee.userId, action, entityType: "AuditAudienceTest", entityId })));
  });

  afterAll(async () => {
    await purgeAppendOnly("AuditLog", { entityId });
    for (const k of Object.keys(p) as (keyof typeof p)[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const actionsSeenBy = async (who: keyof typeof p) => {
    const res = await request(app).get(`/api/audit-logs?entityType=AuditAudienceTest&pageSize=100`).set(...authHeader(tok[who]));
    return { status: res.status, actions: ((res.body.items ?? res.body.rows ?? []) as Array<{ action: string; entityId?: string }>).map((r) => r.action).sort() };
  };

  it("every private action is covered by the filter", () => {
    for (const a of PRIVATE) expect(PEEPS_PRIVATE_AUDIT_PREFIXES.some((pre) => a.startsWith(pre)), a).toBe(true);
    for (const a of OPEN) expect(PEEPS_PRIVATE_AUDIT_PREFIXES.some((pre) => a.startsWith(pre)), a).toBe(false);
  });

  it("the directors see every row; HR and the Developer see the ordinary rows only; an employee has no audit log", async () => {
    const director = await actionsSeenBy("director");
    expect(director.status).toBe(200);
    expect(director.actions).toEqual([...PRIVATE, ...OPEN].sort());
    for (const who of ["hr", "developer"] as const) {
      const seen = await actionsSeenBy(who);
      if (seen.status === 403) continue; // a role without the audit log at all sees nothing
      expect(seen.status, who).toBe(200);
      expect(seen.actions, who).toEqual([...OPEN].sort());
    }
    expect((await actionsSeenBy("employee")).status).toBe(403);
    // At least one non-director really reads the log (otherwise this test would prove nothing).
    expect((await Promise.all((["hr", "developer"] as const).map(actionsSeenBy))).some((s) => s.status === 200)).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityId } })).toBe(PRIVATE.length + OPEN.length);
  });
});
