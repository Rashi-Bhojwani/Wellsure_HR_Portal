import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, InputNumber } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { YearEndRunItemRow, YearEndRunRow, YearEndRunStatus } from "../../../api/leave";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { ProvisionalRateAlert } from "../../../components/leave/ProvisionalRateAlert";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, PageHeader, Panel, SkeletonTable, Stack, StatusChip, StepperLayout, toast, useIsPhone, type ChipTone } from "../../../ui";

const STATUS_TONE: Record<YearEndRunStatus, ChipTone> = { PREVIEW: "warning", SUPERSEDED: "neutral", COMMITTED: "success" };
const CONFIRM_PHRASE = "COMMIT YEAR END";
const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// Year End Process (spec §5.4/§5.5) — preview -> discard/re-preview ->
// commit. A run stays PREVIEW until explicitly committed or discarded
// (superseded); generating a new preview for a year that already has one
// automatically supersedes the old one — see modules/leave/yearEnd.ts.
// Audited and financial: nothing here is optimistic; buttons stay loading until the server answers.
export function YearEndProcessPage() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [leaveYear, setLeaveYear] = useState(new Date().getFullYear());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: runs = [], isLoading, error, refetch } = useQuery({ queryKey: ["leave", "year-end", "runs"], queryFn: () => leaveApi.listYearEndRuns() });
  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ["leave", "year-end", "run", selectedRunId],
    queryFn: () => leaveApi.getYearEndRun(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const previewMutation = useMutation({
    mutationFn: () => leaveApi.previewYearEnd(leaveYear),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "year-end", "runs"] });
      setSelectedRunId(run.id);
      toast.success(`Preview generated: ${run.totalEmployees} employee(s), ${money(run.totalEncashedAmount)} total.`);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not generate a preview.")),
  });

  const discardMutation = useMutation({
    mutationFn: (id: string) => leaveApi.discardYearEndRun(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "year-end", "runs"] });
      toast.success("Preview discarded.");
      setDiscardOpen(false);
      setSelectedRunId(null);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not discard this preview.")),
  });

  const commitMutation = useMutation({
    mutationFn: (id: string) => leaveApi.commitYearEndRun(id, confirmText),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "year-end", "runs"] });
      void queryClient.invalidateQueries({ queryKey: ["leave", "year-end", "run", selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
      toast.success("Year end committed — encashment entries written.");
      setConfirmText("");
      setCommitOpen(false);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not commit this run — balances may have drifted since preview.")),
  });

  async function downloadReport(id: string, run: YearEndRunRow) {
    setDownloading(id);
    try {
      const blob = await leaveApi.downloadYearEndReport(id);
      saveBlob(blob, `year-end-${run.leaveYear}-${run.status.toLowerCase()}.xlsx`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not download the report."));
    } finally {
      setDownloading(null);
    }
  }

  const step = !detail ? 0 : detail.status === "COMMITTED" ? 2 : 1;

  return (
    <>
      <PageHeader title="Year End Process" subtitle="PL encashment and reset for a leave year — preview, review, then commit" />
      <Stack>
        <HelpStrip storageKey="year-end-process">
          Generate a preview of PL encashment for a leave year, review it, then commit — commit re-checks every balance against the ledger and rejects the whole run if anything changed since preview. A new preview for
          the same year supersedes any existing one.
        </HelpStrip>

        <Panel>
          <StepperLayout variant="numbered" steps={["Generate preview", "Review", "Commit"]} current={step}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: space[4] }}>
              <label style={{ display: "flex", flexDirection: "column", gap: space[2], flex: phone ? "1 1 100%" : undefined }}>
                <span style={{ fontSize: fs.md, fontWeight: fw.medium, color: v.textPrimary }}>Leave Year</span>
                <InputNumber size="large" value={leaveYear} onChange={(val) => setLeaveYear(val ?? new Date().getFullYear())} min={2000} max={2100} style={{ width: phone ? "100%" : 140 }} />
              </label>
              <Button type="primary" size="large" loading={previewMutation.isPending} onClick={() => previewMutation.mutate()} block={phone}>
                Generate Preview
              </Button>
            </div>
          </StepperLayout>
        </Panel>

        <Panel title="Runs" subtitle="Select a run to see its detail">
          <DataTable<YearEndRunRow>
            rowKey="id"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={runs}
            pagination={false}
            onRowOpen={(row) => setSelectedRunId(row.id)}
            rowClassName={(row) => (row.id === selectedRunId ? "ant-table-row-selected" : "")}
            empty={<EmptyState compact illustration="documents" title="No year-end runs yet" description="Generate a preview above to start." />}
            mobile={{
              title: (r) => `Leave year ${r.leaveYear}`,
              subtitle: (r) => `Previewed ${new Date(r.previewedAt).toLocaleString()}`,
              status: (r) => <StatusChip tone={STATUS_TONE[r.status]}>{r.status}</StatusChip>,
              fields: [
                { label: "Employees", render: (r) => r.totalEmployees },
                { label: "Total days", render: (r) => r.totalEncashedDays },
                { label: "Total amount", render: (r) => money(r.totalEncashedAmount) },
                { label: "Committed", render: (r) => (r.committedAt ? new Date(r.committedAt).toLocaleString() : "—") },
              ],
              actions: (r) => (
                <Button icon={<DownloadOutlined />} loading={downloading === r.id} onClick={() => void downloadReport(r.id, r)}>
                  Report
                </Button>
              ),
            }}
            columns={[
              { title: "Year", dataIndex: "leaveYear" },
              { title: "Status", dataIndex: "status", render: (s: YearEndRunStatus) => <StatusChip tone={STATUS_TONE[s]}>{s}</StatusChip> },
              { title: "Employees", dataIndex: "totalEmployees", align: "right" },
              { title: "Total Days", dataIndex: "totalEncashedDays", align: "right" },
              { title: "Total Amount", dataIndex: "totalEncashedAmount", align: "right", render: (n: number) => <span className="ws-num">{money(n)}</span> },
              { title: "Previewed", dataIndex: "previewedAt", render: (d: string) => new Date(d).toLocaleString() },
              { title: "Committed", dataIndex: "committedAt", render: (d: string | null) => (d ? new Date(d).toLocaleString() : "—") },
              {
                title: "",
                key: "actions",
                align: "right",
                render: (_, row) => (
                  <Button size="small" icon={<DownloadOutlined />} loading={downloading === row.id} onClick={() => void downloadReport(row.id, row)}>
                    Report
                  </Button>
                ),
              },
            ]}
          />
        </Panel>

        {selectedRunId && loadingDetail && !detail && (
          <Panel>
            <SkeletonTable rows={5} columns={6} />
          </Panel>
        )}

        {detail && (
          <Panel title={`${detail.leaveYear} run detail`} extra={<StatusChip tone={STATUS_TONE[detail.status]}>{detail.status}</StatusChip>}>
            <Stack gap={space[4]}>
              {detail.items.some((i) => i.rateSource === "MANUAL_SETTING") && <ProvisionalRateAlert />}
              <DataTable<YearEndRunItemRow>
                rowKey="id"
                dataSource={detail.items}
                pagination={{ pageSize: 10 }}
                empty={<EmptyState compact title="No employees had a positive PL balance to encash" description={null} />}
                mobile={{
                  title: (r) => r.employeeName,
                  subtitle: (r) => r.employeeCode,
                  fields: [
                    { label: "Closing PL", render: (r) => r.closingPlBalance },
                    { label: "Encashed days", render: (r) => r.encashedDays },
                    { label: "Daily rate", render: (r) => money(r.dailyRate) },
                    { label: "Amount", render: (r) => money(r.encashedAmount) },
                  ],
                }}
                columns={[
                  { title: "Employee Code", dataIndex: "employeeCode" },
                  { title: "Employee", dataIndex: "employeeName" },
                  { title: "Closing PL Balance", dataIndex: "closingPlBalance", align: "right" },
                  { title: "Encashed Days", dataIndex: "encashedDays", align: "right" },
                  { title: "Daily Rate", dataIndex: "dailyRate", align: "right", render: (n: number) => <span className="ws-num">{money(n)}</span> },
                  { title: "Amount", dataIndex: "encashedAmount", align: "right", render: (n: number) => <span className="ws-num">{money(n)}</span> },
                ]}
              />

              {detail.status === "PREVIEW" && (
                <ApprovalBanner
                  tone="warning"
                  title="Committing writes an ENCASHMENT ledger entry per employee and resets each PL balance to zero."
                  description="This cannot be undone. Review the preview above first."
                  actions={
                    <>
                      <Button onClick={() => setDiscardOpen(true)}>Discard</Button>
                      <Button type="primary" danger onClick={() => setCommitOpen(true)}>
                        Commit…
                      </Button>
                    </>
                  }
                />
              )}
              {detail.status === "COMMITTED" && <ApprovalBanner tone="success" title={`Committed${detail.committedAt ? ` on ${new Date(detail.committedAt).toLocaleString()}` : ""}.`} description="Encashment entries are on the leave ledger." />}
            </Stack>
          </Panel>
        )}
      </Stack>

      <ConfirmModal
        open={discardOpen}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => detail && discardMutation.mutate(detail.id)}
        title="Discard this preview?"
        description="Nothing is written to the ledger. You can generate a new preview at any time."
        confirmLabel="Discard"
        loading={discardMutation.isPending}
      />

      <ConfirmModal
        open={commitOpen}
        onCancel={() => setCommitOpen(false)}
        onConfirm={() => detail && commitMutation.mutate(detail.id)}
        title={`Commit year end ${detail?.leaveYear ?? ""}?`}
        description={detail ? `${detail.totalEmployees} employee(s) · ${detail.totalEncashedDays} day(s) · ${money(detail.totalEncashedAmount)}. Each PL balance is reset to zero.` : undefined}
        confirmLabel="Commit"
        danger
        loading={commitMutation.isPending}
        confirmDisabled={confirmText !== CONFIRM_PHRASE}
      >
        <label htmlFor="year-end-confirm" style={{ display: "block", fontWeight: fw.medium, marginBottom: space[2] }}>
          Type “{CONFIRM_PHRASE}” to confirm
        </label>
        <Input id="year-end-confirm" size="large" placeholder={`Type "${CONFIRM_PHRASE}" to confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
      </ConfirmModal>
    </>
  );
}
