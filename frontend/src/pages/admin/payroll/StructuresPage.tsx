import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Drawer, Flex, Input, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, HistoryOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { COMPONENT_TYPES, COMPONENT_TYPE_LABEL, ITEM_CODE_PATTERN, LINE_CALC_LABEL, LINE_CALC_METHODS, type LineCalcMethod } from "@shared/constants/payrollSalary";
import * as payrollApi from "../../../api/payroll";
import type { ComponentType, ComponentView, LineCalc, StructureLine, StructureSavePreview, StructureValue, StructureView } from "../../../api/payroll";
import { ItemConfirmModal, ItemHistoryDrawer } from "../../../components/payroll/ItemDialogs";
import { ItemStatusTag } from "../../../components/payroll/ItemStatusTag";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { describeCalc } from "./salaryText";

const { Title, Text } = Typography;

// Payroll → Salary structures (Phase 6 P6-2). A structure says how much each line of a salary gets out of CTC. Saving one proves, for a sample CTC, that its
// lines add up to CTC exactly; a structure that cannot produce a salary cannot be saved. Nobody's pay changes when a structure is saved: people move to a
// new version only through a salary revision, which a second person approves.

const defaultCalc = (m: LineCalcMethod): LineCalc =>
  m === "PERCENT" ? { method: "PERCENT", of: "CTC", percent: "" } : m === "FIXED_AMOUNT" ? { method: "FIXED_AMOUNT", amount: "" } : m === "FORMULA" ? { method: "FORMULA", formula: "" } : m === "PER_PERSON" ? { method: "PER_PERSON" } : { method: "BALANCE" };

export function StructuresPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const canConfirm = hasPermission("payroll.rules.confirm");
  const [editing, setEditing] = useState<{ code: string | null; value: StructureValue } | null>(null);
  const [confirming, setConfirming] = useState<StructureView | null>(null);
  const [history, setHistory] = useState<StructureView | null>(null);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["payroll", "structures"], queryFn: payrollApi.listStructures });
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const componentName = (code: string) => components.find((c) => c.code === code)?.value?.name ?? code;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Title level={3} style={{ margin: 0 }}>
          Salary structures
        </Title>
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ code: null, value: { name: "", description: "", ctcIncludes: ["EARNING"], lines: [] } })}>
            Add a structure
          </Button>
        )}
      </Flex>
      <Text type="secondary">
        A structure splits a person&apos;s CTC across the components: for example Basic is 40% of CTC, HRA is half of Basic, and Special allowance is whatever is left. Saving a structure never changes anybody&apos;s salary; people move to it through a salary revision.
      </Text>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the structures.")} />}
      <Table<StructureView>
        rowKey="code"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        expandable={{
          expandedRowRender: (s) => {
            const nameOf = componentName;
            return (
              <Table
                size="small"
                pagination={false}
                rowKey="component"
                dataSource={s.value?.lines ?? []}
                columns={[
                  { title: "Line", render: (_, l: StructureLine) => nameOf(l.component) },
                  { title: "Component version", render: (_, l: StructureLine) => {
                      const c = s.components.find((x) => x.component === l.component);
                      return (
                        <Space size={4}>
                          <Text>v{l.componentVersion}</Text>
                          {c?.status !== "CONFIRMED" && <Tag color="orange">Placeholder</Tag>}
                          {c?.newerVersion && <Tooltip title={`Version ${c.newerVersion} exists. Edit the structure to use it.`}><Tag color="gold">newer exists</Tag></Tooltip>}
                        </Space>
                      );
                    } },
                  { title: "How much", render: (_, l: StructureLine) => describeCalc(l.calc, nameOf) },
                ]}
              />
            );
          },
        }}
        columns={[
          {
            title: "Structure",
            render: (_, s) => (
              <div>
                <Text strong>{s.value?.name}</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {s.code}
                  </Text>
                </div>
              </div>
            ),
          },
          { title: "Counts toward CTC", render: (_, s) => <Space size={4} wrap>{s.value?.ctcIncludes.map((t) => <Tag key={t}>{COMPONENT_TYPE_LABEL[t]}</Tag>)}</Space> },
          { title: "Lines", render: (_, s) => s.value?.lines.length },
          { title: "Status", render: (_, s) => <ItemStatusTag status={s.status} sourceLabel={s.sourceLabel} /> },
          {
            title: "Components",
            render: (_, s) => {
              const unconfirmed = s.components.filter((c) => c.status !== "CONFIRMED").length;
              const newer = s.components.filter((c) => c.newerVersion).length;
              return unconfirmed + newer === 0 ? <Text type="secondary">All Confirmed</Text> : <Space size={4} wrap>{unconfirmed > 0 && <Tag color="orange">{unconfirmed} not confirmed</Tag>}{newer > 0 && <Tag color="gold">{newer} newer version{newer > 1 ? "s" : ""}</Tag>}</Space>;
            },
          },
          {
            title: "",
            align: "right",
            render: (_, s) => (
              <Space wrap>
                {canEdit && <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ code: s.code, value: s.value! })}>Edit</Button>}
                {canConfirm && s.status === "PLACEHOLDER" && <Button size="small" type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setConfirming(s)}>Confirm…</Button>}
                <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistory(s)}>History</Button>
              </Space>
            ),
          },
        ]}
      />
      {editing && <StructureEditor initial={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {confirming && (
        <ItemConfirmModal
          title={`Confirm: ${confirming.value?.name}`}
          queryKey={["payroll", "structure-confirm", confirming.code]}
          loadPreview={() => payrollApi.previewStructureConfirm(confirming.code)}
          confirm={(b) => payrollApi.confirmStructure(confirming.code, b)}
          renderValue={(p) => `${p.value.name}: ${p.value.lines.length} lines`}
          extra={(p) => (p.unconfirmedComponents.length ? <Alert type="warning" showIcon title="Some components are not confirmed yet" description={`${p.unconfirmedComponents.join(", ")}. A salary built on this structure is a test until they are confirmed too.`} /> : null)}
          onClose={() => setConfirming(null)}
          onDone={refresh}
        />
      )}
      {history && <ItemHistoryDrawer title={`History: ${history.value?.name}`} queryKey={["payroll", "structure-history", history.code]} load={async () => (await payrollApi.getStructure(history.code)).history} renderValue={(v) => `${(v as StructureValue).name}: ${(v as StructureValue).lines.length} lines`} onClose={() => setHistory(null)} />}
    </Flex>
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
      void message.success("Saved as an unconfirmed version.");
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

  return (
    <Drawer open width={920} title={isNew ? "Add a structure" : `Edit ${initial.value.name}`} onClose={onClose} destroyOnHidden>
      <Space orientation="vertical" size={14} style={{ width: "100%" }}>
        <Flex gap={12} wrap>
          {isNew && (
            <div>
              <Text type="secondary">Code</Text>
              <Input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); changed(); }} placeholder="STANDARD" maxLength={25} status={code && !ITEM_CODE_PATTERN.test(code) ? "error" : undefined} style={{ width: 200 }} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <Text type="secondary">Name</Text>
            <Input value={name} onChange={(e) => { setName(e.target.value); changed(); }} maxLength={60} />
          </div>
        </Flex>
        <div>
          <Text type="secondary">What it is for (optional)</Text>
          <Input value={description} onChange={(e) => { setDescription(e.target.value); changed(); }} maxLength={200} placeholder="For example: all permanent staff, grades G1 to G3" />
        </div>
        <div>
          <Text type="secondary">Counts toward CTC</Text>
          <div>
            <Checkbox.Group options={COMPONENT_TYPES.map((t) => ({ value: t, label: COMPONENT_TYPE_LABEL[t] }))} value={includes} onChange={(v) => { setIncludes(v as ComponentType[]); changed(); }} />
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>The lines of these kinds have to add up to CTC. A line of another kind (a deduction, say) is worked out but is not part of CTC.</Text>
        </div>

        <Table
          size="small"
          pagination={false}
          rowKey={(_, i) => String(i)}
          dataSource={lines}
          locale={{ emptyText: "No lines yet. Add the first one." }}
          columns={[
            {
              title: "Component",
              width: 230,
              render: (_, l, i) => {
                const c = byCode.get(l.component);
                const behind = c?.current && c.current.version > l.componentVersion;
                return (
                  <Space orientation="vertical" size={2}>
                    <Select
                      showSearch
                      style={{ width: 210 }}
                      value={l.component || undefined}
                      placeholder="Choose"
                      options={components.map((x) => ({ value: x.code, label: `${x.value?.name} (${x.code})` }))}
                      onChange={(v) => patch(i, pin(v))}
                    />
                    <Space size={4}>
                      <Text type="secondary" style={{ fontSize: 12 }}>v{l.componentVersion}</Text>
                      {c && c.status !== "CONFIRMED" && <Tag color="orange" style={{ marginInlineEnd: 0 }}>Placeholder</Tag>}
                      {behind && <Button size="small" type="link" onClick={() => patch(i, pin(l.component))}>use v{c.current!.version}</Button>}
                    </Space>
                  </Space>
                );
              },
            },
            {
              title: "How much",
              render: (_, l, i) => (
                <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                  <Select style={{ width: 260 }} value={l.calc.method} options={LINE_CALC_METHODS.map((m) => ({ value: m, label: LINE_CALC_LABEL[m] }))} onChange={(m) => patch(i, { calc: defaultCalc(m) })} />
                  {l.calc.method === "PERCENT" && (
                    <Space>
                      <Input style={{ width: 90 }} suffix="%" value={l.calc.percent} onChange={(e) => patch(i, { calc: { ...(l.calc as Extract<LineCalc, { method: "PERCENT" }>), percent: e.target.value } })} />
                      <Text>of</Text>
                      <Select style={{ width: 180 }} value={l.calc.of} options={[{ value: "CTC", label: "CTC" }, ...lines.slice(0, i).filter((x) => x.component).map((x) => ({ value: x.component, label: nameOf(x.component) }))]} onChange={(of) => patch(i, { calc: { ...(l.calc as Extract<LineCalc, { method: "PERCENT" }>), of } })} />
                    </Space>
                  )}
                  {l.calc.method === "FIXED_AMOUNT" && <Input style={{ width: 160 }} prefix="₹" value={l.calc.amount} onChange={(e) => patch(i, { calc: { method: "FIXED_AMOUNT", amount: e.target.value } })} suffix="a month" />}
                  {l.calc.method === "FORMULA" && <Input value={l.calc.formula} placeholder="MIN(BASIC * 0.5, 15000)" onChange={(e) => patch(i, { calc: { method: "FORMULA", formula: e.target.value } })} />}
                </Space>
              ),
            },
            {
              title: "",
              width: 120,
              render: (_, __, i) => (
                <Space>
                  <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
                  <Button size="small" icon={<ArrowDownOutlined />} disabled={i === lines.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setLines((ls) => ls.filter((_, k) => k !== i)); changed(); }} aria-label="Remove line" />
                </Space>
              ),
            },
          ]}
        />
        <Button icon={<PlusOutlined />} onClick={() => { setLines((ls) => [...ls, { component: "", componentVersion: 1, componentHash: "", calc: { method: "PERCENT", of: "CTC", percent: "" } }]); changed(); }}>
          Add a line
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          A line can be a percentage of CTC or of a line above it, the same amount for everyone, an amount typed for each person, a formula (CTC and the lines above it, with + - * / ( ), MIN, MAX, ROUND, CEIL, FLOOR), or the balance: whatever is left, so the lines always add up.
        </Text>

        <Flex gap={12} align="end" wrap>
          <div>
            <Text type="secondary">Check it against a yearly CTC of</Text>
            <Input prefix="₹" value={sample} onChange={(e) => { setSample(e.target.value); changed(); }} style={{ width: 200 }} />
          </div>
          <Button type="primary" loading={check.isPending} onClick={() => check.mutate()}>
            Check it adds up
          </Button>
        </Flex>

        {problem && <Alert type="error" showIcon title="It cannot be saved yet" description={problem} />}
        {p && (
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            {p.unchanged && <Alert type="warning" showIcon title="That is the value it already has. There is nothing to save." />}
            {p.willResetConfirmation && <Alert type="warning" showIcon title="This structure is Confirmed now." description="Saving adds a new version that is a Placeholder until a different person confirms it. The Confirmed version stays on record." />}
            {p.unconfirmedComponents.length > 0 && <Alert type="warning" showIcon title="Some components are not confirmed yet" description={`${p.unconfirmedComponents.join(", ")}. A salary built on this structure is a test until they are confirmed too.`} />}
            <Table
              size="small"
              pagination={false}
              rowKey="component"
              title={() => <Text strong>At {formatRupees(p.sample.annualCtc)} a year ({formatRupees(p.sample.breakup.monthlyCtc)} a month); amounts typed per person count as ₹0 here</Text>}
              dataSource={p.sample.breakup.lines}
              columns={[
                { title: "Line", render: (_, l) => nameOf(l.component) },
                { title: "Kind", render: (_, l) => COMPONENT_TYPE_LABEL[l.type] },
                { title: "A month", align: "right", render: (_, l) => formatRupees(l.amount) },
              ]}
            />
            <Alert type="info" showIcon title={p.impact} />
            <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Why this, and where it came from (optional, but the person who confirms it will want it)" />
            <Button type="primary" loading={save.isPending} disabled={p.unchanged} onClick={() => save.mutate()}>
              Save as an unconfirmed version
            </Button>
          </Space>
        )}
      </Space>
    </Drawer>
  );
}
