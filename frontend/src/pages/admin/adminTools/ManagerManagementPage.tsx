import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Form, Select, Tabs, Tooltip } from "antd";
import { CheckCircleOutlined, SafetyOutlined, StopOutlined, TeamOutlined, UserAddOutlined, UserDeleteOutlined, UserOutlined, WarningOutlined } from "@ant-design/icons";
import { LEAVE_APPROVAL_GRANT, PERMISSION_CATALOG, type PermissionKey } from "@shared/constants/permissions";
import dayjs, { type Dayjs } from "dayjs";
import * as managersApi from "../../../api/managers";
import type { ManagerRow, UnassignedRow } from "../../../api/managers";
import { EmployeeAccessTab } from "../../../components/access/EmployeeAccessTab";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { space, v } from "../../../theme/tokens";
import { ApprovalBanner, CardGrid, ConfirmModal, DataTable, EmptyState, FilterBar, InitialsAvatar, PageHeader, Panel, QueryState, SideDrawer, SkeletonStats, SkeletonTable, Stack, StatCard, StatusChip, toast, useIsPhone } from "../../../ui";
import { ManagerDateField } from "./ManagerDateField";
import { ManagerTeamDrawer } from "./ManagerTeamDrawer";

const ymd = (d?: Dayjs | null) => (d ? d.format("YYYY-MM-DD") : undefined);
const APPOINT_FORM = "appoint-manager-form";

type CanDoFilter = "none" | "leave";

/** What a manager can actually do, as chips (empty until Admin grants it). */
function CanDo({ m }: { m: ManagerRow }) {
  if (m.permissions.length === 0) {
    return (
      <Tooltip title="A manager starts with nothing. Grant what they need — leave approval with one click, anything else under Permissions.">
        <span tabIndex={0}>
          <StatusChip tone="warning">No permissions</StatusChip>
        </span>
      </Tooltip>
    );
  }
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: space[1] }}>
      {m.leaveApproval && <StatusChip tone="success">Leave approval</StatusChip>}
      {m.permissions
        .filter((k) => !(m.leaveApproval && (LEAVE_APPROVAL_GRANT as readonly string[]).includes(k)))
        .map((k) => (
          <StatusChip key={k} tone="neutral">
            {PERMISSION_CATALOG[k as PermissionKey]?.label ?? k}
          </StatusChip>
        ))}
    </span>
  );
}

const teamText = (n: number) => (n === 0 ? "No team yet" : `${n} ${n === 1 ? "person" : "people"}`);

// Admin Tools → Manager Management (Phase 5 commit E2). Three flat levels
// under a synthetic Admin root: managers (and HR Admins) report to no one;
// everyone else reports to a manager — or shows up here as Unassigned. Every
// move is an effective-dated job history row and an audit entry, so nothing
// here is optimistic: each change waits for the server, and the ones that take
// something away are confirmed first.
export function ManagerManagementPage() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { hasPermission } = useAuth();
  const canAppoint = hasPermission("manager.appoint");
  const canAssign = hasPermission("manager.team.assign");
  const canPermissions = hasPermission("manager.permissions.manage");
  const canView = canAppoint || canAssign || canPermissions;
  const { data: managers = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ["managers", "list"], queryFn: managersApi.listManagers, retry: false, enabled: canView });
  const unassignedQuery = useQuery({ queryKey: ["managers", "unassigned"], queryFn: managersApi.listUnassigned, enabled: canView && !isError });
  const unassigned = unassignedQuery.data ?? [];
  const [tab, setTab] = useState("managers");
  const [search, setSearch] = useState("");
  const [canDo, setCanDo] = useState<CanDoFilter>();
  const [teamOf, setTeamOf] = useState<ManagerRow | null>(null);
  const [permsOf, setPermsOf] = useState<ManagerRow | null>(null);
  const [removing, setRemoving] = useState<ManagerRow | null>(null);
  const [leaveChange, setLeaveChange] = useState<{ m: ManagerRow; grant: boolean } | null>(null);
  const [appointOpen, setAppointOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [appointForm] = Form.useForm<{ employeeId: string; effectiveFrom: Dayjs; grantLeaveApproval?: boolean }>();
  const [removeForm] = Form.useForm<{ newManagerId: string | null; effectiveFrom: Dayjs }>();
  const [bulkForm] = Form.useForm<{ managerId: string; effectiveFrom: Dayjs }>();

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["managers"] });
  const onError = (fallback: string) => (err: unknown) => toast.error(apiErrorMessage(err, fallback));
  const appoint = useMutation({
    mutationFn: (val: { employeeId: string; effectiveFrom: Dayjs; grantLeaveApproval?: boolean }) => managersApi.appointManager(val.employeeId, ymd(val.effectiveFrom), Boolean(val.grantLeaveApproval)),
    onSuccess: () => {
      refresh();
      setAppointOpen(false);
      appointForm.resetFields();
      toast.success("Appointed. They sit directly under Admin, with no team yet — and only the permissions you granted.");
    },
    onError: onError("Couldn't appoint them."),
  });
  // One click, always deliberate (2026-10-03): a manager can do nothing
  // until Admin grants it; leave approval is the common grant.
  const leaveApproval = useMutation({
    mutationFn: (val: { employeeId: string; grant: boolean }) => managersApi.setLeaveApproval(val.employeeId, val.grant),
    onSuccess: (m) => {
      toast.success(m.leaveApproval ? `${m.name} can now approve their team's leave.` : `${m.name} can no longer approve leave.`);
      setLeaveChange(null);
      void queryClient.invalidateQueries({ queryKey: ["managers"] });
    },
    onError: onError("Couldn't change their leave approval."),
  });
  const remove = useMutation({
    mutationFn: (val: { newManagerId: string | null; effectiveFrom: Dayjs }) => managersApi.removeManager(removing!.employeeId, { newManagerId: val.newManagerId ?? null, effectiveFrom: ymd(val.effectiveFrom) }),
    onSuccess: () => {
      refresh();
      setRemoving(null);
      removeForm.resetFields();
      toast.success("Manager role removed.");
    },
    onError: onError("Couldn't remove them as a manager."),
  });
  const bulkAssign = useMutation({
    mutationFn: (val: { managerId: string; effectiveFrom: Dayjs }) => managersApi.assignTeam(val.managerId, selected, ymd(val.effectiveFrom)),
    onSuccess: (r) => {
      refresh();
      setSelected([]);
      toast.success(`${r.assigned} assigned.`);
    },
    onError: onError("Couldn't assign them."),
  });

  const visibleManagers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return managers.filter(
      (m) =>
        (!q || m.name.toLowerCase().includes(q) || m.employeeCode.toLowerCase().includes(q) || (m.department ?? "").toLowerCase().includes(q)) &&
        (canDo === undefined || (canDo === "none" ? m.permissions.length === 0 : m.leaveApproval)),
    );
  }, [managers, search, canDo]);

  if (!canView) {
    return (
      <>
        <PageHeader title="Manager Management" />
        <Panel>
          <EmptyState kind="forbidden" title="You can't manage managers" />
        </Panel>
      </>
    );
  }

  const managerSelect = (exclude?: string) => managers.filter((m) => m.employeeId !== exclude).map((m) => ({ value: m.employeeId, label: `${m.name} (${m.employeeCode})` }));
  const noPerms = managers.filter((m) => m.permissions.length === 0).length;
  const withLeave = managers.filter((m) => m.leaveApproval).length;

  const rowActions = (m: ManagerRow, block = false) => (
    <>
      {canPermissions &&
        (m.leaveApproval ? (
          <Button size={block ? "middle" : "small"} block={block} icon={<StopOutlined />} onClick={() => setLeaveChange({ m, grant: false })}>
            Remove leave approval
          </Button>
        ) : (
          <Button size={block ? "middle" : "small"} block={block} type="primary" ghost icon={<CheckCircleOutlined />} onClick={() => setLeaveChange({ m, grant: true })}>
            Grant leave approval
          </Button>
        ))}
      <Button size={block ? "middle" : "small"} icon={<TeamOutlined />} onClick={() => setTeamOf(m)}>
        Team
      </Button>
      {canPermissions && (
        <Button size={block ? "middle" : "small"} icon={<SafetyOutlined />} onClick={() => setPermsOf(m)}>
          Permissions
        </Button>
      )}
      {canAppoint && (
        <Tooltip title={m.teamSize > 0 ? `Reassign their ${m.teamSize} team member${m.teamSize === 1 ? "" : "s"} first` : undefined}>
          <span>
            <Button size={block ? "middle" : "small"} danger icon={<UserDeleteOutlined />} disabled={m.teamSize > 0} onClick={() => setRemoving(m)}>
              Remove
            </Button>
          </span>
        </Tooltip>
      )}
    </>
  );

  const toggleSelected = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((k) => k !== id)));

  return (
    <>
      <PageHeader
        title="Manager Management"
        subtitle="Admin → Managers → their teams. Managers and HR Admins report to no one; everyone else to exactly one manager."
        actions={
          canAppoint && (
            <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAppointOpen(true)} block={phone}>
              Appoint a manager
            </Button>
          )
        }
      />
      <QueryState
        isLoading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        skeleton={
          <Stack>
            <SkeletonStats count={4} />
            <SkeletonTable rows={6} columns={6} />
          </Stack>
        }
      >
        <Stack>
          <CardGrid min={200} gap={space[4]}>
            <StatCard label="Managers" value={managers.length} icon={<UserOutlined />} tone="accent" onClick={() => setTab("managers")} />
            <StatCard label="Can approve leave" value={withLeave} icon={<CheckCircleOutlined />} tone="info" />
            <StatCard label="No permissions" value={noPerms} icon={<WarningOutlined />} tone={noPerms ? "warning" : "neutral"} />
            <StatCard label="Unassigned" value={unassigned.length} loading={unassignedQuery.isLoading} icon={<TeamOutlined />} tone={unassigned.length ? "warning" : "neutral"} onClick={() => setTab("unassigned")} />
          </CardGrid>

          <Panel>
            <Tabs
              activeKey={tab}
              onChange={setTab}
              items={[
                {
                  key: "managers",
                  label: `Managers (${managers.length})`,
                  children: (
                    <Stack gap={space[4]}>
                      {noPerms > 0 && (
                        <ApprovalBanner
                          tone="warning"
                          title={`${noPerms} of ${managers.length} managers have no permissions`}
                          description="Being a manager grants nothing on its own — they can't approve leave or see their team until you grant it. If that's intended, nothing to do."
                          actions={
                            canDo !== "none" ? (
                              <Button size="small" onClick={() => setCanDo("none")}>
                                Show them
                              </Button>
                            ) : undefined
                          }
                        />
                      )}
                      <div>
                        <FilterBar
                          onSearch={setSearch}
                          searchValue={search}
                          searchPlaceholder="Search manager, code or department"
                          activeCount={canDo ? 1 : 0}
                          onClear={() => setCanDo(undefined)}
                          filters={
                            <Select<CanDoFilter>
                              allowClear
                              aria-label="Can do"
                              placeholder="Can do: anything"
                              style={{ width: phone ? "100%" : 200 }}
                              value={canDo}
                              onChange={setCanDo}
                              options={[
                                { value: "none", label: "No permissions" },
                                { value: "leave", label: "Leave approval" },
                              ]}
                            />
                          }
                        />
                        <DataTable<ManagerRow>
                          rowKey="employeeId"
                          dataSource={visibleManagers}
                          pagination={{ pageSize: 20, hideOnSinglePage: true }}
                          empty={
                            managers.length === 0 ? (
                              <EmptyState
                                compact
                                illustration="people"
                                title="No managers yet"
                                description="Appoint someone to lead a team. They start with no team and no permissions."
                                action={
                                  canAppoint ? (
                                    <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAppointOpen(true)}>
                                      Appoint a manager
                                    </Button>
                                  ) : undefined
                                }
                              />
                            ) : (
                              <EmptyState kind="no-results" compact title="No managers match" description="Try another name or clear the filter." />
                            )
                          }
                          columns={[
                            {
                              title: "Manager",
                              key: "name",
                              sorter: (a, b) => a.name.localeCompare(b.name),
                              render: (_: unknown, m) => (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                                  <InitialsAvatar name={m.name} size={32} />
                                  <span>
                                    <Link to={`/admin/employee/profile/${m.employeeId}`}>{m.name}</Link>
                                    <span style={{ display: "block", color: v.textSecondary }}>{m.employeeCode}</span>
                                  </span>
                                </span>
                              ),
                            },
                            { title: "Department", dataIndex: "department", render: (val: string | null) => val ?? "—" },
                            { title: "Branch", dataIndex: "branch", render: (val: string | null) => val ?? "—" },
                            {
                              title: "Team",
                              dataIndex: "teamSize",
                              sorter: (a, b) => a.teamSize - b.teamSize,
                              render: (n: number) => <StatusChip tone={n === 0 ? "neutral" : "info"}>{teamText(n)}</StatusChip>,
                            },
                            { title: "Can do", key: "permissions", render: (_: unknown, m) => <CanDo m={m} /> },
                            {
                              title: "",
                              key: "actions",
                              render: (_: unknown, m) => <span style={{ display: "inline-flex", flexWrap: "wrap", gap: space[1] }}>{rowActions(m)}</span>,
                            },
                          ]}
                          mobile={{
                            avatar: (m) => <InitialsAvatar name={m.name} size={40} />,
                            title: (m) => <Link to={`/admin/employee/profile/${m.employeeId}`}>{m.name}</Link>,
                            subtitle: (m) => [m.employeeCode, m.department, m.branch].filter(Boolean).join(" · "),
                            status: (m) => <StatusChip tone={m.teamSize === 0 ? "neutral" : "info"}>{teamText(m.teamSize)}</StatusChip>,
                            fields: [{ label: "Can do", render: (m) => <CanDo m={m} /> }],
                            actions: (m) => rowActions(m, true),
                          }}
                        />
                      </div>
                    </Stack>
                  ),
                },
                {
                  key: "unassigned",
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                      Unassigned
                      <StatusChip tone={unassigned.length ? "warning" : "success"}>{String(unassigned.length)}</StatusChip>
                    </span>
                  ),
                  children: (
                    <Stack gap={space[4]}>
                      {canAssign && (
                        <Form
                          form={bulkForm}
                          layout={phone ? "vertical" : "inline"}
                          onFinish={(val) => bulkAssign.mutate(val)}
                          initialValues={{ effectiveFrom: dayjs() }}
                          style={{ rowGap: space[2] }}
                          aria-label="Assign selected people to a manager"
                        >
                          <Form.Item name="managerId" rules={[{ required: true, message: "Choose a manager" }]} style={{ minWidth: phone ? undefined : 240 }}>
                            <Select aria-label="Manager" placeholder="Assign selected to…" options={managerSelect()} showSearch optionFilterProp="label" />
                          </Form.Item>
                          <Form.Item name="effectiveFrom" rules={[{ required: true, message: "Choose a date" }]}>
                            <DatePicker aria-label="Effective from" format="D MMM YYYY" style={{ width: phone ? "100%" : undefined }} />
                          </Form.Item>
                          <Button type="primary" htmlType="submit" disabled={selected.length === 0} loading={bulkAssign.isPending} block={phone}>
                            Assign {selected.length || ""}
                          </Button>
                        </Form>
                      )}
                      <DataTable<UnassignedRow>
                        rowKey="employeeId"
                        loading={unassignedQuery.isLoading}
                        error={unassignedQuery.error}
                        onRetry={() => void unassignedQuery.refetch()}
                        dataSource={unassigned}
                        pagination={{ pageSize: 20, hideOnSinglePage: true }}
                        empty={<EmptyState compact illustration="people" title="Everyone who needs a manager has one." description={null} />}
                        rowSelection={canAssign ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]), getCheckboxProps: (r) => ({ disabled: !r.placedSince, "aria-label": `Select ${r.name}` }) } : undefined}
                        columns={[
                          {
                            title: "Employee",
                            key: "name",
                            render: (_: unknown, r) => (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                                <InitialsAvatar name={r.name} size={32} />
                                <Link to={`/admin/employee/profile/${r.employeeId}`}>{r.name}</Link>
                              </span>
                            ),
                          },
                          { title: "Code", dataIndex: "employeeCode" },
                          { title: "Department", dataIndex: "department", render: (val: string | null) => val ?? "—" },
                          { title: "Why", dataIndex: "why", render: (val: string) => <span style={{ color: v.textSecondary }}>{val}</span> },
                        ]}
                        mobile={{
                          avatar: (r) => <InitialsAvatar name={r.name} size={40} />,
                          title: (r) => <Link to={`/admin/employee/profile/${r.employeeId}`}>{r.name}</Link>,
                          subtitle: (r) => [r.employeeCode, r.department].filter(Boolean).join(" · "),
                          fields: [{ label: "Why", render: (r) => r.why }],
                          actions: canAssign
                            ? (r) => (
                                <Checkbox checked={selected.includes(r.employeeId)} disabled={!r.placedSince} onChange={(e) => toggleSelected(r.employeeId, e.target.checked)} style={{ minHeight: 44, alignItems: "center" }}>
                                  Select to assign
                                </Checkbox>
                              )
                            : undefined,
                        }}
                      />
                    </Stack>
                  ),
                },
              ]}
            />
          </Panel>
        </Stack>
      </QueryState>

      <ManagerTeamDrawer manager={teamOf} canAssign={canAssign} onClose={() => setTeamOf(null)} />

      <SideDrawer open={permsOf !== null} onClose={() => setPermsOf(null)} title={permsOf ? `${permsOf.name} — permissions` : ""} size="wide" footer={null}>
        {permsOf && (
          <Stack gap={space[4]}>
            <ApprovalBanner
              tone="info"
              title="Managers start from the Manager role (edited only by a Super Admin). Exceptions here apply to this manager only — and only from the short list a manager may ever hold, always limited to their own team."
            />
            <EmployeeAccessTab employeeId={permsOf.employeeId} />
          </Stack>
        )}
      </SideDrawer>

      <SideDrawer
        open={appointOpen}
        onClose={() => setAppointOpen(false)}
        title="Appoint a manager"
        subtitle="They'll report directly to Admin. Their team starts empty."
        formId={APPOINT_FORM}
        primaryLabel="Appoint"
        primaryLoading={appoint.isPending}
      >
        <Form id={APPOINT_FORM} form={appointForm} layout="vertical" requiredMark={false} onFinish={(val) => appoint.mutate(val)}>
          <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: "Choose someone" }]} extra="They'll report directly to Admin. Their team starts empty.">
            <EmployeePicker />
          </Form.Item>
          <ManagerDateField />
          {canPermissions && (
            <Form.Item name="grantLeaveApproval" valuePropName="checked" extra="A new manager can do nothing until you grant it. Leave this unticked to decide later.">
              <Checkbox>Also let them approve their team's leave</Checkbox>
            </Form.Item>
          )}
        </Form>
      </SideDrawer>

      <ConfirmModal
        open={leaveChange !== null}
        onCancel={() => {
          if (!leaveApproval.isPending) setLeaveChange(null);
        }}
        onConfirm={() => leaveChange && leaveApproval.mutate({ employeeId: leaveChange.m.employeeId, grant: leaveChange.grant })}
        loading={leaveApproval.isPending}
        danger={leaveChange?.grant === false}
        title={leaveChange ? (leaveChange.grant ? `Let ${leaveChange.m.name} view and approve their team's leave?` : `Stop ${leaveChange.m.name} approving leave?`) : ""}
        description={leaveChange?.grant === false ? "They keep their team; they just can't approve its leave. Recorded in the audit log." : "Recorded in the audit log. You can take it away again at any time."}
        confirmLabel={leaveChange?.grant ? "Grant" : "Remove"}
      />

      <ConfirmModal
        open={removing !== null}
        onCancel={() => {
          if (!remove.isPending) setRemoving(null);
        }}
        onConfirm={() => removeForm.submit()}
        loading={remove.isPending}
        danger
        width={520}
        title={removing ? `Remove ${removing.name} as a manager` : ""}
        description="The role change takes effect straight away and is recorded in the audit log."
        confirmLabel="Remove manager role"
      >
        <Form form={removeForm} layout="vertical" requiredMark={false} onFinish={(val) => remove.mutate(val)}>
          <Form.Item name="newManagerId" label="Their new manager" extra="They become a regular employee, so they need a manager of their own. Leave empty to put them on the Unassigned list.">
            <Select allowClear placeholder="Choose a manager" options={managerSelect(removing?.employeeId)} showSearch optionFilterProp="label" />
          </Form.Item>
          <ManagerDateField />
        </Form>
      </ConfirmModal>
    </>
  );
}
