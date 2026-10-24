import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Flex, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch, Table, Tag, Typography, message } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { LayoutColumn, LayoutValue, LayoutView, RuleStatus } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs } from "../../../theme/tokens";

const { Title, Text, Paragraph } = Typography;

// Payroll → Bank and statutory layouts (Phase 6 P6-5). The layout of the bank file and of each statutory file is data typed in from the bank's or the portal's own
// specification, saved as a Placeholder and confirmed by a different person. Nothing is pre-filled with a guess: until a layout is entered and confirmed, no file can be made.

const STATUS_TAG: Record<RuleStatus, { color: string; label: string }> = { CONFIRMED: { color: "green", label: "Confirmed" }, PLACEHOLDER: { color: "orange", label: "Placeholder" }, NOT_SET: { color: "default", label: "Not set" } };
const DATE_FORMATS = ["DD-MM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "YYYYMMDD", "DD-MMM-YYYY"];

const blank = (): LayoutValue => ({ format: "DELIMITED", delimiter: ",", quote: true, lineEnding: "CRLF", extension: "csv", dateFormat: "DD-MM-YYYY", amountDecimals: 2, columnHeaders: false, header: [], trailer: [], columns: [{ source: "FIELD", value: "" }] });

export function LayoutsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LayoutView | null>(null);
  const [confirming, setConfirming] = useState<LayoutView | null>(null);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["payroll", "layouts"], queryFn: payrollApi.listLayouts });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll", "layouts"] });
  if (isLoading) return <Spin />;
  if (error) return <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the layouts.")} />;
  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Bank and statutory layouts
      </Title>
      <Paragraph type="secondary" style={{ margin: 0 }}>
        A layout says which fields go in which columns, how amounts and dates are written, and what header and trailer rows the file has. It comes from your bank’s specification (or a sample file) or from the layout the portal currently accepts, never from this system’s idea of one.
        A layout is <Tag color="orange">Placeholder</Tag> when saved, and <Tag color="green">Confirmed</Tag> only when a different person has checked it. A file cannot be made from one that is not Confirmed.
      </Paragraph>
      <Table<LayoutView>
        rowKey="key"
        size="small"
        scroll={{ x: "max-content" }}
        pagination={false}
        dataSource={data}
        columns={[
          { title: "File", render: (_, r) => <div><Text strong>{r.label}</Text><div><Text type="secondary" style={{ fontSize: fs.sm }}>{r.description}</Text></div></div> },
          { title: "Status", render: (_, r) => <Tag color={STATUS_TAG[r.status].color}>{STATUS_TAG[r.status].label}</Tag> },
          {
            title: "Layout",
            render: (_, r) => {
              if (!r.current) return "Not entered";
              // The bank layout is one of the owners' secrets: without the bank-layout permissions the screen says that it exists, and nothing of it.
              if ((r.current.value as { restricted?: boolean }).restricted) return <Text type="secondary">Entered. Only the people who enter and check the bank layout can see it.</Text>;
              return `${(r.current.value as LayoutValue).format.toLowerCase().replace("_", " ")}, ${(r.current.value as LayoutValue).columns.length} columns`;
            },
          },
          { title: "Source", render: (_, r) => <Text type="secondary" style={{ fontSize: fs.sm }}>{r.sourceLabel ?? r.whoConfirms}</Text> },
          {
            title: "",
            render: (_, r) => (
              <Space>
                {hasPermission(r.key === "BANK_TEMPLATE" ? "payroll.banklayout.manage" : "payroll.rules.manage") && <Button size="small" onClick={() => setEditing(r)}>{r.current ? "Edit…" : "Enter…"}</Button>}
                {hasPermission(r.key === "BANK_TEMPLATE" ? "payroll.banklayout.confirm" : "payroll.rules.confirm") && r.status === "PLACEHOLDER" && <Button size="small" type="primary" onClick={() => setConfirming(r)}>Confirm…</Button>}
              </Space>
            ),
          },
        ]}
      />
      {editing && <EditModal layout={editing} onClose={() => setEditing(null)} onDone={refresh} />}
      {confirming && <ConfirmModal layout={confirming} onClose={() => setConfirming(null)} onDone={refresh} />}
    </Flex>
  );
}

// `name` is the list's own name (relative to its parent list, as Ant Design wants it); `abs` is where it sits in the whole form, for reading a sibling value.
function CellsEditor({ name, abs, fields, allowField, fixed, title }: { name: (string | number)[]; abs: (string | number)[]; fields: string[]; allowField: boolean; fixed: boolean; title: string }) {
  return (
    <Form.List name={name}>
      {(rows, { add, remove }) => (
        <Flex vertical gap={6}>
          {rows.map((row) => (
            <Space key={row.key} align="start" wrap style={{ width: "100%" }}>
              <Form.Item name={[row.name, "source"]} noStyle>
                <Select style={{ width: 120 }} options={[...(allowField ? [{ value: "FIELD", label: "Field" }] : []), { value: "CONSTANT", label: "Fixed text" }, { value: "PATTERN", label: "Pattern" }]} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) =>
                  getFieldValue([...abs, row.name, "source"]) === "FIELD" ? (
                    <Form.Item name={[row.name, "value"]} noStyle getValueProps={(v: string) => ({ value: v === "" ? undefined : v })}>
                      <Select style={{ width: 200 }} showSearch options={fields.map((f) => ({ value: f, label: f }))} placeholder="Which field" />
                    </Form.Item>
                  ) : (
                    <Form.Item name={[row.name, "value"]} noStyle>
                      <Input style={{ width: 240 }} placeholder={getFieldValue([...abs, row.name, "source"]) === "PATTERN" ? "Text with {TOKENS}, e.g. Salary {PERIOD}" : "Text exactly as written"} />
                    </Form.Item>
                  )
                }
              </Form.Item>
              {fixed && (
                <Form.Item name={[row.name, "width"]} noStyle>
                  <InputNumber min={1} max={200} placeholder="Width" style={{ width: 80 }} />
                </Form.Item>
              )}
              <Button type="text" icon={<MinusCircleOutlined />} aria-label="Remove" onClick={() => remove(row.name)} />
            </Space>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ source: allowField ? "FIELD" : "CONSTANT", value: "" })} style={{ alignSelf: "flex-start" }}>
            Add {title}
          </Button>
        </Flex>
      )}
    </Form.List>
  );
}

function RowsEditor({ name, tokens, fixed, title }: { name: string; tokens: string[]; fixed: boolean; title: string }) {
  return (
    <Form.List name={name}>
      {(rows, { add, remove }) => (
        <Flex vertical gap={8}>
          {rows.map((row, i) => (
            <Card key={row.key} size="small" title={`${title} row ${i + 1}`} extra={<Button type="text" icon={<MinusCircleOutlined />} aria-label="Remove row" onClick={() => remove(row.name)} />}>
              <CellsEditor name={[row.name]} abs={[name, row.name]} fields={[]} allowField={false} fixed={fixed} title="cell" />
              <Text type="secondary" style={{ fontSize: fs.sm }}>Tokens: {tokens.map((t) => `{${t}}`).join(" ")}</Text>
            </Card>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add([{ source: "CONSTANT", value: "" }])} style={{ alignSelf: "flex-start" }}>
            Add a {title.toLowerCase()} row
          </Button>
        </Flex>
      )}
    </Form.List>
  );
}

function EditModal({ layout, onClose, onDone }: { layout: LayoutView; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm<LayoutValue & { debitAccountNumber?: string }>();
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<payrollApi.LayoutSavePreview | null>(null);
  const [value, setValue] = useState<LayoutValue | null>(null);
  const [note, setNote] = useState("");
  const [seen, setSeen] = useState(false);
  const current = layout.current?.value as (LayoutValue & { hasDebitAccount?: boolean; debitAccountLast4?: string }) | undefined;
  const isBank = layout.layoutKind === "BANK";
  const fieldNames = layout.fields.map((f) => f.name);
  const tokens = [...layout.tokens, ...(isBank ? [] : [])];
  const check = useMutation({
    mutationFn: async () => {
      const raw = (await form.validateFields()) as LayoutValue & { debitAccountNumber?: string };
      const v: LayoutValue = { ...raw, columns: (raw.columns ?? []).map(clean), header: (raw.header ?? []).map((r) => r.map(clean)), trailer: (raw.trailer ?? []).map((r) => r.map(clean)) };
      if (!raw.debitAccountNumber) delete v.debitAccountNumber;
      return { v, p: await payrollApi.previewLayoutSave(layout.key, v) };
    },
    onSuccess: ({ v, p }) => {
      setProblem(null);
      setValue(v);
      setPreview(p);
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That layout cannot be used.")),
  });
  const save = useMutation({
    mutationFn: () => payrollApi.saveLayout(layout.key, { value: value!, fingerprint: preview!.fingerprint, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      void message.success("Saved as a Placeholder. A different person has to confirm it.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not save.")),
  });
  return (
    <Modal open width={820} title={`${layout.label}: layout`} onCancel={onClose} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={current ?? blank()} onValuesChange={() => { setPreview(null); setSeen(false); }}>
        <Flex vertical gap={4}>
          <Space wrap size={16}>
            <Form.Item name="format" label="Kind of file">
              <Select style={{ width: 170 }} options={[{ value: "DELIMITED", label: "Delimited (CSV, text)" }, { value: "FIXED_WIDTH", label: "Fixed width" }, { value: "XLSX", label: "Excel workbook" }]} />
            </Form.Item>
            <Form.Item name="extension" label="File extension"><Input style={{ width: 90 }} maxLength={5} /></Form.Item>
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) => getFieldValue("format") === "DELIMITED" && <Form.Item name="delimiter" label="Delimiter"><Input style={{ width: 90 }} maxLength={3} /></Form.Item>}
            </Form.Item>
            <Form.Item name="lineEnding" label="Line ending"><Select style={{ width: 100 }} options={[{ value: "CRLF", label: "CRLF" }, { value: "LF", label: "LF" }]} /></Form.Item>
            <Form.Item name="dateFormat" label="Dates"><Select style={{ width: 140 }} options={DATE_FORMATS.map((d) => ({ value: d, label: d }))} /></Form.Item>
            <Form.Item name="amountDecimals" label="Amount decimals"><InputNumber min={0} max={2} style={{ width: 90 }} /></Form.Item>
            <Form.Item name="columnHeaders" label="Column titles row" valuePropName="checked"><Switch /></Form.Item>
          </Space>
          {isBank && (
            <>
              <Form.Item name="narrationPattern" label="Narration pattern" extra="Written into the NARRATION field, for example: Salary {PERIOD}"><Input maxLength={200} /></Form.Item>
              <Form.Item name="debitAccountNumber" label="Company debit account number" extra={current?.hasDebitAccount ? `One is saved (ending ${current.debitAccountLast4}). Leave this blank to keep it; type a number only to change it. It is stored encrypted and never shown again.` : "Stored encrypted and never shown again; only its last four digits are."}>
                <Input.Password autoComplete="off" maxLength={20} style={{ maxWidth: 320 }} />
              </Form.Item>
            </>
          )}
          <Text strong>Columns, in order</Text>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => <CellsEditor name={["columns"]} abs={["columns"]} fields={fieldNames} allowField fixed={getFieldValue("format") === "FIXED_WIDTH"} title="column" />}
          </Form.Item>
          <Text strong>Rows above the data (header)</Text>
          <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <RowsEditor name="header" tokens={tokens} fixed={getFieldValue("format") === "FIXED_WIDTH"} title="Header" />}</Form.Item>
          <Text strong>Rows below the data (trailer)</Text>
          <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <RowsEditor name="trailer" tokens={tokens} fixed={getFieldValue("format") === "FIXED_WIDTH"} title="Trailer" />}</Form.Item>
        </Flex>
        {problem && <Alert type="error" showIcon title={problem} style={{ marginTop: 12 }} />}
        {!preview && (
          <Space style={{ marginTop: 12 }}>
            <Button type="primary" loading={check.isPending} onClick={() => check.mutate()}>Check it…</Button>
            <Button onClick={onClose}>Cancel</Button>
          </Space>
        )}
        {preview && (
          <Flex vertical gap={8} style={{ marginTop: 12 }}>
            {preview.unchanged ? (
              <Alert type="info" showIcon title="This is the same as the current layout. Nothing to save." />
            ) : (
              <>
                <Alert type="success" showIcon title="The layout is valid." description={preview.willResetConfirmation ? "Saving makes this the new current layout, as a Placeholder. The last Confirmed layout stays on record, but no file can be made until the new one is confirmed by a different person." : "Saving adds it as a Placeholder. A different person has to confirm it before a file can be made."} />
                <Input.TextArea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where this came from (for example: the bank’s sheet dated …)" />
                <Checkbox checked={seen} onChange={(e) => setSeen(e.target.checked)}>I have compared this with the specification I was given.</Checkbox>
                <Space>
                  <Button type="primary" disabled={!seen} loading={save.isPending} onClick={() => save.mutate()}>Save as a Placeholder</Button>
                  <Button onClick={() => setPreview(null)}>Keep editing</Button>
                </Space>
              </>
            )}
          </Flex>
        )}
      </Form>
    </Modal>
  );
}

/** Drops empty optional fields so the server's strict schema is not given blanks. */
function clean(c: LayoutColumn): LayoutColumn {
  const out: LayoutColumn = { source: c.source, value: c.value ?? "" };
  if (c.width) out.width = c.width;
  if (c.header) out.header = c.header;
  if (c.align) out.align = c.align;
  if (c.pad) out.pad = c.pad;
  if (c.numeric) out.numeric = c.numeric;
  return out;
}

function ConfirmModal({ layout, onClose, onDone }: { layout: LayoutView; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [seen, setSeen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data: p, isLoading, error } = useQuery({ queryKey: ["payroll", "layout-confirm", layout.key], queryFn: () => payrollApi.previewLayoutConfirm(layout.key), refetchOnWindowFocus: false });
  const confirm = useMutation({
    mutationFn: () => payrollApi.confirmLayout(layout.key, { version: p!.version, note: note.trim(), fingerprint: p!.fingerprint }),
    onSuccess: () => {
      void message.success("Confirmed.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not work.")),
  });
  return (
    <Modal open width={720} title={`Confirm: ${layout.label}`} onCancel={onClose} okText="Confirm this layout" okButtonProps={{ disabled: !p || !!p.blocked || !seen || note.trim().length < 3, loading: confirm.isPending }} onOk={() => confirm.mutate()} destroyOnHidden>
      <Flex vertical gap={8}>
        {isLoading && <Spin />}
        {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not open this.")} />}
        {p && (
          <>
            <Text>Version {p.version}, entered by {p.authorName}. {p.sourceLabel}</Text>
            {p.blocked && <Alert type="warning" showIcon title={p.blocked} />}
            <pre style={{ margin: 0, maxHeight: 280, overflow: "auto", background: "rgba(0,0,0,0.04)", padding: 8, fontSize: fs.sm }}>{JSON.stringify(p.value, null, 2)}</pre>
            <Input.TextArea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked it against (required)" />
            <Checkbox checked={seen} onChange={(e) => setSeen(e.target.checked)}>I have compared this layout with the bank’s or the portal’s own specification.</Checkbox>
          </>
        )}
        {problem && <Alert type="error" showIcon title={problem} />}
        {layout.lastConfirmed && <Text type="secondary" style={{ fontSize: fs.sm }}>The last confirmed layout was version {layout.lastConfirmed.version}, confirmed {layout.lastConfirmed.confirmation ? formatDate(layout.lastConfirmed.confirmation.confirmedAt) : ""}.</Text>}
      </Flex>
    </Modal>
  );
}
