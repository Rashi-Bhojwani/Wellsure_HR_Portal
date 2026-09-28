// Classic edit-distance DP. Used only for near-duplicate-name warnings
// (Import Center, spec §10: "flag near-duplicate location and department
// names for merging") — small inputs (branch/department names), so the
// O(n*m) table is never a performance concern.
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]!;
  }
  return prev[n]!;
}

// True when `name` is close enough to `existing` to plausibly be a typo of
// it, but not identical (identical names are caught separately as an exact
// duplicate, not a near-duplicate). Threshold scales gently with length so
// "Ajmer"/"Ajmer " isn't over-triggered on short names while
// "C-10 Panchsheel"/"C-10 Panchsheeel" still flags on longer ones.
export function isNearDuplicate(name: string, existing: string): boolean {
  const a = name.trim().toLowerCase();
  const b = existing.trim().toLowerCase();
  if (a === b) return false;
  const distance = levenshtein(a, b);
  const threshold = Math.max(1, Math.min(3, Math.floor(Math.max(a.length, b.length) / 8)));
  return distance > 0 && distance <= threshold;
}
