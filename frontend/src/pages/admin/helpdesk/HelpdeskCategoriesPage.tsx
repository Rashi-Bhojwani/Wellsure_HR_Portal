import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select, Switch } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as helpdeskApi from "../../../api/helpdesk";
import type { HelpdeskCategoryAdmin } from "../../../api/helpdesk";
import { SensitiveChip } from "../../../components/helpdesk/HelpdeskBits";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";

const FORM_ID = "helpdesk-category-form";
type CategoryInput = Parameters<typeof helpdeskApi.updateCategory>[1];

// Admin Tools → Helpdesk Categories. The sensitive flag is per category and
// editable any time (user decision 4): a sensitive category's tickets are
// visible only to holders of helpdesk.sensitive.view (HR_ADMIN by default),
// and flipping it applies to existing tickets immediately. Categories are
// deactivated, never deleted. Every change is audit-logged.
export function HelpdeskCategoriesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ code: string; name: string; isSensitive: boolean; sortOrder?: number; defaultAssigneeEmployeeId?: string }>();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["helpdesk", "categories", "all"], queryFn: helpdeskApi.listAllCategories });
  const { data: assignees = [], isLoading: loadingAssignees } = useQuery({ queryKey: ["helpdesk", "assignees"], queryFn: helpdeskApi.listAssignees });
  const assigneeOptions = assignees.map((a) => ({ value: a.id, label: `${a.name} (${a.employeeCode})` }));

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["helpdesk"] });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CategoryInput }) => helpdeskApi.updateCategory(id, input),
    onSuccess: () => {
      refresh();
      toast.success("Category updated.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't update the category.")),
  });
  const create = useMutation({
    mutationFn: helpdeskApi.createCategory,
    onSuccess: () => {
      refresh();
      setCreating(false);
      form.resetFields();
      toast.success("Category created.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't create the category.")),
  });
  // Only the control being changed shows a spinner.
  const busy = (c: HelpdeskCategoryAdmin, field: keyof CategoryInput) => update.isPending && update.variables?.id === c.id && field in update.variables.input;

  const sensitiveSwitch = (c: HelpdeskCategoryAdmin) => (
    <Switch checked={c.isSensitive} loading={busy(c, "isSensitive")} aria-label={`Sensitive: ${c.name}`} onChange={(isSensitive) => update.mutate({ id: c.id, input: { isSensitive } })} />
  );
  const activeSwitch = (c: HelpdeskCategoryAdmin) => (
    <Switch checked={c.isActive} loading={busy(c, "isActive")} aria-label={`Active: ${c.name}`} onChange={(isActive) => update.mutate({ id: c.id, input: { isActive } })} />
  );
  const assigneeSelect = (c: HelpdeskCategoryAdmin) => (
    <Select
      allowClear
      aria-label={`Default assignee: ${c.name}`}
      style={{ width: "100%", minWidth: 200, maxWidth: 280 }}
      placeholder="Nobody (queue)"
      value={c.defaultAssignee?.id}
      loading={loadingAssignees || busy(c, "defaultAssigneeEmployeeId")}
      options={assigneeOptions}
      onChange={(val) => update.mutate({ id: c.id, input: { defaultAssigneeEmployeeId: val ?? null } })}
    />
  );
  const addButton = (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
      Add category
    </Button>
  );

  return (
    <>
      <PageHeader title="Helpdesk Categories" subtitle="What employees can raise tickets about, and who picks them up" actions={addButton} />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="Sensitive categories"
          description="Tickets in a sensitive category are hidden from HR Executives and visible only to roles with the sensitive-ticket permission (HR Admin by default). Changing the flag applies to existing tickets straight away."
        />
        <Panel title="Categories" subtitle={data.length ? `${data.length} categor${data.length === 1 ? "y" : "ies"} · deactivate instead of deleting` : undefined}>
          <DataTable<HelpdeskCategoryAdmin>
            rowKey="id"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data}
            pagination={false}
            empty={<EmptyState illustration="inbox" title="No categories yet" description="Add the first one so employees can raise tickets." action={addButton} compact />}
            columns={[
              {
                title: "Name",
                dataIndex: "name",
                render: (name: string, c) => (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                      <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{name}</span>
                      {c.isSensitive && <SensitiveChip />}
                      {!c.isActive && <StatusChip status="INACTIVE">Inactive</StatusChip>}
                    </div>
                    <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{c.code}</div>
                  </div>
                ),
              },
              { title: "Sensitive", dataIndex: "isSensitive", render: (_: boolean, c) => sensitiveSwitch(c) },
              { title: "Default assignee", key: "defaultAssignee", render: (_: unknown, c) => assigneeSelect(c) },
              { title: "Tickets", dataIndex: "ticketCount", align: "right", render: (n: number) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span> },
              { title: "Active", dataIndex: "isActive", render: (_: boolean, c) => activeSwitch(c) },
            ]}
            mobile={{
              title: (c) => c.name,
              subtitle: (c) => `${c.code} · ${c.ticketCount} ticket${c.ticketCount === 1 ? "" : "s"}`,
              status: (c) => (c.isActive ? (c.isSensitive ? <SensitiveChip /> : undefined) : <StatusChip status="INACTIVE">Inactive</StatusChip>),
              fields: [
                { label: "Sensitive", render: sensitiveSwitch },
                { label: "Active", render: activeSwitch },
                { label: "Default assignee", render: assigneeSelect },
              ],
            }}
          />
        </Panel>
      </Stack>
      <SideDrawer open={creating} onClose={() => setCreating(false)} title="Add category" formId={FORM_ID} primaryLabel="Create" primaryLoading={create.isPending}>
        <Form id={FORM_ID} form={form} layout="vertical" requiredMark initialValues={{ isSensitive: false }} onFinish={(values) => create.mutate(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true, max: 80 }]}>
            <Input placeholder="e.g. Travel & reimbursements" />
          </Form.Item>
          <Form.Item name="code" label="Code" rules={[{ required: true, pattern: /^[A-Z0-9_]+$/, message: "Capital letters, digits and underscores." }]}>
            <Input placeholder="e.g. TRAVEL" />
          </Form.Item>
          <Form.Item name="isSensitive" label="Sensitive" valuePropName="checked" extra="Only roles with the sensitive-ticket permission will see these tickets.">
            <Switch />
          </Form.Item>
          <Form.Item name="defaultAssigneeEmployeeId" label="Default assignee">
            <Select allowClear placeholder="Nobody (queue)" options={assigneeOptions} loading={loadingAssignees} />
          </Form.Item>
          <Form.Item name="sortOrder" label="Sort order" extra="Lower numbers are listed first.">
            <InputNumber min={0} max={999} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
