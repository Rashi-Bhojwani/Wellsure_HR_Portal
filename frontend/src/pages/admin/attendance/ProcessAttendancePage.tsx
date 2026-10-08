import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Drawer, Form, Input, Progress, Radio, Select, Space, Table, Tag, Typography, message } from "antd";
import * as attendanceApi from "../../../api/attendance";
import type { ProcessRun } from "../../../api/attendance";
import * as orgApi from "../../../api/org";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;
const long = (d: string) => dayjs(d).format("D MMM YYYY");
const STATUS_COLOUR: Record<string, string> = { QUEUED: "default", RUNNING: "processing", COMPLETED: "green", FAILED: "red" };

interface FormValues {
  range: [Dayjs, Dayjs];
  scope: "ALL" | "BRANCH" | "EMPLOYEE";
  locationId?: string;
  employeeId?: string;
  reason: string;
}

function RunDetail({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ["attendance", "process", runId], queryFn: () => attendanceApi.getProcessRun(runId!), enabled: !!runId });
  return (
    <Drawer open={!!runId} onClose={onClose} size={720} title={data ? `${long(data.fromDate)} – ${long(data.toDate)}` : ""}>
      {data && (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            <b>Why:</b> {data.reason}
          </Text>
          <Text>
            {data.processedDays} employee-days processed, <b>{data.changedDays} changed</b>
            {data.lockedDays ? `, ${data.lockedDays} left alone (finalised)` : ""}.
          </Text>
          <Table
            size="small"
            rowKey={(r) => `${r.employeeId}-${r.date}`}
            dataSource={data.changes}
            pagination={{ pageSize: 50 }}
            locale={{ emptyText: "Nothing changed." }}
            title={() => (data.changedDays > data.changes.length ? `The first ${data.changes.length} changes` : "Changes")}
            columns={[
              { title: "Employee", dataIndex: "employeeCode" },
              { title: "Date", dataIndex: "date", render: long },
              { title: "Before", dataIndex: "before", render: (v: string | null) => v ?? <Text type="secondary">no record</Text> },
              { title: "After", dataIndex: "after", render: (v: string | null) => v ?? <Text type="secondary">no record</Text> },
            ]}
          />
        </Space>
      )}
    </Drawer>
  );
}

// Workforce → Attendance → Process Attendance (Phase 2 P2-C, docs/plans/
// PHASE_2.md §3.1): re-run the rules engine for a range — after HR confirms a
// rule value, for instance. Finalised days are never touched.
export function ProcessAttendancePage() {
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const scope = Form.useWatch("scope", form);
  const [detail, setDetail] = useState<string | null>(null);
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["attendance", "process"],
    queryFn: attendanceApi.listProcessRuns,
    refetchInterval: (q) => ((q.state.data as ProcessRun[] | undefined)?.some((r) => r.status === "QUEUED" || r.status === "RUNNING") ? 2000 : false),
  });
  const start = useMutation({
    mutationFn: (v: FormValues) =>
      attendanceApi.startProcessRun({
        fromDate: v.range[0].format("YYYY-MM-DD"),
        toDate: v.range[1].format("YYYY-MM-DD"),
        locationId: v.scope === "BRANCH" ? v.locationId : null,
        employeeIds: v.scope === "EMPLOYEE" && v.employeeId ? [v.employeeId] : undefined,
        reason: v.reason,
      }),
    onSuccess: () => {
      void message.success("Processing started. Progress shows below.");
      void qc.invalidateQueries({ queryKey: ["attendance", "process"] });
      form.resetFields(["reason"]);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not start processing.")),
  });
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Process Attendance
      </Title>
      <HelpStrip storageKey="process-attendance-help">
        Every attendance day is worked out from raw punches, manual entries, leave, holidays and the attendance rules. When a rule value changes — say HR confirms the
        half-day hours — process the affected range here and every day is recomputed. Days already finalised are never changed.
      </HelpStrip>
      <Card size="small" title="Process a range">
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ scope: "ALL", range: [dayjs().startOf("month"), dayjs()] }}
          onFinish={(v) => start.mutate(v)}
          style={{ maxWidth: 640 }}
        >
          <Form.Item name="range" label="Dates" rules={[{ required: true }]}>
            <DatePicker.RangePicker format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs(), "day")} allowClear={false} />
          </Form.Item>
          <Form.Item name="scope" label="Who">
            <Radio.Group options={[{ value: "ALL", label: "Everyone" }, { value: "BRANCH", label: "A branch" }, { value: "EMPLOYEE", label: "One employee" }]} />
          </Form.Item>
          {scope === "BRANCH" && (
            <Form.Item name="locationId" label="Branch" rules={[{ required: true }]}>
              <Select options={locations.map((l) => ({ value: l.id, label: l.name }))} />
            </Form.Item>
          )}
          {scope === "EMPLOYEE" && (
            <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
              <EmployeePicker />
            </Form.Item>
          )}
          <Form.Item name="reason" label="Why" rules={[{ required: true, min: 5, message: "Say why, e.g. HR confirmed the half-day hours" }]}>
            <Input placeholder="e.g. HR confirmed the half-day hours" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={start.isPending}>
            Process
          </Button>
        </Form>
      </Card>
      <Table<ProcessRun>
        rowKey="id"
        loading={isLoading}
        dataSource={runs}
        pagination={false}
        scroll={{ x: true }}
        locale={{ emptyText: "No runs yet." }}
        columns={[
          { title: "Requested", dataIndex: "requestedAt", render: (v: string) => dayjs(v).format("D MMM YYYY, HH:mm") },
          { title: "Range", key: "range", render: (_, r) => `${long(r.fromDate)} – ${long(r.toDate)}` },
          { title: "Why", dataIndex: "reason" },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOUR[s]}>{s.toLowerCase()}</Tag> },
          { title: "Progress", key: "progress", render: (_, r) => <Progress size="small" percent={r.totalDays ? Math.round((r.processedDays / r.totalDays) * 100) : 0} style={{ width: 140 }} /> },
          { title: "Changed", dataIndex: "changedDays" },
          { title: "Finalised (skipped)", dataIndex: "lockedDays" },
          { title: "", key: "view", render: (_, r) => <Button size="small" onClick={() => setDetail(r.id)}>What changed</Button> },
        ]}
      />
      {runs.some((r) => r.status === "FAILED") && <Alert type="error" showIcon title="A run failed. The error is shown on the run; the days it hadn't reached are unchanged." />}
      <RunDetail runId={detail} onClose={() => setDetail(null)} />
    </Space>
  );
}
