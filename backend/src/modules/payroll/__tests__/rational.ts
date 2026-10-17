// Exact rational arithmetic on BigInt, for checking the payroll arithmetic independently of the decimal library the code uses. A test-only shadow: if the code
// and this agree to the paisa on random inputs, the formulas are right, not merely repeatable.

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));

export class Frac {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error("division by zero");
    const g = gcd(n, d) || 1n;
    const s = d < 0n ? -1n : 1n;
    this.n = (s * n) / g;
    this.d = (s * d) / g;
  }
  /** "12", "12.5", "-0.75" */
  static of(text: string | number | bigint): Frac {
    if (typeof text === "bigint") return new Frac(text);
    const t = String(text).trim();
    const [whole, frac = ""] = t.replace("-", "").split(".");
    const n = BigInt(whole! + frac);
    return new Frac(t.startsWith("-") ? -n : n, 10n ** BigInt(frac.length));
  }
  plus(o: Frac) {
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  minus(o: Frac) {
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  times(o: Frac) {
    return new Frac(this.n * o.n, this.d * o.d);
  }
  div(o: Frac) {
    return new Frac(this.n * o.d, this.d * o.n);
  }
  cmp(o: Frac): number {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  min(o: Frac) {
    return this.cmp(o) <= 0 ? this : o;
  }
  /** Round to `scale` places, half away from zero (HALF_UP for the positive amounts here). */
  roundHalfUp(scale = 0): Frac {
    const f = 10n ** BigInt(scale);
    const scaled = this.times(new Frac(f));
    const q = scaled.n / scaled.d;
    const r = scaled.n % scaled.d;
    const twice = (r < 0n ? -r : r) * 2n;
    const bump = twice >= scaled.d ? (scaled.n < 0n ? -1n : 1n) : 0n;
    return new Frac(q + bump, f);
  }
  /** Round up (ceiling for positive amounts) to `scale` places. */
  ceil(scale = 0): Frac {
    const f = 10n ** BigInt(scale);
    const scaled = this.times(new Frac(f));
    const q = scaled.n / scaled.d;
    const exact = scaled.n % scaled.d === 0n;
    return new Frac(q + (exact || scaled.n < 0n ? 0n : 1n), f);
  }
  /** Plain decimal text if it terminates, for comparing with canonical decimals. */
  toString(): string {
    if (this.d === 1n) return this.n.toString();
    let d = this.d;
    let twos = 0;
    let fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos += 1;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives += 1;
    }
    if (d !== 1n) throw new Error(`${this.n}/${this.d} does not terminate`);
    const places = Math.max(twos, fives);
    const scaled = this.n * (10n ** BigInt(places) / this.d);
    const neg = scaled < 0n;
    const digits = (neg ? -scaled : scaled).toString().padStart(places + 1, "0");
    const out = `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`.replace(/\.?0+$/, "");
    return neg ? `-${out}` : out;
  }
}
