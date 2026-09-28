// Prisma's Json columns can't hold a raw Uint8Array/Buffer — anywhere an
// AES-256-GCM-encrypted field (bank account, PAN, Aadhaar, UAN — spec §9)
// needs to sit inside a Json blob before it reaches its real, typed table
// column (ProfileChangeRequest.changesJson, ImportStagingRow.data), it's
// base64-packed going in and unpacked coming back out through these two.
export function packBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function unpackBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(b64, "base64")) as Uint8Array<ArrayBuffer>;
}
