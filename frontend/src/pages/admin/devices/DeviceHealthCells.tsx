import type { ReactNode } from "react";
import { Tooltip } from "antd";
import type { DeviceRow, HealthStatus } from "../../../api/biometric";
import { fs, v } from "../../../theme/tokens";
import { StatusChip } from "../../../ui";
import { HEALTH, REPORT_STATE, when } from "./deviceLabels";

const Muted = ({ children }: { children: ReactNode }) => <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{children}</span>;

/** Health at a glance (P2-H), always a word with its explanation on hover and focus. */
export function HealthChip({ status }: { status: HealthStatus | null }) {
  if (!status) return <Muted>—</Muted>;
  const t = HEALTH[status];
  return (
    <Tooltip title={t.tip}>
      <span tabIndex={0} aria-label={`${t.label}: ${t.tip}`}>
        <StatusChip tone={t.tone}>{t.label}</StatusChip>
      </span>
    </Tooltip>
  );
}

/** What the sync agent last said about the device (P2-F). */
export function AgentReportCell({ d }: { d: DeviceRow }) {
  if (d.route !== "AGENT") return <Muted>—</Muted>;
  const h = d.health;
  if (h.notConfiguredOnAgent) {
    return (
      <Tooltip title="The agent reported in but didn't mention this device: it isn't in that PC's config.json.">
        <span tabIndex={0}>
          <StatusChip tone="warning">Not configured on the agent PC</StatusChip>
        </span>
      </Tooltip>
    );
  }
  if (!h.report) return <Muted>No report yet</Muted>;
  const tag = REPORT_STATE[h.report.state ?? ""] ?? { tone: "neutral" as const, label: h.report.state ?? "?" };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <Tooltip title={h.report.lastError ?? undefined}>
        <span tabIndex={h.report.lastError ? 0 : undefined}>
          <StatusChip tone={tag.tone}>{tag.label}</StatusChip>
        </span>
      </Tooltip>
      <Muted>last read {when(h.lastReadAt)}</Muted>
    </span>
  );
}

export function ClockCell({ d }: { d: DeviceRow }) {
  const c = d.health.clockDrift;
  if (!c) return <Muted>—</Muted>;
  return c.exceeded ? (
    <Tooltip title="Beyond the threshold (System Settings → Attendance → Device health). Set the clock from the device's own menu; the system never changes it.">
      <span tabIndex={0}>
        <StatusChip tone="danger">{c.text}</StatusChip>
      </span>
    </Tooltip>
  ) : (
    <span>{c.text}</span>
  );
}

export function RetentionCell({ d }: { d: DeviceRow }) {
  const r = d.health.retention;
  if (!r) return <Muted>—</Muted>;
  const tone = r.state === "RISK" ? "danger" : r.state === "WARNING" ? "warning" : "success";
  const gap = r.gapHours === null ? "not read yet" : r.gapHours < 1 ? "read within the hour" : `${Math.round(r.gapHours)} h since a read`;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <Tooltip title={`Log assumed to hold ${Math.round(r.windowHours / 24)} days. Warning at half, alarm at three quarters.`}>
        <span tabIndex={0}>
          <StatusChip tone={tone}>{r.state === "OK" ? "OK" : r.state === "RISK" ? "At risk" : "Warning"}</StatusChip>
        </span>
      </Tooltip>
      <Muted>{gap}</Muted>
      {r.logFullPercent !== null && (
        <span style={{ color: r.logNearlyFull ? v.danger : v.textSecondary, fontSize: fs.sm }}>
          log {d.health.report?.logCount ?? "?"} / {r.capacityUsed ?? "?"} ({r.logFullPercent}%)
        </span>
      )}
    </span>
  );
}
