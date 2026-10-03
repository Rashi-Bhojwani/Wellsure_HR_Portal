import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Flex, Result, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { LockOutlined, SaveOutlined } from "@ant-design/icons";
import { PERMISSION_CATALOG, PERMISSION_GROUPS, PERMISSION_KEYS, type PermissionKey } from "@shared/constants/permissions";
import type { DataScope } from "@shared/constants/roles";
import * as accessApi from "../../../api/access";
import type { RoleDefinition } from "../../../api/access";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;
const SCOPE_LABELS: Record<DataScope, string> = { SELF: "Self only", TEAM: "Their team", ALL: "Everyone" };

type Row = { kind: "group"; group: string } | { kind: "perm"; key: PermissionKey };

// Admin Tools → Roles & Permissions (Phase 5 commit E1). One column per
// role, one row per permission grouped as in the catalog. Super Admins edit
// (rules 2–4 are re-checked server-side); holders of role.view see it
// read-only. The Super Admin column is locked: it always has everything.
export function RolesPermissionsPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("SUPER_ADMIN");
  const { data: roles = [], isLoading, isError, error } = useQuery({ queryKey: ["access", "roles"], queryFn: accessApi.listRoles, retry: false });

  // Unsaved edits per role code.
  const [drafts, setDrafts] = useState<Record<string, { permissions: string[]; dataScope: DataScope }>>({});
  const draftOf = (r: RoleDefinition) => drafts[r.code] ?? { permissions: r.permissions, dataScope: r.dataScope };
  const isDirty = (r: RoleDefinition) => {
    const d = drafts[r.code];
    return Boolean(d) && (d!.dataScope !== r.dataScope || [...d!.permissions].sort().join() !== [...r.permissions].sort().join());
  };

  const save = useMutation({
    mutationFn: (r: RoleDefinition) => {
      const d = draftOf(r);
      return accessApi.updateRole(r.code, { permissions: d.permissions, dataScope: d.dataScope });
    },
    onSuccess: (role) => {
      void queryClient.invalidateQueries({ queryKey: ["access"] });
      setDrafts(({ [role.code]: _, ...rest }) => rest);
      void message.success(`${role.name} saved. Everyone holding it sees the change straight away.`);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't save the role.")),
  });

  const rows: Row[] = useMemo(
    () => PERMISSION_GROUPS.flatMap((group) => [{ kind: "group" as const, group }, ...PERMISSION_KEYS.filter((k) => PERMISSION_CATALOG[k].group === group).map((key) => ({ kind: "perm" as const, key }))]),
    [],
  );

  if (isError) {
    const status = (error as { response?: { status?: number } }).response?.status;
    return <Result status={status === 403 ? "403" : "error"} title={status === 403 ? "You can't view roles and permissions" : "Couldn't load roles"} />;
  }

  const editable = (r: RoleDefinition) => isSuperAdmin && !r.locked && !r.managerLocked;
  const toggle = (r: RoleDefinition, key: string, on: boolean) => {
    const d = draftOf(r);
    setDrafts({ ...drafts, [r.code]: { ...d, permissions: on ? [...d.permissions, key] : d.permissions.filter((k) => k !== key) } });
  };

  return (
    <Flex vertical gap={16}>
      <div>
        <Title level={3} style={{ margin: 0 }}>
          Roles & Permissions
        </Title>
        <Text type="secondary">What each role may do, and whose records it reaches. A person gets everything from all their roles, plus any exceptions on their profile's Access tab.</Text>
      </div>
      {!isSuperAdmin && <Alert type="info" showIcon title="Read-only: only a Super Admin can change roles." />}
      <Card styles={{ body: { padding: 0 } }}>
        <Table<Row>
          rowKey={(r) => (r.kind === "group" ? `g:${r.group}` : r.key)}
          loading={isLoading}
          dataSource={rows}
          pagination={false}
          size="small"
          sticky
          scroll={{ x: 220 + roles.length * 130 }}
          columns={[
            {
              title: "Permission",
              key: "perm",
              fixed: "left",
              width: 260,
              onCell: (r) => (r.kind === "group" ? { colSpan: roles.length + 1, style: { background: "var(--ant-color-fill-quaternary)" } } : {}),
              render: (_: unknown, r) =>
                r.kind === "group" ? (
                  <Text strong>{r.group}</Text>
                ) : (
                  <Tooltip title={PERMISSION_CATALOG[r.key].description} placement="right">
                    <span>
                      {PERMISSION_CATALOG[r.key].label}
                      {PERMISSION_CATALOG[r.key].meta && (
                        <Tag color="purple" style={{ marginLeft: 6 }}>
                          access
                        </Tag>
                      )}
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {r.key}
                      </Text>
                    </span>
                  </Tooltip>
                ),
            },
            ...roles.map((role) => ({
              key: role.code,
              width: 130,
              align: "center" as const,
              title: (
                <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                  <Text strong>
                    {(role.locked || role.managerLocked) && <LockOutlined />} {role.name}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {role.holderCount} {role.holderCount === 1 ? "person" : "people"}
                  </Text>
                  <Select<DataScope>
                    size="small"
                    style={{ width: "100%" }}
                    disabled={!editable(role)}
                    value={draftOf(role).dataScope}
                    aria-label={`${role.name} data scope`}
                    onChange={(dataScope) => setDrafts({ ...drafts, [role.code]: { ...draftOf(role), dataScope } })}
                    options={(role.code === "MANAGER" ? (["SELF", "TEAM"] as const) : (["SELF", "TEAM", "ALL"] as const)).map((s) => ({ value: s, label: SCOPE_LABELS[s] }))}
                  />
                  {editable(role) && (
                    <Button size="small" type="primary" icon={<SaveOutlined />} disabled={!isDirty(role)} loading={save.isPending && save.variables?.code === role.code} onClick={() => save.mutate(role)}>
                      Save
                    </Button>
                  )}
                </Space>
              ),
              onCell: (r: Row) => (r.kind === "group" ? { colSpan: 0 } : {}),
              render: (_: unknown, r: Row) => {
                if (r.kind === "group") return null;
                const checked = draftOf(role).permissions.includes(r.key);
                // E2: the Manager role only ever holds manager-grantable keys
                // (fixed in code; the server refuses anything else).
                const metaToManager = role.code === "MANAGER" && !PERMISSION_CATALOG[r.key].managerGrantable;
                return (
                  <Tooltip title={role.locked ? "A Super Admin always has every permission" : role.managerLocked ? "Managers start with nothing. Grant each manager what they need in Manager Management." : metaToManager ? "Managers can never hold this — they only get permissions limited to their own team. Fixed in code." : undefined}>
                    <Checkbox
                      aria-label={`${role.name}: ${PERMISSION_CATALOG[r.key].label}`}
                      checked={checked}
                      disabled={!editable(role) || Boolean(metaToManager && !checked)}
                      onChange={(e) => toggle(role, r.key, e.target.checked)}
                    />
                  </Tooltip>
                );
              },
            })),
          ]}
        />
      </Card>
    </Flex>
  );
}
