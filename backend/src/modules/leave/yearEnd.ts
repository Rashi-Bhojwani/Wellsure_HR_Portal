import { buildXlsx } from "../../lib/xlsx";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { withEmployeeLeaveLock } from "./concurrency";
import { getEncashmentRateProvider } from "./encashmentRate";
import { writeLedgerEntry } from "./ledger";
import type { ActorMeta } from "./types";
import { inForceOn } from "../../lib/effectiveDating";

// Year End Process (spec §5.4/§5.5) — preview -> (optionally superseded/
// discarded, re-previewable) -> commit. Mirrors Import Center's batch/
// staging-row parent-child + status-lifecycle pattern. PREVIEW never
// writes to leave_ledger, only to YearEndRunItem; leave_ledger is written
// exactly once, at commit, after re-verifying nothing has drifted since
// preview — see schema.prisma's comment on YearEndRun for the full
// reasoning.

// Encashment is money. Who may see it is whoever may see the leave liability report (a director, since the HR hard lock); HR runs the year-end process on days alone.
const MONEY_KEYS = new Set(["totalEncashedAmount", "dailyRate", "rateSource", "encashedAmount"]);
export function withoutEncashmentMoney<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutEncashmentMoney) as unknown as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, MONEY_KEYS.has(k) ? null : withoutEncashmentMoney(v)])) as T;
  return value;
}

function cutoffDate(leaveYear: number): Date {
  return new Date(Date.UTC(leaveYear, 11, 31));
}

function itemJson(item: {
  id: string;
  employeeId: string;
  closingPlBalance: Prisma.Decimal;
  encashedDays: Prisma.Decimal;
  dailyRate: Prisma.Decimal;
  rateSource: string;
  encashedAmount: Prisma.Decimal;
  ledgerEncashmentEntryId: string | null;
}) {
  return {
    id: item.id,
    employeeId: item.employeeId,
    closingPlBalance: item.closingPlBalance.toNumber(),
    encashedDays: item.encashedDays.toNumber(),
    dailyRate: item.dailyRate.toNumber(),
    rateSource: item.rateSource,
    encashedAmount: item.encashedAmount.toNumber(),
    ledgerEncashmentEntryId: item.ledgerEncashmentEntryId,
  };
}

function runJson(run: {
  id: string;
  leaveYear: number;
  status: string;
  previewedByUserId: string;
  previewedAt: Date;
  supersededAt: Date | null;
  committedByUserId: string | null;
  committedAt: Date | null;
  totalEmployees: number;
  totalEncashedDays: Prisma.Decimal;
  totalEncashedAmount: Prisma.Decimal;
}) {
  return {
    id: run.id,
    leaveYear: run.leaveYear,
    status: run.status,
    previewedByUserId: run.previewedByUserId,
    previewedAt: run.previewedAt.toISOString(),
    supersededAt: run.supersededAt?.toISOString() ?? null,
    committedByUserId: run.committedByUserId,
    committedAt: run.committedAt?.toISOString() ?? null,
    totalEmployees: run.totalEmployees,
    totalEncashedDays: run.totalEncashedDays.toNumber(),
    totalEncashedAmount: run.totalEncashedAmount.toNumber(),
  };
}

async function closingPlBalance(employeeId: string, plTypeId: string, cutoff: Date): Promise<Prisma.Decimal> {
  const result = await prisma.leaveLedger.aggregate({
    _sum: { days: true },
    where: { employeeId, leaveTypeId: plTypeId, entryDate: { lte: cutoff } },
  });
  return result._sum.days ?? new Prisma.Decimal(0);
}

export async function listYearEndRuns(year?: number) {
  const runs = await prisma.yearEndRun.findMany({
    where: year ? { leaveYear: year } : {},
    orderBy: [{ leaveYear: "desc" }, { previewedAt: "desc" }],
  });
  return runs.map(runJson);
}

export async function getYearEndRun(runId: string) {
  const run = await prisma.yearEndRun.findUnique({ where: { id: runId }, include: { items: { include: { employee: { include: { nameHistory: { where: inForceOn() } } } } } } });
  if (!run) throw new HttpError(404, "Year End run not found.", "NOT_FOUND");
  return {
    ...runJson(run),
    items: run.items.map((item) => ({
      ...itemJson(item),
      employeeCode: item.employee.employeeCode,
      employeeName: item.employee.nameHistory[0]?.fullName ?? item.employee.employeeCode,
    })),
  };
}

// Supersedes any existing PREVIEW for this year (kept for the audit
// trail, not deleted), then computes every active employee's closing PL
// balance as of Y-12-31 (an explicit entryDate cutoff — never the
// leave_year tag, see leave_ledger's schema comment — so a Jan-1
// accrual for Y+1 posted while this run is still PREVIEW falls outside
// the window automatically). Resolves the encashment rate per employee
// BEFORE writing anything: if the rate isn't configured, the whole
// preview fails with no rows written at all, never a table full of ₹0
// amounts.
export async function previewYearEnd(leaveYear: number, meta: ActorMeta) {
  const cutoff = cutoffDate(leaveYear);
  const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
  const employees = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const rateProvider = getEncashmentRateProvider();

  const computed: { employeeId: string; closingPlBalance: Prisma.Decimal; dailyRate: Prisma.Decimal; rateSource: string; encashedAmount: Prisma.Decimal }[] = [];
  for (const employee of employees) {
    const balance = await closingPlBalance(employee.id, plType.id, cutoff);
    if (balance.lessThanOrEqualTo(0)) continue;
    const rate = await rateProvider.getDailyRate(employee.id, cutoff); // throws EncashmentRateNotConfiguredError if unset — aborts before any row is written
    computed.push({ employeeId: employee.id, closingPlBalance: balance, dailyRate: rate.amount, rateSource: rate.source, encashedAmount: balance.times(rate.amount) });
  }

  const totalEncashedDays = computed.reduce((sum, c) => sum.plus(c.closingPlBalance), new Prisma.Decimal(0));
  const totalEncashedAmount = computed.reduce((sum, c) => sum.plus(c.encashedAmount), new Prisma.Decimal(0));

  const run = await prisma.$transaction(async (tx) => {
    await tx.yearEndRun.updateMany({ where: { leaveYear, status: "PREVIEW" }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
    const created = await tx.yearEndRun.create({
      data: {
        leaveYear,
        status: "PREVIEW",
        previewedByUserId: meta.actorUserId,
        totalEmployees: computed.length,
        totalEncashedDays,
        totalEncashedAmount,
        items: {
          create: computed.map((c) => ({
            employeeId: c.employeeId,
            closingPlBalance: c.closingPlBalance,
            encashedDays: c.closingPlBalance,
            dailyRate: c.dailyRate,
            rateSource: c.rateSource,
            encashedAmount: c.encashedAmount,
          })),
        },
      },
    });
    return created;
  });

  await writeAuditLog({ ...meta, action: "leave.yearend.preview", entityType: "YearEndRun", entityId: run.id, after: { leaveYear, totalEmployees: computed.length, totalEncashedAmount: totalEncashedAmount.toNumber() } });
  return getYearEndRun(run.id);
}

export async function discardYearEndRun(runId: string, meta: ActorMeta) {
  const run = await prisma.yearEndRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "Year End run not found.", "NOT_FOUND");
  if (run.status !== "PREVIEW") {
    throw new HttpError(409, `This run is ${run.status.toLowerCase()}, not a preview — nothing to discard.`, "NOT_A_PREVIEW");
  }
  await prisma.yearEndRun.update({ where: { id: runId }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
  await writeAuditLog({ ...meta, action: "leave.yearend.discard", entityType: "YearEndRun", entityId: runId });
}

// Commit — the one place leave_ledger is written for a year-end run.
// Re-verifies every item's closing balance fresh before writing anything:
// an entry could have landed between preview and commit (e.g. a Dec 28
// leave approved on Dec 29, both still inside the cutoff window), which
// must never be committed against the stale preview number HR already
// reviewed. Any drift rejects the WHOLE commit — never a partial one —
// with a clear "re-run preview" error.
export async function commitYearEndRun(runId: string, meta: ActorMeta, options: { confirmText?: string }) {
  const run = await prisma.yearEndRun.findUnique({ where: { id: runId }, include: { items: true } });
  if (!run) throw new HttpError(404, "Year End run not found.", "NOT_FOUND");
  if (run.status !== "PREVIEW") {
    throw new HttpError(409, `This run is ${run.status.toLowerCase()}, not a preview.`, "NOT_A_PREVIEW");
  }
  if (options.confirmText !== "COMMIT YEAR END") {
    throw new HttpError(400, 'Type "COMMIT YEAR END" to confirm — this writes encashment entries and resets balances for every employee in this run.', "CONFIRMATION_REQUIRED");
  }

  const cutoff = cutoffDate(run.leaveYear);
  const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });

  for (const item of run.items) {
    const fresh = await closingPlBalance(item.employeeId, plType.id, cutoff);
    if (!fresh.equals(item.closingPlBalance)) {
      throw new HttpError(409, `Balances have changed since this preview was generated (employee ${item.employeeId}: was ${item.closingPlBalance.toFixed(2)}, now ${fresh.toFixed(2)}) — discard this run and re-run preview.`, "BALANCE_DRIFTED");
    }
  }

  for (const item of run.items) {
    await withEmployeeLeaveLock(item.employeeId, async (tx) => {
      const entry = await writeLedgerEntry(tx, {
        employeeId: item.employeeId,
        leaveTypeId: plType.id,
        leaveYear: run.leaveYear,
        entryDate: cutoff,
        entryType: "ENCASHMENT",
        days: item.closingPlBalance.negated(),
        referenceType: "YEAR_END_RUN",
        referenceId: run.id,
        createdByUserId: meta.actorUserId,
        // Days only, never the rate: the ledger is readable by anyone with
        // leave.view in scope (managers included), and the daily rate is
        // salary-derived. The rate and amount live on the YearEndRunItem,
        // behind leave.yearend.manage (2026-10-03).
        remarks: `Year-end ${run.leaveYear} encashment: ${item.encashedDays.toFixed(2)} day(s)`,
      });
      await tx.yearEndRunItem.update({ where: { id: item.id }, data: { ledgerEncashmentEntryId: entry.id } });
    });
  }

  const committed = await prisma.yearEndRun.update({ where: { id: runId }, data: { status: "COMMITTED", committedByUserId: meta.actorUserId, committedAt: new Date() } });
  await writeAuditLog({ ...meta, action: "leave.yearend.commit", entityType: "YearEndRun", entityId: runId, after: { leaveYear: run.leaveYear, totalEmployees: run.totalEmployees, totalEncashedAmount: run.totalEncashedAmount.toNumber() } });
  return runJson(committed);
}

// Generated on demand from YearEndRunItem rows rather than persisted to
// StorageService at commit time: those rows are immutable once written
// (PREVIEW items never change after their run leaves PREVIEW, COMMITTED
// items never change at all), so regenerating is exactly as correct as a
// stored copy, with no extra integration surface.
export async function buildYearEndReport(runId: string, withMoney: boolean): Promise<{ buffer: Buffer; fileName: string }> {
  const run = await prisma.yearEndRun.findUnique({ where: { id: runId }, include: { items: { include: { employee: { include: { nameHistory: { where: inForceOn() } } } } } } });
  if (!run) throw new HttpError(404, "Year End run not found.", "NOT_FOUND");

  const buffer = await buildXlsx([
    {
      name: `Year End ${run.leaveYear}`,
      columns: [
        { header: "Employee Code", key: "code", width: 16 },
        { header: "Employee Name", key: "name", width: 28 },
        { header: "Closing PL Balance", key: "balance", type: "number", width: 18 },
        { header: "Encashed Days", key: "days", type: "number", width: 16 },
        ...(withMoney
          ? ([
              { header: "Daily Rate", key: "rate", type: "money", width: 14 },
              { header: "Rate Source", key: "rateSource", width: 16 },
              { header: "Encashed Amount", key: "amount", type: "money", width: 18 },
            ] as const)
          : []),
      ],
      rows: run.items.map((item) => ({
        code: item.employee.employeeCode,
        name: item.employee.nameHistory[0]?.fullName ?? item.employee.employeeCode,
        balance: item.closingPlBalance.toNumber(),
        days: item.encashedDays.toNumber(),
        ...(withMoney ? { rate: item.dailyRate.toNumber(), rateSource: item.rateSource, amount: item.encashedAmount.toNumber() } : {}),
      })),
      totals: { name: "Total", days: run.totalEncashedDays.toNumber(), ...(withMoney ? { amount: run.totalEncashedAmount.toNumber() } : {}) },
      footer: !withMoney ? undefined : run.items.some((i) => i.rateSource === "MANUAL_SETTING") ? ["Daily rate: provisional flat HR-entered amount, pending the owners' confirmation of the encashment formula and its tax treatment (spec §5.2)."] : [],
    },
  ]);

  return { buffer, fileName: `year-end-${run.leaveYear}-${run.status.toLowerCase()}.xlsx` };
}
