import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Col, Dropdown, Form, Input, InputNumber, Row, Select, Switch, Tooltip } from "antd";
import {
  ApartmentOutlined,
  BankOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  IdcardOutlined,
  MoreOutlined,
  PlusOutlined,
  RiseOutlined,
  SwapOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as orgApi from "../../../api/org";
import type { City, Location, SimpleMaster } from "../../../api/org";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { RowActionButton } from "../../../components/leave/RowActionButton";
import { useAuth } from "../../../hooks/useAuth";
import { ApprovalBanner, CardGrid, ConfirmModal, DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, QueryState, SideDrawer, Skel, SkeletonCard, StatusChip, toast, useIsPhone } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { SectionNav, SettingsLayout, ToggleRow } from "../settings/SettingsNav";

// Reference data barely changes; don't refetch it on every visit.
const REF_STALE = 30_000;

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  const phone = useIsPhone();
  return (
    <Button type="primary" icon={<PlusOutlined />} onClick={onClick} block={phone}>
      {label}
    </Button>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end", flexWrap: "wrap" }}>{children}</div>;
}

// ── Cities ───────────────────────────────────────────────────────────────

function CitiesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: cities = [], isLoading, error, refetch } = useQuery({ queryKey: ["org", "cities"], queryFn: orgApi.listCities, staleTime: REF_STALE });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<City | null>(null);
  const [deleting, setDeleting] = useState<City | null>(null);
  const [form] = Form.useForm();

  const saveMutation = useMutation({
    mutationFn: (values: { name: string; state: string }) => (editing ? orgApi.updateCity(editing.id, values) : orgApi.createCity(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "cities"] });
      setModalOpen(false);
      toast.success(editing ? "City updated." : "City created.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save city.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => orgApi.deleteCity(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "cities"] });
      setDeleting(null);
      toast.success("City deleted.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not delete city.")),
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }
  function openEdit(city: City) {
    setEditing(city);
    form.setFieldsValue(city);
    setModalOpen(true);
  }

  return (
    <Panel title="Cities" subtitle="Groups branches by city." extra={canManage && <AddButton label="Add City" onClick={openCreate} />}>
      <DataTable<City>
        rowKey="id"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={cities}
        pagination={false}
        empty={<EmptyState compact title="No cities yet" description={canManage ? "Add a city to group branches." : null} />}
        columns={[
          { title: "Name", dataIndex: "name", render: (val: string) => <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{val}</span> },
          { title: "State", dataIndex: "state" },
          { title: "Branches", dataIndex: ["_count", "locations"], align: "right", render: (val: number) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{val ?? 0}</span> },
          ...(canManage
            ? [
                {
                  title: "",
                  key: "actions",
                  width: 96,
                  render: (_: unknown, record: City) => (
                    <RowActions>
                      <RowActionButton kind="edit" label={`Edit ${record.name}`} onClick={() => openEdit(record)} />
                      <RowActionButton kind="delete" label={`Delete ${record.name}`} onClick={() => setDeleting(record)} />
                    </RowActions>
                  ),
                },
              ]
            : []),
        ]}
      />
      <SideDrawer title={editing ? "Edit City" : "Add City"} open={modalOpen} onClose={() => setModalOpen(false)} formId="org-city-form" primaryLabel="Save" primaryLoading={saveMutation.isPending}>
        <Form id="org-city-form" form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <Form.Item name="name" label="City name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="state" label="State" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal
        open={deleting !== null}
        danger
        title="Delete this city?"
        description={deleting ? `${deleting.name}, ${deleting.state}` : undefined}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </Panel>
  );
}

// ── Locations (branches) ─────────────────────────────────────────────────

function BranchCard({
  location,
  canManage,
  toggling,
  onEdit,
  onMerge,
  onDelete,
  onToggle,
}: {
  location: Location;
  canManage: boolean;
  toggling: boolean;
  onEdit: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const switchId = `branch-active-${location.id}`;
  return (
    <article style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5], background: v.bgSurface, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space[3] }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: fs.xl, fontWeight: fw.semibold, color: v.textPrimary }}>{location.name}</h3>
            <StatusChip tone="info">{location.code}</StatusChip>
            {!location.hasBiometricDevice && <StatusChip tone="purple">No biometric</StatusChip>}
          </div>
          <div style={{ color: v.textSecondary, fontSize: fs.md, marginTop: space[1] }}>{[location.cityMaster?.name ?? location.city, location.state].filter(Boolean).join(", ")}</div>
        </div>
        {canManage && (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "edit", icon: <EditOutlined />, label: "Edit", onClick: onEdit },
                { key: "merge", icon: <SwapOutlined />, label: "Merge into another branch", onClick: onMerge },
                { type: "divider" },
                { key: "delete", icon: <DeleteOutlined />, label: "Delete", danger: true, onClick: onDelete },
              ],
            }}
          >
            <Tooltip title="Branch actions">
              <Button type="text" aria-label={`Actions for ${location.name}`} icon={<MoreOutlined />} />
            </Tooltip>
          </Dropdown>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[3], padding: `${space[3]}px 0`, margin: `${space[3]}px 0 ${space[4]}px`, borderBottom: `1px solid ${v.borderDefault}` }}>
        <StatusChip status={location.isActive ? "ACTIVE" : "INACTIVE"}>{location.isActive ? "Active" : "Inactive"}</StatusChip>
        {canManage && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
            <label htmlFor={switchId} style={{ fontSize: fs.sm, color: v.textSecondary }}>
              {location.isActive ? "Deactivate" : "Activate"}
            </label>
            <Switch id={switchId} checked={location.isActive} loading={toggling} onChange={onToggle} />
          </span>
        )}
      </div>
      <KeyValueGrid
        columns={1}
        items={[
          { label: "Employees", value: <span style={{ fontVariantNumeric: "tabular-nums" }}>{location._count?.jobHistory ?? 0}</span> },
          { label: "Address", value: [location.addressLine1, location.addressLine2, `${location.city} ${location.pincode}`].filter(Boolean).join(", ") },
          { label: "Biometric machine", value: location.hasBiometricDevice ? "Yes" : "No — marked manually" },
        ]}
      />
    </article>
  );
}

function LocationsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading, error, refetch } = useQuery({ queryKey: ["org", "locations", "all"], queryFn: () => orgApi.listLocations(true), staleTime: REF_STALE });
  const { data: cities = [] } = useQuery({ queryKey: ["org", "cities"], queryFn: orgApi.listCities, staleTime: REF_STALE });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState<Location | null>(null);
  const [mergeSource, setMergeSource] = useState<Location | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | undefined>();
  const [form] = Form.useForm();

  const saveMutation = useMutation({
    mutationFn: (values: orgApi.LocationInput) => (editing ? orgApi.updateLocation(editing.id, values) : orgApi.createLocation(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "locations"] });
      setModalOpen(false);
      toast.success(editing ? "Branch updated." : "Branch created.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save branch.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => orgApi.deleteLocation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "locations"] });
      setDeleting(null);
      toast.success("Branch deleted.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not delete branch.")),
  });
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => orgApi.updateLocation(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["org", "locations"] }),
    onError: (err) => toast.error(errorMessage(err, "Could not update branch status.")),
  });
  const mergeMutation = useMutation({
    mutationFn: () => orgApi.mergeLocations(mergeSource!.id, mergeTargetId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "locations"] });
      setMergeSource(null);
      toast.success("Branches merged.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not merge branches.")),
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }
  function openEdit(location: Location) {
    setEditing(location);
    form.setFieldsValue(location);
    setModalOpen(true);
  }

  return (
    <Panel title="Branches" subtitle={`${locations.length} branch${locations.length === 1 ? "" : "es"}, active and inactive`} extra={canManage && <AddButton label="Add Branch" onClick={openCreate} />}>
      <div style={{ marginBottom: space[5] }}>
        <HelpStrip storageKey="org-locations-help">
          Branches are a growing, HR-managed list — create, edit, deactivate (never delete a branch with history), or merge two
          near-duplicate entries into one.
        </HelpStrip>
      </div>
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isEmpty={locations.length === 0}
        empty={<EmptyState compact title="No branches yet" description={canManage ? "Add the first branch." : null} />}
        skeleton={
          <CardGrid min={320}>
            <SkeletonCard lines={4} height={240} />
            <SkeletonCard lines={4} height={240} />
          </CardGrid>
        }
      >
        <CardGrid min={320}>
          {locations.map((l) => (
            <BranchCard
              key={l.id}
              location={l}
              canManage={canManage}
              toggling={toggleActiveMutation.isPending && toggleActiveMutation.variables?.id === l.id}
              onEdit={() => openEdit(l)}
              onMerge={() => {
                setMergeTargetId(undefined);
                setMergeSource(l);
              }}
              onDelete={() => setDeleting(l)}
              onToggle={(checked) => toggleActiveMutation.mutate({ id: l.id, isActive: checked })}
            />
          ))}
        </CardGrid>
      </QueryState>

      <SideDrawer title={editing ? "Edit Branch" : "Add Branch"} open={modalOpen} onClose={() => setModalOpen(false)} formId="org-branch-form" primaryLabel="Save" primaryLoading={saveMutation.isPending} size="wide">
        <Form id="org-branch-form" form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)} requiredMark={false} initialValues={{ hasBiometricDevice: true }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={10}>
              <Form.Item name="code" label="Branch code" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={14}>
              <Form.Item name="name" label="Branch name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="cityId" label="City (grouping)">
            <Select allowClear placeholder="No city assigned" options={cities.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="addressLine1" label="Address line 1" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="addressLine2" label="Address line 2">
            <Input />
          </Form.Item>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={8}>
              <Form.Item name="city" label="Postal city" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="state" label="State" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="pincode" label="Pincode" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <ToggleRow
            htmlFor="branch-has-biometric"
            title="Has a biometric machine"
            description="Off for a branch whose attendance is marked by hand. It sets Add Employee's default attendance capture for this branch; what decides each person's capture is whether they have a Device User ID."
            control={
              <Form.Item name="hasBiometricDevice" valuePropName="checked" noStyle>
                <Switch id="branch-has-biometric" />
              </Form.Item>
            }
          />
        </Form>
      </SideDrawer>

      <ConfirmModal
        open={mergeSource !== null}
        title={`Merge "${mergeSource?.name}" into…`}
        confirmLabel="Merge"
        danger
        loading={mergeMutation.isPending}
        confirmDisabled={!mergeTargetId}
        onCancel={() => setMergeSource(null)}
        onConfirm={() => mergeMutation.mutate()}
      >
        <ApprovalBanner
          tone="warning"
          title="This moves every employee currently on this branch to the target branch, then permanently deletes this one. This cannot be undone."
          style={{ marginBottom: space[4] }}
        />
        <Select
          style={{ width: "100%" }}
          placeholder="Select the branch to keep"
          aria-label="Branch to keep"
          value={mergeTargetId}
          onChange={setMergeTargetId}
          showSearch
          optionFilterProp="label"
          options={locations.filter((l) => l.id !== mergeSource?.id).map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
        />
      </ConfirmModal>

      <ConfirmModal
        open={deleting !== null}
        danger
        title="Delete this branch?"
        description="Blocked if it has employee history — deactivate it instead."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </Panel>
  );
}

// ── Departments / Designations / Grades / Cost Centres ─────────────────

interface SimpleMasterApi {
  list: () => Promise<SimpleMaster[]>;
  create: (input: { code: string; name: string; rank?: number }) => Promise<SimpleMaster>;
  update: (id: string, input: Partial<{ code: string; name: string; rank: number }>) => Promise<SimpleMaster>;
  remove: (id: string) => Promise<void>;
}

function SimpleMasterTab({ queryKey, api, canManage, hasRank, title, singular }: { queryKey: string; api: SimpleMasterApi; canManage: boolean; hasRank?: boolean; title: string; singular: string }) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading, error, refetch } = useQuery({ queryKey: ["org", queryKey], queryFn: api.list, staleTime: REF_STALE });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SimpleMaster | null>(null);
  const [deleting, setDeleting] = useState<SimpleMaster | null>(null);
  const [form] = Form.useForm();

  const saveMutation = useMutation({
    mutationFn: (values: { code: string; name: string; rank?: number }) => (editing ? api.update(editing.id, values) : api.create(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", queryKey] });
      setModalOpen(false);
      toast.success(editing ? "Updated." : "Created.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", queryKey] });
      setDeleting(null);
      toast.success("Deleted.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not delete — likely still in use.")),
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }
  function openEdit(item: SimpleMaster) {
    setEditing(item);
    form.setFieldsValue(item);
    setModalOpen(true);
  }

  return (
    <Panel title={title} subtitle={isLoading ? undefined : `${items.length} ${items.length === 1 ? singular.toLowerCase() : title.toLowerCase()}`} extra={canManage && <AddButton label={`Add ${singular}`} onClick={openCreate} />}>
      <DataTable<SimpleMaster>
        rowKey="id"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={items}
        pagination={false}
        empty={<EmptyState compact title={`No ${title.toLowerCase()} yet`} description={canManage ? `Add the first ${singular.toLowerCase()}.` : null} />}
        mobile={{
          title: (r) => r.name,
          subtitle: (r) => r.code,
          fields: hasRank ? [{ label: "Rank", render: (r) => r.rank ?? "—" }] : undefined,
          actions: canManage
            ? (r) => (
                <>
                  <RowActionButton kind="edit" label={`Edit ${r.name}`} onClick={() => openEdit(r)} />
                  <RowActionButton kind="delete" label={`Delete ${r.name}`} onClick={() => setDeleting(r)} />
                </>
              )
            : undefined,
        }}
        columns={[
          { title: "Code", dataIndex: "code", width: 160, render: (val: string) => <StatusChip tone="neutral">{val}</StatusChip> },
          { title: "Name", dataIndex: "name", render: (val: string) => <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{val}</span> },
          ...(hasRank ? [{ title: "Rank", dataIndex: "rank", align: "right" as const, render: (val: number | null) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{val ?? "—"}</span> }] : []),
          ...(canManage
            ? [
                {
                  title: "",
                  key: "actions",
                  width: 96,
                  render: (_: unknown, record: SimpleMaster) => (
                    <RowActions>
                      <RowActionButton kind="edit" label={`Edit ${record.name}`} onClick={() => openEdit(record)} />
                      <RowActionButton kind="delete" label={`Delete ${record.name}`} onClick={() => setDeleting(record)} />
                    </RowActions>
                  ),
                },
              ]
            : []),
        ]}
      />
      <SideDrawer title={editing ? `Edit ${singular}` : `Add ${singular}`} open={modalOpen} onClose={() => setModalOpen(false)} formId={`org-${queryKey}-form`} primaryLabel="Save" primaryLoading={saveMutation.isPending}>
        <Form id={`org-${queryKey}-form`} form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <Form.Item name="code" label="Code" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {hasRank && (
            <Form.Item name="rank" label="Rank (display order)">
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
          )}
        </Form>
      </SideDrawer>
      <ConfirmModal
        open={deleting !== null}
        danger
        title={`Delete ${deleting?.name ?? ""}?`}
        description="Blocked if still in use."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </Panel>
  );
}

export function OrganisationSetupPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("org.manage");
  const [params, setParams] = useSearchParams();

  const sections = [
    { key: "cities", label: "Cities", icon: <EnvironmentOutlined />, render: () => <CitiesTab canManage={canManage} /> },
    { key: "locations", label: "Branches", icon: <BankOutlined />, render: () => <LocationsTab canManage={canManage} /> },
    { key: "departments", label: "Departments", icon: <ApartmentOutlined />, render: () => <SimpleMasterTab title="Departments" singular="Department" queryKey="departments" api={orgApi.departments} canManage={canManage} /> },
    { key: "designations", label: "Designations", icon: <IdcardOutlined />, render: () => <SimpleMasterTab title="Designations" singular="Designation" queryKey="designations" api={orgApi.designations} canManage={canManage} /> },
    { key: "grades", label: "Grades", icon: <RiseOutlined />, render: () => <SimpleMasterTab title="Grades" singular="Grade" queryKey="grades" api={orgApi.grades} canManage={canManage} hasRank /> },
    { key: "cost-centres", label: "Cost Centres", icon: <WalletOutlined />, render: () => <SimpleMasterTab title="Cost Centres" singular="Cost Centre" queryKey="cost-centres" api={orgApi.costCentres} canManage={canManage} /> },
  ];
  const active = sections.find((s) => s.key === params.get("tab")) ?? sections[0]!;

  return (
    <>
      <PageHeader title="Organisation Setup" subtitle="Cities, branches, departments, designations, grades and cost centres." />
      <SettingsLayout
        nav={
          <SectionNav
            label="Organisation sections"
            items={sections}
            active={active.key}
            onChange={(key) => {
              const next = new URLSearchParams(params);
              next.set("tab", key);
              setParams(next, { replace: true });
            }}
          />
        }
      >
        <div key={active.key}>{active.render()}</div>
      </SettingsLayout>
    </>
  );
}

// Loading placeholder for lazy routes that render this page (kept tiny; the sections bring their own skeletons).
export function OrganisationSetupSkeleton() {
  return <Skel h={320} r={radius.lg} />;
}
