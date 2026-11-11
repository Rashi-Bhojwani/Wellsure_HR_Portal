import { describe, expect, it } from "vitest";
import { lastFinishedQuarter } from "../quarter";

// Quarterly TDS data opens on the last quarter that has ended (found in the 2026-11-11 walk: it opened on last year's first quarter, which looked empty).
describe("lastFinishedQuarter", () => {
  it("April–June is quarter 1; in quarter 1 it looks back to the year before's quarter 4; on a quarter's first day that quarter has not ended", () => {
    expect(lastFinishedQuarter("2026-11-11")).toEqual({ fy: "2026-27", quarter: 2 });
    expect(lastFinishedQuarter("2026-10-01")).toEqual({ fy: "2026-27", quarter: 2 });
    expect(lastFinishedQuarter("2027-01-15")).toEqual({ fy: "2026-27", quarter: 3 });
    expect(lastFinishedQuarter("2027-03-31")).toEqual({ fy: "2026-27", quarter: 3 });
    expect(lastFinishedQuarter("2026-04-02")).toEqual({ fy: "2025-26", quarter: 4 });
    expect(lastFinishedQuarter("2026-07-01")).toEqual({ fy: "2026-27", quarter: 1 });
  });
});
