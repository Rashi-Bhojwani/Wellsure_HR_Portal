import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import type { SignedUrlOptions, StorageService } from "./StorageService";

// Local filesystem StorageService — dev-only stand-in for S3. Objects live
// under STORAGE_LOCAL_DIR (default .storage/, gitignored); a small sidecar
// "<key>.meta.json" holds the content type since the filesystem has none of
// its own. Signed URLs are simulated: an HMAC over `key:expiry` verified by
// the /dev/storage route in ./devRoute.ts — never used when
// STORAGE_DRIVER=s3.
const ROOT = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);

function resolveKeyPath(key: string): string {
  const resolved = path.resolve(ROOT, key);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error(`Invalid storage key (escapes storage root): ${key}`);
  }
  return resolved;
}

// The download filename (if any) is part of what's signed, so a URL can't
// be replayed with a different name attached.
function sign(key: string, exp: number, downloadFileName = ""): string {
  return createHmac("sha256", env.STORAGE_SIGNED_URL_SECRET).update(`${key}:${exp}:${downloadFileName}`).digest("hex");
}

export function verifyLocalSignedUrl(key: string, exp: number, sig: string, downloadFileName = ""): boolean {
  if (!Number.isFinite(exp) || Date.now() / 1000 > exp) return false;
  const expected = Buffer.from(sign(key, exp, downloadFileName));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function localStorageFilePath(key: string): string {
  return resolveKeyPath(key);
}

export class LocalStorageService implements StorageService {
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const filePath = resolveKeyPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    await writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType }), "utf8");
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const body = await readFile(resolveKeyPath(key));
    const { contentType } = await readLocalObjectMeta(key);
    return { body, contentType };
  }

  async getObjectSignedUrl(key: string, expiresInSeconds = 900, options: SignedUrlOptions = {}): Promise<string> {
    // Throws (via resolveKeyPath) if the key would escape the storage root,
    // so a bad key is caught here rather than at request time.
    resolveKeyPath(key);
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const url = new URL("/dev/storage", env.API_BASE_URL);
    url.searchParams.set("key", key);
    url.searchParams.set("exp", String(exp));
    if (options.downloadFileName) url.searchParams.set("dn", options.downloadFileName);
    url.searchParams.set("sig", sign(key, exp, options.downloadFileName));
    return url.toString();
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = resolveKeyPath(key);
    await rm(filePath, { force: true });
    await rm(`${filePath}.meta.json`, { force: true });
  }
}

export async function readLocalObjectMeta(key: string): Promise<{ contentType: string }> {
  try {
    const raw = await readFile(`${resolveKeyPath(key)}.meta.json`, "utf8");
    return JSON.parse(raw) as { contentType: string };
  } catch {
    return { contentType: "application/octet-stream" };
  }
}
