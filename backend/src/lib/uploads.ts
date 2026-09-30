import path from "node:path";
import multer from "multer";
import { DOCUMENT_MIME_TYPES, type DocumentMimeType } from "@shared/constants/peopleDocuments";
import { HttpError } from "../middleware/errorHandler";

// Shared upload handling for Phase 5 commit C (documents + photos), spec §9:
// "type and size validation, private storage, signed URLs with short expiry".
//
// Multer only ever buffers in memory and is capped at a fixed hard ceiling
// (it's configured once at startup); the admin-editable limit from System
// Settings is enforced afterwards, per request, in validateDocumentUpload /
// the photo pipeline — so lowering the setting takes effect immediately.
export function memoryUpload(ceilingMb: number) {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: ceilingMb * 1024 * 1024, files: 1 } }).single("file");
}

export function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file || file.size === 0) throw new HttpError(400, "Attach a file to upload.", "INVALID_UPLOAD");
  return file;
}

export function assertWithinSize(file: Express.Multer.File, maxMb: number): void {
  if (file.size > maxMb * 1024 * 1024) {
    throw new HttpError(400, `The file is larger than the ${maxMb} MB limit.`, "INVALID_UPLOAD");
  }
}

// What the file's first bytes actually are — never trust the declared type
// or the extension alone. DOCX and XLSX are both ZIP containers, so both
// sniff as "zip" and are told apart by the (separately checked) extension.
type Sniffed = "pdf" | "png" | "jpeg" | "zip";
export function sniffFileKind(buffer: Buffer): Sniffed | null {
  const starts = (bytes: number[]) => bytes.every((b, i) => buffer[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts([0xff, 0xd8, 0xff])) return "jpeg";
  if (starts([0x50, 0x4b, 0x03, 0x04])) return "zip";
  return null;
}

const EXPECTED_KIND: Record<DocumentMimeType, Sniffed> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "zip",
};

// Keeps the name a user sees on download readable but harmless: no path
// components, no control characters, bounded length.
export function sanitizeFileName(originalName: string): string {
  const base = path.basename(originalName.replace(/\\/g, "/"));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return (cleaned || "file").slice(-200);
}

export function validateDocumentUpload(
  file: Express.Multer.File,
  settings: { documentMaxUploadMb: number; documentAllowedMimeTypes: DocumentMimeType[] },
): { mimeType: DocumentMimeType; fileName: string } {
  assertWithinSize(file, settings.documentMaxUploadMb);
  const allowedLabels = settings.documentAllowedMimeTypes.map((m) => DOCUMENT_MIME_TYPES[m].label).join(", ");
  const declared = file.mimetype as DocumentMimeType;
  if (!settings.documentAllowedMimeTypes.includes(declared)) {
    throw new HttpError(400, `This file type isn't allowed. Allowed types: ${allowedLabels}.`, "INVALID_UPLOAD");
  }
  const fileName = sanitizeFileName(file.originalname);
  const extension = path.extname(fileName).toLowerCase();
  if (!(DOCUMENT_MIME_TYPES[declared].extensions as readonly string[]).includes(extension)) {
    throw new HttpError(400, `The file extension doesn't match its type (${DOCUMENT_MIME_TYPES[declared].label}).`, "INVALID_UPLOAD");
  }
  if (sniffFileKind(file.buffer) !== EXPECTED_KIND[declared]) {
    throw new HttpError(400, `The file's contents don't match its type (${DOCUMENT_MIME_TYPES[declared].label}).`, "INVALID_UPLOAD");
  }
  return { mimeType: declared, fileName };
}
