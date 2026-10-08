import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  Popconfirm,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SwapOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as orgApi from "../../../api/org";
import type { City, Location, SimpleMaster } from "../../../api/org";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { useAuth } from "../../../hooks/useAuth";

const { Title } = Typography;

// ── Cities ───────────────────────────────────────────────────────────────

function CitiesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: cities = [], isLoading } = useQuery({ queryKey: ["org", "cities"], queryFn: orgApi.listCities });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<City | null>(null);
  const [form] = Form.useForm();

  const saveMutation = useMutation({
    mutationFn: (values: { name: string; state: string }) =>
      editing ? orgApi.updateCity(editing.id, values) : orgApi.createCity(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "cities"] });
      setModalOpen(false);
      void message.success(editing ? "City updated." : "City created.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save city.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => orgApi.deleteCity(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "cities"] });
      void message.success("City deleted.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not delete city.")),
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
    <Space orientation="vertical" style={{ width: "100%" }} size={12}>
      {canManage && (
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ alignSelf: "flex-end" }}>
          Add City
        </Button>
      )}
      <Table<City>
        rowKey="id"
        loading={isLoading}
        dataSource={cities}
        pagination={false}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "State", dataIndex: "state" },
          { title: "Branches", dataIndex: ["_count", "locations"], render: (v: number) => v ?? 0 },
          ...(canManage
            ? [
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, record: City) => (
                    <Space>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                      <Popconfirm title="Delete this city?" onConfirm={() => deleteMutation.mutate(record.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal title={editing ? "Edit City" : "Add City"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <Form.Item name="name" label="City name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="state" label="State" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              Save
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

// ── Locations (branches) ─────────────────────────────────────────────────

function LocationsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading } = useQuery({ queryKey: ["org", "locations", "all"], queryFn: () => orgApi.listLocations(true) });
  const { data: cities = [] } = useQuery({ queryKey: ["org", "cities"], queryFn: orgApi.listCities });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [mergeSource, setMergeSource] = useState<Location | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | undefined>();
  const [form] = Form.useForm();

  const saveMutation = useMutation({
    mutationFn: (values: orgApi.LocationInput) => (editing ? orgApi.updateLocation(editing.id, values) : orgApi.createLocation(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "locations"] });
      setModalOpen(false);
      void message.success(editing ? "Branch updated." : "Branch created.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save branch.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => orgApi.deleteLocation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "locations"] });
      void message.success("Branch deleted.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not delete branch.")),
  });
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => orgApi.updateLocation(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["org", "locations"] }),
    onError: (err) => void message.error(errorMessage(err, "Could not update branch status.")),
  });
  const mergeMutation = useMutation({
    mutationFn: () => orgApi.mergeLocations(mergeSource!.id, mergeTargetId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", "locations"] });
      setMergeSource(null);
      void message.success("Branches merged.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not merge branches.")),
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
    <Space orientation="vertical" style={{ width: "100%" }} size={12}>
      <HelpStrip storageKey="org-locations-help">
        Branches are a growing, HR-managed list — create, edit, deactivate (never delete a branch with history), or merge two
        near-duplicate entries into one.
      </HelpStrip>
      {canManage && (
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ alignSelf: "flex-end" }}>
          Add Branch
        </Button>
      )}
      <Table<Location>
        rowKey="id"
        loading={isLoading}
        dataSource={locations}
        pagination={false}
        scroll={{ x: "max-content" }}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          { title: "City", dataIndex: ["cityMaster", "name"], render: (v: string | undefined) => v ?? "—" },
          { title: "State", dataIndex: "state" },
          { title: "Biometric machine", dataIndex: "hasBiometricDevice", render: (v: boolean) => (v ? "Yes" : <Tag color="purple">No — marked manually</Tag>) },
          { title: "Status", dataIndex: "isActive", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag> },
          { title: "Employees", dataIndex: ["_count", "jobHistory"], render: (v: number) => v ?? 0 },
          ...(canManage
            ? [
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, record: Location) => (
                    <Space>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                      <Button size="small" icon={<SwapOutlined />} onClick={() => setMergeSource(record)}>
                        Merge
                      </Button>
                      <Switch
                        size="small"
                        checked={record.isActive}
                        onChange={(checked) => toggleActiveMutation.mutate({ id: record.id, isActive: checked })}
                      />
                      <Popconfirm title="Delete this branch? Blocked if it has employee history." onConfirm={() => deleteMutation.mutate(record.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal title={editing ? "Edit Branch" : "Add Branch"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} destroyOnHidden width={560}>
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)} requiredMark={false} initialValues={{ hasBiometricDevice: true }}>
          <Form.Item name="code" label="Branch code" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Branch name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="cityId" label="City (grouping)">
            <Select allowClear placeholder="No city assigned" options={cities.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="addressLine1" label="Address line 1" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="addressLine2" label="Address line 2">
            <Input />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item name="city" label="Postal city" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="state" label="State" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="pincode" label="Pincode" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Form.Item
            name="hasBiometricDevice"
            label="Has a biometric machine"
            valuePropName="checked"
            extra="Off for a branch whose attendance is marked by hand. It sets Add Employee's default attendance capture for this branch; what decides each person's capture is whether they have a Device User ID."
          >
            <Switch />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              Save
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Merge "${mergeSource?.name}" into…`}
        open={mergeSource !== null}
        onCancel={() => setMergeSource(null)}
        onOk={() => mergeMutation.mutate()}
        confirmLoading={mergeMutation.isPending}
        okButtonProps={{ disabled: !mergeTargetId }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="This moves every employee currently on this branch to the target branch, then permanently deletes this one. This cannot be undone."
        />
        <Select
          style={{ width: "100%" }}
          placeholder="Select the branch to keep"
          value={mergeTargetId}
          onChange={setMergeTargetId}
          options={locations.filter((l) => l.id !== mergeSource?.id).map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
        />
      </Modal>
    </Space>
  );
}

// ── Departments / Designations / Grades / Cost Centres ─────────────────

interface SimpleMasterApi {
  list: () => Promise<SimpleMaster[]>;
  create: (input: { code: string; name: string; rank?: number }) => Promise<SimpleMaster>;
  update: (id: string, input: Partial<{ code: string; name: string; rank: number }>) => Promise<SimpleMaster>;
  remove: (id: string) => Promise<void>;
}

function SimpleMasterTab({ queryKey, api, canManage, hasRank }: { queryKey: string; api: SimpleMasterApi; canManage: boolean; hasRank?: boolean }) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery({ queryKey: ["org", queryKey], queryFn: api.list });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SimpleMaster | null>(null);
  const [form] = Form.useForm();

  const saveMutation = useMutation({
    mutationFn: (values: { code: string; name: string; rank?: number }) => (editing ? api.update(editing.id, values) : api.create(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", queryKey] });
      setModalOpen(false);
      void message.success(editing ? "Updated." : "Created.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", queryKey] });
      void message.success("Deleted.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not delete — likely still in use.")),
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
    <Space orientation="vertical" style={{ width: "100%" }} size={12}>
      {canManage && (
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ alignSelf: "flex-end" }}>
          Add
        </Button>
      )}
      <Table<SimpleMaster>
        rowKey="id"
        loading={isLoading}
        dataSource={items}
        pagination={false}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          ...(hasRank ? [{ title: "Rank", dataIndex: "rank" }] : []),
          ...(canManage
            ? [
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, record: SimpleMaster) => (
                    <Space>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                      <Popconfirm title="Delete? Blocked if still in use." onConfirm={() => deleteMutation.mutate(record.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal title={editing ? "Edit" : "Add"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
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
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              Save
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

export function OrganisationSetupPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("org.manage");

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Organisation Setup
      </Title>
      <Tabs
        items={[
          { key: "cities", label: "Cities", children: <CitiesTab canManage={canManage} /> },
          { key: "locations", label: "Branches", children: <LocationsTab canManage={canManage} /> },
          { key: "departments", label: "Departments", children: <SimpleMasterTab queryKey="departments" api={orgApi.departments} canManage={canManage} /> },
          { key: "designations", label: "Designations", children: <SimpleMasterTab queryKey="designations" api={orgApi.designations} canManage={canManage} /> },
          { key: "grades", label: "Grades", children: <SimpleMasterTab queryKey="grades" api={orgApi.grades} canManage={canManage} hasRank /> },
          { key: "cost-centres", label: "Cost Centres", children: <SimpleMasterTab queryKey="cost-centres" api={orgApi.costCentres} canManage={canManage} /> },
        ]}
      />
    </Space>
  );
}
