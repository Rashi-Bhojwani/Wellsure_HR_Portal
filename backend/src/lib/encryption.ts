import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

// AES-256-GCM field encryption for bank account, PAN, Aadhaar, UAN — spec §9.
// Local dev derives a static 32-byte key from KMS_FIELD_KEY_ID via SHA-256.
// Staging/production (spec §15.3) swap this module for one that requests a
// data key from AWS KMS per encryption and stores/decrypts it via envelope
// encryption — encryptField/decryptField's signatures stay the same, so no
// caller changes when that swap happens.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const key = createHash("sha256").update(env.KMS_FIELD_KEY_ID).digest();

// Packed layout: [iv (12 bytes)][authTag (16 bytes)][ciphertext].
// Returns a plain Uint8Array (via Uint8Array.from, a fresh copy) rather
// than a Node Buffer — Prisma's generated client types Bytes fields as
// Uint8Array<ArrayBuffer> for writes, which Buffer's wider
// Uint8Array<ArrayBufferLike> doesn't structurally satisfy.
export function encryptField(plaintext: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  // Uint8Array.from's ambient return type is still generic over
  // ArrayBufferLike in this @types/node version even though the value it
  // produces always has a real (non-shared) ArrayBuffer backing — narrow
  // it explicitly to match what Prisma's generated client expects for
  // Bytes fields.
  return Uint8Array.from(packed) as Uint8Array<ArrayBuffer>;
}

export function decryptField(packed: Uint8Array): string {
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
