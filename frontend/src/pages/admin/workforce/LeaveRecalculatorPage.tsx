import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Form, Input, Select, Space, Table, Tag, Typography, message } from "antd";
import type { Dayjs } from "dayjs";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { RecalcAction, RecalcEmployeeResult } from "../../../api/leave";
import * as employeeApi from "../../../api/employee";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title, Text } = Typography;

function useEmployeeOptions() {
  const { data } = useQuery({ queryKey: ["employees", "picker"], queryFn: () => employeeApi.listEmployees({ pageSize: 200, sortBy: "fullName", sortDir: "asc" }) });
  return (data?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }));
}

interface FormValues {
  employeeIds: string[];
  fromDate: Dayjs;
}

function actionTag(action: RecalcAction) {
  return action.type === "CREDIT" ? (
    <Tag color="green">+{action.days} {action.leaveTypeCode} ({action.accrualMonth.slice(0, 7)})</Tag>
  ) : (
    <Tag color="red">-{action.days} {action.leaveTypeCode} ({action.accrualMonth.slice(0, 7)})</Tag>
  );
}

// Leave Recalculator (spec §5.4) — replays accrual for the selected
// employees from `fromDate` through the current month against each
// employee's *current* DOJ and policy, producing CREDIT (missing
// accrual) or REVERSE (wrongly-credited accrual) actions. Preview is a
// pure dry run; commit re-diffs fresh at write time rather than trusting
// the preview snapshot — see modules/leave/recalculator.ts.
export function LeaveRecalculatorPage() {
  const [form] = Form.useForm<FormValues>();
  const employeeOptions = useEmployeeOptions();
  const [results, setResults] = useState<RecalcEmployeeResult[] | null>(null);
  const [lastParams, setLastParams] = useState<{ employeeIds: string[]; fromDate: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const previewMutation = useMutation({
    mutationFn: (v: FormValues) => leaveApi.previewRecalculation(v.employeeIds, v.fromDate.startOf("month").format("YYYY-MM-DD")),
    onSuccess: (data, v) => {
      setResults(data);
      setLastParams({ employeeIds: v.employeeIds, fromDate: v.fromDate.startOf("month").format("YYYY-MM-DD") });
      setConfirmText("");
      const changed = data.filter((r) => r.actions.length > 0).length;
      void message.success(changed > 0 ? `${changed} of ${data.length} employee(s) have corrections to apply.` : "No corrections needed — every selected employee's ledger already matches.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not generate a preview.")),
  });

  const commitMutation = useMutation({
    mutationFn: () => leaveApi.commitRecalculation(lastParams!.employeeIds, lastParams!.fromDate, confirmText),
    onSuccess: (data) => {
      setResults(data);
      setConfirmText("");
      void message.success("Recalculation applied — ledger corrections written.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not apply the recalculation.")),
  });

  const totalChanged = results?.filter((r) => r.actions.length > 0).length ?? 0;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Leave Recalculator
      </Title>
      <HelpStrip storageKey="leave-recalculator">
        Recomputes PL-style accrual for the selected employees after a policy change, a corrected date of joining, or
        a backdated approval — preview first, then apply. Commit always re-checks the ledger fresh at write time, so
        it's safe to preview once and apply later even if other changes have happened in the meantime.
      </HelpStrip>

      <Card size="small">
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => previewMutation.mutate(v)}>
          <Space wrap align="end" size={16}>
            <Form.Item name="employeeIds" label="Employees" rules={[{ required: true }]} style={{ minWidth: 360, marginBottom: 0 }}>
              <Select mode="multiple" showSearch optionFilterProp="label" options={employeeOptions} placeholder="Select one or more employees" maxTagCount="responsive" />
            </Form.Item>
            <Form.Item name="fromDate" label="Recompute From" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
              <DatePicker picker="month" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={previewMutation.isPending}>
                Preview
              </Button>
            </Form.Item>
          </Space>
        </Form>
      </Card>

      {results && (
        <Card size="small" title="Preview results">
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Table<RecalcEmployeeResult>
              rowKey="employeeId"
              size="small"
              dataSource={results}
              pagination={false}
              locale={{ emptyText: <EmptyState message="No employees selected" compact /> }}
              columns={[
                { title: "Employee Code", dataIndex: "employeeCode" },
                { title: "Employee", dataIndex: "employeeName" },
                {
                  title: "Actions",
                  dataIndex: "actions",
                  render: (actions: RecalcAction[]) =>
                    actions.length === 0 ? (
                      <Text type="secondary">No changes needed</Text>
                    ) : (
                      <Space size={4} wrap>
                        {actions.map((a, i) => (
                          <span key={i}>{actionTag(a)}</span>
                        ))}
                      </Space>
                    ),
                },
              ]}
            />

            {totalChanged > 0 && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message='Applying writes ledger CREDIT/REVERSAL entries for every action above. Type "APPLY RECALCULATION" to confirm.'
                />
                <Space wrap>
                  <Input
                    placeholder='Type "APPLY RECALCULATION" to confirm'
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    style={{ width: 280 }}
                  />
                  <Button
                    type="primary"
                    danger
                    disabled={confirmText !== "APPLY RECALCULATION"}
                    loading={commitMutation.isPending}
                    onClick={() => commitMutation.mutate()}
                  >
                    Apply Recalculation
                  </Button>
                </Space>
              </>
            )}
          </Space>
        </Card>
      )}
    </Space>
  );
}
