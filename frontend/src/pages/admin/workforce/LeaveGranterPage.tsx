import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { Dayjs } from "dayjs";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { CompOffCreditRow } from "../../../api/leave";
import * as employeeApi from "../../../api/employee";
import { ImportDatasetTab } from "../import/ImportCenterPage";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title, Text } = Typography;

function useEmployeeOptions() {
  const { data } = useQuery({ queryKey: ["employees", "picker"], queryFn: () => employeeApi.listEmployees({ pageSize: 200, sortBy: "fullName", sortDir: "asc" }) });
  return (data?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }));
}

interface ManualGrantFormValues {
  employeeId: string;
  leaveTypeId: string;
  days: number;
  entryDate: Dayjs;
  remarks?: string;
}

function ManualGrantTab() {
  const [form] = Form.useForm<ManualGrantFormValues>();
  const queryClient = useQueryClient();
  const employeeOptions = useEmployeeOptions();
  const { data: leaveTypes = [] } = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes });
  const nonCompOffTypes = leaveTypes.filter((t) => t.code !== "COF");

  const mutation = useMutation({
    mutationFn: (v: ManualGrantFormValues) => leaveApi.manualGrant({ employeeId: v.employeeId, leaveTypeId: v.leaveTypeId, days: v.days, entryDate: v.entryDate.format("YYYY-MM-DD"), remarks: v.remarks }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
      void message.success(`${r.entryType === "GRANT" ? "Credited" : "Debited"} ${Math.abs(r.days)} day(s) of ${r.leaveTypeCode}.`);
      form.resetFields();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not record this grant/debit.")),
  });

  return (
    <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => mutation.mutate(v)} style={{ maxWidth: 480 }}>
      <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
        A positive number credits the balance, a negative number debits it. For comp-off, use the Comp-Off Grant tab instead — it needs hours worked to compute expiry.
      </Text>
      <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
        <Select showSearch optionFilterProp="label" options={employeeOptions} placeholder="Select an employee" />
      </Form.Item>
      <Form.Item name="leaveTypeId" label="Leave Type" rules={[{ required: true }]}>
        <Select options={nonCompOffTypes.map((t) => ({ value: t.id, label: t.name }))} placeholder="Select a leave type" />
      </Form.Item>
      <Form.Item name="days" label="Days (positive = grant, negative = debit)" rules={[{ required: true }]}>
        <InputNumber style={{ width: "100%" }} step={0.5} />
      </Form.Item>
      <Form.Item name="entryDate" label="Entry Date" rules={[{ required: true }]}>
        <DatePicker style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item name="remarks" label="Remarks">
        <Input.TextArea rows={2} placeholder="Optional" />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
          Submit
        </Button>
      </Form.Item>
    </Form>
  );
}

interface CompOffGrantFormValues {
  employeeId: string;
  earnedDate: Dayjs;
  hoursWorked: number;
  remarks?: string;
}

const COMP_OFF_STATUS_COLORS: Record<string, string> = { AVAILABLE: "green", CONSUMED: "default", EXPIRED: "red" };

function CompOffGrantTab() {
  const [form] = Form.useForm<CompOffGrantFormValues>();
  const employeeOptions = useEmployeeOptions();
  const selectedEmployeeId = Form.useWatch("employeeId", form) as string | undefined;

  const { data: credits = [], refetch } = useQuery<CompOffCreditRow[]>({
    queryKey: ["leave", "comp-off", selectedEmployeeId],
    queryFn: () => leaveApi.listCompOffCredits(selectedEmployeeId!),
    enabled: !!selectedEmployeeId,
  });

  const mutation = useMutation({
    mutationFn: (v: CompOffGrantFormValues) => leaveApi.manualCompOffGrant({ employeeId: v.employeeId, earnedDate: v.earnedDate.format("YYYY-MM-DD"), hoursWorked: v.hoursWorked, remarks: v.remarks }),
    onSuccess: (r) => {
      void message.success(`Credited 1 comp-off day, expiring ${r.expiresOn}.`);
      form.resetFields(["earnedDate", "hoursWorked", "remarks"]);
      void refetch();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not credit this comp-off.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => mutation.mutate(v)} style={{ maxWidth: 480 }}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" options={employeeOptions} placeholder="Select an employee" />
        </Form.Item>
        <Form.Item name="earnedDate" label="Earned Date (the worked holiday/week-off)" rules={[{ required: true }]}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="hoursWorked" label="Hours Worked" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0} max={24} step={0.5} />
        </Form.Item>
        <Form.Item name="remarks" label="Remarks">
          <Input.TextArea rows={2} placeholder="Optional" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            Credit Comp-Off
          </Button>
        </Form.Item>
      </Form>

      {selectedEmployeeId && (
        <Table<CompOffCreditRow>
          rowKey="id"
          size="small"
          title={() => "This employee's comp-off lots"}
          dataSource={credits}
          pagination={false}
          locale={{ emptyText: <EmptyState message="No comp-off credits yet" compact /> }}
          columns={[
            { title: "Earned", dataIndex: "earnedDate" },
            { title: "Earned Days", dataIndex: "earnedDays" },
            { title: "Remaining", dataIndex: "remainingDays" },
            { title: "Expires", dataIndex: "expiresOn" },
            { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={COMP_OFF_STATUS_COLORS[v]}>{v}</Tag> },
            { title: "Source", dataIndex: "source" },
          ]}
        />
      )}
    </Space>
  );
}

export function LeaveGranterPage() {
  const [tab, setTab] = useState("manual");
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Leave Granter
      </Title>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "manual", label: "Manual Grant / Debit", children: <ManualGrantTab /> },
          { key: "comp-off", label: "Comp-Off Grant", children: <CompOffGrantTab /> },
          { key: "bulk", label: "Bulk Upload", children: <ImportDatasetTab dataset="leave-grants" /> },
        ]}
      />
    </Space>
  );
}
