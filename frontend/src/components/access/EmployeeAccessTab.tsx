import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Collapse, Form, Input, Select, Tooltip } from "antd";
import { CheckOutlined, CloseOutlined, KeyOutlined, LockOutlined, MailOutlined, SafetyOutlined, UnlockOutlined } from "@ant-design/icons";
import { PERMISSION_CATALOG, PERMISSION_GROUPS, type PermissionKey } from "@shared/constants/permissions";
import * as accessApi from "../../api/access";
import type { EmployeeAccess, EmployeePermission } from "../../api/access";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, Panel, SkeletonCard, StatusChip, isForbidden, toast, useIsPhone } from "../../ui";

const SCOPE_LABELS = { SELF: "Self only", TEAM: "Their team", ALL: "Everyone" } as const;
const ACCOUNT_TONE = { ACTIVE: "success", INVITED: "purple", SUSPENDED: "warning", DEACTIVATED: "neutral" } as const;
const REASON_FORM_ID = "access-reason-form";

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
// Every change here is audited: nothing is optimistic — the screen updates from the server's answer.
export function EmployeeAccessTab({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const key = ["access", "employee", employeeId];
  const { data: access, isLoading, isError, error, refetch } = useQuery({ queryKey: key, queryFn: () => accessApi.getEmployeeAccess(employeeId), retry: false });
  const { data: roles = [] } = useQuery({ queryKey: ["access", "roles"], queryFn: accessApi.listRoles, enabled: Boolean(access?.can.editRoles) });
  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);
  const [removingRole, setRemovingRole] = useState<{ code: string; name: string } | null>(null);
  const [form] = Form.useForm<{ reason: string }>();

  const applied = (a: EmployeeAccess | void) => {
    if (a) queryClient.setQueryData(key, a);
    else void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["access", "roles"] });
  };
  const roleChange = useMutation({
    mutationFn: (vars: { op: "add" | "remove"; code: string }) => (vars.op === "add" ? accessApi.assignRole(employeeId, vars.code) : accessApi.removeRole(employeeId, vars.code)),
    onSuccess: (a, vars) => {
      applied(a);
      toast.success(vars.op === "add" ? "Role added." : "Role removed.");
      setRemovingRole(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't change the role.")),
  });
  const runPrompt = useMutation({
    mutationFn: (reason: string) => prompt!.run(reason),
    onSuccess: (a) => {
      applied(a as EmployeeAccess | void);
      toast.success(prompt!.success);
      setPrompt(null);
      form.resetFields();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "That didn't work.")),
  });

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: space[4], marginTop: space[2] }} aria-busy="true" aria-label="Loading access">
        <SkeletonCard lines={1} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={5} />
      </div>
    );
  }
  if (isError || !access) {
    return isForbidden(error) || !error ? (
      <EmptyState compact kind="forbidden" title="You can't view this person's access." description={null} />
    ) : (
      <EmptyState compact kind="error" title="Couldn't load this person's access." onRetry={() => void refetch()} />
    );
  }

  const can = access.can;
  const byKey = new Map(access.permissions.map((p) => [p.key, p]));
  const assignable = roles.filter((r) => !access.roles.some((h) => h.code === r.code));

  const overridePrompt = (p: EmployeePermission, effect: "GRANT" | "REVOKE" | "CLEAR") => {
    const label = PERMISSION_CATALOG[p.key as PermissionKey]?.label ?? p.key;
    form.resetFields();
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
  const openPrompt = (p: ReasonPrompt) => {
    form.resetFields();
    setPrompt(p);
  };

  const source = (p: EmployeePermission) => {
    if (p.override) {
      return (
        <Tooltip title={`${p.override.reason} — ${formatDateTime(p.override.createdAt)}`}>
          <span tabIndex={0} style={{ borderRadius: radius.xs }} aria-label={`${p.override.effect === "GRANT" ? "Granted" : "Revoked"}: ${p.override.reason}`}>
            <StatusChip tone={p.override.effect === "GRANT" ? "success" : "danger"}>{p.override.effect === "GRANT" ? "Granted" : "Revoked"}</StatusChip>
          </span>
        </Tooltip>
      );
    }
    if (p.inheritedFrom.length) return <span style={{ color: v.textSecondary }}>From {p.inheritedFrom.map((c) => access.roles.find((r) => r.code === c)?.name ?? c).join(", ")}</span>;
    return null;
  };

  const permissionAction = (p: EmployeePermission) =>
    p.override ? (
      <Button size={phone ? "middle" : "small"} block={phone} onClick={() => overridePrompt(p, "CLEAR")}>
        Remove exception
      </Button>
    ) : p.effective ? (
      <Button size={phone ? "middle" : "small"} block={phone} danger onClick={() => overridePrompt(p, "REVOKE")}>
        Revoke for them
      </Button>
    ) : access.isManager && !PERMISSION_CATALOG[p.key as PermissionKey]?.managerGrantable ? (
      <StatusChip tone="neutral" title="A manager can only ever hold permissions limited to their own team. This list is fixed in code.">
        Not for managers
      </StatusChip>
    ) : (
      <Button size={phone ? "middle" : "small"} block={phone} onClick={() => overridePrompt(p, "GRANT")}>
        Grant to them
      </Button>
    );

  const permLabel = (p: EmployeePermission) => PERMISSION_CATALOG[p.key as PermissionKey]?.label ?? p.key;
  const hasIt = (p: EmployeePermission) =>
    p.effective ? (
      <span style={{ color: v.success, display: "inline-flex", alignItems: "center", gap: space[1] }}>
        <CheckOutlined aria-hidden />
        <span style={{ fontSize: fs.sm, fontWeight: fw.semibold }}>Yes</span>
      </span>
    ) : (
      <span style={{ color: v.textSecondary }} aria-label="no">
        —
      </span>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: phone ? space[4] : space[5], marginTop: space[2] }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
        <StatusChip tone={ACCOUNT_TONE[access.status] ?? "neutral"}>Account {access.status.toLowerCase()}</StatusChip>
        <StatusChip tone={access.totpEnabled ? "info" : "neutral"} icon={<SafetyOutlined aria-hidden />}>
          2FA {access.totpEnabled ? "on" : "off"}
        </StatusChip>
        {access.locked && (
          <StatusChip tone="danger" icon={<LockOutlined aria-hidden />}>
            Locked out
          </StatusChip>
        )}
        <StatusChip tone="neutral">Sees records of: {SCOPE_LABELS[access.dataScope]}</StatusChip>
      </div>

      {access.isSuperAdmin && <ApprovalBanner tone="info" title="Super Admin: every permission, always, over everyone's records. This can't be narrowed by anyone — including another Super Admin." />}

      <Panel title="Roles" subtitle={can.editRoles ? undefined : "Only a Super Admin can change roles."}>
        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
          {access.roles.length === 0 && <span style={{ color: v.textSecondary }}>No roles assigned.</span>}
          {access.roles.map((r) => (
            <span
              key={r.code}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: space[1],
                padding: `${space[1]}px ${can.editRoles ? space[1] : space[3]}px ${space[1]}px ${space[3]}px`,
                border: `1px solid ${v.borderDefault}`,
                borderRadius: radius.pill,
                background: v.bgSubtle,
                color: v.textPrimary,
                fontSize: fs.table,
                fontWeight: fw.medium,
              }}
            >
              {r.name}
              {can.editRoles && (
                <Tooltip title={`Remove ${r.name}`}>
                  <Button type="text" size="small" shape="circle" icon={<CloseOutlined />} aria-label={`Remove ${r.name}`} onClick={() => setRemovingRole({ code: r.code, name: r.name })} />
                </Tooltip>
              )}
            </span>
          ))}
          {can.editRoles && assignable.length > 0 && (
            <Select
              aria-label="Add a role"
              style={{ width: phone ? "100%" : 200 }}
              placeholder="Add a role"
              value={null}
              loading={roleChange.isPending && roleChange.variables?.op === "add"}
              disabled={roleChange.isPending}
              options={assignable.map((r) => ({ value: r.code, label: r.name }))}
              onChange={(code: string) => roleChange.mutate({ op: "add", code })}
            />
          )}
        </div>
      </Panel>

      {can.securityActions && (
        <Panel title="Sign-in security" subtitle="Each action asks for a reason, is kept in the audit log and emails the person.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], flexDirection: phone ? "column" : "row" }}>
            <Button
              icon={<KeyOutlined />}
              disabled={!access.totpEnabled}
              block={phone}
              onClick={() =>
                openPrompt({ title: "Reset two-factor authentication", okText: "Reset 2FA", danger: true, description: "Clears their authenticator and backup codes and signs them out everywhere. Verify who you're talking to first. They'll be emailed that you did this.", run: (reason) => accessApi.resetTwoFactor(employeeId, reason), success: "2FA reset — they've been signed out." })
              }
            >
              Reset 2FA
            </Button>
            <Button
              icon={<UnlockOutlined />}
              disabled={!access.locked}
              block={phone}
              onClick={() => openPrompt({ title: "Unlock this account", okText: "Unlock", description: "Clears the lockout after failed sign-in attempts. They'll be emailed that you did this.", run: (reason) => accessApi.unlockAccount(employeeId, reason), success: "Account unlocked." })}
            >
              Unlock
            </Button>
            <Button
              icon={<MailOutlined />}
              disabled={access.status !== "ACTIVE"}
              block={phone}
              onClick={() =>
                openPrompt({ title: "Send a password reset link", okText: "Send link", description: "Emails a single-use link (valid 1 hour) to their personal email on file, with a note that you sent it.", run: (reason) => accessApi.sendPasswordReset(employeeId, reason), success: "Password reset link sent." })
              }
            >
              Send password reset
            </Button>
          </div>
        </Panel>
      )}

      <Panel title="What they can do" subtitle="Grouped by area. Open a group to see each permission and where it comes from.">
        <Collapse
          items={PERMISSION_GROUPS.map((group) => {
            const perms = access.permissions.filter((p) => PERMISSION_CATALOG[p.key as PermissionKey]?.group === group);
            const on = perms.filter((p) => p.effective).length;
            const exceptions = perms.filter((p) => p.override).length;
            return {
              key: group,
              label: (
                <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                  <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{group}</span>
                  <span className="ws-num" style={{ color: v.textSecondary, fontSize: fs.sm }}>
                    {on}/{perms.length}
                  </span>
                  {exceptions > 0 && (
                    <StatusChip tone="warning">
                      {exceptions} exception{exceptions > 1 ? "s" : ""}
                    </StatusChip>
                  )}
                </span>
              ),
              children: (
                <DataTable<EmployeePermission>
                  rowKey="key"
                  density="compact"
                  pagination={false}
                  dataSource={perms}
                  mobile={{
                    title: (p) => permLabel(p),
                    subtitle: (p) => PERMISSION_CATALOG[p.key as PermissionKey]?.description,
                    status: (p) => hasIt(p),
                    fields: [{ label: "Why", render: (p) => source(byKey.get(p.key)!) ?? "—" }],
                    actions: can.editOverrides ? permissionAction : undefined,
                  }}
                  columns={[
                    {
                      title: "Permission",
                      key: "label",
                      render: (_: unknown, p) => (
                        <Tooltip title={PERMISSION_CATALOG[p.key as PermissionKey]?.description}>
                          <span>{permLabel(p)}</span>
                        </Tooltip>
                      ),
                    },
                    { title: "Has it", key: "effective", width: 90, render: (_: unknown, p) => hasIt(p) },
                    { title: "Why", key: "source", render: (_: unknown, p) => source(byKey.get(p.key)!) },
                    ...(can.editOverrides ? [{ title: "", key: "actions", width: 200, align: "right" as const, render: (_: unknown, p: EmployeePermission) => permissionAction(p) }] : []),
                  ]}
                />
              ),
            };
          })}
        />
      </Panel>

      <ConfirmModal
        open={prompt !== null}
        onCancel={() => !runPrompt.isPending && setPrompt(null)}
        onConfirm={() => form.submit()}
        title={prompt?.title}
        description={prompt?.description}
        confirmLabel={prompt?.okText}
        danger={prompt?.danger}
        loading={runPrompt.isPending}
      >
        <Form id={REASON_FORM_ID} form={form} layout="vertical" requiredMark={false} onFinish={(vals) => runPrompt.mutate(vals.reason)}>
          <Form.Item name="reason" label="Reason (kept in the audit log)" rules={[{ required: true, min: 3, message: "Give a reason (at least a few words)." }]} style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} maxLength={500} autoFocus />
          </Form.Item>
        </Form>
      </ConfirmModal>

      <ConfirmModal
        open={removingRole !== null}
        onCancel={() => !roleChange.isPending && setRemovingRole(null)}
        onConfirm={() => removingRole && roleChange.mutate({ op: "remove", code: removingRole.code })}
        title={`Remove ${removingRole?.name ?? "this role"}?`}
        description="They lose what this role gives them, unless another role or an exception still grants it. You can add it back later."
        confirmLabel="Remove"
        danger
        loading={roleChange.isPending && roleChange.variables?.op === "remove"}
      />
    </div>
  );
}
