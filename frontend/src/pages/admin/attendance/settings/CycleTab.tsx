import { useState, type ReactNode } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, InputNumber } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ApprovalBanner, ConfirmModal, KeyValueGrid, Panel, QueryState, SkeletonCard, Stack, StatusChip, toast, useIsPhone } from "../../../../ui";
import { fs, fw, radius, space, v } from "../../../../theme/tokens";
import { Hint } from "./common";

const longDate = (iso: string) => dayjs(iso).format("D MMM YYYY");

/** A wrapping row of form fields with the submit button aligned to the inputs; stacks on phones. */
function InlineFields({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: `0 ${space[4]}px` }}>{children}</div>;
}

// The attendance cycle (user 2026-10-08: calendar month). The period the
// muster shows, finalisation locks and payroll pays.
export function CycleTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["attendance", "config", "cycle"], queryFn: attendanceApi.getCycle });
  const [form] = Form.useForm<{ effectiveFrom: Dayjs; startDay: number }>();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const schedule = useMutation({
    mutationFn: attendanceApi.scheduleCycleChange,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config", "cycle"] });
      toast.success("Cycle change scheduled.");
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err, "Could not change the cycle.")),
  });
  const cancel = useMutation({
    mutationFn: attendanceApi.cancelCycleChange,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config", "cycle"] });
      toast.success("Scheduled change cancelled.");
      setCancelling(null);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err, "Could not change the cycle.")),
  });
  const { data: engineStart } = useQuery({ queryKey: ["attendance", "config", "engine-start"], queryFn: attendanceApi.getEngineStart });
  const [engineForm] = Form.useForm<{ date: Dayjs | null }>();
  const setEngineStart = useMutation({
    mutationFn: attendanceApi.setEngineStart,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config", "engine-start"] });
      toast.success("Saved.");
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err, "Could not save the date.")),
  });
  const scheduled = data?.rules.filter((r) => r.status === "scheduled") ?? [];

  return (
    <QueryState
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      skeleton={
        <Stack>
          <SkeletonCard />
          <SkeletonCard />
        </Stack>
      }
    >
      {data && (
        <Stack>
          <Panel title="Current cycle" subtitle="The period the muster shows, finalisation locks and payroll pays">
            <KeyValueGrid
              columns={3}
              items={[
                { key: "cycle", label: "Cycle", value: data.current.label },
                { key: "runs", label: "Runs", value: `${longDate(data.current.start)} – ${longDate(data.current.end)}` },
                { key: "day", label: "Starts on day", value: data.current.startDay === 1 ? "1 (calendar month)" : data.current.startDay },
              ]}
            />
            {scheduled.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: space[3], marginTop: space[5] }}>
                {scheduled.map((r) => (
                  <ApprovalBanner
                    key={r.id}
                    tone="warning"
                    icon={<ClockCircleOutlined />}
                    title={`Scheduled: from ${longDate(r.effectiveFrom)}, cycles start on day ${r.startDay}.`}
                    actions={
                      canManage && (
                        <Button size="small" danger onClick={() => setCancelling(r.id)}>
                          Cancel
                        </Button>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Recent cycles">
            {data.recent.length === 0 ? (
              <Hint style={{ margin: 0 }}>No earlier cycles yet.</Hint>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
                {data.recent.map((c, i) => (
                  <li
                    key={`${c.start}-${c.label}`}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      gap: space[2],
                      padding: `${space[3]}px 0`,
                      borderTop: i === 0 ? undefined : `1px solid ${v.borderDefault}`,
                    }}
                  >
                    <span style={{ fontWeight: fw.medium, color: v.textPrimary }}>{c.label}</span>
                    <span style={{ color: v.textSecondary, fontSize: fs.table }}>
                      {longDate(c.start)} – {longDate(c.end)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="When this system takes over from greytHR"
            extra={engineStart?.date ? <StatusChip tone="info">From {longDate(engineStart.date)}</StatusChip> : <StatusChip tone="warning">Not set</StatusChip>}
          >
            <Hint>
              Days before this date belong to greytHR. This system will not compute, change or delete them, however it is asked (Process Attendance, the nightly run, a
              correction). Leave it empty only before the cut-over is planned.{" "}
              {engineStart?.date ? (
                <>
                  Currently <strong style={{ color: v.textPrimary }}>{longDate(engineStart.date)}</strong>.
                </>
              ) : (
                <>Currently not set: no days are protected.</>
              )}
            </Hint>
            {canManage && (
              <Form
                form={engineForm}
                layout="vertical"
                requiredMark={false}
                initialValues={{ date: engineStart?.date ? dayjs(engineStart.date) : null }}
                key={engineStart?.date ?? "none"}
                onFinish={(val) => setEngineStart.mutate(val.date ? val.date.format("YYYY-MM-DD") : null)}
              >
                <InlineFields>
                  <Form.Item name="date" label="First day this system is the record" style={{ minWidth: phone ? "100%" : 240 }}>
                    <DatePicker format="D MMM YYYY" allowClear style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label={phone ? undefined : " "} colon={false}>
                    <Button htmlType="submit" loading={setEngineStart.isPending} block={phone}>
                      Save
                    </Button>
                  </Form.Item>
                </InlineFields>
              </Form>
            )}
          </Panel>

          {canManage && (
            <Panel title="Change the cycle start day">
              <Hint>
                A change applies only from a future cycle boundary: the current cycle and every past one keep their dates, so nothing already finalised can move. The
                cycle before the change ends the day before it.
              </Hint>
              <Form
                form={form}
                layout="vertical"
                requiredMark={false}
                initialValues={{ startDay: data.current.startDay }}
                onFinish={(val) => schedule.mutate({ effectiveFrom: val.effectiveFrom.format("YYYY-MM-DD"), startDay: val.startDay })}
              >
                <InlineFields>
                  <Form.Item name="startDay" label="Start day" rules={[{ required: true }]} style={{ minWidth: phone ? "100%" : 120 }}>
                    <InputNumber min={1} max={28} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name="effectiveFrom" label="From" rules={[{ required: true }]} style={{ minWidth: phone ? "100%" : 220 }}>
                    <DatePicker format="D MMM YYYY" disabledDate={(d) => !d.isAfter(dayjs(data.current.end), "day")} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label={phone ? undefined : " "} colon={false}>
                    <Button htmlType="submit" loading={schedule.isPending} block={phone}>
                      Schedule
                    </Button>
                  </Form.Item>
                </InlineFields>
              </Form>
              {scheduled.length > 0 && (
                <div style={{ display: "inline-block", padding: `${space[1]}px ${space[3]}px`, borderRadius: radius.sm, background: v.bgSubtle, color: v.textSecondary, fontSize: fs.sm }}>
                  Scheduling again replaces the change above.
                </div>
              )}
            </Panel>
          )}

          <ConfirmModal
            open={!!cancelling}
            onCancel={() => setCancelling(null)}
            title="Cancel this change?"
            description="The cycle start day stays as it is."
            confirmLabel="Cancel change"
            cancelLabel="Keep it"
            danger
            loading={cancel.isPending}
            onConfirm={() => cancelling && cancel.mutate(cancelling)}
          />
        </Stack>
      )}
    </QueryState>
  );
}
