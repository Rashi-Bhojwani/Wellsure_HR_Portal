import { createHash, randomBytes } from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { decryptField, encryptField } from "../../lib/encryption";

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

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  const result = await verify({ secret, token: code });
  return result.valid;
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
