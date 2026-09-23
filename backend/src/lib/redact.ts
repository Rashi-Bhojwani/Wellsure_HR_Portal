// Shared redaction for anything persisted as JSON that might carry a
// sensitive raw value in the clear — audit_logs.before/after and
// profile_change_requests.changes_json (spec §9). Applied automatically by
// writeAuditLog() (see audit.ts) and by the profile-change-request service,
// so no call site can forget to redact before a write.

const REDACTED_KEYS = new Set(["accountNumber", "pan", "panNumber", "aadhaar", "aadhaarNumber", "uan", "uanNumber"]);

function maskLast4(value: string): string {
  const digits = value.replace(/\s/g, "");
  return digits.length <= 4 ? "••••" : `••••${digits.slice(-4)}`;
}

export function redact<T>(value: T): T {
  if (value === null || typeof value !== "object") {
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
