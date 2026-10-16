import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { activeFieldKeys } from "./fieldKeys";

// AES-256-GCM field encryption for bank account, PAN, Aadhaar, UAN and TOTP secrets — spec §9.
// The keys come from lib/fieldKeys.ts: KMS-wrapped data keys in staging/production, one static key in development. Callers see
// only these two functions, which stay synchronous; the keys are unwrapped once at startup (initFieldEncryption).
//
// Packed layout: [key id (1 byte)][iv (12)][authTag (16)][ciphertext].
// The key id says which data key made the ciphertext, so a new key can be added while old values still decrypt, and so a
// re-encryption pass can find what is still on an old key. It is also authenticated (GCM additional data), so changing it fails
// the tag check instead of silently trying a different key.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER = 1 + IV_LENGTH + AUTH_TAG_LENGTH;

// Returns a plain Uint8Array (via Uint8Array.from, a fresh copy) rather
// than a Node Buffer — Prisma's generated client types Bytes fields as
// Uint8Array<ArrayBuffer> for writes, which Buffer's wider
// Uint8Array<ArrayBufferLike> doesn't structurally satisfy.
export function encryptField(plaintext: string): Uint8Array<ArrayBuffer> {
  const { current, keys } = activeFieldKeys();
  const keyId = Buffer.from([current]);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keys.get(current)!, iv);
  cipher.setAAD(keyId);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const packed = Buffer.concat([keyId, iv, cipher.getAuthTag(), ciphertext]);
  // Uint8Array.from's ambient return type is still generic over
  // ArrayBufferLike in this @types/node version even though the value it
  // produces always has a real (non-shared) ArrayBuffer backing — narrow
  // it explicitly to match what Prisma's generated client expects for
  // Bytes fields.
  return Uint8Array.from(packed) as Uint8Array<ArrayBuffer>;
}

/** Which data key made this ciphertext (0 if it is too short to be one). */
export function ciphertextKeyId(packed: Uint8Array): number {
  return packed.length >= HEADER ? packed[0]! : 0;
}

export function decryptField(packed: Uint8Array): string {
  if (packed.length < HEADER) throw new Error("Encrypted value is too short to be valid.");
  const keyId = packed[0]!;
  const key = activeFieldKeys().keys.get(keyId);
  if (!key) throw new Error(`Encrypted value was made with data key ${keyId}, which is not in this process's keyring.`);
  const iv = packed.subarray(1, 1 + IV_LENGTH);
  const authTag = packed.subarray(1 + IV_LENGTH, HEADER);
  const ciphertext = packed.subarray(HEADER);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from([keyId]));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
