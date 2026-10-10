import type { AttRecord } from "../device/driver";
import type { DeviceInfo } from "../device/driver";

// The cursor (D-F2, docs/plans/PHASE_2.md "P2-F build design"): how far into
// the device's log the agent has taken records — a position plus a
// fingerprint of the record at it — NEVER a timestamp. Someone correcting the
// device clock backwards would make a timestamp cursor skip a week of new
// punches, silently. Tied to the sync-from date it was built for: moving that
// date (D-F3) starts again from the whole log.

export interface Cursor {
  /** How many records the log held when the agent last took from it. */
  position: number;
  /** The last of them (null when the log was empty). */
  fingerprint: string | null;
  /** The sync-from date this cursor was built under. */
  syncFrom: string;
}

export type CursorMove = "first" | "resync" | "append" | "relocated" | "lost";

export const fingerprint = (r: AttRecord): string => `${r.deviceUserId}|${r.localTime}|${r.status}|${r.verifyMode}`;

/** Records dated before the sync-from date are never sent (D-F3). */
const onOrAfter = (syncFrom: string) => (r: AttRecord) => r.localTime.slice(0, 10) >= syncFrom;

/**
 * Which of `records` (the whole log, oldest first) are new since `cursor`.
 * - append: the remembered record is still where it was — everything after it;
 * - relocated: it moved (the log was cleared and refilled, or wrapped when
 *   full) — everything after where it is now;
 * - lost: it's gone — every record is sent again, and the server's
 *   exact-duplicate key drops the ones it has;
 * - first / resync: no cursor yet, or the sync-from date changed.
 */
export function newRecords(records: AttRecord[], cursor: Cursor | null, syncFrom: string): { fresh: AttRecord[]; next: Cursor; move: CursorMove } {
  const next: Cursor = { position: records.length, fingerprint: records.length ? fingerprint(records[records.length - 1]!) : null, syncFrom };
  const keep = onOrAfter(syncFrom);
  if (!cursor || cursor.syncFrom !== syncFrom) return { fresh: records.filter(keep), next, move: cursor ? "resync" : "first" };
  const p = cursor.position;
  const stillThere = p <= records.length && (p === 0 ? cursor.fingerprint === null : fingerprint(records[p - 1]!) === cursor.fingerprint);
  if (stillThere) return { fresh: records.slice(p).filter(keep), next, move: "append" };
  if (cursor.fingerprint !== null) {
    for (let i = records.length - 1; i >= 0; i--) {
      if (fingerprint(records[i]!) === cursor.fingerprint) return { fresh: records.slice(i + 1).filter(keep), next, move: "relocated" };
    }
  }
  return { fresh: records.filter(keep), next, move: "lost" };
}

/**
 * Cheap polling: the record count comes first (one small command). The whole
 * log is read only when the count moved, the log is full (a wrapping log
 * changes without its count changing), there's no cursor, or the sync-from
 * date changed.
 */
export function needsFullRead(info: Pick<DeviceInfo, "logCount" | "logCapacity">, cursor: Cursor | null, syncFrom: string): boolean {
  if (!cursor || cursor.syncFrom !== syncFrom) return true;
  if (info.logCount === null) return true;
  if (info.logCapacity && info.logCount >= info.logCapacity) return true;
  return info.logCount !== cursor.position;
}
