import { randomBytes } from "node:crypto";
import type { ComponentType } from "@shared/constants/payrollSalary";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { editRule, ensurePayrollRules, previewEdit } from "../rules/governed";
import { confirmComponent, previewComponentConfirm, previewComponentSave, saveComponent } from "../salary/components";
import { confirmStructure, previewStructureConfirm, previewStructureSave, saveStructure } from "../salary/structures";
import { cleanupPayrollRowsBy, useSecondDirectorChecks } from "./payrollTestHelpers";

// A small world for the salary tests: a maker, two checkers, three ordinary employees, the rounding rule set, three components and a structure
// (Basic 40% of CTC, HRA 50% of Basic, Special allowance the balance), the components confirmed by one checker and the structure by the other.
// Codes carry a random prefix so two runs never meet. Everything this creates is removed by teardownSalaryWorld, in an order the foreign keys allow.

export interface Person {
  employeeId: string;
  userId: string;
  employeeCode: string;
}

export interface SalaryWorld {
  org: TestOrgMasters;
  maker: Person;
  checkerA: Person;
  checkerB: Person;
  /** An HR Executive: holds no payroll permission at all, so it stands for "somebody who is neither a maker nor a checker". (The payroll roles are for directors only, so the three above are Super Admins.) */
  outsider: Person;
  staff: Person[];
  tokens: { maker: string; checkerA: string; checkerB: string; outsider: string };
  prefix: string;
  basic: string;
  hra: string;
  special: string;
  conveyance: string;
  structure: string;
  userIds: string[];
  /** Puts the second-director setting back (see useSecondDirectorChecks). */
  restoreSwitches?: () => Promise<void>;
}

export const FIRST_SALARY_DAY = "2025-04-01"; // always in the past, after the test employees' joining date (2024-01-01)
export const REVISION_DAY = "2026-04-01";

export async function setRule(actorUserId: string, key: string, value: unknown): Promise<void> {
  const preview = await previewEdit(key, value);
  await editRule(key, { value, note: "test", sourceNote: "test fixture: a made-up source", effectiveFrom: "2026-04-01", fingerprint: preview.fingerprint }, { userId: actorUserId });
}

export async function makeComponent(world: Pick<SalaryWorld, "maker" | "checkerA">, code: string, over: Record<string, unknown> = {}, confirm = true): Promise<void> {
  const value = { name: code, type: "EARNING" as ComponentType, taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: code, payslipOrder: 1, ...over };
  const p = await previewComponentSave(code, value);
  await saveComponent(code, { value, note: "test", fingerprint: p.fingerprint }, { userId: world.maker.userId });
  if (confirm) {
    const c = await previewComponentConfirm(code, world.checkerA.userId);
    await confirmComponent(code, { version: c.version, note: "checked in the test", fingerprint: c.fingerprint }, { userId: world.checkerA.userId });
  }
}

export async function componentPin(code: string, version = 1): Promise<{ component: string; componentVersion: number; componentHash: string }> {
  const row = await prisma.payrollItemVersion.findFirstOrThrow({ where: { kind: "COMPONENT", key: code, version } });
  return { component: code, componentVersion: version, componentHash: row.valueHash };
}

export async function makeStructure(world: Pick<SalaryWorld, "maker" | "checkerB">, code: string, value: unknown, sampleAnnualCtc = "1200000", confirm = true): Promise<void> {
  const p = await previewStructureSave(code, value, sampleAnnualCtc);
  await saveStructure(code, { value, sampleAnnualCtc, note: "test", fingerprint: p.fingerprint }, { userId: world.maker.userId });
  if (confirm) {
    const c = await previewStructureConfirm(code, world.checkerB.userId);
    await confirmStructure(code, { version: c.version, note: "checked in the test", fingerprint: c.fingerprint }, { userId: world.checkerB.userId });
  }
}

export async function buildSalaryWorld(): Promise<SalaryWorld> {
  const restoreSwitches = await useSecondDirectorChecks(); // these tests describe the two-director behaviour; D2's own tests cover a director acting alone
  await ensurePayrollRules();
  const org = await createEmployeeTestOrgMasters();
  const prefix = `T${randomBytes(2).toString("hex").toUpperCase()}`;
  const maker = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
  const checkerA = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
  const checkerB = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
  const outsider = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
  const staff = [await createFullTestEmployee(org), await createFullTestEmployee(org), await createFullTestEmployee(org)];
  const world: SalaryWorld = {
    org,
    maker,
    checkerA,
    checkerB,
    outsider,
    staff,
    tokens: { maker: await loginAs(maker.employeeCode), checkerA: await loginAs(checkerA.employeeCode), checkerB: await loginAs(checkerB.employeeCode), outsider: await loginAs(outsider.employeeCode) },
    prefix,
    basic: `${prefix}_BASIC`,
    hra: `${prefix}_HRA`,
    special: `${prefix}_SPECIAL`,
    conveyance: `${prefix}_CONV`,
    structure: `${prefix}_STD`,
    userIds: [maker.userId, checkerA.userId, checkerB.userId, outsider.userId, ...staff.map((s) => s.userId)],
    restoreSwitches,
  };
  await setRule(maker.userId, "LINE_ROUNDING", { mode: "HALF_UP", scale: 0 });
  await makeComponent(world, world.basic, { payslipOrder: 1 });
  await makeComponent(world, world.hra, { payslipOrder: 2 });
  await makeComponent(world, world.special, { payslipOrder: 3 });
  await makeComponent(world, world.conveyance, { payslipOrder: 4 });
  const [b, h, s] = await Promise.all([componentPin(world.basic), componentPin(world.hra), componentPin(world.special)]);
  await makeStructure(world, world.structure, {
    name: "Test structure",
    ctcIncludes: ["EARNING"],
    lines: [
      { ...b, calc: { method: "PERCENT", of: "CTC", percent: "40" } },
      { ...h, calc: { method: "PERCENT", of: world.basic, percent: "50" } },
      { ...s, calc: { method: "BALANCE" } },
    ],
  });
  return world;
}

export async function teardownSalaryWorld(world: SalaryWorld): Promise<void> {
  for (const p of [...world.staff, world.outsider, world.checkerB, world.checkerA, world.maker]) await cleanupFullTestEmployee(p.employeeId);
  await cleanupPayrollRowsBy(world.userIds);
  await cleanupEmployeeTestOrgMasters(world.org);
  await world.restoreSwitches?.();
}

/** Gives somebody a salary the way the product does: a revision, a decision by a checker, and the maker applying it. Returns the revision id. */
export async function giveSalary(world: SalaryWorld, employeeId: string, annual: string, effectiveFrom = FIRST_SALARY_DAY, extra: Record<string, unknown> = {}): Promise<string> {
  const { default: request } = await import("supertest");
  const { app, authHeader } = await import("../../employee/__tests__/employeeTestHelpers");
  const call = (token: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/payroll${path}`).set(...authHeader(token)).send(body);
  const input = { selection: { kind: "EMPLOYEES", employeeIds: [employeeId] }, change: { ctc: { mode: "SET", annual }, structure: { key: world.structure, version: 1 } }, effectiveFrom, note: "test", ...extra };
  const preview = await call(world.tokens.maker, "post", "/salary/revisions/preview", { input });
  if (preview.status !== 200 || preview.body.blockers.length) throw new Error(`giveSalary preview: ${JSON.stringify(preview.body)}`);
  const created = await call(world.tokens.maker, "post", "/salary/revisions", { input, fingerprint: preview.body.fingerprint });
  if (created.status !== 201) throw new Error(`giveSalary create: ${JSON.stringify(created.body)}`);
  const detail = await call(world.tokens.checkerA, "get", `/salary/revisions/${created.body.id}`);
  const decided = await call(world.tokens.checkerA, "post", `/salary/revisions/${created.body.id}/decision`, { decision: "APPROVE", note: "ok", fingerprint: detail.body.fingerprint });
  if (decided.status !== 200) throw new Error(`giveSalary decide: ${JSON.stringify(decided.body)}`);
  const applied = await call(world.tokens.maker, "post", `/salary/revisions/${created.body.id}/apply`);
  if (applied.status !== 200) throw new Error(`giveSalary apply: ${JSON.stringify(applied.body)}`);
  return created.body.id as string;
}
