// Shared redaction for anything persisted as JSON that might carry a
// sensitive raw value in the clear — audit_logs.before/after and
// profile_change_requests.changes_json (spec §9). Applied automatically by
// writeAuditLog() (see audit.ts) and by the profile-change-request service,
// so no call site can forget to redact before a write.

const REDACTED_KEYS = new Set([
  "accountNumber",
  "accountNumberConfirm",
  "pan",
  "panNumber",
  "aadhaar",
  "aadhaarNumber",
  "uan",
  "uanNumber",
  "esiNumber",
  // The owners' secrets (docs/plans/PHASE_6.md §14J): a typed debit account, the sealed form of a value, the retyped value of a confirmation.
  "debitAccountNumber",
  "debitAccountEnc",
  "sealed",
  "typedValue",
]);

function maskLast4(value: string): string {
  const digits = value.replace(/\s/g, "");
  return digits.length <= 4 ? "••••" : `••••${digits.slice(-4)}`;
}

const isPlain = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

export function redact<T>(value: T): T {
  // Only plain objects and arrays are walked. A Date, a Decimal, a Buffer or a class instance is left as it is (copying one key by key would turn it into an empty object).
  if (value === null || typeof value !== "object" || (!Array.isArray(value) && !isPlain(value))) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key) && typeof val === "string") {
      result[key] = maskLast4(val);
    } else if (val !== null && typeof val === "object") {
      result[key] = redact(val);
    } else {
      result[key] = val;
    }
  }
  return result as T;
}

// Free text is scrubbed by pattern, as a second line behind the key-based redaction above: an error message or a stack trace can carry a value that was never in a field called
// "pan" (a database error that quotes the row, a library that prints its input). Used on everything the logger prints about an error and on the text of a 500 response.
// A run of 9 to 18 digits (a bank account, an Aadhaar, a UAN), a PAN-shaped word, and the same with spaces or dashes between the groups.
const SCRUBBERS: Array<[RegExp, string]> = [
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN removed]"],
  [/\b\d{4}[ -]\d{4}[ -]\d{4}\b/g, "[number removed]"],
  [/\b\d{9,18}\b/g, "[number removed]"],
];

export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SCRUBBERS) out = out.replace(pattern, replacement);
  return out;
}
