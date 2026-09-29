// The clean seam Phase 2/3's attendance regularization work plugs into —
// same shape as modules/leave/attendanceIntegration.ts's AttendanceLeaveSink
// from Phase 4. "My Tasks"/Request Hub need a real, wired query for
// regularization counts *today*, one that legitimately returns zero
// (an ordinary empty state) until Phase 2/3 supplies a real
// implementation — never a fake "coming soon" placeholder.
export interface RegularizationTaskCounts {
  review: number; // pending regularization requests within the viewer's own approval scope
  monitor: number; // pending regularization requests org-wide the viewer can see but isn't the approver for
}

export interface RegularizationRequestSink {
  getPendingCounts(viewerEmployeeId: string, roleCodes: string[]): Promise<RegularizationTaskCounts>;
}

export class NoopRegularizationRequestSink implements RegularizationRequestSink {
  async getPendingCounts(): Promise<RegularizationTaskCounts> {
    return { review: 0, monitor: 0 };
  }
}

let sink: RegularizationRequestSink = new NoopRegularizationRequestSink();

export function getRegularizationRequestSink(): RegularizationRequestSink {
  return sink;
}

// Called by Phase 2/3 once a real attendance-regularization module
// exists. Exported mainly for tests to install a fake.
export function setRegularizationRequestSink(newSink: RegularizationRequestSink): void {
  sink = newSink;
}
