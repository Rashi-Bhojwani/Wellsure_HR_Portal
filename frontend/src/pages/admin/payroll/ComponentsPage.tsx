import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select, Switch, Tooltip } from "antd";
import { EditOutlined, HistoryOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { COMPONENT_TYPES, COMPONENT_TYPE_LABEL, ITEM_CODE_PATTERN } from "@shared/constants/payrollSalary";
import * as payrollApi from "../../../api/payroll";
import type { ComponentValue, ComponentView } from "../../../api/payroll";
import { ItemConfirmModal, ItemHistoryDrawer } from "../../../components/payroll/ItemDialogs";
import { ItemStatusTag } from "../../../components/payroll/ItemStatusTag";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { describeComponent } from "./salaryText";
import { ApprovalBanner, DataTable, EmptyState, FilterBar, FormGroupTitle, KeyValueGrid, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import { Caption, PersonCell } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Payroll → Salary components (Phase 6 P6-2). A component says what a line IS: whether it is an earning or a deduction, and which tax and statutory
// treatments apply. How much each line gets is the structure's job. A component is a Placeholder until a director confirms it; editing one adds
// the next version and nobody's pay moves until a structure and a salary revision pick it up.

const EMPTY: ComponentValue = { name: "", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "", payslipOrder: 1 };

export function ComponentsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const canConfirm = hasPermission("payroll.rules.confirm");
  const [editing, setEditing] = useState<{ code: string | null; value: ComponentValue } | null>(null);
  const [confirming, setConfirming] = useState<ComponentView | null>(null);
  const [history, setHistory] = useState<ComponentView | null>(null);
  const [search, setSearch] = useState("");
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  const q = search.trim().toLowerCase();
  const shown = q ? data.filter((c) => c.code.toLowerCase().includes(q) || (c.value?.name ?? "").toLowerCase().includes(q)) : data;
  const addButton = canEdit && (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ code: null, value: EMPTY })}>
      Add a component
    </Button>
  );

  const actions = (c: ComponentView, block?: boolean) => (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: block ? "stretch" : "flex-end", width: block ? "100%" : undefined }}>
      {canEdit && (
        <Button size={block ? undefined : "small"} style={block ? { flex: 1 } : undefined} icon={<EditOutlined />} onClick={() => setEditing({ code: c.code, value: c.value! })}>
          Edit
        </Button>
      )}
      {canConfirm && c.status === "PLACEHOLDER" && (
        <Button size={block ? undefined : "small"} style={block ? { flex: 1 } : undefined} type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setConfirming(c)}>
          Confirm…
        </Button>
      )}
      <Button size={block ? undefined : "small"} style={block ? { flex: 1 } : undefined} icon={<HistoryOutlined />} onClick={() => setHistory(c)}>
        History
      </Button>
    </div>
  );

  const treatedAs = (c: ComponentView) => {
    const chips = [c.value?.taxable && <StatusChip key="t" tone="info">Taxable</StatusChip>, c.value?.pfApplicable && <StatusChip key="pf" tone="purple">PF</StatusChip>, c.value?.esiApplicable && <StatusChip key="esi" tone="purple">ESI</StatusChip>, c.value?.prorates && <StatusChip key="p" tone="neutral">Pro-rates with paid days</StatusChip>].filter(Boolean);
    return chips.length ? <span style={{ display: "inline-flex", gap: space[1], flexWrap: "wrap" }}>{chips}</span> : "—";
  };
  const statusCell = (c: ComponentView) => (
    <div>
      <ItemStatusTag status={c.status} sourceLabel={c.sourceLabel} />
      {c.lastConfirmed && <Caption>Last confirmed: version {c.lastConfirmed.version}</Caption>}
    </div>
  );
  const usedBy = (c: ComponentView) =>
    c.usedBy.length === 0 ? (
      <Caption>No structure yet</Caption>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
        {c.usedBy.map((u) => (
          <span key={u.structure} style={{ display: "inline-flex", gap: space[1], alignItems: "center", flexWrap: "wrap" }}>
            {u.structureName}
            {u.behind && (
              <Tooltip title={`This structure uses version ${u.pinnedVersion}; a newer version exists. Save a new version of the structure to use it.`}>
                <span tabIndex={0} aria-label={`${u.structureName} uses version ${u.pinnedVersion}; a newer version exists. Save a new version of the structure to use it.`}>
                  <StatusChip tone="warning">older version</StatusChip>
                </span>
              </Tooltip>
            )}
          </span>
        ))}
      </div>
    );

  return (
    <>
      <PageHeader title="Salary components" subtitle="The lines a salary is made of" actions={addButton} />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="What a line is, not how much"
          description={
            <>
              A component is one line of a salary: Basic, HRA, Special allowance, a deduction. It says what the line is and how it is treated for tax, PF and ESI. How much each line gets is set in the{" "}
              <Link to="/admin/payroll/structures">salary structure</Link>. PF, ESI, professional tax, LWF and TDS are not components: the calculation produces them from the rules.
            </>
          }
        />
        <Panel>
          <FilterBar onSearch={setSearch} searchPlaceholder="Search a component" />
          <DataTable<ComponentView>
            rowKey="code"
            density="compact"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={shown}
            pagination={false}
            empty={
              q ? (
                <EmptyState kind="no-results" compact title="No component matches" description="Try another name or code." />
              ) : (
                <EmptyState compact title="No components yet" description="Add the lines your salaries are made of." action={addButton || undefined} />
              )
            }
            mobile={{
              title: (c) => c.value?.name,
              subtitle: (c) => c.code,
              status: (c) => (c.value ? <StatusChip tone="neutral">{COMPONENT_TYPE_LABEL[c.value.type]}</StatusChip> : null),
              fields: [
                { label: "Treated as", render: treatedAs },
                { label: "Status", render: statusCell },
                { label: "Used by", render: usedBy },
              ],
              actions: (c) => actions(c, true),
            }}
            columns={[
              { title: "Component", key: "component", render: (_, c) => <PersonCell name={c.value?.name} code={c.code} /> },
              { title: "Kind", key: "kind", render: (_, c) => (c.value ? <StatusChip tone="neutral">{COMPONENT_TYPE_LABEL[c.value.type]}</StatusChip> : null) },
              { title: "Treated as", key: "treated", width: 200, render: (_, c) => treatedAs(c) },
              { title: "Status", key: "status", width: 190, render: (_, c) => statusCell(c) },
              { title: "Used by", key: "usedBy", render: (_, c) => usedBy(c) },
              // Narrow on purpose: the buttons stack rather than push the table into a sideways scroll at laptop widths.
              { title: "", key: "actions", align: "right", width: 116, render: (_, c) => actions(c) },
            ]}
          />
        </Panel>
      </Stack>
      {editing && <EditDrawer initial={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {confirming && (
        <ItemConfirmModal
          title={`Confirm: ${confirming.value?.name}`}
          queryKey={["payroll", "component-confirm", confirming.code]}
          loadPreview={() => payrollApi.previewComponentConfirm(confirming.code)}
          confirm={(b) => payrollApi.confirmComponent(confirming.code, b)}
          renderValue={(p) => describeComponent(p.value)}
          onClose={() => setConfirming(null)}
          onDone={refresh}
        />
      )}
      {history && <ItemHistoryDrawer title={`History: ${history.value?.name}`} queryKey={["payroll", "component-history", history.code]} load={async () => (await payrollApi.getComponent(history.code)).history} renderValue={describeComponent} onClose={() => setHistory(null)} />}
    </>
  );
}

function EditDrawer({ initial, onClose, onSaved }: { initial: { code: string | null; value: ComponentValue }; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<ComponentValue & { code: string }>();
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const isNew = initial.code === null;
  const preview = useMutation({
    mutationFn: async () => {
      const v = await form.validateFields();
      const { code, ...value } = v;
      return { code: isNew ? code : initial.code!, value: value as ComponentValue, result: await payrollApi.previewComponentSave(isNew ? code : initial.code!, value as ComponentValue) };
    },
    onError: (err) => {
      // A field that fails its own check is shown on the field; anything else is the server's answer.
      if (err && typeof err === "object" && "errorFields" in err) return;
      setProblem(apiErrorMessage(err, "Could not check that."));
    },
    onSuccess: () => setProblem(null),
  });
  const save = useMutation({
    mutationFn: () => payrollApi.saveComponent(preview.data!.code, { value: preview.data!.value, note, fingerprint: preview.data!.result.fingerprint }),
    onSuccess: () => {
      toast.success("Saved as an unconfirmed version.");
      onSaved();
      onClose();
    },
    onError: (err) => setProblem(apiErrorMessage(err, "Could not save."))
  });
  const p = preview.data?.result;
  return (
    <SideDrawer
      open
      title={isNew ? "Add a component" : `Edit ${initial.value.name}`}
      subtitle={p ? "Check the change, then save it" : "A new version is a Placeholder until a director confirms it"}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%", flexWrap: "wrap" }}>
          {p ? (
            <>
              <Button size="large" style={{ flex: "1 1 120px" }} onClick={() => preview.reset()}>Back</Button>
              <Button size="large" type="primary" style={{ flex: "1 1 260px" }} loading={save.isPending} disabled={p.unchanged} onClick={() => save.mutate()}>
                Save as an unconfirmed version
              </Button>
            </>
          ) : (
            <>
              <Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
              <Button size="large" type="primary" style={{ flex: 1 }} loading={preview.isPending} onClick={() => preview.mutate()}>
                Preview
              </Button>
            </>
          )}
        </div>
      }
    >
      {/* The form stays mounted while the preview is shown, so Back returns to exactly what was typed. */}
      <div hidden={!!p}>
        <Form form={form} layout="vertical" initialValues={{ ...initial.value, code: initial.code ?? "" }} onValuesChange={() => setProblem(null)}>
          {isNew && (
            <Form.Item name="code" label="Code" extra="Capital letters, digits and underscores, for example BASIC. It cannot be changed later." rules={[{ required: true, pattern: ITEM_CODE_PATTERN, message: "Use capital letters, digits and underscores, starting with a letter" }]}>
              <Input placeholder="BASIC" maxLength={25} autoComplete="off" />
            </Form.Item>
          )}
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2, max: 60 }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="type" label="Kind" rules={[{ required: true }]}>
            <Select options={COMPONENT_TYPES.map((t) => ({ value: t, label: COMPONENT_TYPE_LABEL[t] }))} />
          </Form.Item>
          <FormGroupTitle>Treatment</FormGroupTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", columnGap: space[4] }}>
            <Form.Item name="taxable" label="Taxable" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="pfApplicable" label="PF applies" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="esiApplicable" label="ESI applies" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="prorates" label="Pro-rates with paid days" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <FormGroupTitle>On the payslip</FormGroupTitle>
          <div style={{ display: "flex", gap: space[4], flexWrap: "wrap" }}>
            <Form.Item name="payslipLabel" label="Called on the payslip" rules={[{ required: true, max: 60 }]} style={{ flex: 1, minWidth: 200 }}>
              <Input maxLength={60} />
            </Form.Item>
            <Form.Item name="payslipOrder" label="Position on the payslip" rules={[{ required: true }]}>
              <InputNumber min={1} max={999} precision={0} />
            </Form.Item>
          </div>
          {problem && <ApprovalBanner tone="danger" title={problem} />}
        </Form>
      </div>
      {p && (
        <Stack gap={space[3]}>
          <KeyValueGrid
            columns={1}
            items={[
              { label: "After saving", value: describeComponent(p.after.value) },
              ...(p.before ? [{ label: "Now", value: `Version ${p.before.version}, ${p.before.status === "CONFIRMED" ? "Confirmed" : "Placeholder"}` }] : []),
            ]}
          />
          {p.unchanged && <ApprovalBanner tone="warning" title="That is the value it already has. There is nothing to save." />}
          {p.willResetConfirmation && <ApprovalBanner tone="warning" title="This component is Confirmed now." description="Saving adds a new version that is a Placeholder until a director confirms it. The Confirmed version stays on record and in every structure that pinned it." />}
          <ApprovalBanner tone="info" title={p.impact} />
          <Form layout="vertical" component="div">
            <Form.Item label="Why this, and where it came from" htmlFor="component-note" extra="Optional, but the person who confirms it will want it." style={{ marginBottom: 0 }}>
              <Input.TextArea id="component-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="For example: as agreed with the CA" />
            </Form.Item>
          </Form>
          {problem && <ApprovalBanner tone="danger" title={problem} />}
        </Stack>
      )}
    </SideDrawer>
  );
}
