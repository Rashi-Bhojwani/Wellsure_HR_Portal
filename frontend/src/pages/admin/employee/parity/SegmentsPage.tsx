import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Select, Space } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import * as employeeApi from "../../../../api/employee";
import * as parityApi from "../../../../api/parity";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, SideDrawer, StatusChip, toast, useDebouncedValue, useIsPhone } from "../../../../ui";
import { fs, space, v } from "../../../../theme/tokens";

// A-9 G1 (item 7): saved employee filters and named groups (segments). A filter keeps the All Employees criteria; a named group keeps chosen people. Either may be
// shared with the other admins. Whatever is shared, each person sees only the people inside their own data scope — the count and the list are theirs.

function describeCriteria(c: parityApi.SegmentCriteria | null): string {
  if (!c) return "";
  const parts = [c.search && `matching "${c.search}"`, c.population === "current" ? "current staff" : c.population === "past" ? "former staff" : null, c.status && c.status.toLowerCase(), c.employmentType && c.employmentType.toLowerCase()].filter(Boolean);
  if (c.departmentId || c.locationId || c.designationId || c.cityId) parts.push("filtered by place or job");
  return parts.length ? parts.join(", ") : "everyone you can see";
}

function MembersDrawer({ segment, onClose }: { segment: parityApi.Segment; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const members = useQuery({ queryKey: ["segments", segment.id, "members", page], queryFn: () => parityApi.segmentMembers(segment.id, page, 25) });
  return (
    <SideDrawer open title={segment.name} onClose={onClose} size="wide" footer={null}>
      <p style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: 0 }}>Only the people you can see are listed. Someone else may see a different list from the same segment.</p>
      <DataTable<parityApi.SegmentMember>
        rowKey="id"
        loading={members.isLoading}
        error={members.error}
        onRetry={() => void members.refetch()}
        dataSource={members.data?.rows ?? []}
        columns={[
          { title: "Code", dataIndex: "employeeCode", key: "code" },
          { title: "Name", dataIndex: "fullName", key: "name" },
          { title: "Department", dataIndex: "department", key: "dept" },
          { title: "Status", dataIndex: "status", key: "status", render: (s: string) => <StatusChip status={s} /> },
        ]}
        pagination={{ current: page, pageSize: 25, total: members.data?.total ?? 0, onChange: setPage }}
        mobile={{ title: (r) => r.fullName, subtitle: (r) => r.employeeCode, status: (r) => <StatusChip status={r.status} />, fields: [{ label: "Department", render: (r) => r.department }] }}
      />
    </SideDrawer>
  );
}

function PeoplePicker({ value = [], onChange = () => undefined }: { value?: string[]; onChange?: (ids: string[]) => void }) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 250);
  const found = useQuery({ queryKey: ["segments", "people", q], queryFn: () => employeeApi.listEmployees({ search: q || undefined, page: 1, pageSize: 20, sortBy: "employeeCode", sortDir: "asc" }), enabled: q.trim().length >= 2 });
  const [labels, setLabels] = useState<Record<string, string>>({});
  const options = (found.data?.rows ?? []).map((r) => ({ value: r.id, label: `${r.fullName} (${r.employeeCode})` }));
  return (
    <Select
      mode="multiple"
      aria-label="People"
      placeholder="Type at least two letters of a name or code"
      showSearch={{ filterOption: false, onSearch: setSearch }}
      value={value}
      onChange={(ids: string[]) => {
        setLabels((prev) => ({ ...prev, ...Object.fromEntries(options.map((o) => [o.value, o.label])) }));
        onChange(ids);
      }}
      options={[...options, ...value.filter((id) => !options.some((o) => o.value === id)).map((id) => ({ value: id, label: labels[id] ?? id }))]}
      loading={found.isFetching}
      notFoundContent={q.trim().length >= 2 ? "Nobody found" : "Type to search"}
      style={{ width: "100%" }}
    />
  );
}

function GroupDrawer({ open, segment, onClose }: { open: boolean; segment: parityApi.Segment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ name: string; shared: boolean; employeeIds: string[] }>();
  const save = useMutation({
    mutationFn: (values: { name: string; shared: boolean; employeeIds?: string[] }) =>
      segment ? parityApi.updateSegment(segment.id, { name: values.name, shared: values.shared, ...(values.employeeIds?.length ? { employeeIds: values.employeeIds } : {}) }) : parityApi.createSegment({ kind: "LIST", name: values.name, shared: values.shared, employeeIds: values.employeeIds ?? [] }),
    onSuccess: () => {
      toast.success(segment ? "Saved." : "Group saved.");
      void queryClient.invalidateQueries({ queryKey: ["segments"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save it.")),
  });
  return (
    <SideDrawer
      open={open}
      title={segment ? `Edit "${segment.name}"` : "New named group"}
      onClose={onClose}
      primaryLabel="Save"
      onPrimary={() => form.submit()}
      primaryLoading={save.isPending}
    >
      <Form form={form} layout="vertical" initialValues={{ name: segment?.name ?? "", shared: segment?.shared ?? false, employeeIds: [] }} onFinish={(v2) => save.mutate(v2)} preserve={false}>
        <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: "Give it a name." }]}>
          <Input maxLength={100} />
        </Form.Item>
        {(!segment || segment.kind === "LIST") && (
          <Form.Item name="employeeIds" label={segment ? "Replace the people with (leave empty to keep them)" : "People"} rules={segment ? [] : [{ required: true, type: "array", min: 1, message: "Choose at least one person." }]}>
            <PeoplePicker />
          </Form.Item>
        )}
        <Form.Item name="shared" valuePropName="checked">
          <Checkbox>Share with other admins (each of them sees only the people in their own scope)</Checkbox>
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

export function SegmentsPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const segments = useQuery({ queryKey: ["segments"], queryFn: parityApi.listSegments });
  const [viewing, setViewing] = useState<parityApi.Segment | null>(null);
  const [editing, setEditing] = useState<parityApi.Segment | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<parityApi.Segment | null>(null);
  const archive = useMutation({
    mutationFn: (id: string) => parityApi.archiveSegment(id),
    onSuccess: () => {
      toast.success("Archived.");
      setArchiving(null);
      void queryClient.invalidateQueries({ queryKey: ["segments"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Could not archive it.")),
  });

  return (
    <>
      <PageHeader
        title="Filters & Segments"
        subtitle="Saved employee filters and named groups, for lists, letters and messages"
        actions={
          <Button size="large" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)} style={phone ? { flex: 1 } : undefined}>
            New named group
          </Button>
        }
      />
      <Panel>
        <p style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: 0, marginBottom: space[3] }}>To save a filter, set it up on All Employees and choose "Save as segment".</p>
        <DataTable<parityApi.Segment>
          rowKey="id"
          loading={segments.isLoading}
          error={segments.error}
          onRetry={() => void segments.refetch()}
          dataSource={segments.data ?? []}
          empty={<EmptyState compact title="No saved filters or groups yet." description="Save one from All Employees, or make a named group here." />}
          onRowOpen={setViewing}
          columns={[
            { title: "Name", dataIndex: "name", key: "name" },
            { title: "Kind", dataIndex: "kind", key: "kind", render: (k: string, r) => (k === "FILTER" ? `Filter: ${describeCriteria(r.criteria)}` : "Named group") },
            { title: "People you can see", dataIndex: "count", key: "count", align: "right" as const },
            { title: "Shared", dataIndex: "shared", key: "shared", render: (s: boolean) => (s ? <StatusChip tone="info">Shared</StatusChip> : <StatusChip tone="neutral">Only me</StatusChip>) },
            { title: "Saved by", dataIndex: "ownerName", key: "owner" },
            {
              title: "",
              key: "actions",
              render: (_: unknown, r) => (
                <Space onClick={(e) => e.stopPropagation()}>
                  <Button icon={<TeamOutlined />} aria-label={`See who is in ${r.name}`} onClick={() => setViewing(r)} />
                  {r.isOwner && <Button icon={<EditOutlined />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)} />}
                  {r.isOwner && <Button icon={<DeleteOutlined />} danger aria-label={`Archive ${r.name}`} onClick={() => setArchiving(r)} />}
                </Space>
              ),
            },
          ]}
          mobile={{
            title: (r) => r.name,
            subtitle: (r) => (r.kind === "FILTER" ? "Filter" : "Named group"),
            status: (r) => (r.shared ? <StatusChip tone="info">Shared</StatusChip> : null),
            fields: [
              { label: "People you can see", render: (r) => r.count },
              { label: "Saved by", render: (r) => r.ownerName },
            ],
            actions: (r) => (
              <Space>
                <Button onClick={() => setViewing(r)}>People</Button>
                {r.isOwner && <Button onClick={() => setEditing(r)}>Edit</Button>}
                {r.isOwner && (
                  <Button danger onClick={() => setArchiving(r)}>
                    Archive
                  </Button>
                )}
              </Space>
            ),
          }}
        />
      </Panel>
      {viewing && <MembersDrawer segment={viewing} onClose={() => setViewing(null)} />}
      {(creating || editing) && <GroupDrawer open segment={editing} onClose={() => (setCreating(false), setEditing(null))} />}
      <ConfirmModal
        open={!!archiving}
        title={`Archive "${archiving?.name ?? ""}"?`}
        description="It disappears for you and for everyone it was shared with. It is kept in the records, not deleted."
        confirmLabel="Archive"
        danger
        loading={archive.isPending}
        onCancel={() => setArchiving(null)}
        onConfirm={() => archiving && archive.mutate(archiving.id)}
      />
    </>
  );
}
