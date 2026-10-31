import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { RULE_CATALOG } from "@shared/constants/payrollRules";
import { SENSITIVE_PERMISSION_KEYS } from "@shared/constants/sensitiveData";
import { DEMO_BANK_LAYOUT, DEMO_DEBIT_ACCOUNT, DEMO_IDENTIFIERS, DEMO_PASSWORD, seedDemoCompany, type DemoResult } from "../../../../scripts/demo/seedDemoCompany";
import { storageService } from "../../../integrations/storage";
import { decryptField } from "../../../lib/encryption";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { clearRateLimits } from "../../auth/__tests__/authTestHelpers";
import { app } from "../../employee/__tests__/employeeTestHelpers";
import { executeCalculation, setCalculationEnqueuer } from "../run/engine";
import { DEMO_WATERMARK } from "../run/release";
import { registerPayrollSeams } from "../wiring";
import type { RulePin } from "../rules/context";
import { crawlGets } from "./sensitiveCrawl";

interface SetupItemShape {
  id: string;
  required: boolean;
  status: string;
  problem?: unknown;
  detail: string;
  coverage: { covered: number; total: number; missing: Array<{ employeeId: string }> };
  enteredBy?: { name?: string; at?: string } | null;
  confirmedBy: { name?: string; at?: string };
}


// The demo company, built from scratch on the suite's own database and then driven through a whole payroll run, as the demo users, by the same API the screens use. What it proves:
// the Setup Checklist can really be completed (Ready goes green with nothing left out), the run that follows is a real one (no TEST mark), and the developer's login sees none of it.

describe("the demo company", () => {
  let demo: DemoResult;
  const token: Record<string, string> = {};
  const call = (who: string, method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](`/api/${path}`).set("Authorization", `Bearer ${token[who]}`).send(body);

  beforeAll(async () => {
    registerPayrollSeams();
    demo = await seedDemoCompany();
    for (const l of demo.logins) {
      await clearRateLimits();
      const r = await request(app).post("/api/auth/login").send({ employeeCode: l.code, password: DEMO_PASSWORD });
      if (r.status !== 200 || !r.body.accessToken) throw new Error(`login ${l.code}: ${r.status} ${JSON.stringify(r.body)}`);
      token[l.code] = r.body.accessToken as string;
    }
  });

  it("refuses to be made twice", async () => {
    await expect(seedDemoCompany()).rejects.toThrow(/already exists/);
  });

  it("is marked as the demo on the Setup Checklist, and the Ready screen is green with nothing left out", async () => {
    const setup = await call("DEMO001", "get", "payroll/setup");
    expect(setup.body.demo).toBe(true);
    const ready = await call("DEMO001", "get", "payroll/setup/ready");
    expect(ready.body.blockers, JSON.stringify(ready.body.blockers)).toEqual([]);
    expect(ready.body).toMatchObject({ ready: true, demo: true });
    expect(ready.body.confirmed).toBe(ready.body.required);
    // Every item the demo makes is confirmed by someone other than who entered it.
    for (const item of setup.body.sections.flatMap((s: { items: Array<SetupItemShape> }) => s.items)) {
      expect(item.problem, item.id).toBeUndefined();
      if (item.enteredBy && item.confirmedBy && item.enteredBy.name && item.enteredBy.at) expect(item.enteredBy.name, item.id).not.toBe(item.confirmedBy.name);
    }
  });

  it("the people are made up, and so is everything about them", async () => {
    const demoPeople = await prisma.employee.findMany({ where: { employeeCode: { startsWith: "DEMO" } }, include: { bankAccounts: true, nameHistory: true } });
    expect(demoPeople).toHaveLength(13);
    for (const p of demoPeople) {
      expect(p.nameHistory[0]!.fullName).toMatch(/^Demo /);
      for (const b of p.bankAccounts) {
        expect(decryptField(b.accountNumberEncrypted)).toMatch(/^9999/);
        expect(b.ifsc).toBe("DEMO0000001");
      }
    }
  });

  it("the developer's demo login sees the state of the setup and none of the demo's secrets", async () => {
    const access = await resolveAccess((await prisma.user.findFirstOrThrow({ where: { employee: { employeeCode: "DEMO005" } } })).id);
    expect([...access.permissions].filter((k) => (SENSITIVE_PERMISSION_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect((await call("DEMO005", "get", "payroll/setup")).status).toBe(200);
    expect((await call("DEMO005", "get", "payroll/salary/employees")).status).toBe(403);
    expect((await call("DEMO005", "get", "payroll/layouts/BANK_TEMPLATE")).body.layout.current.value).toEqual({ restricted: true });
    const accounts = (await prisma.employeeBankAccount.findMany()).map((b) => decryptField(b.accountNumberEncrypted));
    const secrets = [DEMO_DEBIT_ACCOUNT, ...Object.values(DEMO_IDENTIFIERS), DEMO_BANK_LAYOUT.header[0]![0]!.value, ...accounts.slice(0, 20)];
    const crawled = await crawlGets(app, token.DEMO005!, { id: ["x"], employeeId: [(await prisma.employee.findFirstOrThrow({ where: { employeeCode: "DEMO006" } })).id], key: ["PF_ESTABLISHMENT_CODE", "BANK_TEMPLATE"] });
    expect(crawled.filter((c) => c.status === 200).length).toBeGreaterThan(20);
    const leaks = crawled.flatMap((c) => secrets.filter((s) => c.text.includes(s)).map((s) => `${c.route} → ${s.slice(0, 8)}…`));
    expect(leaks).toEqual([]);
  });

  it("a whole payroll run goes through every step on the demo company, and it is a real run, not a test", async () => {
    const queued: string[] = [];
    setCalculationEnqueuer(async (id) => void queued.push(id));
    const created = await call("DEMO001", "post", "payroll/runs", { cycleStart: demo.cycle.start });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const runId = created.body.id as string;
    const pre = await call("DEMO001", "post", `payroll/runs/${runId}/calculate-preview`);
    expect((await call("DEMO001", "post", `payroll/runs/${runId}/calculate`, { fingerprint: pre.body.fingerprint })).status).toBe(202);
    await executeCalculation(runId, "demo-test");
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("CALCULATED");
    expect([run.payableCount, run.heldCount, run.excludedCount]).toEqual([demo.paid, 0, 0]);

    const step = (who: string, slug: string, what: string, body?: object) => call(who, "post", `payroll/runs/${runId}/approvals/${slug}/${what}`, body);
    const asked = async (slug: string) => {
      const p = await step("DEMO001", slug, "preview");
      expect(p.body.canRequest, JSON.stringify(p.body.blockers)).toBe(true);
      expect(p.body.watermark.test).toBe(false);
      expect((await step("DEMO001", slug, "request", { fingerprint: p.body.fingerprint, note: "demo" })).status).toBe(201);
    };
    const decide = async (who: string, slug: string) => {
      const state = (await call(who, "get", `payroll/runs/${runId}/approvals`)).body.steps.find((s: { slug: string }) => s.slug === slug);
      expect((await step(who, slug, "decision", { decision: "APPROVE", hash: state.live.hash, note: "demo" })).status).toBe(200);
    };
    await asked("run");
    await decide("DEMO013", "run");
    await asked("finalise");
    await decide("DEMO013", "finalise");
    expect((await call("DEMO001", "post", `payroll/runs/${runId}/finalise`)).status).toBe(200);
    await asked("publish");
    await decide("DEMO013", "publish");
    const published = await call("DEMO001", "post", `payroll/runs/${runId}/payslips/publish`);
    expect([published.status, published.body.published]).toEqual([201, demo.paid]);
    await asked("bank-file");
    await decide("DEMO013", "bank-file");
    const made = await call("DEMO001", "post", `payroll/runs/${runId}/bank-file/generate`);
    expect([made.status, made.body.rows]).toEqual([201, demo.paid]);

    // The bank file is the fictional one and holds only made-up accounts.
    const batch = await prisma.bankTransferBatch.findUniqueOrThrow({ where: { runId } });
    const file = (await storageService.getObject(batch.fileKey)).body.toString("utf8");
    expect(file.split("\n")[0]).toBe(DEMO_WATERMARK); // the demo company's file says so on its first line
    expect(file.split("\n")[1]).toContain("DEMO BANK BULK TRANSFER (FICTIONAL FORMAT)");
    expect(batch.fileName).toMatch(/^DEMO-bank-file-/);
    expect(file).toContain(DEMO_DEBIT_ACCOUNT);
    // The accounts are the demo's (9999...) and the development seed's own made-up ones: all digits, none from anywhere else.
    for (const line of file.trimEnd().split("\n").slice(2)) expect(line.split(",")[2]).toMatch(/^\d{9,18}$/);

    // Every rule the run read is one the Ready screen requires; and every required rule is read, or is one that only a statutory file or a later phase uses.
    const pinned = new Set((run.pins as unknown as RulePin[]).filter((p) => (p.kind ?? "RULE") === "RULE").map((p) => p.key));
    const setup = await call("DEMO001", "get", "payroll/setup");
    const items = new Map<string, SetupItemShape>(setup.body.sections.flatMap((s: { items: Array<{ id: string }> }) => s.items).map((i: { id: string }) => [i.id, i]));
    const notRequired = RULE_CATALOG.filter((r) => !items.get(`rule:${r.key}`)?.required).map((r) => r.key);
    expect([...pinned].filter((k) => notRequired.includes(k)), "a rule the run read must be required for a first run").toEqual([]);
    const unread = RULE_CATALOG.filter((r) => items.get(`rule:${r.key}`)?.required && !pinned.has(r.key)).map((r) => r.key);
    // Required, but used somewhere other than the calculation of a run: each one's reason is written here, so a rule cannot become required without anybody knowing why.
    const READ_ELSEWHERE: Record<string, string> = {
      REVISION_CTC_ROUNDING: "rounds a CTC after a percentage salary revision",
      ARREARS_PAYOUT: "how arrears from a back-dated revision are paid",
      ARREARS_PF_ESI: "PF and ESI on arrears",
      VARIANCE_FLAG_PERCENT: "what the difference-from-last-month preview highlights",
      VARIANCE_FLAG_MIN_AMOUNT: "what the difference-from-last-month preview highlights",
      PAYSLIP_LAYOUT: "which blocks a payslip shows",
      PF_ESTABLISHMENT_CODE: "printed on the PF file",
      ESI_EMPLOYER_CODE: "printed on the ESI file",
      PT_REGISTRATION: "printed on the PT statement",
      LWF_REGISTRATION: "printed on the LWF statement",
    };
    expect(unread.sort()).toEqual(Object.keys(READ_ELSEWHERE).sort());
  });
});
