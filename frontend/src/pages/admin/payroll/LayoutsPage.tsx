import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, InputNumber, Select, Switch, Tooltip } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { LayoutColumn, LayoutValue, LayoutView, RuleStatus } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { ApprovalBanner, DataTable, EmptyState, FormGroupTitle, KeyValueGrid, PageHeader, Panel, QueryState, SideDrawer, SkeletonCard, SkeletonTable, Stack, StatusChip, toast, type ChipTone } from "../../../ui";
import { Caption, PersonCell } from "../../../components/payroll/payrollUi";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

// Payroll → Bank and statutory layouts (Phase 6 P6-5). The layout of the bank file and of each statutory file is data typed in from the bank's or the portal's own
// specification, saved as a Placeholder and confirmed by a different person. Nothing is pre-filled with a guess: until a layout is entered and confirmed, no file can be made.

const STATUS_TAG: Record<RuleStatus, { tone: ChipTone; label: string }> = { CONFIRMED: { tone: "success", label: "Confirmed" }, PLACEHOLDER: { tone: "warning", label: "Placeholder" }, NOT_SET: { tone: "neutral", label: "Not set" } };
const statusChip = (s: RuleStatus) => <StatusChip tone={STATUS_TAG[s].tone}>{STATUS_TAG[s].label}</StatusChip>;
const DATE_FORMATS = ["DD-MM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "YYYYMMDD", "DD-MMM-YYYY"];

const blank = (): LayoutValue => ({ format: "DELIMITED", delimiter: ",", quote: true, lineEnding: "CRLF", extension: "csv", dateFormat: "DD-MM-YYYY", amountDecimals: 2, columnHeaders: false, header: [], trailer: [], columns: [{ source: "FIELD", value: "" }] });

export function LayoutsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LayoutView | null>(null);
  const [confirming, setConfirming] = useState<LayoutView | null>(null);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "layouts"], queryFn: payrollApi.listLayouts });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll", "layouts"] });
  const mayManage = (r: LayoutView) => hasPermission(r.key === "BANK_TEMPLATE" ? "payroll.banklayout.manage" : "payroll.rules.manage");
  const mayConfirm = (r: LayoutView) => hasPermission(r.key === "BANK_TEMPLATE" ? "payroll.banklayout.confirm" : "payroll.rules.confirm");
  const actions = (r: LayoutView, block?: boolean) => {
    const edit = mayManage(r);
    const confirm = mayConfirm(r) && r.status === "PLACEHOLDER";
    if (!edit && !confirm) return null;
    const size = block ? undefined : ("small" as const);
    const style = block ? { flex: 1 } : undefined;
    return (
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: "flex-end", width: block ? "100%" : undefined }}>
        {edit && <Button size={size} style={style} onClick={() => setEditing(r)}>{r.current ? "Edit…" : "Enter…"}</Button>}
        {confirm && <Button size={size} style={style} type="primary" onClick={() => setConfirming(r)}>Confirm…</Button>}
      </div>
    );
  };
  return (
    <>
      <PageHeader title="Bank and statutory layouts" subtitle="The shape of the bank file and of each statutory file" />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="Typed in from the bank's or the portal's own specification"
          description={
            <>
              A layout says which fields go in which columns, how amounts and dates are written, and what header and trailer rows the file has. It comes from your bank’s specification (or a sample file) or from the layout the portal currently accepts, never from this system’s idea of one.
              A layout is {statusChip("PLACEHOLDER")} when saved, and {statusChip("CONFIRMED")} only when a different person has checked it. A file cannot be made from one that is not Confirmed.
            </>
          }
        />
        <Panel>
          <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonTable rows={5} columns={5} />} isEmpty={data.length === 0} empty={<EmptyState compact title="No layouts to set up" description="The files payroll makes are listed here once they are configured." />}>
            <DataTable<LayoutView>
              rowKey="key"
              density="compact"
              pagination={false}
              dataSource={data}
              mobile={{
                title: (r) => r.label,
                subtitle: (r) => r.description,
                status: (r) => statusChip(r.status),
                fields: [
                  { label: "Layout", render: (r) => <LayoutSummary r={r} /> },
                  { label: "Source", render: (r) => r.sourceLabel ?? r.whoConfirms },
                ],
                actions: (r) => actions(r, true),
              }}
              columns={[
                { title: "File", key: "file", render: (_, r) => <PersonCell name={r.label} code={r.description} /> },
                { title: "Status", key: "status", render: (_, r) => statusChip(r.status) },
                { title: "Layout", key: "layout", render: (_, r) => <LayoutSummary r={r} /> },
                { title: "Source", key: "source", render: (_, r) => <Caption>{r.sourceLabel ?? r.whoConfirms}</Caption> },
                { title: "", key: "actions", align: "right", render: (_, r) => actions(r) },
              ]}
            />
          </QueryState>
        </Panel>
      </Stack>
      {editing && <EditDrawer layout={editing} onClose={() => setEditing(null)} onDone={refresh} />}
      {confirming && <ConfirmDrawer layout={confirming} onClose={() => setConfirming(null)} onDone={refresh} />}
    </>
  );
}

function LayoutSummary({ r }: { r: LayoutView }) {
  if (!r.current) return <>Not entered</>;
  // The bank layout is one of the owners' secrets: without the bank-layout permissions the screen says that it exists, and nothing of it.
  if ((r.current.value as { restricted?: boolean }).restricted) return <Caption>Entered. Only the people who enter and check the bank layout can see it.</Caption>;
  return <>{`${(r.current.value as LayoutValue).format.toLowerCase().replace("_", " ")}, ${(r.current.value as LayoutValue).columns.length} columns`}</>;
}

// `name` is the list's own name (relative to its parent list, as Ant Design wants it); `abs` is where it sits in the whole form, for reading a sibling value.
function CellsEditor({ name, abs, fields, allowField, fixed, title }: { name: (string | number)[]; abs: (string | number)[]; fields: string[]; allowField: boolean; fixed: boolean; title: string }) {
  return (
    <Form.List name={name}>
      {(rows, { add, remove }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
          {rows.map((row, i) => (
            <div key={row.key} style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "flex-start", width: "100%" }}>
              <Form.Item name={[row.name, "source"]} noStyle>
                <Select aria-label={`${title} ${i + 1}: source`} style={{ width: 120 }} options={[...(allowField ? [{ value: "FIELD", label: "Field" }] : []), { value: "CONSTANT", label: "Fixed text" }, { value: "PATTERN", label: "Pattern" }]} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) =>
                  getFieldValue([...abs, row.name, "source"]) === "FIELD" ? (
                    <Form.Item name={[row.name, "value"]} noStyle getValueProps={(v: string) => ({ value: v === "" ? undefined : v })}>
                      <Select aria-label={`${title} ${i + 1}: field`} style={{ width: 200, maxWidth: "100%" }} showSearch options={fields.map((f) => ({ value: f, label: f }))} placeholder="Which field" />
                    </Form.Item>
                  ) : (
                    <Form.Item name={[row.name, "value"]} noStyle>
                      <Input aria-label={`${title} ${i + 1}: text`} style={{ width: 240, maxWidth: "100%" }} placeholder={getFieldValue([...abs, row.name, "source"]) === "PATTERN" ? "Text with {TOKENS}, e.g. Salary {PERIOD}" : "Text exactly as written"} />
                    </Form.Item>
                  )
                }
              </Form.Item>
              {fixed && (
                <Form.Item name={[row.name, "width"]} noStyle>
                  <InputNumber aria-label={`${title} ${i + 1}: width`} min={1} max={200} placeholder="Width" style={{ width: 90 }} />
                </Form.Item>
              )}
              <Tooltip title={`Remove ${title} ${i + 1}`}>
                <Button type="text" icon={<MinusCircleOutlined />} aria-label="Remove" onClick={() => remove(row.name)} />
              </Tooltip>
            </div>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ source: allowField ? "FIELD" : "CONSTANT", value: "" })} style={{ alignSelf: "flex-start" }}>
            Add {title}
          </Button>
        </div>
      )}
    </Form.List>
  );
}

function RowsEditor({ name, tokens, fixed, title }: { name: string; tokens: string[]; fixed: boolean; title: string }) {
  return (
    <Form.List name={name}>
      {(rows, { add, remove }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
          {rows.map((row, i) => (
            <div key={row.key} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[3], background: v.bgSubtle }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[2], marginBottom: space[2] }}>
                <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{`${title} row ${i + 1}`}</span>
                <Tooltip title="Remove row">
                  <Button type="text" icon={<MinusCircleOutlined />} aria-label="Remove row" onClick={() => remove(row.name)} />
                </Tooltip>
              </div>
              <CellsEditor name={[row.name]} abs={[name, row.name]} fields={[]} allowField={false} fixed={fixed} title="cell" />
              <Caption>Tokens: {tokens.map((t) => `{${t}}`).join(" ")}</Caption>
            </div>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add([{ source: "CONSTANT", value: "" }])} style={{ alignSelf: "flex-start" }}>
            Add a {title.toLowerCase()} row
          </Button>
        </div>
      )}
    </Form.List>
  );
}

function EditDrawer({ layout, onClose, onDone }: { layout: LayoutView; onClose: () => void; onDone: () => void }) {
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
    onError: (e) => {
      if (e && typeof e === "object" && "errorFields" in e) return; // shown on the fields themselves
      setProblem(apiErrorMessage(e, "That layout cannot be used."));
    },
  });
  const save = useMutation({
    mutationFn: () => payrollApi.saveLayout(layout.key, { value: value!, fingerprint: preview!.fingerprint, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      toast.success("Saved as a Placeholder. A different person has to confirm it.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not save.")),
  });
  return (
    <SideDrawer
      open
      size="wide"
      title={`${layout.label}: layout`}
      status={statusChip(layout.status)}
      subtitle={preview ? "Checked. Save it as a Placeholder for a different person to confirm." : "Enter it exactly as the specification says, then check it"}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%" }}>
          {!preview ? (
            <>
              <Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
              <Button size="large" type="primary" style={{ flex: 1 }} loading={check.isPending} onClick={() => check.mutate()}>Check it…</Button>
            </>
          ) : (
            <>
              <Button size="large" style={{ flex: 1 }} onClick={() => setPreview(null)}>Keep editing</Button>
              {!preview.unchanged && (
                <Button size="large" type="primary" style={{ flex: 1 }} disabled={!seen} loading={save.isPending} onClick={() => save.mutate()}>Save as a Placeholder</Button>
              )}
            </>
          )}
        </div>
      }
    >
      <Form form={form} layout="vertical" initialValues={current ?? blank()} onValuesChange={() => { setPreview(null); setSeen(false); }}>
        <FormGroupTitle>The file</FormGroupTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", columnGap: space[4] }}>
          <Form.Item name="format" label="Kind of file">
            <Select options={[{ value: "DELIMITED", label: "Delimited (CSV, text)" }, { value: "FIXED_WIDTH", label: "Fixed width" }, { value: "XLSX", label: "Excel workbook" }]} />
          </Form.Item>
          <Form.Item name="extension" label="File extension"><Input maxLength={5} /></Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => getFieldValue("format") === "DELIMITED" && <Form.Item name="delimiter" label="Delimiter"><Input maxLength={3} /></Form.Item>}
          </Form.Item>
          <Form.Item name="lineEnding" label="Line ending"><Select options={[{ value: "CRLF", label: "CRLF" }, { value: "LF", label: "LF" }]} /></Form.Item>
          <Form.Item name="dateFormat" label="Dates"><Select options={DATE_FORMATS.map((d) => ({ value: d, label: d }))} /></Form.Item>
          <Form.Item name="amountDecimals" label="Amount decimals"><InputNumber min={0} max={2} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="columnHeaders" label="Column titles row" valuePropName="checked"><Switch /></Form.Item>
        </div>
        {isBank && (
          <>
            <Form.Item name="narrationPattern" label="Narration pattern" extra="Written into the NARRATION field, for example: Salary {PERIOD}"><Input maxLength={200} /></Form.Item>
            <Form.Item name="debitAccountNumber" label="Company debit account number" extra={current?.hasDebitAccount ? `One is saved (ending ${current.debitAccountLast4}). Leave this blank to keep it; type a number only to change it. It is stored encrypted and never shown again.` : "Stored encrypted and never shown again; only its last four digits are."}>
              <Input.Password autoComplete="off" maxLength={20} style={{ maxWidth: 320 }} />
            </Form.Item>
          </>
        )}
        <FormGroupTitle>Columns, in order</FormGroupTitle>
        <Form.Item noStyle shouldUpdate>
          {({ getFieldValue }) => <CellsEditor name={["columns"]} abs={["columns"]} fields={fieldNames} allowField fixed={getFieldValue("format") === "FIXED_WIDTH"} title="column" />}
        </Form.Item>
        <FormGroupTitle>Rows above the data (header)</FormGroupTitle>
        <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <RowsEditor name="header" tokens={tokens} fixed={getFieldValue("format") === "FIXED_WIDTH"} title="Header" />}</Form.Item>
        <FormGroupTitle>Rows below the data (trailer)</FormGroupTitle>
        <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <RowsEditor name="trailer" tokens={tokens} fixed={getFieldValue("format") === "FIXED_WIDTH"} title="Trailer" />}</Form.Item>
      </Form>
      <Stack gap={space[3]} style={{ marginTop: space[4] }}>
        {problem && <ApprovalBanner tone="danger" title={problem} />}
        {preview &&
          (preview.unchanged ? (
            <ApprovalBanner tone="info" title="This is the same as the current layout. Nothing to save." />
          ) : (
            <>
              <ApprovalBanner tone="success" title="The layout is valid." description={preview.willResetConfirmation ? "Saving makes this the new current layout, as a Placeholder. The last Confirmed layout stays on record, but no file can be made until the new one is confirmed by a different person." : "Saving adds it as a Placeholder. A different person has to confirm it before a file can be made."} />
              <Form layout="vertical" component="div">
                <Form.Item label="Where this came from" htmlFor="layout-note" style={{ marginBottom: 0 }}>
                  <Input.TextArea id="layout-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where this came from (for example: the bank’s sheet dated …)" />
                </Form.Item>
              </Form>
              <Checkbox checked={seen} onChange={(e) => setSeen(e.target.checked)}>I have compared this with the specification I was given.</Checkbox>
            </>
          ))}
      </Stack>
    </SideDrawer>
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

function ConfirmDrawer({ layout, onClose, onDone }: { layout: LayoutView; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [seen, setSeen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "layout-confirm", layout.key], queryFn: () => payrollApi.previewLayoutConfirm(layout.key), refetchOnWindowFocus: false });
  const confirm = useMutation({
    mutationFn: () => payrollApi.confirmLayout(layout.key, { version: p!.version, note: note.trim(), fingerprint: p!.fingerprint }),
    onSuccess: () => {
      toast.success("Confirmed.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not work.")),
  });
  return (
    <SideDrawer
      open
      size="wide"
      title={`Confirm: ${layout.label}`}
      status={statusChip(layout.status)}
      onClose={onClose}
      primaryLabel="Confirm this layout"
      onPrimary={() => confirm.mutate()}
      primaryDisabled={!p || !!p.blocked || !seen || note.trim().length < 3}
      primaryLoading={confirm.isPending}
    >
      <Stack gap={space[3]}>
        <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonCard lines={6} />} compact>
          {p && (
            <Stack gap={space[3]}>
              <KeyValueGrid
                columns={1}
                items={[
                  { label: "Version", value: p.version },
                  { label: "Entered by", value: p.authorName },
                  ...(p.sourceLabel ? [{ label: "Where it came from", value: p.sourceLabel }] : []),
                ]}
              />
              {p.blocked && <ApprovalBanner tone="warning" title={p.blocked} />}
              <pre tabIndex={0} aria-label="The layout being confirmed" style={{ margin: 0, maxHeight: 320, overflow: "auto", background: v.bgSubtle, border: `1px solid ${v.borderDefault}`, borderRadius: radius.sm, padding: space[3], fontSize: fs.sm, color: v.textBody }}>{JSON.stringify(p.value, null, 2)}</pre>
              <Form layout="vertical" component="div">
                <Form.Item label="What you checked it against" htmlFor="layout-confirm-note" required help="Required, at least 3 characters." style={{ marginBottom: 0 }}>
                  <Input.TextArea id="layout-confirm-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked it against (required)" />
                </Form.Item>
              </Form>
              <Checkbox checked={seen} onChange={(e) => setSeen(e.target.checked)}>I have compared this layout with the bank’s or the portal’s own specification.</Checkbox>
            </Stack>
          )}
        </QueryState>
        {problem && <ApprovalBanner tone="danger" title={problem} />}
        {layout.lastConfirmed && <Caption>The last confirmed layout was version {layout.lastConfirmed.version}, confirmed {layout.lastConfirmed.confirmation ? formatDate(layout.lastConfirmed.confirmation.confirmedAt) : ""}.</Caption>}
      </Stack>
    </SideDrawer>
  );
}

