export interface SignedUrlOptions {
  // When set, the response is served as a download under this filename
  // (Content-Disposition: attachment) instead of the storage key's own name.
  downloadFileName?: string;
}

export interface StorageService {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<{ body: Buffer; contentType: string }>;
  getObjectSignedUrl(key: string, expiresInSeconds?: number, options?: SignedUrlOptions): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

// RFC 6266/5987: an ASCII-safe fallback plus the exact UTF-8 name.
export function attachmentContentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
