// Small-group suppression for Insights (Peeps stage 2).
//
// A table is a set of disjoint cells (one per department, reason or stage) and, optionally, a published total that is the sum of
// the cells. Each cell has a population `n` (the people behind the figure). Rules, with k = the director's minimum group size:
//   1. Primary suppression: a cell with 0 < n < k shows no figure.
//   2. Complementary suppression: if the total is published, the people hidden by suppression (total − visible cells) must be
//      either nobody or at least k people. Otherwise the next-smallest visible non-empty cells are suppressed too, one by one.
//   3. If that still cannot reach k (the whole table is smaller than k), the total is suppressed as well — then nothing is shown.
// A cell with n = 0 is shown as zero: it reveals nobody. Because only one grouping (department) is offered per metric, there are
// no overlapping groups to difference; the total is the only overlap and rule 2 covers it.
export type Cell<V> = { key: string; label: string; n: number; value: V };
export type ShownCell<V> = { key: string; label: string; suppressed: boolean; n: number | null; value: V | null };
export type Table<V> = { cells: ShownCell<V>[]; total: { suppressed: boolean; n: number | null; value: V | null } };

export function suppress<V>(cells: Cell<V>[], total: { n: number; value: V } | null, k: number): Table<V> {
  if (!Number.isInteger(k) || k < 2) throw new Error("minimum group size must be an integer of at least 2");
  const hidden = new Set<string>(cells.filter((c) => c.n > 0 && c.n < k).map((c) => c.key));
  let totalSuppressed = false;
  if (total) {
    const hiddenPeople = () => cells.filter((c) => hidden.has(c.key)).reduce((s, c) => s + c.n, 0);
    // Smallest first, then by key, so the choice is deterministic.
    const candidates = cells.filter((c) => c.n > 0 && !hidden.has(c.key)).sort((a, b) => a.n - b.n || a.key.localeCompare(b.key));
    while (hiddenPeople() > 0 && hiddenPeople() < k && candidates.length) hidden.add(candidates.shift()!.key);
    if (hiddenPeople() > 0 && hiddenPeople() < k) totalSuppressed = true;
    if (total.n > 0 && total.n < k) totalSuppressed = true;
    if (totalSuppressed) for (const c of cells) if (c.n > 0) hidden.add(c.key);
  }
  return {
    cells: cells.map((c) => (hidden.has(c.key) ? { key: c.key, label: c.label, suppressed: true, n: null, value: null } : { key: c.key, label: c.label, suppressed: false, n: c.n, value: c.value })),
    total: !total || totalSuppressed ? { suppressed: true, n: null, value: null } : { suppressed: false, n: total.n, value: total.value },
  };
}
