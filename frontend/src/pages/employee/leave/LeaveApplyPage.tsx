import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Form, Input, List, Select, Space, Tag, Typography, message } from "antd";
import type { Dayjs } from "dayjs";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title, Text } = Typography;
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

export function LeaveApplyPage() {
  const [form] = Form.useForm<ApplyFormValues>();
  const queryClient = useQueryClient();

  const { data: leaveTypes = [] } = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes });
  const { data: balances = [] } = useQuery({ queryKey: ["leave", "balances", "me"], queryFn: () => leaveApi.getLeaveBalances() });

  const selectedTypeId = Form.useWatch("leaveTypeId", form) as string | undefined;
  const dateRange = Form.useWatch("dateRange", form) as [Dayjs, Dayjs] | undefined;

  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId);
  const selectedBalance = balances.find((b) => b.leaveTypeId === selectedTypeId);
  const hasDateRange = Boolean(dateRange?.[0] && dateRange[1]);
  const estimatedDays = hasDateRange ? dateRange![1].diff(dateRange![0], "day") + 1 : null;

  const { data: teamOnLeave = [] } = useQuery({
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
      void message.success(`Applied for ${result.totalDays} day(s) — pending approval.`);
    },
    onError: (err) => void message.error(errorMessage(err, "Could not submit leave request.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Apply for Leave
      </Title>

      <Card style={{ maxWidth: 640 }}>
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => applyMutation.mutate(v)}>
          <Form.Item name="leaveTypeId" label="Leave Type" rules={[{ required: true, message: "Select a leave type" }]}>
            <Select options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))} placeholder="Select a leave type" />
          </Form.Item>

          {selectedBalance && <Alert type="info" showIcon style={{ marginBottom: 16 }} message={`Current balance: ${selectedBalance.balance} day(s)`} />}

          <Form.Item name="dateRange" label="Dates" rules={[{ required: true, message: "Select the leave dates" }]}>
            <RangePicker style={{ width: "100%" }} />
          </Form.Item>

          <Space size={16} style={{ display: selectedType?.allowHalfDay ? "flex" : "none", width: "100%" }}>
            <Form.Item name="fromDayPart" label="First Day" initialValue="FULL" style={{ flex: 1 }}>
              <Select options={DAY_PART_OPTIONS} />
            </Form.Item>
            <Form.Item name="toDayPart" label="Last Day" initialValue="FULL" style={{ flex: 1 }}>
              <Select options={DAY_PART_OPTIONS} />
            </Form.Item>
          </Space>

          {estimatedDays !== null && (
            <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
              ≈ {estimatedDays} calendar day(s) selected — public holidays and week-offs are excluded automatically; the exact day count is confirmed when you submit.
            </Text>
          )}

          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={3} placeholder="Optional" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={applyMutation.isPending}>
              Submit
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {hasDateRange && (
        <Card title="Who else is off these days" style={{ maxWidth: 640 }}>
          {teamOnLeave.length === 0 ? (
            <EmptyState message="No one on your team is off during these dates." />
          ) : (
            <List
              size="small"
              dataSource={teamOnLeave}
              renderItem={(entry) => (
                <List.Item>
                  <Space>
                    <Text>{entry.employeeName}</Text>
                    <Tag>{entry.leaveTypeCode}</Tag>
                    <Text type="secondary">
                      {entry.fromDate} → {entry.toDate}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      )}
    </Space>
  );
}
