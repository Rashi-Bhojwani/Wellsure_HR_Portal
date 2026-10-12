import { getSetting } from "./settings";

// System Settings → Attendance → Device alerts (Phase 2 P2-H, docs/plans/PHASE_2.md
// "P2-H build design"): when a silent device or agent becomes an incident, who is
// told, and the morning check. Read by the health check every run (so a change
// applies at the next check), written only by modules/settings. Kept apart from
// the device-health thresholds because those are sent to every sync agent and
// these are the server's alone.
export const DEVICE_ALERT_SETTING_KEY = "attendance.deviceAlerts";

export interface DeviceAlertSettings {
  /** No successful contact with a device for this long, during its working hours, opens an incident. */
  deviceSilentMinutes: number;
  /** A sync agent's heartbeat missing for this long opens one. */
  agentSilentMinutes: number;
  /** The morning check ("reachable, people expected, but no punch today"), IST "HH:MM". It runs at the later of this and the window start plus the silence minutes. */
  morningCheckTime: string;
  /** Email addresses told in addition to the people who hold attendance.devices.manage. */
  alertEmails: string[];
  /** Also email every active Super Admin (resolved when an alert is sent, so it stays right when Super Admins change). */
  alertSuperAdmins: boolean;
  /** How long after an incident closes the recovery notice waits, so a catching-up agent's backlog lands first and the notice can say how many punches arrived. */
  recoverySettleSeconds: number;
}

export const DEFAULT_DEVICE_ALERT_SETTINGS: DeviceAlertSettings = {
  deviceSilentMinutes: 30,
  agentSilentMinutes: 5,
  morningCheckTime: "10:30",
  alertEmails: [],
  alertSuperAdmins: true,
  recoverySettleSeconds: 120,
};

export async function getDeviceAlertSettings(): Promise<DeviceAlertSettings> {
  const stored = await getSetting<Partial<DeviceAlertSettings>>(DEVICE_ALERT_SETTING_KEY, DEFAULT_DEVICE_ALERT_SETTINGS);
  // A partial row (an older shape) falls back field by field, never to nothing.
  return { ...DEFAULT_DEVICE_ALERT_SETTINGS, ...stored };
}
