import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Select, Table, Tooltip } from "antd";
import { LockOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import { PERMISSION_CATALOG, PERMISSION_GROUPS, PERMISSION_KEYS, type PermissionKey } from "@shared/constants/permissions";
import type { DataScope } from "@shared/constants/roles";
import * as accessApi from "../../../api/access";
import type { RoleDefinition } from "../../../api/access";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, CardGrid, ConfirmModal, PageHeader, Panel, QueryState, Skel, SkeletonTable, Stack, StatusChip, toast, useIsPhone } from "../../../ui";

const SCOPE_LABELS: Record<DataScope, string> = { SELF: "Self only", TEAM: "Their team", ALL: "Everyone" };

type Row = { kind: "group"; group: string } | { kind: "perm"; key: PermissionKey };
type Draft = { permissions: string[]; dataScope: DataScope };

const sameSet = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

/** Why a cell can't be ticked, or undefined when it can (the server re-checks all of it). */
function lockReason(role: RoleDefinition, key: PermissionKey, checked: boolean): string | undefined {
  if (role.locked) return "A Super Admin always has every permission";
  if (role.managerLocked) return "Managers start with nothing. Grant each manager what they need in Manager Management.";
  // E2: the Manager role only ever holds manager-grantable keys (fixed in code; the server refuses anything else).
  if (role.code === "MANAGER" && !PERMISSION_CATALOG[key].managerGrantable && !checked) return "Managers can never hold this — they only get permissions limited to their own team. Fixed in code.";
  return undefined;
}

function PermissionLabel({ k }: { k: PermissionKey }) {
  const p = PERMISSION_CATALOG[k];
  return (
    <span style={{ display: "block", minWidth: 0 }}>
      <span style={{ color: v.textPrimary, fontWeight: fw.medium }}>{p.label}</span>
      {p.meta && (
        <span style={{ marginLeft: space[2] }}>
          <StatusChip tone="purple" title="Controls who can do what">
            access
          </StatusChip>
        </span>
      )}
      <span style={{ display: "block", fontSize: fs.xs, color: v.textSecondary, wordBreak: "break-all" }}>{k}</span>
    </span>
  );
}

// Admin Tools → Roles & Permissions (Phase 5 commit E1). One column per
// role, one row per permission grouped as in the catalog. Super Admins edit
// (rules 2–4 are re-checked server-side); holders of role.view see it
// read-only. The Super Admin column is locked: it always has everything.
// Role changes are audited, so a save is confirmed and never optimistic.
// On phones the matrix becomes one role at a time, grouped.
export function RolesPermissionsPage() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("SUPER_ADMIN");
  const { data: roles = [], isLoading, error, refetch } = useQuery({ queryKey: ["access", "roles"], queryFn: accessApi.listRoles, retry: false });

  // Unsaved edits per role code.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirming, setConfirming] = useState<RoleDefinition | null>(null);
  const [phoneRole, setPhoneRole] = useState<string>();
  const draftOf = (r: RoleDefinition): Draft => drafts[r.code] ?? { permissions: r.permissions, dataScope: r.dataScope };
  const isDirty = (r: RoleDefinition) => {
    const d = drafts[r.code];
    return Boolean(d) && (d!.dataScope !== r.dataScope || !sameSet(d!.permissions, r.permissions));
  };
  const discard = (code: string) => setDrafts(({ [code]: _, ...rest }) => rest);

  const save = useMutation({
    mutationFn: (r: RoleDefinition) => {
      const d = draftOf(r);
      return accessApi.updateRole(r.code, { permissions: d.permissions, dataScope: d.dataScope });
    },
    onSuccess: (role) => {
      void queryClient.invalidateQueries({ queryKey: ["access"] });
      discard(role.code);
      setConfirming(null);
      toast.success(`${role.name} saved. Everyone holding it sees the change straight away.`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't save the role.")),
  });

  const rows: Row[] = useMemo(
    () => PERMISSION_GROUPS.flatMap((group) => [{ kind: "group" as const, group }, ...PERMISSION_KEYS.filter((k) => PERMISSION_CATALOG[k].group === group).map((key) => ({ kind: "perm" as const, key }))]),
    [],
  );

  const editable = (r: RoleDefinition) => isSuperAdmin && !r.locked && !r.managerLocked;
  const toggle = (r: RoleDefinition, key: string, on: boolean) => {
    const d = draftOf(r);
    setDrafts({ ...drafts, [r.code]: { ...d, permissions: on ? [...d.permissions, key] : d.permissions.filter((k) => k !== key) } });
  };
  const setScope = (r: RoleDefinition, dataScope: DataScope) => setDrafts({ ...drafts, [r.code]: { ...draftOf(r), dataScope } });
  const scopeOptions = (r: RoleDefinition) => (r.code === "MANAGER" ? (["SELF", "TEAM"] as const) : (["SELF", "TEAM", "ALL"] as const)).map((s) => ({ value: s, label: SCOPE_LABELS[s] }));

  const scopeSelect = (role: RoleDefinition, block = true) => (
    <Select<DataScope>
      size={phone ? "middle" : "small"}
      style={{ width: block ? "100%" : 180 }}
      disabled={!editable(role)}
      value={draftOf(role).dataScope}
      aria-label={`${role.name} data scope`}
      onChange={(s) => setScope(role, s)}
      options={scopeOptions(role)}
    />
  );
  const saveButtons = (role: RoleDefinition, small = true) =>
    editable(role) && (
      <div style={{ display: "flex", gap: space[1], justifyContent: "center", flexWrap: "wrap" }}>
        <Button size={small ? "small" : "middle"} type="primary" icon={<SaveOutlined />} disabled={!isDirty(role)} onClick={() => setConfirming(role)}>
          Save
        </Button>
        {isDirty(role) && (
          <Tooltip title="Discard unsaved changes">
            <Button size={small ? "small" : "middle"} icon={<UndoOutlined />} aria-label={`Discard changes to ${role.name}`} onClick={() => discard(role.code)} />
          </Tooltip>
        )}
      </div>
    );

  const permissionCell = (role: RoleDefinition, key: PermissionKey) => {
    const checked = draftOf(role).permissions.includes(key);
    const reason = lockReason(role, key, checked);
    return (
      <Tooltip title={reason}>
        <Checkbox
          aria-label={`${role.name}: ${PERMISSION_CATALOG[key].label}`}
          checked={checked}
          disabled={!editable(role) || Boolean(role.code === "MANAGER" && reason)}
          onChange={(e) => toggle(role, key, e.target.checked)}
        />
      </Tooltip>
    );
  };

  // What the confirm dialog lists: exactly what the save changes.
  const diff = confirming
    ? (() => {
        const d = draftOf(confirming);
        return {
          added: d.permissions.filter((k) => !confirming.permissions.includes(k)),
          removed: confirming.permissions.filter((k) => !d.permissions.includes(k)),
          scope: d.dataScope !== confirming.dataScope ? { from: confirming.dataScope, to: d.dataScope } : null,
        };
      })()
    : null;
  const labelOf = (k: string) => PERMISSION_CATALOG[k as PermissionKey]?.label ?? k;

  const activePhoneRole = roles.find((r) => r.code === phoneRole) ?? roles.find((r) => editable(r)) ?? roles[0];

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        subtitle="What each role may do, and whose records it reaches. A person gets everything from all their roles, plus any exceptions on their profile's Access tab."
      />
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        skeleton={
          <Stack>
            <CardGrid min={220} gap={space[4]}>
              {[0, 1, 2, 3].map((i) => (
                <Panel key={i}>
                  <Skel w="50%" h={16} style={{ marginBottom: space[3] }} />
                  <Skel w="70%" h={12} />
                </Panel>
              ))}
            </CardGrid>
            <SkeletonTable rows={10} columns={5} />
          </Stack>
        }
      >
        <Stack>
          {!isSuperAdmin && <ApprovalBanner tone="info" title="Read-only: only a Super Admin can change roles." />}

          <CardGrid min={220} gap={space[4]}>
            {roles.map((role) => {
              const d = draftOf(role);
              return (
                <article
                  key={role.code}
                  aria-label={role.name}
                  style={{ border: `1px solid ${isDirty(role) ? v.accent : v.borderDefault}`, borderRadius: radius.lg, padding: space[4], background: v.bgSurface, display: "flex", flexDirection: "column", gap: space[1] }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                    <span style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>
                      {(role.locked || role.managerLocked) && <LockOutlined aria-label="Locked" style={{ marginRight: space[1] }} />}
                      {role.name}
                    </span>
                    {role.locked && <StatusChip tone="neutral">Everything</StatusChip>}
                    {role.managerLocked && <StatusChip tone="neutral">Per manager</StatusChip>}
                    {isDirty(role) && <StatusChip tone="warning">Unsaved</StatusChip>}
                  </div>
                  {role.description && <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{role.description}</span>}
                  <span style={{ color: v.textBody, fontSize: fs.table }}>
                    {role.holderCount} {role.holderCount === 1 ? "person" : "people"} · {SCOPE_LABELS[d.dataScope]} · {role.locked ? "all" : d.permissions.length} permission{d.permissions.length === 1 && !role.locked ? "" : "s"}
                  </span>
                </article>
              );
            })}
          </CardGrid>

          {phone && activePhoneRole ? (
            <Panel title="Permissions" subtitle="One role at a time. Pick a role, then tick what it may do.">
              <Stack gap={space[4]}>
                <Select
                  aria-label="Role"
                  style={{ width: "100%" }}
                  value={activePhoneRole.code}
                  onChange={setPhoneRole}
                  options={roles.map((r) => ({ value: r.code, label: `${r.name}${isDirty(r) ? " (unsaved)" : ""}` }))}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
                  <span style={{ fontSize: fs.sm, color: v.textSecondary }}>Data scope</span>
                  {scopeSelect(activePhoneRole)}
                </div>
                {activePhoneRole.locked && <ApprovalBanner tone="info" title="A Super Admin always has every permission." />}
                {activePhoneRole.managerLocked && <ApprovalBanner tone="info" title="Managers start with nothing. Grant each manager what they need in Manager Management." />}
                {PERMISSION_GROUPS.map((group) => (
                  <section key={group} aria-label={group}>
                    <h3 style={{ margin: `0 0 ${space[2]}px`, fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary }}>{group}</h3>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${v.borderDefault}`, borderRadius: radius.md }}>
                      {PERMISSION_KEYS.filter((k) => PERMISSION_CATALOG[k].group === group).map((k, i) => (
                        <li key={k} style={{ display: "flex", alignItems: "center", gap: space[3], minHeight: 44, padding: `${space[2]}px ${space[3]}px`, borderTop: i === 0 ? undefined : `1px solid ${v.borderDefault}` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <PermissionLabel k={k} />
                            <span style={{ display: "block", fontSize: fs.xs, color: v.textSecondary }}>{PERMISSION_CATALOG[k].description}</span>
                          </div>
                          {permissionCell(activePhoneRole, k)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {saveButtons(activePhoneRole, false)}
              </Stack>
            </Panel>
          ) : (
            <Panel title="Permission matrix" subtitle="Hover a permission or a locked box to see why. Changes apply to everyone holding the role once saved." flush>
              <Table<Row>
                rowKey={(r) => (r.kind === "group" ? `g:${r.group}` : r.key)}
                dataSource={rows}
                pagination={false}
                size="small"
                sticky
                scroll={{ x: 260 + roles.length * 150 }}
                columns={[
                  {
                    title: "Permission",
                    key: "perm",
                    fixed: "left",
                    width: 260,
                    onCell: (r) => (r.kind === "group" ? { colSpan: roles.length + 1, style: { background: v.bgSubtle } } : {}),
                    render: (_: unknown, r) =>
                      r.kind === "group" ? (
                        <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.group}</span>
                      ) : (
                        <Tooltip title={PERMISSION_CATALOG[r.key].description} placement="right">
                          <span tabIndex={0}>
                            <PermissionLabel k={r.key} />
                          </span>
                        </Tooltip>
                      ),
                  },
                  ...roles.map((role) => ({
                    key: role.code,
                    width: 150,
                    align: "center" as const,
                    title: (
                      <div style={{ display: "flex", flexDirection: "column", gap: space[1], width: "100%" }}>
                        <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>
                          {(role.locked || role.managerLocked) && <LockOutlined aria-label="Locked" />} {role.name}
                        </span>
                        <span style={{ fontSize: fs.xs, color: v.textSecondary, fontWeight: fw.regular }}>
                          {role.holderCount} {role.holderCount === 1 ? "person" : "people"}
                        </span>
                        {scopeSelect(role)}
                        {saveButtons(role)}
                      </div>
                    ),
                    onCell: (r: Row) => (r.kind === "group" ? { colSpan: 0 } : {}),
                    render: (_: unknown, r: Row) => (r.kind === "group" ? null : permissionCell(role, r.key)),
                  })),
                ]}
              />
            </Panel>
          )}
        </Stack>
      </QueryState>

      <ConfirmModal
        open={confirming !== null}
        onCancel={() => {
          if (!save.isPending) setConfirming(null);
        }}
        onConfirm={() => confirming && save.mutate(confirming)}
        loading={save.isPending}
        danger={Boolean(diff && (diff.removed.length > 0 || diff.scope))}
        title={confirming ? `Save changes to ${confirming.name}?` : ""}
        description={confirming ? `${confirming.holderCount} ${confirming.holderCount === 1 ? "person holds" : "people hold"} this role. They get the change straight away, and it is recorded in the audit log.` : undefined}
        confirmLabel="Save role"
      >
        {diff && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[2], fontSize: fs.table, color: v.textBody, textAlign: "left" }}>
            {diff.scope && (
              <div>
                <strong>Data scope:</strong> {SCOPE_LABELS[diff.scope.from]} → {SCOPE_LABELS[diff.scope.to]}
              </div>
            )}
            {diff.added.length > 0 && (
              <div>
                <strong>Adds:</strong> {diff.added.map(labelOf).join(", ")}
              </div>
            )}
            {diff.removed.length > 0 && (
              <div>
                <strong>Removes:</strong> {diff.removed.map(labelOf).join(", ")}
              </div>
            )}
          </div>
        )}
      </ConfirmModal>
    </>
  );
}
