import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Collapse, Flex, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { CheckOutlined, CloseOutlined, KeyOutlined, LockOutlined, MailOutlined, SafetyOutlined, UnlockOutlined } from "@ant-design/icons";
import { PERMISSION_CATALOG, PERMISSION_GROUPS, type PermissionKey } from "@shared/constants/permissions";
import * as accessApi from "../../api/access";
import type { EmployeeAccess, EmployeePermission } from "../../api/access";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";

const { Text } = Typography;
const SCOPE_LABELS = { SELF: "Self only", TEAM: "Their team", ALL: "Everyone" } as const;

interface ReasonPrompt {
  title: string;
  okText: string;
  danger?: boolean;
  description?: string;
  run: (reason: string) => Promise<unknown>;
  success: string;
}

// Employee profile → Access (Phase 5 commit E1): this person's roles, what
// they can effectively do and why (inherited from a role, or a per-user
// exception with its reason), and the sign-in security actions. The `can`
// flags from the server decide what's offered; the server re-checks all of it.
export function EmployeeAccessTab({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const key = ["access", "employee", employeeId];
  const { data: access, isLoading, isError } = useQuery({ queryKey: key, queryFn: () => accessApi.getEmployeeAccess(employeeId), retry: false });
  const { data: roles = [] } = useQuery({ queryKey: ["access", "roles"], queryFn: accessApi.listRoles, enabled: Boolean(access?.can.editRoles) });
  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);
  const [form] = Form.useForm<{ reason: string }>();

  const applied = (a: EmployeeAccess | void) => {
    if (a) queryClient.setQueryData(key, a);
    else void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["access", "roles"] });
  };
  const roleChange = useMutation({
    mutationFn: (v: { op: "add" | "remove"; code: string }) => (v.op === "add" ? accessApi.assignRole(employeeId, v.code) : accessApi.removeRole(employeeId, v.code)),
    onSuccess: (a, v) => {
      applied(a);
      void message.success(v.op === "add" ? "Role added." : "Role removed.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't change the role.")),
  });
  const unlock = useMutation({
    mutationFn: () => accessApi.unlockAccount(employeeId),
    onSuccess: (a) => {
      applied(a);
      void message.success("Account unlocked.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't unlock the account.")),
  });
  const runPrompt = useMutation({
    mutationFn: (reason: string) => prompt!.run(reason),
    onSuccess: (a) => {
      applied(a as EmployeeAccess | void);
      void message.success(prompt!.success);
      setPrompt(null);
      form.resetFields();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "That didn't work.")),
  });

  if (isLoading) return <Text type="secondary">Loading…</Text>;
  if (isError || !access) return <Alert type="warning" showIcon title="You can't view this person's access." />;

  const can = access.can;
  const byKey = new Map(access.permissions.map((p) => [p.key, p]));
  const assignable = roles.filter((r) => !access.roles.some((h) => h.code === r.code));

  const overridePrompt = (p: EmployeePermission, effect: "GRANT" | "REVOKE" | "CLEAR") => {
    const label = PERMISSION_CATALOG[p.key as PermissionKey]?.label ?? p.key;
    setPrompt(
      effect === "CLEAR"
        ? { title: `Remove the exception for "${label}"`, okText: "Remove exception", description: "They go back to whatever their roles give them.", run: (reason) => accessApi.clearOverride(employeeId, p.key, reason), success: "Exception removed." }
        : {
            title: `${effect === "GRANT" ? "Grant" : "Revoke"} "${label}" for this person only`,
            okText: effect === "GRANT" ? "Grant" : "Revoke",
            danger: effect === "REVOKE",
            description: effect === "GRANT" ? "Applies on top of their roles, until removed." : "Takes it away even though a role gives it, until removed.",
            run: (reason) => accessApi.setOverride(employeeId, p.key, { effect, reason }),
            success: effect === "GRANT" ? "Granted." : "Revoked.",
          },
    );
  };

  const source = (p: EmployeePermission) => {
    if (p.override) {
      return (
        <Tooltip title={`${p.override.reason} — ${formatDateTime(p.override.createdAt)}`}>
          <Tag color={p.override.effect === "GRANT" ? "green" : "red"}>{p.override.effect === "GRANT" ? "Granted" : "Revoked"}</Tag>
        </Tooltip>
      );
    }
    if (p.inheritedFrom.length) return <Text type="secondary">From {p.inheritedFrom.map((c) => access.roles.find((r) => r.code === c)?.name ?? c).join(", ")}</Text>;
    return null;
  };

  return (
    <Flex vertical gap={16}>
      <Space wrap>
        <Tag color={access.status === "ACTIVE" ? "green" : "orange"}>Account {access.status.toLowerCase()}</Tag>
        <Tag icon={<SafetyOutlined />} color={access.totpEnabled ? "blue" : "default"}>
          2FA {access.totpEnabled ? "on" : "off"}
        </Tag>
        {access.locked && (
          <Tag icon={<LockOutlined />} color="red">
            Locked out
          </Tag>
        )}
        <Tag>Sees records of: {SCOPE_LABELS[access.dataScope]}</Tag>
      </Space>

      {access.isSuperAdmin && <Alert type="info" showIcon title="Super Admin: every permission, always, over everyone's records. This can't be narrowed by anyone — including another Super Admin." />}

      <Card size="small" title="Roles">
        <Flex gap={8} wrap align="center">
          {access.roles.map((r) => (
            <Tag key={r.code} style={{ padding: "2px 8px" }}>
              {r.name}
              {can.editRoles && (
                <Popconfirm title={`Remove ${r.name}?`} onConfirm={() => roleChange.mutate({ op: "remove", code: r.code })} okText="Remove">
                  <CloseOutlined aria-label={`Remove ${r.name}`} style={{ marginLeft: 6, cursor: "pointer" }} />
                </Popconfirm>
              )}
            </Tag>
          ))}
          {can.editRoles && assignable.length > 0 && (
            <Select
              size="small"
              style={{ width: 180 }}
              placeholder="Add a role"
              value={null}
              loading={roleChange.isPending}
              options={assignable.map((r) => ({ value: r.code, label: r.name }))}
              onChange={(code: string) => roleChange.mutate({ op: "add", code })}
            />
          )}
        </Flex>
        {!can.editRoles && (
          <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
            Only a Super Admin can change roles.
          </Text>
        )}
      </Card>

      {can.securityActions && (
        <Card size="small" title="Sign-in security">
          <Space wrap>
            <Button
              icon={<KeyOutlined />}
              disabled={!access.totpEnabled}
              onClick={() =>
                setPrompt({ title: "Reset two-factor authentication", okText: "Reset 2FA", danger: true, description: "Clears their authenticator and backup codes and signs them out everywhere. Verify who you're talking to first.", run: (reason) => accessApi.resetTwoFactor(employeeId, reason), success: "2FA reset — they've been signed out." })
              }
            >
              Reset 2FA
            </Button>
            <Button icon={<UnlockOutlined />} disabled={!access.locked} loading={unlock.isPending} onClick={() => unlock.mutate()}>
              Unlock
            </Button>
            <Button
              icon={<MailOutlined />}
              disabled={access.status !== "ACTIVE"}
              onClick={() =>
                setPrompt({ title: "Send a password reset link", okText: "Send link", description: "Emails a single-use link (valid 1 hour) to their personal email on file.", run: (reason) => accessApi.sendPasswordReset(employeeId, reason), success: "Password reset link sent." })
              }
            >
              Send password reset
            </Button>
          </Space>
        </Card>
      )}

      <Card size="small" title="What they can do">
        <Collapse
          size="small"
          items={PERMISSION_GROUPS.map((group) => {
            const perms = access.permissions.filter((p) => PERMISSION_CATALOG[p.key as PermissionKey]?.group === group);
            const on = perms.filter((p) => p.effective).length;
            const exceptions = perms.filter((p) => p.override).length;
            return {
              key: group,
              label: (
                <Space>
                  {group}
                  <Text type="secondary">
                    {on}/{perms.length}
                  </Text>
                  {exceptions > 0 && <Tag color="gold">{exceptions} exception{exceptions > 1 ? "s" : ""}</Tag>}
                </Space>
              ),
              children: (
                <Table<EmployeePermission>
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={perms}
                  columns={[
                    {
                      title: "Permission",
                      key: "label",
                      render: (_: unknown, p) => (
                        <Tooltip title={PERMISSION_CATALOG[p.key as PermissionKey]?.description}>
                          <span>{PERMISSION_CATALOG[p.key as PermissionKey]?.label ?? p.key}</span>
                        </Tooltip>
                      ),
                    },
                    { title: "Has it", key: "effective", width: 80, render: (_: unknown, p) => (p.effective ? <CheckOutlined style={{ color: "var(--ant-color-success)" }} aria-label="yes" /> : <Text type="secondary">—</Text>) },
                    { title: "Why", key: "source", render: (_: unknown, p) => source(byKey.get(p.key)!) },
                    ...(can.editOverrides
                      ? [
                          {
                            title: "",
                            key: "actions",
                            width: 200,
                            render: (_: unknown, p: EmployeePermission) =>
                              p.override ? (
                                <Button size="small" onClick={() => overridePrompt(p, "CLEAR")}>
                                  Remove exception
                                </Button>
                              ) : p.effective ? (
                                <Button size="small" danger onClick={() => overridePrompt(p, "REVOKE")}>
                                  Revoke for them
                                </Button>
                              ) : (
                                <Button size="small" onClick={() => overridePrompt(p, "GRANT")}>
                                  Grant to them
                                </Button>
                              ),
                          },
                        ]
                      : []),
                  ]}
                />
              ),
            };
          })}
        />
      </Card>

      <Modal title={prompt?.title} open={prompt !== null} okText={prompt?.okText} okButtonProps={{ danger: prompt?.danger }} confirmLoading={runPrompt.isPending} onOk={() => form.submit()} onCancel={() => setPrompt(null)} destroyOnHidden>
        {prompt?.description && <Text type="secondary">{prompt.description}</Text>}
        <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }} onFinish={(v) => runPrompt.mutate(v.reason)}>
          <Form.Item name="reason" label="Reason (kept in the audit log)" rules={[{ required: true, min: 3, message: "Give a reason (at least a few words)." }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
