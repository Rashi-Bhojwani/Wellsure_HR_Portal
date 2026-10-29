import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Switch } from "antd";
import * as directorApi from "../../api/director";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { EmptyState, Panel, QueryState, SkeletonCard, StatusChip, toast } from "../../ui";
import { SectionIntro, ToggleRow } from "../../pages/admin/settings/SettingsNav";

// System Settings → Director authority (docs/plans/DIRECTOR_AUTHORITY.md). A director's action takes effect at once and the other director is told. Here an owner can
// switch a second-director check back on for any step; either director can switch any step either way at once, and the other director is told and sees a red banner.
// Below it: what the other director has done on their own authority that this director has not acknowledged yet (counts only; no amounts, no names).

function Switches() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["director", "switches"], queryFn: directorApi.listSwitches });
  const mutation = useMutation({
    mutationFn: (vars: { step: string; on: boolean }) => directorApi.setSwitch(vars.step, vars.on),
    onSuccess: (switches) => {
      queryClient.setQueryData(["director", "switches"], switches);
      toast.success("Saved. The other director has been told.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not change it.")),
  });
  return (
    <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonCard lines={5} />}>
      <Panel title="Second-director check">
        <SectionIntro>
          By default a director prepares and decides each payroll step in one act, and it takes effect at once; the other director is told and it is recorded in the audit log. Switch a step on here to
          make it wait for the other director instead. Either director can change this, either way, at once. The other director is told and sees a red banner until they acknowledge it.
        </SectionIntro>
        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
          {(data ?? []).map((s) => (
            <ToggleRow
              key={s.step}
              htmlFor={`director-switch-${s.step}`}
              title={s.label}
              description={s.covers}
              control={
                <Switch
                  id={`director-switch-${s.step}`}
                  checked={s.requireSecondDirector}
                  checkedChildren="Second director"
                  unCheckedChildren="Director alone"
                  loading={mutation.isPending && mutation.variables?.step === s.step}
                  onChange={(on) => mutation.mutate({ step: s.step, on })}
                />
              }
            />
          ))}
        </div>
      </Panel>
    </QueryState>
  );
}

function Notices() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["director", "notices", "open"], queryFn: () => directorApi.listNotices("open"), refetchInterval: 60_000 });
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const ack = useMutation({
    mutationFn: (vars: { id: string; note: string }) => directorApi.acknowledgeNotice(vars.id, vars.note),
    onSuccess: () => {
      setNoteFor(null);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["director", "notices"] });
      void queryClient.invalidateQueries({ queryKey: ["access", "security-events"] });
      toast.success("Acknowledged. It is recorded in the audit log.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not acknowledge it.")),
  });
  return (
    <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonCard lines={5} />}>
      <Panel title="Done by the other director on their own authority">
        {(data ?? []).length === 0 ? (
          <EmptyState title="Nothing waiting" description="Everything the other director has done is acknowledged." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
            {(data ?? []).map((n) => (
              <div key={n.id} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[4], display: "flex", flexDirection: "column", gap: space[2] }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" }}>
                  <strong style={{ fontSize: fs.md, fontWeight: fw.semibold }}>
                    {n.actorName} · {n.stepLabel}
                  </strong>
                  <span style={{ display: "inline-flex", gap: space[2] }}>
                    {n.escalated && <StatusChip tone="danger">Waiting {">"} 3 days</StatusChip>}
                    <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{formatDateTime(n.createdAt)}</span>
                  </span>
                </div>
                <div style={{ color: v.textSecondary, fontSize: fs.sm }}>
                  {n.subjectLabel}
                  {n.itemCount != null ? ` · ${n.itemCount}` : ""}
                </div>
                {noteFor === n.id ? (
                  <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                    <Input aria-label="What you checked" placeholder="What you checked (a few words)" value={note} onChange={(e) => setNote(e.target.value)} style={{ maxWidth: 360 }} />
                    <Button type="primary" disabled={note.trim().length < 3} loading={ack.isPending} onClick={() => ack.mutate({ id: n.id, note })}>
                      Acknowledge
                    </Button>
                    <Button onClick={() => setNoteFor(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div>
                    <Button onClick={() => { setNoteFor(n.id); setNote(""); }}>Review &amp; acknowledge</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </QueryState>
  );
}

export function DirectorAuthorityCard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <Switches />
      <Notices />
    </div>
  );
}
