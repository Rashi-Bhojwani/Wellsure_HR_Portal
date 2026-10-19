import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setPayrollLockCheck } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { getSetting, setSetting } from "../../../lib/settings";
import { SettingsBasedEncashmentRateProvider, setEncashmentRateProvider } from "../../leave/encashmentRate";
import { confirmRule, previewConfirm } from "../rules/governed";
import { finalisedRunArrearsProvider, registerPayroll, SalaryBasedEncashmentRateProvider } from "../run/providers";
import { setArrearsBasisProvider } from "../salary/arrears";
import { Frac } from "./rational";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, day, handFinalise, lockCycle, setRules, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary } from "./salaryTestHelpers";

// What a run is joined to: the finalised state that only P6-4 will reach (proved here by the database), the arrears that are worked out from what a finalised
// run paid, the year-end encashment that reaches payroll exactly once, and the difference from last month.

const SEPT = { start: "2026-09-01", end: "2026-09-30" };
const NAMES = ["full", "lop", "joiner", "leaver", "other"] as const;

describe("runs, finalised runs, arrears, encashment and variance", () => {
  let world: RunWorld;
  let augId: string;
  let septId: string;
  const who = (n: (typeof NAMES)[number]) => world.named[n]!.employeeId;
  const finalise = (id: string) => handFinalise(id, world.maker.userId, world.checkerA.userId);
  const yearEndRunIds: string[] = [];
  let flatRateBefore: number | null;

  beforeAll(async () => {
    world = await buildRunWorld([...NAMES]);
    for (const n of NAMES) await giveSalary(world, who(n), "600000", FIRST_SALARY_DAY);
    await prisma.employee.update({ where: { id: who("joiner") }, data: { dateOfJoining: day("2026-08-11") } });
    await prisma.employee.update({ where: { id: who("leaver") }, data: { lastWorkingDate: day("2026-08-20") } });
    await lockCycle(who("full"), CYCLE.start, CYCLE.end);
    await lockCycle(who("lop"), CYCLE.start, CYCLE.end, { "2026-08-10": { lop: "1" }, "2026-08-11": { lop: "1" }, "2026-08-12": { lop: "1" } });
    await lockCycle(who("joiner"), "2026-08-11", CYCLE.end);
    await lockCycle(who("leaver"), CYCLE.start, "2026-08-20");
    flatRateBefore = await getSetting<number | null>("leave.encashment.defaultDailyRate", null);
    augId = await calculateRun(world);
  }, 300_000);

  afterAll(async () => {
    setPayrollLockCheck(null);
    setArrearsBasisProvider(null);
    setEncashmentRateProvider(new SettingsBasedEncashmentRateProvider());
    await setSetting("leave.encashment.defaultDailyRate", flatRateBefore, null);
    await deleteWithDependents("YearEndRun", yearEndRunIds);
    await teardownRunWorld(world);
  });

  describe("the finalised state, which only the finaliser can reach", () => {
    it("the database refuses to make a run final except inside the finaliser's own transaction, and refuses to change a final run", async () => {
      await expect(prisma.payrollRun.update({ where: { id: augId }, data: { status: "FINALISED" } })).rejects.toThrow(/RUN_FINALISE_FORBIDDEN/);
      await expect(prisma.payrollRun.create({ data: { cycleStart: day("2026-05-01"), cycleEnd: day("2026-05-31"), cycleLabel: "May 2026", status: "FINALISED", createdByUserId: world.maker.userId } })).rejects.toThrow(/RUN_FINALISE_FORBIDDEN/);
      // The switch alone is not enough: from a draft, or from an approved run whose two approvals have not both been used, it is still refused.
      const withSwitch = (status: "FINALISED") =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('payroll.finalising', 'yes', true)`;
          await tx.payrollRun.update({ where: { id: augId }, data: { status, finalisedAt: new Date(), finalisedByUserId: world.maker.userId } }); // allow-clock: a test instant
        });
      await expect(withSwitch("FINALISED")).rejects.toThrow(/RUN_FINALISE_FORBIDDEN/);
      await prisma.payrollRun.update({ where: { id: augId }, data: { status: "APPROVED" } });
      await expect(withSwitch("FINALISED")).rejects.toThrow(/second person's approval/);
      await prisma.payrollRun.update({ where: { id: augId }, data: { status: "CALCULATED" } });
      await finalise(augId);
      expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: augId } })).status).toBe("FINALISED");
      const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: augId, employeeId: who("full") }, include: { lines: true } });
      await expect(prisma.payrollRun.update({ where: { id: augId }, data: { totalNet: "1" } })).rejects.toThrow(/RUN_FINALISED_IMMUTABLE/);
      await expect(prisma.payrollRunItem.update({ where: { id: item.id }, data: { netPay: "1", netBeforeRounding: "1" } })).rejects.toThrow(/RUN_FINALISED_IMMUTABLE/);
      await expect(prisma.payrollRunItem.delete({ where: { id: item.id } })).rejects.toThrow(/RUN_FINALISED_IMMUTABLE/);
      await expect(prisma.payrollRunLine.update({ where: { id: item.lines[0]!.id }, data: { amount: "1" } })).rejects.toThrow(/RUN_FINALISED_IMMUTABLE/);
      await expect(prisma.payrollRunLine.create({ data: { runId: augId, runItemId: item.id, employeeId: who("full"), sortOrder: 99, code: "X", label: "X", kind: "EARNING", source: "COMPONENT", amount: "1" } })).rejects.toThrow(/RUN_FINALISED_IMMUTABLE/);
      await expect(prisma.payrollRun.update({ where: { id: augId }, data: { status: "VOID", voidedAt: new Date(), voidReason: "no" } })).rejects.toThrow(/RUN_FINALISED_IMMUTABLE/); // allow-clock: a test instant
      const voided = await api(world.tokens.maker, "post", `/runs/${augId}/void`, { reason: "trying to undo a final run" });
      expect(voided.status).toBe(409);
      const again = await api(world.tokens.maker, "post", `/runs/${augId}/calculate-preview`);
      expect(again.status).toBe(409);
    });

    it("a run's own figures cannot be made inconsistent: a negative line, a net that does not add up, a held person with no reason, two live runs for a cycle", async () => {
      const sept = await prisma.payrollRun.create({ data: { cycleStart: day(SEPT.start), cycleEnd: day(SEPT.end), cycleLabel: "Sep 2026", createdByUserId: world.maker.userId } });
      septId = sept.id;
      await expect(prisma.payrollRun.create({ data: { cycleStart: day(SEPT.start), cycleEnd: day(SEPT.end), cycleLabel: "Sep 2026", createdByUserId: world.maker.userId } })).rejects.toThrow();
      const base = { runId: septId, employeeId: who("full"), calcVersion: 1, employmentType: "PERMANENT" as const, itemHash: "h" };
      await expect(prisma.payrollRunItem.create({ data: { ...base, status: "PAYABLE", gross: "10", netBeforeRounding: "10", roundingAdjustment: "0", netPay: "11" } })).rejects.toThrow(/net_adds_up/);
      await expect(prisma.payrollRunItem.create({ data: { ...base, status: "HELD", gross: "10", netBeforeRounding: "10", netPay: "10" } })).rejects.toThrow(/hold_reason/);
      await expect(prisma.payrollRunItem.create({ data: { ...base, status: "PAYABLE", gross: "-1", netBeforeRounding: "-1", netPay: "-1" } })).rejects.toThrow(/not_negative/);
      const ok = await prisma.payrollRunItem.create({ data: { ...base, status: "PAYABLE", gross: "10", netBeforeRounding: "10", netPay: "10" } });
      await expect(prisma.payrollRunLine.create({ data: { runId: septId, runItemId: ok.id, employeeId: who("full"), sortOrder: 0, code: "X", label: "X", kind: "EARNING", source: "COMPONENT", amount: "-5" } })).rejects.toThrow(/amount_sign/);
      await prisma.payrollRunItem.delete({ where: { id: ok.id } });
      await prisma.payrollRun.update({ where: { id: septId }, data: { status: "VOID", voidedAt: new Date(), voidReason: "just a fixture" } }); // allow-clock: a test instant
    });

    it("a finalised run answers what each person was paid, as the exact fraction it used; an excluded person and a draft answer nothing", async () => {
      const aug = { start: day(CYCLE.start), end: day(CYCLE.end) };
      const share = async (n: (typeof NAMES)[number], from: string, to: string) => {
        const s = await finalisedRunArrearsProvider.paidShare(who(n), aug, day(from), day(to));
        return s ? Frac.of(s.paid.toFixed()).div(Frac.of(s.basis.toFixed())) : null;
      };
      const is = async (n: (typeof NAMES)[number], from: string, to: string, num: bigint, den: bigint) => expect((await share(n, from, to))!.cmp(new Frac(num, den))).toBe(0);
      await is("full", "2026-08-16", "2026-08-31", 16n, 31n); // the second half of the month, a full month's pay
      await is("full", "2026-08-01", "2026-08-31", 1n, 1n);
      await is("lop", "2026-08-01", "2026-08-15", 12n, 31n); // 15 days less the 3 of loss of pay that fell inside them
      await is("lop", "2026-08-16", "2026-08-31", 16n, 31n);
      await is("joiner", "2026-08-01", "2026-08-31", 21n, 31n); // here from the 11th
      await is("leaver", "2026-08-16", "2026-08-31", 5n, 31n); // here until the 20th
      expect(await share("other", "2026-08-01", "2026-08-31")).toBeNull(); // calculated as excluded: no record of a payment
      // A draft of the same cycle is no record at all: arrears come from a closed month or not at all.
      const draft = await prisma.payrollRun.create({ data: { cycleStart: day("2026-07-01"), cycleEnd: day("2026-07-31"), cycleLabel: "Jul 2026", createdByUserId: world.maker.userId } });
      await prisma.payrollRunItem.create({ data: { runId: draft.id, employeeId: who("full"), calcVersion: 1, status: "PAYABLE", employmentType: "PERMANENT", itemHash: "h", employedFrom: day("2026-07-01"), employedTo: day("2026-07-31"), inputs: { days: { basisDays: "31", notEmployedDays: 0, lopDivisorDays: "31", employedDays: 31, lopByDay: [] } } } });
      expect(await finalisedRunArrearsProvider.paidShare(who("full"), { start: day("2026-07-01"), end: day("2026-07-31") }, day("2026-07-01"), day("2026-07-31"))).toBeNull();
      await prisma.payrollRun.update({ where: { id: draft.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: "fixture" } }); // allow-clock: a test instant
    });
  });

  describe("arrears from a finalised run", () => {
    it("a back-dated revision into a closed month is paid as arrears worked out from what the run paid", async () => {
      setPayrollLockCheck(async (d) => (d >= day(CYCLE.start) && d <= day(CYCLE.end) ? { locked: true, period: "Aug 2026" } : { locked: false }));
      registerPayroll();
      await giveSalary(world, who("full"), "720000", "2026-08-16");
      const arrears = await prisma.payrollAdjustment.findMany({ where: { employeeId: who("full"), source: "SALARY_ARREARS" } });
      expect(arrears).toHaveLength(1);
      // Basic +4000, HRA +2000, Special +4000 a month, for 16 of 31 days: 2064.52 -> 2065, 1032.26 -> 1032, 2064.52 -> 2065.
      expect([arrears[0]!.direction, arrears[0]!.amount.toString(), arrears[0]!.status]).toEqual(["EARNING", "5162", "PENDING"]);
      expect((arrears[0]!.breakdown as Array<{ component: string; amount: string }>).map((b) => [b.component.replace(`${world.prefix}_`, ""), b.amount])).toEqual([["BASIC", "2065"], ["HRA", "1032"], ["SPECIAL", "2065"]]);
    });

    it("says plainly that it is waiting on payroll runs, and that nothing is wrong with the revision, when no run has paid the person", async () => {
      const input = { selection: { kind: "EMPLOYEES", employeeIds: [who("other")] }, change: { ctc: { mode: "SET", annual: "720000" }, structure: { key: world.structure, version: 1 } }, effectiveFrom: "2026-08-16", note: "test" };
      const preview = await api(world.tokens.maker, "post", "/salary/revisions/preview", { input });
      expect(preview.status).toBe(200);
      expect(preview.body.canSubmit).toBe(false);
      const text = preview.body.blockers.join(" ");
      expect(text).toMatch(/Aug 2026 is closed, but there is no finalised payroll run on record showing what this person was paid in it/);
      expect(text).toMatch(/The revision itself is fine: it is waiting only on payroll runs being finalised for that month/);
      expect(text).not.toMatch(/fault|broken|invalid/i);
    });

    it("is paid in the next run as a line of its own, with PF following the component flags the rule names", async () => {
      for (const n of ["full", "lop", "joiner"] as const) await lockCycle(who(n), SEPT.start, SEPT.end);
      const created = await api(world.tokens.maker, "post", "/runs", { cycleStart: SEPT.start });
      septId = created.body.id as string;
      const missing = await api(world.tokens.maker, "post", `/runs/${septId}/calculate-preview`);
      expect([missing.status, missing.body.error.code]).toEqual([409, "RULES_MISSING"]);
      expect(missing.body.error.details.missing.map((m: { key: string }) => m.key)).toEqual(["ARREARS_PF_ESI"]);
      await setRules(world.maker.userId, { ARREARS_PF_ESI: "FOLLOW_COMPONENT_FLAGS" });
      await calculateAgain(world, septId);
      const item = (await api(world.tokens.maker, "get", `/runs/${septId}/items/${who("full")}`)).body;
      const line = item.lines.find((l: { code: string }) => l.code === "ARREARS");
      const adjustment = await prisma.payrollAdjustment.findFirstOrThrow({ where: { employeeId: who("full"), source: "SALARY_ARREARS" } });
      expect([line.kind, line.source, line.amount, line.sourceRef]).toEqual(["EARNING", "ARREARS", "5162", adjustment.id]);
      // The new salary (720,000 from 16 Aug) applies in September: 60,000 + 5,162 arrears; PF is capped; nothing else is deducted.
      expect([item.totals.gross, item.totals.deductions, item.totals.net]).toEqual(["65162", "1800", "63362"]);
      expect(item.lines.find((l: { code: string }) => l.code === "PF_EMPLOYEE").basis.wages).toBe("26065"); // 24,000 Basic + 2,065 of the arrears that belong to Basic
      expect((await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } })).status).toBe("PENDING"); // a draft only reads it
    });
  });

  describe("year-end leave encashment", () => {
    const committed = async (committedAt: string, amount = "10000", days = "10", rate = "1000") => {
      const run = await prisma.yearEndRun.create({
        data: {
          leaveYear: 3000 + Math.floor(Math.random() * 5000), // a year no real run uses: only one committed run is allowed per year
          status: "COMMITTED",
          previewedByUserId: world.maker.userId,
          committedByUserId: world.maker.userId,
          committedAt: new Date(committedAt),
          totalEmployees: 1,
          totalEncashedDays: days,
          totalEncashedAmount: amount,
          items: { create: { employeeId: who("full"), closingPlBalance: days, encashedDays: days, dailyRate: rate, rateSource: "MANUAL_SETTING", encashedAmount: amount, ledgerEncashmentEntryId: `test-ledger-${randomBytes(4).toString("hex")}` } },
        },
        include: { items: true },
      });
      yearEndRunIds.push(run.id);
      return run.items[0]!;
    };

    it("asks for the two encashment rules when there is something to pay, and for nothing when there is not", async () => {
      const item = await committed("2026-07-15T05:00:00Z");
      const preview = await api(world.tokens.maker, "post", `/runs/${septId}/calculate-preview`);
      expect(preview.body.error.details.missing.map((m: { key: string }) => m.key).sort()).toEqual(["ENCASH_PAYOUT_RULE", "ENCASH_PF_APPLICABLE"]);
      await setRules(world.maker.userId, { ENCASH_PAYOUT_RULE: "FIRST_RUN_AFTER_COMMIT", ENCASH_PF_APPLICABLE: true });
      await calculateAgain(world, septId);
      const lines = await prisma.payrollRunLine.findMany({ where: { runId: septId, source: "ENCASHMENT" } });
      expect(lines.map((l) => [l.employeeId, l.code, l.amount.toString(), l.sourceRef])).toEqual([[who("full"), "LEAVE_ENCASHMENT", "10000", item.id]]);
      expect((lines[0]!.basis as { pfApplicable: boolean }).pfApplicable).toBe(true);
    });

    it("reaches payroll exactly once: recalculating adds no second line, and a paid one is not paid again", async () => {
      const item = (await prisma.yearEndRunItem.findFirstOrThrow({ where: { employeeId: who("full"), yearEndRunId: { in: yearEndRunIds } } }));
      await calculateAgain(world, septId);
      expect(await prisma.payrollRunLine.count({ where: { runId: septId, source: "ENCASHMENT" } })).toBe(1);
      const rows = await prisma.payrollAdjustment.findMany({ where: { source: "YEAR_END_ENCASHMENT", sourceRef: item.id } });
      expect(rows.map((r) => [r.status, r.amount.toString(), r.componentCode])).toEqual([["PENDING", "10000", "LEAVE_ENCASHMENT"]]);
      await expect(prisma.payrollAdjustment.create({ data: { employeeId: who("full"), componentCode: "LEAVE_ENCASHMENT", direction: "EARNING", amount: "10000", reason: "again", source: "YEAR_END_ENCASHMENT", sourceRef: item.id, createdByUserId: world.maker.userId } })).rejects.toThrow(); // the unique source reference
      // Once a run has paid it (consumed), no run includes it again.
      await expect(prisma.payrollAdjustment.update({ where: { id: rows[0]!.id }, data: { status: "CONSUMED", consumedByRunId: augId } })).rejects.toThrow(/ADJUSTMENT_CONSUMED_BY_FINALISER_ONLY/);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('payroll.finalising', 'yes', true)`;
        await tx.payrollAdjustment.update({ where: { id: rows[0]!.id }, data: { status: "CONSUMED", consumedByRunId: augId } });
      });
      await calculateAgain(world, septId);
      expect(await prisma.payrollRunLine.count({ where: { runId: septId, source: "ENCASHMENT" } })).toBe(0);
    });

    it("pays in the month the rule says: the cycle of the commit, or the first run after it", async () => {
      const early = await committed("2026-09-10T05:00:00Z", "3000", "3", "1000");
      await calculateAgain(world, septId); // the rule is still "first run after the commit"
      expect(await prisma.payrollRunLine.count({ where: { runId: septId, source: "ENCASHMENT" } })).toBe(0); // committed in September: the first run after it is October's
      await setRules(world.maker.userId, { ENCASH_PAYOUT_RULE: "SAME_MONTH_AS_COMMIT" });
      await calculateAgain(world, septId);
      const line = await prisma.payrollRunLine.findFirstOrThrow({ where: { runId: septId, source: "ENCASHMENT" } });
      expect([line.amount.toString(), line.sourceRef]).toEqual(["3000", early.id]);
      const late = await committed("2026-10-05T05:00:00Z", "4000", "4", "1000");
      await calculateAgain(world, septId);
      expect(await prisma.payrollRunLine.count({ where: { runId: septId, source: "ENCASHMENT", sourceRef: late.id } })).toBe(0); // not due until October's run
      const readiness = (await api(world.tokens.maker, "get", `/runs/readiness?cycleStart=${SEPT.start}`)).body;
      expect(readiness.adjustments.encashmentsPaidLater).toBe(1);
    });

    it("the daily rate comes from the salary by the rule's formula, is final only when that rule is Confirmed, and defers to the flat rate until the rule is set", async () => {
      const provider = new SalaryBasedEncashmentRateProvider();
      await setSetting("leave.encashment.defaultDailyRate", 777, world.maker.userId);
      const flat = await provider.getDailyRate(who("full"), day("2026-12-31"));
      expect([flat.amount.toString(), flat.source, flat.isFinal]).toEqual(["777", "MANUAL_SETTING", false]);
      await setRules(world.maker.userId, { ENCASH_DAILY_RATE_FORMULA: `${world.basic} / 30` });
      const rate = await provider.getDailyRate(who("full"), day("2026-12-31"));
      expect([rate.amount.toString(), rate.source, rate.isFinal]).toEqual(["800", "SALARY_STRUCTURE", false]); // 24,000 / 30 on the 720,000 salary
      const pre = await previewConfirm("ENCASH_DAILY_RATE_FORMULA", world.checkerA.userId);
      await confirmRule("ENCASH_DAILY_RATE_FORMULA", { version: pre.version, note: "checked against the CA letter", fingerprint: pre.fingerprint }, { userId: world.checkerA.userId });
      expect((await provider.getDailyRate(who("full"), day("2026-12-31"))).isFinal).toBe(true);
      await expect(provider.getDailyRate(who("other"), day("2026-07-01"))).resolves.toMatchObject({ source: "SALARY_STRUCTURE" }); // 20,000 / 30 on a 600,000 salary
      await expect(provider.getDailyRate(world.checkerA.employeeId, day("2026-12-31"))).rejects.toMatchObject({ code: "ENCASHMENT_NO_SALARY" }); // somebody with no salary: named, never guessed
    });
  });

  describe("the difference from last month", () => {
    it("compares with the most final run there is, says which, gives the reasons it can know, and flags what the thresholds say", async () => {
      // The September run is a draft here; August was finalised above.
      const unset = (await api(world.tokens.maker, "get", `/runs/${septId}/variance`)).body;
      expect(unset.baseline).toMatchObject({ final: true, cycleLabel: "Aug 2026", status: "FINALISED" });
      expect(unset.thresholds.set).toBe(false);
      expect(unset.flaggedCount).toBe(0);
      await setRules(world.maker.userId, { VARIANCE_FLAG_PERCENT: "10", VARIANCE_FLAG_MIN_AMOUNT: "500" });
      const v = (await api(world.tokens.maker, "get", `/runs/${septId}/variance?pageSize=200`)).body;
      const row = (n: (typeof NAMES)[number]) => v.items.find((r: { employeeId: string }) => r.employeeId === who(n));
      expect(v.thresholds).toMatchObject({ set: true, percent: "10", minAmount: "500" });
      // full: paid 48,200 in August, 63,362 in September (new salary, arrears); the extra 3,000 of encashment is in the rows above only if still due.
      expect(row("full").previous.net).toBe("48200");
      expect(row("full").tags).toEqual(expect.arrayContaining(["SALARY_REVISED", "ARREARS"]));
      expect(row("full").flagged).toBe(true);
      // lop: 43,516 -> 48,200 because three days of loss of pay did not repeat.
      expect([row("lop").previous.net, row("lop").current.net, row("lop").change.net, row("lop").percent, row("lop").tags, row("lop").flagged]).toEqual(["43516", "48200", "4684", "10.76", ["LOP_CHANGED"], true]);
      // joiner: part of August, all of September.
      expect([row("joiner").previous.net, row("joiner").current.net, row("joiner").flagged]).toEqual(["32761", "48200", true]);
      // leaver: paid in August, not in September at all.
      expect([row("leaver").status, row("leaver").tags, row("leaver").current]).toEqual(["ABSENT", ["NOT_IN_THIS_RUN"], null]);
      // other: not calculated either month, so there is nothing to compare: not listed here (the run's own list says why they are left out).
      expect(row("other")).toBeUndefined();
      // somebody who was paid last month and cannot be calculated this month is listed, with the reason.
      expect(v.items.filter((r: { tags: string[] }) => r.tags.includes("NOT_CALCULATED")).every((r: { previous: unknown }) => r.previous !== null)).toBe(true);
      expect(v.totals.previous.net).not.toBe(v.totals.current.net);
      const only = (await api(world.tokens.maker, "get", `/runs/${septId}/variance?flaggedOnly=true&pageSize=200`)).body;
      expect(only.items.every((r: { flagged: boolean }) => r.flagged)).toBe(true);
    });

    it("says when the previous month is only a draft, so nobody mistakes it for a closed month", async () => {
      const q = await prisma.payrollRun.create({ data: { cycleStart: day("2026-10-01"), cycleEnd: day("2026-10-31"), cycleLabel: "Oct 2026", createdByUserId: world.maker.userId } });
      const v = (await api(world.tokens.maker, "get", `/runs/${q.id}/variance`)).body;
      expect(v.baseline).toMatchObject({ final: false, cycleLabel: "Sep 2026", status: "CALCULATED" });
      await prisma.payrollRun.update({ where: { id: q.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: "fixture only" } }); // allow-clock: a test instant
      const none = await prisma.payrollRun.create({ data: { cycleStart: day("2026-02-01"), cycleEnd: day("2026-02-28"), cycleLabel: "Feb 2026", createdByUserId: world.maker.userId } });
      expect((await api(world.tokens.maker, "get", `/runs/${none.id}/variance`)).body.baseline).toBeNull();
      await prisma.payrollRun.update({ where: { id: none.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: "fixture only" } }); // allow-clock: a test instant
    });
  });
});
