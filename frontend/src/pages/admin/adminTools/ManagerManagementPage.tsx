import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Checkbox, DatePicker, Drawer, Flex, Form, Modal, Popconfirm, Result, Select, Space, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { CheckCircleOutlined, SafetyOutlined, TeamOutlined, UserAddOutlined, UserDeleteOutlined } from "@ant-design/icons";
import { LEAVE_APPROVAL_GRANT, PERMISSION_CATALOG, type PermissionKey } from "@shared/constants/permissions";
import dayjs, { type Dayjs } from "dayjs";
import * as managersApi from "../../../api/managers";
import type { ManagerRow, UnassignedRow } from "../../../api/managers";
import { EmployeeAccessTab } from "../../../components/access/EmployeeAccessTab";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;

// Team changes can be dated today or earlier, never later: job history can't
// yet hold a pending change (docs/PROGRESS.md open issue — fixed before Phase 6).
const noFuture = (d: Dayjs) => d.isAfter(dayjs(), "day");
const ymd = (d?: Dayjs | null) => (d ? d.format("YYYY-MM-DD") : undefined);
const DateField = ({ name = "effectiveFrom" }: { name?: string }) => (
  <Form.Item name={name} label="Effective from" initialValue={dayjs()} extra="Today or earlier." rules={[{ required: true }]}>
    <DatePicker style={{ width: "100%" }} disabledDate={noFuture} />
  </Form.Item>
);

// Admin Tools → Manager Management (Phase 5 commit E2). Three flat levels
// under a synthetic Admin root: managers (and HR Admins) report to no one;
// everyone else reports to a manager — or shows up here as Unassigned. Every
// move is an effective-dated job history row and an audit entry.
export function ManagerManagementPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canAppoint = hasPermission("manager.appoint");
  const canAssign = hasPermission("manager.team.assign");
  const canPermissions = hasPermission("manager.permissions.manage");
  const canView = canAppoint || canAssign || canPermissions;
  const { data: managers = [], isLoading, isError, error } = useQuery({ queryKey: ["managers", "list"], queryFn: managersApi.listManagers, retry: false, enabled: canView });
  const { data: unassigned = [] } = useQuery({ queryKey: ["managers", "unassigned"], queryFn: managersApi.listUnassigned, enabled: canView && !isError });
  const [teamOf, setTeamOf] = useState<ManagerRow | null>(null);
  const [permsOf, setPermsOf] = useState<ManagerRow | null>(null);
  const [removing, setRemoving] = useState<ManagerRow | null>(null);
  const [appointOpen, setAppointOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [appointForm] = Form.useForm<{ employeeId: string; effectiveFrom: Dayjs; grantLeaveApproval?: boolean }>();
  const [removeForm] = Form.useForm<{ newManagerId: string | null; effectiveFrom: Dayjs }>();
  const [bulkForm] = Form.useForm<{ managerId: string; effectiveFrom: Dayjs }>();

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["managers"] });
  const onError = (fallback: string) => (err: unknown) => void message.error(apiErrorMessage(err, fallback));
  const appoint = useMutation({
    mutationFn: (v: { employeeId: string; effectiveFrom: Dayjs; grantLeaveApproval?: boolean }) => managersApi.appointManager(v.employeeId, ymd(v.effectiveFrom), Boolean(v.grantLeaveApproval)),
    onSuccess: () => {
      refresh();
      setAppointOpen(false);
      appointForm.resetFields();
      void message.success("Appointed. They sit directly under Admin, with no team yet — and only the permissions you granted.");
    },
    onError: onError("Couldn't appoint them."),
  });
  // One click, always deliberate (2026-10-03): a manager can do nothing
  // until Admin grants it; leave approval is the common grant.
  const leaveApproval = useMutation({
    mutationFn: (v: { employeeId: string; grant: boolean }) => managersApi.setLeaveApproval(v.employeeId, v.grant),
    onSuccess: (m) => {
      void message.success(m.leaveApproval ? `${m.name} can now approve their team's leave.` : `${m.name} can no longer approve leave.`);
      void queryClient.invalidateQueries({ queryKey: ["managers"] });
    },
    onError: onError("Couldn't change their leave approval."),
  });
  const remove = useMutation({
    mutationFn: (v: { newManagerId: string | null; effectiveFrom: Dayjs }) => managersApi.removeManager(removing!.employeeId, { newManagerId: v.newManagerId ?? null, effectiveFrom: ymd(v.effectiveFrom) }),
    onSuccess: () => {
      refresh();
      setRemoving(null);
      removeForm.resetFields();
      void message.success("Manager role removed.");
    },
    onError: onError("Couldn't remove them as a manager."),
  });
  const bulkAssign = useMutation({
    mutationFn: (v: { managerId: string; effectiveFrom: Dayjs }) => managersApi.assignTeam(v.managerId, selected, ymd(v.effectiveFrom)),
    onSuccess: (r) => {
      refresh();
      setSelected([]);
      void message.success(`${r.assigned} assigned.`);
    },
    onError: onError("Couldn't assign them."),
  });

  if (!canView) return <Result status="403" title="You can't manage managers" />;
  if (isError) {
    const status = (error as { response?: { status?: number } }).response?.status;
    return <Result status={status === 403 ? "403" : "error"} title={status === 403 ? "You can't manage managers" : "Couldn't load managers"} />;
  }

  const managerSelect = (exclude?: string) => managers.filter((m) => m.employeeId !== exclude).map((m) => ({ value: m.employeeId, label: `${m.name} (${m.employeeCode})` }));

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Manager Management
          </Title>
          <Text type="secondary">Admin → Managers → their teams. Managers and HR Admins report to no one; everyone else to exactly one manager.</Text>
        </div>
        {canAppoint && (
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAppointOpen(true)}>
            Appoint a manager
          </Button>
        )}
      </Flex>

      <Tabs
        items={[
          {
            key: "managers",
            label: `Managers (${managers.length})`,
            children: (
              <>
              {managers.some((m) => m.permissions.length === 0) && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title={`${managers.filter((m) => m.permissions.length === 0).length} of ${managers.length} managers have no permissions`}
                  description="Being a manager grants nothing on its own — they can't approve leave or see their team until you grant it. If that's intended, nothing to do."
                />
              )}
              <Table<ManagerRow>
                rowKey="employeeId"
                size="small"
                loading={isLoading}
                dataSource={managers}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                columns={[
                  { title: "Manager", key: "name", render: (_: unknown, m) => <Link to={`/admin/employee/profile/${m.employeeId}`}>{m.name}</Link>, sorter: (a, b) => a.name.localeCompare(b.name) },
                  { title: "Code", dataIndex: "employeeCode" },
                  { title: "Department", dataIndex: "department", render: (v: string | null) => v ?? "—" },
                  { title: "Branch", dataIndex: "branch", render: (v: string | null) => v ?? "—" },
                  {
                    title: "Team",
                    dataIndex: "teamSize",
                    sorter: (a, b) => a.teamSize - b.teamSize,
                    render: (n: number) => (n === 0 ? <Tag>No team yet</Tag> : <Tag color="blue">{n} {n === 1 ? "person" : "people"}</Tag>),
                  },
                  {
                    title: "Can do",
                    key: "permissions",
                    filters: [
                      { text: "No permissions", value: "none" },
                      { text: "Leave approval", value: "leave" },
                    ],
                    onFilter: (v, m) => (v === "none" ? m.permissions.length === 0 : m.leaveApproval),
                    render: (_: unknown, m) =>
                      m.permissions.length === 0 ? (
                        <Tooltip title="A manager starts with nothing. Grant what they need — leave approval with one click, anything else under Permissions.">
                          <Tag color="warning">No permissions</Tag>
                        </Tooltip>
                      ) : (
                        <Space size={[4, 4]} wrap>
                          {m.leaveApproval && <Tag color="green">Leave approval</Tag>}
                          {m.permissions
                            .filter((k) => !(m.leaveApproval && (LEAVE_APPROVAL_GRANT as readonly string[]).includes(k)))
                            .map((k) => (
                              <Tag key={k}>{PERMISSION_CATALOG[k as PermissionKey]?.label ?? k}</Tag>
                            ))}
                        </Space>
                      ),
                  },
                  {
                    title: "",
                    key: "actions",
                    render: (_: unknown, m) => (
                      <Space size={4} wrap>
                        {canPermissions &&
                          (m.leaveApproval ? (
                            <Popconfirm title={`Stop ${m.name} approving leave?`} okText="Remove" onConfirm={() => leaveApproval.mutate({ employeeId: m.employeeId, grant: false })}>
                              <Button size="small">Remove leave approval</Button>
                            </Popconfirm>
                          ) : (
                            <Popconfirm title={`Let ${m.name} view and approve their team's leave?`} okText="Grant" onConfirm={() => leaveApproval.mutate({ employeeId: m.employeeId, grant: true })}>
                              <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />}>
                                Grant leave approval
                              </Button>
                            </Popconfirm>
                          ))}
                        <Button size="small" icon={<TeamOutlined />} onClick={() => setTeamOf(m)}>
                          Team
                        </Button>
                        {canPermissions && (
                          <Button size="small" icon={<SafetyOutlined />} onClick={() => setPermsOf(m)}>
                            Permissions
                          </Button>
                        )}
                        {canAppoint && (
                          <Tooltip title={m.teamSize > 0 ? `Reassign their ${m.teamSize} team member${m.teamSize === 1 ? "" : "s"} first` : undefined}>
                            <Button size="small" danger icon={<UserDeleteOutlined />} disabled={m.teamSize > 0} onClick={() => setRemoving(m)}>
                              Remove
                            </Button>
                          </Tooltip>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
              </>
            ),
          },
          {
            key: "unassigned",
            label: (
              <Space size={6}>
                Unassigned
                <Badge count={unassigned.length} showZero color={unassigned.length ? "orange" : "green"} />
              </Space>
            ),
            children: (
              <Flex vertical gap={12}>
                {canAssign && (
                  <Form form={bulkForm} layout="inline" onFinish={(v) => bulkAssign.mutate(v)} initialValues={{ effectiveFrom: dayjs() }}>
                    <Form.Item name="managerId" rules={[{ required: true, message: "Choose a manager" }]}>
                      <Select style={{ width: 240 }} placeholder="Assign selected to…" options={managerSelect()} showSearch optionFilterProp="label" />
                    </Form.Item>
                    <Form.Item name="effectiveFrom" rules={[{ required: true }]}>
                      <DatePicker disabledDate={noFuture} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" disabled={selected.length === 0} loading={bulkAssign.isPending}>
                      Assign {selected.length || ""}
                    </Button>
                  </Form>
                )}
                <Table<UnassignedRow>
                  rowKey="employeeId"
                  size="small"
                  dataSource={unassigned}
                  pagination={{ pageSize: 20, hideOnSinglePage: true }}
                  locale={{ emptyText: "Everyone who needs a manager has one." }}
                  rowSelection={canAssign ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]), getCheckboxProps: (r) => ({ disabled: !r.placedSince }) } : undefined}
                  columns={[
                    { title: "Employee", key: "name", render: (_: unknown, r) => <Link to={`/admin/employee/profile/${r.employeeId}`}>{r.name}</Link> },
                    { title: "Code", dataIndex: "employeeCode" },
                    { title: "Department", dataIndex: "department", render: (v: string | null) => v ?? "—" },
                    { title: "Why", dataIndex: "why", render: (v: string) => <Text type="secondary">{v}</Text> },
                  ]}
                />
              </Flex>
            ),
          },
        ]}
      />

      <TeamDrawer manager={teamOf} canAssign={canAssign} onClose={() => setTeamOf(null)} />

      <Drawer title={permsOf ? `${permsOf.name} — permissions` : ""} open={permsOf !== null} onClose={() => setPermsOf(null)} size="large" destroyOnHidden>
        {permsOf && (
          <Flex vertical gap={12}>
            <Alert
              type="info"
              showIcon
              title="Managers start from the Manager role (edited only by a Super Admin). Exceptions here apply to this manager only — and only from the short list a manager may ever hold, always limited to their own team."
            />
            <EmployeeAccessTab employeeId={permsOf.employeeId} />
          </Flex>
        )}
      </Drawer>

      <Modal title="Appoint a manager" open={appointOpen} okText="Appoint" confirmLoading={appoint.isPending} onOk={() => appointForm.submit()} onCancel={() => setAppointOpen(false)} destroyOnHidden>
        <Form form={appointForm} layout="vertical" requiredMark={false} onFinish={(v) => appoint.mutate(v)}>
          <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: "Choose someone" }]} extra="They'll report directly to Admin. Their team starts empty.">
            <EmployeePicker />
          </Form.Item>
          <DateField />
          {canPermissions && (
            <Form.Item name="grantLeaveApproval" valuePropName="checked" extra="A new manager can do nothing until you grant it. Leave this unticked to decide later.">
              <Checkbox>Also let them approve their team's leave</Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title={removing ? `Remove ${removing.name} as a manager` : ""} open={removing !== null} okText="Remove manager role" okButtonProps={{ danger: true }} confirmLoading={remove.isPending} onOk={() => removeForm.submit()} onCancel={() => setRemoving(null)} destroyOnHidden>
        <Form form={removeForm} layout="vertical" requiredMark={false} onFinish={(v) => remove.mutate(v)}>
          <Form.Item name="newManagerId" label="Their new manager" extra="They become a regular employee, so they need a manager of their own. Leave empty to put them on the Unassigned list.">
            <Select allowClear placeholder="Choose a manager" options={managerSelect(removing?.employeeId)} showSearch optionFilterProp="label" />
          </Form.Item>
          <DateField />
        </Form>
      </Modal>
    </Flex>
  );
}

function TeamDrawer({ manager, canAssign, onClose }: { manager: ManagerRow | null; canAssign: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ employeeId: string; effectiveFrom: Dayjs }>();
  const { data } = useQuery({ queryKey: ["managers", "team", manager?.employeeId], queryFn: () => managersApi.getTeam(manager!.employeeId), enabled: manager !== null });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["managers"] });
  const add = useMutation({
    mutationFn: (v: { employeeId: string; effectiveFrom: Dayjs }) => managersApi.assignTeam(manager!.employeeId, [v.employeeId], ymd(v.effectiveFrom)),
    onSuccess: () => {
      refresh();
      form.resetFields();
      void message.success("Added to the team.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't add them.")),
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) => managersApi.removeTeamMember(manager!.employeeId, memberId),
    onSuccess: () => {
      refresh();
      void message.success("Removed from the team — they're now Unassigned.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't remove them.")),
  });
  return (
    <Drawer title={manager ? `${manager.name}'s team` : ""} open={manager !== null} onClose={onClose} size="large" destroyOnHidden>
      <Flex vertical gap={16}>
        {canAssign && (
          <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => add.mutate(v)}>
            <Form.Item name="employeeId" label="Add someone" rules={[{ required: true, message: "Choose someone" }]} extra="Moves them from their current manager (if any). A new job-history entry is written; the old one is kept.">
              <EmployeePicker />
            </Form.Item>
            <DateField />
            <Button type="primary" htmlType="submit" loading={add.isPending}>
              Add to team
            </Button>
          </Form>
        )}
        <Table
          rowKey="employeeId"
          size="small"
          dataSource={data?.members ?? []}
          pagination={false}
          locale={{ emptyText: "No team yet." }}
          columns={[
            { title: "Member", key: "name", render: (_: unknown, r: managersApi.PersonPlacement) => <Link to={`/admin/employee/profile/${r.employeeId}`}>{r.name}</Link> },
            { title: "Code", dataIndex: "employeeCode" },
            { title: "Since", dataIndex: "placedSince" },
            ...(canAssign
              ? [
                  {
                    title: "",
                    key: "remove",
                    render: (_: unknown, r: managersApi.PersonPlacement) => (
                      <Popconfirm title={`Remove ${r.name} from the team today? They'll be Unassigned.`} okText="Remove" onConfirm={() => removeMember.mutate(r.employeeId)}>
                        <Button size="small" danger>
                          Remove
                        </Button>
                      </Popconfirm>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Flex>
    </Drawer>
  );
}
