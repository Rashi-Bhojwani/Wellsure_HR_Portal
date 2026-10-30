import { useState, type ReactNode } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Tooltip, Typography } from "antd";
import { CloseOutlined, EditOutlined, LockOutlined } from "@ant-design/icons";
import * as infoApi from "../../api/attendanceInfo";
import type { DayDetail } from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";
import { hoursLabel } from "../../pages/admin/attendance/settings/format";
import { useAuth } from "../../hooks/useAuth";
import { ApprovalBanner, EmptyState, KeyValueGrid, Panel, Skel, StatusChip, toast } from "../../ui";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { CorrectionModal } from "./CorrectionModal";
import { ManualOverrideModal } from "./ManualOverrideModal";
import { statusTone } from "./statusTone";

const { Text } = Typography;

const minutes = (m: number | null | undefined) => (m === null || m === undefined ? "—" : m === 0 ? "0" : hoursLabel(m));

const FLAG_TEXT: Record<string, string> = {
  MISSING_PUNCH: "Only one punch was recorded, so the day can't be worked out: absent until the missing time is added.",
  HALF_DAY_MIN_NOT_MET: "Less than the half-day minimum hours were worked.",
  SHORTFALL: "Fewer hours than the shift were worked.",
  LATE_IN: "Arrived after the shift start (no penalty: lateness is recorded only).",
  EARLY_OUT: "Left before the shift end (recorded only).",
  NO_SHIFT: "No shift was assigned for this day.",
  CLOCK_FLAGGED: "A punch with an implausible time is waiting for HR's decision.",
};
const SOURCE_TEXT: Record<string, string> = { DEVICE: "Biometric device", MANUAL: "Marked by hand", LEAVE: "Approved leave", HOLIDAY: "Holiday", WEEK_OFF: "Week-off", OVERRIDE: "Corrected by hand (not from the device)" };
const ROLE_TEXT: Record<string, string> = {
  FIRST_IN: "first in",
  LAST_OUT: "last out",
  ONLY: "the only punch",
  BETWEEN: "in between (not used)",
  DUPLICATE: "near-duplicate (counted once)",
  FLAGGED: "waiting for HR (implausible time)",
  DISCARDED: "discarded by HR",
  NOT_USED: "not used for this day",
};

/** One day of Attendance Info (Phase 2 P2-E): times, shift, status, raw punches, and the correction request (Phase 3). */
export function DayPanel({ employeeId, date, self, onClose }: { employeeId?: string; date: string; self: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const { hasPermission } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["attendance", "info", "day", employeeId ?? "me", date],
    queryFn: () => (self ? infoApi.myDay(date) : infoApi.employeeDay(employeeId!, date)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => infoApi.cancelRegularization(id),
    onSuccess: () => {
      toast.success("Request cancelled.");
      void queryClient.invalidateQueries({ queryKey: ["attendance", "info"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not cancel.")),
  });
  const title = dayjs(date).format("ddd, D MMM YYYY");
  return (
    <Panel
      title={title}
      subtitle={data?.employed && data.code ? statusTone(data.code).label : undefined}
      extra={
        <>
          {!self && employeeId && data?.employed && hasPermission("attendance.override.manage") && (
            <Button icon={<EditOutlined />} onClick={() => setOverriding(true)}>
              Set this day
            </Button>
          )}
          <Tooltip title="Hide day">
            <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="Hide day" />
          </Tooltip>
        </>
      }
    >
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }} aria-busy>
          <Skel h={64} r={radius.md} />
          <Skel w="70%" />
          <Skel w="55%" />
          <Skel h={120} r={radius.md} />
        </div>
      ) : error && !data ? (
        <EmptyState kind="error" compact title="Could not load this day" description={apiErrorMessage(error, "Try again.")} onRetry={() => void refetch()} />
      ) : !data ? null : !data.employed ? (
        <EmptyState kind="empty" compact title="Not employed on this day." description={null} />
      ) : (
        <DayBody data={data} self={self} onAsk={() => setAsking(true)} onCancel={(id) => cancel.mutate(id)} cancelling={cancel.isPending} />
      )}
      {employeeId && <ManualOverrideModal target={overriding ? { employeeId, name: data?.employeeName ?? "this employee", date } : null} onClose={() => setOverriding(false)} />}
      {data?.canRequest?.ok && <CorrectionModal date={date} day={data.canRequest.day} open={asking} onClose={() => setAsking(false)} />}
    </Panel>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 style={{ margin: `0 0 ${space[3]}px`, fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary }}>{title}</h3>
      {children}
    </section>
  );
}

function DayBody({ data, self, onAsk, onCancel, cancelling }: { data: DayDetail; self: boolean; onAsk: () => void; onCancel: (id: string) => void; cancelling: boolean }) {
  const t = data.times!;
  const pending = data.requests?.find((r) => r.status === "PENDING");
  const exceptions = (data.flags ?? []).filter((f) => f !== "LATE_IN" && f !== "EARLY_OUT");
  const tone = statusTone(data.code);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
      {exceptions.map((f) => (
        <ApprovalBanner key={f} tone="warning" title={FLAG_TEXT[f] ?? f} description={f === "MISSING_PUNCH" && data.lopDays ? `${data.lopDays} day(s) of LOP until it's corrected.` : undefined} />
      ))}
      {data.override && (
        <ApprovalBanner
          tone="success"
          icon={<EditOutlined />}
          title={`${data.override.origin === "MANUAL_OVERRIDE" ? "Overridden by HR" : "Corrected"}: ${data.override.text}`}
          description={`${data.override.reasonLabel ? `${data.override.reasonLabel}. ` : ""}${data.override.reason ? `"${data.override.reason}" ` : ""}${data.override.origin === "MANUAL_OVERRIDE" ? "Set" : "Approved"}${data.override.by ? ` by ${data.override.by}` : ""} on ${dayjs(data.override.at).format("D MMM, HH:mm")}. The punches below are exactly what the device recorded; they were not changed.`}
        />
      )}

      {data.leaveReleased?.map((r, i) => (
        <ApprovalBanner
          key={i}
          tone="success"
          title={`Approved leave released: ${r.type} ${r.days} day${r.days === 1 ? "" : "s"} went back to the leave balance`}
          description={`Worked on this day; "${r.reason}"${r.by ? `, by ${r.by}` : ""} on ${dayjs(r.at).format("D MMM, HH:mm")}. It is in the leave ledger too.`}
        />
      ))}
      {data.shiftOverride && (
        <ApprovalBanner
          tone="info"
          title={`Shift set for this day by HR: ${data.shiftOverride.shiftName ?? ""}`}
          description={`"${data.shiftOverride.reason}"${data.shiftOverride.by ? `, by ${data.shiftOverride.by}` : ""} on ${dayjs(data.shiftOverride.at).format("D MMM, HH:mm")}. The person's usual shift is unchanged.`}
        />
      )}

      {self && data.canRequest?.ok && !pending && (
        <ApprovalBanner
          tone="info"
          title={data.canRequest.day.punchCount === 0 ? "No punches were recorded for this day." : "Something wrong with this day?"}
          description="Missing punches, wrong times, or the wrong status can be corrected: your manager or HR approves it."
          actions={
            <Button type="primary" onClick={onAsk}>
              Ask for a correction
            </Button>
          }
        />
      )}
      {pending && (
        <ApprovalBanner
          tone="info"
          title={`You asked for a correction (${pending.reasonLabel}): ${pending.correctionText}. Waiting for approval`}
          description={pending.reason ? `"${pending.reason}"` : undefined}
          actions={
            self ? (
              <Button loading={cancelling} onClick={() => onCancel(pending.id)}>
                Cancel request
              </Button>
            ) : undefined
          }
        />
      )}

      {/* The shift block */}
      <div style={{ display: "flex", gap: space[4], alignItems: "center", padding: space[4], borderRadius: radius.md, background: v.bgSubtle }}>
        <span
          aria-hidden
          className="ws-num"
          style={{ flex: "none", minWidth: 52, height: 52, padding: `0 ${space[2]}px`, borderRadius: radius.md, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tone.bg === "transparent" ? v.bgSurface : tone.bg, color: tone.fg, fontWeight: fw.bold, fontSize: fs.lg }}
        >
          {data.code}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>
            {data.shift ? `${data.shift.name} (${data.shift.code})` : "No shift"}
            {data.shift && <Text type="secondary" style={{ fontWeight: fw.regular }}> · {data.shift.startTime} to {data.shift.endTime}</Text>}
          </div>
          {data.policy && <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{data.policy.name}</div>}
          <div style={{ color: v.textSecondary, fontSize: fs.sm }}>
            Processed on {dayjs(data.processedAt).format("D MMM, HH:mm")}
            {data.provisional ? " · provisional: the day isn't over yet" : ""}
            {data.locked ? (
              <>
                {" · "}
                <LockOutlined aria-hidden /> finalised
              </>
            ) : (
              ""
            )}
          </div>
        </div>
      </div>

      <Section title="Times">
        <KeyValueGrid
          items={[
            { label: "First In", value: <span className="ws-num">{t.firstIn ?? "—"}</span> },
            { label: "Last Out", value: <span className="ws-num">{t.lastOut ?? "—"}</span> },
            { label: "Late In", value: minutes(t.lateInMinutes) },
            { label: "Early Out", value: minutes(t.earlyOutMinutes) },
            { label: "Total Work Hrs", value: minutes(t.totalMinutes) },
            { label: "Break Hrs", value: minutes(t.breakMinutes) },
            { label: "Actual Work Hrs", value: minutes(t.actualMinutes) },
            { label: "Work Hrs in Shift Time", value: minutes(t.inShiftMinutes) },
            { label: "Shortfall Hrs", value: minutes(t.shortfallMinutes) },
            { label: "Excess Hrs", value: minutes(t.excessMinutes) },
          ]}
        />
      </Section>

      <Section title="Status details">
        <KeyValueGrid
          columns={1}
          items={[
            {
              label: "Status",
              value: (
                <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
                  <span style={{ background: tone.bg, color: tone.fg, borderRadius: radius.xs, padding: "1px 8px", fontWeight: fw.bold, fontSize: fs.sm }}>{data.code}</span>
                  <span>{tone.label}</span>
                  {data.firstHalfStatus && data.secondHalfStatus && data.firstHalfStatus !== data.secondHalfStatus && (
                    <Text type="secondary">
                      first half {data.firstHalfStatus}, second half {data.secondHalfStatus}
                    </Text>
                  )}
                  {data.lopDays ? <Text type="danger">{data.lopDays} day LOP</Text> : null}
                  {data.workedOnOffDay && <StatusChip tone="success">worked on an off day</StatusChip>}
                </span>
              ),
            },
            { label: "Source", value: `${SOURCE_TEXT[data.source ?? ""] ?? data.source}${data.holidayName ? ` (${data.holidayName})` : ""}${data.leaveTypeCode ? ` (${data.leaveTypeCode})` : ""}` },
            ...(data.manualEntry
              ? [
                  {
                    label: "Entered",
                    value: (
                      <>
                        <Text code>{data.manualEntry.text}</Text> {data.manualEntry.kind === "STATUS_ONLY" && <StatusChip tone="neutral">status only, no times</StatusChip>}{" "}
                        <Text type="secondary">
                          by {data.manualEntry.enteredBy ?? "someone"} on {dayjs(data.manualEntry.enteredAt).format("D MMM, HH:mm")}
                          {data.manualEntry.via === "MUSTER_UPLOAD" ? " (upload)" : data.manualEntry.via === "BULK" ? " (mark all present)" : ""}
                          {data.manualEntry.remark ? `: ${data.manualEntry.remark}` : ""}
                        </Text>
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>

      {data.shift && data.shift.sessions.length > 0 && (
        <Section title="Session details">
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            {data.shift.sessions.map((s, i) => (
              <div key={`${s.kind}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: space[3], padding: `${space[2]}px ${space[3]}px`, border: `1px solid ${v.borderDefault}`, borderRadius: radius.sm, fontSize: fs.table }}>
                <span style={{ color: v.textBody }}>{s.label}</span>
                <span className="ws-num" style={{ color: v.textSecondary }}>
                  {s.startTime} to {s.endTime}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.capture === "DEVICE" && (
        <Section title="Punches">
          {data.punches?.length ? (
            <ol data-testid="day-punches" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[2] }}>
              {data.punches.map((p) => {
                const used = p.role === "FIRST_IN" || p.role === "LAST_OUT" || p.role === "ONLY";
                return (
                  <li key={p.id} data-testid="day-punch" data-device={p.device} data-time={p.time} style={{ display: "flex", gap: space[3], alignItems: "baseline", flexWrap: "wrap", fontSize: fs.table }}>
                    <span className="ws-num" style={{ fontWeight: fw.semibold, color: v.textPrimary, minWidth: 64 }}>
                      {p.time}
                    </span>
                    {p.date !== data.date && <Text type="secondary">(next day)</Text>}
                    <span style={{ color: used ? v.textBody : v.textSecondary, fontWeight: used ? fw.semibold : fw.regular }}>{ROLE_TEXT[p.role] ?? p.role}</span>
                    <Text type="secondary">· {p.device}</Text>
                  </li>
                );
              })}
            </ol>
          ) : (
            <Text type="secondary">No punches in this day's punch window.</Text>
          )}
        </Section>
      )}

      {(data.requests?.length ?? 0) > 0 && (
        <Section title="Forgot-to-punch requests">
          <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
            {data.requests!.map((r) => (
              <div key={r.id} style={{ fontSize: fs.table }}>
                <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
                  <StatusChip status={r.status} />
                  <Text>
                    {r.reasonLabel}: {r.correctionText}
                  </Text>
                  <Text type="secondary">· {dayjs(r.createdAt).format("D MMM, HH:mm")}</Text>
                </div>
                <div style={{ marginTop: 2 }}>
                  {r.reason && <Text type="secondary">"{r.reason}"</Text>}
                  {r.decidedBy && (
                    <Text type="secondary">
                      {" "}
                      · {r.status.toLowerCase()} by {r.decidedBy}
                      {r.decisionNote ? `: "${r.decisionNote}"` : ""}
                    </Text>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {self && data.canRequest && !data.canRequest.ok && !pending && !data.provisional && <Text type="secondary">A correction can't be asked for on this day: {data.canRequest.reason}</Text>}
    </div>
  );
}
