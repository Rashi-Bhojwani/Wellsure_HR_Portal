import request from "supertest";
import pino from "pino";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { runMonthlyPlAccrual } from "../../leave/accrual";
import { setEncashmentRateProvider, SettingsBasedEncashmentRateProvider } from "../../leave/encashmentRate";
import { writeLedgerEntry } from "../../leave/ledger";
import * as yearEndService from "../../leave/yearEnd";
import { clearPeepsSettings, setSetting } from "../../peeps/__tests__/peepsTestKit";

// The four new leave types (Q-15): every rule Not set until prepared and approved by a different director; a change voids the approval; caps,
// eligibility, counting and route enforced; supporting documents only for HR and the directors (every open audited) and never in manager views,
// notifications, task previews or logs; a generic "Leave" on team calendars; outside the year end; renames never touch balances; PL unchanged.

type Who = "director" | "director2" | "hrAdmin" | "hrExec" | "manager" | "report" | "employee" | "colleague" | "contractor" | "developer";
type Person = { employeeId: string; employeeCode: string; userId: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const MEDICAL_RULES = { paid: true, entitlement: { kind: "CAP", period: "PER_CALENDAR_YEAR", days: "5" }, eligibility: { minServiceDays: 0, employmentTypes: ["PERMANENT"] }, units: "FULL_DAY", counting: "CALENDAR_DAYS", document: { required: true, whenMoreThanDays: 1 }, approvalRoute: "HR_ONLY", yearEnd: null };
const BEREAVEMENT_RULES = { paid: true, entitlement: { kind: "CAP", period: "PER_REQUEST", days: "3" }, eligibility: { minServiceDays: 0, employmentTypes: ["PERMANENT", "CONTRACT"] }, units: "HALF_DAY", counting: "WORKING_DAYS", document: { required: false, whenMoreThanDays: 0 }, approvalRoute: "MANAGER_OR_HR", yearEnd: null };
const WEDDING_RULES = { paid: false, entitlement: { kind: "GRANTED_BALANCE" }, eligibility: { minServiceDays: 0, employmentTypes: ["PERMANENT"] }, units: "FULL_DAY", counting: "WORKING_DAYS", document: { required: false, whenMoreThanDays: 0 }, approvalRoute: "MANAGER_OR_HR", yearEnd: { carryForward: "LAPSE", encashment: "NONE" } };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const REASON = `private-reason-${Date.now()}`;

describe("new leave types", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  const typeId = {} as Record<string, string>;
  const requestIds: string[] = [];
  let friday: Date;
  const get = (who: Who, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const post = (who: Who, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body);
  const prepare = (who: Who, code: string, rules: object, note = "DEMO") => post(who, `/api/leave-rules/${code}/versions`, { rules, note });
  const approve = (who: Who, code: string, version: number, effectiveFrom = iso(businessToday())) => post(who, `/api/leave-rules/${code}/versions/${version}/approve`, { effectiveFrom });
  const apply = async (who: Who, code: string, from: Date, to: Date, extra: object = {}) => {
    const res = await post(who, "/api/leave/requests", { leaveTypeId: typeId[code], fromDate: iso(from), toDate: iso(to), fromDayPart: "FULL", toDayPart: "FULL", reason: REASON, ...extra });
    if (res.status === 201) requestIds.push(res.body.id);
    return res;
  };
  const attach = (who: Who, requestId: string) => request(app).post(`/api/leave-documents/requests/${requestId}`).set(...authHeader(tok[who])).attach("file", PDF, { filename: "certificate.pdf", contentType: "application/pdf" });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.report = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.employee = await createFullTestEmployee(org);
    p.colleague = await createFullTestEmployee(org);
    p.contractor = await createFullTestEmployee(org);
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    await prisma.employee.update({ where: { id: p.contractor.employeeId }, data: { employmentType: "CONTRACT" } });
    // A manager decides leave only once Admin grants it (per person).
    for (const key of ["leave.approve", "leave.view"]) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.userPermissionOverride.create({ data: { userId: p.manager.userId, permissionId: perm.id, effect: "GRANT", reason: "test: manager approves their team", createdByUserId: p.director.userId } });
    }
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
    for (const t of await prisma.leaveType.findMany({ where: { code: { in: ["MENSTRUAL", "MEDICAL", "WEDDING", "BEREAVEMENT", "PL"] } } })) typeId[t.code] = t.id;
    let d = addCalendarDays(businessToday(), 14);
    while (d.getUTCDay() !== 5) d = addCalendarDays(d, 1);
    friday = d;
  });

  afterAll(async () => {
    setEncashmentRateProvider(new SettingsBasedEncashmentRateProvider());
    const docs = await prisma.leaveRequestDocument.findMany({ where: { leaveRequestId: { in: requestIds } }, select: { id: true } });
    const versions = await prisma.leaveRuleVersion.findMany({ where: { leaveTypeId: { in: ["MENSTRUAL", "MEDICAL", "WEDDING", "BEREAVEMENT"].map((c) => typeId[c]!) } }, select: { id: true } });
    await purgeAppendOnly("AuditLog", { entityId: { in: [...docs.map((d) => d.id), ...versions.map((v) => v.id), ...requestIds, ...Object.values(typeId)] } });
    await deleteWithDependents("LeaveRuleVersion", versions.map((v) => v.id));
    // Put the four types back as the migration left them (inactive, no policy), so the next run starts from Not set.
    await prisma.leavePolicy.deleteMany({ where: { leaveTypeId: { in: ["MENSTRUAL", "MEDICAL", "WEDDING", "BEREAVEMENT"].map((c) => typeId[c]!) } } });
    await prisma.leaveType.updateMany({ where: { code: { in: ["MENSTRUAL", "MEDICAL", "WEDDING", "BEREAVEMENT"] } }, data: { isActive: false, isPaid: false, allowHalfDay: false } });
    await prisma.leaveType.update({ where: { code: "MEDICAL" }, data: { name: "Medical Leave" } });
    await clearPeepsSettings();
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("Not set until prepared and approved by a different director", () => {
    it("the four types exist, switched off, and nobody can apply for them", async () => {
      const types = (await get("employee", "/api/leave/types")).body.leaveTypes.map((t: { code: string }) => t.code);
      for (const code of ["MENSTRUAL", "MEDICAL", "WEDDING", "BEREAVEMENT"]) expect(types, code).not.toContain(code);
      const res = await apply("employee", "MEDICAL", friday, friday);
      expect(res.status).toBe(400);
      expect((await get("hrAdmin", "/api/leave-rules")).body.map((r: { code: string; state: string }) => [r.code, r.state])).toEqual([["MENSTRUAL", "NOT_SET"], ["MEDICAL", "NOT_SET"], ["WEDDING", "NOT_SET"], ["BEREAVEMENT", "NOT_SET"]]);
    });

    it("a version must set every rule; a partial one is refused", async () => {
      for (const missing of ["paid", "entitlement", "eligibility", "units", "counting", "document", "approvalRoute", "yearEnd"]) {
        const { [missing]: _drop, ...partial } = MEDICAL_RULES as Record<string, unknown>;
        expect((await prepare("hrAdmin", "MEDICAL", partial)).status, missing).toBe(400);
      }
      expect((await prepare("hrAdmin", "WEDDING", { ...WEDDING_RULES, yearEnd: null })).status).toBe(400); // a granted balance needs its year-end rule
      expect((await prepare("hrAdmin", "MEDICAL", { ...MEDICAL_RULES, entitlement: { kind: "CAP", period: "PER_CALENDAR_YEAR", days: "0" } })).status).toBe(400);
    });

    it("HR prepares; HR cannot approve; the director who prepared cannot approve; a different director approves, and the type follows its rules", async () => {
      expect((await prepare("hrAdmin", "MEDICAL", MEDICAL_RULES)).status).toBe(201);
      expect((await get("hrAdmin", "/api/leave-rules")).body.find((r: { code: string }) => r.code === "MEDICAL")).toMatchObject({ state: "AWAITING_APPROVAL", isActive: false });
      expect((await approve("hrAdmin", "MEDICAL", 1)).status).toBe(403);
      expect((await prepare("director", "BEREAVEMENT", BEREAVEMENT_RULES)).status).toBe(201);
      const self = await approve("director", "BEREAVEMENT", 1);
      expect(self.status).toBe(403);
      expect(JSON.stringify(self.body)).toContain("SAME_PERSON");
      expect((await approve("director2", "MEDICAL", 1, iso(addCalendarDays(businessToday(), -1)))).status).toBe(400); // not in the past
      expect((await approve("director2", "MEDICAL", 1)).status).toBe(200);
      expect((await approve("director2", "BEREAVEMENT", 1)).status).toBe(200);
      const medical = await prisma.leaveType.findUniqueOrThrow({ where: { code: "MEDICAL" }, include: { policy: true } });
      expect(medical).toMatchObject({ isActive: true, isPaid: true, allowHalfDay: false });
      expect(medical.policy).toMatchObject({ skipBalanceCheck: true, accrualEnabled: false, yearEndEncashment: false });
      expect((await prisma.leaveType.findUniqueOrThrow({ where: { code: "BEREAVEMENT" } })).allowHalfDay).toBe(true);
      expect((await get("employee", "/api/leave/types")).body.leaveTypes.map((t: { code: string }) => t.code)).toEqual(expect.arrayContaining(["MEDICAL", "BEREAVEMENT"]));
      expect((await get("employee", "/api/leave/types")).body.leaveTypes.map((t: { code: string }) => t.code)).not.toContain("MENSTRUAL");
    });

    it("the database alone refuses an approval by the preparer or by a non-director", async () => {
      const v = await prisma.leaveRuleVersion.create({ data: { leaveTypeId: typeId.MENSTRUAL!, version: 90, rules: MEDICAL_RULES, preparedByUserId: p.director.userId } });
      await expect(prisma.leaveRuleApproval.create({ data: { versionId: v.id, approvedByUserId: p.director.userId, effectiveFrom: businessToday() } })).rejects.toThrow(/LEAVE_RULES_SAME_PERSON/);
      await expect(prisma.leaveRuleApproval.create({ data: { versionId: v.id, approvedByUserId: p.hrAdmin.userId, effectiveFrom: businessToday() } })).rejects.toThrow(/LEAVE_RULES_DIRECTORS_ONLY/);
      await expect(prisma.leaveRuleVersion.update({ where: { id: v.id }, data: { note: "changed" } })).rejects.toThrow(/PEEPS_APPEND_ONLY/);
      await deleteWithDependents("LeaveRuleVersion", [v.id]);
    });

    it("the existing Leave Types & Policies tool cannot switch a new type on, change its paid or half-day flags, or edit its policy", async () => {
      expect((await request(app).patch(`/api/leave/types/${typeId.MENSTRUAL}`).set(...authHeader(tok.hrAdmin)).send({ isActive: true })).status).toBe(409);
      expect((await request(app).patch(`/api/leave/types/${typeId.MEDICAL}`).set(...authHeader(tok.hrAdmin)).send({ isPaid: false })).status).toBe(409);
      expect((await request(app).put(`/api/leave/types/${typeId.MEDICAL}/policy`).set(...authHeader(tok.hrAdmin)).send({ skipBalanceCheck: false })).status).toBe(409);
    });
  });

  describe("applying and deciding", () => {
    it("caps, calendar-day counting, eligibility and the attachment rule are enforced", async () => {
      const monday = addCalendarDays(friday, 3);
      const first = await apply("employee", "MEDICAL", friday, monday);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(first.body.totalDays).toBe(4); // calendar days: the weekend counts
      const over = await apply("employee", "MEDICAL", addCalendarDays(friday, 7), addCalendarDays(friday, 8));
      expect(over.status).toBe(409);
      expect(JSON.stringify(over.body)).toContain("LEAVE_LIMIT_REACHED");
      const notEligible = await apply("contractor", "MEDICAL", friday, friday);
      expect(notEligible.status).toBe(409);
      expect(JSON.stringify(notEligible.body)).toContain("NOT_ELIGIBLE");
      expect((await apply("colleague", "MEDICAL", friday, friday, { attachmentStorageKey: "employees/x/secret.pdf" })).status).toBe(400);
      expect((await apply("report", "BEREAVEMENT", friday, addCalendarDays(friday, 7))).status).toBe(409); // more than 3 days in one request
    });

    it("an HR-only route refuses the manager; a required document must be attached before HR approves; the ledger records it once", async () => {
      const r = await apply("report", "MEDICAL", friday, addCalendarDays(friday, 1));
      expect(r.status).toBe(201);
      const refused = await post("manager", `/api/leave/requests/${r.body.id}/approve`);
      expect(refused.status).toBe(403);
      expect(JSON.stringify(refused.body)).toContain("HR_ONLY_ROUTE");
      const noDoc = await post("hrAdmin", `/api/leave/requests/${r.body.id}/approve`);
      expect(noDoc.status).toBe(409);
      expect(JSON.stringify(noDoc.body)).toContain("DOCUMENT_REQUIRED");
      expect((await attach("manager", r.body.id)).status).toBe(404); // only the employee attaches
      expect((await attach("report", r.body.id)).status).toBe(201);
      expect((await post("hrAdmin", `/api/leave/requests/${r.body.id}/approve`)).status).toBe(200);
      expect(await prisma.leaveLedger.count({ where: { referenceType: "LEAVE_REQUEST", referenceId: r.body.id } })).toBe(1);
    });

    it("a manager decides a type whose route allows it, for their own report", async () => {
      const r = await apply("report", "BEREAVEMENT", addCalendarDays(friday, 21), addCalendarDays(friday, 21));
      expect(r.status).toBe(201);
      expect((await post("manager", `/api/leave/requests/${r.body.id}/approve`)).status).toBe(200);
    });

    it("rules approved for a later date: the type is switched on, but leave before that date is refused", async () => {
      expect((await prepare("hrAdmin", "WEDDING", WEDDING_RULES)).status).toBe(201);
      expect((await approve("director", "WEDDING", 1, iso(addCalendarDays(friday, 30)))).status).toBe(200);
      const early = await apply("employee", "WEDDING", friday, friday);
      expect(early.status).toBe(409);
      expect(JSON.stringify(early.body)).toContain("LEAVE_RULES_NOT_SET");
      const later = await apply("employee", "WEDDING", addCalendarDays(friday, 31), addCalendarDays(friday, 31));
      expect(later.status).not.toBe(201); // a granted balance: nothing granted yet, so the engine's balance check refuses
    });

    it("a rule change voids the approval until the new version is approved; history keeps both", async () => {
      expect((await prepare("hrAdmin", "BEREAVEMENT", { ...BEREAVEMENT_RULES, entitlement: { kind: "CAP", period: "PER_REQUEST", days: "2" } }, "DEMO change")).status).toBe(201);
      const status = (await get("hrAdmin", "/api/leave-rules")).body.find((r: { code: string }) => r.code === "BEREAVEMENT");
      expect(status).toMatchObject({ state: "AWAITING_APPROVAL", isActive: false, voidedVersion: 1 });
      expect((await apply("colleague", "BEREAVEMENT", friday, friday)).status).toBe(400); // switched off
      expect((await approve("director", "BEREAVEMENT", 2)).status).toBe(200);
      const after = (await get("hrAdmin", "/api/leave-rules")).body.find((r: { code: string }) => r.code === "BEREAVEMENT");
      expect(after).toMatchObject({ state: "APPROVED", isActive: true });
      expect(after.history.map((h: { version: number }) => h.version)).toEqual([2, 1]);
      expect((await apply("colleague", "BEREAVEMENT", friday, addCalendarDays(friday, 4))).status).toBe(409); // the new cap (2 working days; Fri to Tue is 3)
    });
  });

  describe("who sees what", () => {
    it("permission matrix for the rules routes: HR prepares, directors approve; managers, employees and the Developer are refused", async () => {
      for (const who of ["manager", "employee", "developer"] as const) {
        expect((await get(who, "/api/leave-rules")).status, who).toBe(403);
        expect((await prepare(who, "MENSTRUAL", MEDICAL_RULES)).status, who).toBe(403);
        expect((await approve(who, "MENSTRUAL", 1)).status, who).toBe(403);
      }
      expect((await get("hrAdmin", "/api/leave-rules")).status).toBe(200);
      expect((await get("director", "/api/leave-rules")).status).toBe(200);
      expect((await request(app).get("/api/leave-rules")).status).toBe(401);
    });

    it("supporting documents: HR and the directors list and open (each open audited); the employee sees a count; nobody else sees anything", async () => {
      const r = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: p.report.employeeId, leaveTypeId: typeId.MEDICAL } });
      const own = await get("report", `/api/leave-documents/requests/${r.id}`);
      expect(own.body).toEqual({ attached: 1, documents: [] });
      for (const who of ["manager", "colleague", "employee"] as const) expect((await get(who, `/api/leave-documents/requests/${r.id}`)).status, who).toBe(404);
      const list = await get("hrExec", `/api/leave-documents/requests/${r.id}`);
      expect(list.body.documents).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toMatch(/certificate|leave-documents\//);
      const docId = list.body.documents[0].id as string;
      for (const who of ["manager", "report", "colleague", "developer"] as const) expect((await get(who, `/api/leave-documents/${docId}`)).status, who).toBe(403);
      const opened = await get("hrExec", `/api/leave-documents/${docId}`);
      expect(opened.status).toBe(200);
      expect(opened.headers["cache-control"]).toBe("no-store");
      expect((await get("director", `/api/leave-documents/${docId}`)).status).toBe(200);
      const audits = await prisma.auditLog.findMany({ where: { entityId: docId, action: "leave.document.opened" } });
      expect(audits.map((a) => a.actorUserId).sort()).toEqual([p.director.userId, p.hrExec.userId].sort());
    });

    it("the manager sees the type and dates of their report's leave, never the reason or the document, in lists, notifications and task previews", async () => {
      const list = await get("manager", `/api/leave/requests?employeeId=${p.report.employeeId}`);
      expect(list.status).toBe(200);
      const medical = list.body.rows.find((x: { leaveTypeCode: string }) => x.leaveTypeCode === "MEDICAL");
      expect(medical).toMatchObject({ leaveTypeCode: "MEDICAL", reason: null });
      expect(medical.fromDate).toBeDefined();
      const hr = await get("hrAdmin", `/api/leave/requests?employeeId=${p.report.employeeId}`);
      expect(JSON.stringify(hr.body)).toContain(REASON);
      for (const path of ["/api/tasks/mine", "/api/notifications", `/api/leave/requests/${medical.id}`]) {
        const text = JSON.stringify((await get("manager", path)).body);
        expect(text, path).not.toContain(REASON);
        expect(text, path).not.toMatch(/leave-documents\/|certificate/);
      }
      const notes = await prisma.notification.findMany({ where: { userId: p.manager.userId } });
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(`${n.title} ${n.body} ${JSON.stringify(n.payload)}`).not.toContain(REASON);
    });

    it("no log line carries a document's storage key or contents, or the reason", async () => {
      const stream = (logger as unknown as Record<symbol, { write: (line: string) => unknown }>)[pino.symbols.streamSym]!;
      const lines: string[] = [];
      const original = stream.write.bind(stream);
      stream.write = (line: string) => {
        lines.push(String(line));
        return original(line);
      };
      let key = "";
      try {
        let r = await apply("employee", "BEREAVEMENT", addCalendarDays(friday, 35), addCalendarDays(friday, 35));
        for (let off = 38; r.status !== 201 && off < 46; off += 1) r = await apply("employee", "BEREAVEMENT", addCalendarDays(friday, off), addCalendarDays(friday, off)); // skip a holiday or week-off
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        expect((await attach("employee", r.body.id)).status).toBe(201);
        key = (await prisma.leaveRequestDocument.findFirstOrThrow({ where: { leaveRequestId: r.body.id } })).storageKey;
        const docId = (await get("hrAdmin", `/api/leave-documents/requests/${r.body.id}`)).body.documents[0].id as string;
        await get("hrAdmin", `/api/leave-documents/${docId}`);
        logger.info({ probe: "leave-log-check" }, "probe");
      } finally {
        stream.write = original;
      }
      const text = lines.join("\n");
      expect(text).toContain("leave-log-check");
      expect(text).not.toContain(key.split("/").pop()!);
      expect(text).not.toContain("%PDF");
      expect(text).not.toContain(REASON);
    });

    it("team calendars show a generic Leave for the new types until the directors' setting names them", async () => {
      const cal = async () => (await get("colleague", `/api/leave/calendar?fromDate=${iso(friday)}&toDate=${iso(addCalendarDays(friday, 3))}`)).body.entries as Array<{ employeeId: string; leaveTypeCode: string }>;
      // Calendars show approved leave: the report's approved medical leave (HR approved it above).
      const before = (await cal()).filter((e) => e.employeeId === p.report.employeeId).map((e) => e.leaveTypeCode);
      expect(before).toContain("LEAVE");
      expect(before).not.toContain("MEDICAL");
      await setSetting("leave.calendarShowsType", { showType: true }, p.director, p.director2);
      expect((await cal()).filter((e) => e.employeeId === p.report.employeeId).map((e) => e.leaveTypeCode)).toContain("MEDICAL");
    });
  });

  describe("balances, renames, year end and PL", () => {
    it("a rename never creates a balance, a ledger row or a request type; ledger idempotency holds", async () => {
      const rows = await prisma.leaveLedger.count({ where: { leaveTypeId: typeId.MEDICAL } });
      const types = await prisma.leaveType.count();
      expect((await request(app).patch(`/api/leave/types/${typeId.MEDICAL}`).set(...authHeader(tok.hrAdmin)).send({ name: "DEMO Health Leave" })).status).toBe(200);
      expect(await prisma.leaveLedger.count({ where: { leaveTypeId: typeId.MEDICAL } })).toBe(rows);
      expect(await prisma.leaveType.count()).toBe(types);
      const list = await get("hrAdmin", `/api/leave/requests?employeeId=${p.report.employeeId}`);
      expect(list.body.rows.find((x: { leaveTypeCode: string }) => x.leaveTypeCode === "MEDICAL").leaveTypeName).toBe("DEMO Health Leave");
      // Approving again changes nothing: one CONSUMED row per request, ever.
      const approvedId = (await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: p.report.employeeId, leaveTypeId: typeId.MEDICAL, status: "APPROVED" } })).id;
      expect((await post("hrAdmin", `/api/leave/requests/${approvedId}/approve`)).status).toBe(409);
      expect(await prisma.leaveLedger.count({ where: { referenceId: approvedId } })).toBe(1);
    });

    it("\"Annual Leave\" is only a label for PL: renaming PL and running the monthly accrual twice credits once, to the same type", async () => {
      const pl = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
      const month = new Date(Date.UTC(2090, 0, 1));
      try {
        await prisma.leaveType.update({ where: { id: pl.id }, data: { name: "Annual Leave" } });
        await runMonthlyPlAccrual(month);
        const once = await prisma.leaveLedger.count({ where: { employeeId: p.employee.employeeId, accrualMonth: month, entryType: "ACCRUAL" } });
        await runMonthlyPlAccrual(month);
        expect(await prisma.leaveLedger.count({ where: { employeeId: p.employee.employeeId, accrualMonth: month, entryType: "ACCRUAL" } })).toBe(once);
        expect(await prisma.leaveLedger.count({ where: { employeeId: p.employee.employeeId, accrualMonth: month, entryType: "ACCRUAL", leaveTypeId: { not: pl.id } } })).toBe(0);
        expect(await prisma.leaveType.count({ where: { name: "Annual Leave" } })).toBe(1);
      } finally {
        await prisma.leaveType.update({ where: { id: pl.id }, data: { name: pl.name } });
        const accruals = await prisma.leaveLedger.findMany({ where: { accrualMonth: month }, select: { id: true } });
        await deleteWithDependents("LeaveLedger", accruals.map((a) => a.id));
      }
    });

    it("the year end leaves the new types out: a new-type balance never becomes an item or a PL balance", async () => {
      setEncashmentRateProvider({ getDailyRate: async () => ({ amount: new Prisma.Decimal(100), source: "test" }) } as never);
      const year = 2091;
      await writeLedgerEntry(prisma, { employeeId: p.colleague.employeeId, leaveTypeId: typeId.WEDDING!, leaveYear: year, entryDate: new Date(Date.UTC(year, 5, 1)), entryType: "GRANT", days: 5 });
      await writeLedgerEntry(prisma, { employeeId: p.employee.employeeId, leaveTypeId: typeId.PL!, leaveYear: year, entryDate: new Date(Date.UTC(year, 5, 1)), entryType: "GRANT", days: 2 });
      await writeLedgerEntry(prisma, { employeeId: p.employee.employeeId, leaveTypeId: typeId.WEDDING!, leaveYear: year, entryDate: new Date(Date.UTC(year, 5, 1)), entryType: "GRANT", days: 5 });
      const run = await yearEndService.previewYearEnd(year, { actorUserId: p.director.userId, ipAddress: null, userAgent: null });
      try {
        const own = (id: string) => run.items.find((i) => i.employeeId === id);
        const plBefore = await prisma.leaveLedger.aggregate({ _sum: { days: true }, where: { employeeId: p.colleague.employeeId, leaveTypeId: typeId.PL, entryDate: { lte: new Date(Date.UTC(year, 11, 31)) } } });
        if ((plBefore._sum.days ?? new Prisma.Decimal(0)).lte(0)) expect(own(p.colleague.employeeId)).toBeUndefined();
        const employeePl = await prisma.leaveLedger.aggregate({ _sum: { days: true }, where: { employeeId: p.employee.employeeId, leaveTypeId: typeId.PL, entryDate: { lte: new Date(Date.UTC(year, 11, 31)) } } });
        expect(own(p.employee.employeeId)?.closingPlBalance).toBe(employeePl._sum.days!.toNumber()); // PL only: the 5 wedding days are not in it
      } finally {
        await prisma.yearEndRun.deleteMany({ where: { id: run.id } });
        const rows = await prisma.leaveLedger.findMany({ where: { leaveYear: year, employeeId: { in: [p.colleague.employeeId, p.employee.employeeId] } }, select: { id: true } });
        await deleteWithDependents("LeaveLedger", rows.map((r) => r.id));
      }
    });
  });
});
