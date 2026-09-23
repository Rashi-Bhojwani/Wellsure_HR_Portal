import { createHmac } from "node:crypto";
import { env } from "../config/env";

// Deterministic "blind index" for encrypted fields (spec §9): AES-256-GCM
// ciphertext is non-deterministic (random IV per call), so it can't be
// compared or indexed — these HMAC-SHA256 hashes, keyed by a pepper
// separate from the encryption key (env.FIELD_HASH_PEPPER), exist only for
// exact-match uniqueness/duplicate-detection/search. They must never be
// used to attempt to recover the original value.

export function blindIndex(normalized: string): string {
  return createHmac("sha256", env.FIELD_HASH_PEPPER).update(normalized).digest("hex");
}

export function normalizePan(pan: string): string {
  return pan.trim().toUpperCase();
}

export function normalizeAadhaar(aadhaar: string): string {
  return aadhaar.replace(/\D/g, "");
}

export function normalizeAccountNumber(accountNumber: string): string {
  return accountNumber.replace(/\D/g, "");
}

export function last4(normalized: string): string {
  return normalized.slice(-4);
}
