import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Flex, Form, Input, Select, Space, Statistic, Table, Tag, Typography, Upload, message } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { CompareForm, CompareResult, RegisterSource } from "../../../api/payroll";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";

const { Title, Text, Paragraph } = Typography;

// Payroll → Compare Registers (P6-6). Two registers go in (ours and greytHR's, while they run side by side), people are matched by employee code, and every difference is shown by person
// and by component, with those beyond the tolerance flagged. The files are read and dropped: nothing is stored.

const SOURCE_OPTIONS: Array<{ value: RegisterSource; label: string }> = [
  { value: "OWN", label: "Wellsure register (the workbook this system makes)" },
  { value: "GENERIC", label: "A plain table (a header row, an Employee code column, amounts)" },
  { value: "GREYTHR", label: "greytHR's own register layout (waiting for a real sample)" },
];

export function CompareRegistersPage() {
  const [form] = Form.useForm();
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
    onError: (e) => void message.error(apiErrorMessage(e, "Could not make the workbook.")),
  });

  const submit = (v: { labelA: string; labelB: string; sourceA: RegisterSource; sourceB: RegisterSource; toleranceAmount: string; tolerancePercent: string; aliases?: Array<{ from: string; to: string }> }) => {
    if (!files.a || !files.b) {
      void message.warning("Choose both registers first.");
      return;
    }
    run.mutate({ a: files.a, b: files.b, labelA: v.labelA, labelB: v.labelB, sourceA: v.sourceA, sourceB: v.sourceB, toleranceAmount: v.toleranceAmount, tolerancePercent: v.tolerancePercent, aliases: Object.fromEntries((v.aliases ?? []).filter((x) => x.from && x.to).map((x) => [x.from, x.to])) });
  };
  const pick = (which: "a" | "b") => ({ accept: ".xlsx", maxCount: 1, beforeUpload: (file: File) => { setFiles((f) => ({ ...f, [which]: file })); return false; }, onRemove: () => setFiles((f) => ({ ...f, [which]: undefined })) });
  const r = run.data;

  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Compare Registers
      </Title>
      <Text type="secondary">Put two payroll registers side by side, ours and greytHR&rsquo;s. People are matched by employee code. Every figure that differs is shown by person and by component, and what is beyond your tolerance is flagged. The files are read and dropped: nothing is stored.</Text>
      <Card size="small" title="The two registers">
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ labelA: "Wellsure", labelB: "greytHR", sourceA: "OWN", sourceB: "GENERIC", toleranceAmount: "1", tolerancePercent: "0", aliases: [] }}>
          <Flex gap={24} wrap>
            <Flex vertical gap={8} style={{ minWidth: 280, flex: 1 }}>
              <Form.Item name="labelA" label="First register is called"><Input maxLength={40} /></Form.Item>
              <Form.Item name="sourceA" label="It is"><Select options={SOURCE_OPTIONS} /></Form.Item>
              <Upload {...pick("a")}><Button icon={<UploadOutlined />}>Choose the first file (.xlsx)</Button></Upload>
            </Flex>
            <Flex vertical gap={8} style={{ minWidth: 280, flex: 1 }}>
              <Form.Item name="labelB" label="Second register is called"><Input maxLength={40} /></Form.Item>
              <Form.Item name="sourceB" label="It is"><Select options={SOURCE_OPTIONS} /></Form.Item>
              <Upload {...pick("b")}><Button icon={<UploadOutlined />}>Choose the second file (.xlsx)</Button></Upload>
            </Flex>
          </Flex>
          <Flex gap={16} wrap>
            <Form.Item name="toleranceAmount" label="Ignore a difference of up to (rupees)" extra="Differences up to this many rupees are not flagged."><Input style={{ width: 160 }} /></Form.Item>
            <Form.Item name="tolerancePercent" label="or up to (percent of the first register's figure)" extra="A difference within either is not flagged."><Input style={{ width: 160 }} /></Form.Item>
          </Flex>
          <Form.List name="aliases">
            {(fields, { add, remove }) => (
              <Flex vertical gap={4}>
                <Text strong>Columns with different names</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>If the second file calls a column something else (for example “Basic Salary” where the first says “Basic”), say which is which.</Text>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" wrap>
                    <Form.Item name={[f.name, "from"]} style={{ marginBottom: 0 }}><Input placeholder="Name in the second file" /></Form.Item>
                    <Text>means</Text>
                    <Form.Item name={[f.name, "to"]} style={{ marginBottom: 0 }}><Input placeholder="Name in the first file" /></Form.Item>
                    <Button size="small" onClick={() => remove(f.name)}>Remove</Button>
                  </Space>
                ))}
                <div><Button size="small" onClick={() => add({ from: "", to: "" })}>Add a match</Button></div>
              </Flex>
            )}
          </Form.List>
          <div style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={run.isPending}>Compare</Button>
          </div>
        </Form>
      </Card>
      {run.error && <Alert type="error" showIcon title={apiErrorMessage(run.error, "Could not compare these.")} />}
      {r && <Result r={r} onDownload={() => last && download.mutate(last)} downloading={download.isPending} />}
    </Flex>
  );
}

function Result({ r, onDownload, downloading }: { r: CompareResult; onDownload: () => void; downloading: boolean }) {
  const s = r.summary;
  const money = (v: string | null) => (v === null ? "not there" : formatRupees(v, 2));
  return (
    <Flex vertical gap={16} data-testid="compare-result">
      <Card size="small" title="What was found" extra={<Button icon={<DownloadOutlined />} loading={downloading} onClick={onDownload}>Download as Excel</Button>}>
        <Flex gap={32} wrap>
          <Statistic title={`In ${r.a.label}`} value={r.a.people} />
          <Statistic title={`In ${r.b.label}`} value={r.b.people} />
          <Statistic title="In both" value={s.matchedPeople} />
          <Statistic title="Identical" value={s.identical} />
          <Statistic title="Differ" value={s.differing} />
          <Statistic title="Beyond tolerance" value={s.flagged} valueStyle={{ color: s.flagged ? "#cf1322" : undefined }} />
          <Statistic title={`Only in ${r.a.label}`} value={s.onlyInA} />
          <Statistic title={`Only in ${r.b.label}`} value={s.onlyInB} />
        </Flex>
        <Paragraph type="secondary" style={{ marginTop: 8 }}>Tolerance: {formatRupees(r.options.toleranceAmount, 2)} or {r.options.tolerancePercent}% of {r.a.label}&rsquo;s figure; a difference within either is not flagged.</Paragraph>
      </Card>
      {(r.columns.onlyInA.length > 0 || r.columns.onlyInB.length > 0 || r.a.ignoredColumns.length > 0 || r.b.ignoredColumns.length > 0) && (
        <Alert type="warning" showIcon title="Some columns could not be lined up" description={<Flex vertical gap={2}>
          {r.columns.onlyInA.length > 0 && <Text>Only in {r.a.label}: {r.columns.onlyInA.join(", ")}</Text>}
          {r.columns.onlyInB.length > 0 && <Text>Only in {r.b.label}: {r.columns.onlyInB.join(", ")}</Text>}
          {r.a.ignoredColumns.length > 0 && <Text type="secondary">Not amounts, left out of {r.a.label}: {r.a.ignoredColumns.join(", ")}</Text>}
          {r.b.ignoredColumns.length > 0 && <Text type="secondary">Not amounts, left out of {r.b.label}: {r.b.ignoredColumns.join(", ")}</Text>}
          <Text type="secondary">If two of them are the same thing under different names, add a match above and compare again.</Text>
        </Flex>} />
      )}
      <Card size="small" title={`Differences by person (${r.people.length})`}>
        <Table
          size="small"
          rowKey="code"
          pagination={r.people.length > 20 ? { pageSize: 20 } : false}
          dataSource={r.people}
          expandable={{ defaultExpandAllRows: r.people.length <= 5, expandedRowRender: (p) => (
            <Table size="small" rowKey="label" pagination={false} dataSource={p.differences} columns={[
              { title: "Component", dataIndex: "label" },
              { title: r.a.label, align: "right", render: (_, d) => money(d.a) },
              { title: r.b.label, align: "right", render: (_, d) => money(d.b) },
              { title: "Difference", align: "right", render: (_, d) => <Text type={d.flagged ? "danger" : undefined}>{formatRupees(d.difference, 2)}</Text> },
              { title: "%", align: "right", render: (_, d) => (d.percent === null ? "" : `${d.percent}%`) },
              { title: "", render: (_, d) => (d.flagged ? <Tag color="red">Beyond tolerance</Tag> : <Tag>Within tolerance</Tag>) },
            ]} />
          ) }}
          columns={[
            { title: "Code", dataIndex: "code" },
            { title: "Name", render: (_, p) => p.name ?? "" },
            { title: "Components that differ", render: (_, p) => p.differences.length },
            { title: "", render: (_, p) => (p.flagged ? <Tag color="red">Beyond tolerance</Tag> : <Tag>Within tolerance</Tag>) },
          ]}
        />
      </Card>
      {(r.onlyInA.length > 0 || r.onlyInB.length > 0) && (
        <Flex gap={16} wrap>
          {r.onlyInA.length > 0 && <Card size="small" title={`Only in ${r.a.label} (${r.onlyInA.length})`} style={{ flex: 1, minWidth: 260 }}><Table size="small" rowKey="code" pagination={false} dataSource={r.onlyInA} columns={[{ title: "Code", dataIndex: "code" }, { title: "Name", render: (_, p) => p.name ?? "" }]} /></Card>}
          {r.onlyInB.length > 0 && <Card size="small" title={`Only in ${r.b.label} (${r.onlyInB.length})`} style={{ flex: 1, minWidth: 260 }}><Table size="small" rowKey="code" pagination={false} dataSource={r.onlyInB} columns={[{ title: "Code", dataIndex: "code" }, { title: "Name", render: (_, p) => p.name ?? "" }]} /></Card>}
        </Flex>
      )}
      <Card size="small" title="Totals over the people in both">
        <Table size="small" rowKey="label" pagination={false} dataSource={r.totals} columns={[
          { title: "Component", dataIndex: "label" },
          { title: r.a.label, align: "right", render: (_, t) => formatRupees(t.a, 2) },
          { title: r.b.label, align: "right", render: (_, t) => formatRupees(t.b, 2) },
          { title: "Difference", align: "right", render: (_, t) => formatRupees(t.difference, 2) },
        ]} />
      </Card>
    </Flex>
  );
}
