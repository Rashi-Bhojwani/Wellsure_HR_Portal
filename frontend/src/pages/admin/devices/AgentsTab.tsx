import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Switch, Tooltip, Typography } from "antd";
import { CopyOutlined, DesktopOutlined, KeyOutlined, PlusOutlined } from "@ant-design/icons";
import * as biometricApi from "../../../api/biometric";
import type { AgentRow } from "../../../api/biometric";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, CardGrid, ConfirmModal, EmptyState, QueryState, Skel, StatusChip, toast, useIsPhone } from "../../../ui";
import { HealthChip } from "./DeviceHealthCells";
import { invalidateBiometric, when } from "./deviceLabels";

/** The key is shown exactly once; after this it exists only as a hash. Closing needs the explicit "I've stored it". */
function KeyModal({ shown, onClose }: { shown: { name: string; key: string } | null; onClose: () => void }) {
  const phone = useIsPhone();
  return (
    <Modal
      title={`Key for ${shown?.name ?? ""}`}
      open={!!shown}
      width={phone ? "100%" : 520}
      onOk={onClose}
      okText="I've stored it"
      cancelButtonProps={{ style: { display: "none" } }}
      closable={false}
      keyboard={false}
      maskClosable={false}
    >
      <ApprovalBanner
        tone="warning"
        title="Shown once"
        description="Copy this key into the agent's Windows Credential Manager entry now. It is stored only as a hash and can't be shown again — if it's lost, rotate the key."
        style={{ marginBottom: space[3] }}
      />
      <Typography.Paragraph copyable={{ icon: <CopyOutlined aria-label="Copy key" /> }} code style={{ wordBreak: "break-all", margin: 0 }}>
        {shown?.key}
      </Typography.Paragraph>
    </Modal>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: fs.xs, color: v.textSecondary }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: fs.table, color: v.textBody, wordBreak: "break-word" }}>{children}</dd>
    </div>
  );
}

export function AgentsTab() {
  const qc = useQueryClient();
  const phone = useIsPhone();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["biometric", "agents"], queryFn: biometricApi.listAgents });
  const [name, setName] = useState("");
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const [rotating, setRotating] = useState<AgentRow | null>(null);
  const [deactivating, setDeactivating] = useState<AgentRow | null>(null);
  const done = (r: { agent: AgentRow; key: string }) => {
    invalidateBiometric(qc);
    setShown({ name: r.agent.name, key: r.key });
  };
  const onError = (err: unknown) => toast.error(apiErrorMessage(err, "Could not update the agent."));
  const create = useMutation({
    mutationFn: () => biometricApi.createAgent(name),
    onSuccess: (r) => {
      setName("");
      done(r);
    },
    onError,
  });
  const rotate = useMutation({
    mutationFn: biometricApi.rotateAgentKey,
    onSuccess: (r) => {
      setRotating(null);
      done(r);
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (a: AgentRow) => biometricApi.updateAgent(a.id, { isActive: !a.isActive }),
    onSuccess: (_, a) => {
      invalidateBiometric(qc);
      setDeactivating(null);
      toast.success(a.isActive ? `${a.name} deactivated.` : `${a.name} reactivated.`);
    },
    onError,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <form
        aria-label="Add a sync agent"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
        style={{ display: "flex", gap: space[2], maxWidth: phone ? undefined : 480, flexWrap: phone ? "wrap" : "nowrap" }}
      >
        <Input placeholder="Agent name, e.g. C-10 office PC" value={name} onChange={(e) => setName(e.target.value)} aria-label="New agent name" style={{ flex: 1, minWidth: 0 }} />
        <Button type="primary" htmlType="submit" icon={<PlusOutlined />} disabled={!name.trim()} loading={create.isPending} block={phone}>
          Add agent
        </Button>
      </form>
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isEmpty={data.length === 0}
        skeleton={
          <CardGrid min={320} gap={space[4]}>
            {[0, 1].map((i) => (
              <div key={i} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5] }}>
                <Skel w="45%" h={18} style={{ marginBottom: space[3] }} />
                <Skel h={48} />
              </div>
            ))}
          </CardGrid>
        }
        empty={<EmptyState compact title="No sync agents yet" description="Add one for each office PC that reads a device on the LAN. Its key is shown once, when you add it." />}
      >
        <CardGrid min={320} gap={space[4]}>
          {data.map((a) => {
            const setAside = Number((a.lastHeartbeat as { quarantinedBatches?: number } | null)?.quarantinedBatches ?? 0);
            return (
              <article key={a.id} aria-label={a.name} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5], background: v.bgSurface, display: "flex", flexDirection: "column", gap: space[4], opacity: a.isActive ? 1 : 0.75 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
                  <span aria-hidden style={{ width: 44, height: 44, flex: "none", borderRadius: radius.pill, background: v.infoSubtle, color: v.infoText, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.xl }}>
                    <DesktopOutlined />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, wordBreak: "break-word" }}>{a.name}</div>
                    <code style={{ fontSize: fs.sm, color: v.textSecondary }}>{a.keyPrefix}…</code>
                  </div>
                  <HealthChip status={a.status} />
                </div>
                <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: `${space[3]}px ${space[4]}px`, margin: 0 }}>
                  <Fact label="Host / version">{a.host ? `${a.host} · v${a.version ?? "?"}` : <span style={{ color: v.textSecondary }}>Not connected yet</span>}</Fact>
                  <Fact label="Last heartbeat">{when(a.lastHeartbeatAt)}</Fact>
                  <Fact label="Set aside">
                    {setAside > 0 ? (
                      <Tooltip title="Batches of punches the server refused, kept on the agent PC and not in attendance. See INSTALL.md, 'Punches the server refused'.">
                        <span tabIndex={0}>
                          <StatusChip tone="danger">{`${setAside} refused`}</StatusChip>
                        </span>
                      </Tooltip>
                    ) : (
                      "—"
                    )}
                  </Fact>
                  <Fact label="Devices">
                    {a.devices.length ? (
                      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: space[1] }}>
                        {a.devices.map((d) => (
                          <StatusChip key={d.id} tone="neutral">
                            {d.name}
                          </StatusChip>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Fact>
                </dl>
                <div style={{ display: "flex", alignItems: "center", gap: space[3], flexWrap: "wrap", marginTop: "auto", paddingTop: space[3], borderTop: `1px solid ${v.borderDefault}` }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: space[2], minHeight: 44, cursor: "pointer" }}>
                    <Switch checked={a.isActive} loading={toggle.isPending && toggle.variables?.id === a.id} onChange={() => (a.isActive ? setDeactivating(a) : toggle.mutate(a))} aria-label={`${a.name} active`} />
                    <StatusChip status={a.isActive ? "ACTIVE" : "INACTIVE"}>{a.isActive ? "Active" : "Inactive"}</StatusChip>
                  </label>
                  <Button icon={<KeyOutlined />} onClick={() => setRotating(a)} style={{ marginLeft: "auto" }}>
                    Rotate key
                  </Button>
                </div>
              </article>
            );
          })}
        </CardGrid>
      </QueryState>
      <KeyModal shown={shown} onClose={() => setShown(null)} />
      <ConfirmModal
        open={rotating !== null}
        onCancel={() => {
          if (!rotate.isPending) setRotating(null);
        }}
        onConfirm={() => rotating && rotate.mutate(rotating.id)}
        loading={rotate.isPending}
        danger
        title="Issue a new key?"
        description={rotating ? `The current key for ${rotating.name} stops working immediately. The new one is shown once.` : undefined}
        confirmLabel="Rotate key"
      />
      <ConfirmModal
        open={deactivating !== null}
        onCancel={() => {
          if (!toggle.isPending) setDeactivating(null);
        }}
        onConfirm={() => deactivating && toggle.mutate(deactivating)}
        loading={toggle.isPending}
        danger
        title={deactivating ? `Deactivate ${deactivating.name}?` : ""}
        description="You can reactivate it at any time."
        confirmLabel="Deactivate"
      />
    </div>
  );
}
