import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { PHOTO_FULL_SIZE_PX, PHOTO_INPUT_FORMATS, PHOTO_THUMB_SIZE_PX } from "@shared/constants/peopleDocuments";
import { env } from "../../config/env";
import { storageService } from "../../integrations/storage";
import { writeAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { getPeopleDocumentsSettings } from "../../lib/peopleDocumentsSettings";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { resolveAccess } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { assertWithinSize } from "../../lib/uploads";
import { HttpError } from "../../middleware/errorHandler";

// Employee photos (Phase 5 commit C). An uploaded image is never stored as
// uploaded: it's decoded with sharp, auto-oriented from its EXIF rotation,
// then RE-ENCODED to WebP — which drops every byte of metadata (EXIF, GPS
// location, XMP, ICC comments) and anything smuggled alongside the pixels.
// Only the two re-encoded outputs (a 512px photo and a 96x96 thumbnail for
// the directory/org chart) are ever written to storage.

// Decompression-bomb guard: a small file can declare enormous dimensions.
// 64 MP comfortably covers any phone camera.
const MAX_INPUT_PIXELS = 64_000_000;

export interface ProcessedPhoto {
  full: Buffer;
  thumb: Buffer;
}

export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new HttpError(400, "That file isn't a readable image.", "INVALID_UPLOAD");
  }
  // Judged from what sharp actually decoded — never the declared type or extension.
  if (!format || !(PHOTO_INPUT_FORMATS as readonly string[]).includes(format)) {
    throw new HttpError(400, "Upload a JPEG, PNG or WebP image.", "INVALID_UPLOAD");
  }
  try {
    const oriented = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
    const [full, thumb] = await Promise.all([
      oriented
        .clone()
        .resize(PHOTO_FULL_SIZE_PX, PHOTO_FULL_SIZE_PX, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer(),
      oriented.clone().resize(PHOTO_THUMB_SIZE_PX, PHOTO_THUMB_SIZE_PX, { fit: "cover", position: "attention" }).webp({ quality: 75 }).toBuffer(),
    ]);
    return { full, thumb };
  } catch {
    throw new HttpError(400, "That image couldn't be processed. Try a different photo.", "INVALID_UPLOAD");
  }
}

interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function requirePersonal(employeeId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, personal: true } });
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (!employee.personal) {
    throw new HttpError(409, "Add this employee's personal details before uploading a photo.", "CONFLICT");
  }
  return employee.personal;
}

async function deleteObjectsQuietly(keys: Array<string | null>): Promise<void> {
  for (const key of keys) {
    if (!key) continue;
    // The database no longer points at it; a leftover object is garbage,
    // not a correctness problem, so a storage hiccup never fails the request.
    await storageService.deleteObject(key).catch((err) => logger.warn({ err, key }, "failed to delete replaced photo object"));
  }
}

export async function setPhoto(employeeId: string, file: Express.Multer.File, meta: ActorMeta, action: string) {
  const personal = await requirePersonal(employeeId);
  const settings = await getPeopleDocumentsSettings();
  assertWithinSize(file, settings.photoMaxUploadMb);
  const processed = await processPhoto(file.buffer);

  const version = randomBytes(8).toString("hex");
  const fullKey = `employees/${employeeId}/photo/${version}-full.webp`;
  const thumbKey = `employees/${employeeId}/photo/${version}-thumb.webp`;
  await storageService.putObject(fullKey, processed.full, "image/webp");
  await storageService.putObject(thumbKey, processed.thumb, "image/webp");
  await prisma.employeePersonal.update({
    where: { employeeId },
    data: { photoStorageKey: fullKey, photoThumbStorageKey: thumbKey, photoVersion: version },
  });
  await deleteObjectsQuietly([personal.photoStorageKey, personal.photoThumbStorageKey]);
  await writeAuditLog({
    ...meta,
    action,
    entityType: "Employee",
    entityId: employeeId,
    before: { photoVersion: personal.photoVersion },
    after: { photoVersion: version, storedBytes: processed.full.length + processed.thumb.length },
  });
  return { photoVersion: version };
}

export async function removePhoto(employeeId: string, meta: ActorMeta, action: string): Promise<void> {
  const personal = await requirePersonal(employeeId);
  if (!personal.photoStorageKey && !personal.photoThumbStorageKey) return;
  await prisma.employeePersonal.update({
    where: { employeeId },
    data: { photoStorageKey: null, photoThumbStorageKey: null, photoVersion: null },
  });
  await deleteObjectsQuietly([personal.photoStorageKey, personal.photoThumbStorageKey]);
  await writeAuditLog({ ...meta, action, entityType: "Employee", entityId: employeeId, before: { photoVersion: personal.photoVersion }, after: { photoVersion: null } });
}

// ── Photo token ──────────────────────────────────────────────────────
// <img> tags can't send the Authorization header (access tokens live in
// memory, spec §9), and per-photo signed URLs would bloat the directory and
// org-chart payloads (hundreds of long, incompressible signatures). So each
// signed-in session fetches ONE short-lived token, scoped to photo reads
// only, and appends it to photo URLs. It proves "a signed-in user asked
// for this within the last hour" — nothing else accepts it. The signing
// key is derived from JWT_ACCESS_SECRET with a purpose label, so it can
// never be confused with, or used as, an access token.
export const PHOTO_TOKEN_TTL_SECONDS = 60 * 60;

function photoTokenKey(): Buffer {
  return createHmac("sha256", env.JWT_ACCESS_SECRET).update("wellsure:photo-token:v1").digest();
}

function signPhotoToken(userId: string, exp: number): string {
  return createHmac("sha256", photoTokenKey()).update(`${userId}.${exp}`).digest("base64url");
}

export function issuePhotoToken(userId: string, now = Date.now()): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + PHOTO_TOKEN_TTL_SECONDS;
  return { token: `${userId}.${exp}.${signPhotoToken(userId, exp)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyPhotoToken(token: string, now = Date.now()): string | null {
  const [userId, expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!userId || !sig || !Number.isInteger(exp) || now / 1000 > exp) return null;
  const expected = Buffer.from(signPhotoToken(userId, exp));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? userId : null;
}

// Deactivation takes effect immediately everywhere else (middleware/
// authenticate.ts re-checks on every request), so it must here too — but a
// directory page loads hundreds of thumbnails at once, so the status check
// is cached briefly per user rather than hitting the database per image.
const ACTIVE_CACHE_MS = 30_000;
const activeUserCache = new Map<string, { active: boolean; until: number }>();

async function isActiveUser(userId: string): Promise<boolean> {
  const cached = activeUserCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.active;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  const active = user?.status === "ACTIVE";
  activeUserCache.set(userId, { active, until: Date.now() + ACTIVE_CACHE_MS });
  return active;
}

export function clearPhotoTokenUserCache(): void {
  activeUserCache.clear();
}

export async function readPhotoForViewer(token: string | undefined, employeeId: string, size: "thumb" | "full") {
  const viewerUserId = token ? verifyPhotoToken(token) : null;
  if (!viewerUserId || !(await isActiveUser(viewerUserId))) {
    throw new HttpError(401, "Photo link expired — reload the page.", "UNAUTHORIZED");
  }
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { status: true, personal: { select: { photoStorageKey: true, photoThumbStorageKey: true } } },
  });
  // Same visibility as the directory: ACTIVE employees for everyone; anyone
  // else only for viewers who may view employee records (HR profile pages).
  if (!employee) throw new HttpError(404, "Photo not found.", "NOT_FOUND");
  if (employee.status !== "ACTIVE") {
    // E1.1 (was a leak): a former employee's photo needs employee.view AND
    // the person within the viewer's data scope — a manager sees their own
    // team's, not the whole company's.
    const viewer = await resolveAccess(viewerUserId);
    const viewerUser = await prisma.user.findUnique({ where: { id: viewerUserId }, select: { employeeId: true } });
    if (!viewer.permissions.has("employee.view") || !viewerUser || !(await prisma.employee.findFirst({ where: { AND: [{ id: employeeId }, await buildEmployeeScopeWhere(viewerUser.employeeId, viewer.dataScope)] }, select: { id: true } }))) {
      throw new HttpError(404, "Photo not found.", "NOT_FOUND");
    }
  }
  const key = size === "thumb" ? employee.personal?.photoThumbStorageKey : employee.personal?.photoStorageKey;
  if (!key) throw new HttpError(404, "Photo not found.", "NOT_FOUND");
  return storageService.getObject(key);
}
