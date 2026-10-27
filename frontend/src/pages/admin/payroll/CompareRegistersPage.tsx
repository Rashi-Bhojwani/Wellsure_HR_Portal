import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Form, Input, Select, Tooltip, Upload } from "antd";
import { DeleteOutlined, DownloadOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { CompareForm, CompareResult, RegisterSource } from "../../../api/payroll";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, CardGrid, DataTable, EmptyState, FormGroupTitle, PageHeader, Panel, Stack, StatCard, StatusChip, toast } from "../../../ui";
import { Caption, Num } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Payroll → Compare Registers (P6-6). Two registers go in (ours and greytHR's, while they run side by side), people are matched by employee code, and every difference is shown by person
// and by component, with those beyond the tolerance flagged. The files are read and dropped: nothing is stored.

const SOURCE_OPTIONS: Array<{ value: RegisterSource; label: string }> = [
  { value: "OWN", label: "Wellsure register (the workbook this system makes)" },
  { value: "GENERIC", label: "A plain table (a header row, an Employee code column, amounts)" },
  { value: "GREYTHR", label: "greytHR's own register layout (waiting for a real sample)" },
];

type FormValues = { labelA: string; labelB: string; sourceA: RegisterSource; sourceB: RegisterSource; toleranceAmount: string; tolerancePercent: string; aliases?: Array<{ from: string; to: string }> };

export function CompareRegistersPage() {
  const [form] = Form.useForm<FormValues>();
  const [files, setFiles] = useState<{ a?: File; b?: File }>({});
  const [last, setLast] = useState<CompareForm | null>(null);
  const run = useMutation({
    mutationFn: (f: CompareForm) => payrollApi.compareRegisters(f),
    onSuccess: (_r, f) => setLast(f),
  });
  const download = useMutation({
    mutationFn: (f: CompareForm) => payrollApi.downloadComparison(f),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "register-comparison.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not make the workbook.")),
  });

  const submit = (val: FormValues) => {
    if (!files.a || !files.b) {
      toast.warning("Choose both registers first.");
      return;
    }
    run.mutate({ a: files.a, b: files.b, labelA: val.labelA, labelB: val.labelB, sourceA: val.sourceA, sourceB: val.sourceB, toleranceAmount: val.toleranceAmount, tolerancePercent: val.tolerancePercent, aliases: Object.fromEntries((val.aliases ?? []).filter((x) => x.from && x.to).map((x) => [x.from, x.to])) });
  };
  const pick = (which: "a" | "b") => ({ accept: ".xlsx", maxCount: 1, beforeUpload: (file: File) => { setFiles((f) => ({ ...f, [which]: file })); return false; }, onRemove: () => setFiles((f) => ({ ...f, [which]: undefined })) });
  const r = run.data;

  const side = (which: "a" | "b") => (
    <div style={{ flex: "1 1 280px", minWidth: 0 }}>
      <FormGroupTitle>{which === "a" ? "First register" : "Second register"}</FormGroupTitle>
      <Form.Item name={which === "a" ? "labelA" : "labelB"} label={which === "a" ? "First register is called" : "Second register is called"}>
        <Input maxLength={40} />
      </Form.Item>
      <Form.Item name={which === "a" ? "sourceA" : "sourceB"} label="It is">
        <Select options={SOURCE_OPTIONS} />
      </Form.Item>
      <Upload {...pick(which)}>
        <Button icon={<UploadOutlined />}>{which === "a" ? "Choose the first file (.xlsx)" : "Choose the second file (.xlsx)"}</Button>
      </Upload>
    </div>
  );

  return (
    <>
      <PageHeader title="Compare Registers" subtitle="Ours and greytHR's, side by side, while both run" />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="The files are read and dropped: nothing is stored"
          description="Put two payroll registers side by side, ours and greytHR’s. People are matched by employee code. Every figure that differs is shown by person and by component, and what is beyond your tolerance is flagged."
        />
        <Panel title="The two registers">
          <Form form={form} layout="vertical" onFinish={submit} initialValues={{ labelA: "Wellsure", labelB: "greytHR", sourceA: "OWN", sourceB: "GENERIC", toleranceAmount: "1", tolerancePercent: "0", aliases: [] }}>
            <div style={{ display: "flex", gap: space[6], flexWrap: "wrap" }}>
              {side("a")}
              {side("b")}
            </div>
            <FormGroupTitle>Tolerance</FormGroupTitle>
            <div style={{ display: "flex", gap: space[4], flexWrap: "wrap" }}>
              <Form.Item name="toleranceAmount" label="Ignore a difference of up to (rupees)" extra="Differences up to this many rupees are not flagged." style={{ flex: "1 1 240px" }}>
                <Input inputMode="decimal" prefix="₹" style={{ maxWidth: 180 }} />
              </Form.Item>
              <Form.Item name="tolerancePercent" label="or up to (percent of the first register's figure)" extra="A difference within either is not flagged." style={{ flex: "1 1 240px" }}>
                <Input inputMode="decimal" suffix="%" style={{ maxWidth: 180 }} />
              </Form.Item>
            </div>
            <Form.List name="aliases">
              {(fields, { add, remove }) => (
                <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
                  <FormGroupTitle>Columns with different names</FormGroupTitle>
                  <Caption>If the second file calls a column something else (for example “Basic Salary” where the first says “Basic”), say which is which.</Caption>
                  {fields.map((f, i) => (
                    <div key={f.key} style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
                      <Form.Item name={[f.name, "from"]} style={{ marginBottom: 0, flex: "1 1 180px" }}>
                        <Input aria-label={`Match ${i + 1}: name in the second file`} placeholder="Name in the second file" />
                      </Form.Item>
                      <span>means</span>
                      <Form.Item name={[f.name, "to"]} style={{ marginBottom: 0, flex: "1 1 180px" }}>
                        <Input aria-label={`Match ${i + 1}: name in the first file`} placeholder="Name in the first file" />
                      </Form.Item>
                      <Tooltip title="Remove this match">
                        <Button icon={<DeleteOutlined />} aria-label="Remove" onClick={() => remove(f.name)} />
                      </Tooltip>
                    </div>
                  ))}
                  <div>
                    <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ from: "", to: "" })}>Add a match</Button>
                  </div>
                </div>
              )}
            </Form.List>
            <div style={{ marginTop: space[6] }}>
              <Button type="primary" htmlType="submit" loading={run.isPending}>Compare</Button>
            </div>
          </Form>
        </Panel>
        {run.error && <ApprovalBanner tone="danger" title={apiErrorMessage(run.error, "Could not compare these.")} />}
        {r && <Result r={r} onDownload={() => last && download.mutate(last)} downloading={download.isPending} />}
      </Stack>
    </>
  );
}

const flagChip = (flagged: boolean) => (flagged ? <StatusChip tone="danger">Beyond tolerance</StatusChip> : <StatusChip tone="neutral">Within tolerance</StatusChip>);

function Result({ r, onDownload, downloading }: { r: CompareResult; onDownload: () => void; downloading: boolean }) {
  const s = r.summary;
  const money = (val: string | null) => (val === null ? "not there" : formatRupees(val, 2));
  const person = (p: { code: string; name: string | null }) => p.name ?? "";
  const onlyTable = (rows: Array<{ code: string; name: string | null }>) => (
    <DataTable density="compact" rowKey="code" pagination={false} dataSource={rows} columns={[{ title: "Code", dataIndex: "code" }, { title: "Name", key: "name", render: (_, p) => person(p) }]} mobile={{ title: (p) => p.name ?? p.code, subtitle: (p) => p.code }} />
  );
  return (
    <div data-testid="compare-result">
    <Stack>
      <Panel
        title="What was found"
        subtitle={`Tolerance: ${formatRupees(r.options.toleranceAmount, 2)} or ${r.options.tolerancePercent}% of ${r.a.label}’s figure; a difference within either is not flagged.`}
        extra={<Button icon={<DownloadOutlined />} loading={downloading} onClick={onDownload}>Download as Excel</Button>}
      >
        <CardGrid min={150}>
          <StatCard variant="compact" label={`In ${r.a.label}`} value={r.a.people} />
          <StatCard variant="compact" label={`In ${r.b.label}`} value={r.b.people} />
          <StatCard variant="compact" label="In both" value={s.matchedPeople} />
          <StatCard variant="compact" label="Identical" value={s.identical} />
          <StatCard variant="compact" label="Differ" value={s.differing} />
          <StatCard variant="compact" label="Beyond tolerance" value={s.flagged} hint={s.flagged ? <StatusChip tone="danger">Check these</StatusChip> : undefined} />
          <StatCard variant="compact" label={`Only in ${r.a.label}`} value={s.onlyInA} />
          <StatCard variant="compact" label={`Only in ${r.b.label}`} value={s.onlyInB} />
        </CardGrid>
      </Panel>
      {(r.columns.onlyInA.length > 0 || r.columns.onlyInB.length > 0 || r.a.ignoredColumns.length > 0 || r.b.ignoredColumns.length > 0) && (
        <ApprovalBanner
          tone="warning"
          title="Some columns could not be lined up"
          description={
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {r.columns.onlyInA.length > 0 && <span>Only in {r.a.label}: {r.columns.onlyInA.join(", ")}</span>}
              {r.columns.onlyInB.length > 0 && <span>Only in {r.b.label}: {r.columns.onlyInB.join(", ")}</span>}
              {r.a.ignoredColumns.length > 0 && <Caption>Not amounts, left out of {r.a.label}: {r.a.ignoredColumns.join(", ")}</Caption>}
              {r.b.ignoredColumns.length > 0 && <Caption>Not amounts, left out of {r.b.label}: {r.b.ignoredColumns.join(", ")}</Caption>}
              <Caption>If two of them are the same thing under different names, add a match above and compare again.</Caption>
            </div>
          }
        />
      )}
      <Panel title={`Differences by person (${r.people.length})`}>
        <DataTable
          density="compact"
          rowKey="code"
          pagination={r.people.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
          dataSource={r.people}
          empty={<EmptyState compact illustration="success" title="No differences" description="Every person in both registers has the same figures." />}
          expandable={{
            defaultExpandAllRows: r.people.length <= 5,
            expandedRowRender: (p) => (
              <DataTable
                density="compact"
                rowKey="label"
                pagination={false}
                dataSource={p.differences}
                columns={[
                  { title: "Component", dataIndex: "label" },
                  { title: r.a.label, key: "a", align: "right", render: (_, d) => <Num>{money(d.a)}</Num> },
                  { title: r.b.label, key: "b", align: "right", render: (_, d) => <Num>{money(d.b)}</Num> },
                  { title: "Difference", key: "diff", align: "right", render: (_, d) => <Num tone={d.flagged ? "danger" : undefined}>{formatRupees(d.difference, 2)}</Num> },
                  { title: "%", key: "pct", align: "right", render: (_, d) => <Num>{d.percent === null ? "" : `${d.percent}%`}</Num> },
                  { title: "", key: "flag", render: (_, d) => flagChip(d.flagged) },
                ]}
              />
            ),
          }}
          mobile={{
            title: (p) => p.name ?? p.code,
            subtitle: (p) => p.code,
            status: (p) => flagChip(p.flagged),
            fields: [
              { label: "Components that differ", render: (p) => p.differences.length },
              {
                label: `${r.a.label} → ${r.b.label}`,
                render: (p) => (
                  <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
                    {p.differences.map((d) => (
                      <span key={d.label}>
                        {d.label}: <Num>{money(d.a)}</Num> → <Num>{money(d.b)}</Num> (<Num tone={d.flagged ? "danger" : undefined}>{formatRupees(d.difference, 2)}</Num>)
                      </span>
                    ))}
                  </div>
                ),
              },
            ],
          }}
          columns={[
            { title: "Code", dataIndex: "code" },
            { title: "Name", key: "name", render: (_, p) => person(p) },
            { title: "Components that differ", key: "count", align: "right", render: (_, p) => <Num>{p.differences.length}</Num> },
            { title: "", key: "flag", render: (_, p) => flagChip(p.flagged) },
          ]}
        />
      </Panel>
      {(r.onlyInA.length > 0 || r.onlyInB.length > 0) && (
        <CardGrid min={260}>
          {r.onlyInA.length > 0 && <Panel title={`Only in ${r.a.label} (${r.onlyInA.length})`}>{onlyTable(r.onlyInA)}</Panel>}
          {r.onlyInB.length > 0 && <Panel title={`Only in ${r.b.label} (${r.onlyInB.length})`}>{onlyTable(r.onlyInB)}</Panel>}
        </CardGrid>
      )}
      <Panel title="Totals over the people in both">
        <DataTable
          density="compact"
          rowKey="label"
          pagination={false}
          dataSource={r.totals}
          mobile={{
            title: (t) => t.label,
            fields: [
              { label: r.a.label, render: (t) => <Num>{formatRupees(t.a, 2)}</Num> },
              { label: r.b.label, render: (t) => <Num>{formatRupees(t.b, 2)}</Num> },
              { label: "Difference", render: (t) => <Num>{formatRupees(t.difference, 2)}</Num> },
            ],
          }}
          columns={[
            { title: "Component", dataIndex: "label" },
            { title: r.a.label, key: "a", align: "right", render: (_, t) => <Num>{formatRupees(t.a, 2)}</Num> },
            { title: r.b.label, key: "b", align: "right", render: (_, t) => <Num>{formatRupees(t.b, 2)}</Num> },
            { title: "Difference", key: "diff", align: "right", render: (_, t) => <Num>{formatRupees(t.difference, 2)}</Num> },
          ]}
        />
      </Panel>
    </Stack>
    </div>
  );
}
