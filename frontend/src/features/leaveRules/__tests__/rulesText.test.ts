import { describe, expect, it } from "vitest";
import { describeRules } from "../rulesText";

describe("describeRules", () => {
  it("says every rule in words, and that the year end leaves the type out until payroll processes it", () => {
    const lines = describeRules({ paid: false, entitlement: { kind: "CAP", period: "PER_REQUEST", days: "1.5" }, eligibility: { minServiceDays: 90, employmentTypes: ["PERMANENT", "CONTRACT"] }, units: "HALF_DAY", counting: "CALENDAR_DAYS", document: { required: true, whenMoreThanDays: 2 }, approvalRoute: "HR_ONLY", yearEnd: null });
    const text = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(text.Paid).toBe("Unpaid");
    expect(text.Entitlement).toContain("1.5 days in one request");
    expect(text.Eligibility).toBe("90 days after joining; Permanent, Contract");
    expect(text["Supporting document"]).toBe("Required for more than 2 day(s)");
    expect(text["Who decides"]).toBe("HR only");
    expect(text["Year end"]).toContain("left out of the year end");
  });
});
