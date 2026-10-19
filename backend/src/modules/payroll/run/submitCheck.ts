import { HOLD_REASON_LABEL, type HoldReason } from "@shared/constants/payrollRun";
import type { PayrollRun } from "@prisma/client";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { assertRunIsReal, type RulePin } from "../rules/context";
import { computeRun, type Computed } from "./engine";

// What stands between a calculated run and a second person's approval (docs/plans/PHASE_6.md §14F). Everything here is a refusal the server makes for itself on
// submit; the preview shows the same list so nobody finds out by trying. The first one the user asked for by name: a run that leaves somebody out is not approvable.

export interface Blocker {
  code: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PersonNote {
  employeeId: string;
  employeeCode: string;
  name: string;
  /** A short code: the hold reason for a person left out, the exception code for a problem. */
  code: string;
  reason: string;
  detail: string | null;
}

export interface Assessment {
  computed: Computed;
  /** The figures worked out now are not the figures stored on the run. */
  stale: boolean;
  leftOut: PersonNote[];
  blockingExceptions: PersonNote[];
  held: PersonNote[];
  payable: number;
  blockers: Blocker[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export async function assessForSubmission(run: PayrollRun): Promise<Assessment> {
  const computed = await computeRun({ start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel });
  const stale = computed.runHash !== run.runHash;
  const items = await prisma.payrollRunItem.findMany({ where: { runId: run.id }, include: { employee: { select: { employeeCode: true } } }, orderBy: { employee: { employeeCode: "asc" } } });
  const names = await namesOn(items.map((i) => i.employeeId), run.cycleEnd);
  const note = (i: (typeof items)[number], code: string, reason: string, detail: string | null): PersonNote => ({ employeeId: i.employeeId, employeeCode: i.employee.employeeCode, name: names.get(i.employeeId) ?? i.employee.employeeCode, code, reason, detail });

  const leftOut = items.filter((i) => i.status === "EXCLUDED").map((i) => note(i, i.holdReason ?? "LEFT_OUT", HOLD_REASON_LABEL[i.holdReason as HoldReason] ?? "Left out of the run", i.holdDetail));
  const held = items.filter((i) => i.status === "HELD").map((i) => note(i, i.holdReason ?? "HELD", HOLD_REASON_LABEL[i.holdReason as HoldReason] ?? "Held", i.holdDetail));
  const blockingExceptions: PersonNote[] = [];
  for (const i of items) {
    if (i.status === "EXCLUDED") continue;
    for (const x of i.exceptions as Array<{ code: string; severity: string; message: string }>) if (x.severity === "BLOCKING") blockingExceptions.push(note(i, x.code, x.message, null));
  }
  const payable = items.filter((i) => i.status === "PAYABLE").length;

  const blockers: Blocker[] = [];
  if (stale) {
    blockers.push({ code: "RUN_STALE", title: "The figures have moved", message: "Something changed after this run was calculated (an attendance day, a salary, an adjustment, a rule or somebody's details). Calculate it again, look at the result, then submit." });
  }
  if (leftOut.length > 0) {
    blockers.push({
      code: "PEOPLE_LEFT_OUT",
      title: `${leftOut.length} ${plural(leftOut.length, "person is", "people are")} left out of this run`,
      message: `${leftOut.length} ${plural(leftOut.length, "person is", "people are")} left out of this run, so it would not pay ${plural(leftOut.length, "them", "them")}. A run that leaves anybody out cannot be submitted for approval. Put right the reason against each name (a salary, finalised attendance, correct dates), calculate again, then submit.`,
      details: { people: leftOut.map((p) => ({ employeeId: p.employeeId, name: p.name, reason: p.reason })) },
    });
  }
  if (blockingExceptions.length > 0) {
    blockers.push({
      code: "BLOCKING_EXCEPTIONS",
      title: `${blockingExceptions.length} ${plural(blockingExceptions.length, "problem", "problems")} to put right first`,
      message: `${blockingExceptions.length} ${plural(blockingExceptions.length, "problem has", "problems have")} to be put right before this can be approved: ${blockingExceptions.slice(0, 5).map((p) => `${p.name}: ${p.reason}`).join("; ")}${blockingExceptions.length > 5 ? "; and more" : ""}.`,
      details: { people: blockingExceptions.map((p) => ({ employeeId: p.employeeId, name: p.name, code: p.code, reason: p.reason })) },
    });
  }
  try {
    await assertRunIsReal((run.pins as unknown as RulePin[]) ?? [], "submitted for approval");
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    blockers.push({ code: err.code ?? "RULES", title: err.code === "RULES_CHANGED" ? "A rule has changed" : "Placeholder rules", message: err.message, ...(err.details ? { details: err.details as Record<string, unknown> } : {}) });
  }
  if (payable === 0) {
    blockers.push({ code: "NOTHING_TO_PAY", title: "Nobody would be paid", message: "Nobody in this run is payable (everyone is held or left out), so there is nothing to approve." });
  }
  return { computed, stale, leftOut, blockingExceptions, held, payable, blockers };
}
