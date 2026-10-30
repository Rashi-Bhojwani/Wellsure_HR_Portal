import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HR_CAPABILITIES, type HrCapabilityId } from "@shared/constants/hrCapabilities";
import { closeHrCapabilityQueue } from "../../../jobs/hrCapabilityQueue";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { crawlGets } from "../../payroll/__tests__/sensitiveCrawl";
import { ROUTE_CLASSIFICATION } from "../../managers/__tests__/routeInventory";
import { setSwitch } from "../service";

// Stage 1.6, the persona matrix: for each state of the switches, who can reach what. A capability that is off closes exactly its own doors and no others; whatever the switches say, no pay
// route ever answers HR; and an employee, a manager and a director are what they should be in every state.

const RANGE = "from=2026-10-01&to=2026-10-31&asOf=2026-10-31";
interface Door {
  cap: HrCapabilityId;
  /** For a door that always answers 200 (an inbox): it counts as open only if the answer contains this. */
  seen?: string;
  /** Other capabilities this door also needs (an exceptions queue needs View attendance as well; uploading needs Edit muster). Any one of them off closes it. */
  also?: HrCapabilityId[];
  method: "get" | "post";
  path: string;
  body?: object;
}
// One door per capability at least; each is a request that is refused on permission (403) or let in and then refused on its own input or missing record (anything else).
const DOORS: Door[] = [
  { cap: "VIEW_ATTENDANCE", method: "get", path: "/api/attendance/who-is-in" },
  { cap: "VIEW_ATTENDANCE", method: "get", path: "/api/attendance/swipes" },
  { cap: "APPROVE_REGULARIZATIONS", method: "get", path: "/api/attendance/regularizations" },
  { cap: "APPROVE_LEAVE", method: "get", path: "/api/tasks/mine", seen: "LEAVE_APPROVAL" },
  { cap: "SEE_LEAVE_COUNTS", method: "get", path: "/api/leave/dashboard" },
  { cap: "SEND_INVITATIONS", method: "get", path: "/api/employees/invitations" },
  { cap: "IMPORT_EMPLOYEE_DETAILS", method: "get", path: "/api/import/employees/template" },
  { cap: "ISSUE_LETTERS_NO_PAY", method: "get", path: "/api/letters/employees/x" },
  { cap: "EDIT_MUSTER", method: "post", path: "/api/attendance/muster/mark-present", body: {} },
  { cap: "UPLOAD_MANUAL_MUSTER", also: ["EDIT_MUSTER"], method: "get", path: "/api/attendance/muster/template?locationId=x" },
  { cap: "FINALISE_MONTH", method: "get", path: "/api/attendance/finalisation/periods" },
  { cap: "CORRECTIONS", method: "post", path: "/api/attendance/overrides/preview", body: {} },
  { cap: "CORRECTIONS", method: "post", path: "/api/attendance/regularizations/bulk/preview", body: {} },
  { cap: "SHIFT_ROSTER", method: "post", path: "/api/attendance/roster/preview", body: {} },
  { cap: "EXCEPTIONS_QUEUE", also: ["VIEW_ATTENDANCE"], method: "get", path: "/api/attendance/exceptions" },
  { cap: "ATTENDANCE_REPORTS", method: "get", path: `/api/reports/late-coming?${RANGE}` },
  { cap: "ATTENDANCE_REPORTS", method: "get", path: `/api/reports/attendance-muster/export?${RANGE}` },
  { cap: "LEAVE_REPORTS", method: "get", path: `/api/reports/leave-balance?${RANGE}` },
  { cap: "LEAVE_REPORTS", method: "get", path: `/api/reports/lop/export?${RANGE}` },
];
// (Everybody, HR included, may read their OWN payslips: /payslips/mine answers with their own.)
const PAY = /^GET \/api\/(payroll|payslips(?!\/mine))/;
// The four keys locked after Checkpoint 1: the Import Center, letters, the leave year-end and the sign-in security actions.
const LOCKED_FOUR = /^GET \/api\/(import\/(bank|statutory)|leave\/year-end)/;

describe("the persona matrix", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"director" | "hrAdmin" | "hrNamed" | "manager" | "employee", { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<keyof typeof p, string>;
  let leaveId = "";
  const call = async (who: keyof typeof p, d: Door) => {
    const res = await request(app)[d.method](d.path).set(...authHeader(tok[who])).send(d.body ?? {});
    if (d.seen) return res.status === 200 && JSON.stringify(res.body).includes(d.seen) ? 200 : 403;
    return res.status;
  };
  const meta = () => ({ actorUserId: p.director.userId, ipAddress: null, userAgent: null });
  const roleSwitch = (capability: string, state: "ON" | "OFF" | "DEFAULT") => setSwitch({ capability, subject: { kind: "ROLE", roleCode: "HR_ADMIN" }, state, reason: "matrix" } as never, meta());
  const personSwitch = (capability: string, state: "ON" | "OFF" | "DEFAULT") => setSwitch({ capability, subject: { kind: "USER", employeeId: p.hrNamed.employeeId }, state, reason: "matrix" } as never, meta());
  const statuses = async (who: keyof typeof p) => Object.fromEntries(await Promise.all(DOORS.map(async (d) => [`${d.method} ${d.path}`, await call(who, d)])));

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrNamed = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.employee = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
    const lop = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } });
    leaveId = (await prisma.leaveRequest.create({ data: { employeeId: p.employee.employeeId, leaveTypeId: lop.id, fromDate: new Date("2026-11-04T00:00:00Z"), toDate: new Date("2026-11-04T00:00:00Z"), totalDays: 1, status: "PENDING", appliedByUserId: p.employee.userId } })).id;
  });
  afterEach(async () => {
    await purgeAppendOnly("HrCapabilitySwitch", { createdByUserId: p.director.userId });
  });
  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { id: leaveId } });
    await closeHrCapabilityQueue();
    for (const k of Object.keys(p) as Array<keyof typeof p>) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("every capability has at least one door in this matrix", () => {
    expect([...new Set(DOORS.map((d) => d.cap))].sort()).toEqual(HR_CAPABILITIES.map((c) => c.id).sort());
  });

  it("with nothing switched, HR Admin is let through every door and a director too; an employee and a manager through none", async () => {
    for (const [door, status] of Object.entries(await statuses("hrAdmin"))) expect(status, `HR Admin ${door}`).not.toBe(403);
    for (const [door, status] of Object.entries(await statuses("director"))) expect(status, `director ${door}`).not.toBe(403);
    for (const who of ["employee", "manager"] as const) for (const [door, status] of Object.entries(await statuses(who))) expect(status, `${who} ${door}`).toBe(403);
  });

  it.each(HR_CAPABILITIES.map((c) => [c.id]))("%s off for the HR Admin role closes exactly its own doors, and only for that role", async (id) => {
    const baseline = await statuses("hrAdmin");
    await roleSwitch(id, "OFF");
    const off = await statuses("hrAdmin");
    for (const d of DOORS) {
      const key = `${d.method} ${d.path}`;
      if (d.cap === id || d.also?.includes(id)) expect(off[key], `${id} off: ${key}`).toBe(403);
      else expect(off[key], `${id} off: ${key} must be unchanged`).toBe(baseline[key]);
    }
    for (const who of ["director"] as const) for (const [door, status] of Object.entries(await statuses(who))) expect(status, `director ${door}`).not.toBe(403);
    for (const who of ["employee", "manager"] as const) for (const [door, status] of Object.entries(await statuses(who))) expect(status, `${who} ${door}`).toBe(403);
    await roleSwitch(id, "DEFAULT");
    expect(await statuses("hrAdmin")).toEqual(baseline);
  });

  it("a named HR person: ON opens only that capability's doors for them; OFF over a role that is ON closes them; others unaffected", async () => {
    const base = await statuses("hrNamed");
    await personSwitch("FINALISE_MONTH", "ON");
    const on = await statuses("hrNamed");
    for (const d of DOORS) {
      const key = `${d.method} ${d.path}`;
      if (d.cap === "FINALISE_MONTH") expect(on[key], key).not.toBe(403);
      else expect(on[key], key).toBe(base[key]);
    }
    expect(await call("hrAdmin", DOORS.find((d) => d.cap === "FINALISE_MONTH")!)).not.toBe(403);
    await personSwitch("FINALISE_MONTH", "DEFAULT");
    expect(await statuses("hrNamed")).toEqual(base);
  });

  it("every GET route under /api/payroll and /api/payslips, with ids filled in, answers 403 to both HR roles; the only exceptions are the four that return a person's OWN payslips or the explanation of one", async () => {
    const own = new Set(["GET /api/payslips/mine", "GET /api/payslips/mine/:id", "GET /api/payslips/mine/:id/why", "GET /api/payslips/mine/:id/pdf"]);
    const routes = Object.keys(ROUTE_CLASSIFICATION).filter((r) => /^GET \/api\/(payroll|payslips)(\/|$)/.test(r));
    expect(routes.length).toBeGreaterThanOrEqual(30);
    const wrong: string[] = [];
    for (const who of ["hrAdmin", "hrNamed"] as const) {
      for (const r of routes) {
        const path = r.replace("GET ", "").replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000");
        const status = (await request(app).get(path).set(...authHeader(tok[who]))).status;
        if (own.has(r) ? status === 403 : status !== 403) wrong.push(`${who} ${r} -> ${status}`);
      }
    }
    expect(wrong).toEqual([]);
    // And the list itself: the four own-payslip routes are the only such routes the code has.
    expect(routes.filter((r) => !/^GET \/api\/payroll/.test(r)).sort()).toEqual([...own].sort());
  }, 240_000);

  it("See leave counts: off closes other people's balances, ledgers and the dashboard for the role, leaves the approval queue and a director alone, and a named person can be put back", async () => {
    const others = [`/api/leave/balances?employeeId=${p.employee.employeeId}`, `/api/leave/ledger?employeeId=${p.employee.employeeId}`, "/api/leave/dashboard"];
    const status = async (who: keyof typeof p, path: string) => (await request(app).get(path).set(...authHeader(tok[who]))).status;
    for (const path of others) expect(await status("hrAdmin", path), `default ${path}`).not.toBe(403);
    await roleSwitch("SEE_LEAVE_COUNTS", "OFF");
    for (const path of others) expect(await status("hrAdmin", path), `off ${path}`).toBe(403);
    for (const path of others) expect(await status("director", path), `director ${path}`).not.toBe(403);
    expect(await call("hrAdmin", { cap: "APPROVE_LEAVE", method: "get", path: "/api/tasks/mine", seen: "LEAVE_APPROVAL" }), "the approval queue is its own switch").toBe(200);
    expect(await status("employee", `/api/leave/balances`), "own balances are always their own").not.toBe(403);
    await personSwitch("SEE_LEAVE_COUNTS", "ON");
    expect(await status("hrNamed", "/api/leave/dashboard")).not.toBe(403);
    await personSwitch("SEE_LEAVE_COUNTS", "DEFAULT");
    await roleSwitch("SEE_LEAVE_COUNTS", "DEFAULT");
    for (const path of others) expect(await status("hrAdmin", path), `back ${path}`).not.toBe(403);
  });

  it("whatever the switches say, no payroll or payslip route ever answers an HR person: every duty on, every duty off, and as it is", async () => {
    const check = async (label: string) => {
      for (const who of ["hrAdmin", "hrNamed"] as const) {
        const crawled = await crawlGets(app, tok[who], {});
        const leaked = crawled.filter((c) => PAY.test(c.route) && c.status === 200).map((c) => c.route);
        expect(leaked, `${who} (${label})`).toEqual([]);
        const four = crawled.filter((c) => LOCKED_FOUR.test(c.route) && c.status === 200).map((c) => c.route);
        expect(four, `${who} (${label}), routes of the four keys locked after Checkpoint 1`).toEqual([]);
      }
    };
    await check("as it is");
    for (const c of HR_CAPABILITIES) {
      await setSwitch({ capability: c.id, subject: { kind: "ROLE", roleCode: "HR_ADMIN" }, state: "ON", reason: "matrix" } as never, meta());
      await setSwitch({ capability: c.id, subject: { kind: "ROLE", roleCode: "HR_EXECUTIVE" }, state: "ON", reason: "matrix" } as never, meta());
    }
    await check("every duty on");
    for (const c of HR_CAPABILITIES) {
      await setSwitch({ capability: c.id, subject: { kind: "ROLE", roleCode: "HR_ADMIN" }, state: "OFF", reason: "matrix" } as never, meta());
      await setSwitch({ capability: c.id, subject: { kind: "ROLE", roleCode: "HR_EXECUTIVE" }, state: "OFF", reason: "matrix" } as never, meta());
    }
    await check("every duty off");
  }, 240_000);
});
