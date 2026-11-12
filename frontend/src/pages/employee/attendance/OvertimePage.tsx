import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker } from "antd";
import dayjs from "dayjs";
import * as api from "../../../api/overtime";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, StatusChip, toast, useIsPhone } from "../../../ui";

// M session block 2, AT-19: my days with overtime (time beyond my shift, from my attendance) and my claims. Only when the directors use overtime.
const TONE: Record<api.ClaimStatus, "info" | "success" | "danger" | "neutral"> = { PENDING: "info", APPROVED: "success", REJECTED: "danger", WITHDRAWN: "neutral" };
const LABEL: Record<api.ClaimStatus, string> = { PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Not approved", WITHDRAWN: "Withdrawn" };

export function OvertimePage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const q = useQuery({ queryKey: ["overtime", "mine", month], queryFn: () => api.myOvertime(month) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["overtime"] });
  const claim = useMutation({ mutationFn: (date: string) => api.claimOvertime(date, ""), onSuccess: () => { toast.success("Claimed. You are told when it is decided."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not claim it.")) });
  const withdraw = useMutation({ mutationFn: api.withdrawOvertime, onSuccess: () => { toast.success("Withdrawn."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not withdraw it.")) });
  const action = (d: api.MyOvertimeDay) =>
    !d.claim || d.claim.status === "WITHDRAWN" || d.claim.status === "REJECTED" ? (
      d.eligibleMinutes > 0 && (!d.claim || d.claim.status === "WITHDRAWN") ? <Button type="primary" block={phone} loading={claim.isPending && claim.variables === d.date} onClick={() => claim.mutate(d.date)} aria-label={`Claim overtime on ${d.date}`}>Claim</Button> : null
    ) : d.claim.status === "PENDING" ? <Button block={phone} onClick={() => withdraw.mutate(d.claim!.id)} aria-label={`Withdraw the claim for ${d.date}`}>Withdraw</Button> : null;
  const status = (d: api.MyOvertimeDay) => (d.claim ? <StatusChip tone={TONE[d.claim.status]}>{LABEL[d.claim.status]}</StatusChip> : <StatusChip tone="neutral">Not claimed</StatusChip>);
  return (
    <>
      <PageHeader title="Overtime" subtitle={q.data?.policy ? `Time beyond your shift counts from ${q.data.policy.minimumMinutes} minutes, in steps of ${q.data.policy.roundToMinutes}.` : "Time worked beyond your shift."} actions={<DatePicker picker="month" value={dayjs(`${month}-01`)} onChange={(d) => d && setMonth(d.format("YYYY-MM"))} allowClear={false} aria-label="Month" />} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={!!q.data && !q.data.active} empty={<EmptyState title="Overtime is not in use" description="The company does not use overtime claims." />}>
        <Panel>
          <DataTable<api.MyOvertimeDay>
            rowKey="date"
            dataSource={q.data?.days ?? []}
            pagination={false}
            empty={<EmptyState compact title="No overtime this month" description={null} />}
            columns={[
              { title: "Day", dataIndex: "date", render: (x: string) => formatDate(x) },
              { title: "Beyond the shift", dataIndex: "excessMinutes", render: (x: number) => api.hm(x) },
              { title: "Counts", key: "c", render: (_, d) => api.hm(d.claim?.status === "APPROVED" ? d.claim.minutes : d.eligibleMinutes) },
              { title: "Status", key: "s", render: (_, d) => <span>{status(d)}{d.claim?.decisionNote ? ` ${d.claim.decisionNote}` : ""}</span> },
              { title: "", key: "a", align: "right", render: (_, d) => action(d) },
            ]}
            mobile={{ title: (d) => formatDate(d.date), subtitle: (d) => `Counts ${api.hm(d.eligibleMinutes)}`, status, actions: (d) => action(d) }}
          />
        </Panel>
      </QueryState>
    </>
  );
}
