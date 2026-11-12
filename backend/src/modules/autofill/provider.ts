import path from "node:path";
import { createRequire } from "node:module";

// Document autofill (Peeps stage 2): the provider adapter. A provider turns a validated document into plain text plus a confidence;
// it never sees who the document belongs to and never stores anything. The only provider built is LOCAL: it runs inside our own
// process (pdf.js for PDFs with a text layer, tesseract.js with the bundled English model for images), so no document leaves the
// system. A cloud provider is not chosen and not built; it needs owner approval.
export type ExtractionFailure = "PASSWORD_PROTECTED" | "POOR_QUALITY" | "UNSUPPORTED" | "TIMEOUT" | "EMPTY";
export class ExtractionError extends Error {
  constructor(public readonly code: ExtractionFailure, message: string) { super(message); }
}
export interface ExtractionProvider {
  readonly name: string;
  readonly version: string;
  /** Plain text and a 0–100 confidence. Throws ExtractionError for documents that cannot be read. */
  extract(input: { buffer: Buffer; mimeType: string; timeoutMs: number }): Promise<{ text: string; confidence: number; engine: string }>;
}

const require_ = createRequire(import.meta.url);
const MIN_CONFIDENCE = 60; // technical quality floor for OCR text; below it the result is treated as unreadable
const MIN_TEXT = 8;

async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => { onTimeout(); reject(new ExtractionError("TIMEOUT", "Reading the document took too long.")); }, ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const parts: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        line += item.str ?? "";
        if (item.hasEOL) { parts.push(line); line = ""; }
      }
      if (line) parts.push(line);
    }
    await doc.cleanup?.();
    return parts.join("\n");
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") throw new ExtractionError("PASSWORD_PROTECTED", "The PDF is password-protected. Enter the details by hand, or upload an unprotected copy.");
    if (name === "InvalidPDFException" || name === "FormatError") throw new ExtractionError("UNSUPPORTED", "The PDF could not be read.");
    throw error;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

async function imageText(buffer: Buffer, timeoutMs: number) {
  const { createWorker } = await import("tesseract.js");
  const langPath = path.join(path.dirname(require_.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
  const worker = await createWorker("eng", 1, { langPath, gzip: true, cacheMethod: "none", logger: () => undefined, errorHandler: () => undefined });
  try {
    const r = await withTimeout(worker.recognize(buffer), timeoutMs, () => void worker.terminate());
    return { text: r.data.text, confidence: r.data.confidence };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export const localProvider: ExtractionProvider = {
  name: "LOCAL",
  version: "pdfjs-6+tesseract-7-eng-best-int",
  async extract({ buffer, mimeType, timeoutMs }) {
    if (mimeType === "application/pdf") {
      const text = await withTimeout(pdfText(buffer), timeoutMs, () => undefined);
      if (text.replace(/\s/g, "").length < MIN_TEXT) throw new ExtractionError("POOR_QUALITY", "The PDF has no readable text layer (it may be a scan). Upload a clear photo or enter the details by hand.");
      return { text, confidence: 99, engine: "pdfjs-text-layer" };
    }
    if (mimeType === "image/png" || mimeType === "image/jpeg") {
      const { text, confidence } = await imageText(buffer, timeoutMs);
      if (text.replace(/\s/g, "").length < MIN_TEXT || confidence < MIN_CONFIDENCE) throw new ExtractionError("POOR_QUALITY", "The image is too unclear to read. Upload a sharper photo or enter the details by hand.");
      return { text, confidence, engine: "tesseract-eng" };
    }
    throw new ExtractionError("UNSUPPORTED", "This file type cannot be read automatically. Enter the details by hand.");
  },
};
