import {
  DEFAULT_DIRECTORY_VISIBLE_FIELDS,
  DEFAULT_DOCUMENT_ALLOWED_MIME_TYPES,
  DEFAULT_DOCUMENT_MAX_UPLOAD_MB,
  DEFAULT_PHOTO_MAX_UPLOAD_MB,
  DIRECTORY_TOGGLEABLE_FIELDS,
  SUPPORTED_DOCUMENT_MIME_TYPES,
  type DirectoryToggleableField,
  type DocumentMimeType,
} from "@shared/constants/peopleDocuments";
import { getSetting } from "./settings";

// Phase 5 commit C's admin-editable settings (System Settings → People &
// Documents). Read by modules/people and modules/documents; written only
// by modules/settings. Unknown values in a stored row (e.g. a field key
// or MIME type a later version dropped) are filtered out, never trusted.
export const PEOPLE_DOCUMENTS_SETTING_KEYS = {
  directoryVisibleFields: "people.directory.visibleFields",
  photoMaxUploadMb: "people.photo.maxUploadMb",
  documentMaxUploadMb: "documents.maxUploadMb",
  documentAllowedMimeTypes: "documents.allowedMimeTypes",
} as const;

export interface PeopleDocumentsSettings {
  directoryVisibleFields: DirectoryToggleableField[];
  photoMaxUploadMb: number;
  documentMaxUploadMb: number;
  documentAllowedMimeTypes: DocumentMimeType[];
}

export async function getPeopleDocumentsSettings(): Promise<PeopleDocumentsSettings> {
  const k = PEOPLE_DOCUMENTS_SETTING_KEYS;
  const [fields, photoMb, docMb, mimes] = await Promise.all([
    getSetting<string[]>(k.directoryVisibleFields, DEFAULT_DIRECTORY_VISIBLE_FIELDS),
    getSetting<number>(k.photoMaxUploadMb, DEFAULT_PHOTO_MAX_UPLOAD_MB),
    getSetting<number>(k.documentMaxUploadMb, DEFAULT_DOCUMENT_MAX_UPLOAD_MB),
    getSetting<string[]>(k.documentAllowedMimeTypes, DEFAULT_DOCUMENT_ALLOWED_MIME_TYPES),
  ]);
  return {
    directoryVisibleFields: fields.filter((f): f is DirectoryToggleableField =>
      (DIRECTORY_TOGGLEABLE_FIELDS as readonly string[]).includes(f),
    ),
    photoMaxUploadMb: photoMb,
    documentMaxUploadMb: docMb,
    documentAllowedMimeTypes: mimes.filter((m): m is DocumentMimeType => (SUPPORTED_DOCUMENT_MIME_TYPES as string[]).includes(m)),
  };
}
