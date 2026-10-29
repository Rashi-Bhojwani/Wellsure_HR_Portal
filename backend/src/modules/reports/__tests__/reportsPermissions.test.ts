import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { REPORT_CATALOG, REPORT_KEYS } from "@shared/constants/reports";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { closeHrCapabilityQueue } from "../../../jobs/hrCapabilityQueue";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { setSwitch } from "../../hrCapabilities/service";

// Stage 1.5: the reports a person is offered are the reports they may open, and the server refuses the rest on the screen call, the run and the download alike.

const ATTENDANCE = ["attendance-muster", "late-coming", "excess-hours", "exception-summary"];
const LEAVE = ["leave-balance", "lop"];
const PEOPLE = ["headcount", "joiners", "leavers", "celebrations"];
const RANGE = "from=2026-10-01&to=2026-10-31&asOf=2026-10-31";

describe("the reports gallery follows what a person may open", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"director" | "hr" | "hrExec" | "employee", { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<keyof typeof p, string>;
  const get = (who: keyof typeof p, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const meta = () => ({ actorUserId: p.director.userId, ipAddress: null, userAgent: null });
  const roleSwitch = (capability: string, state: "ON" | "OFF" | "DEFAULT") => setSwitch({ capability, subject: { kind: "ROLE", roleCode: "HR_ADMIN" }, state, reason: "test" } as never, meta());
  const offered = async (who: keyof typeof p) => ((await get(who, "/api/reports")).body.reports as Array<{ key: string }>).map((r) => r.key);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.employee = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
  });
  afterEach(async () => {
    await purgeAppendOnly("HrCapabilitySwitch", { createdByUserId: p.director.userId });
  });
  afterAll(async () => {
    await closeHrCapabilityQueue();
    for (const k of Object.keys(p) as Array<keyof typeof p>) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("every report that names a permission names a real one, and every report is in exactly one family", () => {
    for (const k of REPORT_KEYS) {
      const info = REPORT_CATALOG[k];
      for (const key of [info.permission, info.extraPermission].filter((x): x is string => Boolean(x))) expect((PERMISSION_KEYS as readonly string[]).includes(key), `${k}: ${key}`).toBe(true);
    }
    expect([...PEOPLE, ...LEAVE, "leave-liability", ...ATTENDANCE].sort()).toEqual([...REPORT_KEYS].sort());
  });

  it("by default HR is offered every report but the one in rupees; a director is offered all; an employee none", async () => {
    expect((await offered("hr")).sort()).toEqual([...PEOPLE, ...LEAVE, ...ATTENDANCE].sort());
    expect((await offered("director")).sort()).toEqual([...REPORT_KEYS].sort());
    expect((await get("employee", "/api/reports")).status).toBe(403);
  });

  it("the leave liability report is the directors': HR is refused it on the screen, the run and the download", async () => {
    for (const path of ["/api/reports/leave-liability?asOf=2026-10-31", "/api/reports/leave-liability/export?asOf=2026-10-31"]) {
      expect((await get("hr", path)).status, path).toBe(403);
      expect((await get("hrExec", path)).status, path).toBe(403);
    }
    expect((await get("director", "/api/reports/leave-liability?asOf=2026-10-31")).status).not.toBe(403);
  });

  it("switching Attendance reports off removes exactly those four, everywhere, and nothing else; switching back restores them", async () => {
    await roleSwitch("ATTENDANCE_REPORTS", "OFF");
    expect((await offered("hr")).sort()).toEqual([...PEOPLE, ...LEAVE].sort());
    for (const k of ATTENDANCE) {
      for (const path of [`/api/reports/${k}?${RANGE}`, `/api/reports/${k}/export?${RANGE}`]) {
        const res = await get("hr", path);
        expect([res.status, res.body.error?.message], path).toEqual([403, "Missing permission: reports.attendance.view"]);
      }
      expect((await get("hrExec", `/api/reports/${k}?${RANGE}`)).status, `${k} for the other HR role`).toBe(200);
      expect((await get("director", `/api/reports/${k}?${RANGE}`)).status).toBe(200);
    }
    for (const k of [...PEOPLE, ...LEAVE]) expect((await get("hr", `/api/reports/${k}?${RANGE}`)).status, k).toBe(200);
    await roleSwitch("ATTENDANCE_REPORTS", "DEFAULT");
    expect((await offered("hr")).sort()).toEqual([...PEOPLE, ...LEAVE, ...ATTENDANCE].sort());
    expect((await get("hr", `/api/reports/late-coming?${RANGE}`)).status).toBe(200);
  });

  it("switching Leave reports off removes balance and loss of pay, and nothing else", async () => {
    await roleSwitch("LEAVE_REPORTS", "OFF");
    expect((await offered("hr")).sort()).toEqual([...PEOPLE, ...ATTENDANCE].sort());
    for (const k of LEAVE) {
      for (const path of [`/api/reports/${k}?${RANGE}`, `/api/reports/${k}/export?${RANGE}`]) expect((await get("hr", path)).status, path).toBe(403);
    }
    for (const k of ATTENDANCE) expect((await get("hr", `/api/reports/${k}?${RANGE}`)).status, k).toBe(200);
  });
});
