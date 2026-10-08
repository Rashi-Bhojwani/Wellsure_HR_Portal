import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Descriptions, Form, InputNumber, List, Popconfirm, Space, Tag, Typography, message } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import { apiErrorMessage } from "../../../../lib/apiError";

const { Text } = Typography;
const longDate = (iso: string) => dayjs(iso).format("D MMM YYYY");

// The attendance cycle (user 2026-10-08: calendar month). The period the
// muster shows, finalisation locks and payroll pays.
export function CycleTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["attendance", "config", "cycle"], queryFn: attendanceApi.getCycle });
  const [form] = Form.useForm<{ effectiveFrom: Dayjs; startDay: number }>();
  const done = {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["attendance", "config", "cycle"] }),
    onError: (err: unknown) => void message.error(apiErrorMessage(err, "Could not change the cycle.")),
  };
  const schedule = useMutation({ mutationFn: attendanceApi.scheduleCycleChange, ...done });
  const cancel = useMutation({ mutationFn: attendanceApi.cancelCycleChange, ...done });
  const scheduled = data?.rules.filter((r) => r.status === "scheduled") ?? [];
  if (!data) return null;
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card size="small" title="Current cycle">
        <Descriptions size="small" column={{ xs: 1, sm: 3 }}>
          <Descriptions.Item label="Cycle">{data.current.label}</Descriptions.Item>
          <Descriptions.Item label="Runs">{longDate(data.current.start)} – {longDate(data.current.end)}</Descriptions.Item>
          <Descriptions.Item label="Starts on day">{data.current.startDay === 1 ? "1 (calendar month)" : data.current.startDay}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card size="small" title="Recent cycles">
        <List size="small" dataSource={data.recent} renderItem={(c) => <List.Item>{c.label} <Text type="secondary">({longDate(c.start)} – {longDate(c.end)})</Text></List.Item>} />
      </Card>
      {scheduled.map((r) => (
        <Alert
          key={r.id}
          type="warning"
          showIcon
          icon={<ClockCircleOutlined />}
          message={`Scheduled: from ${longDate(r.effectiveFrom)}, cycles start on day ${r.startDay}.`}
          action={canManage && <Popconfirm title="Cancel this change?" onConfirm={() => cancel.mutate(r.id)}><Button size="small" danger>Cancel</Button></Popconfirm>}
        />
      ))}
      {canManage && (
        <Card size="small" title="Change the cycle start day">
          <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
            A change applies only from a future cycle boundary: the current cycle and every past one keep their dates, so nothing already finalised can move.
            The cycle before the change ends the day before it.
          </Text>
          <Form
            form={form}
            layout="inline"
            initialValues={{ startDay: data.current.startDay }}
            onFinish={(v) => schedule.mutate({ effectiveFrom: v.effectiveFrom.format("YYYY-MM-DD"), startDay: v.startDay })}
          >
            <Form.Item name="startDay" label="Start day" rules={[{ required: true }]}>
              <InputNumber min={1} max={28} />
            </Form.Item>
            <Form.Item name="effectiveFrom" label="From" rules={[{ required: true }]}>
              <DatePicker format="D MMM YYYY" disabledDate={(d) => !d.isAfter(dayjs(data.current.end), "day")} />
            </Form.Item>
            <Button htmlType="submit" loading={schedule.isPending}>Schedule</Button>
          </Form>
          {scheduled.length > 0 && <Tag style={{ marginTop: 8 }}>Scheduling again replaces the change above.</Tag>}
        </Card>
      )}
    </Space>
  );
}
