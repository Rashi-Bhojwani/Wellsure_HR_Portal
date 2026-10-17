import { randomBytes } from "node:crypto";
import request from "supertest";
import { addCalendarDays } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { ensurePayrollRules } from "../rules/governed";
import { executeCalculation, setCalculationEnqueuer } from "../run/engine";
import { cleanupPayrollRowsBy } from "./payrollTestHelpers";
import { componentPin, makeComponent, makeStructure, setRule, type Person, type SalaryWorld } from "./salaryTestHelpers";

// A world for the payroll-run tests: a maker, two checkers, named staff, the company rules set, four components (Basic and HRA and the balance count for ESI, Basic
// for PF, the conveyance does not pro-rate) and one structure: Basic 40% of CTC, HRA 50% of Basic, Conveyance a fixed 1,600, Special the balance. At a CTC of
// 600,000 a month is Basic 20,000, HRA 10,000, Conveyance 1,600, Special 18,400 (50,000).

export interface RunWorld extends SalaryWorld {
  named: Record<string, Person>;
}

export const CYCLE = { start: "2026-08-01", end: "2026-08-31", label: "Aug 2026" }; // 31 days, over, and in the past at any instant the suite runs
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const day = (s: string) => new Date(`${s}T00:00:00Z`);

export const COMPANY_RULES: Record<string, unknown> = {
  PAY_DAYS_BASIS: "CALENDAR_DAYS",
  LOP_DIVISOR: "SAME_AS_PAY_DAYS_BASIS",
  LINE_ROUNDING: { mode: "HALF_UP", scale: 0 },
  NET_PAY_ROUNDING: { mode: "NONE", scale: 0 },
  PAYMENT_DATE_RULE: { monthOffset: 0, day: "LAST" },
  LEAVER_PAYMENT_TIMING: "PAY_WITH_RUN",
  NEGATIVE_NET_POLICY: "BLOCK",
  PF_CEILING_MODE: "CAP_AT_CEILING",
  ESI_PERIOD_RULE: "MONTHLY",
  PF_ELIGIBLE_TYPES: ["PERMANENT"],
  ESI_ELIGIBLE_TYPES: ["PERMANENT"],
};

export async function setRules(actorUserId: string, rules: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(rules)) await setRule(actorUserId, key, value);
}

export async function buildRunWorld(names: string[], over: { companyRules?: boolean } = {}): Promise<RunWorld> {
  await ensurePayrollRules();
  const org = await createEmployeeTestOrgMasters();
  const prefix = `R${randomBytes(2).toString("hex").toUpperCase()}`;
  const maker = await createFullTestEmployee(org, { roleCode: "PAYROLL_ADMIN" });
  const checkerA = await createFullTestEmployee(org, { roleCode: "PAYROLL_APPROVER" });
  const checkerB = await createFullTestEmployee(org, { roleCode: "PAYROLL_APPROVER" });
  const named: Record<string, Person> = {};
  for (const n of names) named[n] = await createFullTestEmployee(org);
  const world: RunWorld = {
    org,
    maker,
    checkerA,
    checkerB,
    staff: Object.values(named),
    named,
    tokens: { maker: await loginAs(maker.employeeCode), checkerA: await loginAs(checkerA.employeeCode), checkerB: await loginAs(checkerB.employeeCode) },
    prefix,
    basic: `${prefix}_BASIC`,
    hra: `${prefix}_HRA`,
    special: `${prefix}_SPECIAL`,
    conveyance: `${prefix}_CONV`,
    structure: `${prefix}_STD`,
    userIds: [maker.userId, checkerA.userId, checkerB.userId, ...Object.values(named).map((s) => s.userId)],
  };
  if (over.companyRules !== false) await setRules(maker.userId, COMPANY_RULES);
  else await setRules(maker.userId, { LINE_ROUNDING: COMPANY_RULES.LINE_ROUNDING }); // a salary cannot be built without it; everything else stays unset
  await makeComponent(world, world.basic, { payslipOrder: 1, pfApplicable: true, esiApplicable: true, payslipLabel: "Basic" });
  await makeComponent(world, world.hra, { payslipOrder: 2, esiApplicable: true, payslipLabel: "HRA" });
  await makeComponent(world, world.conveyance, { payslipOrder: 3, prorates: false, payslipLabel: "Conveyance" });
  await makeComponent(world, world.special, { payslipOrder: 4, esiApplicable: true, payslipLabel: "Special allowance" });
  const [b, h, c, s] = await Promise.all([componentPin(world.basic), componentPin(world.hra), componentPin(world.conveyance), componentPin(world.special)]);
  await makeStructure(world, world.structure, {
    name: "Run test structure",
    ctcIncludes: ["EARNING"],
    lines: [
      { ...b, calc: { method: "PERCENT", of: "CTC", percent: "40" } },
      { ...h, calc: { method: "PERCENT", of: world.basic, percent: "50" } },
      { ...c, calc: { method: "FIXED_AMOUNT", amount: "1600" } },
      { ...s, calc: { method: "BALANCE" } },
    ],
  });
  return world;
}

export async function teardownRunWorld(world: RunWorld): Promise<void> {
  setCalculationEnqueuer(null);
  for (const p of [...world.staff, world.checkerB, world.checkerA, world.maker]) await cleanupFullTestEmployee(p.employeeId);
  await cleanupPayrollRowsBy(world.userIds);
  await cleanupEmployeeTestOrgMasters(world.org);
}

/** Locked attendance for a whole cycle: present every day (Sundays a week off), except where `over` says otherwise. Days can also be left unlocked. */
export async function lockCycle(employeeId: string, from: string, to: string, over: Record<string, { status?: string; lop?: string; locked?: boolean }> = {}): Promise<void> {
  const rows = [];
  for (let d = day(from); d <= day(to); d = addCalendarDays(d, 1)) {
    const o = over[iso(d)];
    rows.push({
      employeeId,
      date: d,
      status: o?.status ?? (d.getUTCDay() === 0 ? "O" : "P"),
      lopDays: o?.lop ?? "0",
      source: "DEVICE" as const,
      capture: "DEVICE" as const,
      engineVersion: 1,
      isLocked: o?.locked ?? true,
    });
  }
  await prisma.dailyAttendance.createMany({ data: rows });
}

export const api = (token: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/payroll${path}`).set(...authHeader(token)).send(body);

/** Makes a run for the cycle, previews, requests the calculation and runs the job directly. Returns the run id. */
export async function calculateRun(world: RunWorld, cycleStart = CYCLE.start): Promise<string> {
  const queued: string[] = [];
  setCalculationEnqueuer(async (runId) => void queued.push(runId));
  const created = await api(world.tokens.maker, "post", "/runs", { cycleStart });
  if (created.status !== 201) throw new Error(`create run: ${JSON.stringify(created.body)}`);
  const id = created.body.id as string;
  await calculateAgain(world, id);
  return id;
}

export async function calculateAgain(world: RunWorld, runId: string): Promise<void> {
  const preview = await api(world.tokens.maker, "post", `/runs/${runId}/calculate-preview`);
  if (preview.status !== 200) throw new Error(`calculate preview: ${JSON.stringify(preview.body)}`);
  const asked = await api(world.tokens.maker, "post", `/runs/${runId}/calculate`, { fingerprint: preview.body.fingerprint });
  if (asked.status !== 202) throw new Error(`calculate: ${JSON.stringify(asked.body)}`);
  await executeCalculation(runId, "test");
}
