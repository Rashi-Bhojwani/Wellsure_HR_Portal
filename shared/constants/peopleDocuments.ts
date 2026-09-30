// Phase 5 commit C — People directory + Document Center constants shared by
// backend (settings defaults, validation) and frontend (settings screen,
// directory rendering). The *values* are admin-editable System Settings;
// these are only the catalog of what can be toggled and the defaults a
// fresh install starts from.

// Directory fields a colleague may see, beyond the always-shown core
// (name, photo, Employee Code, designation, department, branch). One
// company-wide setting, no per-employee opt-out (user decision 2026-09-30).
export const DIRECTORY_TOGGLEABLE_FIELDS = [
  "officialEmail",
  "reportingManager",
  "mobile",
  "personalEmail",
  "birthday", // day + month only — the year is never exposed
  "dateOfJoining",
] as const;
export type DirectoryToggleableField = (typeof DIRECTORY_TOGGLEABLE_FIELDS)[number];

export const DIRECTORY_FIELD_LABELS: Record<DirectoryToggleableField, string> = {
  officialEmail: "Official email",
  reportingManager: "Reporting manager",
  mobile: "Mobile number",
  personalEmail: "Personal email",
  birthday: "Birthday (day and month, never the year)",
  dateOfJoining: "Date of joining",
};

export const DEFAULT_DIRECTORY_VISIBLE_FIELDS: DirectoryToggleableField[] = ["officialEmail", "reportingManager"];

// Uploads. The declared MIME type must be in the allowed list, match the
// file extension, and match the file's magic bytes.
export const DOCUMENT_MIME_TYPES = {
  "application/pdf": { label: "PDF", extensions: [".pdf"] },
  "image/png": { label: "PNG image", extensions: [".png"] },
  "image/jpeg": { label: "JPEG image", extensions: [".jpg", ".jpeg"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word (.docx)", extensions: [".docx"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { label: "Excel (.xlsx)", extensions: [".xlsx"] },
} as const;
export type DocumentMimeType = keyof typeof DOCUMENT_MIME_TYPES;
export const SUPPORTED_DOCUMENT_MIME_TYPES = Object.keys(DOCUMENT_MIME_TYPES) as DocumentMimeType[];

export const DEFAULT_DOCUMENT_ALLOWED_MIME_TYPES: DocumentMimeType[] = [...SUPPORTED_DOCUMENT_MIME_TYPES];
export const DEFAULT_DOCUMENT_MAX_UPLOAD_MB = 10;
// Phone photos are routinely 3–4 MB; the stored output is re-encoded and small regardless.
export const DEFAULT_PHOTO_MAX_UPLOAD_MB = 5;
// Hard ceilings the settings screen can't exceed (multer needs a fixed upper bound).
export const MAX_DOCUMENT_UPLOAD_MB_CEILING = 50;
export const MAX_PHOTO_UPLOAD_MB_CEILING = 20;

export const PHOTO_INPUT_FORMATS = ["jpeg", "png", "webp"] as const;
export const PHOTO_FULL_SIZE_PX = 512;
export const PHOTO_THUMB_SIZE_PX = 96;
