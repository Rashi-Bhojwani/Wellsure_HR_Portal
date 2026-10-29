import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Col, Form, Input, Row, Select, Switch, Tooltip } from "antd";
import { DeleteOutlined, EyeOutlined, FilePdfOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { LETTER_EXTRA_FIELD_TYPES, type LetterExtraField } from "@shared/constants/letters";
import * as lettersApi from "../../../api/letters";
import type { LetterTemplateVersion } from "../../../api/letters";
import { LetterEditor, type PlaceholderOption } from "../../../components/letters/LetterEditor";
import { EmployeePicker, ExtraFieldInputs } from "../../../components/letters/LetterFields";
import { placeholderOptions, stringifyExtras } from "../../../components/letters/letterUtils";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, fw, layout, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, EmptyState, PageHeader, Panel, SideDrawer, Skel, Stack, StatusChip, Timeline, errorStatus, isForbidden, toast, useIsPhone } from "../../../ui";

const TYPE_LABELS: Record<string, string> = { text: "Text", number: "Number", currency: "Amount (₹)", date: "Date" };
const PREVIEW_FORM_ID = "letter-preview-form";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The live preview shows each {{token}} as its readable name ("[Employee full name]"). The result is fed to a read-only TipTap editor,
// which only renders what its schema allows — the same safety as the editor itself, no raw HTML injection.
function readableHtml(html: string, placeholders: PlaceholderOption[]): string {
  const labels = new Map(placeholders.map((p) => [p.key, p.label.replace(/^Typed in:\s*/, "")]));
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => (labels.has(key) ? `[${escapeHtml(labels.get(key)!)}]` : whole));
}

function EditorSkeleton() {
  return (
    <Stack>
      <div>
        <Skel w={140} h={14} />
        <Skel w="40%" h={28} style={{ marginTop: space[2] }} />
      </div>
      <Row gutter={[space[6], space[6]]}>
        <Col xs={24} xl={14}>
          <Panel>
            <Skel h={40} r={radius.md} />
            <Skel h={320} r={radius.md} style={{ marginTop: space[3] }} />
          </Panel>
        </Col>
        <Col xs={24} xl={10}>
          <Panel>
            <Skel h={380} r={radius.md} />
          </Panel>
        </Col>
      </Row>
    </Stack>
  );
}

// One letter template: its wording (TipTap) beside a live preview, the fields HR types in when
// issuing it, a PDF preview against a real employee, and its version history.
// Saving never edits a version — it adds one.
export function LetterTemplateEditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const { data: template, isLoading, error, refetch } = useQuery({ queryKey: ["letters", "template", id], queryFn: () => lettersApi.getTemplate(id), retry: false });
  const current = template?.versions[0];

  // The draft is tied to the version it started from: when a new version
  // arrives (saved here or elsewhere) the editor shows that version again.
  const [draft, setDraft] = useState<{ baseId: string; body: string; fields: LetterExtraField[] } | null>(null);
  const ownDraft = draft && current && draft.baseId === current.id ? draft : null;
  const body = ownDraft?.body ?? current?.bodyHtml ?? "";
  const fields = useMemo(() => ownDraft?.fields ?? current?.extraFields ?? [], [ownDraft, current]);
  const setBody = (b: string) => current && setDraft({ baseId: current.id, body: b, fields });
  const setFields = (f: LetterExtraField[]) => current && setDraft({ baseId: current.id, body, fields: f });
  const [viewing, setViewing] = useState<LetterTemplateVersion | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewForm] = Form.useForm<{ employeeId: string; extraValues?: Record<string, unknown> }>();
  const [settingsForm] = Form.useForm<{ name: string; description: string | null; visibleToEmployeeDefault: boolean }>();

  useEffect(() => {
    if (template) settingsForm.setFieldsValue({ name: template.name, description: template.description, visibleToEmployeeDefault: template.visibleToEmployeeDefault });
  }, [template, settingsForm]);

  const placeholders = useMemo(() => placeholderOptions(fields), [fields]);
  const preview = useMemo(() => readableHtml(body, placeholders), [body, placeholders]);
  const dirty = Boolean(current) && (body !== current!.bodyHtml || JSON.stringify(fields) !== JSON.stringify(current!.extraFields));

  const applied = (t: lettersApi.LetterTemplateDetail) => {
    queryClient.setQueryData(["letters", "template", id], t);
    void queryClient.invalidateQueries({ queryKey: ["letters", "templates"] });
  };
  const save = useMutation({
    mutationFn: () => lettersApi.saveNewVersion(id, { bodyHtml: body, extraFields: fields }),
    onSuccess: (t) => {
      applied(t);
      toast.success(`Saved as version ${t.versions[0]!.version}.`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't save the template.")),
  });
  const saveSettings = useMutation({
    mutationFn: (vals: { name: string; description: string | null; visibleToEmployeeDefault: boolean }) => lettersApi.updateTemplate(id, vals),
    onSuccess: (t) => {
      applied(t);
      toast.success("Template settings saved.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't save the settings.")),
  });
  const renderPdf = useMutation({
    mutationFn: (vals: { employeeId: string; extraValues?: Record<string, unknown> }) =>
      lettersApi.previewTemplate({ templateName: template?.name ?? "Preview", bodyHtml: body, extraFields: fields, employeeId: vals.employeeId, extraValues: stringifyExtras(vals.extraValues) }),
    onSuccess: (pdf) => {
      lettersApi.openPdf(pdf);
      setPreviewOpen(false);
    },
    onError: async (err: unknown) => {
      // The preview endpoint answers in a Blob, so its JSON error needs reading out.
      const data = (err as { response?: { data?: Blob } }).response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text()) as { error?: { message?: string } };
          toast.error(parsed.error?.message ?? "Couldn't render the preview.");
          return;
        } catch {
          /* fall through */
        }
      }
      toast.error(apiErrorMessage(err, "Couldn't render the preview."));
    },
  });

  if (isLoading) return <EditorSkeleton />;
  if (error || !template) {
    const back = <Button onClick={() => navigate("/admin/admin-tools/templates")}>Back to templates</Button>;
    if (isForbidden(error)) return <EmptyState kind="forbidden" action={back} />;
    if (errorStatus(error) === 404 || !error) return <EmptyState illustration="documents" title="Template not found" description="It may have been removed, or the link is wrong." action={back} />;
    return <EmptyState kind="error" description={apiErrorMessage(error, "We couldn't load this template.")} onRetry={() => void refetch()} action={back} />;
  }

  const setField = (i: number, patch: Partial<LetterExtraField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const nextVersion = (current?.version ?? 0) + 1;
  const hint = { color: v.textSecondary, fontSize: fs.sm, marginTop: space[3] } as const;

  return (
    <>
      <PageHeader
        back="/admin/admin-tools/templates"
        breadcrumb={[{ label: "Email & Letter Templates", to: "/admin/admin-tools/templates" }, { label: template.name }]}
        title={template.name}
        tags={
          <>
            <StatusChip tone="info">v{current?.version ?? 0}</StatusChip>
            {!template.isActive && <StatusChip status="INACTIVE">Inactive</StatusChip>}
            {dirty && <StatusChip tone="warning">Unsaved changes</StatusChip>}
          </>
        }
        actions={
          <>
            <Button icon={<FilePdfOutlined />} onClick={() => setPreviewOpen(true)}>
              Preview
            </Button>
            <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save as version {nextVersion}
            </Button>
          </>
        }
      />
      <Stack>
        {/* Editor and live preview side by side on desktop, stacked on tablets and phones. */}
        <Row gutter={[space[6], space[6]]}>
          <Col xs={24} xl={14}>
            <Panel title="Wording" subtitle={`${template.code} · editing on top of v${current?.version ?? 0}`}>
              <LetterEditor value={body} onChange={setBody} placeholders={placeholders} />
              <div style={hint}>
                The letterhead (company name, address, logo) is added above automatically. Insert values from the placeholder menu; each is filled in as it stands on the day the letter is issued.
              </div>
            </Panel>
          </Col>
          <Col xs={24} xl={10}>
            <div style={{ position: phone ? undefined : "sticky", top: layout.topbar + space[4] }}>
              <Panel
                title="Live preview"
                subtitle="Placeholders shown by name"
                extra={
                  <Tooltip title="Render this draft as a PDF with a real employee's details">
                    <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
                      With an employee
                    </Button>
                  </Tooltip>
                }
              >
                <div
                  aria-label="Letter preview"
                  style={{
                    background: v.bgSubtle,
                    borderRadius: radius.md,
                    padding: phone ? space[3] : space[5],
                    maxHeight: phone ? undefined : `calc(100vh - ${layout.topbar + 220}px)`,
                    overflowY: phone ? undefined : "auto",
                  }}
                >
                  <article style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.sm, padding: phone ? space[4] : space[8], minHeight: phone ? undefined : 420 }}>
                    <div style={{ border: `1px dashed ${v.borderControl}`, borderRadius: radius.sm, padding: space[3], textAlign: "center", color: v.textSecondary, fontSize: fs.sm, marginBottom: space[6] }}>
                      Letterhead — logo, company name and address
                    </div>
                    <LetterEditor value={preview} readOnly bare />
                  </article>
                </div>
              </Panel>
            </div>
          </Col>
        </Row>

        <Row gutter={[space[6], space[6]]}>
          <Col xs={24} xl={14}>
            <Panel
              title="Fields HR types in when issuing"
              subtitle="Values that aren't on the employee's record, like an amount or a date"
              extra={
                <Button icon={<PlusOutlined />} onClick={() => setFields([...fields, { key: "", label: "", type: "text", required: false }])}>
                  Add field
                </Button>
              }
            >
              {fields.length === 0 ? (
                <EmptyState compact illustration={false} title="No typed fields" description="None — every value comes from the employee's record." />
              ) : (
                <Stack gap={space[3]}>
                  {fields.map((f, i) => (
                    <div
                      key={i}
                      style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center", padding: space[3], border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, background: v.bgSubtle }}
                    >
                      <Input aria-label="Field label" style={{ flex: "2 1 180px", minWidth: 0 }} placeholder="Label, e.g. Annual CTC" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
                      <Input
                        aria-label="Field key"
                        style={{ flex: "1 1 140px", minWidth: 0 }}
                        placeholder="Key, e.g. ctcAnnual"
                        value={f.key}
                        onChange={(e) => setField(i, { key: e.target.value.replace(/[^a-zA-Z0-9]/g, "") })}
                      />
                      <Select
                        aria-label="Field type"
                        style={{ flex: "1 1 140px", minWidth: 0 }}
                        value={f.type}
                        onChange={(type) => setField(i, { type })}
                        options={LETTER_EXTRA_FIELD_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
                      />
                      <label style={{ display: "inline-flex", alignItems: "center", gap: space[2], color: v.textBody, fontWeight: fw.medium, cursor: "pointer" }}>
                        <Switch size="small" checked={f.required} onChange={(required) => setField(i, { required })} /> Required
                      </label>
                      <Tooltip title="Remove field">
                        <Button type="text" danger icon={<DeleteOutlined />} aria-label="Remove field" onClick={() => setFields(fields.filter((_, j) => j !== i))} />
                      </Tooltip>
                    </div>
                  ))}
                </Stack>
              )}
            </Panel>
          </Col>
          <Col xs={24} xl={10}>
            <Stack>
              <Panel title="Template settings">
                <Form form={settingsForm} layout="vertical" requiredMark={false} onFinish={(vals) => saveSettings.mutate(vals)}>
                  <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="description" label="Description">
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
                  </Form.Item>
                  <Form.Item name="visibleToEmployeeDefault" label="Visible to the employee by default" valuePropName="checked" extra="HR can still untick it on any single letter.">
                    <Switch />
                  </Form.Item>
                  <Button htmlType="submit" loading={saveSettings.isPending}>
                    Save settings
                  </Button>
                </Form>
              </Panel>
              <Panel title="Version history" subtitle="Versions never change; restore one to edit on top of it">
                <Timeline
                  items={template.versions.map((ver) => ({
                    key: ver.id,
                    tone: ver.version === current?.version ? "accent" : "neutral",
                    content: (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                        <strong style={{ color: v.textPrimary }}>v{ver.version}</strong>
                        {ver.version === current?.version && <StatusChip tone="success">Current</StatusChip>}
                        <Button size="small" type="link" onClick={() => setViewing(ver)} style={{ paddingInline: 0 }}>
                          View
                        </Button>
                      </span>
                    ),
                    time: formatDateTime(ver.createdAt),
                  }))}
                />
              </Panel>
            </Stack>
          </Col>
        </Row>
      </Stack>

      <SideDrawer
        open={viewing !== null}
        onClose={() => setViewing(null)}
        size="wide"
        title={viewing ? `${template.name} — version ${viewing.version}` : ""}
        subtitle={viewing ? `Saved ${formatDateTime(viewing.createdAt)}. Read-only — versions never change.` : undefined}
        cancelLabel="Close"
        footer={viewing && viewing.version === current?.version ? null : undefined}
        primaryLabel="Restore into editor"
        onPrimary={() => {
          if (!viewing) return;
          if (current) setDraft({ baseId: current.id, body: viewing.bodyHtml, fields: viewing.extraFields });
          toast.info(`Version ${viewing.version} loaded into the editor — save it to make it current.`);
          setViewing(null);
        }}
      >
        {viewing && <LetterEditor value={viewing.bodyHtml} readOnly />}
      </SideDrawer>

      <SideDrawer
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview with an employee"
        subtitle="Nothing is stored or sent to the employee."
        formId={PREVIEW_FORM_ID}
        primaryLabel="Render PDF"
        primaryLoading={renderPdf.isPending}
      >
        {dirty && <ApprovalBanner tone="info" title="Previewing your unsaved changes." style={{ marginBottom: space[4] }} />}
        <Form id={PREVIEW_FORM_ID} form={previewForm} layout="vertical" requiredMark onFinish={(vals) => renderPdf.mutate(vals)}>
          <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: "Pick an employee." }]}>
            <EmployeePicker />
          </Form.Item>
          <ExtraFieldInputs fields={fields.filter((f) => f.key)} />
        </Form>
      </SideDrawer>
    </>
  );
}
