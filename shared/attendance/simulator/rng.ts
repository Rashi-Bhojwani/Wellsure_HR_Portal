// A small seeded random generator (mulberry32). Every employee-day draws from
// its own stream (seed + employee + date), so a month is identical for a given
// seed whatever order it is generated in. docs/plans/PHASE_2.md "P2-G build design".

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** One of the entries, in proportion to its weight. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T;
  shuffle<T>(items: readonly T[]): T[];
}

/** FNV-1a over the parts: a stable 32-bit seed from a seed, a name, a date. */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("\u0001")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (items) => items[int(0, items.length - 1)]!,
    weighted: (entries) => {
      const total = entries.reduce((n, [, w]) => n + w, 0);
      let x = next() * total;
      for (const [item, w] of entries) {
        x -= w;
        if (x < 0) return item;
      }
      return entries[entries.length - 1]![0];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}
