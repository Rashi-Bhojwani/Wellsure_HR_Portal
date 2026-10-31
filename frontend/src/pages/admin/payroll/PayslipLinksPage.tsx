import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, InputNumber, Switch } from "antd";
import * as payrollApi from "../../../api/payroll";
import { apiErrorMessage } from "../../../lib/apiError";
import { ApprovalBanner, PageHeader, Panel, SkeletonCard, Stack, StatusChip, toast } from "../../../ui";
import { Caption } from "../../../components/payroll/payrollUi";

// Payroll → Payslip links. The email after payslips are published carries a link and no figure. The link expires after the number of days set here (Not set: the email has no link and
// only says to sign in), needs a sign-in, and is checked again when opened. A password-protected PDF is a separate decision that needs the owners' approval: it is off and cannot be turned on here.
export function PayslipLinksPage() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["payroll", "payslip-link-settings"], queryFn: payrollApi.payslipLinkSettings });
  const [days, setDays] = useState<number | null | undefined>(undefined);
  const shown = days === undefined ? (q.data?.expiryDays ?? null) : days;
  const save = useMutation({
    mutationFn: () => payrollApi.savePayslipLinkSettings(shown),
    onSuccess: () => { toast.success("Saved."); setDays(undefined); void queryClient.invalidateQueries({ queryKey: ["payroll", "payslip-link-settings"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save.")),
  });
  return (
    <>
      <PageHeader title="Payslip links" subtitle="What the payslip email contains, and how long its link works" />
      <Stack>
        {q.isLoading && <SkeletonCard lines={2} />}
        {q.error && <ApprovalBanner tone="danger" title="Could not load" description={apiErrorMessage(q.error, "Try again.")} />}
        {q.data && (
          <>
            <Panel title="The link in the email" subtitle={shown === null ? "Not set: the email has no link" : `The link works for ${shown} ${shown === 1 ? "day" : "days"}`}>
              <Form layout="vertical" component="div" requiredMark={false}>
                <Form.Item label="Days the link works" htmlFor="pl-days" extra="Whole days, 1 to 100. Leave empty for Not set: then the email carries no link and only says to sign in.">
                  <InputNumber id="pl-days" min={1} max={100} precision={0} placeholder="Not set" value={shown} onChange={(x) => setDays(x === null ? null : Number(x))} style={{ width: 160 }} />
                </Form.Item>
                <Button type="primary" size="large" loading={save.isPending} disabled={days === undefined} onClick={() => save.mutate()}>Save</Button>
              </Form>
              <Caption>The link is for one payslip and one person, needs a sign-in, and is checked again each time it is opened. A run's links can be revoked from its page.</Caption>
            </Panel>
            <Panel title="Password-protected PDF">
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Switch checked={false} disabled aria-label="Password-protected PDF" />
                <StatusChip tone="warning">Needs owner approval</StatusChip>
                <span>Off. It cannot be turned on until the owners approve it.</span>
              </div>
            </Panel>
          </>
        )}
      </Stack>
    </>
  );
}
