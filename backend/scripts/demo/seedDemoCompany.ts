import { appendFileSync } from "node:fs";
import argon2 from "argon2";
import { addCalendarDays, businessToday } from "../../src/lib/businessDate";
import { encryptBankFields, encryptStatutoryFields } from "../../src/modules/employee/service";
import { resolveAccess } from "../../src/lib/permissions";
import { prisma } from "../../src/lib/prisma";
import { setSetting } from "../../src/lib/settings";
import { confirmComponent, previewComponentConfirm, previewComponentSave, saveComponent } from "../../src/modules/payroll/salary/components";
import { applyRevision, createRevision, decideRevision, getRevision, previewRevision } from "../../src/modules/payroll/salary/revisions";
import { confirmStructure, previewStructureConfirm, previewStructureSave, saveStructure } from "../../src/modules/payroll/salary/structures";
import { confirmRule, editRule, previewConfirm, previewEdit } from "../../src/modules/payroll/rules/governed";
import { confirmLayout, previewLayoutConfirm, previewLayoutSave, saveLayout } from "../../src/modules/payroll/run/layouts";
import { DEMO_SETTING } from "../../src/modules/payroll/setup/status";
import { giveSignoff, previewSignoff } from "../../src/modules/payroll/setup/signoffs";
import { RULE_CATALOG } from "@shared/constants/payrollRules";

// THE DEMO COMPANY (docs/plans/PHASE_6.md §14J). A fictional company so that payroll can be finished, tested and shown end to end without any real figure. Development only: the command
// that runs this refuses anywhere else, and the application refuses to start in staging or production if this has been run there. Everything it makes is made up and says so:
// codes DEMO001 and up, names "Demo ...", bank accounts and ids in an obviously fake pattern, a bank file format that is fictional on its face.
//
// It uses the same services the screens use, as the demo users: rules are written by the demo payroll admin and confirmed by the demo approver (retyped where that is required); the
// salaries go through salary revisions that a different person approves; people's pay details are signed off by the demo owner; and the layout is entered and confirmed by two people.
// So the two-person flow in the demo is the real one, and the result is the same state a real company reaches when every Setup Checklist item is Confirmed.

export const DEMO_PASSWORD = "Wellsure@123";
export const DEMO_PEOPLE = [
  { code: "DEMO001", name: "Demo Owner", role: "SUPER_ADMIN" },
  // D1 (docs/plans/DIRECTOR_AUTHORITY.md, Q-DA-8): the payroll roles are for directors only. DEMO002 and DEMO003 used to hold them and are ordinary employees now.
  { code: "DEMO002", name: "Demo Employee 002", role: "EMPLOYEE" },
  { code: "DEMO003", name: "Demo Employee 003", role: "EMPLOYEE" },
  { code: "DEMO004", name: "Demo HR Admin", role: "HR_ADMIN" },
  { code: "DEMO005", name: "Demo Developer", role: "DEVELOPER" },
  ...Array.from({ length: 7 }, (_, i) => ({ code: `DEMO${String(i + 6).padStart(3, "0")}`, name: `Demo Employee ${String(i + 6).padStart(3, "0")}`, role: "EMPLOYEE" })),
  // The second director. The two directors check each other's work; each sets the other's pay.
  { code: "DEMO013", name: "Demo Second Owner", role: "SUPER_ADMIN" },
] as const;

/**
 * The directors are not on the demo payroll for now: nobody changes their own pay, and with two directors a director's pay needs the other to make it AND a third person
 * to approve it, which does not exist. D2 lets one director prepare and decide the other's revision in one act (director authority); the demo then pays them too.
 * Until then they join after the demo's cycle, so a run does not list them as left out.
 */
const DEMO_DIRECTORS: readonly string[] = ["DEMO001", "DEMO013"];

const FAKE_IFSC = "DEMO0000001";
export const DEMO_DEBIT_ACCOUNT = "999900000000";
export const DEMO_IDENTIFIERS: Record<string, string> = {
  PF_ESTABLISHMENT_CODE: "DEMO/PF/00001",
  ESI_EMPLOYER_CODE: "DEMO-ESI-00001",
  PT_REGISTRATION: "DEMO-PT-00001",
  LWF_REGISTRATION: "DEMO-LWF-00001",
  TAN: "DEMOT00001D",
};

/** The fictional bank file format. It is not any bank's. */
export const DEMO_BANK_LAYOUT = {
  format: "DELIMITED",
  delimiter: ",",
  lineEnding: "LF",
  extension: "csv",
  dateFormat: "DD-MM-YYYY",
  amountDecimals: 2,
  header: [[{ source: "CONSTANT", value: "DEMO BANK BULK TRANSFER (FICTIONAL FORMAT)" }, { source: "PATTERN", value: "{DEBIT_ACCOUNT}" }, { source: "PATTERN", value: "{COUNT}" }, { source: "PATTERN", value: "{TOTAL}" }]],
  columns: [{ source: "FIELD", value: "SERIAL" }, { source: "FIELD", value: "NAME" }, { source: "FIELD", value: "ACCOUNT_NUMBER" }, { source: "FIELD", value: "IFSC" }, { source: "FIELD", value: "AMOUNT" }, { source: "FIELD", value: "NARRATION" }],
  narrationPattern: "DEMO salary {PERIOD}",
};

const RULES: Record<string, unknown> = {
  PAY_DAYS_BASIS: "CALENDAR_DAYS",
  LOP_DIVISOR: "SAME_AS_PAY_DAYS_BASIS",
  PAYMENT_DATE_RULE: { monthOffset: 0, day: "LAST" },
  LEAVER_PAYMENT_TIMING: "PAY_WITH_RUN",
  NEGATIVE_NET_POLICY: "BLOCK",
  LINE_ROUNDING: { mode: "HALF_UP", scale: 0 },
  REVISION_CTC_ROUNDING: { mode: "HALF_UP", scale: 0 },
  NET_PAY_ROUNDING: { mode: "NONE", scale: 0 },
  PF_CEILING_MODE: "CAP_AT_CEILING",
  ESI_PERIOD_RULE: "MONTHLY",
  PF_ELIGIBLE_TYPES: ["PERMANENT", "PROBATION"],
  ESI_ELIGIBLE_TYPES: ["PERMANENT", "PROBATION"],
  PT_STATE_OF_PLACEMENT: "LAST_DAY_OF_PERIOD",
  PT_SLABS: { states: { DEMO_STATE: { slabs: [{ fromGross: "0", toGross: "15000", monthlyAmount: "0" }, { fromGross: "15000", toGross: null, monthlyAmount: "200" }] } } },
  LWF_TABLE: { states: { DEMO_STATE: { employee: "10", employer: "20", frequency: "HALF_YEARLY", months: [6, 12] } } },
  TDS_MODE: "NONE",
  ENCASH_DAILY_RATE_FORMULA: "BASIC / 30",
  ENCASH_TAXABLE: true,
  ENCASH_PF_APPLICABLE: false,
  ENCASH_PAYOUT_RULE: "FIRST_RUN_AFTER_COMMIT",
  ARREARS_PAYOUT: "SEPARATE_LINE_IN_NEXT_RUN",
  ARREARS_PF_ESI: "FOLLOW_COMPONENT_FLAGS",
  VARIANCE_FLAG_PERCENT: "10",
  VARIANCE_FLAG_MIN_AMOUNT: "500",
  PAYSLIP_LAYOUT: { showEmployerContributions: false, showYearToDate: false },
};

const COMPONENT = (name: string, order: number, over: Record<string, unknown> = {}) => ({ name, type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: name, payslipOrder: order, ...over });

export interface DemoResult {
  people: number;
  paid: number;
  password: string;
  logins: Array<{ code: string; name: string; role: string }>;
  cycle: { start: string; end: string };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function createPerson(spec: { code: string; name: string; role: string }, org: { departmentId: string; designationId: string; locationId: string; gradeId: string | null; costCentreId: string | null }, passwordHash: string, index: number) {
  const employee = await prisma.employee.create({ data: { employeeCode: spec.code, dateOfJoining: DEMO_DIRECTORS.includes(spec.code) ? addCalendarDays(businessToday(), 366) : new Date("2024-04-01T00:00:00Z"), employmentType: "PERMANENT", officialEmail: `${spec.code.toLowerCase()}@demo.example.invalid` } });
  const user = await prisma.user.create({ data: { employeeId: employee.id, status: "ACTIVE", passwordHash, privacyNoticeAcceptedAt: new Date() } });
  await prisma.employeeNameHistory.create({ data: { employeeId: employee.id, fullName: spec.name, effectiveFrom: new Date("2024-04-01T00:00:00Z"), createdByUserId: user.id } });
  await prisma.employeePersonal.create({ data: { employeeId: employee.id, dateOfBirth: new Date("1990-01-01T00:00:00Z"), gender: "OTHER", personalEmail: `${spec.code.toLowerCase()}@demo.example.invalid`, mobile: "0000000000", currentAddress: "Demo address (made up)", permanentAddress: "Demo address (made up)", emergencyContactName: "Demo Contact", emergencyContactPhone: "0000000001", emergencyContactRelation: "Demo" } });
  await prisma.employeeJobHistory.create({ data: { employeeId: employee.id, departmentId: org.departmentId, designationId: org.designationId, locationId: org.locationId, gradeId: org.gradeId, costCentreId: org.costCentreId, effectiveFrom: new Date("2024-04-01T00:00:00Z"), createdByUserId: user.id } });
  await prisma.deviceUserMapping.create({ data: { employeeId: employee.id, deviceUserId: spec.code, validFrom: new Date("2024-04-01T00:00:00Z"), createdByUserId: user.id } });
  await prisma.attendanceAssignment.create({ data: { employeeId: employee.id, shiftId: "shift_gen", weekOffPatternId: "wop_sun", policyId: "policy_default", effectiveFrom: new Date("2024-04-01T00:00:00Z"), createdByUserId: user.id } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: spec.role } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  void index;
  return { employeeId: employee.id, userId: user.id };
}

/** Pay details for everyone active who lacks them: made-up numbers in a pattern that cannot be real (accounts begin 9999, PANs begin DEMO). */
export async function fillPayDetails(by: string): Promise<void> {
  const people = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, employeeCode: true, bankAccounts: { select: { id: true } }, statutory: { select: { uanEncrypted: true, panEncrypted: true } } }, orderBy: { employeeCode: "asc" } });
  let n = 0;
  for (const p of people) {
    n += 1;
    if (p.bankAccounts.length === 0) {
      await prisma.employeeBankAccount.create({ data: { employeeId: p.id, ...encryptBankFields({ accountHolderName: `Demo account ${p.employeeCode}`, accountNumber: `9999${String(100000 + n).padStart(8, "0")}`, ifsc: FAKE_IFSC, bankName: "Demo Bank (fictional)", branchName: "Demo branch" }), effectiveFrom: new Date("2024-04-01T00:00:00Z"), createdByUserId: by } });
    }
    const fields = encryptStatutoryFields({ ...(p.statutory?.panEncrypted ? {} : { pan: `DEMOX${String(1000 + n).padStart(4, "0")}Z` }), ...(p.statutory?.uanEncrypted ? {} : { uan: `99990000${String(1000 + n).padStart(4, "0")}` }) });
    if (!p.statutory?.uanEncrypted || !p.statutory?.panEncrypted) await prisma.employeeStatutory.upsert({ where: { employeeId: p.id }, create: { employeeId: p.id, ...fields, updatedByUserId: by }, update: { ...fields, updatedByUserId: by } });
  }
}

const T0 = Date.now();
const lap = (what: string) => {
  if (process.env.DEMO_TIMING) appendFileSync(process.env.DEMO_TIMING, `[demo ${((Date.now() - T0) / 1000).toFixed(1)}s] ${what}\n`);
};

export async function seedDemoCompany(): Promise<DemoResult> {
  if ((await prisma.devDatabaseMarker.count()) === 0) throw new Error("This is not a development database that has been seeded. Run `npm run db:seed` first.");
  if ((await prisma.systemSetting.findUnique({ where: { key: DEMO_SETTING } }))?.value === true) throw new Error("The demo company already exists in this database. To start again, rebuild it with `npm run db:seed`.");

  const dept = await prisma.department.findFirstOrThrow();
  const desig = await prisma.designation.findFirstOrThrow();
  const loc = await prisma.location.findFirstOrThrow({ where: { isActive: true } });
  const grade = await prisma.grade.findFirst();
  const cc = await prisma.costCentre.findFirst();
  const org = { departmentId: dept.id, designationId: desig.id, locationId: loc.id, gradeId: grade?.id ?? null, costCentreId: cc?.id ?? null };
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  lap("before: people");
  const who: Record<string, { employeeId: string; userId: string }> = {};
  for (const [i, spec] of DEMO_PEOPLE.entries()) who[spec.code] = await createPerson(spec, org, passwordHash, i);
  const owner = who.DEMO001!.userId;
  // The two directors: the owner prepares, the second owner checks (a Super Admin holds every permission, bank and statutory details included).
  const maker = owner;
  const checker = who.DEMO013!.userId;
  await setSetting(DEMO_SETTING, true, owner);

  lap("before: pay details");
  await fillPayDetails(who.DEMO004!.userId);

  // Rules: written by the payroll admin, confirmed by the approver, retyping where the screen asks for it.
  const states = (await prisma.location.findMany({ select: { state: true } })).map((l) => l.state);
  const rules: Record<string, unknown> = { ...RULES, STATE_NAME_MAP: Object.fromEntries([...new Set(states)].map((s) => [s, "DEMO_STATE"])), ...DEMO_IDENTIFIERS };
  for (const def of RULE_CATALOG) {
    const value = rules[def.key];
    if (value === undefined && def.placeholder === undefined) continue; // nothing to enter and nothing shipped (for example the fixed number of days, unused on a calendar-days basis)
    if (value !== undefined) {
      const p = await previewEdit(def.key, value);
      await editRule(def.key, { value, note: "DEMO COMPANY: made-up value", fingerprint: p.fingerprint }, { userId: maker });
    }
    const c = await previewConfirm(def.key, checker);
    if (c.blocked) throw new Error(`The demo cannot confirm ${def.key}: ${c.blocked}`);
    const typed = def.sensitiveClass ? rules[def.key] : c.value;
    await confirmRule(def.key, { version: c.version, ...(c.requiresRetype ? { typedValue: typed } : {}), note: "DEMO COMPANY: confirmed for the demo only", fingerprint: c.fingerprint }, { userId: checker });
  }

  lap("before: rules done");
  // Components and a structure: BASIC is 40% of CTC, HRA is half of BASIC, SPECIAL balances.
  for (const [i, code] of ["DEMO_BASIC", "DEMO_HRA", "DEMO_SPECIAL"].entries()) {
    const value = COMPONENT(code, i + 1, code === "DEMO_BASIC" ? { pfApplicable: true, esiApplicable: true } : {});
    const p = await previewComponentSave(code, value);
    await saveComponent(code, { value, note: "DEMO COMPANY", fingerprint: p.fingerprint }, { userId: maker });
    const c = await previewComponentConfirm(code, checker);
    await confirmComponent(code, { version: c.version, note: "DEMO COMPANY", fingerprint: c.fingerprint }, { userId: checker });
  }
  const pin = async (code: string) => {
    const row = await prisma.payrollItemVersion.findFirstOrThrow({ where: { kind: "COMPONENT", key: code, version: 1 } });
    return { component: code, componentVersion: 1, componentHash: row.valueHash };
  };
  const structure = { name: "Demo standard", ctcIncludes: ["EARNING"], lines: [{ ...(await pin("DEMO_BASIC")), calc: { method: "PERCENT", of: "CTC", percent: "40" } }, { ...(await pin("DEMO_HRA")), calc: { method: "PERCENT", of: "DEMO_BASIC", percent: "50" } }, { ...(await pin("DEMO_SPECIAL")), calc: { method: "BALANCE" } }] };
  const sp = await previewStructureSave("DEMO_STD", structure, "1200000");
  await saveStructure("DEMO_STD", { value: structure, sampleAnnualCtc: "1200000", note: "DEMO COMPANY", fingerprint: sp.fingerprint }, { userId: maker });
  const sc = await previewStructureConfirm("DEMO_STD", checker);
  await confirmStructure("DEMO_STD", { version: sc.version, note: "DEMO COMPANY", fingerprint: sc.fingerprint }, { userId: checker });

  lap("before: components+structure done");
  // The bank layout and the debit account: entered by the payroll admin, confirmed by the approver.
  const lp = await previewLayoutSave("BANK_TEMPLATE", { ...DEMO_BANK_LAYOUT, debitAccountNumber: DEMO_DEBIT_ACCOUNT });
  await saveLayout("BANK_TEMPLATE", { value: { ...DEMO_BANK_LAYOUT, debitAccountNumber: DEMO_DEBIT_ACCOUNT }, note: "DEMO COMPANY: a fictional format", fingerprint: lp.fingerprint }, { userId: maker });
  const lc = await previewLayoutConfirm("BANK_TEMPLATE", checker);
  await confirmLayout("BANK_TEMPLATE", { version: lc.version, note: "DEMO COMPANY", fingerprint: lc.fingerprint }, { userId: checker });

  lap("before: layout done");
  // Salaries: three pay levels, each a salary revision a different person approves. The directors are not on the demo payroll (see DEMO_DIRECTORS).
  const todayDate = businessToday();
  const active = await prisma.employee.findMany({ where: { status: "ACTIVE", dateOfJoining: { lte: todayDate } }, select: { id: true, employeeCode: true, dateOfJoining: true }, orderBy: { employeeCode: "asc" } });
  const tiers = ["420000", "720000", "1080000"];
  // One revision for each pay level and start date. A salary starts two months before the month the demo pays (or on the joining date, if later: a salary cannot start before a person joined); starting years earlier would make every revision work out years of back-pay.
  const salaryFloor = iso(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - 3, 1)));
  const groups = new Map<string, { annual: string; from: string; ids: string[] }>();
  active.forEach((e, i) => {
    const annual = tiers[i % tiers.length]!;
    const joined = iso(e.dateOfJoining);
    const from = joined > salaryFloor ? joined : salaryFloor;
    const g = groups.get(`${annual}|${from}`) ?? { annual, from, ids: [] };
    g.ids.push(e.id);
    groups.set(`${annual}|${from}`, g);
  });
  const revise = async (annual: string, ids: string[], makerId: string, from: string, checkerId: string = checker) => {
    const input = { selection: { kind: "EMPLOYEES", employeeIds: ids }, change: { ctc: { mode: "SET", annual }, structure: { key: "DEMO_STD", version: 1 } }, effectiveFrom: from, note: "DEMO COMPANY" };
    lap(`revision ${annual} ${from} x${ids.length}: preview`);
    const pr = await previewRevision(input, makerId);
    lap("create");
    const made = await createRevision(input, pr.fingerprint, { userId: makerId });
    lap("get");
    const detail = await getRevision(made.id, checkerId);
    lap("decide");
    await decideRevision(made.id, { decision: "APPROVE", note: "DEMO COMPANY", fingerprint: detail.fingerprint }, { userId: checkerId });
    lap("apply");
    await applyRevision(made.id, { userId: makerId });
    lap("applied");
  };
  for (const g of groups.values()) await revise(g.annual, g.ids, maker, g.from);

  lap("before: salaries done");
  // Attendance for the last full month, locked, so a run for it has nobody left out.
  const today = businessToday();
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const last = addCalendarDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), -1);
  const rows = [];
  for (const e of active) {
    for (let d = first; d <= last; d = addCalendarDays(d, 1)) rows.push({ employeeId: e.id, date: d, status: d.getUTCDay() === 0 ? "O" : "P", lopDays: "0", source: "DEVICE" as const, capture: "DEVICE" as const, engineVersion: 1, isLocked: true });
  }
  await prisma.dailyAttendance.deleteMany({ where: { employeeId: { in: active.map((e) => e.id) }, date: { gte: first, lte: last } } }); // whatever the development seed left for that month is replaced
  await prisma.dailyAttendance.createMany({ data: rows });

  lap("before: attendance done");
  // People's pay details: checked and signed off by the approver, who entered none of them.
  const access = await resolveAccess(checker);
  for (const area of ["SALARIES", "BANK_ACCOUNTS", "STATUTORY_IDS"] as const) {
    const p = await previewSignoff(area, checker, access.permissions);
    if (p.blocked) throw new Error(`The demo cannot sign off ${area}: ${p.blocked}`);
    await giveSignoff(area, { fingerprint: p.fingerprint, note: "DEMO COMPANY: made-up data checked by the demo approver" }, { userId: checker, permissions: access.permissions });
  }

  lap("before: signoffs done");
  return { people: active.length, paid: active.length, password: DEMO_PASSWORD, logins: DEMO_PEOPLE.map((p) => ({ code: p.code, name: p.name, role: p.role })), cycle: { start: iso(first), end: iso(last) } };
}
