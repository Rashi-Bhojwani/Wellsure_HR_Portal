import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Input, Space } from "antd";
import { HistoryOutlined } from "@ant-design/icons";
import * as workforceApi from "../../../../api/workforce";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, PageHeader, Panel, QueryState, SideDrawer, SkeletonCard, StatusChip, Timeline, toast } from "../../../../ui";
import { fs, space, v } from "../../../../theme/tokens";

// A-10 G1 (docs/plans/GREYTHR_PARITY_WORKFORCE.md, items 2 and 3) — the directors' Workforce settings. Each save needs a reason and adds to the setting's history;
// nothing is ever overwritten. Not set means our own wording (labels) or no restriction beyond the engine's own list (override statuses).

const OVERRIDE_LABELS: Record<string, string> = { P: "Present", A: "Absent", HD_FIRST: "Half day, first half present", HD_SECOND: "Half day, second half present", WORKED: "Worked an off day" };

function History({ settingKey, onClose }: { settingKey: string; onClose: () => void }) {
  const hist = useQuery({ queryKey: ["workforce", "history", settingKey], queryFn: () => workforceApi.settingHistory(settingKey) });
  return (
    <SideDrawer open title="History" subtitle="Every value this setting has had, newest first" onClose={onClose} footer={null}>
      <QueryState isLoading={hist.isLoading} error={hist.error} onRetry={() => void hist.refetch()} skeleton={<SkeletonCard lines={3} />}>
        <Timeline items={(hist.data ?? []).map((h) => ({ key: h.id, content: <code style={{ fontSize: fs.sm, wordBreak: "break-word" }}>{JSON.stringify(h.value)}</code>, time: h.setAt.slice(0, 16).replace("T", " "), detail: <span style={{ color: v.textSecondary }}>Reason: {h.reason}</span> }))} />
      </QueryState>
    </SideDrawer>
  );
}

function useSave<T>(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ value, reason }: { value: T; reason: string }) => workforceApi.saveSetting(key, value, reason),
    onSuccess: () => {
      toast.success("Saved.");
      void queryClient.invalidateQueries({ queryKey: ["workforce"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save it.")),
  });
}

function ReasonModal({ open, onCancel, onConfirm, loading }: { open: boolean; onCancel: () => void; onConfirm: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmModal open={open} title="Save this setting?" description="It takes effect at once and is kept in the setting's history with your reason." confirmLabel="Save" confirmDisabled={reason.trim().length < 3} loading={loading} onCancel={onCancel} onConfirm={() => onConfirm(reason.trim())}>
      <Input.TextArea aria-label="Reason" placeholder="Why (a few words)" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: space[2] }} />
    </ConfirmModal>
  );
}

function Labels() {
  const statuses = useQuery({ queryKey: ["workforce", "statuses"], queryFn: workforceApi.listStatuses });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState(false);
  const save = useSave<Record<string, string>>("attendance.statusLabels");
  const current = draft ?? Object.fromEntries((statuses.data ?? []).filter((s) => s.labelSet).map((s) => [s.code, s.label]));
  return (
    <Panel title="Status labels" subtitle="Your own word for each status and marker. Left empty, the system's own wording is shown." extra={<Button icon={<HistoryOutlined />} onClick={() => setHistory(true)}>History</Button>}>
      <DataTable<workforceApi.StatusView>
        rowKey="code"
        loading={statuses.isLoading}
        error={statuses.error}
        onRetry={() => void statuses.refetch()}
        dataSource={statuses.data ?? []}
        pagination={false}
        columns={[
          { title: "Code", dataIndex: "code", key: "c", render: (c: string) => <code>{c}</code> },
          { title: "Meaning", dataIndex: "meaning", key: "m" },
          { title: "Kind", dataIndex: "kind", key: "k", render: (k: string) => <StatusChip tone={k === "marker" ? "info" : "neutral"}>{k}</StatusChip> },
          { title: "Your label", key: "l", render: (_: unknown, s) => <Input aria-label={`Label for ${s.code}`} maxLength={60} placeholder="Not set" value={current[s.code] ?? ""} onChange={(e) => setDraft({ ...current, [s.code]: e.target.value })} /> },
        ]}
        mobile={{ title: (s) => s.code, subtitle: (s) => s.meaning, fields: [{ label: "Your label", render: (s) => <Input aria-label={`Label for ${s.code}`} maxLength={60} placeholder="Not set" value={current[s.code] ?? ""} onChange={(e) => setDraft({ ...current, [s.code]: e.target.value })} /> }] }}
      />
      <Space style={{ marginTop: space[4] }}>
        <Button type="primary" disabled={!draft} onClick={() => setAsking(true)}>
          Save labels
        </Button>
      </Space>
      <ReasonModal
        open={asking}
        loading={save.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={(reason) =>
          save.mutate({ value: Object.fromEntries(Object.entries(current).filter(([, l]) => l.trim())), reason }, { onSuccess: () => (setAsking(false), setDraft(null)) })
        }
      />
      {history && <History settingKey="attendance.statusLabels" onClose={() => setHistory(false)} />}
    </Panel>
  );
}

function OverrideStatuses() {
  const setting = useQuery({ queryKey: ["workforce", "setting", "attendance.overrideAllowedStatuses"], queryFn: () => workforceApi.getSetting<string[]>("attendance.overrideAllowedStatuses") });
  const [draft, setDraft] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState(false);
  const save = useSave<string[]>("attendance.overrideAllowedStatuses");
  const chosen = draft ?? setting.data?.value ?? Object.keys(OVERRIDE_LABELS);
  return (
    <Panel title="Statuses Manual Override may set" subtitle={setting.data?.notSet ? "Not set: every status below may be set." : "Only the ticked statuses may be set."} extra={<Button icon={<HistoryOutlined />} onClick={() => setHistory(true)}>History</Button>}>
      <QueryState isLoading={setting.isLoading} error={setting.error} onRetry={() => void setting.refetch()} skeleton={<SkeletonCard lines={3} />}>
        <Checkbox.Group value={chosen} onChange={(vals) => setDraft(vals as string[])} options={Object.entries(OVERRIDE_LABELS).map(([value, label]) => ({ value, label }))} style={{ display: "flex", flexDirection: "column", gap: space[2] }} />
        <Space style={{ marginTop: space[4] }}>
          <Button type="primary" disabled={!draft || draft.length === 0} onClick={() => setAsking(true)}>
            Save
          </Button>
        </Space>
      </QueryState>
      <ReasonModal open={asking} loading={save.isPending} onCancel={() => setAsking(false)} onConfirm={(reason) => save.mutate({ value: chosen, reason }, { onSuccess: () => (setAsking(false), setDraft(null)) })} />
      {history && <History settingKey="attendance.overrideAllowedStatuses" onClose={() => setHistory(false)} />}
    </Panel>
  );
}

export function WorkforceSettingsPage() {
  return (
    <>
      <PageHeader title="Workforce Settings" subtitle="Status labels and what Manual Override may set. Directors only; every change is kept." />
      <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
        <Labels />
        <OverrideStatuses />
      </div>
    </>
  );
}
