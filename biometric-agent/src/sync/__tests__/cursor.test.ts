import { describe, expect, it } from "vitest";
import type { AttRecord } from "../../device/driver";
import { fingerprint, needsFullRead, newRecords, type Cursor } from "../cursor";

// The cursor (D-F2): a position plus a fingerprint, never a timestamp.
const r = (deviceUserId: string, localTime: string): AttRecord => ({ deviceUserId, localTime, status: "1", verifyMode: "255", workcode: "0" });
const log = [r("18", "2026-10-01 18:30:19"), r("44", "2026-10-01 18:30:38"), r("113", "2026-10-01 19:02:25"), r("113", "2026-10-01 19:02:28")];
const SYNC = "2026-10-01";
const at = (n: number): Cursor => ({ position: n, fingerprint: fingerprint(log[n - 1]!), syncFrom: SYNC });
const ids = (rs: AttRecord[]) => rs.map((x) => `${x.deviceUserId}@${x.localTime.slice(11)}`);

describe("which records are new", () => {
  it("first read: every record on or after the sync-from date, never one before it (D-F3)", () => {
    const withOld = [r("7", "2022-12-15 09:00:00"), r("8", "2026-09-30 23:59:59"), ...log];
    const { fresh, next, move } = newRecords(withOld, null, SYNC);
    expect(move).toBe("first");
    expect(ids(fresh)).toEqual(ids(log));
    expect(next).toEqual({ position: 6, fingerprint: fingerprint(log[3]!), syncFrom: SYNC });
  });

  it("append: only what came after the remembered record", () => {
    const { fresh, move } = newRecords(log, at(2), SYNC);
    expect(move).toBe("append");
    expect(ids(fresh)).toEqual(["113@19:02:25", "113@19:02:28"]);
    expect(newRecords(log, at(4), SYNC).fresh).toEqual([]);
  });

  it("a clock corrected BACKWARDS: the new punch has an earlier time than the last one sent, and is still sent", () => {
    const after = [...log, r("44", "2026-10-01 17:55:00")]; // someone set the device clock back an hour
    const { fresh, move } = newRecords(after, at(4), SYNC);
    expect(move).toBe("append");
    expect(ids(fresh)).toEqual(["44@17:55:00"]); // a timestamp cursor would have skipped it
  });

  it("the log was cleared and refilled: the remembered record is gone, so everything is sent again (the server drops duplicates)", () => {
    const cleared = [r("90", "2026-10-02 10:00:00")];
    const { fresh, move } = newRecords(cleared, at(4), SYNC);
    expect(move).toBe("lost");
    expect(ids(fresh)).toEqual(["90@10:00:00"]);
  });

  it("the log wrapped when full (oldest overwritten): found further back, only what's after it", () => {
    const wrapped = [...log.slice(2), r("5", "2026-10-02 09:00:00"), r("6", "2026-10-02 09:01:00")]; // two oldest gone, two new
    const { fresh, move } = newRecords(wrapped, at(4), SYNC);
    expect(move).toBe("relocated");
    expect(ids(fresh)).toEqual(["5@09:00:00", "6@09:01:00"]);
  });

  it("an empty log last time: everything now is new", () => {
    const empty: Cursor = { position: 0, fingerprint: null, syncFrom: SYNC };
    expect(newRecords(log, empty, SYNC)).toMatchObject({ move: "append" });
    expect(newRecords(log, empty, SYNC).fresh).toHaveLength(4);
  });

  it("the sync-from date moved earlier: the whole log again, from the new date (resync)", () => {
    const withOld = [r("8", "2026-09-30 10:00:00"), ...log];
    const { fresh, move, next } = newRecords(withOld, { ...at(4), position: 5, fingerprint: fingerprint(log[3]!) }, "2026-09-30");
    expect(move).toBe("resync");
    expect(fresh).toHaveLength(5);
    expect(next.syncFrom).toBe("2026-09-30");
  });
});

describe("cheap polling: the whole log is read only when needed", () => {
  it("not when the count is where the cursor is", () => {
    expect(needsFullRead({ logCount: 4, logCapacity: 100_000 }, at(4), SYNC)).toBe(false);
  });
  it("when the count moved, the log is full, there's no cursor, the count is unknown, or the sync-from date changed", () => {
    expect(needsFullRead({ logCount: 5, logCapacity: 100_000 }, at(4), SYNC)).toBe(true);
    expect(needsFullRead({ logCount: 3, logCapacity: 100_000 }, at(4), SYNC)).toBe(true);
    expect(needsFullRead({ logCount: 4, logCapacity: 4 }, at(4), SYNC)).toBe(true); // full: it may have wrapped
    expect(needsFullRead({ logCount: 4, logCapacity: 100_000 }, null, SYNC)).toBe(true);
    expect(needsFullRead({ logCount: null, logCapacity: null }, at(4), SYNC)).toBe(true);
    expect(needsFullRead({ logCount: 4, logCapacity: 100_000 }, at(4), "2026-09-01")).toBe(true);
  });
});
