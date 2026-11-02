import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Radio } from "antd";
import * as taxApi from "../../../api/tax";
import type { Regime } from "../../../api/tax";
import { RegimeCompare } from "../../../components/tax/RegimeCompare";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { space } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SkeletonCard, Stack, StatusChip, toast } from "../../../ui";

const APPLIES: Record<string, string> = { NEW: "New regime only", OLD: "Old regime only", BOTH: "Both regimes" };
const windowText = (w: taxApi.WindowView) => (w.state === "NOT_SET" ? "The directors have not opened it yet." : w.state === "NOT_OPEN_YET" ? `Opens on ${formatDate(w.opensOn!)}.` : w.state === "OPEN" ? `Open until ${formatDate(w.closesOn!)}.` : `Closed on ${formatDate(w.closesOn!)}.`);

// Salary > IT Declaration. The person's own: which regime they choose (never chosen for them), and the amounts they declare under each section the directors listed. Saving makes a new
// version; the latest one counts. Only while the window is open.
export function ItDeclarationPage() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["tax", "me"], queryFn: () => taxApi.myTax() });
  const [edit, setEdit] = useState<{ regime: Regime | null; amounts: Record<string, string> } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const d = q.data;
  // What is on screen: the person's edits if they have started, otherwise what is saved.
  const shown = edit ?? { regime: d?.declaration?.regime ?? null, amounts: Object.fromEntries((d?.declaration?.lines ?? []).map((l) => [l.section, l.amount])) };
  const regime = shown.regime;
  const amounts = shown.amounts;
  const setRegime = (r: Regime) => setEdit({ ...shown, regime: r });
  const setAmounts = (a: Record<string, string>) => setEdit({ ...shown, amounts: a });
  const open = d?.windows.declaration.state === "OPEN";
  const lines = Object.entries(amounts).map(([section, amount]) => ({ section, amount: amount.trim() })).filter((l) => l.amount !== "");
  const save = useMutation({
    mutationFn: () => taxApi.saveMyDeclaration({ fy: d!.year, regime: regime!, lines }),
    onSuccess: (r) => { toast.success(`Saved as version ${r.declaration?.version ?? ""}.`); setProblem(null); queryClient.setQueryData(["tax", "me"], r); setEdit(null); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not save.")),
  });
  return (
    <>
      <PageHeader title="IT Declaration" subtitle={d ? `Financial year ${d.year}` : "Your declaration for the year"} />
      <Stack>
        {q.isLoading && <SkeletonCard lines={4} />}
        {q.error && <ApprovalBanner tone="danger" title="Could not load your declaration" description={apiErrorMessage(q.error, "Try again in a moment.")} />}
        {d && (
          <>
            <ApprovalBanner tone={open ? "info" : "warning"} title={`The declaration window: ${windowText(d.windows.declaration)}`} description="You can change your declaration only while it is open. Each save is a new version; the latest one counts." />
            <Panel title="Compare the two regimes" subtitle="From your own pay. The system never chooses for you.">
              <RegimeCompare comparison={d.comparison} />
            </Panel>
            <Panel title="Your choice and your declaration" subtitle={d.declaration ? `Version ${d.declaration.version}, saved ${formatDate(d.declaration.submittedAt)}` : "You have not declared yet"}>
              {!d.sectionsConfirmed ? (
                <EmptyState compact title="The sections are not ready" description="The directors have not entered and confirmed the sections you can declare under for this year." />
              ) : (
                <Form layout="vertical" component="div" requiredMark={false}>
                  <Form.Item label="Which regime do you choose?" htmlFor="tax-regime" help={regime === null ? "Choose one before you save. Nothing is chosen for you." : undefined}>
                    <Radio.Group id="tax-regime" disabled={!open} value={regime} onChange={(e) => setRegime(e.target.value as Regime)} options={[{ value: "NEW", label: "New regime" }, { value: "OLD", label: "Old regime" }]} />
                  </Form.Item>
                  <DataTable<taxApi.SectionDef>
                    rowKey="code"
                    density="compact"
                    dataSource={d.sections}
                    pagination={false}
                    empty={<EmptyState compact title="No sections" description="Nothing to declare." />}
                    mobile={{ title: (s) => s.label, subtitle: (s) => APPLIES[s.appliesTo] ?? "", fields: [{ label: "Limit", render: (s) => s.cap ?? "None of its own" }, { label: "Proof", render: (s) => (s.proofRequired ? "Needed" : "Not needed") }], actions: (s) => <Input aria-label={`Amount for ${s.label}`} size="large" inputMode="decimal" placeholder="Your amount (₹)" disabled={!open} value={amounts[s.code] ?? ""} onChange={(e) => { setAmounts({ ...amounts, [s.code]: e.target.value }); setProblem(null); }} /> }}
                    columns={[
                      { title: "Section", key: "label", render: (_, s) => s.label },
                      { title: "Applies to", key: "applies", render: (_, s) => <StatusChip tone="info">{APPLIES[s.appliesTo] ?? s.appliesTo}</StatusChip> },
                      { title: "Limit", key: "cap", render: (_, s) => s.cap ?? "None of its own" },
                      { title: "Proof", key: "proof", render: (_, s) => (s.proofRequired ? "Needed" : "Not needed") },
                      { title: "Your amount (₹)", key: "amount", align: "right", render: (_, s) => <Input aria-label={`Amount for ${s.label}`} inputMode="decimal" disabled={!open} value={amounts[s.code] ?? ""} onChange={(e) => { setAmounts({ ...amounts, [s.code]: e.target.value }); setProblem(null); }} style={{ maxWidth: 160, textAlign: "right" }} /> },
                    ]}
                  />
                  {problem && <ApprovalBanner tone="danger" title={problem} />}
                  <div style={{ marginTop: space[4] }}>
                    <Button type="primary" size="large" disabled={!open || regime === null} loading={save.isPending} onClick={() => save.mutate()}>Save my declaration</Button>
                  </div>
                </Form>
              )}
            </Panel>
          </>
        )}
      </Stack>
    </>
  );
}
