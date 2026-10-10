import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Space } from "antd";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import * as biometricApi from "../../api/biometric";
import type { DeviceWarning } from "../../api/biometric";

// Device warnings worded for HR (Phase 2 P2-F, docs/plans/PHASE_2.md "P2-F
// build design"): a device clock beyond the threshold — "a drifting device
// clock silently corrupts attendance for everyone and nobody would think to
// look" (user, 2026-10-09) — a device not read for half or three quarters of
// its retention window, a nearly full log, and punches the server refused that
// an agent PC is holding (a quarantine nobody checks is data loss, only slower:
// user, 2026-10-10). Shown on Admin Home and the
// Devices screen; live (device.status). P2-H adds notifications and email.

const TITLES: Record<DeviceWarning["kind"], string> = {
  CLOCK_DRIFT: "Device clock is wrong",
  RETENTION_WARNING: "Device not read for a while",
  RETENTION_RISK: "Punches at risk of being overwritten",
  LOG_NEARLY_FULL: "Device log nearly full",
  BATCHES_SET_ASIDE: "Punches the server refused are waiting",
};

export function DeviceWarnings({ enabled = true, linkToDevices = false }: { enabled?: boolean; linkToDevices?: boolean }) {
  const navigate = useNavigate();
  const { data: warnings = [] } = useQuery({ queryKey: ["biometric", "device-warnings"], queryFn: biometricApi.listDeviceWarnings, enabled });
  if (!warnings.length) return null;
  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      {warnings.map((w) => (
        <Alert
          key={`${w.deviceId ?? w.agentId}-${w.kind}`}
          type={w.kind === "RETENTION_RISK" || w.kind === "CLOCK_DRIFT" || w.kind === "BATCHES_SET_ASIDE" ? "error" : "warning"}
          showIcon
          title={`${TITLES[w.kind]}: ${w.deviceName ?? w.agentName}`}
          description={
            <>
              {w.message}
              {w.reportAt && <span style={{ opacity: 0.7 }}> (as reported {dayjs(w.reportAt).format("D MMM, HH:mm")})</span>}
            </>
          }
          action={
            linkToDevices ? (
              <Button size="small" onClick={() => navigate("/admin/admin-tools/devices")}>
                Devices
              </Button>
            ) : undefined
          }
        />
      ))}
    </Space>
  );
}
