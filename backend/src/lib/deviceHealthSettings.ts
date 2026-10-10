import { DEFAULT_DEVICE_HEALTH_THRESHOLDS, type DeviceHealthThresholds } from "@shared/attendance/agentProtocol";
import { getSetting } from "./settings";

// System Settings → Attendance → Device health (Phase 2 P2-F,
// docs/plans/PHASE_2.md "P2-F build design"). Read here by the biometric
// module (and sent to every sync agent in its heartbeat reply); written only
// by modules/settings. P2-H adds its silence and morning-check values to the
// same card.
export const DEVICE_HEALTH_SETTING_KEY = "attendance.deviceHealth";

export async function getDeviceHealthThresholds(): Promise<DeviceHealthThresholds> {
  const stored = await getSetting<Partial<DeviceHealthThresholds>>(DEVICE_HEALTH_SETTING_KEY, DEFAULT_DEVICE_HEALTH_THRESHOLDS);
  // A partial row (an older shape) falls back field by field, never to nothing.
  return { ...DEFAULT_DEVICE_HEALTH_THRESHOLDS, ...stored };
}
