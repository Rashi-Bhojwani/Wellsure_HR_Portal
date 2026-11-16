import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "antd";
import * as api from "../../../api/greythr";
import type { BankCheck } from "../../../api/greythr";
import * as payrollApi from "../../../api/payroll";
import { apiErrorMessage } from "../../../lib/apiError";
import { Dropzone } from "../../../pages/admin/import/Dropzone";
import { space } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, Panel, Stack, StatusChip, toast } from "../../../ui";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): greytHR's bank transfer file checked against the portal's bank layout. Only the header row is read; no account number, name or
// amount from the file is returned or kept. Where the headers differ, a director may start a draft layout from them (fields only where certain, everything else Not
// set); a different director confirms it, as for any layout. Until then the bank file cannot be made from it.

type Col = BankCheck["columns"][number];
const VERDICT: Record<Col["verdict"], { text: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  SAME: { text: "Same", tone: "success" },
  DIFFERS_ONLY_IN_SPACES_OR_CASE: { text: "Differs in spaces or capitals", tone: "warning" },
  DIFFERENT: { text: "Different", tone: "danger" },
  ONLY_IN_FILE: { text: "Only in the bank's file", tone: "warning" },
  ONLY_IN_LAYOUT: { text: "Only in the portal's layout", tone: "warning" },
};

export function BankFileCheck() {
  const [check, setCheck] = useState<BankCheck | null>(null);
  const [drafting, setDrafting] = useState(false);
  const run = useMutation({ mutationFn: api.checkBankFile, onSuccess: setCheck, onError: (err) => toast.error(apiErrorMessage(err, "Could not read this file.")) });
  const draft = useMutation({
    mutationFn: async () => {
      const value = check!.suggestedLayout!;
      const preview = await payrollApi.previewLayoutSave("BANK_TEMPLATE", value);
      return payrollApi.saveLayout("BANK_TEMPLATE", { value, note: `Draft from the headers of ${check!.fileName}; every uncertain value Not set`, fingerprint: preview.fingerprint });
    },
    onSuccess: () => {
      setDrafting(false);
      toast.success("Draft saved in Bank and Statutory Layouts. Fill in what is Not set; a different director confirms it.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the draft.")),
  });
  return (
    <Stack>
      <Panel title="Check greytHR's bank transfer file" subtitle="Compares the bank file's columns with the portal's bank layout. Only the header row is read.">
        <Dropzone compact accept=".xls,.xlsx" loading={run.isPending} onFile={(f) => run.mutate(f)} title="Drop greytHR's bank transfer file here" hint="The .xls (or .xlsx) the bank takes today. No account number, name or amount from it is shown or kept." buttonLabel="Upload the bank file" />
      </Panel>
      {check && (
        <Panel title={`${check.fileName}: ${check.columns.filter((c) => c.verdict !== "ONLY_IN_LAYOUT").length} columns, ${check.dataRows} data rows`} subtitle={check.headersMatch ? "Every column matches the confirmed bank layout." : "The columns differ from the portal's bank layout."} extra={<StatusChip tone={check.layout.status === "CONFIRMED" ? "success" : "warning"}>{check.layout.status === "CONFIRMED" ? `Layout v${check.layout.version}, confirmed` : check.layout.status === "PLACEHOLDER" ? "Layout not confirmed" : "No layout yet"}</StatusChip>}>
          <Stack>
            {check.notes.map((n) => <ApprovalBanner key={n} tone="info" title={n} />)}
            <DataTable<Col>
              rowKey="position"
              density="compact"
              pagination={false}
              dataSource={check.columns}
              mobile={{ title: (c) => `${c.position}. ${c.fileHeader || "—"}`, subtitle: (c) => `Layout: ${c.layoutHeader ?? "—"}`, status: (c) => <StatusChip tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].text}</StatusChip>, fields: [{ label: "Filled from", render: (c: Col) => c.suggested ?? "Not set" }] }}
              columns={[
                { title: "#", dataIndex: "position", width: 56 },
                { title: "Bank's file", dataIndex: "fileHeader", render: (v: string) => <code>{v === "" ? "—" : JSON.stringify(v)}</code> },
                { title: "Portal's layout", dataIndex: "layoutHeader", render: (v: string | null) => (v === null ? "—" : <code>{JSON.stringify(v)}</code>) },
                { title: "", key: "v", render: (_: unknown, c: Col) => <StatusChip tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].text}</StatusChip> },
                { title: "Filled from", dataIndex: "suggested", render: (v: string | null) => v ?? "Not set (a director enters it)" },
              ]}
            />
            {check.suggestedLayout && (
              <div>
                <Button type="primary" onClick={() => setDrafting(true)}>Start a draft bank layout from these columns</Button>
              </div>
            )}
          </Stack>
        </Panel>
      )}
      <ConfirmModal
        open={drafting}
        title="Save a draft bank layout?"
        description="A new version of the bank layout is saved with these columns: fields only where certain, everything else Not set. Until a different director confirms it, the bank file cannot be made from it."
        confirmLabel="Save the draft"
        loading={draft.isPending}
        onCancel={() => setDrafting(false)}
        onConfirm={() => draft.mutate()}
      >
        <div style={{ marginTop: space[2] }} />
      </ConfirmModal>
    </Stack>
  );
}
