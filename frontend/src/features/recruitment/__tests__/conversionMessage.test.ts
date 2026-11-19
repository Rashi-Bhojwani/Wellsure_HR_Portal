import { describe, expect, it } from "vitest";
import { conversionMessage, type ConversionResult } from "../offersApi";

// Final merge: after converting a joiner, the screen says what HR's Add Employee says — the account is Invited, its login ID is the employee
// number, and what happened to the setup link. It never shows a password or a link.
const base: ConversionResult = { employeeId: "e1", employeeCode: "DEMO123", created: true, accountStatus: "INVITED", invitation: { status: "SENT" } };

describe("conversionMessage", () => {
  it("says the account is invited, with the employee number as login ID, and whether the setup link went out", () => {
    expect(conversionMessage(base)).toBe("Employee DEMO123 created. Account invited: they sign in with DEMO123. The setup link was emailed to their personal address.");
    expect(conversionMessage({ ...base, invitation: { status: "FILE_ONLY" } })).toMatch(/Nothing was emailed \(development mode\)/);
    expect(conversionMessage({ ...base, invitation: { status: "FAILED", error: "The mail guard refused this message" } })).toMatch(/could not be sent \(The mail guard refused this message\)\. Send it again from their profile\./);
    expect(conversionMessage({ ...base, created: false, invitation: { status: "NOT_SENT" } })).toMatch(/^Already converted: DEMO123\. .*No setup link has been sent yet/);
  });
  it("an active account (set up already) is said so; nothing ever carries a password or link", () => {
    expect(conversionMessage({ ...base, created: false, accountStatus: "ACTIVE", invitation: null })).toBe("Already converted: DEMO123. Their account is active.");
    for (const s of ["SENT", "FILE_ONLY", "FAILED", "NOT_SENT"] as const) expect(conversionMessage({ ...base, invitation: { status: s } })).not.toMatch(/password|http|token/i);
  });
});
