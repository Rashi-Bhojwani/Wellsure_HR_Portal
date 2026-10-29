import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Form, Input, Select, Switch } from "antd";
import { DeleteOutlined, EditOutlined, MoreOutlined, PlusOutlined, TeamOutlined, UserAddOutlined } from "@ant-design/icons";
import * as engageApi from "../../../api/engage";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { CardGrid, EmptyState, InitialsAvatar, PageHeader, Panel, SideDrawer, Skel, Stack, StatusChip, toast, useIsPhone } from "../../../ui";

const FORM_ID = "engage-group-form";

function GroupModal({ open, editing, onClose }: { open: boolean; editing: engageApi.GroupAdminRow | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (values: { name: string; description?: string; isActive?: boolean }) => (editing ? engageApi.updateGroup(editing.id, values) : engageApi.createGroup(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "groups"] });
      toast.success(editing ? "Group updated." : "Group created.");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save this group.")),
  });

  return (
    <SideDrawer open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : "Add Group"} formId={FORM_ID} primaryLabel="Save" primaryLoading={saveMutation.isPending}>
      <Form id={FORM_ID} form={form} layout="vertical" requiredMark initialValues={editing ?? { isActive: true }} onFinish={(vals) => saveMutation.mutate(vals)}>
        <Form.Item name="name" label="Name" rules={[{ required: true, max: 80 }]}>
          <Input placeholder="e.g. Events" />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} maxLength={300} showCount />
        </Form.Item>
        {editing && (
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
      </Form>
    </SideDrawer>
  );
}

function MembersModal({ open, group, onClose }: { open: boolean; group: engageApi.GroupAdminRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pickedEmployeeId, setPickedEmployeeId] = useState<string | undefined>();

  const { data: members = [], isLoading } = useQuery({
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
    onError: (err) => toast.error(apiErrorMessage(err, "Could not add this member.")),
  });

  const removeMutation = useMutation({
    mutationFn: (employeeId: string) => engageApi.removeGroupMember(group!.id, employeeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "groups", group?.id, "members"] });
      void queryClient.invalidateQueries({ queryKey: ["engage", "groups"] });
    },
  });

  return (
    <SideDrawer open={open} onClose={onClose} title={`${group?.name ?? ""} — Members`} subtitle={`${members.length} member${members.length === 1 ? "" : "s"}`} footer={null}>
      <div style={{ display: "flex", gap: space[2], marginBottom: space[5] }}>
        <Select
          showSearch
          aria-label="Search for an employee to add"
          placeholder="Search for an employee to add"
          style={{ flex: 1, minWidth: 0 }}
          value={pickedEmployeeId}
          onSearch={setSearch}
          onChange={setPickedEmployeeId}
          filterOption={false}
          loading={isFetching}
          options={options.map((o) => ({ value: o.id, label: `${o.name} (${o.employeeCode})` }))}
        />
        <Button type="primary" icon={<UserAddOutlined />} onClick={() => addMutation.mutate()} disabled={!pickedEmployeeId} loading={addMutation.isPending}>
          Add
        </Button>
      </div>
      {isLoading ? (
        <Stack gap={space[3]}>
          {[0, 1, 2].map((i) => (
            <Skel key={i} h={40} />
          ))}
        </Stack>
      ) : members.length === 0 ? (
        <EmptyState compact illustration="people" title="No members yet" description="Search above to add the first one." />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {members.map((m) => (
            <li key={m.employeeId} style={{ display: "flex", alignItems: "center", gap: space[3], padding: `${space[3]}px 0`, borderBottom: `1px solid ${v.borderDefault}` }}>
              <InitialsAvatar name={m.employeeName} size={32} />
              <span style={{ flex: 1, minWidth: 0, color: v.textPrimary, fontWeight: fw.medium }}>{m.employeeName}</span>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={`Remove ${m.employeeName}`}
                loading={removeMutation.isPending && removeMutation.variables === m.employeeId}
                onClick={() => removeMutation.mutate(m.employeeId)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SideDrawer>
  );
}

function GroupCard({ group, onMembers, onEdit }: { group: engageApi.GroupAdminRow; onMembers: () => void; onEdit: () => void }) {
  return (
    <article style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5], background: v.bgSurface, display: "flex", flexDirection: "column", gap: space[2], minHeight: 120 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: space[2] }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <span style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>{group.name}</span>
            {!group.isActive && <StatusChip status="INACTIVE">Inactive</StatusChip>}
          </div>
          <div style={{ color: v.textSecondary, fontSize: fs.table, marginTop: space[1] }}>
            {group.memberCount} member{group.memberCount === 1 ? "" : "s"} · {group.postCount} post{group.postCount === 1 ? "" : "s"}
          </div>
        </div>
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "members", icon: <TeamOutlined />, label: "Members", onClick: onMembers },
              { key: "edit", icon: <EditOutlined />, label: "Edit", onClick: onEdit },
            ],
          }}
        >
          <Button type="text" aria-label={`Actions for ${group.name}`} icon={<MoreOutlined />} />
        </Dropdown>
      </div>
      {group.description && <div style={{ color: v.textBody, fontSize: fs.md, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{group.description}</div>}
      <div style={{ marginTop: "auto", paddingTop: space[2] }}>
        <Button type="link" icon={<TeamOutlined />} onClick={onMembers} style={{ paddingInline: 0 }}>
          Manage members
        </Button>
      </div>
    </article>
  );
}

export function GroupsAdminPage() {
  const phone = useIsPhone();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<engageApi.GroupAdminRow | null>(null);
  const [membersFor, setMembersFor] = useState<engageApi.GroupAdminRow | null>(null);

  const { data: groups = [], isLoading, error, refetch } = useQuery({ queryKey: ["engage", "groups"], queryFn: engageApi.listGroups });

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Categories for posts in the Engage feed"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew} block={phone}>
            Add Group
          </Button>
        }
      />
      <Stack>
        <HelpStrip storageKey="engage-groups">
          Groups tag posts into categories for the Engage feed's filters — membership here is informational and doesn't restrict who can see or post into a group.
        </HelpStrip>

        <Panel title="All groups" subtitle={groups.length ? `${groups.length} group${groups.length === 1 ? "" : "s"}` : undefined}>
          {isLoading ? (
            <CardGrid min={260} gap={space[4]}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5] }}>
                  <Skel w="50%" h={16} style={{ marginBottom: space[3] }} />
                  <Skel w="35%" h={12} />
                </div>
              ))}
            </CardGrid>
          ) : error ? (
            <EmptyState kind="error" description={apiErrorMessage(error, "We couldn't load groups. Try again.")} onRetry={() => void refetch()} />
          ) : groups.length === 0 ? (
            <EmptyState
              illustration="people"
              title="No groups yet"
              description="Groups let employees filter the Engage feed by topic."
              action={
                <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
                  Add Group
                </Button>
              }
            />
          ) : (
            <CardGrid min={260} gap={space[4]}>
              {groups.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  onMembers={() => setMembersFor(g)}
                  onEdit={() => {
                    setEditing(g);
                    setModalOpen(true);
                  }}
                />
              ))}
            </CardGrid>
          )}
        </Panel>
      </Stack>

      <GroupModal open={modalOpen} editing={editing} onClose={() => setModalOpen(false)} />
      <MembersModal open={!!membersFor} group={membersFor} onClose={() => setMembersFor(null)} />
    </>
  );
}
