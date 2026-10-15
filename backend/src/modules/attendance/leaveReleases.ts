import { prisma } from "../../lib/prisma";

// Approved leave HR released because the person worked that day (Phase 3 commit 2, docs/plans/PHASE_3.md). The
// engine's loader asks which (leave request, date) pairs are released and stops treating them as leave. The release
// itself — the ledger reversal and its rows — is written by modules/leave/releases.ts.

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `${leaveRequestId}|${date}` for every release touching these employees in [from, to]. */
export async function loadReleasedLeave(employeeIds: string[], from: string, to: string): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const rows = await prisma.leaveDayRelease.findMany({
    where: { employeeId: { in: employeeIds }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    select: { leaveRequestId: true, date: true },
  });
  return new Set(rows.map((r) => `${r.leaveRequestId}|${iso(r.date)}`));
}
