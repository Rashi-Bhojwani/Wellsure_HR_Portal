import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Flex, Form, Input, Modal, Result, Row, Select, Space, Switch, Tag, Typography, message } from "antd";
import { ArrowLeftOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { LETTER_EXTRA_FIELD_TYPES, type LetterExtraField } from "@shared/constants/letters";
import * as lettersApi from "../../../api/letters";
import type { LetterTemplateVersion } from "../../../api/letters";
import { EmptyState } from "../../../components/common/EmptyState";
import { LetterEditor } from "../../../components/letters/LetterEditor";
import { EmployeePicker, ExtraFieldInputs } from "../../../components/letters/LetterFields";
import { placeholderOptions, stringifyExtras } from "../../../components/letters/letterUtils";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs } from "../../../theme/tokens";

const { Title, Text } = Typography;
const TYPE_LABELS: Record<string, string> = { text: "Text", number: "Number", currency: "Amount (₹)", date: "Date" };

// One letter template: its wording (TipTap), the fields HR types in when
// issuing it, a preview against a real employee, and its version history.
// Saving never edits a version — it adds one.
export function LetterTemplateEditorPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { data: template, isLoading, isError } = useQuery({ queryKey: ["letters", "template", id], queryFn: () => lettersApi.getTemplate(id), retry: false });
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
  const dirty = Boolean(current) && (body !== current!.bodyHtml || JSON.stringify(fields) !== JSON.stringify(current!.extraFields));

  const applied = (t: lettersApi.LetterTemplateDetail) => {
    queryClient.setQueryData(["letters", "template", id], t);
    void queryClient.invalidateQueries({ queryKey: ["letters", "templates"] });
  };
  const save = useMutation({
    mutationFn: () => lettersApi.saveNewVersion(id, { bodyHtml: body, extraFields: fields }),
    onSuccess: (t) => {
      applied(t);
      void message.success(`Saved as version ${t.versions[0]!.version}.`);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't save the template.")),
  });
  const saveSettings = useMutation({
    mutationFn: (v: { name: string; description: string | null; visibleToEmployeeDefault: boolean }) => lettersApi.updateTemplate(id, v),
    onSuccess: (t) => {
      applied(t);
      void message.success("Template settings saved.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't save the settings.")),
  });
  const preview = useMutation({
    mutationFn: (v: { employeeId: string; extraValues?: Record<string, unknown> }) =>
      lettersApi.previewTemplate({ templateName: template?.name ?? "Preview", bodyHtml: body, extraFields: fields, employeeId: v.employeeId, extraValues: stringifyExtras(v.extraValues) }),
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
          void message.error(parsed.error?.message ?? "Couldn't render the preview.");
          return;
        } catch {
          /* fall through */
        }
      }
      void message.error(apiErrorMessage(err, "Couldn't render the preview."));
    },
  });

  if (isLoading) return <EmptyState message="Loading…" />;
  if (isError || !template) return <Result status="404" title="Template not found" extra={<Link to="/admin/admin-tools/templates">Back to templates</Link>} />;

  const setField = (i: number, patch: Partial<LetterExtraField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <Flex vertical gap={16}>
      <Link to="/admin/admin-tools/templates">
        <ArrowLeftOutlined /> Email & Letter Templates
      </Link>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            {template.name} {!template.isActive && <Tag>Inactive</Tag>}
          </Title>
          <Text type="secondary">
            {template.code} · current version v{current?.version ?? 0}
          </Text>
        </div>
        <Space>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save as version {(current?.version ?? 0) + 1}
          </Button>
        </Space>
      </Flex>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Flex vertical gap={16}>
            <Card title="Wording">
              <LetterEditor value={body} onChange={setBody} placeholders={placeholders} />
              <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: fs.sm }}>
                The letterhead (company name, address, logo) is added above automatically. Insert values from the placeholder menu; each is filled in as it stands on the day the letter is issued.
              </Text>
            </Card>
            <Card title="Fields HR types in when issuing" extra={<Button size="small" icon={<PlusOutlined />} onClick={() => setFields([...fields, { key: "", label: "", type: "text", required: false }])}>Add field</Button>}>
              {fields.length === 0 ? (
                <Text type="secondary">None — every value comes from the employee's record.</Text>
              ) : (
                <Flex vertical gap={8}>
                  {fields.map((f, i) => (
                    <Flex key={i} gap={8} wrap align="center">
                      <Input style={{ width: 200 }} placeholder="Label, e.g. Annual CTC" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
                      <Input style={{ width: 160 }} placeholder="Key, e.g. ctcAnnual" value={f.key} onChange={(e) => setField(i, { key: e.target.value.replace(/[^a-zA-Z0-9]/g, "") })} />
                      <Select style={{ width: 140 }} value={f.type} onChange={(type) => setField(i, { type })} options={LETTER_EXTRA_FIELD_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} />
                      <Space size={4}>
                        <Switch size="small" checked={f.required} onChange={(required) => setField(i, { required })} /> Required
                      </Space>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Remove field" onClick={() => setFields(fields.filter((_, j) => j !== i))} />
                    </Flex>
                  ))}
                </Flex>
              )}
            </Card>
          </Flex>
        </Col>
        <Col xs={24} xl={8}>
          <Flex vertical gap={16}>
            <Card title="Template settings">
              <Form form={settingsForm} layout="vertical" requiredMark={false} onFinish={(v) => saveSettings.mutate(v)}>
                <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="description" label="Description">
                  <Input.TextArea rows={2} />
                </Form.Item>
                <Form.Item name="visibleToEmployeeDefault" label="Visible to the employee by default" valuePropName="checked" extra="HR can still untick it on any single letter.">
                  <Switch />
                </Form.Item>
                <Button htmlType="submit" loading={saveSettings.isPending}>
                  Save settings
                </Button>
              </Form>
            </Card>
            <Card title="Version history">
              <Flex vertical gap={6}>
                {template.versions.map((v) => (
                  <Flex key={v.id} justify="space-between" align="center">
                    <span>
                      <Text strong>v{v.version}</Text> <Text type="secondary">{formatDateTime(v.createdAt)}</Text>
                      {v.version === current?.version && <Tag style={{ marginLeft: 6 }}>Current</Tag>}
                    </span>
                    <Button size="small" type="link" onClick={() => setViewing(v)}>
                      View
                    </Button>
                  </Flex>
                ))}
              </Flex>
            </Card>
          </Flex>
        </Col>
      </Row>

      <Modal
        title={viewing ? `${template.name} — version ${viewing.version}` : ""}
        open={viewing !== null}
        width={760}
        onCancel={() => setViewing(null)}
        footer={[
          <Button key="close" onClick={() => setViewing(null)}>
            Close
          </Button>,
          viewing && viewing.version !== current?.version ? (
            <Button
              key="restore"
              type="primary"
              onClick={() => {
                if (current) setDraft({ baseId: current.id, body: viewing.bodyHtml, fields: viewing.extraFields });
                setViewing(null);
                void message.info(`Version ${viewing.version} loaded into the editor — save it to make it current.`);
              }}
            >
              Restore into editor
            </Button>
          ) : null,
        ]}
      >
        {viewing && (
          <>
            <Text type="secondary">Saved {formatDateTime(viewing.createdAt)}. Read-only — versions never change.</Text>
            <div style={{ marginTop: 12 }}>
              <LetterEditor value={viewing.bodyHtml} readOnly />
            </div>
          </>
        )}
      </Modal>

      <Modal title="Preview with an employee" open={previewOpen} onCancel={() => setPreviewOpen(false)} onOk={() => previewForm.submit()} okText="Render PDF" confirmLoading={preview.isPending} destroyOnHidden>
        {dirty && <Alert type="info" showIcon title="Previewing your unsaved changes." style={{ marginBottom: 12 }} />}
        <Form form={previewForm} layout="vertical" requiredMark={false} onFinish={(v) => preview.mutate(v)}>
          <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: "Pick an employee." }]}>
            <EmployeePicker />
          </Form.Item>
          <ExtraFieldInputs fields={fields.filter((f) => f.key)} />
        </Form>
        <Text type="secondary" style={{ fontSize: fs.sm }}>
          Nothing is stored or sent to the employee.
        </Text>
      </Modal>
    </Flex>
  );
}
