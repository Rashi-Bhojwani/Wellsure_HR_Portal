import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { ImportRow, ImportView } from "../../../api/payroll";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { ApprovalBanner, DataTable, EmptyState, Panel, Stack, StatusChip, toast } from "../../../ui";
import { Caption, Num, PersonCell } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Monthly Inputs → Import a file. Upload an Excel or CSV in the layout of the Bulk Salary Overrides sample, look at the preview (every row, line numbers, what is wrong in
// words), and only then confirm. Nothing is saved before the confirm. One invalid row refuses the whole file unless the director chooses to skip the invalid rows.

export function MonthlyInputsImport({ canEdit, onApplied }: { canEdit: boolean; onApplied: () => void }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ImportView | null>(null);
  const [skip, setSkip] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const past = useQuery({ queryKey: ["payroll", "inputs", "imports"], queryFn: payrollApi.listImports });
  const upload = useMutation({
    mutationFn: (file: File) => payrollApi.uploadImport(file),
    onSuccess: (v) => {
      setView(v);
      setSkip(false);
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: ["payroll", "inputs", "imports"] });
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not read that file.")),
  });
  const apply = useMutation({
    mutationFn: () => payrollApi.applyImport(view!.id, { fingerprint: view!.fingerprint, skipInvalid: skip, reason: reason.trim() }),
    onSuccess: (r) => {
      toast.success(`Saved ${r.written} ${r.written === 1 ? "figure" : "figures"}${r.skippedRows ? `, skipping ${r.skippedRows} invalid ${r.skippedRows === 1 ? "row" : "rows"}` : ""}. Any confirmation of those months needs doing again.`);
      setView(null);
      setReason("");
      onApplied();
      void queryClient.invalidateQueries({ queryKey: ["payroll", "inputs", "imports"] });
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not save it.")),
  });
  const discard = useMutation({
    mutationFn: () => payrollApi.discardImport(view!.id),
    onSuccess: () => {
      setView(null);
      void queryClient.invalidateQueries({ queryKey: ["payroll", "inputs", "imports"] });
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not discard it.")),
  });
  const headName = (code: string) => view?.analysis.columns.find((c) => c.head === code)?.header ?? code;
  const a = view?.analysis;
  const canSave = !!view && view.status === "PREVIEW" && !view.alreadyApplied && reason.trim().length >= 3 && (skip ? view.canApplySkippingInvalid : view.canApply);

  return (
    <Stack>
      <Panel>
        <div style={{ display: "flex", gap: space[3], flexWrap: "wrap", alignItems: "center" }}>
          <input ref={input} type="file" accept=".xlsx,.csv" hidden aria-label="Choose a file" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          {canEdit && <Button type="primary" size="large" icon={<UploadOutlined />} loading={upload.isPending} onClick={() => input.current?.click()}>Choose an Excel or CSV file</Button>}
          <Button size="large" icon={<DownloadOutlined />} onClick={() => void payrollApi.downloadImportTemplate("xlsx")}>Template (Excel)</Button>
          <Button size="large" onClick={() => void payrollApi.downloadImportTemplate("csv")}>Template (CSV)</Button>
        </div>
        <Caption>Columns: Employee Number, Override From, Override Till, Principal Part, Interest Part, Remarks, then one column per pay head that takes its value from Monthly Inputs. Nothing is saved until you confirm the preview.</Caption>
        {problem && !view && <ApprovalBanner tone="danger" title={problem} style={{ marginTop: space[3] }} />}
      </Panel>

      {view && a && (
        <Panel title={`Preview: ${view.fileName}`}>
          <Stack>
            {view.alreadyApplied && <ApprovalBanner tone="info" title="This exact file was already applied" description={`It was saved on ${formatDateTime(view.alreadyApplied.at)}. A file is never applied twice.`} />}
            {view.status === "APPLIED" && !view.alreadyApplied && <ApprovalBanner tone="info" title="This file has been applied" />}
            {a.fileProblems.map((p) => <ApprovalBanner key={p} tone="danger" title={p} />)}
            {a.notices.map((n) => <ApprovalBanner key={n} tone="warning" title={n} />)}
            <div>
              {a.rows.length} {a.rows.length === 1 ? "row" : "rows"}: {a.valid} valid, {a.invalid} with a problem. {a.cells} {a.cells === 1 ? "figure" : "figures"} would be saved{a.months.length ? ` across ${a.months.length} ${a.months.length === 1 ? "month" : "months"}` : ""}.
              {a.columns.some((c) => c.kind === "IGNORED_EMPTY") && <Caption>Empty columns ignored: {a.columns.filter((c) => c.kind === "IGNORED_EMPTY").map((c) => c.header).join(", ")}</Caption>}
            </div>
            <DataTable<ImportRow>
              rowKey="line"
              density="compact"
              dataSource={a.rows}
              pagination={{ pageSize: 25, showSizeChanger: false }}
              empty={<EmptyState compact title="The file has no rows" />}
              mobile={{
                title: (r) => `Line ${r.line}: ${r.name ?? r.employeeNumber}`,
                subtitle: (r) => `${r.from ?? "?"} to ${r.till ?? "?"}`,
                status: (r) => (r.problems.length ? <StatusChip tone="danger">Problem</StatusChip> : <StatusChip tone="success">OK</StatusChip>),
                fields: [{ label: "Figures", render: (r) => Object.entries(r.figures).map(([h, f]) => `${headName(h)} ${f}`).join(", ") || "None" }, { label: "Problems", render: (r) => (r.problems.length ? r.problems.join(" ") : "None") }],
              }}
              columns={[
                { title: "Line", key: "line", width: 64, render: (_, r) => <Num>{r.line}</Num> },
                { title: "Employee", key: "emp", render: (_, r) => <PersonCell name={r.name ?? r.employeeNumber} code={r.name ? r.employeeNumber : "Not found"} /> },
                { title: "Months", key: "months", render: (_, r) => (r.months.length ? r.months.join(", ") : "—") },
                { title: "Figures", key: "figs", render: (_, r) => (Object.keys(r.figures).length ? Object.entries(r.figures).map(([h, f]) => <div key={h}>{headName(h)}: <Num>{f}</Num></div>) : "—") },
                { title: "Loan parts (not posted)", key: "loan", render: (_, r) => (r.principal || r.interest ? `${r.principal ?? "—"} / ${r.interest ?? "—"}` : "—") },
                { title: "Result", key: "result", render: (_, r) => (r.problems.length ? <div>{r.problems.map((p) => <Caption key={p} tone="danger">{p}</Caption>)}</div> : <StatusChip tone="success">OK</StatusChip>) },
              ]}
            />
            {view.status === "PREVIEW" && !view.alreadyApplied && canEdit && (
              <Form layout="vertical" component="div" requiredMark={false}>
                {a.invalid > 0 && (
                  <ApprovalBanner tone="warning" title={`${a.invalid} ${a.invalid === 1 ? "row has" : "rows have"} a problem, so by default nothing is saved.`} description="Fix the file and upload it again, or choose to skip the invalid rows and save only the valid ones. Your choice is recorded." />
                )}
                {a.invalid > 0 && a.valid > 0 && (
                  <Form.Item>
                    <Checkbox checked={skip} onChange={(e) => setSkip(e.target.checked)}>Skip the {a.invalid} invalid {a.invalid === 1 ? "row" : "rows"} and save the {a.valid} valid</Checkbox>
                  </Form.Item>
                )}
                <Form.Item label="Why you are loading this file" htmlFor="imp-reason" validateStatus={problem ? "error" : undefined} help={problem ?? "Kept with every figure from this file. At least 3 characters."}>
                  <Input id="imp-reason" maxLength={200} value={reason} onChange={(e) => { setReason(e.target.value); setProblem(null); }} />
                </Form.Item>
                <div style={{ display: "flex", gap: space[3], flexWrap: "wrap" }}>
                  <Button type="primary" size="large" disabled={!canSave} loading={apply.isPending} onClick={() => apply.mutate()}>Save these figures</Button>
                  <Button size="large" loading={discard.isPending} onClick={() => discard.mutate()}>Discard this preview</Button>
                </div>
              </Form>
            )}
          </Stack>
        </Panel>
      )}

      <Panel title="Earlier files">
        <DataTable<payrollApi.ImportListRow>
          rowKey="id"
          density="compact"
          loading={past.isLoading}
          error={past.error}
          onRetry={() => void past.refetch()}
          dataSource={past.data ?? []}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          empty={<EmptyState compact title="No file has been uploaded" />}
          mobile={{ title: (b) => b.fileName, status: (b) => <StatusChip tone={b.status === "APPLIED" ? "success" : "neutral"}>{b.status === "APPLIED" ? "Applied" : b.status === "DISCARDED" ? "Discarded" : "Preview"}</StatusChip>, fields: [{ label: "Uploaded", render: (b) => formatDateTime(b.createdAt) }] }}
          columns={[
            { title: "File", key: "file", render: (_, b) => b.fileName },
            { title: "Uploaded", key: "at", render: (_, b) => formatDateTime(b.createdAt) },
            { title: "Rows", key: "rows", render: (_, b) => `${b.summary.valid ?? 0} valid, ${b.summary.invalid ?? 0} invalid` },
            { title: "Status", key: "status", render: (_, b) => <StatusChip tone={b.status === "APPLIED" ? "success" : "neutral"}>{b.status === "APPLIED" ? "Applied" : b.status === "DISCARDED" ? "Discarded" : "Preview"}</StatusChip> },
            { title: "", key: "open", align: "right", render: (_, b) => (b.status === "PREVIEW" ? <Button size="small" onClick={() => void payrollApi.getImport(b.id).then((v) => { setView(v); setSkip(false); setProblem(null); })}>Open</Button> : null) },
          ]}
        />
      </Panel>
    </Stack>
  );
}
