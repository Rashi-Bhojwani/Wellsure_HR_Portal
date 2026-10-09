import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Empty, List, Space, Spin, Tag, Typography, message } from "antd";
import { CloseOutlined, EditOutlined } from "@ant-design/icons";
import * as infoApi from "../../api/attendanceInfo";
import type { DayDetail } from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";
import { hoursLabel } from "../../pages/admin/attendance/settings/format";
import { MissingPunchModal } from "./MissingPunchModal";

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
const SOURCE_TEXT: Record<string, string> = { DEVICE: "Biometric device", MANUAL: "Marked by hand", LEAVE: "Approved leave", HOLIDAY: "Holiday", WEEK_OFF: "Week-off" };
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
const STATUS_COLOR: Record<string, string> = { PENDING: "gold", APPROVED: "green", REJECTED: "red", CANCELLED: "default" };

/** One day of Attendance Info (Phase 2 P2-E): times, shift, status, raw punches, and the forgot-to-punch request. */
export function DayPanel({ employeeId, date, self, onClose }: { employeeId?: string; date: string; self: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "info", "day", employeeId ?? "me", date],
    queryFn: () => (self ? infoApi.myDay(date) : infoApi.employeeDay(employeeId!, date)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => infoApi.cancelRegularization(id),
    onSuccess: () => {
      void message.success("Request cancelled.");
      void queryClient.invalidateQueries({ queryKey: ["attendance", "info"] });
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not cancel.")),
  });
  const title = dayjs(date).format("ddd, D MMM YYYY");
  return (
    <Card size="small" title={title} extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} aria-label="Hide day" />}>
      {isLoading || !data ? <Spin /> : !data.employed ? <Empty description="Not employed on this day." /> : <DayBody data={data} self={self} onAsk={() => setAsking(true)} onCancel={(id) => cancel.mutate(id)} />}
      {data?.canRequest?.ok && <MissingPunchModal date={date} punchTime={data.canRequest.punchTime} open={asking} onClose={() => setAsking(false)} />}
    </Card>
  );
}

function DayBody({ data, self, onAsk, onCancel }: { data: DayDetail; self: boolean; onAsk: () => void; onCancel: (id: string) => void }) {
  const t = data.times!;
  const pending = data.requests?.find((r) => r.status === "PENDING");
  const exceptions = (data.flags ?? []).filter((f) => f !== "LATE_IN" && f !== "EARLY_OUT");
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {exceptions.map((f) => (
        <Alert key={f} type="warning" showIcon title={FLAG_TEXT[f] ?? f} description={f === "MISSING_PUNCH" && data.lopDays ? `${data.lopDays} day(s) of LOP until it's corrected.` : undefined} />
      ))}
      {data.correction && (
        <Alert
          type="success"
          showIcon
          icon={<EditOutlined />}
          title={`Corrected: ${data.correction.missing} ${data.correction.time} was added`}
          description={`A forgot-to-punch request approved${data.correction.decidedBy ? ` by ${data.correction.decidedBy}` : ""}${data.correction.decidedAt ? ` on ${dayjs(data.correction.decidedAt).format("D MMM, HH:mm")}` : ""}. The device's own punches are unchanged.`}
        />
      )}

      {self && data.canRequest?.ok && !pending && (
        <Alert
          type="info"
          showIcon
          title={`Only one punch recorded (${data.canRequest.punchTime}). Forgot to punch out?`}
          action={
            <Button size="small" type="primary" onClick={onAsk}>
              Tell us the missing time
            </Button>
          }
        />
      )}
      {pending && (
        <Alert
          type="info"
          showIcon
          title={`You asked for ${pending.missing} ${pending.time}: waiting for approval`}
          description={`"${pending.reason}"`}
          action={
            self ? (
              <Button size="small" onClick={() => onCancel(pending.id)}>
                Cancel request
              </Button>
            ) : undefined
          }
        />
      )}

      <div>
        <Text strong>
          {data.shift ? `${data.shift.name} (${data.shift.code})` : "No shift"}
        </Text>
        {data.shift && (
          <Text type="secondary">
            {" "}
            · {data.shift.startTime} to {data.shift.endTime}
          </Text>
        )}
        {data.policy && <Text type="secondary"> · {data.policy.name}</Text>}
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Processed on {dayjs(data.processedAt).format("D MMM, HH:mm")}
            {data.provisional ? " · provisional: the day isn't over yet" : ""}
            {data.locked ? " · 🔒 finalised" : ""}
          </Text>
        </div>
      </div>

      <Descriptions
        size="small"
        bordered
        column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }}
        items={[
          { key: "in", label: "First In", children: t.firstIn ?? "—" },
          { key: "out", label: "Last Out", children: t.lastOut ?? "—" },
          { key: "late", label: "Late In", children: minutes(t.lateInMinutes) },
          { key: "early", label: "Early Out", children: minutes(t.earlyOutMinutes) },
          { key: "total", label: "Total Work Hrs", children: minutes(t.totalMinutes) },
          { key: "break", label: "Break Hrs", children: minutes(t.breakMinutes) },
          { key: "actual", label: "Actual Work Hrs", children: minutes(t.actualMinutes) },
          { key: "inshift", label: "Work Hrs in Shift Time", children: minutes(t.inShiftMinutes) },
          { key: "short", label: "Shortfall Hrs", children: minutes(t.shortfallMinutes) },
          { key: "excess", label: "Excess Hrs", children: minutes(t.excessMinutes) },
        ]}
      />

      <Descriptions
        size="small"
        column={1}
        title="Status details"
        items={[
          {
            key: "status",
            label: "Status",
            children: (
              <Space size={4} wrap>
                <Tag>{data.code}</Tag>
                {data.firstHalfStatus && data.secondHalfStatus && data.firstHalfStatus !== data.secondHalfStatus && (
                  <Text type="secondary">
                    first half {data.firstHalfStatus}, second half {data.secondHalfStatus}
                  </Text>
                )}
                {data.lopDays ? <Text type="danger">{data.lopDays} day LOP</Text> : null}
                {data.workedOnOffDay && <Tag color="green">worked on an off day</Tag>}
              </Space>
            ),
          },
          { key: "source", label: "Source", children: `${SOURCE_TEXT[data.source ?? ""] ?? data.source}${data.holidayName ? ` (${data.holidayName})` : ""}${data.leaveTypeCode ? ` (${data.leaveTypeCode})` : ""}` },
          ...(data.manualEntry
            ? [
                {
                  key: "manual",
                  label: "Entered",
                  children: (
                    <>
                      <Text code>{data.manualEntry.text}</Text> {data.manualEntry.kind === "STATUS_ONLY" && <Tag>status only, no times</Tag>}
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

      {data.capture === "DEVICE" && (
        <div>
          <Text strong>Punches</Text>
          {data.punches?.length ? (
            <List
              size="small"
              dataSource={data.punches}
              renderItem={(p) => (
                <List.Item style={{ padding: "4px 0", display: "block" }}>
                  <Text code>{p.time}</Text>
                  {p.date !== data.date && <Text type="secondary"> (next day)</Text>}
                  <Text type="secondary" strong={p.role === "FIRST_IN" || p.role === "LAST_OUT" || p.role === "ONLY"}>
                    {" "}
                    · {ROLE_TEXT[p.role] ?? p.role}
                  </Text>
                  <Text type="secondary"> · {p.device}</Text>
                </List.Item>
              )}
            />
          ) : (
            <div>
              <Text type="secondary">No punches in this day's punch window.</Text>
            </div>
          )}
        </div>
      )}

      {(data.requests?.length ?? 0) > 0 && (
        <div>
          <Text strong>Forgot-to-punch requests</Text>
          <List
            size="small"
            dataSource={data.requests}
            renderItem={(r) => (
              <List.Item style={{ padding: "4px 0", display: "block" }}>
                <Space size={6} wrap>
                  <Tag color={STATUS_COLOR[r.status]}>{r.status.toLowerCase()}</Tag>
                  <Text>
                    {r.missing} {r.time}
                  </Text>
                  <Text type="secondary">· {dayjs(r.createdAt).format("D MMM, HH:mm")}</Text>
                </Space>
                <div>
                  <Text type="secondary">"{r.reason}"</Text>
                  {r.decidedBy && (
                    <Text type="secondary">
                      {" "}
                      · {r.status.toLowerCase()} by {r.decidedBy}
                      {r.decisionNote ? `: "${r.decisionNote}"` : ""}
                    </Text>
                  )}
                </div>
              </List.Item>
            )}
          />
        </div>
      )}
      {self && data.canRequest && !data.canRequest.ok && data.flags?.includes("MISSING_PUNCH") && !pending && <Text type="secondary">{data.canRequest.reason}</Text>}
    </Space>
  );
}
