import { createHmac } from "node:crypto";
import { env } from "../../config/env";
import { decryptField, encryptField } from "../../lib/encryption";
import { canonicalJson } from "./hash";

// Sealed values (docs/plans/PHASE_6.md §14J): the owners' secrets that live inside a governed item's version (the company's PF, ESI, PT, LWF and TAN identifiers, and the whole
// bank file layout with the debit account). A version stores `{ sealed: "<AES-256-GCM, base64>" }` and nothing readable; its hash is KEYED (HMAC with the field-hash pepper), so a short,
// guessable code cannot be recovered from the hash a version, an approval or an event carries. `unseal` is called in exactly three places (a source scan pins it): the Reveal of a
// rule, the layout module, and this file.

export interface Sealed {
  sealed: string;
}

export const isSealed = (v: unknown): v is Sealed => typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { sealed?: unknown }).sealed === "string" && Object.keys(v).length === 1;

export function seal(value: unknown): Sealed {
  return { sealed: Buffer.from(encryptField(JSON.stringify(value))).toString("base64") };
}

export function unseal<T = unknown>(v: Sealed): T {
  return JSON.parse(decryptField(Buffer.from(v.sealed, "base64"))) as T;
}

/** A hash of a secret that only this system can compute: the same value gives the same hash (so "type it again" can be compared and a version can be pinned), nobody else can compute or reverse it. */
export function keyedHash(namespace: string, value: unknown): string {
  return `sealed-hash-v1:${createHmac("sha256", env.FIELD_HASH_PEPPER).update(`${namespace}\0${canonicalJson(value)}`).digest("hex")}`;
}

/** What goes into an audit row, a response or a log line in place of a sealed value. */
export const HIDDEN = { hidden: true } as const;
