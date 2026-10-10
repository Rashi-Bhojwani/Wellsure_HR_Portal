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
// its retention window, and a nearly full log. Shown on Admin Home and the
// Devices screen; live (device.status). P2-H adds notifications and email.

const TITLES: Record<DeviceWarning["kind"], string> = {
  CLOCK_DRIFT: "Device clock is wrong",
  RETENTION_WARNING: "Device not read for a while",
  RETENTION_RISK: "Punches at risk of being overwritten",
  LOG_NEARLY_FULL: "Device log nearly full",
};

export function DeviceWarnings({ enabled = true, linkToDevices = false }: { enabled?: boolean; linkToDevices?: boolean }) {
  const navigate = useNavigate();
  const { data: warnings = [] } = useQuery({ queryKey: ["biometric", "device-warnings"], queryFn: biometricApi.listDeviceWarnings, enabled });
  if (!warnings.length) return null;
  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      {warnings.map((w) => (
        <Alert
          key={`${w.deviceId}-${w.kind}`}
          type={w.kind === "RETENTION_RISK" || w.kind === "CLOCK_DRIFT" ? "error" : "warning"}
          showIcon
          title={`${TITLES[w.kind]}: ${w.deviceName}`}
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
