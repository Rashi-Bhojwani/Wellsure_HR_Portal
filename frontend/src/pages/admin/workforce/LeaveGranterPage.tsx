import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, Select, Tabs } from "antd";
import type { Dayjs } from "dayjs";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { CompOffCreditRow } from "../../../api/leave";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { ImportDatasetTab } from "../import/ImportCenterPage";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, StatusChip, toast, useIsPhone, type ChipTone } from "../../../ui";

function SubmitRow({ children }: { children: React.ReactNode }) {
  const phone = useIsPhone();
  return <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: space[2] }}>{phone ? <div style={{ width: "100%" }}>{children}</div> : children}</div>;
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
  const phone = useIsPhone();
  const { data: leaveTypes = [] } = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes, staleTime: 30_000 });
  const nonCompOffTypes = leaveTypes.filter((t) => t.code !== "COF");

  const mutation = useMutation({
    mutationFn: (val: ManualGrantFormValues) => leaveApi.manualGrant({ employeeId: val.employeeId, leaveTypeId: val.leaveTypeId, days: val.days, entryDate: val.entryDate.format("YYYY-MM-DD"), remarks: val.remarks }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
      toast.success(`${r.entryType === "GRANT" ? "Credited" : "Debited"} ${Math.abs(r.days)} day(s) of ${r.leaveTypeCode}.`);
      form.resetFields();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record this grant/debit.")),
  });

  return (
    <div style={{ maxWidth: 640 }}>
      <ApprovalBanner
        tone="info"
        title="A positive number credits the balance, a negative number debits it."
        description="For comp-off, use the Comp-Off Grant tab instead — it needs hours worked to compute expiry."
        style={{ marginBottom: space[5] }}
      />
      <Form form={form} layout="vertical" requiredMark={false} size="large" onFinish={(val) => mutation.mutate(val)}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
          <EmployeePicker />
        </Form.Item>
        <Form.Item name="leaveTypeId" label="Leave Type" rules={[{ required: true }]}>
          <Select options={nonCompOffTypes.map((t) => ({ value: t.id, label: t.name }))} placeholder="Select a leave type" />
        </Form.Item>
        <div style={{ display: "flex", gap: space[4], flexWrap: phone ? "wrap" : "nowrap" }}>
          <Form.Item name="days" label="Days (positive = grant, negative = debit)" rules={[{ required: true }]} style={{ flex: "1 1 240px" }}>
            <InputNumber style={{ width: "100%" }} step={0.5} />
          </Form.Item>
          <Form.Item name="entryDate" label="Entry Date" rules={[{ required: true }]} style={{ flex: "1 1 200px" }}>
            <DatePicker style={{ width: "100%" }} format="DD MMM YYYY" />
          </Form.Item>
        </div>
        <Form.Item name="remarks" label="Remarks">
          <Input.TextArea rows={2} placeholder="Optional" />
        </Form.Item>
        <SubmitRow>
          <Button type="primary" htmlType="submit" loading={mutation.isPending} block={phone} style={{ minWidth: 140 }}>
            Submit
          </Button>
        </SubmitRow>
      </Form>
    </div>
  );
}

interface CompOffGrantFormValues {
  employeeId: string;
  earnedDate: Dayjs;
  hoursWorked: number;
  remarks?: string;
}

const COMP_OFF_TONE: Record<string, ChipTone> = { AVAILABLE: "success", CONSUMED: "neutral", EXPIRED: "danger" };

function CompOffGrantTab() {
  const [form] = Form.useForm<CompOffGrantFormValues>();
  const phone = useIsPhone();
  const selectedEmployeeId = Form.useWatch("employeeId", form) as string | undefined;

  const { data: credits = [], isLoading, error, refetch } = useQuery<CompOffCreditRow[]>({
    queryKey: ["leave", "comp-off", selectedEmployeeId],
    queryFn: () => leaveApi.listCompOffCredits(selectedEmployeeId!),
    enabled: !!selectedEmployeeId,
  });

  const mutation = useMutation({
    mutationFn: (val: CompOffGrantFormValues) => leaveApi.manualCompOffGrant({ employeeId: val.employeeId, earnedDate: val.earnedDate.format("YYYY-MM-DD"), hoursWorked: val.hoursWorked, remarks: val.remarks }),
    onSuccess: (r) => {
      toast.success(`Credited 1 comp-off day, expiring ${r.expiresOn}.`);
      form.resetFields(["earnedDate", "hoursWorked", "remarks"]);
      void refetch();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not credit this comp-off.")),
  });

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space[6], alignItems: "flex-start" }}>
      <Form form={form} layout="vertical" requiredMark={false} size="large" onFinish={(val) => mutation.mutate(val)} style={{ flex: "1 1 360px", maxWidth: 560 }}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
          <EmployeePicker />
        </Form.Item>
        <div style={{ display: "flex", gap: space[4], flexWrap: phone ? "wrap" : "nowrap" }}>
          <Form.Item name="earnedDate" label="Earned Date (the worked holiday/week-off)" rules={[{ required: true }]} style={{ flex: "1 1 220px" }}>
            <DatePicker style={{ width: "100%" }} format="DD MMM YYYY" />
          </Form.Item>
          <Form.Item name="hoursWorked" label="Hours Worked" rules={[{ required: true }]} style={{ flex: "1 1 160px" }}>
            <InputNumber style={{ width: "100%" }} min={0} max={24} step={0.5} />
          </Form.Item>
        </div>
        <Form.Item name="remarks" label="Remarks">
          <Input.TextArea rows={2} placeholder="Optional" />
        </Form.Item>
        <SubmitRow>
          <Button type="primary" htmlType="submit" loading={mutation.isPending} block={phone} style={{ minWidth: 160 }}>
            Credit Comp-Off
          </Button>
        </SubmitRow>
      </Form>

      <div style={{ flex: "1 1 420px", minWidth: 0 }}>
        <div style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, marginBottom: space[3] }}>This employee's comp-off lots</div>
        {selectedEmployeeId ? (
          <DataTable<CompOffCreditRow>
            rowKey="id"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={credits}
            pagination={false}
            empty={<EmptyState compact illustration="inbox" title="No comp-off credits yet" description={null} />}
            mobile={{
              title: (r) => `Earned ${r.earnedDate}`,
              subtitle: (r) => `Expires ${r.expiresOn} · ${r.source}`,
              status: (r) => <StatusChip tone={COMP_OFF_TONE[r.status] ?? "neutral"}>{r.status}</StatusChip>,
              fields: [
                { label: "Earned days", render: (r) => r.earnedDays },
                { label: "Remaining", render: (r) => r.remainingDays },
              ],
            }}
            columns={[
              { title: "Earned", dataIndex: "earnedDate" },
              { title: "Earned Days", dataIndex: "earnedDays", align: "right" },
              { title: "Remaining", dataIndex: "remainingDays", align: "right" },
              { title: "Expires", dataIndex: "expiresOn" },
              { title: "Status", dataIndex: "status", render: (s: string) => <StatusChip tone={COMP_OFF_TONE[s] ?? "neutral"}>{s}</StatusChip> },
              { title: "Source", dataIndex: "source" },
            ]}
          />
        ) : (
          <EmptyState compact illustration="people" title="Pick an employee" description="Their comp-off lots (earned, remaining, expiry) show here." />
        )}
      </div>
    </div>
  );
}

export function LeaveGranterPage() {
  const [tab, setTab] = useState("manual");
  return (
    <>
      <PageHeader title="Leave Granter" subtitle="Credit or debit leave by hand, grant comp-off, or upload grants in bulk. Every entry goes on the leave ledger." />
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: "manual", label: "Manual Grant / Debit", children: <ManualGrantTab /> },
            { key: "comp-off", label: "Comp-Off Grant", children: <CompOffGrantTab /> },
            { key: "bulk", label: "Bulk Upload", children: <ImportDatasetTab dataset="leave-grants" /> },
          ]}
        />
      </Panel>
    </>
  );
}
