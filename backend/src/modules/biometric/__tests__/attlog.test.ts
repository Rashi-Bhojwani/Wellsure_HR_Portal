import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAttlogLine, instantToLocalTime, localTimeToInstant, parseAttlog, zoneOffsetMinutes } from "@shared/attendance/attlog";

// The confirmed ATTLOG format (spec §4.1). The user-supplied sample from our
// device — users 18, 44 and 113, with 113's two punches three seconds apart —
// is a mandatory fixture (docs/plans/PHASE_2.md §3).
const SAMPLE = readFileSync(path.join(__dirname, "fixtures/sample-attlog.txt"), "utf8");

describe("ATTLOG parser", () => {
  it("reads the real sample exactly, keeping 113's two punches three seconds apart as two lines", () => {
    const { lines, rejected } = parseAttlog(SAMPLE);
    expect(rejected).toEqual([]);
    expect(lines.map((l) => [l.deviceUserId, l.localTime, l.status, l.verifyMode, l.workcode, l.reserved])).toEqual([
      ["18", "2021-09-01 18:30:19", "1", "255", "1", "0"],
      ["44", "2021-09-01 18:30:38", "1", "255", "1", "0"],
      ["113", "2021-09-01 19:02:25", "1", "255", "1", "0"],
      ["113", "2021-09-01 19:02:28", "1", "255", "1", "0"],
    ]);
    expect(lines[0]!.raw).toBe("18\t2021-09-01 18:30:19\t1\t255\t1\t0");
  });

  it("tolerates surrounding whitespace, CRLF, extra trailing columns and missing optional ones", () => {
    const { lines, rejected } = parseAttlog("  18\t2021-09-01 18:30:19\t1\t255\t1\t0\t7\tx  \r\n\n44\t2021-09-01 18:30:38\r\n");
    expect(rejected).toEqual([]);
    expect(lines.map((l) => [l.deviceUserId, l.localTime, l.status])).toEqual([
      ["18", "2021-09-01 18:30:19", "1"],
      ["44", "2021-09-01 18:30:38", ""],
    ]);
  });

  it("rejects a bad line on its own, verbatim, with its line number — never the batch", () => {
    const { lines, rejected } = parseAttlog("18\t2021-09-01 18:30:19\t1\t255\t1\t0\ngarbage\n44\t2021-02-30 10:00:00\t1\n113 2021-09-01 19:02:25\n9\t2021-09-01 25:00:00");
    expect(lines.map((l) => l.deviceUserId)).toEqual(["18"]);
    expect(rejected.map((r) => [r.lineNumber, r.raw])).toEqual([
      [2, "garbage"],
      [3, "44\t2021-02-30 10:00:00\t1"],
      [4, "113 2021-09-01 19:02:25"],
      [5, "9\t2021-09-01 25:00:00"],
    ]);
    expect(rejected.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("formats lines exactly as the device does (the simulator writes these)", () => {
    expect(formatAttlogLine({ deviceUserId: "113", localTime: "2021-09-01 19:02:25" })).toBe("113\t2021-09-01 19:02:25\t1\t255\t1\t0");
    expect(parseAttlog(SAMPLE).lines.map((l) => formatAttlogLine(l)).join("\n") + "\n").toBe(SAMPLE);
  });
});

describe("device-local time", () => {
  it("Asia/Kolkata is UTC+5:30: 18:30:19 IST is 13:00:19Z, and back", () => {
    const t = localTimeToInstant("2021-09-01 18:30:19", "Asia/Kolkata");
    expect(t.toISOString()).toBe("2021-09-01T13:00:19.000Z");
    expect(instantToLocalTime(t, "Asia/Kolkata")).toBe("2021-09-01 18:30:19");
    expect(zoneOffsetMinutes("Asia/Kolkata", t)).toBe(330);
  });

  it("a punch just after local midnight belongs to the local date, not the UTC one", () => {
    expect(localTimeToInstant("2021-09-02 00:10:00", "Asia/Kolkata").toISOString()).toBe("2021-09-01T18:40:00.000Z");
  });

  it("follows a zone with daylight saving (a device configured elsewhere)", () => {
    expect(localTimeToInstant("2021-07-01 09:00:00", "Europe/London").toISOString()).toBe("2021-07-01T08:00:00.000Z");
    expect(localTimeToInstant("2021-12-01 09:00:00", "Europe/London").toISOString()).toBe("2021-12-01T09:00:00.000Z");
  });
});
