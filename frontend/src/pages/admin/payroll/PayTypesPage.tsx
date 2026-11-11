import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select } from "antd";
import * as loansApi from "../../../api/loans";
import * as claimsApi from "../../../api/reimbursements";
import type { LoanType } from "../../../api/loans";
import type { ClaimType } from "../../../api/reimbursements";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { DataTable, PageHeader, Panel, SideDrawer, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Loan and claim types (item 3, 2026-11-11), directors only. Nothing is preset: a new type starts with every value Not set, and a type is usable only once
// every value is chosen (the API says what is missing). Each save needs a reason and is kept as a new version (audited).
const TRI = [
  { value: "unset", label: "Not set" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const fromTri = (v: string | undefined): boolean | null => (v === "yes" ? true : v === "no" ? false : null);
const toTri = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "unset");
const blank = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);
const CAP = [
  { value: "unset", label: "Not set" },
  { value: "none", label: "No cap (chosen)" },
  { value: "cap", label: "A cap" },
];

type LoanForm = { typeKey: string; name: string; maxAmount?: string; maxInstalments?: number | null; ratePercent?: string; employeesMayRequest: string; disbursementHead?: string; principalHead?: string; interestHead?: string; retired: string; reason: string };
type ClaimForm = { typeKey: string; name: string; employeesMayClaim: string; billsRequired: string; monthly: string; monthlyCap?: string; yearly: string; yearlyCap?: string; payHead?: string; retired: string; reason: string };

const notSet = (v: unknown) => (v === null || v === undefined ? <StatusChip tone="warning">Not set</StatusChip> : null);
const gapsChip = (gaps: string[]) => (gaps.length === 0 ? <StatusChip tone="success">Complete</StatusChip> : <StatusChip tone="warning">{`${gaps.length} not set`}</StatusChip>);

export function PayTypesPage() {
  const queryClient = useQueryClient();
  const [loanOpen, setLoanOpen] = useState<LoanType | "new" | null>(null);
  const [claimOpen, setClaimOpen] = useState<ClaimType | "new" | null>(null);
  const [loanForm] = Form.useForm<LoanForm>();
  const [claimForm] = Form.useForm<ClaimForm>();
  const loans = useQuery({ queryKey: ["loans", "types"], queryFn: loansApi.loanTypes });
  const claims = useQuery({ queryKey: ["claims", "types"], queryFn: claimsApi.claimTypes });
  const saveLoan = useMutation({
    mutationFn: (v: LoanForm) =>
      loansApi.saveLoanType({ typeKey: v.typeKey, name: v.name, maxAmount: blank(v.maxAmount), maxInstalments: v.maxInstalments ?? null, ratePercent: blank(v.ratePercent), employeesMayRequest: fromTri(v.employeesMayRequest), disbursementHead: blank(v.disbursementHead), principalHead: blank(v.principalHead), interestHead: blank(v.interestHead), retired: v.retired === "yes", reason: v.reason }),
    onSuccess: () => { toast.success("Saved as a new version."); setLoanOpen(null); void queryClient.invalidateQueries({ queryKey: ["loans"] }); },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the loan type.")),
  });
  const saveClaim = useMutation({
    mutationFn: (v: ClaimForm) =>
      claimsApi.saveClaimType({ typeKey: v.typeKey, name: v.name, employeesMayClaim: fromTri(v.employeesMayClaim), billsRequired: fromTri(v.billsRequired), monthlyCapSet: v.monthly !== "unset", monthlyCap: v.monthly === "cap" ? blank(v.monthlyCap) : null, yearlyCapSet: v.yearly !== "unset", yearlyCap: v.yearly === "cap" ? blank(v.yearlyCap) : null, payHead: blank(v.payHead), retired: v.retired === "yes", reason: v.reason }),
    onSuccess: () => { toast.success("Saved as a new version."); setClaimOpen(null); void queryClient.invalidateQueries({ queryKey: ["claims"] }); },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the claim type.")),
  });
  const openLoan = (t: LoanType | "new") => {
    setLoanOpen(t);
    loanForm.resetFields();
    if (t !== "new") loanForm.setFieldsValue({ typeKey: t.typeKey, name: t.name, maxAmount: t.maxAmount ?? undefined, maxInstalments: t.maxInstalments, ratePercent: t.ratePercent ?? undefined, employeesMayRequest: toTri(t.employeesMayRequest), disbursementHead: t.disbursementHead ?? undefined, principalHead: t.principalHead ?? undefined, interestHead: t.interestHead ?? undefined, retired: t.retired ? "yes" : "no" });
    else loanForm.setFieldsValue({ employeesMayRequest: "unset", retired: "no" });
  };
  const openClaim = (t: ClaimType | "new") => {
    setClaimOpen(t);
    claimForm.resetFields();
    if (t !== "new") claimForm.setFieldsValue({ typeKey: t.typeKey, name: t.name, employeesMayClaim: toTri(t.employeesMayClaim), billsRequired: toTri(t.billsRequired), monthly: !t.monthlyCapSet ? "unset" : t.monthlyCap ? "cap" : "none", monthlyCap: t.monthlyCap ?? undefined, yearly: !t.yearlyCapSet ? "unset" : t.yearlyCap ? "cap" : "none", yearlyCap: t.yearlyCap ?? undefined, payHead: t.payHead ?? undefined, retired: t.retired ? "yes" : "no" });
    else claimForm.setFieldsValue({ employeesMayClaim: "unset", billsRequired: "unset", monthly: "unset", yearly: "unset", retired: "no" });
  };
  const monthly = Form.useWatch("monthly", claimForm);
  const yearly = Form.useWatch("yearly", claimForm);
  return (
    <>
      <PageHeader title="Loan and claim types" subtitle="Nothing is preset. A type can be used only once every value is chosen; each save is a new version with a reason." />
      <Panel title="Loan types" extra={<Button onClick={() => openLoan("new")}>Add a loan type</Button>} style={{ marginBottom: space[4] }}>
        <DataTable<LoanType>
          rowKey="typeKey"
          loading={loans.isLoading}
          error={loans.error}
          onRetry={() => void loans.refetch()}
          dataSource={loans.data ?? []}
          empty="No loan types. None is preset."
          pagination={false}
          mobile={{ title: (t) => t.name, subtitle: (t) => t.typeKey, status: (t) => gapsChip(t.gaps), fields: [{ label: "Most", render: (t) => notSet(t.maxAmount) ?? formatRupees(t.maxAmount!, 2) }, { label: "Rate", render: (t) => notSet(t.ratePercent) ?? `${t.ratePercent}%` }], actions: (t) => <Button size="large" block onClick={() => openLoan(t)}>Change</Button> }}
          columns={[
            { title: "Type", key: "t", render: (_, t) => `${t.name} (${t.typeKey})` },
            { title: "Most", key: "m", align: "right", render: (_, t) => notSet(t.maxAmount) ?? formatRupees(t.maxAmount!, 2) },
            { title: "Instalments", key: "i", render: (_, t) => notSet(t.maxInstalments) ?? t.maxInstalments },
            { title: "Rate", key: "r", render: (_, t) => notSet(t.ratePercent) ?? `${t.ratePercent}% a year` },
            { title: "Complete", key: "g", render: (_, t) => gapsChip(t.gaps) },
            { title: "", key: "act", fixed: "right" as const, render: (_, t) => <Button onClick={() => openLoan(t)}>Change</Button> },
          ]}
        />
      </Panel>
      <Panel title="Claim types" extra={<Button onClick={() => openClaim("new")}>Add a claim type</Button>}>
        <DataTable<ClaimType>
          rowKey="typeKey"
          loading={claims.isLoading}
          error={claims.error}
          onRetry={() => void claims.refetch()}
          dataSource={claims.data ?? []}
          empty="No claim types. None is preset."
          pagination={false}
          mobile={{ title: (t) => t.name, subtitle: (t) => t.typeKey, status: (t) => gapsChip(t.gaps), fields: [{ label: "Monthly cap", render: (t) => (!t.monthlyCapSet ? <StatusChip tone="warning">Not set</StatusChip> : t.monthlyCap ? formatRupees(t.monthlyCap, 2) : "No cap") }], actions: (t) => <Button size="large" block onClick={() => openClaim(t)}>Change</Button> }}
          columns={[
            { title: "Type", key: "t", render: (_, t) => `${t.name} (${t.typeKey})` },
            { title: "Monthly cap", key: "m", align: "right", render: (_, t) => (!t.monthlyCapSet ? <StatusChip tone="warning">Not set</StatusChip> : t.monthlyCap ? formatRupees(t.monthlyCap, 2) : "No cap") },
            { title: "Yearly cap", key: "y", align: "right", render: (_, t) => (!t.yearlyCapSet ? <StatusChip tone="warning">Not set</StatusChip> : t.yearlyCap ? formatRupees(t.yearlyCap, 2) : "No cap") },
            { title: "Bills", key: "b", render: (_, t) => notSet(t.billsRequired) ?? (t.billsRequired ? "Required" : "Not required") },
            { title: "Complete", key: "g", render: (_, t) => gapsChip(t.gaps) },
            { title: "", key: "act", fixed: "right" as const, render: (_, t) => <Button onClick={() => openClaim(t)}>Change</Button> },
          ]}
        />
      </Panel>

      <SideDrawer open={!!loanOpen} title={loanOpen === "new" ? "New loan type" : `Loan type ${loanOpen ? loanOpen.typeKey : ""}`} subtitle="Leave a value empty to keep it Not set. Rate 0 is a choice, not a default." onClose={() => setLoanOpen(null)} formId="loan-type-form" primaryLabel="Save" primaryLoading={saveLoan.isPending}>
        <Form id="loan-type-form" form={loanForm} layout="vertical" requiredMark={false} onFinish={(v) => saveLoan.mutate(v)}>
          <Form.Item name="typeKey" label="Key" rules={[{ required: true, pattern: /^[A-Z][A-Z0-9_]{1,31}$/, message: "Capital letters, digits and _ (for example STAFF_ADVANCE)" }]}><Input disabled={loanOpen !== "new"} /></Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <Form.Item name="maxAmount" label="Most that can be lent (₹)" rules={[{ pattern: /^\d+(\.\d{1,2})?$/, message: "An amount, or empty for Not set" }]}><Input inputMode="decimal" placeholder="Not set" /></Form.Item>
          <Form.Item name="maxInstalments" label="Most instalments"><InputNumber min={1} max={600} placeholder="Not set" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="ratePercent" label="Interest rate (% a year)" rules={[{ pattern: /^\d{1,3}(\.\d{1,4})?$/, message: "A percentage, or empty for Not set" }]}><Input inputMode="decimal" placeholder="Not set" /></Form.Item>
          <Form.Item name="employeesMayRequest" label="Employees may ask for it themselves"><Select options={TRI} /></Form.Item>
          <Form.Item name="disbursementHead" label="Earning pay head the money is paid under"><Input placeholder="Not set" /></Form.Item>
          <Form.Item name="principalHead" label="Deduction pay head for the principal part"><Input placeholder="Not set" /></Form.Item>
          <Form.Item name="interestHead" label="Deduction pay head for the interest part"><Input placeholder="Not set" /></Form.Item>
          <Form.Item name="retired" label="Retired (no new loans)"><Select options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} /></Form.Item>
          <Form.Item name="reason" label="Reason for this change" rules={[{ required: true, min: 3 }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </SideDrawer>

      <SideDrawer open={!!claimOpen} title={claimOpen === "new" ? "New claim type" : `Claim type ${claimOpen ? claimOpen.typeKey : ""}`} subtitle="Leave a value Not set until you choose it. 'No cap' is a choice, not a default." onClose={() => setClaimOpen(null)} formId="claim-type-form" primaryLabel="Save" primaryLoading={saveClaim.isPending}>
        <Form id="claim-type-form" form={claimForm} layout="vertical" requiredMark={false} onFinish={(v) => saveClaim.mutate(v)}>
          <Form.Item name="typeKey" label="Key" rules={[{ required: true, pattern: /^[A-Z][A-Z0-9_]{1,31}$/, message: "Capital letters, digits and _" }]}><Input disabled={claimOpen !== "new"} /></Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <Form.Item name="employeesMayClaim" label="Employees may claim it"><Select options={TRI} /></Form.Item>
          <Form.Item name="billsRequired" label="Bills required"><Select options={TRI} /></Form.Item>
          <Form.Item name="monthly" label="Monthly cap"><Select options={CAP} /></Form.Item>
          {monthly === "cap" && <Form.Item name="monthlyCap" label="Monthly cap (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "An amount" }]}><Input inputMode="decimal" /></Form.Item>}
          <Form.Item name="yearly" label="Yearly cap (financial year)"><Select options={CAP} /></Form.Item>
          {yearly === "cap" && <Form.Item name="yearlyCap" label="Yearly cap (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "An amount" }]}><Input inputMode="decimal" /></Form.Item>}
          <Form.Item name="payHead" label="Earning pay head it is paid under"><Input placeholder="Not set" /></Form.Item>
          <Form.Item name="retired" label="Retired (no new claims)"><Select options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} /></Form.Item>
          <Form.Item name="reason" label="Reason for this change" rules={[{ required: true, min: 3 }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
