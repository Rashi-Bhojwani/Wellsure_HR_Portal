import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { canonicalDecimal } from "./money";

// The content hash that approvals are bound to (Phase 6 §6). Canonical JSON: object keys sorted, no insignificant whitespace, decimals as
// canonical strings, dates as ISO text. Integers are allowed; a non-integer JavaScript number is refused outright, because a float in
// anything that is hashed is exactly the kind of figure that could differ by a hair between two runs and quietly void (or fail to void) an approval.

export const HASH_VERSION = "payroll-hash-v1";

export class NonCanonicalValueError extends Error {}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value, "$"));
}

function normalise(value: unknown, path: string): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new NonCanonicalValueError(`${path}: a non-integer number cannot be hashed; use a decimal string`);
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return canonicalDecimal(value as Prisma.Decimal);
  if (Array.isArray(value)) return value.map((v, i) => normalise(v, `${path}[${i}]`));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) throw new NonCanonicalValueError(`${path}.${key}: undefined cannot be hashed; leave the key out or use null`);
      out[key] = normalise(v, `${path}.${key}`);
    }
    return out;
  }
  throw new NonCanonicalValueError(`${path}: ${typeof value} cannot be hashed`);
}

/** Hash of the canonical form, versioned so a future change to the form is visible. */
export function payrollHash(value: unknown): string {
  return `${HASH_VERSION}:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
