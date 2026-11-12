import { z } from "zod";

// What each kind of document can suggest, who may review each field, and how a suggestion is checked. A suggestion is only a
// reading of the document: it is not a verified identity or verified bank ownership, and nothing here saves anything.
export const DOC_KINDS = ["RESUME", "IDENTITY", "BANK"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export type Authority = "RECRUITMENT" | "PERSONAL" | "STATUTORY" | "BANK";
export type FieldDef = { field: string; label: string; authority: Authority; pattern?: RegExp; check: z.ZodType<string> };

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/, IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const FIELDS: Record<DocKind, FieldDef[]> = {
  RESUME: [
    { field: "fullName", label: "Name", authority: "RECRUITMENT", check: z.string().trim().min(1).max(300) },
    { field: "email", label: "Email", authority: "RECRUITMENT", check: z.email().max(320) },
    { field: "phone", label: "Phone", authority: "RECRUITMENT", check: z.string().trim().regex(/^[+()\d -]{7,40}$/, "Enter a valid phone number.") },
  ],
  IDENTITY: [
    // For comparing the document with the person only; never saved anywhere.
    { field: "nameOnDocument", label: "Name on document (not saved)", authority: "PERSONAL", check: z.string().trim().min(1).max(150) },
    { field: "pan", label: "PAN", authority: "STATUTORY", check: z.string().trim().toUpperCase().regex(PAN, "Not a valid PAN format.") },
    { field: "aadhaar", label: "Aadhaar", authority: "STATUTORY", check: z.preprocess((v) => String(v).replace(/\s/g, ""), z.string().regex(/^\d{12}$/, "Aadhaar must be 12 digits.")) as unknown as z.ZodType<string> },
  ],
  BANK: [
    { field: "accountHolderName", label: "Account holder", authority: "BANK", check: z.string().trim().min(1).max(150) },
    { field: "accountNumber", label: "Account number", authority: "BANK", check: z.string().trim().regex(/^\d{6,20}$/, "Enter a valid account number.") },
    { field: "ifsc", label: "IFSC", authority: "BANK", check: z.string().trim().toUpperCase().regex(IFSC, "Not a valid IFSC format.") },
    { field: "bankName", label: "Bank", authority: "BANK", check: z.string().trim().min(1).max(150) },
    { field: "branchName", label: "Branch", authority: "BANK", check: z.string().trim().min(1).max(150) },
  ],
};
export const fieldDef = (kind: DocKind, field: string) => FIELDS[kind].find((f) => f.field === field);
export const SUBJECT_OF: Record<DocKind, "CANDIDATE" | "EMPLOYEE"> = { RESUME: "CANDIDATE", IDENTITY: "EMPLOYEE", BANK: "EMPLOYEE" };

export type Suggestion = { value: string | null; confidence: number; missing: boolean; error: string | null };
const after = (text: string, labels: RegExp) => text.split(/\r?\n/).map((l) => l.trim()).map((l) => l.match(labels)?.[1]?.trim()).find((v) => v && v.length > 0) ?? null;

/** Reads candidate values from plain text. Unparsed fields are "missing" (never guessed). */
export function parse(kind: DocKind, text: string, confidence: number): Record<string, Suggestion> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const raw: Record<string, string | null> = {};
  if (kind === "RESUME") {
    raw.fullName = after(text, /^name\s*[:-]\s*(.+)$/i) ?? (lines[0] && !/@|\d{5}/.test(lines[0]) ? lines[0] : null);
    raw.email = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? null;
    raw.phone = after(text, /^(?:phone|mobile|tel)\s*[:-]\s*([+()\d][\d ()+-]{6,})$/i) ?? text.match(/\+?\d[\d -]{8,14}\d/)?.[0] ?? null;
  } else if (kind === "IDENTITY") {
    raw.nameOnDocument = after(text, /^name\s*[:-]\s*(.+)$/i);
    raw.pan = text.toUpperCase().match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/)?.[0] ?? null;
    raw.aadhaar = text.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/)?.[0]?.replace(/\s/g, "") ?? null;
  } else {
    raw.accountHolderName = after(text, /^(?:account holder(?: name)?|name)\s*[:-]\s*(.+)$/i);
    raw.accountNumber = after(text, /^(?:account (?:number|no\.?)|a\/c(?: no\.?)?)\s*[:-]\s*([\d ]{6,24})$/i)?.replace(/\s/g, "") ?? null;
    raw.ifsc = text.toUpperCase().match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/)?.[0] ?? null;
    raw.bankName = after(text, /^bank(?: name)?\s*[:-]\s*(.+)$/i);
    raw.branchName = after(text, /^branch(?: name)?\s*[:-]\s*(.+)$/i);
  }
  const out: Record<string, Suggestion> = {};
  for (const def of FIELDS[kind]) {
    const v = raw[def.field] ?? null;
    if (!v) { out[def.field] = { value: null, confidence: 0, missing: true, error: null }; continue; }
    const checked = def.check.safeParse(v);
    out[def.field] = { value: checked.success ? checked.data : v, confidence: Math.round(confidence * (checked.success ? 1 : 0.5)), missing: false, error: checked.success ? null : (checked.error.issues[0]?.message ?? "Not valid") };
  }
  return out;
}
