import { setRegularizationRequestSink } from "../admin/regularizationIntegration";
import { setAttendanceLeaveSink } from "../leave/attendanceIntegration";
import { enqueueRecompute, enqueueRecomputeDates } from "./jobs";
import { EngineAttendanceLeaveSink } from "./leaveSink";
import { setRecomputeDatesHandler, setRecomputeHandler } from "./recompute";
import { EngineRegularizationSink } from "./regularization/sink";

// Plugs the rules engine into its seams at process start (api and worker):
// new data (punches, mappings, leave, holidays, assignments) asks for a
// recompute, which becomes a debounced attendance-recompute job.
export function registerAttendanceEngine(): void {
  setRecomputeHandler(enqueueRecompute);
  setRecomputeDatesHandler(enqueueRecomputeDates);
  setAttendanceLeaveSink(new EngineAttendanceLeaveSink());
  setRegularizationRequestSink(new EngineRegularizationSink());
}
