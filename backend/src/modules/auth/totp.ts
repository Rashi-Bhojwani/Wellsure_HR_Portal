import { createHash, randomBytes } from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { decryptField, encryptField } from "../../lib/encryption";
import { redis } from "../../lib/redis";

const ISSUER = "Wellsure HR Portal";
const BACKUP_CODE_COUNT = 10;

export function generateTotpSecret(): string {
  return generateSecret();
}

export async function generateTotpEnrollment(employeeCode: string, secret: string): Promise<{ qrCodeDataUrl: string; secret: string }> {
  const uri = generateURI({ issuer: ISSUER, label: employeeCode, secret });
  const qrCodeDataUrl = await QRCode.toDataURL(uri);
  return { qrCodeDataUrl, secret };
}

// A code is generated for a 30-second step. Authenticator apps and a phone clock a few seconds out of step produce the code of the step just before or just after,
// and a code typed in the last second of its step arrives in the next one, so the server accepts the previous, the current and the next step (a tolerance of one step,
// 30 seconds each way). That widens the window to 90 seconds, which is why an accepted code is also remembered (consumeTotpCode) and cannot be used a second time.
const TOTP_STEP_SECONDS = 30;
const TOTP_REPLAY_WINDOW_SECONDS = TOTP_STEP_SECONDS * 3;

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  const result = await verify({ secret, token: code, epochTolerance: TOTP_STEP_SECONDS });
  return result.valid;
}

/**
 * Remembers that this user has just used this code, for as long as it could still be valid. True the first time; false if it was already used.
 * Fails closed: if the store cannot be reached the login is refused, never allowed through unguarded.
 */
export async function consumeTotpCode(userId: string, code: string): Promise<boolean> {
  const key = `totp:used:${userId}:${createHash("sha256").update(code.trim()).digest("hex").slice(0, 32)}`;
  return (await redis.set(key, "1", "EX", TOTP_REPLAY_WINDOW_SECONDS, "NX")) === "OK";
}

export function encryptTotpSecret(secret: string): Uint8Array<ArrayBuffer> {
  return encryptField(secret);
}

export function decryptTotpSecret(encrypted: Uint8Array): string {
  return decryptField(encrypted);
}

// Backup codes: human-typeable (e.g. "3F7K-9QRT"), stored only as a fast
// hash (they're high-entropy random strings, not passwords — no need for
// argon2's deliberate slowness) — returned in the clear exactly once.
export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
