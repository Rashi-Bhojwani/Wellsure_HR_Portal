import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Radio, Select, Upload } from "antd";
import { DownloadOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { financialYearOf } from "@shared/utils/financialYear";
import * as taxApi from "../../../api/tax";
import type { OpeningKind, OpeningRow, OpeningsImportPreview } from "../../../api/tax";
import { saveBlob } from "../../../api/muster";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, ConfirmModal, DataTable, PageHeader, Panel, QueryState, SideDrawer, SkeletonCard, Stack, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// A-3 (docs/plans/A3_OPENING_FIGURES.md): each person's pay and tax for the financial year before this system, and from a previous employer this year.
// Directors only. Nothing is preloaded. A different director confirms the year as a whole; until then income tax in a run is held back and says why.

const KIND_TEXT: Record<OpeningKind, string> = { GO_LIVE: "Before this system", PREVIOUS_EMPLOYER: "Previous employer" };

function yearsAround(): string[] {
  const now = financialYearOf(new Date().toISOString().slice(0, 10));
  const start = Number(now.label.slice(0, 4));
  return [start - 1, start, start + 1].map((y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`);
}

export function OpeningFiguresPage() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(financialYearOf(new Date().toISOString().slice(0, 10)).label);
  const [entering, setEntering] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OpeningsImportPreview | null>(null);
  const [reason, setReason] = useState("");
  const [form] = Form.useForm<{ employeeId: string; kind: OpeningKind; taxable: string; tds: string; sourceNote: string }>();
  const view = useQuery({ queryKey: ["openings", year], queryFn: () => taxApi.openings(year) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["openings", year] });
  const fail = (what: string) => (err: unknown) => toast.error(apiErrorMessage(err, what));
  const enter = useMutation({
    mutationFn: (v: { employeeId: string; kind: OpeningKind; taxable: string; tds: string; sourceNote: string }) => taxApi.enterOpening({ year, ...v }),
    onSuccess: (r) => {
      toast.success(r.voidedConfirmation ? "Saved. The year's confirmation was undone: ask the other director again." : "Saved.");
      setEntering(false);
      form.resetFields();
      refresh();
    },
    onError: fail("Could not save it."),
  });
  const clear = useMutation({
    mutationFn: (r: OpeningRow) => taxApi.enterOpening({ year, employeeId: r.employeeId, kind: r.kind, clear: true, sourceNote: "cleared by a director" }),
    onSuccess: () => {
      toast.success("Cleared.");
      refresh();
    },
    onError: fail("Could not clear it."),
  });
  const doPreview = useMutation({ mutationFn: (f: File) => taxApi.previewOpeningsImport(year, f), onSuccess: setPreview, onError: fail("Could not read the file.") });
  const doApply = useMutation({
    mutationFn: () => taxApi.applyOpeningsImport(year, file!, preview!.fingerprint, reason.trim()),
    onSuccess: (r) => {
      toast.success(`${r.written} written.`);
      setPreview(null);
      setFile(null);
      setReason("");
      refresh();
    },
    onError: fail("Could not apply the file."),
  });
  const ask = useMutation({ mutationFn: () => taxApi.requestOpeningsConfirmation(year, view.data!.fingerprint), onSuccess: () => { toast.success("Sent to the other director."); refresh(); }, onError: fail("Could not ask.") });
  const decide = useMutation({ mutationFn: (d: "APPROVE" | "REJECT") => taxApi.decideOpenings(year, view.data!.fingerprint, d), onSuccess: () => { toast.success("Decided."); refresh(); }, onError: fail("Could not decide.") });
  const v = view.data;
  const state = v?.state ?? "NOT_CONFIRMED";
  return (
    <>
      <PageHeader
        title="Opening Figures"
        subtitle="Pay and tax for the year before this system, and from a previous employer. Income tax in a run waits until a different director confirms the year."
        actions={<Select aria-label="Financial year" value={year} onChange={setYear} options={yearsAround().map((y) => ({ value: y, label: y }))} style={{ minWidth: 120 }} />}
      />
      <Stack>
        <QueryState isLoading={view.isLoading} error={view.error} onRetry={() => void view.refetch()} skeleton={<SkeletonCard lines={3} />}>
          {v && (
            <Panel title="Confirmation" subtitle={`${v.totals.people} ${v.totals.people === 1 ? "person" : "people"} · taxable pay ${formatRupees(v.totals.taxable)} · tax deducted ${formatRupees(v.totals.tds)}`}>
              {state === "CONFIRMED" && <ApprovalBanner tone="success" title="Confirmed by a different director" description="Any change undoes the confirmation." />}
              {state === "NOT_CONFIRMED" && (
                <ApprovalBanner
                  tone="warning"
                  title="Not confirmed"
                  description={v.rows.length === 0 ? "Nothing entered. If nobody had pay before this system or from another employer this year, ask the other director to confirm that there are none." : "Ask the other director to confirm these figures."}
                  actions={<Button type="primary" loading={ask.isPending} onClick={() => ask.mutate()}>{v.rows.length === 0 ? "Ask to confirm there are none" : "Ask the other director to confirm"}</Button>}
                />
              )}
              {state === "WAITING" && (
                <ApprovalBanner
                  tone="info"
                  title={v.waiting?.mine ? "Waiting for the other director" : "Waiting for your decision"}
                  description={v.waiting?.mine ? "You asked; a different director decides." : "Check every figure against its source before you approve."}
                  actions={v.waiting?.mine ? undefined : (
                    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                      <Button type="primary" loading={decide.isPending} onClick={() => decide.mutate("APPROVE")}>Approve</Button>
                      <Button danger loading={decide.isPending} onClick={() => decide.mutate("REJECT")}>Reject</Button>
                    </div>
                  )}
                />
              )}
            </Panel>
          )}
        </QueryState>
        <Panel
          title={`Figures for ${year}`}
          extra={
            <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
              <Button icon={<PlusOutlined />} disabled={state === "WAITING"} onClick={() => setEntering(true)}>Enter one</Button>
              <Button icon={<DownloadOutlined />} onClick={() => void taxApi.openingsTemplate().then((b) => saveBlob(b, "opening-figures-template.csv"))}>Template</Button>
              <Upload accept=".csv,.xlsx" showUploadList={false} disabled={state === "WAITING"} beforeUpload={(f) => { setFile(f); doPreview.mutate(f); return false; }}>
                <Button icon={<UploadOutlined />} disabled={state === "WAITING"} loading={doPreview.isPending}>Upload a file</Button>
              </Upload>
            </div>
          }
        >
          <DataTable<OpeningRow>
            rowKey={(r) => `${r.employeeId}-${r.kind}`}
            loading={view.isLoading}
            error={view.error}
            dataSource={v?.rows ?? []}
            empty="Nothing entered for this year. Nothing is ever filled in for you."
            pagination={{ pageSize: 25 }}
            columns={[
              { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
              { title: "Kind", dataIndex: "kind", render: (k: OpeningKind) => <StatusChip tone="neutral">{KIND_TEXT[k]}</StatusChip> },
              { title: "Taxable pay", dataIndex: "taxable", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Tax deducted", dataIndex: "tds", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Source", dataIndex: "sourceNote" },
              { title: "", key: "act", render: (_, r) => <Button disabled={state === "WAITING"} loading={clear.isPending && clear.variables === r} onClick={() => clear.mutate(r)}>Clear</Button> },
            ]}
          />
        </Panel>
      </Stack>
      <SideDrawer open={entering} title="Enter an opening figure" subtitle="Saved at once. It undoes the year's confirmation, if any." onClose={() => setEntering(false)} formId="opening-form" primaryLabel="Save" primaryLoading={enter.isPending}>
        <Form id="opening-form" form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "GO_LIVE" }} onFinish={(x) => enter.mutate(x)}>
          <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: "Choose a person" }]}>
            <EmployeePicker />
          </Form.Item>
          <Form.Item name="kind" label="Kind">
            <Radio.Group options={[{ value: "GO_LIVE", label: "Before this system (this employer)" }, { value: "PREVIOUS_EMPLOYER", label: "Previous employer this year" }]} />
          </Form.Item>
          <Form.Item name="taxable" label="Taxable pay this year (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Digits, with up to two decimals, no commas" }]}>
            <Input inputMode="decimal" />
          </Form.Item>
          <Form.Item name="tds" label="Tax deducted this year (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Digits, with up to two decimals, no commas" }]}>
            <Input inputMode="decimal" />
          </Form.Item>
          <Form.Item name="sourceNote" label="Where it comes from" rules={[{ required: true, min: 3, message: "Say where the figure comes from" }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal
        open={!!preview}
        title={`Apply ${preview?.valid ?? 0} row${preview?.valid === 1 ? "" : "s"} from ${preview?.fileName ?? "the file"}?`}
        description={preview && preview.rows.some((r) => r.problem) ? `${preview.rows.filter((r) => r.problem).length} row(s) have a problem and will not be written.` : "Every row can be written."}
        confirmLabel="Apply"
        confirmDisabled={reason.trim().length < 3 || !preview?.valid}
        loading={doApply.isPending}
        onCancel={() => setPreview(null)}
        onConfirm={() => doApply.mutate()}
      >
        <div style={{ maxHeight: 240, overflow: "auto", marginTop: space[2] }}>
          {(preview?.rows ?? []).filter((r) => r.problem).map((r) => (
            <div key={r.line}>Line {r.line}: {r.problem}</div>
          ))}
        </div>
        <Input.TextArea aria-label="Reason" placeholder="Why (a few words)" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: space[2] }} />
      </ConfirmModal>
    </>
  );
}
