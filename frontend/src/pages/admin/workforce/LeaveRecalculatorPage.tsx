import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select } from "antd";
import type { Dayjs } from "dayjs";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { RecalcAction, RecalcEmployeeResult } from "../../../api/leave";
import * as employeeApi from "../../../api/employee";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, PageHeader, Panel, Stack, StatusChip, StepperLayout, toast, useIsPhone } from "../../../ui";

const CONFIRM_PHRASE = "APPLY RECALCULATION";

function useEmployeeOptions() {
  const { data } = useQuery({ queryKey: ["employees", "picker"], queryFn: () => employeeApi.listEmployees({ pageSize: 200, sortBy: "fullName", sortDir: "asc" }), staleTime: 30_000 });
  return (data?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }));
}

interface FormValues {
  employeeIds: string[];
  fromDate: Dayjs;
}

function actionChip(action: RecalcAction) {
  return action.type === "CREDIT" ? (
    <StatusChip tone="success">
      +{action.days} {action.leaveTypeCode} ({action.accrualMonth.slice(0, 7)})
    </StatusChip>
  ) : (
    <StatusChip tone="danger">
      -{action.days} {action.leaveTypeCode} ({action.accrualMonth.slice(0, 7)})
    </StatusChip>
  );
}

function Actions({ actions }: { actions: RecalcAction[] }) {
  return actions.length === 0 ? (
    <span style={{ color: v.textSecondary }}>No changes needed</span>
  ) : (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] }}>
      {actions.map((a, i) => (
        <span key={i}>{actionChip(a)}</span>
      ))}
    </div>
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
  const phone = useIsPhone();
  const employeeOptions = useEmployeeOptions();
  const [results, setResults] = useState<RecalcEmployeeResult[] | null>(null);
  const [lastParams, setLastParams] = useState<{ employeeIds: string[]; fromDate: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applied, setApplied] = useState(false);

  const previewMutation = useMutation({
    mutationFn: (val: FormValues) => leaveApi.previewRecalculation(val.employeeIds, val.fromDate.startOf("month").format("YYYY-MM-DD")),
    onSuccess: (data, val) => {
      setResults(data);
      setApplied(false);
      setLastParams({ employeeIds: val.employeeIds, fromDate: val.fromDate.startOf("month").format("YYYY-MM-DD") });
      setConfirmText("");
      const changed = data.filter((r) => r.actions.length > 0).length;
      toast.success(changed > 0 ? `${changed} of ${data.length} employee(s) have corrections to apply.` : "No corrections needed — every selected employee's ledger already matches.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not generate a preview.")),
  });

  const commitMutation = useMutation({
    mutationFn: () => leaveApi.commitRecalculation(lastParams!.employeeIds, lastParams!.fromDate, confirmText),
    onSuccess: (data) => {
      setResults(data);
      setConfirmText("");
      setConfirmOpen(false);
      setApplied(true);
      toast.success("Recalculation applied — ledger corrections written.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not apply the recalculation.")),
  });

  const totalChanged = results?.filter((r) => r.actions.length > 0).length ?? 0;
  const totalActions = results?.reduce((s, r) => s + r.actions.length, 0) ?? 0;
  const step = !results ? 0 : applied ? 2 : 1;

  return (
    <>
      <PageHeader title="Leave Recalculator" subtitle="Replay accrual after a policy change, a corrected date of joining or a backdated approval" />
      <Stack>
        <HelpStrip storageKey="leave-recalculator">
          Recomputes PL-style accrual for the selected employees after a policy change, a corrected date of joining, or a backdated approval — preview first, then apply. Commit always re-checks the ledger fresh at
          write time, so it's safe to preview once and apply later even if other changes have happened in the meantime.
        </HelpStrip>

        <Panel>
          <StepperLayout variant="numbered" steps={["Choose employees", "Review preview", "Apply"]} current={step}>
            <Form form={form} layout="vertical" requiredMark={false} size="large" onFinish={(val) => previewMutation.mutate(val)}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: space[4] }}>
                <Form.Item name="employeeIds" label="Employees" rules={[{ required: true }]} style={{ flex: "1 1 360px", marginBottom: 0 }}>
                  <Select mode="multiple" showSearch optionFilterProp="label" options={employeeOptions} placeholder="Select one or more employees" maxTagCount="responsive" />
                </Form.Item>
                <Form.Item name="fromDate" label="Recompute From" rules={[{ required: true }]} style={{ flex: phone ? "1 1 100%" : "0 0 200px", marginBottom: 0 }}>
                  <DatePicker picker="month" style={{ width: "100%" }} format="MMM YYYY" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={previewMutation.isPending} block={phone}>
                  Preview
                </Button>
              </div>
            </Form>
          </StepperLayout>
        </Panel>

        {results && (
          <Panel title={applied ? "Applied results" : "Preview results"} subtitle={`${totalChanged} of ${results.length} employee(s) with corrections · ${totalActions} action(s)`}>
            <Stack gap={space[4]}>
              <DataTable<RecalcEmployeeResult>
                rowKey="employeeId"
                dataSource={results}
                pagination={false}
                empty={<EmptyState compact title="No employees selected" description={null} />}
                mobile={{
                  title: (r) => r.employeeName,
                  subtitle: (r) => r.employeeCode,
                  fields: [{ label: "Actions", render: (r) => <Actions actions={r.actions} /> }],
                }}
                columns={[
                  { title: "Employee Code", dataIndex: "employeeCode", width: 140 },
                  { title: "Employee", dataIndex: "employeeName" },
                  { title: "Actions", dataIndex: "actions", render: (actions: RecalcAction[]) => <Actions actions={actions} /> },
                ]}
              />

              {totalChanged > 0 && !applied && (
                <ApprovalBanner
                  tone="warning"
                  title="Applying writes ledger CREDIT/REVERSAL entries for every action above."
                  description="The ledger is append-only — a mistaken correction needs another correction to undo."
                  actions={
                    <Button type="primary" danger onClick={() => setConfirmOpen(true)}>
                      Apply Recalculation…
                    </Button>
                  }
                />
              )}
              {applied && <ApprovalBanner tone="success" title="Recalculation applied — ledger corrections written." />}
            </Stack>
          </Panel>
        )}
      </Stack>

      <ConfirmModal
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => commitMutation.mutate()}
        title="Apply this recalculation?"
        description={`${totalActions} ledger correction(s) for ${totalChanged} employee(s). The ledger is re-checked at write time.`}
        confirmLabel="Apply Recalculation"
        danger
        loading={commitMutation.isPending}
        confirmDisabled={confirmText !== CONFIRM_PHRASE}
      >
        <label htmlFor="recalc-confirm" style={{ display: "block", fontWeight: fw.medium, marginBottom: space[2] }}>
          Type “{CONFIRM_PHRASE}” to confirm
        </label>
        <Input id="recalc-confirm" size="large" placeholder={`Type "${CONFIRM_PHRASE}" to confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
      </ConfirmModal>
    </>
  );
}
