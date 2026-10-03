import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MANAGER_GRANTABLE_KEYS } from "@shared/constants/permissions";
import { storageService } from "../../../integrations/storage";
import { lettersGenerateQueue } from "../../../jobs/lettersQueue";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { issuePhotoToken } from "../../people/photos";
import { cleanupTestCategories, createTestCategory, pdf } from "../../documents/__tests__/documentsTestHelpers";
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
import { MANAGER_REACHABLE_SCOPED } from "./routeInventory";

// The IDOR half of the E2 endpoint audit: a manager holding EVERY
// manager-grantable key, acting on someone outside their team, is refused
// (404 — never confirming the record exists) or simply doesn't see them; on
// their own team member the same call is allowed. One case per route in
// MANAGER_REACHABLE_SCOPED; the last test fails if any route lacks a case.
type Person = { employeeId: string; employeeCode: string; userId: string };

describe("manager reach — TEAM scope at every endpoint a manager can call (E2)", () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  const p = {} as Record<"manager" | "member" | "otherManager" | "outsider" | "hrAdmin" | "leaverIn" | "leaverOut", Person>;
  let token: string; // the manager's
  let hrToken: string;
  const covered = new Set<string>();
  const req = {} as Record<"member" | "outsider", string>; // pending leave request ids
  const doc = {} as Record<"member" | "outsider", string>;
  const letter = {} as Record<"member" | "outsider", string>;
  let templateId = "";
  let categoryId = "";
  let leaveTypeId = "";
  const photoKey = `test/reach/${randomUUID()}.webp`;
  const sep: string[] = [];
  const lopReq: string[] = [];

  const api = (t: string) => ({
    get: (path: string) => request(app).get(path).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(path).set(...authHeader(t)).send(b),
  });
  const m = () => api(token);
  const cover = (route: (typeof MANAGER_REACHABLE_SCOPED)[number]) => covered.add(route);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.member = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.otherManager = await createFullTestEmployee(otherOrg, { roleCode: "MANAGER" });
    p.outsider = await createFullTestEmployee(otherOrg, { managerId: p.otherManager.employeeId });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.leaverIn = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.leaverOut = await createFullTestEmployee(otherOrg, { managerId: p.otherManager.employeeId });

    // Every manager-grantable key, as per-user exceptions on top of the role.
    const perms = await prisma.permission.findMany({ where: { key: { in: [...MANAGER_GRANTABLE_KEYS] } } });
    await prisma.userPermissionOverride.createMany({
      data: perms.map((perm) => ({ userId: p.manager.userId, permissionId: perm.id, effect: "GRANT" as const, reason: "reach test", createdByUserId: p.hrAdmin.userId })),
    });
    token = await loginAs(p.manager.employeeCode);
    hrToken = await loginAs(p.hrAdmin.employeeCode);

    leaveTypeId = (await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } })).id;
    const day = new Date(Date.UTC(2031, 3, 15));
    for (const who of ["member", "outsider"] as const) {
      const r = await prisma.leaveRequest.create({ data: { employeeId: p[who].employeeId, leaveTypeId, fromDate: day, toDate: day, totalDays: 1, status: "PENDING", appliedByUserId: p[who].userId } });
      req[who] = r.id;
    }

    categoryId = (await createTestCategory("EMPLOYEE")).id;
    for (const who of ["member", "outsider"] as const) {
      const key = `test/reach/${randomUUID()}.pdf`;
      await storageService.putObject(key, pdf(), "application/pdf");
      doc[who] = (await prisma.employeeDocument.create({ data: { employeeId: p[who].employeeId, categoryId, title: "Reach doc", fileKey: key, fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10, uploadedByUserId: p.hrAdmin.userId } })).id;
    }

    const tpl = await api(hrToken).post("/api/letters/templates", { code: `TEST_REACH_${Date.now()}`, name: "Reach letter", bodyHtml: "<p>Dear {{employee.fullName}}</p>", extraFields: [] });
    expect(tpl.status).toBe(201);
    templateId = tpl.body.id;
    for (const who of ["member", "outsider"] as const) {
      const res = await api(hrToken).post(`/api/letters/employees/${p[who].employeeId}`, { templateId });
      expect(res.status).toBe(202);
      letter[who] = res.body.id;
    }

    // Reports (F): the two leavers' completed separations, and an approved
    // LOP day each for the member and the outsider.
    for (const x of [p.leaverIn, p.leaverOut]) {
      sep.push((await prisma.separation.create({ data: { employeeId: x.employeeId, lastWorkingDate: new Date(Date.UTC(2031, 2, 31)), reason: "Reach test", status: "COMPLETED", completedAt: new Date(), initiatedByUserId: p.hrAdmin.userId } })).id);
      await prisma.employee.update({ where: { id: x.employeeId }, data: { lastWorkingDate: new Date(Date.UTC(2031, 2, 31)) } });
    }
    const lop = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } });
    const lopDay = new Date(Date.UTC(2031, 3, 16)); // a Wednesday
    for (const who of ["member", "outsider"] as const) {
      lopReq.push((await prisma.leaveRequest.create({ data: { employeeId: p[who].employeeId, leaveTypeId: lop.id, fromDate: lopDay, toDate: lopDay, totalDays: 1, status: "APPROVED", appliedByUserId: p[who].userId } })).id);
    }

    // Two former employees with a photo: one from the manager's team, one not.
    await storageService.putObject(photoKey, Buffer.from("x"), "image/webp");
    for (const x of [p.leaverIn, p.leaverOut]) {
      await prisma.employeePersonal.update({ where: { employeeId: x.employeeId }, data: { photoThumbStorageKey: photoKey, photoStorageKey: photoKey, photoVersion: "v1" } });
      await prisma.employee.update({ where: { id: x.employeeId }, data: { status: "SEPARATED" } });
    }
  });

  afterAll(async () => {
    for (const id of Object.values(letter)) await lettersGenerateQueue().remove(id).catch(() => undefined);
    await deleteWithDependents("LetterTemplate", [templateId]);
    await cleanupTestCategories([categoryId]);
    await prisma.leaveRequest.deleteMany({ where: { id: { in: [...Object.values(req), ...lopReq] } } });
    await prisma.separation.deleteMany({ where: { id: { in: sep } } });
    await prisma.employeePersonal.updateMany({ where: { employeeId: { in: [p.leaverIn.employeeId, p.leaverOut.employeeId] } }, data: { photoThumbStorageKey: null, photoStorageKey: null } });
    await storageService.deleteObject(photoKey);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  });

  const ids = (body: unknown, key = "employeeId"): string[] => {
    const rows = (body as { rows?: unknown[]; items?: unknown[]; requests?: unknown[] }).rows ?? (body as { items?: unknown[] }).items ?? (body as { requests?: unknown[] }).requests ?? (body as unknown[]);
    return (rows as Array<Record<string, unknown>>).map((r) => (r[key] as string) ?? (r.id as string));
  };

  describe("employees", () => {
    it("GET /api/employees — the grid lists the team, never an outsider", async () => {
      cover("GET /api/employees");
      const res = await m().get("/api/employees?pageSize=200");
      expect(res.status).toBe(200);
      const listed = ids(res.body, "id");
      expect(listed).toContain(p.member.employeeId);
      expect(listed).not.toContain(p.outsider.employeeId);
    });

    for (const [route, suffix] of [
      ["GET /api/employees/:id", ""],
      ["GET /api/employees/:id/history/job", "/history/job"],
      ["GET /api/employees/:id/history/name", "/history/name"],
    ] as const) {
      it(`${route} — 200 for a team member, 404 for an outsider`, async () => {
        cover(route);
        expect((await m().get(`/api/employees/${p.member.employeeId}${suffix}`)).status).toBe(200);
        expect((await m().get(`/api/employees/${p.outsider.employeeId}${suffix}`)).status).toBe(404);
      });
    }
  });

  describe("leave", () => {
    it("POST /api/leave/requests — applying on behalf of an outsider is refused", async () => {
      cover("POST /api/leave/requests");
      const body = (employeeId: string) => ({ employeeId, leaveTypeId, fromDate: "2031-05-20", toDate: "2031-05-20" });
      expect((await m().post("/api/leave/requests", body(p.outsider.employeeId))).status).toBe(404);
      expect([403, 404]).not.toContain((await m().post("/api/leave/requests", body(p.member.employeeId))).status);
    });

    it("GET /api/leave/requests — by employee: team member yes, outsider 404; unfiltered: team only", async () => {
      cover("GET /api/leave/requests");
      expect((await m().get(`/api/leave/requests?employeeId=${p.member.employeeId}`)).status).toBe(200);
      expect((await m().get(`/api/leave/requests?employeeId=${p.outsider.employeeId}`)).status).toBe(404);
      const all = ids((await m().get("/api/leave/requests?pageSize=200")).body, "id");
      expect(all).toContain(req.member);
      expect(all).not.toContain(req.outsider);
    });

    it("GET /api/leave/requests/:id — team member's yes, outsider's 404", async () => {
      cover("GET /api/leave/requests/:id");
      expect((await m().get(`/api/leave/requests/${req.member}`)).status).toBe(200);
      expect((await m().get(`/api/leave/requests/${req.outsider}`)).status).toBe(404);
    });

    it("GET /api/leave/balances and /comp-off — team member yes, outsider 404", async () => {
      cover("GET /api/leave/balances");
      cover("GET /api/leave/comp-off");
      for (const path of ["/api/leave/balances", "/api/leave/comp-off"]) {
        expect((await m().get(`${path}?employeeId=${p.member.employeeId}`)).status).toBe(200);
        expect((await m().get(`${path}?employeeId=${p.outsider.employeeId}`)).status).toBe(404);
      }
    });

    it("GET /api/leave/calendar — can't widen to another department", async () => {
      cover("GET /api/leave/calendar");
      await prisma.leaveRequest.updateMany({ where: { id: { in: Object.values(req) } }, data: { status: "APPROVED" } });
      try {
        const res = await m().get(`/api/leave/calendar?fromDate=2031-04-01&toDate=2031-04-30&departmentId=${otherOrg.departmentId}`);
        expect(res.status).toBe(200);
        const who = (res.body.entries as Array<{ employeeId: string }>).map((e) => e.employeeId);
        expect(who).toContain(p.member.employeeId);
        expect(who).not.toContain(p.outsider.employeeId);
      } finally {
        await prisma.leaveRequest.updateMany({ where: { id: { in: Object.values(req) } }, data: { status: "PENDING" } });
      }
    });

    it("dashboards — team figures, never the company's", async () => {
      cover("GET /api/leave/dashboard");
      cover("GET /api/admin/dashboard");
      expect((await m().get("/api/leave/dashboard?year=2031")).body.scope).toBe("team");
      expect((await m().get("/api/admin/dashboard")).body.scope).toBe("team");
    });

    it("tasks — the team member's pending request is the manager's to decide; the outsider's isn't", async () => {
      cover("GET /api/tasks/mine");
      cover("GET /api/admin/tasks/counts");
      const mine = (await m().get("/api/tasks/mine")).body as { items?: Array<{ id: string }> } | Array<{ id: string }>;
      const text = JSON.stringify(mine);
      expect(text).toContain(req.member);
      expect(text).not.toContain(req.outsider);
      const counts = await m().get("/api/admin/tasks/counts");
      expect(counts.status).toBe(200);
      expect(counts.body.monitor.total).toBe(0); // company-wide monitoring is for ALL scope only
    });

    it("approve / reject / cancel / bulk-approve — an outsider's request is untouchable", async () => {
      cover("POST /api/leave/requests/:id/approve");
      cover("POST /api/leave/requests/:id/reject");
      cover("POST /api/leave/requests/:id/cancel");
      cover("POST /api/leave/requests/bulk-approve");
      for (const action of ["approve", "reject", "cancel"]) {
        // A valid body, so the only reason left to refuse is scope.
        expect([403, 404]).toContain((await m().post(`/api/leave/requests/${req.outsider}/${action}`, { comments: "reach test" })).status);
      }
      await m().post("/api/leave/requests/bulk-approve", { ids: [req.outsider] });
      expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.outsider } })).status).toBe("PENDING");
      // …and the team member's request is the manager's to decide. (Reject,
      // not approve: the fixture has no PL balance, and approving would be
      // refused for that unrelated reason.)
      const ok = await m().post(`/api/leave/requests/${req.member}/reject`, { comments: "decided by their manager" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    });
  });

  describe("documents and letters", () => {
    it("employee documents — team member yes, outsider 404 (list and download)", async () => {
      cover("GET /api/documents/employees/:employeeId");
      cover("POST /api/documents/employee-documents/:id/download");
      expect((await m().get(`/api/documents/employees/${p.member.employeeId}`)).status).toBe(200);
      expect((await m().get(`/api/documents/employees/${p.outsider.employeeId}`)).status).toBe(404);
      expect((await m().post(`/api/documents/employee-documents/${doc.member}/download`)).status).toBe(200);
      expect((await m().post(`/api/documents/employee-documents/${doc.outsider}/download`)).status).toBe(404);
    });

    it("letters — list/issue/read/reissue/reproduce: an outsider's are 404", async () => {
      cover("GET /api/letters/employees/:employeeId");
      cover("POST /api/letters/employees/:employeeId");
      cover("GET /api/letters/:id");
      cover("POST /api/letters/:id/reissue");
      cover("POST /api/letters/:id/reproduce");
      expect((await m().get(`/api/letters/employees/${p.member.employeeId}`)).status).toBe(200);
      expect((await m().get(`/api/letters/employees/${p.outsider.employeeId}`)).status).toBe(404);
      expect((await m().post(`/api/letters/employees/${p.outsider.employeeId}`, { templateId })).status).toBe(404);
      expect((await m().get(`/api/letters/${letter.member}`)).status).toBe(200);
      for (const path of [`/api/letters/${letter.outsider}`]) expect((await m().get(path)).status).toBe(404);
      for (const action of ["reissue", "reproduce"]) expect((await m().post(`/api/letters/${letter.outsider}/${action}`, {})).status).toBe(404);
      // Own team's letter: that it exists, never what's in it (a letter is a
      // PAY document — 2026-10-03), and no reissue/reproduce.
      const own = await m().get(`/api/letters/${letter.member}`);
      expect(own.body).toMatchObject({ contentsWithheld: true, extraValues: null, document: null });
      for (const action of ["reissue", "reproduce"]) expect((await m().post(`/api/letters/${letter.member}/${action}`, {})).status).toBe(403);
    });

    it("a former employee's photo — own team's yes, anyone else's 404", async () => {
      cover("GET /api/people/photos/:employeeId/:size");
      const t = encodeURIComponent(issuePhotoToken(p.manager.userId).token);
      expect((await request(app).get(`/api/people/photos/${p.leaverIn.employeeId}/thumb?t=${t}`)).status).toBe(200);
      expect((await request(app).get(`/api/people/photos/${p.leaverOut.employeeId}/thumb?t=${t}`)).status).toBe(404);
    });
  });

  describe("reports (F)", () => {
    const codes = (body: { rows: Array<{ employeeCode: string }> }) => body.rows.map((r) => r.employeeCode);
    const cases: Array<[string, string, Array<"member" | "leaverIn">, Array<"outsider" | "leaverOut">]> = [
      ["headcount", "", ["member"], ["outsider"]],
      ["joiners", "?from=2024-01-01&to=2024-01-01", ["member"], ["outsider"]],
      ["leavers", "?from=2031-03-01&to=2031-03-31", ["leaverIn"], ["leaverOut"]],
      ["celebrations", "?from=2026-12-25&to=2027-01-05&kind=anniversary", ["member"], ["outsider"]],
      ["leave-balance", "", ["member"], ["outsider"]],
      ["lop", "?from=2031-04-01&to=2031-04-30", ["member"], ["outsider"]],
    ];
    for (const [key, qs, inside, outside] of cases) {
      it(`GET /api/reports/${key} — the team only, never an outsider`, async () => {
        const res = await m().get(`/api/reports/${key}${qs}`);
        expect(res.status).toBe(200);
        expect(res.body.scope).toBe("team");
        for (const who of inside) expect(codes(res.body)).toContain(p[who].employeeCode);
        for (const who of outside) expect(codes(res.body)).not.toContain(p[who].employeeCode);
        // HR sees both — the case isn't vacuous.
        const all = codes((await api(hrToken).get(`/api/reports/${key}${qs}`)).body);
        for (const who of [...inside, ...outside]) expect(all).toContain(p[who].employeeCode);
        cover("GET /api/reports/:key");
      });
    }

    it("leave liability isn't a manager's (salary-derived) — not listed, 403", async () => {
      const catalog = await m().get("/api/reports");
      expect(catalog.status).toBe(200);
      expect(catalog.body.reports.map((r: { key: string }) => r.key)).not.toContain("leave-liability");
      expect((await m().get("/api/reports/leave-liability")).status).toBe(403);
      expect((await m().get("/api/reports/leave-liability/export")).status).toBe(403);
      cover("GET /api/reports");
    });

    it("GET /api/reports/:key/export — the file holds the team only", async () => {
      const res = await m().get("/api/reports/headcount/export").buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      const cells = wb.worksheets[0]!.getColumn(1).values.map(String);
      expect(cells).toContain(p.member.employeeCode);
      expect(cells).not.toContain(p.outsider.employeeCode);
      expect(cells.some((c) => c.startsWith("Team only"))).toBe(true);
      cover("GET /api/reports/:key/export");
    });
  });

  it("every manager-reachable scoped route has a case above", () => {
    expect(MANAGER_REACHABLE_SCOPED.filter((r) => !covered.has(r))).toEqual([]);
  });
});
