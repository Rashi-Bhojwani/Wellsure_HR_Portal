import { prisma } from "../../lib/prisma";

// A1 (docs/plans/A_PART3.md; owner decision 2026-11-13): the statutory identifiers payroll uses for a date — the latest dated copy that took effect on or before the
// day; before a person's first copy, that first copy (the first value known applies backwards, so a person with one record reads exactly what they hold).
export interface StatutoryOnDay {
  panLast4: string | null;
  uanEncrypted: Uint8Array | null;
  uanLast4: string | null;
  esiEncrypted: Uint8Array | null;
  esiLast4: string | null;
}

/** Pure: which copy is in force on `day` (YYYY-MM-DD), from one person's copies. Exported for the test. */
export function copyInForce<T extends { effectiveFrom: string; recordedAt: string }>(copies: readonly T[], day: string): T | null {
  if (copies.length === 0) return null;
  const sorted = [...copies].sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? a.recordedAt.localeCompare(b.recordedAt) : a.effectiveFrom.localeCompare(b.effectiveFrom)));
  const started = sorted.filter((c) => c.effectiveFrom <= day);
  return started.length ? started[started.length - 1]! : sorted[0]!;
}

export async function statutoryOn(employeeIds: readonly string[], day: Date): Promise<Map<string, StatutoryOnDay>> {
  const rows = await prisma.employeeStatutoryDated.findMany({ where: { employeeId: { in: [...employeeIds] } } });
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.employeeId, [...(by.get(r.employeeId) ?? []), r]);
  const iso = day.toISOString().slice(0, 10);
  const out = new Map<string, StatutoryOnDay>();
  for (const [id, list] of by) {
    const c = copyInForce(list.map((r) => ({ r, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), recordedAt: r.recordedAt.toISOString() })), iso);
    if (c) out.set(id, { panLast4: c.r.panLast4, uanEncrypted: c.r.uanEncrypted, uanLast4: c.r.uanLast4, esiEncrypted: c.r.esiEncrypted, esiLast4: c.r.esiLast4 });
  }
  return out;
}
