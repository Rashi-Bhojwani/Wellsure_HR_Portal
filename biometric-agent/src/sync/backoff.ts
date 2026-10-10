// Exponential backoff with jitter: initial, doubling, capped (docs/plans/
// PHASE_2.md §7.1). Jitter (±20%) keeps several agents from retrying in step.
export class Backoff {
  private attempt = 0;

  constructor(
    private readonly initialMs: number,
    private readonly maxMs: number,
    private readonly random: () => number = Math.random,
  ) {}

  next(): number {
    const base = Math.min(this.maxMs, this.initialMs * 2 ** this.attempt);
    this.attempt++;
    return Math.round(base * (0.8 + 0.4 * this.random()));
  }

  reset(): void {
    this.attempt = 0;
  }

  get failures(): number {
    return this.attempt;
  }
}
