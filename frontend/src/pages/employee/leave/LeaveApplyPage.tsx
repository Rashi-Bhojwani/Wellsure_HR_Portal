import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select } from "antd";
import type { Dayjs } from "dayjs";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, EmptyState, InitialsAvatar, PageHeader, Panel, StatusChip, toast, useIsPhone } from "../../../ui";

const { RangePicker } = DatePicker;

const DAY_PART_OPTIONS = [
  { value: "FULL", label: "Full Day" },
  { value: "FIRST_HALF", label: "First Half" },
  { value: "SECOND_HALF", label: "Second Half" },
];

interface ApplyFormValues {
  leaveTypeId: string;
  dateRange: [Dayjs, Dayjs];
  fromDayPart: "FULL" | "FIRST_HALF" | "SECOND_HALF";
  toDayPart: "FULL" | "FIRST_HALF" | "SECOND_HALF";
  reason?: string;
}

// Apply for leave (time-off-03/04): the board puts this form in a drawer; ours stays a page (same URL) styled like that drawer, with a sticky
// action bar. The day count shown before submitting is only an estimate — the server computes the real one (holidays, week-offs, half days).
export function LeaveApplyPage() {
  const [form] = Form.useForm<ApplyFormValues>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const phone = useIsPhone();

  const { data: leaveTypes = [], isLoading: loadingTypes } = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes, staleTime: 30_000 });
  const { data: balances = [] } = useQuery({ queryKey: ["leave", "balances", "me"], queryFn: () => leaveApi.getLeaveBalances() });

  const selectedTypeId = Form.useWatch("leaveTypeId", form) as string | undefined;
  const dateRange = Form.useWatch("dateRange", form) as [Dayjs, Dayjs] | undefined;

  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId);
  const selectedBalance = balances.find((b) => b.leaveTypeId === selectedTypeId);
  const hasDateRange = Boolean(dateRange?.[0] && dateRange[1]);
  const estimatedDays = hasDateRange ? dateRange![1].diff(dateRange![0], "day") + 1 : null;

  const { data: teamOnLeave = [], isLoading: loadingTeam } = useQuery({
    queryKey: ["leave", "calendar", dateRange?.[0]?.format("YYYY-MM-DD"), dateRange?.[1]?.format("YYYY-MM-DD")],
    queryFn: () => leaveApi.getLeaveCalendar(dateRange![0].format("YYYY-MM-DD"), dateRange![1].format("YYYY-MM-DD")),
    enabled: hasDateRange,
  });

  const applyMutation = useMutation({
    mutationFn: (values: ApplyFormValues) =>
      leaveApi.applyForLeave({
        leaveTypeId: values.leaveTypeId,
        fromDate: values.dateRange[0].format("YYYY-MM-DD"),
        toDate: values.dateRange[1].format("YYYY-MM-DD"),
        fromDayPart: values.fromDayPart,
        toDayPart: values.toDayPart,
        reason: values.reason,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
      form.resetFields();
      toast.success(`Applied for ${result.totalDays} day(s) — pending approval.`);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not submit leave request.")),
  });

  return (
    <>
      <PageHeader title="Apply for Leave" breadcrumb={[{ label: "Leave Balances", to: "/app/leave/balances" }, { label: "Apply for Leave" }]} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: phone ? space[4] : space[6], alignItems: "flex-start" }}>
        <Panel title="New leave request" style={{ flex: "1 1 520px", maxWidth: 720 }} bodyStyle={{ paddingBottom: 0 }}>
          <Form form={form} layout="vertical" requiredMark={false} size="large" onFinish={(val) => applyMutation.mutate(val)}>
            <Form.Item name="leaveTypeId" label="Leave Type" rules={[{ required: true, message: "Select a leave type" }]}>
              <Select loading={loadingTypes} options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))} placeholder="Select a leave type" />
            </Form.Item>

            {selectedBalance && (
              <ApprovalBanner
                tone="info"
                title={`Current balance: ${selectedBalance.balance} day(s)`}
                description={`${selectedBalance.name} · granted ${selectedBalance.granted} this year`}
                style={{ marginBottom: space[5] }}
              />
            )}

            <Form.Item name="dateRange" label="Dates" rules={[{ required: true, message: "Select the leave dates" }]}>
              <RangePicker style={{ width: "100%" }} placeholder={["From", "To"]} format="DD MMM YYYY" />
            </Form.Item>

            <div style={{ display: selectedType?.allowHalfDay ? "flex" : "none", gap: space[4], flexWrap: phone ? "wrap" : "nowrap" }}>
              <Form.Item name="fromDayPart" label="First Day" initialValue="FULL" style={{ flex: "1 1 200px" }}>
                <Select options={DAY_PART_OPTIONS} />
              </Form.Item>
              <Form.Item name="toDayPart" label="Last Day" initialValue="FULL" style={{ flex: "1 1 200px" }}>
                <Select options={DAY_PART_OPTIONS} />
              </Form.Item>
            </div>

            {estimatedDays !== null && (
              <div style={{ color: v.textSecondary, fontSize: fs.md, marginBottom: space[5] }}>
                ≈ {estimatedDays} calendar day(s) selected — public holidays and week-offs are excluded automatically; the exact day count is confirmed when you submit.
              </div>
            )}

            <Form.Item name="reason" label="Reason">
              <Input.TextArea rows={3} placeholder="Optional" />
            </Form.Item>

            <div
              style={{
                position: "sticky",
                bottom: phone ? "calc(64px + env(safe-area-inset-bottom))" : 0,
                zIndex: 2,
                background: v.bgSurface,
                borderTop: `1px solid ${v.borderDefault}`,
                margin: phone ? `0 -${space[4]}px` : `0 -${space[6]}px`,
                padding: phone ? space[4] : `${space[4]}px ${space[6]}px`,
                borderRadius: `0 0 ${radius.lg}px ${radius.lg}px`,
                display: "flex",
                justifyContent: "flex-end",
                gap: space[3],
              }}
            >
              <Button onClick={() => navigate("/app/leave/balances")} style={{ flex: phone ? 1 : undefined, minWidth: 120 }}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit" loading={applyMutation.isPending} style={{ flex: phone ? 1 : undefined, minWidth: 120 }}>
                Submit
              </Button>
            </div>
          </Form>
        </Panel>

        {hasDateRange && (
          <Panel title="Who else is off these days" style={{ flex: "1 1 300px" }}>
            {loadingTeam ? (
              <div style={{ color: v.textSecondary }}>Checking…</div>
            ) : teamOnLeave.length === 0 ? (
              <EmptyState compact illustration="people" title="No one on your team is off during these dates." description={null} />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[3] }}>
                {teamOnLeave.map((entry, i) => (
                  <li key={`${entry.employeeId}-${i}`} style={{ display: "flex", alignItems: "center", gap: space[3] }}>
                    <InitialsAvatar name={entry.employeeName} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{entry.employeeName}</div>
                      <div style={{ fontSize: fs.sm, color: v.textSecondary }}>
                        {entry.fromDate} → {entry.toDate}
                      </div>
                    </div>
                    <StatusChip tone="info">{entry.leaveTypeCode}</StatusChip>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
