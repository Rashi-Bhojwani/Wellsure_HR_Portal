import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, List, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { PlusOutlined, UserAddOutlined } from "@ant-design/icons";
import * as engageApi from "../../../api/engage";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title } = Typography;

function GroupModal({ open, editing, onClose }: { open: boolean; editing: engageApi.GroupAdminRow | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (values: { name: string; description?: string; isActive?: boolean }) =>
      editing ? engageApi.updateGroup(editing.id, values) : engageApi.createGroup(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "groups"] });
      void message.success(editing ? "Group updated." : "Group created.");
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save this group.")),
  });

  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Add Group"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      afterOpenChange={(isOpen) => isOpen && form.setFieldsValue(editing ?? { isActive: true })}
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => saveMutation.mutate(v)}>
        <Form.Item name="name" label="Name" rules={[{ required: true, max: 80 }]}>
          <Input placeholder="e.g. Events" />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
        {editing && (
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            Save
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function MembersModal({ open, group, onClose }: { open: boolean; group: engageApi.GroupAdminRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pickedEmployeeId, setPickedEmployeeId] = useState<string | undefined>();

  const { data: members = [] } = useQuery({
    queryKey: ["engage", "groups", group?.id, "members"],
    queryFn: () => engageApi.listGroupMembers(group!.id),
    enabled: !!group,
  });

  const { data: options = [], isFetching } = useQuery({
    queryKey: ["engage", "employee-search", search],
    queryFn: () => engageApi.searchEmployees(search),
    enabled: search.trim().length > 0,
  });

  const addMutation = useMutation({
    mutationFn: () => engageApi.addGroupMember(group!.id, pickedEmployeeId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "groups", group?.id, "members"] });
      void queryClient.invalidateQueries({ queryKey: ["engage", "groups"] });
      setPickedEmployeeId(undefined);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not add this member.")),
  });

  const removeMutation = useMutation({
    mutationFn: (employeeId: string) => engageApi.removeGroupMember(group!.id, employeeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "groups", group?.id, "members"] });
      void queryClient.invalidateQueries({ queryKey: ["engage", "groups"] });
    },
  });

  return (
    <Modal title={`${group?.name} — Members`} open={open} onCancel={onClose} footer={null} destroyOnHidden>
      <Space.Compact style={{ width: "100%", marginBottom: 16 }}>
        <Select
          showSearch
          placeholder="Search for an employee to add"
          style={{ width: "100%" }}
          value={pickedEmployeeId}
          onSearch={setSearch}
          onChange={setPickedEmployeeId}
          filterOption={false}
          loading={isFetching}
          options={options.map((o) => ({ value: o.id, label: `${o.name} (${o.employeeCode})` }))}
        />
        <Button icon={<UserAddOutlined />} onClick={() => addMutation.mutate()} disabled={!pickedEmployeeId} loading={addMutation.isPending}>
          Add
        </Button>
      </Space.Compact>
      <List
        size="small"
        dataSource={members}
        renderItem={(m) => (
          <List.Item actions={[<a key="remove" onClick={() => removeMutation.mutate(m.employeeId)}>Remove</a>]}>
            {m.employeeName}
          </List.Item>
        )}
      />
    </Modal>
  );
}

export function GroupsAdminPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<engageApi.GroupAdminRow | null>(null);
  const [membersFor, setMembersFor] = useState<engageApi.GroupAdminRow | null>(null);

  const { data: groups = [], isLoading } = useQuery({ queryKey: ["engage", "groups"], queryFn: engageApi.listGroups });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <HelpStrip storageKey="engage-groups">
        Groups tag posts into categories for the Engage feed's filters — membership here is informational and doesn't restrict who can see or post into a group.
      </HelpStrip>

      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Title level={4} style={{ margin: 0 }}>
          Groups
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          Add Group
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={groups}
        pagination={false}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Description", dataIndex: "description", render: (v: string | null) => v ?? "—" },
          { title: "Members", dataIndex: "memberCount" },
          { title: "Posts", dataIndex: "postCount" },
          {
            title: "Status",
            dataIndex: "isActive",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag>,
          },
          {
            title: "",
            key: "actions",
            render: (_: unknown, row: engageApi.GroupAdminRow) => (
              <Space>
                <a onClick={() => setMembersFor(row)}>Members</a>
                <a
                  onClick={() => {
                    setEditing(row);
                    setModalOpen(true);
                  }}
                >
                  Edit
                </a>
              </Space>
            ),
          },
        ]}
      />

      <GroupModal open={modalOpen} editing={editing} onClose={() => setModalOpen(false)} />
      <MembersModal open={!!membersFor} group={membersFor} onClose={() => setMembersFor(null)} />
    </Space>
  );
}
