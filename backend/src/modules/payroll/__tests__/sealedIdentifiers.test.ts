import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, cleanupTestRole, createEmployeeTestOrgMasters, createFullTestEmployee, grantPermissions, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { JSON_HELD_COLUMNS, keyUsage, retireBlockers } from "../../../lib/fieldKeyRotation";
import { isSealed, unseal } from "../sealed";
import { cleanupPayrollRowsBy } from "./payrollTestHelpers";

// The company's PF, ESI, PT, LWF and TAN identifiers are the owners' secrets (docs/plans/PHASE_6.md §14J): entered and revealed only with payroll.identifiers.manage, confirmed
// only with payroll.identifiers.confirm (by typing the value again, so the confirmer never needs to see it), stored encrypted, and shown nowhere else.

const SECRET = "ZZPF/90817/SENTINEL-0042";
const KEY = "PF_ESTABLISHMENT_CODE";

describe("sealed company identifiers", () => {
  let org: TestOrgMasters;
  const people = {} as Record<"maker" | "checker" | "rulesOnly" | "rulesChecker" | "dev", { employeeId: string; userId: string; employeeCode: string }>;
  const tokens = {} as Record<keyof typeof people, string>;
  const rulesOnlyRole = `TEST_RULES_ONLY_${Date.now()}`;
  const rulesConfirmRole = `TEST_RULES_CONFIRM_${Date.now()}`;
  const api = (t: string) => ({
    get: (p: string) => request(app).get(`/api/payroll${p}`).set(...authHeader(t)),
    post: (p: string, b: object = {}) => request(app).post(`/api/payroll${p}`).set(...authHeader(t)).send(b),
    put: (p: string, b: object = {}) => request(app).put(`/api/payroll${p}`).set(...authHeader(t)).send(b),
  });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(rulesOnlyRole, ["payroll.rules.view", "payroll.rules.manage"]);
    await grantPermissions(rulesConfirmRole, ["payroll.rules.view", "payroll.rules.confirm"]);
    people.maker = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    people.checker = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    people.rulesOnly = await createFullTestEmployee(org, { roleCode: rulesOnlyRole });
    people.rulesChecker = await createFullTestEmployee(org, { roleCode: rulesConfirmRole });
    people.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    for (const k of Object.keys(people) as Array<keyof typeof people>) tokens[k] = await loginAs(people[k].employeeCode);
  });
  afterAll(async () => {
    await cleanupPayrollRowsBy(Object.values(people).map((p) => p.userId));
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupTestRole(rulesOnlyRole);
    await cleanupTestRole(rulesConfirmRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("only a holder of payroll.identifiers.manage may enter one: payroll.rules.manage and the developer may not, though both may edit an ordinary rule", async () => {
    const attempt = (t: string, key: string, value: unknown) => api(t).post(`/rules/${key}/edit-preview`, { value });
    expect((await attempt(tokens.rulesOnly, KEY, SECRET)).status).toBe(403);
    expect((await attempt(tokens.dev, KEY, SECRET)).status).toBe(403);
    expect((await attempt(tokens.rulesChecker, KEY, SECRET)).status).toBe(403); // a holder of the confirm key only confirms, never enters
    expect((await attempt(tokens.rulesOnly, "PAY_DAYS_BASIS", "CALENDAR_DAYS")).status).toBe(200);
    expect((await attempt(tokens.maker, KEY, SECRET)).status).toBe(200);
  });

  it("entering one: the preview and the result never carry the value, and it is stored encrypted with a keyed hash", async () => {
    const pre = await api(tokens.maker).post(`/rules/${KEY}/edit-preview`, { value: SECRET });
    expect(pre.status).toBe(200);
    expect(JSON.stringify(pre.body)).not.toContain(SECRET);
    expect(pre.body.after.value).toEqual({ hidden: true });
    const saved = await api(tokens.maker).put(`/rules/${KEY}`, { value: SECRET, note: "from the PF registration letter", fingerprint: pre.body.fingerprint });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(SECRET);
    expect(saved.body).toMatchObject({ sealed: true, status: "PLACEHOLDER", current: { version: 1, value: { hidden: true } } });
    const row = await prisma.payrollItemVersion.findFirstOrThrow({ where: { kind: "RULE", key: KEY, version: 1 } });
    expect(isSealed(row.value)).toBe(true);
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(unseal(row.value as { sealed: string })).toBe(SECRET);
    expect(row.valueHash).toMatch(/^sealed-hash-v1:/);
  });

  it("key rotation knows about it: it is counted under its data key and blocks retiring that key (a sealed value must never be stranded)", async () => {
    const row = await prisma.payrollItemVersion.findFirstOrThrow({ where: { kind: "RULE", key: KEY, version: 1 }, select: { id: true } });
    const only = (id: string) => id === row.id;
    expect(await keyUsage({ filter: only })).toEqual([{ column: JSON_HELD_COLUMNS.sealed, keyId: 1, count: 1 }]);
    expect(await retireBlockers(1, { filter: only })).toEqual([{ column: JSON_HELD_COLUMNS.sealed, keyId: 1, count: 1 }]);
    expect(await retireBlockers(2, { filter: only })).toEqual([]);
  });

  it("nobody sees it in a list, a detail, a history or the audit viewer; even the person who entered it must Reveal it, and that is recorded without the value", async () => {
    for (const t of [tokens.maker, tokens.checker, tokens.dev, tokens.rulesOnly]) {
      const list = await api(t).get("/rules");
      const one = await api(t).get(`/rules/${KEY}`);
      expect(JSON.stringify([list.body, one.body]), "a response").not.toContain(SECRET);
      expect(one.body.rule.sealed).toBe(true);
    }
    const reveal = await api(tokens.maker).post(`/rules/${KEY}/reveal`);
    expect(reveal.status).toBe(200);
    expect(reveal.body).toMatchObject({ key: KEY, version: 1, value: SECRET });
    const rows = await prisma.auditLog.findMany({ where: { action: "payroll.rule.revealed", entityId: KEY, actorUserId: people.maker.userId } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    // The checker, the developer, a rules-only editor and an ordinary rule cannot use Reveal.
    for (const t of [tokens.rulesChecker, tokens.dev, tokens.rulesOnly]) expect((await api(t).post(`/rules/${KEY}/reveal`)).status).toBe(403);
    expect((await api(tokens.maker).post("/rules/PAY_DAYS_BASIS/reveal")).status).toBe(400);
    // The edit is in the audit log as an edit, with no value.
    const edits = await prisma.auditLog.findMany({ where: { entityType: "PayrollRule", entityId: KEY } });
    expect(edits.length).toBeGreaterThan(0);
    expect(JSON.stringify(edits)).not.toContain(SECRET);
    const events = await prisma.payrollEvent.findMany({ where: { subjectId: KEY } });
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it("confirming needs payroll.identifiers.confirm, a different person, and the value typed again; the confirmer is never shown it", async () => {
    // payroll.rules.confirm alone is not enough.
    expect((await api(tokens.rulesChecker).post(`/rules/${KEY}/confirm-preview`)).status).toBe(403);
    expect((await api(tokens.maker).post(`/rules/${KEY}/confirm-preview`)).body.blocked).toMatch(/You wrote this value/); // a director holds both keys, and is told why they cannot confirm their own
    const pre = await api(tokens.checker).post(`/rules/${KEY}/confirm-preview`);
    expect(pre.status).toBe(200);
    expect(pre.body.requiresRetype).toBe(true);
    expect(JSON.stringify(pre.body)).not.toContain(SECRET);
    expect(pre.body.checkers.eligible.map((c: { userId: string }) => c.userId)).toContain(people.checker.userId); // counted by payroll.identifiers.confirm
    const confirm = (typed?: string) => api(tokens.checker).post(`/rules/${KEY}/confirm`, { version: 1, typedValue: typed, note: "checked against the registration letter", fingerprint: pre.body.fingerprint });
    const none = await confirm();
    expect([none.status, none.body.error.code]).toEqual([400, "RETYPE_REQUIRED"]);
    const wrong = await confirm("ZZPF/90817/SENTINEL-0043");
    expect([wrong.status, wrong.body.error.code]).toEqual([400, "RETYPE_MISMATCH"]);
    expect(JSON.stringify(wrong.body)).not.toContain("SENTINEL-004"); // neither the typed value nor the stored one is echoed
    // The author cannot confirm even with the right value (and holds no confirm permission anyway).
    expect((await api(tokens.maker).post(`/rules/${KEY}/confirm`, { version: 1, typedValue: SECRET, note: "mine", fingerprint: pre.body.fingerprint })).status).toBe(403);
    const ok = await confirm(SECRET);
    expect([ok.status, ok.body.status]).toEqual([200, "CONFIRMED"]);
    expect(JSON.stringify(ok.body)).not.toContain(SECRET);
    expect(ok.body.sourceLabel).toMatch(/^Confirmed by /);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: KEY } }))).not.toContain(SECRET);
    expect(JSON.stringify(await prisma.payrollApproval.findMany({ where: { subjectId: `${KEY}@1` } }))).not.toContain(SECRET);
  });

  it("changing a confirmed identifier makes a new unconfirmed version, and the old value stays out of every view", async () => {
    const next = "ZZPF/90817/SENTINEL-0099";
    const pre = await api(tokens.maker).post(`/rules/${KEY}/edit-preview`, { value: next });
    expect(pre.body).toMatchObject({ willResetConfirmation: true, unchanged: false });
    expect(JSON.stringify(pre.body)).not.toContain(SECRET);
    const saved = await api(tokens.maker).put(`/rules/${KEY}`, { value: next, fingerprint: pre.body.fingerprint });
    expect(saved.body).toMatchObject({ status: "PLACEHOLDER", current: { version: 2 }, lastConfirmed: { version: 1, value: { hidden: true } } });
    const again = await api(tokens.maker).post(`/rules/${KEY}/edit-preview`, { value: next });
    expect(again.body.unchanged).toBe(true); // the keyed hash recognises the same value
    expect(JSON.stringify([saved.body, await api(tokens.dev).get(`/rules/${KEY}`).then((r) => r.body)])).not.toContain("SENTINEL-00");
  });

  it("an invalid value is refused without being echoed", async () => {
    const tooLong = `LONG-SENTINEL-${"x".repeat(150)}`;
    const r = await api(tokens.maker).post(`/rules/${KEY}/edit-preview`, { value: tooLong });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain("LONG-SENTINEL");
  });

  it("the company's PAN and TAN are sealed identifiers like the others, and the company record has no plain PAN or TAN column (P7-0)", async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company'`;
    expect(cols.map((c) => c.column_name)).not.toContain("pan");
    expect(cols.map((c) => c.column_name)).not.toContain("tan");
    for (const key of ["COMPANY_PAN", "TAN"]) {
      expect((await api(tokens.rulesOnly).post(`/rules/${key}/edit-preview`, { value: "AAAPZ9999Q" })).status).toBe(403);
      expect((await api(tokens.dev).post(`/rules/${key}/edit-preview`, { value: "AAAPZ9999Q" })).status).toBe(403);
    }
    const value = "ZZPAN-SENTINEL-0099";
    const pre = await api(tokens.maker).post(`/rules/COMPANY_PAN/edit-preview`, { value });
    expect(pre.status).toBe(200);
    expect(JSON.stringify(pre.body)).not.toContain(value);
    expect((await api(tokens.maker).put(`/rules/COMPANY_PAN`, { value, fingerprint: pre.body.fingerprint })).status).toBe(200);
    const row = await prisma.payrollItemVersion.findFirstOrThrow({ where: { kind: "RULE", key: "COMPANY_PAN" }, orderBy: { version: "desc" } });
    if (!isSealed(row.value)) throw new Error("COMPANY_PAN was stored unsealed");
    expect(unseal(row.value)).toBe(value);
    expect(JSON.stringify(row.value)).not.toContain(value);
  });

  it("nothing in the database holds an identifier in the clear: no column of any table, whichever table it is", async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'json', 'jsonb')`;
    for (const t of tables) {
      const n = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT count(*)::bigint AS c FROM "${t.table_name}" WHERE "${t.column_name}"::text LIKE '%SENTINEL-00%'`);
      expect(Number(n[0]!.c), `${t.table_name}.${t.column_name}`).toBe(0);
    }
  });
});
