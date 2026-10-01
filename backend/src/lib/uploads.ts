import path from "node:path";
import type { RequestHandler } from "express";
import multer from "multer";
import sharp from "sharp";
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

// Several files in one multipart field ("files") — helpdesk messages.
// Multer's own limit errors ("Unexpected field" for one file too many) mean
// nothing to an employee, so they're translated here.
export function memoryUploadMany(ceilingMb: number, maxFiles: number): RequestHandler {
  const handler = multer({ storage: multer.memoryStorage(), limits: { fileSize: ceilingMb * 1024 * 1024, files: maxFiles } }).array("files", maxFiles);
  return (req, res, next) => {
    handler(req, res, (err?: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
          return next(new HttpError(400, `Attach at most ${maxFiles} files.`, "INVALID_UPLOAD"));
        }
        if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(400, `A file is larger than the ${ceilingMb} MB limit.`, "INVALID_UPLOAD"));
      }
      next(err as Error | undefined);
    });
  };
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

// Decompression-bomb guard for anything sharp decodes (same cap as photos).
const MAX_INPUT_PIXELS = 64_000_000;

export interface PreparedUpload {
  buffer: Buffer;
  mimeType: DocumentMimeType;
  fileName: string;
  sizeBytes: number;
}

// The one path every user-uploaded document goes through (Document Center,
// employee documents, helpdesk attachments): validateDocumentUpload's checks,
// then — for images — a sharp re-encode in the same format, auto-oriented,
// which drops every byte of metadata (EXIF incl. GPS, XMP, comments). A
// photographed payslip or ID is exactly the leak case. Only the re-encoded
// bytes are ever stored. (PDF/Office files are stored as validated; their
// internal document properties aren't rewritten.)
export async function prepareDocumentUpload(
  file: Express.Multer.File,
  settings: { documentMaxUploadMb: number; documentAllowedMimeTypes: DocumentMimeType[] },
): Promise<PreparedUpload> {
  const { mimeType, fileName } = validateDocumentUpload(file, settings);
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
    return { buffer: file.buffer, mimeType, fileName, sizeBytes: file.size };
  }
  try {
    const image = sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
    const buffer = mimeType === "image/jpeg" ? await image.jpeg({ quality: 90 }).toBuffer() : await image.png().toBuffer();
    return { buffer, mimeType, fileName, sizeBytes: buffer.length };
  } catch {
    throw new HttpError(400, "That image couldn't be read. Try exporting it again or attach a PDF.", "INVALID_UPLOAD");
  }
}
