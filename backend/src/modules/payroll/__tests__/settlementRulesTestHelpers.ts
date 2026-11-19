import request from "supertest";
import { expect } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";

// Owner decision 2026-11-17 (docs/plans/OWNER_EMPTY_SETTINGS.md): gratuity, notice pay and leave encashment ship Not set, and a final settlement is refused until all
// three are in force on the last working day. Tests that prepare a settlement for another reason set them first with these TEST values (made up, never a statement of
// the law or of any policy). The values are the reference figures' shape only; each test chooses its own head.

const ROUND = { mode: "HALF_UP" as const, scale: 0 };
export const testGratuity = (head: string, over: Record<string, unknown> = {}) => ({ effectiveFrom: "2026-01-01", minYears: "5", partYear: "SIX_MONTHS_OR_MORE_COUNTS_AS_A_YEAR", wageHeads: [head], daysPerYear: "15", divisor: "26", ceiling: "2000000", rounding: ROUND, sourceNote: "TEST values, not a real rule", ...over });
export const testNotice = (head: string, over: Record<string, unknown> = {}) => ({ effectiveFrom: "2026-01-01", noticeDays: 30, recoverShortfall: true, basisHeads: [head], divisor: "30", rounding: ROUND, sourceNote: "TEST values, not a real period", ...over });
export const testEncashment = (head: string, over: Record<string, unknown> = {}) => ({ payHead: head, exitLeaveTypes: ["PL"], basisHeads: [head], divisor: { kind: "FIXED_DAYS", days: "30" }, rounding: ROUND, sourceNote: "TEST values, not a real formula", ...over });

/** Through the routes, as the screens do: one director proposes, a different one confirms. Returns the proposal id (for cleanup with deleteWithDependents). */
export async function setBehaviourByRoute(makerToken: string, checkerToken: string, key: string, value: unknown): Promise<string> {
  const p = await request(app).post(`/api/behaviours/${key}/proposals`).set(...authHeader(makerToken)).send({ value, reason: "TEST values" });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const c = await request(app).post(`/api/behaviours/proposals/${p.body.id}/confirm`).set(...authHeader(checkerToken)).send();
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  return p.body.id as string;
}

/**
 * For a test whose company has no salary components (so the routes would refuse a made-up head): the same two rows the routes write, proposal and a DIFFERENT
 * director's confirmation. Only for tests that are not about the settings themselves. Returns the proposal ids.
 */
export async function setSettlementRulesDirect(proposerUserId: string, confirmerUserId: string, head: string, over: { gratuity?: Record<string, unknown>; notice?: Record<string, unknown>; encashment?: Record<string, unknown> } = {}): Promise<string[]> {
  const ids: string[] = [];
  for (const [key, value] of [["payroll.gratuity", testGratuity(head, over.gratuity)], ["payroll.noticeRecovery", testNotice(head, over.notice)], ["payroll.leaveEncashment", testEncashment(head, over.encashment)]] as const) {
    const row = await prisma.behaviourProposal.create({ data: { key, value: value as object, reason: "TEST values", proposedByUserId: proposerUserId } });
    await prisma.behaviourConfirmation.create({ data: { proposalId: row.id, confirmedByUserId: confirmerUserId } });
    ids.push(row.id);
  }
  return ids;
}
