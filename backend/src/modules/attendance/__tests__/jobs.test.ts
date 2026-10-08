import { afterAll, describe, expect, it } from "vitest";
import { attendanceRecomputeQueue, closeAttendanceQueues } from "../../../jobs/attendanceQueues";
import { enqueueRecompute } from "../jobs";

// The live recompute path (docs/plans/PHASE_2.md §4.1): days become one
// debounced job per contiguous range per employee, each starting a day early
// (a punch may belong to the previous day's night shift).
describe("enqueueRecompute", () => {
  afterAll(async () => {
    await attendanceRecomputeQueue().obliterate({ force: true });
    await closeAttendanceQueues();
  });

  it("groups by employee into contiguous ranges, and a burst for the same range is one job", async () => {
    const q = attendanceRecomputeQueue();
    await q.obliterate({ force: true });
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    await enqueueRecompute([
      { employeeId: "e1", date: d("2026-09-14") },
      { employeeId: "e1", date: d("2026-09-15") },
      { employeeId: "e1", date: d("2026-09-17") },
      { employeeId: "e2", date: d("2026-09-14") },
    ]);
    await enqueueRecompute([{ employeeId: "e2", date: d("2026-09-14") }]); // a second punch moments later
    const jobs = await q.getJobs(["delayed", "waiting"]);
    expect(jobs.map((j) => j.data).sort((a, b) => `${a.employeeId}${a.from}`.localeCompare(`${b.employeeId}${b.from}`))).toEqual([
      { employeeId: "e1", from: "2026-09-13", to: "2026-09-15" },
      { employeeId: "e1", from: "2026-09-16", to: "2026-09-17" },
      { employeeId: "e2", from: "2026-09-13", to: "2026-09-14" },
    ]);
  });
});
