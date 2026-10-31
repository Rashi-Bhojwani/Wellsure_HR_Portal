import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { financialYearOf } from "@shared/utils/financialYear";
import * as taxApi from "../../../api/tax";
import type { TaxYearView } from "../../../api/tax";
import { Caption } from "../../../components/payroll/payrollUi";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { space } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, PageHeader, Panel, SideDrawer, SkeletonCard, Stack, StatusChip, toast } from "../../../ui";

// Payroll > Tax years. Directors only. A tax year is every value income tax is worked out from (the slabs, the standard deduction, the rebate, surcharge, cess, the rounding, the default regime,
// the sections people can declare under): none is shipped. Each is entered by a director with the note saying where it came from and the date it applies from, and a DIFFERENT director confirms the
// whole. Until then it is a Placeholder, and anything worked out from it is a draft.
const LEAVES: Array<{ key: string; label: string; path: string[] }> = [
  { key: "new-slabs", label: "New regime: slabs", path: ["NEW", "slabs"] },
  { key: "new-std", label: "New regime: standard deduction", path: ["NEW", "standardDeduction"] },
  { key: "new-rebate", label: "New regime: rebate", path: ["NEW", "rebate"] },
  { key: "old-slabs", label: "Old regime: slabs", path: ["OLD", "slabs"] },
  { key: "old-std", label: "Old regime: standard deduction", path: ["OLD", "standardDeduction"] },
  { key: "old-rebate", label: "Old regime: rebate", path: ["OLD", "rebate"] },
  { key: "surcharge", label: "Surcharge table", path: ["surcharge"] },
  { key: "cess", label: "Cess percentage", path: ["cessPercent"] },
  { key: "default", label: "Default regime", path: ["defaultRegime"] },
  { key: "rounding", label: "Rounding of tax", path: ["rounding"] },
  { key: "min", label: "Minimum monthly TDS", path: ["minimumMonthlyTds"] },
  { key: "oneoffs", label: "How one-off pay is taxed", path: ["oneOffs"] },
  { key: "sections", label: "Sections people can declare under", path: ["sections"] },
];
const leafOf = (value: Record<string, unknown> | null, path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), value) as { value: unknown; sourceNote: string; effectiveFrom: string } | undefined;

// Every figure is blank: this is only the shape, to be filled in from the notice the directors are working from.
const SKELETON = JSON.stringify({
  NEW: { slabs: { value: [{ from: "0", to: "", ratePercent: "" }], sourceNote: "", effectiveFrom: "" }, standardDeduction: { value: "", sourceNote: "", effectiveFrom: "" }, rebate: { value: { thresholdIncome: "", maximum: "" }, sourceNote: "", effectiveFrom: "" } },
  OLD: { slabs: { value: [{ from: "0", to: "", ratePercent: "" }], sourceNote: "", effectiveFrom: "" }, standardDeduction: { value: "", sourceNote: "", effectiveFrom: "" }, rebate: { value: { thresholdIncome: "", maximum: "" }, sourceNote: "", effectiveFrom: "" } },
  surcharge: { value: [], sourceNote: "", effectiveFrom: "" },
  cessPercent: { value: "", sourceNote: "", effectiveFrom: "" },
  defaultRegime: { value: "", sourceNote: "", effectiveFrom: "" },
  rounding: { value: { mode: "", scale: 0 }, sourceNote: "", effectiveFrom: "" },
  minimumMonthlyTds: { value: "", sourceNote: "", effectiveFrom: "" },
  oneOffs: { value: "", sourceNote: "", effectiveFrom: "" },
  sections: { value: [{ code: "", label: "", appliesTo: "", cap: null, groupCap: null, proofRequired: true }], sourceNote: "", effectiveFrom: "" },
}, null, 2);

export function TaxYearsPage() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(financialYearOf(new Date().toISOString().slice(0, 10)).label);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const q = useQuery({ queryKey: ["tax", "year", year], queryFn: () => taxApi.taxYear(year), retry: false });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["tax", "year", year] });
  const y = q.data?.year;
  const tone = y?.status === "CONFIRMED" ? "success" : y?.status === "PLACEHOLDER" ? "warning" : "neutral";
  return (
    <>
      <PageHeader title="Tax years" subtitle="The values income tax is worked out from. None is built in: you enter them, and a different director confirms them." actions={<Button type="primary" onClick={() => setEditing(true)} disabled={!y}>Enter or change the values</Button>} />
      <Stack>
        <ApprovalBanner tone="info" title="Nothing here is a tax rule from the system" description="Every figure needs the note saying where it came from and the date it applies from. Form 16 and any tax statement stay DRAFT until the year is confirmed." />
        <Panel title="Financial year" extra={y && <StatusChip tone={tone}>{y.status === "CONFIRMED" ? "Confirmed" : y.status === "PLACEHOLDER" ? "Entered, not confirmed" : "Not set"}</StatusChip>}>
          <Form layout="inline" component="div" style={{ gap: space[3], flexWrap: "wrap" }}>
            <Form.Item label="Year" htmlFor="tax-year-label"><Input id="tax-year-label" value={year} maxLength={7} onChange={(e) => setYear(e.target.value)} style={{ width: 120 }} placeholder="2026-27" /></Form.Item>
            {y?.status === "PLACEHOLDER" && <Button onClick={() => setConfirming(true)}>Confirm this version</Button>}
          </Form>
          {q.isLoading && <SkeletonCard lines={3} />}
          {q.error && <ApprovalBanner tone="warning" title="That is not a financial year" description={apiErrorMessage(q.error, "Write it like 2026-27.")} />}
          {y && y.missing.length > 0 && <ApprovalBanner tone="warning" title={`Still to be entered (${y.missing.length})`} description={y.missing.join("; ")} />}
          {y?.current && <Caption>Version {y.current.version} entered by {y.current.authorName}, {formatDate(y.current.createdAt)}.{y.current.confirmation ? ` Confirmed by ${y.current.confirmation.confirmedByName}, ${formatDate(y.current.confirmation.confirmedAt)}.` : " Not confirmed yet."}</Caption>}
        </Panel>
        {y && (
          <Panel title="The values" subtitle="Each with where it came from">
            <DataTable<(typeof LEAVES)[number]>
              rowKey="key"
              density="compact"
              dataSource={LEAVES}
              pagination={false}
              mobile={{ title: (l) => l.label, status: (l) => <StatusChip tone={leafOf(y.value, l.path) ? "success" : "warning"}>{leafOf(y.value, l.path) ? "Entered" : "Not set"}</StatusChip>, fields: [{ label: "Source", render: (l) => leafOf(y.value, l.path)?.sourceNote ?? "" }] }}
              columns={[
                { title: "Value", key: "l", render: (_, l) => l.label },
                { title: "Status", key: "s", render: (_, l) => <StatusChip tone={leafOf(y.value, l.path) ? "success" : "warning"}>{leafOf(y.value, l.path) ? "Entered" : "Not set"}</StatusChip> },
                { title: "Where it came from", key: "n", render: (_, l) => leafOf(y.value, l.path)?.sourceNote ?? "" },
                { title: "Applies from", key: "f", render: (_, l) => { const f = leafOf(y.value, l.path)?.effectiveFrom; return f ? formatDate(f) : ""; } },
              ]}
            />
          </Panel>
        )}
      </Stack>
      {editing && y && <EditDrawer year={y} onClose={() => setEditing(false)} onDone={refresh} />}
      {confirming && y && <ConfirmDrawer year={y} onClose={() => setConfirming(false)} onDone={refresh} />}
    </>
  );
}

function EditDrawer({ year, onClose, onDone }: { year: TaxYearView; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(year.value ? JSON.stringify(year.value, null, 2) : SKELETON);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error("That is not valid JSON. Check the brackets and commas."); }
      const pre = await taxApi.previewTaxYear(year.year, value);
      return taxApi.saveTaxYear(year.year, value, pre.fingerprint, note.trim() || undefined);
    },
    onSuccess: () => { toast.success("Saved. A different director has to confirm it."); onDone(); onClose(); },
    onError: (e) => setProblem(e instanceof Error && !("response" in e) ? e.message : apiErrorMessage(e, "Could not save.")),
  });
  return (
    <SideDrawer open title={`Tax year ${year.year}`} subtitle="Enter each value with its source note and the date it applies from" onClose={onClose}
      footer={<div style={{ display: "flex", gap: space[3], width: "100%" }}><Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button><Button size="large" type="primary" style={{ flex: 1 }} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Values (as written)" htmlFor="ty-json" validateStatus={problem ? "error" : undefined} help={problem ?? "The shape is below; every figure is blank until you enter it from your source."}>
          <Input.TextArea id="ty-json" rows={16} value={text} onChange={(e) => { setText(e.target.value); setProblem(null); }} spellCheck={false} />
        </Form.Item>
        <Form.Item label="What you changed" htmlFor="ty-note"><Input id="ty-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Form.Item>
      </Form>
    </SideDrawer>
  );
}

function ConfirmDrawer({ year, onClose, onDone }: { year: TaxYearView; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const confirm = useMutation({
    mutationFn: async () => { const p = await taxApi.previewTaxYearConfirm(year.year); if (p.blocked) throw new Error(p.blocked); return taxApi.confirmTaxYear(year.year, { version: p.version, note: note.trim(), fingerprint: p.fingerprint }); },
    onSuccess: () => { toast.success("Confirmed."); onDone(); onClose(); },
    onError: (e) => setProblem(apiErrorMessage(e, e instanceof Error ? e.message : "Could not confirm.")),
  });
  return (
    <SideDrawer open title={`Confirm tax year ${year.year}`} subtitle="You confirm the values against their source notes. It cannot be the director who entered them." onClose={onClose}
      footer={<div style={{ display: "flex", gap: space[3], width: "100%" }}><Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button><Button size="large" type="primary" style={{ flex: 1 }} disabled={note.trim().length < 5} loading={confirm.isPending} onClick={() => confirm.mutate()}>Confirm</Button></div>}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="What did you check it against?" htmlFor="tc-note" validateStatus={problem ? "error" : undefined} help={problem ?? "A few words, for example the notification and its date."}><Input.TextArea id="tc-note" rows={3} maxLength={300} value={note} onChange={(e) => { setNote(e.target.value); setProblem(null); }} /></Form.Item>
      </Form>
    </SideDrawer>
  );
}
