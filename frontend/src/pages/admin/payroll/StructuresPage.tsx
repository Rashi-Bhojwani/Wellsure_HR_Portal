import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Select, Table, Tooltip } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, HistoryOutlined, PlusOutlined, SafetyCertificateOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { COMPONENT_TYPES, COMPONENT_TYPE_LABEL, ITEM_CODE_PATTERN, LINE_CALC_LABEL, LINE_CALC_METHODS, type LineCalcMethod } from "@shared/constants/payrollSalary";
import * as payrollApi from "../../../api/payroll";
import type { ComponentType, ComponentView, LineCalc, SampleResult, StructureLine, StructureSavePreview, StructureValue, StructureView } from "../../../api/payroll";
import { ItemConfirmModal, ItemHistoryDrawer } from "../../../components/payroll/ItemDialogs";
import { ItemStatusTag } from "../../../components/payroll/ItemStatusTag";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { describeCalc } from "./salaryText";
import { ApprovalBanner, DataTable, EmptyState, FormGroupTitle, PageHeader, Panel, SideDrawer, SkeletonTable, Stack, StatusChip, toast, useIsPhone } from "../../../ui";
import { Caption, Figure, FigureRow, Num, PersonCell } from "../../../components/payroll/payrollUi";
import { fw, radius, space, v } from "../../../theme/tokens";

// Payroll → Salary structures (Phase 6 P6-2). A structure says how much each line of a salary gets out of CTC. Saving one proves, for a sample CTC, that its
// lines add up to CTC exactly; a structure that cannot produce a salary cannot be saved. Nobody's pay changes when a structure is saved: people move to a
// new version only through a salary revision, which a second person approves.

const defaultCalc = (m: LineCalcMethod): LineCalc =>
  m === "PERCENT" ? { method: "PERCENT", of: "CTC", percent: "" } : m === "FIXED_AMOUNT" ? { method: "FIXED_AMOUNT", amount: "" } : m === "FORMULA" ? { method: "FORMULA", formula: "" } : m === "PER_PERSON" ? { method: "PER_PERSON" } : m === "SLAB" ? { method: "SLAB", of: "CTC", slabs: [{ from: "", to: null, amount: "" }] } : { method: "BALANCE" };

type SlabCalc = Extract<LineCalc, { method: "SLAB" }>;

/** A lookup table: for a value from "from" up to (not including) "to", the line is "amount". The last row may have no upper limit. */
function SlabEditor({ label, calc, bases, onChange }: { label: string; calc: SlabCalc; bases: Array<{ value: string; label: string }>; onChange: (c: SlabCalc) => void }) {
  const setRow = (k: number, patch: Partial<SlabCalc["slabs"][number]>) => onChange({ ...calc, slabs: calc.slabs.map((r, j) => (j === k ? { ...r, ...patch } : r)) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
      <Select aria-label={`Looked up by, for ${label}`} value={calc.of} options={bases} onChange={(of) => onChange({ ...calc, of })} />
      {calc.slabs.map((r, k) => (
        <div key={k} style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
          <Input aria-label={`From, row ${k + 1}, ${label}`} style={{ width: 110 }} prefix="from" inputMode="decimal" value={r.from} onChange={(e) => setRow(k, { from: e.target.value })} />
          <Input aria-label={`Up to, row ${k + 1}, ${label}`} style={{ width: 130 }} prefix="up to" placeholder="no limit" inputMode="decimal" value={r.to ?? ""} onChange={(e) => setRow(k, { to: e.target.value === "" ? null : e.target.value })} />
          <Input aria-label={`Amount, row ${k + 1}, ${label}`} style={{ width: 130 }} prefix="₹" inputMode="decimal" value={r.amount} onChange={(e) => setRow(k, { amount: e.target.value })} />
          <Button aria-label={`Remove row ${k + 1}, ${label}`} icon={<DeleteOutlined />} disabled={calc.slabs.length === 1} onClick={() => onChange({ ...calc, slabs: calc.slabs.filter((_, j) => j !== k) })} />
        </div>
      ))}
      <Button size="small" icon={<PlusOutlined />} onClick={() => onChange({ ...calc, slabs: [...calc.slabs, { from: "", to: null, amount: "" }] })}>Add a row</Button>
    </div>
  );
}

export function StructuresPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const canConfirm = hasPermission("payroll.rules.confirm");
  const [editing, setEditing] = useState<{ code: string | null; value: StructureValue } | null>(null);
  const [confirming, setConfirming] = useState<StructureView | null>(null);
  const [history, setHistory] = useState<StructureView | null>(null);
  const [viewing, setViewing] = useState<StructureView | null>(null);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "structures"], queryFn: payrollApi.listStructures });
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const componentName = (code: string) => components.find((c) => c.code === code)?.value?.name ?? code;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  const addButton = canEdit && (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ code: null, value: { name: "", description: "", ctcIncludes: ["EARNING"], lines: [] } })}>
      Add a structure
    </Button>
  );

  const actions = (s: StructureView, block?: boolean) => {
    const size = block ? undefined : ("small" as const);
    const style = block ? { flex: 1 } : undefined;
    return (
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: "flex-end", width: block ? "100%" : undefined }}>
        <Button size={size} style={style} icon={<UnorderedListOutlined />} onClick={() => setViewing(s)}>Lines</Button>
        {canEdit && <Button size={size} style={style} icon={<EditOutlined />} onClick={() => setEditing({ code: s.code, value: s.value! })}>Edit</Button>}
        {canConfirm && s.status === "PLACEHOLDER" && <Button size={size} style={style} type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setConfirming(s)}>Confirm…</Button>}
        <Button size={size} style={style} icon={<HistoryOutlined />} onClick={() => setHistory(s)}>History</Button>
      </div>
    );
  };
  const includes = (s: StructureView) => <span style={{ display: "inline-flex", gap: space[1], flexWrap: "wrap" }}>{s.value?.ctcIncludes.map((t) => <StatusChip key={t} tone="neutral">{COMPONENT_TYPE_LABEL[t]}</StatusChip>)}</span>;
  const componentsCell = (s: StructureView) => {
    const unconfirmed = s.components.filter((c) => c.status !== "CONFIRMED").length;
    const newer = s.components.filter((c) => c.newerVersion).length;
    return unconfirmed + newer === 0 ? (
      <Caption>All Confirmed</Caption>
    ) : (
      <span style={{ display: "inline-flex", gap: space[1], flexWrap: "wrap" }}>
        {unconfirmed > 0 && <StatusChip tone="warning">{unconfirmed} not confirmed</StatusChip>}
        {newer > 0 && <StatusChip tone="warning">{newer} newer version{newer > 1 ? "s" : ""}</StatusChip>}
      </span>
    );
  };

  return (
    <>
      <PageHeader title="Salary structures" subtitle="How a CTC is split across the components" actions={addButton} />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="Saving a structure never changes anybody's salary"
          description="A structure splits a person's CTC across the components: for example Basic is 40% of CTC, HRA is half of Basic, and Special allowance is whatever is left. Saving a structure never changes anybody's salary; people move to it through a salary revision."
        />
        <Panel>
          <DataTable<StructureView>
            rowKey="code"
            density="compact"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data}
            pagination={false}
            onRowOpen={setViewing}
            empty={<EmptyState compact title="No structures yet" description="Add a structure to say how a CTC is split across the components." action={addButton || undefined} />}
            mobile={{
              title: (s) => s.value?.name,
              subtitle: (s) => s.code,
              status: (s) => <ItemStatusTag status={s.status} />,
              fields: [
                { label: "Counts toward CTC", render: includes },
                { label: "Lines", render: (s) => s.value?.lines.length ?? "—" },
                { label: "Components", render: componentsCell },
                ...(data.some((s) => s.sourceLabel) ? [{ label: "Source", render: (s: StructureView) => s.sourceLabel ?? "—" }] : []),
              ],
              actions: (s) => actions(s, true),
            }}
            columns={[
              { title: "Structure", key: "structure", render: (_, s) => <PersonCell name={s.value?.name} code={s.code} /> },
              { title: "Counts toward CTC", key: "includes", render: (_, s) => includes(s) },
              { title: "Lines", key: "lines", align: "right", render: (_, s) => <Num>{s.value?.lines.length}</Num> },
              { title: "Status", key: "status", width: 200, render: (_, s) => <ItemStatusTag status={s.status} sourceLabel={s.sourceLabel} /> },
              { title: "Components", key: "components", render: (_, s) => componentsCell(s) },
              { title: "", key: "actions", align: "right", width: 196, render: (_, s) => actions(s) },
            ]}
          />
        </Panel>
      </Stack>
      {viewing && <StructureDrawer s={viewing} nameOf={componentName} onClose={() => setViewing(null)} />}
      {editing && <StructureEditor initial={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {confirming && (
        <ItemConfirmModal
          title={`Confirm: ${confirming.value?.name}`}
          queryKey={["payroll", "structure-confirm", confirming.code]}
          loadPreview={() => payrollApi.previewStructureConfirm(confirming.code)}
          confirm={(b) => payrollApi.confirmStructure(confirming.code, b)}
          renderValue={(p) => `${p.value.name}: ${p.value.lines.length} lines`}
          extra={(p) => (p.unconfirmedComponents.length ? <ApprovalBanner tone="warning" title="Some components are not confirmed yet" description={`${p.unconfirmedComponents.join(", ")}. A salary built on this structure is a test until they are confirmed too.`} /> : null)}
          onClose={() => setConfirming(null)}
          onDone={refresh}
        />
      )}
      {history && <ItemHistoryDrawer title={`History: ${history.value?.name}`} queryKey={["payroll", "structure-history", history.code]} load={async () => (await payrollApi.getStructure(history.code)).history} renderValue={(v) => `${(v as StructureValue).name}: ${(v as StructureValue).lines.length} lines`} onClose={() => setHistory(null)} />}
    </>
  );
}

/** One structure's lines and a worked example (was the expanded row; a drawer so it reads the same on a phone). */
function StructureDrawer({ s, nameOf, onClose }: { s: StructureView; nameOf: (code: string) => string; onClose: () => void }) {
  return (
    <SideDrawer open size="wide" title={s.value?.name ?? s.code} subtitle={s.code} status={<ItemStatusTag status={s.status} />} onClose={onClose} footer={null}>
      <Stack gap={space[3]}>
        <DataTable<StructureLine>
          density="compact"
          pagination={false}
          rowKey="component"
          dataSource={s.value?.lines ?? []}
          empty={<EmptyState compact title="No lines" description="Edit the structure to add its lines." />}
          mobile={{
            title: (l) => nameOf(l.component),
            subtitle: (l) => describeCalc(l.calc, nameOf),
            fields: [{ label: "Component version", render: (l) => <VersionCell s={s} l={l} /> }],
          }}
          columns={[
            { title: "Line", key: "line", render: (_, l) => nameOf(l.component) },
            { title: "Component version", key: "version", render: (_, l) => <VersionCell s={s} l={l} /> },
            { title: "How much", key: "calc", render: (_, l) => describeCalc(l.calc, nameOf) },
          ]}
        />
        {s.value && <StructureExample value={s.value} nameOf={nameOf} />}
      </Stack>
    </SideDrawer>
  );
}

function VersionCell({ s, l }: { s: StructureView; l: StructureLine }) {
  const c = s.components.find((x) => x.component === l.component);
  return (
    <span style={{ display: "inline-flex", gap: space[1], alignItems: "center", flexWrap: "wrap" }}>
      <span className="ws-num">v{l.componentVersion}</span>
      {c?.status !== "CONFIRMED" && <StatusChip tone="warning">Placeholder</StatusChip>}
      {c?.newerVersion && (
        <Tooltip title={`Version ${c.newerVersion} exists. Edit the structure to use it.`}>
          <span tabIndex={0} aria-label={`Version ${c.newerVersion} exists. Edit the structure to use it.`}>
            <StatusChip tone="warning">newer exists</StatusChip>
          </span>
        </Tooltip>
      )}
    </span>
  );
}

function StructureEditor({ initial, onClose, onSaved }: { initial: { code: string | null; value: StructureValue }; onClose: () => void; onSaved: () => void }) {
  const isNew = initial.code === null;
  const [code, setCode] = useState(initial.code ?? "");
  const [name, setName] = useState(initial.value.name);
  const [description, setDescription] = useState(initial.value.description);
  const [includes, setIncludes] = useState<ComponentType[]>(initial.value.ctcIncludes);
  const [lines, setLines] = useState<StructureLine[]>(initial.value.lines);
  const [sample, setSample] = useState("1200000");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const byCode = new Map<string, ComponentView>(components.map((c) => [c.code, c]));
  const nameOf = (c: string) => byCode.get(c)?.value?.name ?? c;

  const value: StructureValue = { name, description, ctcIncludes: includes, lines };
  const check = useMutation({
    mutationFn: () => payrollApi.previewStructureSave(code, value, sample),
    onSuccess: () => setProblem(null),
    onError: (err) => setProblem(apiErrorMessage(err, "Could not check it.")),
  });
  const save = useMutation({
    mutationFn: () => payrollApi.saveStructure(code, { value, sampleAnnualCtc: sample, note, fingerprint: check.data!.fingerprint }),
    onSuccess: () => {
      toast.success("Saved as an unconfirmed version.");
      onSaved();
      onClose();
    },
    onError: (err) => setProblem(apiErrorMessage(err, "Could not save.")),
  });
  const changed = () => check.reset();
  const patch = (i: number, next: Partial<StructureLine>) => {
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...next } : l)));
    changed();
  };
  const pin = (componentCode: string): Pick<StructureLine, "component" | "componentVersion" | "componentHash"> => {
    const cur = byCode.get(componentCode)?.current;
    return { component: componentCode, componentVersion: cur?.version ?? 1, componentHash: cur?.valueHash ?? "" };
  };
  const move = (i: number, d: -1 | 1) => {
    setLines((ls) => {
      const next = [...ls];
      const j = i + d;
      if (j < 0 || j >= next.length) return ls;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
    changed();
  };
  const p: StructureSavePreview | undefined = check.data;
  const codeBad = !!code && !ITEM_CODE_PATTERN.test(code);

  return (
    <SideDrawer
      open
      size="wide"
      title={isNew ? "Add a structure" : `Edit ${initial.value.name}`}
      subtitle="Check that it adds up, then save it as an unconfirmed version"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%", flexWrap: "wrap" }}>
          <Button size="large" style={{ flex: "1 1 120px" }} onClick={onClose}>Cancel</Button>
          {p ? (
            <Button size="large" type="primary" style={{ flex: "1 1 260px" }} loading={save.isPending} disabled={p.unchanged} onClick={() => save.mutate()}>
              Save as an unconfirmed version
            </Button>
          ) : (
            <Button size="large" type="primary" style={{ flex: 1 }} loading={check.isPending} onClick={() => check.mutate()}>
              Check it adds up
            </Button>
          )}
        </div>
      }
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        <div style={{ display: "flex", gap: space[3], flexWrap: "wrap" }}>
          {isNew && (
            <Form.Item label="Code" htmlFor="structure-code" validateStatus={codeBad ? "error" : undefined} help={codeBad ? "Use capital letters, digits and underscores, starting with a letter" : undefined} style={{ width: 200 }}>
              <Input id="structure-code" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); changed(); }} placeholder="STANDARD" maxLength={25} autoComplete="off" />
            </Form.Item>
          )}
          <Form.Item label="Name" htmlFor="structure-name" style={{ flex: 1, minWidth: 220 }}>
            <Input id="structure-name" value={name} onChange={(e) => { setName(e.target.value); changed(); }} maxLength={60} />
          </Form.Item>
        </div>
        <Form.Item label="What it is for (optional)" htmlFor="structure-description">
          <Input id="structure-description" value={description} onChange={(e) => { setDescription(e.target.value); changed(); }} maxLength={200} placeholder="For example: all permanent staff, grades G1 to G3" />
        </Form.Item>
        <Form.Item label="Counts toward CTC" extra="The lines of these kinds have to add up to CTC. A line of another kind (a deduction, say) is worked out but is not part of CTC.">
          <Checkbox.Group options={COMPONENT_TYPES.map((t) => ({ value: t, label: COMPONENT_TYPE_LABEL[t] }))} value={includes} onChange={(val) => { setIncludes(val as ComponentType[]); changed(); }} />
        </Form.Item>
      </Form>

      <FormGroupTitle>Lines</FormGroupTitle>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[3] }}>
        {lines.length === 0 && <EmptyState compact title="No lines yet" description="Add the first one." />}
        {lines.map((l, i) => {
          const c = byCode.get(l.component);
          const behind = c?.current && c.current.version > l.componentVersion;
          const label = l.component ? nameOf(l.component) : `Line ${i + 1}`;
          return (
            <li key={i} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[3], background: v.bgSubtle }}>
              <div style={{ display: "flex", gap: space[3], flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    aria-label={`Component for line ${i + 1}`}
                    style={{ width: "100%" }}
                    value={l.component || undefined}
                    placeholder="Choose"
                    options={components.map((x) => ({ value: x.code, label: `${x.value?.name} (${x.code})` }))}
                    onChange={(val) => patch(i, pin(val))}
                  />
                  <div style={{ display: "flex", gap: space[1], alignItems: "center", flexWrap: "wrap", marginTop: space[1] }}>
                    <Caption>v{l.componentVersion}</Caption>
                    {c && c.status !== "CONFIRMED" && <StatusChip tone="warning">Placeholder</StatusChip>}
                    {behind && <Button size="small" type="link" onClick={() => patch(i, pin(l.component))}>use v{c.current!.version}</Button>}
                  </div>
                </div>
                <div style={{ flex: "2 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: space[2] }}>
                  <Select aria-label={`How much for ${label}`} style={{ width: "100%" }} value={l.calc.method} options={LINE_CALC_METHODS.map((m) => ({ value: m, label: LINE_CALC_LABEL[m] }))} onChange={(m) => patch(i, { calc: defaultCalc(m) })} />
                  {l.calc.method === "PERCENT" && (
                    <div style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
                      <Input aria-label={`Percent for ${label}`} style={{ width: 100 }} suffix="%" inputMode="decimal" value={l.calc.percent} onChange={(e) => patch(i, { calc: { ...(l.calc as Extract<LineCalc, { method: "PERCENT" }>), percent: e.target.value } })} />
                      <span>of</span>
                      <Select aria-label={`Percent of what, for ${label}`} style={{ flex: 1, minWidth: 140 }} value={l.calc.of} options={[{ value: "CTC", label: "CTC" }, ...lines.slice(0, i).filter((x) => x.component).map((x) => ({ value: x.component, label: nameOf(x.component) }))]} onChange={(of) => patch(i, { calc: { ...(l.calc as Extract<LineCalc, { method: "PERCENT" }>), of } })} />
                    </div>
                  )}
                  {l.calc.method === "FIXED_AMOUNT" && <Input aria-label={`Amount for ${label}`} style={{ maxWidth: 220 }} prefix="₹" inputMode="decimal" value={l.calc.amount} onChange={(e) => patch(i, { calc: { method: "FIXED_AMOUNT", amount: e.target.value } })} suffix="a month" />}
                  {l.calc.method === "SLAB" && (
                    <SlabEditor
                      label={label}
                      calc={l.calc}
                      bases={[{ value: "CTC", label: "CTC" }, ...lines.slice(0, i).filter((x) => x.component).map((x) => ({ value: x.component, label: nameOf(x.component) }))]}
                      onChange={(calc) => patch(i, { calc })}
                    />
                  )}
                  {l.calc.method === "FORMULA" && <Input aria-label={`Formula for ${label}`} value={l.calc.formula} placeholder="MIN(BASIC * 0.5, 15000)" spellCheck={false} onChange={(e) => patch(i, { calc: { method: "FORMULA", formula: e.target.value } })} />}
                </div>
                <div style={{ display: "flex", gap: space[1], flex: "none" }}>
                  <Tooltip title="Move up"><Button icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" /></Tooltip>
                  <Tooltip title="Move down"><Button icon={<ArrowDownOutlined />} disabled={i === lines.length - 1} onClick={() => move(i, 1)} aria-label="Move down" /></Tooltip>
                  <Tooltip title="Remove line"><Button danger icon={<DeleteOutlined />} onClick={() => { setLines((ls) => ls.filter((_, k) => k !== i)); changed(); }} aria-label="Remove line" /></Tooltip>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <Stack gap={space[3]} style={{ marginTop: space[3] }}>
        <div>
          <Button icon={<PlusOutlined />} onClick={() => { setLines((ls) => [...ls, { component: "", componentVersion: 1, componentHash: "", calc: { method: "PERCENT", of: "CTC", percent: "" } }]); changed(); }}>
            Add a line
          </Button>
        </div>
        <Caption>
          A line can be a percentage of CTC or of a line above it, the same amount for everyone, an amount typed for each person, a formula (CTC and the lines above it, with + - * / ( ), MIN, MAX, ROUND, CEIL, FLOOR), or the balance: whatever is left, so the lines always add up.
        </Caption>

        <Form layout="vertical" component="div">
          <Form.Item label="Check it against a yearly CTC of" htmlFor="structure-sample" style={{ marginBottom: 0 }}>
            <Input id="structure-sample" prefix="₹" inputMode="decimal" value={sample} onChange={(e) => { setSample(e.target.value); changed(); }} style={{ maxWidth: 220 }} />
          </Form.Item>
        </Form>

        {problem && <ApprovalBanner tone="danger" title="It cannot be saved yet" description={problem} />}
        {p && (
          <Stack gap={space[3]}>
            {p.unchanged && <ApprovalBanner tone="warning" title="That is the value it already has. There is nothing to save." />}
            {p.willResetConfirmation && <ApprovalBanner tone="warning" title="This structure is Confirmed now." description="Saving adds a new version that is a Placeholder until a director confirms it. The Confirmed version stays on record." />}
            {p.calculationOrder.length > 0 && (
              <Caption>
                Worked out in this order: {p.calculationOrder.map((st) => `${st.step}. ${st.component}${st.dependsOn.length ? ` (reads ${st.dependsOn.join(", ")})` : ""}`).join("; ")}
              </Caption>
            )}
            {p.unconfirmedComponents.length > 0 && <ApprovalBanner tone="warning" title="Some components are not confirmed yet" description={`${p.unconfirmedComponents.join(", ")}. A salary built on this structure is a test until they are confirmed too.`} />}
            <SampleTable sample={p.sample} nameOf={nameOf} />
            <ApprovalBanner tone="info" title={p.impact} />
            <Form layout="vertical" component="div">
              <Form.Item label="Why this, and where it came from" htmlFor="structure-note" extra="Optional, but the person who confirms it will want it." style={{ marginBottom: 0 }}>
                <Input.TextArea id="structure-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="For example: as agreed with the owners, in the offer letters" />
              </Form.Item>
            </Form>
          </Stack>
        )}
      </Stack>
    </SideDrawer>
  );
}

/**
 * The split of a sample CTC, with the monthly figure and the yearly total of every line side by side, so nobody is surprised: the lines are rounded each month and the
 * balance line absorbs the difference, so twelve months can differ from the yearly CTC by a few paise. The difference, when there is one, is named under the table.
 */
function SampleTable({ sample, nameOf }: { sample: SampleResult; nameOf: (code: string) => string }) {
  const phone = useIsPhone();
  const annualOf = new Map(sample.annual.lines.map((l) => [l.component, l.annual]));
  const different = !/^-?0(\.0+)?$/.test(sample.annual.difference);
  const differenceText = `Twelve months of ${formatRupees(sample.breakup.monthlyCtc, 2)} come to ${formatRupees(sample.annual.total, 2)}, which is ${formatRupees(sample.annual.difference.replace("-", ""), 2)} ${sample.annual.difference.startsWith("-") ? "less" : "more"} than the yearly CTC of ${formatRupees(sample.annual.annualCtc, 2)}. A month is rounded by the rule “Rounding of salary lines”, and the balance line absorbs the difference so each month adds up exactly.`;
  return (
    <div>
      <div style={{ fontWeight: fw.semibold, color: v.textPrimary, marginBottom: space[2] }}>
        At <span className="ws-num">{formatRupees(sample.annualCtc)}</span> a year (<span className="ws-num">{formatRupees(sample.breakup.monthlyCtc)}</span> a month); amounts typed per person count as ₹0 here
      </div>
      <DataTable
        density="compact"
        pagination={false}
        rowKey="component"
        dataSource={sample.breakup.lines}
        mobile={{
          title: (l) => nameOf(l.component),
          subtitle: (l) => COMPONENT_TYPE_LABEL[l.type],
          fields: [
            { label: "A month", render: (l) => <Num>{formatRupees(l.amount, 2)}</Num> },
            { label: "Over a year", render: (l) => <Num>{formatRupees(annualOf.get(l.component) ?? "0", 2)}</Num> },
          ],
        }}
        columns={[
          { title: "Line", key: "line", render: (_, l) => nameOf(l.component) },
          { title: "Kind", key: "kind", render: (_, l) => COMPONENT_TYPE_LABEL[l.type] },
          { title: "A month", key: "month", align: "right", render: (_, l) => <Num>{formatRupees(l.amount, 2)}</Num> },
          { title: "Over a year", key: "year", align: "right", render: (_, l) => <Num>{formatRupees(annualOf.get(l.component) ?? "0", 2)}</Num> },
        ]}
        summary={() => (
          <Table.Summary>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}>
                <strong>Counts toward CTC</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Num strong>{formatRupees(sample.breakup.monthlyCtc, 2)}</Num>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <Num strong>{formatRupees(sample.annual.total, 2)}</Num>
              </Table.Summary.Cell>
            </Table.Summary.Row>
            {different && (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}>
                  <Caption>{differenceText}</Caption>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          </Table.Summary>
        )}
      />
      {phone && (
        <div style={{ marginTop: space[3] }}>
          <FigureRow>
            <Figure label="Counts toward CTC, a month" value={formatRupees(sample.breakup.monthlyCtc, 2)} />
            <Figure label="Over a year" value={formatRupees(sample.annual.total, 2)} />
          </FigureRow>
          {different && <Caption>{differenceText}</Caption>}
        </div>
      )}
    </div>
  );
}

/** A worked example for any yearly CTC the reader types: the monthly figure of each line beside its yearly total, from the structure as it is saved. */
function StructureExample({ value, nameOf }: { value: StructureValue; nameOf: (code: string) => string }) {
  const [ctc, setCtc] = useState("1200000");
  const valid = /^\d+(\.\d{1,2})?$/.test(ctc.trim()) && !/^0+(\.0+)?$/.test(ctc.trim()); // text only: an amount is never turned into a JavaScript number
  const example = useQuery({ queryKey: ["payroll", "structure-example", JSON.stringify(value), ctc.trim()], enabled: valid, queryFn: () => payrollApi.previewBreakup(value, ctc.trim()), retry: false, placeholderData: keepPreviousData });
  return (
    <Stack gap={space[3]}>
      <Form layout="vertical" component="div">
        <Form.Item label="Worked example for a yearly CTC of" htmlFor="structure-example-ctc" validateStatus={ctc.trim() && !valid ? "error" : undefined} help={ctc.trim() && !valid ? "Type an amount in rupees, for example 1200000" : undefined} style={{ marginBottom: 0 }}>
          <Input id="structure-example-ctc" prefix="₹" inputMode="decimal" value={ctc} onChange={(e) => setCtc(e.target.value)} style={{ maxWidth: 220 }} />
        </Form.Item>
      </Form>
      {example.isLoading && <SkeletonTable rows={4} columns={4} />}
      {example.error && <ApprovalBanner tone="warning" title={apiErrorMessage(example.error, "That does not work out for this CTC.")} />}
      {example.data && <SampleTable sample={example.data} nameOf={nameOf} />}
    </Stack>
  );
}
