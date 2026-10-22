import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { redact, scrubText } from "../redact";

describe("redaction of structured values and of free text", () => {
  it("masks every sensitive key wherever it sits, and leaves dates and other objects alone", () => {
    const when = new Date("2026-10-22T10:00:00Z");
    const out = redact({ a: { accountNumber: "123456789012", pan: "ABCDE1234F", sealed: "aGVsbG8gd29ybGQ=", debitAccountNumber: "000111222333444" }, list: [{ uan: "100200300400" }], when, ok: "kept" });
    expect(JSON.stringify(out)).not.toMatch(/123456789012|ABCDE1234F|aGVsbG8|000111222333444|100200300400/);
    expect(out.when).toBe(when);
    expect(out.ok).toBe("kept");
  });

  it("scrubs an account-like number, an Aadhaar-like number and a PAN-shaped word out of free text", () => {
    const text = 'insert failed: Key (account_number)=(123456789012345) PAN ABCDE1234F aadhaar 1234 5678 9012 and 2345-6789-0123, id=42, at 1700000000';
    const out = scrubText(text);
    expect(out).not.toMatch(/123456789012345|ABCDE1234F|1234 5678 9012|2345-6789-0123/);
    expect(out).toContain("id=42");
  });

  it("the logger never prints a sensitive key, or the account number inside an error's message or stack", async () => {
    const { SAFE_LOG_OPTIONS } = await import("../logger");
    const lines: string[] = [];
    const sink = new Writable({ write: (chunk, _e, cb) => (lines.push(String(chunk)), cb()) });
    const log = pino(SAFE_LOG_OPTIONS, sink);
    log.info({ body: { accountNumber: "998877665544", note: "x" } }, "request");
    log.error({ err: new Error("duplicate key value violates unique constraint, Key (account_number)=(776655443322) for ABCDE1234F") }, "failed");
    const printed = lines.join("");
    expect(printed).not.toMatch(/998877665544|776655443322|ABCDE1234F/);
    expect(printed).toContain("duplicate key value");
  });
});
