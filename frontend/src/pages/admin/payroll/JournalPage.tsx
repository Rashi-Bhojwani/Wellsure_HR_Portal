import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import * as api from "../../../api/journal";
import * as payrollApi from "../../../api/payroll";
import type { Journal } from "../../../api/journal";
import { saveBlob } from "../../../api/muster";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, PageHeader, Panel, Stack, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Accounting journal (PY-41, docs/plans/A_PARITY_ROWS.md part 2), directors only. Each journal key (a pay head's earning, deduction, rounding or employer
// share, and net pay) is mapped to a ledger account by a director — none is preset. Once every key of a finalised run is mapped, the journal balances exactly and exports.
type Key = Journal["keys"][number];
type Account = Journal["accounts"][number];

export function JournalPage() {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const runs = useQuery({ queryKey: ["payroll", "runs", "journal"], queryFn: () => payrollApi.listRuns(1, 24) });
  const j = useQuery({ queryKey: ["payroll-journal", runId], queryFn: () => api.journalOfRun(runId!), enabled: !!runId });
  const save = useMutation({
    mutationFn: () => api.saveLedgerMappings(Object.entries(edits).filter(([, a]) => a.trim()).map(([key, account]) => ({ key, account: account.trim() })), reason.trim()),
    onSuccess: () => { toast.success("Mappings saved."); setEdits({}); setReason(""); void queryClient.invalidateQueries({ queryKey: ["payroll-journal"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save.")),
  });
  const doExport = async (format: "xlsx" | "csv") => {
    try {
      saveBlob(await api.exportJournal(runId!, format), `payroll-journal.${format}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not export."));
    }
  };
  const changed = Object.values(edits).some((a) => a.trim());
  return (
    <>
      <PageHeader
        title="Accounting journal"
        subtitle="A finalised run as debits and credits by ledger account. You map every account; none is preset."
        actions={<Select aria-label="Run" placeholder="Choose a finalised run" style={{ minWidth: 220 }} value={runId} onChange={setRunId} options={(runs.data?.items ?? []).filter((r) => r.status === "FINALISED").map((r) => ({ value: r.id, label: r.cycle.label }))} />}
      />
      <Stack>
        {!runId && <ApprovalBanner tone="info" title="Choose a finalised run" description="Paid and held people both count. No accounting package's import format is built." />}
        {runId && (
          <Panel title="Journal keys" subtitle={j.data?.notSet.length ? `${j.data.notSet.length} key(s) Not set` : "Every key is mapped"}>
            <DataTable<Key>
              rowKey="key"
              loading={j.isLoading}
              error={j.error}
              onRetry={() => void j.refetch()}
              dataSource={j.data?.keys ?? []}
              pagination={false}
              mobile={{ title: (k) => k.key, subtitle: (k) => k.account ?? "Not set" }}
              columns={[
                { title: "Key", dataIndex: "key" },
                { title: "Debit", dataIndex: "debit", align: "right", render: (x: string) => formatRupees(x, 2) },
                { title: "Credit", dataIndex: "credit", align: "right", render: (x: string) => formatRupees(x, 2) },
                {
                  title: "Account",
                  key: "a",
                  render: (_, k) => (
                    <div style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
                      {!k.account && <StatusChip tone="warning">Not set</StatusChip>}
                      <Input aria-label={`Account for ${k.key}`} placeholder={k.account ?? "Ledger account"} value={edits[k.key] ?? ""} onChange={(e) => setEdits((s) => ({ ...s, [k.key]: e.target.value }))} style={{ minWidth: 200 }} />
                    </div>
                  ),
                },
              ]}
            />
            <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", marginTop: space[3] }}>
              <Input aria-label="Reason" placeholder="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 240, flex: 1 }} />
              <Button type="primary" disabled={!changed || reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Save mappings</Button>
            </div>
          </Panel>
        )}
        {runId && j.data && j.data.notSet.length === 0 && (
          <Panel
            title={`By account, ${j.data.run}`}
            extra={
              <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                <Button icon={<DownloadOutlined />} onClick={() => void doExport("xlsx")}>Export .xlsx</Button>
                <Button icon={<DownloadOutlined />} onClick={() => void doExport("csv")}>Export .csv</Button>
              </div>
            }
          >
            <DataTable<Account>
              rowKey="account"
              dataSource={j.data.accounts}
              pagination={false}
              columns={[
                { title: "Account", dataIndex: "account" },
                { title: "Debit", dataIndex: "debit", align: "right", render: (x: string) => formatRupees(x, 2) },
                { title: "Credit", dataIndex: "credit", align: "right", render: (x: string) => formatRupees(x, 2) },
              ]}
              footer={() => <div style={{ textAlign: "right" }}><strong>Total {formatRupees(j.data!.totalDebit, 2)} debit = {formatRupees(j.data!.totalCredit, 2)} credit</strong></div>}
            />
          </Panel>
        )}
      </Stack>
    </>
  );
}

export default JournalPage;
