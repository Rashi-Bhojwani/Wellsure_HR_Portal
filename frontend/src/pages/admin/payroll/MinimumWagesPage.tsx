import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AutoComplete, Button, DatePicker, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as api from "../../../api/minimumWages";
import * as payrollApi from "../../../api/payroll";
import type { MinimumWageCheck, MinimumWageSetup } from "../../../api/minimumWages";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, PageHeader, Panel, SideDrawer, Stack, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Minimum wages (ST-29, docs/plans/A_PARITY_ROWS.md part 2), directors only. Every rate (state as written on the branches, category, monthly amount, from,
// source), each person's category and the pay heads compared are entered here; none is preset. The check reads a calculated run and never changes pay.
type Rate = MinimumWageSetup["rates"][number];
type Below = MinimumWageCheck["below"][number];
interface RateForm { state: string; category: string; monthlyAmount: string; effectiveFrom: Dayjs; source: string }

export function MinimumWagesPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [rateForm] = Form.useForm<RateForm>();
  const [heads, setHeads] = useState<string[] | null>(null);
  const [basisSource, setBasisSource] = useState("");
  const [personQ, setPersonQ] = useState("");
  const [person, setPerson] = useState<{ id: string; label: string } | null>(null);
  const [category, setCategory] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const setup = useQuery({ queryKey: ["minimum-wages"], queryFn: api.minimumWageSetup });
  const comps = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const runs = useQuery({ queryKey: ["payroll", "runs", "mw"], queryFn: () => payrollApi.listRuns(1, 24) });
  const people = useQuery({ queryKey: ["payroll", "people", personQ], queryFn: () => payrollApi.searchPeople(personQ), enabled: personQ.trim().length >= 2 });
  const check = useQuery({ queryKey: ["minimum-wages", "check", runId], queryFn: () => api.minimumWageCheck(runId!), enabled: !!runId });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["minimum-wages"] });
  const fail = (what: string) => (err: unknown) => toast.error(apiErrorMessage(err, what));
  const addRate = useMutation({ mutationFn: (v: RateForm) => api.addMinimumWage({ ...v, effectiveFrom: v.effectiveFrom.format("YYYY-MM-DD") }), onSuccess: () => { toast.success("Rate entered."); setAdding(false); rateForm.resetFields(); refresh(); }, onError: fail("Could not enter the rate.") });
  const saveBasis = useMutation({ mutationFn: () => api.setMinimumWageBasis(heads ?? [], basisSource.trim()), onSuccess: () => { toast.success("Compared heads saved."); setHeads(null); setBasisSource(""); refresh(); }, onError: fail("Could not save.") });
  const saveCategory = useMutation({ mutationFn: () => api.setMinimumWageCategory(person!.id, category.trim()), onSuccess: () => { toast.success("Category set."); setPerson(null); setPersonQ(""); setCategory(""); refresh(); }, onError: fail("Could not set the category.") });
  const basis = setup.data?.basis;
  const chosenHeads = heads ?? basis?.headCodes ?? [];
  const categories = [...new Set((setup.data?.rates ?? []).map((r) => r.category))];
  return (
    <>
      <PageHeader title="Minimum wages" subtitle="Rates, categories and the compared pay heads are yours to enter; the check never changes pay." actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Enter a rate</Button>} />
      <Stack>
        <ApprovalBanner tone="info" title="Nothing is preset" description={setup.data?.note ?? "Every value here is entered by a director with its source."} />
        <Panel title="Pay heads compared with the minimum" subtitle={basis ? `In force since ${dayjs(basis.setAt).format("D MMM YYYY")}: ${basis.source}` : "Not set"}>
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
            <Select mode="multiple" aria-label="Pay heads" placeholder="Choose the pay heads" style={{ minWidth: 280, flex: 1 }} value={chosenHeads} onChange={setHeads} loading={comps.isLoading} options={(comps.data ?? []).filter((c) => c.value?.type === "EARNING").map((c) => ({ value: c.code, label: c.value?.payslipLabel ? `${c.value.payslipLabel} (${c.code})` : c.code }))} />
            <Input aria-label="Source" placeholder="Where this comes from" value={basisSource} onChange={(e) => setBasisSource(e.target.value)} style={{ minWidth: 220, flex: 1 }} />
            <Button disabled={!heads || heads.length === 0 || basisSource.trim().length < 3} loading={saveBasis.isPending} onClick={() => saveBasis.mutate()}>Save</Button>
          </div>
        </Panel>
        <Panel title="Rates">
          <DataTable<Rate>
            rowKey="id"
            loading={setup.isLoading}
            error={setup.error}
            onRetry={() => void setup.refetch()}
            dataSource={setup.data?.rates ?? []}
            empty="No rates yet."
            pagination={{ pageSize: 20 }}
            columns={[
              { title: "State", dataIndex: "state" },
              { title: "Category", dataIndex: "category" },
              { title: "Monthly", dataIndex: "monthlyAmount", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "From", dataIndex: "effectiveFrom", render: (x: string) => dayjs(x).format("D MMM YYYY") },
              { title: "Source", dataIndex: "source" },
            ]}
          />
        </Panel>
        <Panel title="A person's category" subtitle="Not set for anyone until you choose it.">
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            <AutoComplete aria-label="Employee" placeholder="Search by name or number" style={{ minWidth: 260, flex: 1 }} value={person ? person.label : personQ} onChange={(v) => { setPerson(null); setPersonQ(v); }} onSelect={(v: string, o: { label?: string }) => setPerson({ id: v, label: String(o.label ?? v) })} options={(people.data ?? []).map((p) => ({ value: p.employeeId, label: `${p.name} (${p.employeeCode})` }))} />
            <AutoComplete aria-label="Category" placeholder="Category" style={{ minWidth: 180 }} value={category} onChange={setCategory} options={categories.map((c) => ({ value: c }))} />
            <Button disabled={!person || category.trim().length === 0} loading={saveCategory.isPending} onClick={() => saveCategory.mutate()}>Set</Button>
          </div>
        </Panel>
        <Panel title="Check a run" extra={<Select aria-label="Run" placeholder="Choose a run" style={{ minWidth: 200 }} value={runId} onChange={setRunId} options={(runs.data?.items ?? []).filter((r) => r.runHash).map((r) => ({ value: r.id, label: `${r.cycle.label} (${r.statusLabel})` }))} />}>
          {!runId && <span>Choose a calculated run.</span>}
          {check.data?.notSet.map((n) => <ApprovalBanner key={n} tone="warning" title="Not set" description={n} style={{ marginBottom: space[2] }} />)}
          {runId && (
            <DataTable<Below>
              rowKey="employeeCode"
              loading={check.isLoading}
              error={check.error}
              dataSource={check.data?.below ?? []}
              empty={check.data ? `Nobody below the minimum (${check.data.checked} checked).` : "—"}
              pagination={{ pageSize: 25 }}
              columns={[
                { title: "Employee", key: "e", render: (_, b) => `${b.name} (${b.employeeCode})` },
                { title: "State", dataIndex: "state" },
                { title: "Category", dataIndex: "category" },
                { title: "Compared", dataIndex: "compared", align: "right", render: (x: string) => formatRupees(x, 2) },
                { title: "Minimum", dataIndex: "minimum", align: "right", render: (x: string) => formatRupees(x, 2) },
                { title: "Short by", dataIndex: "shortfall", align: "right", render: (x: string) => formatRupees(x, 2) },
              ]}
            />
          )}
        </Panel>
      </Stack>
      <SideDrawer open={adding} title="Enter a minimum wage" subtitle="The state as written on your branches; the newest rate in force on a run's last day is used." onClose={() => setAdding(false)} formId="mw-rate-form" primaryLabel="Enter" primaryLoading={addRate.isPending}>
        <Form id="mw-rate-form" form={rateForm} layout="vertical" requiredMark={false} onFinish={(v) => addRate.mutate(v)}>
          <Form.Item name="state" label="State" rules={[{ required: true, message: "Choose the state" }]}><AutoComplete options={(setup.data?.branchStates ?? []).map((s) => ({ value: s }))} /></Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true, message: "e.g. the skill category" }]}><AutoComplete options={categories.map((c) => ({ value: c }))} /></Form.Item>
          <Form.Item name="monthlyAmount" label="Monthly amount (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Digits, up to two decimals" }]}><Input inputMode="decimal" /></Form.Item>
          <Form.Item name="effectiveFrom" label="From" rules={[{ required: true, message: "Choose the day" }]}><DatePicker format="D MMM YYYY" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="source" label="Source (notification, date)" rules={[{ required: true, min: 3, message: "Say where it comes from" }]}><Input /></Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}

export default MinimumWagesPage;
