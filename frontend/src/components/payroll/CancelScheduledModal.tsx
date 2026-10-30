import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Descriptions, Input, Modal, Space, Table, Typography } from "antd";
import { SkeletonCard } from "../../ui";
import * as payrollApi from "../../api/payroll";
import type { CancelPlanView } from "../../api/payroll";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { formatRupees } from "../../lib/money";
import { CheckersNote } from "./CheckersNote";

const { Text } = Typography;

/** What cancelling a scheduled salary does, in one picture: the row that goes, and the salary that stays in force with no end date. */
export function CancelPlanBlock({ plan, componentName }: { plan: CancelPlanView; componentName: (c: string) => string }) {
  const table = (lines: Array<{ component: string; amount: string }>) => (
    <Table size="small" pagination={false} rowKey="component" dataSource={lines} columns={[{ title: "Line", render: (_, l) => componentName(l.component) }, { title: "A month", align: "right", className: "ws-num", render: (_, l) => formatRupees(l.amount, 2) }]} />
  );
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Text strong>{plan.name} ({plan.employeeCode})</Text>
      {plan.problems.length > 0 && <Alert type="error" showIcon title="This cannot go ahead" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{plan.problems.map((p) => <li key={p}>{p}</li>)}</ul>} />}
      {plan.scheduled && (
        <div>
          <Alert type="warning" showIcon title={`Removed: the salary that would start on ${formatDate(plan.scheduled.startsOn)}`} description={`${formatRupees(plan.scheduled.annualCtc)} a year, ${formatRupees(plan.scheduled.monthlyCtc)} a month, on ${plan.scheduled.structure}.`} style={{ marginBottom: 8 }} />
          {table(plan.scheduled.lines)}
        </div>
      )}
      {plan.stays && (
        <div>
          <Alert type="success" showIcon title={`Stays in force: the salary that started on ${formatDate(plan.stays.startedOn)}, with no end date`} description={`${formatRupees(plan.stays.annualCtc)} a year, ${formatRupees(plan.stays.monthlyCtc)} a month, on ${plan.stays.structure}.`} style={{ marginBottom: 8 }} />
          {table(plan.stays.lines)}
        </div>
      )}
    </Space>
  );
}

/**
 * Cancelling a salary that has been written but has not started. Cancelling a raise is a pay change like any other, so it is previewed, a director approves
 * exactly these figures, and only then is it removed: this dialog prepares and submits it, and the revision page is where it is decided and applied.
 */
export function CancelScheduledModal({ employeeId, salaryId, componentName, onClose, onSubmitted }: { employeeId: string; salaryId: string; componentName: (c: string) => string; onClose: () => void; onSubmitted: (revisionId: string) => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "cancel-preview", employeeId, salaryId], queryFn: () => payrollApi.previewCancelScheduled({ employeeId, salaryId }), retry: false });
  const submit = useMutation({
    mutationFn: () => payrollApi.createCancelScheduled({ employeeId, salaryId, note: note.trim() }, data!.fingerprint),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["payroll"] });
      onSubmitted(id);
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not work.")),
  });
  return (
    <Modal open width={760} title="Cancel a scheduled salary" onCancel={onClose} okText="Submit for approval" okButtonProps={{ disabled: !data?.canSubmit || note.trim().length < 3, loading: submit.isPending }} onOk={() => submit.mutate()} destroyOnHidden>
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {isLoading && <SkeletonCard lines={4} />}
        {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not prepare the cancellation.")} />}
        {data && (
          <>
            <CancelPlanBlock plan={data} componentName={componentName} />
            {data.blockers.length > 0 && <Alert type="error" showIcon title="It cannot be submitted yet" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>} />}
            <CheckersNote checkers={data.checkers} what="this cancellation" />
            <Descriptions size="small" column={1} items={[{ key: "w", label: "What happens next", children: "A director approves exactly what is shown above. Nothing changes until they have, and then you apply it. If this person's salary changes in between, the approval is void." }]} />
            <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Why this scheduled salary is being cancelled (required: the person who approves it will read this)" />
            {problem && <Alert type="error" showIcon title={problem} />}
          </>
        )}
      </Space>
    </Modal>
  );
}
