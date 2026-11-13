import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import * as api from "../../../api/retention";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { ConfirmModal, DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, QueryState, Stack, StatusChip, toast } from "../../../ui";

// M session block 2, AD-07: former employees whose records are past the retention period. The periods are the owners' choice (Policy settings,
// Not set: nothing is ever due). One director proposes an erasure, a different director confirms it; it cannot be undone. Payroll and tax records,
// and pay or statutory documents, are never erased here.
export function DataRetentionPage() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<api.DueRow | null>(null);
  const q = useQuery({ queryKey: ["retention"], queryFn: api.retentionDue });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["retention"] });
  const propose = useMutation({ mutationFn: (r: api.DueRow) => api.proposeErasure(r.employeeId, r.category), onSuccess: () => { toast.success("Proposed. A different director confirms it."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not propose it.")) });
  const confirm = useMutation({ mutationFn: (id: string) => api.confirmErasure(id), onSuccess: (r) => { toast.success(`Erased (${r.items} item(s)).`); setConfirming(null); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not erase it.")) });
  const action = (r: api.DueRow) =>
    !r.proposal ? <Button onClick={() => propose.mutate(r)} loading={propose.isPending && propose.variables?.employeeId === r.employeeId && propose.variables.category === r.category}>Propose erasure</Button>
    : r.proposal.mine ? <StatusChip tone="warning">Waiting for the other director</StatusChip>
    : <Button danger type="primary" onClick={() => setConfirming(r)}>Confirm erasure</Button>;
  const periods = q.data?.periods;
  return (
    <>
      <PageHeader title="Data retention" subtitle="Former employees' records past the retention period. Erasing needs two directors and cannot be undone." />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        <Stack>
          <Panel title="Periods" extra={<Link to="/admin/settings/policies">Change in Policy settings</Link>}>
            <KeyValueGrid columns={2} items={[{ label: api.CATEGORY_LABEL.CONTACT, value: periods?.contactMonths ? `${periods.contactMonths} months after leaving` : "Not set (kept)" }, { label: api.CATEGORY_LABEL.DOCUMENTS, value: periods?.documentsMonths ? `${periods.documentsMonths} months after leaving` : "Not set (kept)" }, { label: api.CATEGORY_LABEL.HELPDESK, value: periods?.helpdeskMonths ? `${periods.helpdeskMonths} months after leaving` : "Not set (kept)" }]} />
          </Panel>
          <Panel title="Due for erasure">
            <DataTable<api.DueRow> rowKey={(r) => `${r.employeeId}-${r.category}`} dataSource={q.data?.due ?? []} pagination={(q.data?.due.length ?? 0) > 25 ? { pageSize: 25 } : false}
              empty={<EmptyState compact title="Nothing is due" description={periods?.contactMonths || periods?.documentsMonths || periods?.helpdeskMonths ? null : "No period is set, so nothing is ever due."} />}
              columns={[
                { title: "Former employee", key: "e", render: (_, r) => `${r.fullName} (${r.employeeCode})` },
                { title: "Left on", dataIndex: "lastWorkingDate", render: (x: string) => formatDate(x) },
                { title: "Records", key: "c", render: (_, r) => api.CATEGORY_LABEL[r.category] },
                { title: "", key: "a", align: "right", render: (_, r) => action(r) },
              ]}
              mobile={{ title: (r) => r.fullName, subtitle: (r) => api.CATEGORY_LABEL[r.category], actions: action }} />
          </Panel>
        </Stack>
      </QueryState>
      <ConfirmModal open={!!confirming} danger title="Erase these records?" confirmLabel="Erase" loading={confirm.isPending} description={confirming ? `${confirming.fullName}: ${api.CATEGORY_LABEL[confirming.category]}. This cannot be undone.` : undefined} onCancel={() => setConfirming(null)} onConfirm={() => confirming?.proposal && confirm.mutate(confirming.proposal.id)} />
    </>
  );
}
