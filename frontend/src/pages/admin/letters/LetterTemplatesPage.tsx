import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Segmented, Switch, Tag } from "antd";
import { FileTextOutlined, PlusOutlined } from "@ant-design/icons";
import * as lettersApi from "../../../api/letters";
import type { LetterTemplateSummary } from "../../../api/letters";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, FilterBar, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";

const FORM_ID = "new-letter-template-form";
type Show = "all" | "active" | "inactive";

// Admin Tools → Email & Letter Templates (Phase 5 commit D2). Letters only
// for now; making the system emails editable is its own later commit.
export function LetterTemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [form] = Form.useForm<{ code: string; name: string; description?: string }>();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["letters", "templates"], queryFn: lettersApi.listTemplates });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => lettersApi.updateTemplate(id, { isActive }),
    onSuccess: (_t, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["letters", "templates"] });
      toast.success(vars.isActive ? "Template activated." : "Template deactivated.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't update the template.")),
  });
  const create = useMutation({
    mutationFn: (values: { code: string; name: string; description?: string }) =>
      lettersApi.createTemplate({ ...values, bodyHtml: "<p>Dear {{employee.fullName}},</p><p></p><p>{{signatory.name}}<br>{{signatory.designation}}</p>", extraFields: [] }),
    onSuccess: (t) => {
      void queryClient.invalidateQueries({ queryKey: ["letters", "templates"] });
      setCreating(false);
      form.resetFields();
      navigate(`/admin/admin-tools/templates/${t.id}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't create the template.")),
  });

  const q = search.trim().toLowerCase();
  const rows = data
    .filter((t) => (show === "all" ? true : show === "active" ? t.isActive : !t.isActive))
    .filter((t) => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));

  const activeSwitch = (t: LetterTemplateSummary) => (
    // The row opens the editor; the switch must not.
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Switch
        checked={t.isActive}
        loading={toggle.isPending && toggle.variables?.id === t.id}
        aria-label={`Active: ${t.name}`}
        onChange={(isActive) => toggle.mutate({ id: t.id, isActive })}
      />
    </span>
  );
  const fieldTags = (t: LetterTemplateSummary) =>
    t.extraFields.length ? (
      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: space[1] }}>
        {t.extraFields.map((f) => (
          <Tag key={f.key} style={{ marginInlineEnd: 0 }}>
            {f.label}
          </Tag>
        ))}
      </span>
    ) : (
      "—"
    );
  const newButton = (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
      New letter template
    </Button>
  );

  return (
    <>
      <PageHeader title="Email & Letter Templates" subtitle="The wording HR issues as letters, versioned so issued letters never change" actions={newButton} />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="Letters are legal documents"
          description="Every edit saves a new version; letters already issued keep the exact wording, values and date they were issued with, and are never overwritten. System emails (invitations, password resets) will become editable in a later update."
        />
        <Panel title="Letter templates" subtitle={data.length ? `${data.length} template${data.length === 1 ? "" : "s"}` : undefined}>
          <FilterBar
            onSearch={setSearch}
            searchPlaceholder="Search letters"
            actions={
              <Segmented<Show>
                value={show}
                onChange={setShow}
                aria-label="Show"
                options={[
                  { value: "all", label: "All" },
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ]}
              />
            }
          />
          <DataTable<LetterTemplateSummary>
            rowKey="id"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={rows}
            pagination={false}
            onRowOpen={(t) => navigate(`/admin/admin-tools/templates/${t.id}`)}
            empty={
              q || show !== "all" ? (
                <EmptyState illustration="search" title="No templates match" description="Try another word or show all templates." compact />
              ) : (
                <EmptyState illustration="documents" title="No letter templates yet" description="Create one — an experience letter or salary certificate is a good start." action={newButton} compact />
              )
            }
            columns={[
              {
                title: "Letter",
                dataIndex: "name",
                render: (name: string, t) => (
                  <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
                    <span aria-hidden style={{ width: 40, height: 40, flex: "none", borderRadius: radius.md, background: v.accentSubtle, color: v.accentText, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.lg }}>
                      <FileTextOutlined />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{name}</div>
                      <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{t.description ?? t.code}</div>
                    </div>
                  </div>
                ),
              },
              { title: "Version", dataIndex: "currentVersion", render: (n: number) => <StatusChip tone="info">v{n}</StatusChip> },
              { title: "Typed fields", key: "fields", render: (_: unknown, t) => fieldTags(t) },
              { title: "Employee sees it", dataIndex: "visibleToEmployeeDefault", render: (b: boolean) => (b ? "By default" : "Only if ticked") },
              { title: "Last edited", dataIndex: "lastEditedAt", render: (d: string) => formatDateTime(d) },
              { title: "Active", dataIndex: "isActive", render: (_: boolean, t) => activeSwitch(t) },
            ]}
            mobile={{
              title: (t) => t.name,
              subtitle: (t) => `${t.description ?? t.code} · v${t.currentVersion}`,
              status: (t) => (t.isActive ? undefined : <StatusChip status="INACTIVE">Inactive</StatusChip>),
              fields: [
                { label: "Typed fields", render: fieldTags },
                { label: "Employee sees it", render: (t) => (t.visibleToEmployeeDefault ? "By default" : "Only if ticked") },
                { label: "Last edited", render: (t) => formatDateTime(t.lastEditedAt) },
                { label: "Active", render: activeSwitch },
              ],
            }}
          />
        </Panel>
      </Stack>
      <SideDrawer
        open={creating}
        onClose={() => setCreating(false)}
        title="New letter template"
        subtitle="You'll write the wording in the editor next."
        formId={FORM_ID}
        primaryLabel="Create and edit"
        primaryLoading={create.isPending}
      >
        <Form id={FORM_ID} form={form} layout="vertical" requiredMark onFinish={(vals) => create.mutate(vals)}>
          <Form.Item name="name" label="Name" rules={[{ required: true, max: 120 }]}>
            <Input placeholder="e.g. Salary Certificate" />
          </Form.Item>
          <Form.Item name="code" label="Code" rules={[{ required: true, pattern: /^[A-Z0-9_]+$/, message: "Capital letters, digits and underscores." }]}>
            <Input placeholder="e.g. SALARY_CERTIFICATE" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
