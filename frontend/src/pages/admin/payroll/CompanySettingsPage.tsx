import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import * as api from "../../../api/companySettings";
import type { CompanySettings } from "../../../api/companySettings";
import { apiErrorMessage } from "../../../lib/apiError";
import { ApprovalBanner, DataTable, PageHeader, Panel, SideDrawer, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Company settings (part 3 B2a, docs/plans/A_PART3.md), directors only. Each company's statutory registrations and the bank debit account for its payroll.
// Nothing is preset: a director enters them with a reason and a different director confirms. The account is shown by its last four only.
type Company = CompanySettings["companies"][number];
const FIELDS: Array<[string, string]> = [["pfEstablishmentCode", "PF establishment code"], ["esiEmployerCode", "ESI employer code"], ["ptRegistration", "PT registration"], ["lwfRegistration", "LWF registration"], ["tan", "TAN"]];
interface Entry { pfEstablishmentCode?: string; esiEmployerCode?: string; ptRegistration?: string; lwfRegistration?: string; tan?: string; debitAccount?: string; reason: string }

export function CompanySettingsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const [form] = Form.useForm<Entry>();
  const q = useQuery({ queryKey: ["company-settings"], queryFn: api.companySettings });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["company-settings"] });
  const enter = useMutation({
    mutationFn: (v: Entry) => api.enterCompanySettings({ companyKey: editing!.key, registrations: Object.fromEntries(FIELDS.map(([k]) => [k, (v as unknown as Record<string, string | undefined>)[k]?.trim() || undefined])), ...(v.debitAccount?.trim() ? { debitAccount: v.debitAccount.trim() } : {}), reason: v.reason }),
    onSuccess: () => { toast.success("Entered. A different director confirms it."); setEditing(null); form.resetFields(); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not enter them.")),
  });
  const confirm = useMutation({ mutationFn: (id: string) => api.confirmCompanySettings(id), onSuccess: () => { toast.success("Confirmed."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not confirm.")) });
  const show = (r: Record<string, string | undefined> | undefined, k: string) => r?.[k] || "Not set";
  const actionsOf = (c: Company) => (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
      {c.waiting && !c.waiting.enteredByMe && <Button type="primary" loading={confirm.isPending} onClick={() => confirm.mutate(c.waiting!.id)}>Confirm</Button>}
      <Button onClick={() => setEditing(c)}>Enter</Button>
    </div>
  );
  return (
    <>
      <PageHeader title="Company settings" subtitle="Each company's registrations and bank account for payroll. Nothing is preset." />
      <ApprovalBanner tone="info" title="Payroll per company: first steps" description={q.data?.note ?? "Not set until entered and confirmed by a different director."} style={{ marginBottom: space[4] }} />
      <Panel title="Companies">
        <DataTable<Company>
          rowKey="key"
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          dataSource={q.data?.companies ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          mobile={{ title: (c) => c.name, subtitle: (c) => (c.waiting ? "Waiting for the other director" : c.inForce ? "Confirmed" : "Not set"), actions: (c) => actionsOf(c) }}
          columns={[
            { title: "Company", dataIndex: "name" },
            ...FIELDS.map(([k, label]) => ({ title: label, key: k, render: (_: unknown, c: Company) => show(c.inForce?.registrations, k) })),
            { title: "Debit account", key: "acct", render: (_, c) => c.inForce?.debitAccount ?? "Not set" },
            { title: "State", key: "s", render: (_, c) => (c.waiting ? <StatusChip tone="info">Waiting for the other director</StatusChip> : c.inForce ? <StatusChip tone="success">Confirmed</StatusChip> : <StatusChip tone="warning">Not set</StatusChip>) },
            {
              title: "",
              key: "a",
              fixed: "right" as const,
              render: (_, c) => actionsOf(c),
            },
          ]}
        />
      </Panel>
      <SideDrawer open={!!editing} title={`Settings for ${editing?.name ?? ""}`} subtitle="A different director confirms them. Leave a field blank to keep it Not set." onClose={() => setEditing(null)} formId="company-settings-form" primaryLabel="Enter" primaryLoading={enter.isPending}>
        <Form id="company-settings-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => enter.mutate(v)}>
          {FIELDS.map(([k, label]) => (
            <Form.Item key={k} name={k} label={label} rules={[{ pattern: /^[A-Za-z0-9/-]{1,40}$/, message: "Letters, digits, / and -" }]}><Input autoComplete="off" /></Form.Item>
          ))}
          <Form.Item name="debitAccount" label="Bank debit account" rules={[{ pattern: /^[0-9]{6,20}$/, message: "6 to 20 digits" }]}><Input inputMode="numeric" autoComplete="off" /></Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "Say why" }]}><Input /></Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}

export default CompanySettingsPage;
