import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Radio } from "antd";
import * as directorApi from "../../api/director";
import type { DirectorSwitchView } from "../../api/director";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { EmptyState, Panel, QueryState, SkeletonCard, StatusChip, toast } from "../../ui";
import { SectionIntro } from "../../pages/admin/settings/SettingsNav";

// System Settings → Director authority (docs/plans/DIRECTOR_AUTHORITY.md). For each payroll step the two directors choose, with no default, whether a different director must decide or
// the acting director decides alone (the other is told either way). One proposes, the other confirms; until then the step is Not set and payroll will not run it.
// Below it: what the other director has done on their own authority that this director has not acknowledged yet (counts only; no amounts, no names).

const MODE_TEXT: Record<directorApi.DirectorChoiceMode, string> = {
  SECOND_DIRECTOR: "A different director must decide",
  DIRECTOR_AUTHORITY: "The acting director decides alone; the other is told",
};

function Switches() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["director", "switches"], queryFn: directorApi.listSwitches });
  const [picked, setPicked] = useState<Record<string, directorApi.DirectorChoiceMode>>({});
  const done = (message: string) => (switches: DirectorSwitchView[]) => {
    queryClient.setQueryData(["director", "switches"], switches);
    toast.success(message);
  };
  const propose = useMutation({
    mutationFn: (vars: { step: string; mode: directorApi.DirectorChoiceMode }) => directorApi.setSwitch(vars.step, vars.mode),
    onSuccess: done("Proposed. It takes effect when the other director confirms it."),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not propose it.")),
  });
  const confirm = useMutation({
    mutationFn: (vars: { step: string; mode: directorApi.DirectorChoiceMode }) => directorApi.confirmSwitch(vars.step, vars.mode),
    onSuccess: done("Confirmed. The other director has been told."),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not confirm it.")),
  });
  const rows = data ?? [];
  const recommended = rows.filter((s) => s.recommendedSecond);
  const unset = rows.filter((s) => s.required && s.status !== "CONFIRMED");
  return (
    <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonCard lines={5} />}>
      <Panel title="Who decides each payroll step">
        <SectionIntro>
          For each step that can move money or change pay rules, the two directors choose, with no default, between &ldquo;a different director must decide&rdquo; and &ldquo;the acting director decides
          alone&rdquo;. In both, the other director is told. One director proposes the choice and the other confirms it; until both have, the step is Not set and payroll will not run it.
        </SectionIntro>
        {recommended.length > 0 && (
          <Alert
            type="info"
            showIcon
            title="Recommended"
            description={`We recommend turning the second-director check ON (“a different director must decide”) for: ${recommended.map((s) => s.label).join(", ")}. These are the steps where one person's mistake or misuse costs the most.`}
            style={{ marginBottom: space[3] }}
          />
        )}
        {unset.length > 0 && (
          <Alert type="warning" showIcon title={`${unset.length} of the steps below are not settled yet`} description="Ready for first real run stays red, and the payroll steps refuse to run, until each is set by one director and confirmed by the other." style={{ marginBottom: space[3] }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
          {rows.map((s) => {
            const value = picked[s.step] ?? s.proposed?.mode ?? s.mode ?? undefined;
            const busy = (propose.isPending && propose.variables?.step === s.step) || (confirm.isPending && confirm.variables?.step === s.step);
            return (
              <div key={s.step} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[4], display: "flex", flexDirection: "column", gap: space[2] }} data-testid={`choice-${s.step}`}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: space[3], flexWrap: "wrap", alignItems: "center" }}>
                  <strong style={{ fontSize: fs.md, fontWeight: fw.semibold }}>{s.label}</strong>
                  <span style={{ display: "inline-flex", gap: space[2] }}>
                    {s.recommendedSecond && <StatusChip tone="info">Recommended: a different director</StatusChip>}
                    {s.demo && <StatusChip tone="warning">DEMO choice</StatusChip>}
                    {s.status === "CONFIRMED" ? (
                      <StatusChip tone="success">Confirmed: {s.mode ? MODE_TEXT[s.mode] : ""}</StatusChip>
                    ) : s.status === "PENDING_CONFIRMATION" ? (
                      <StatusChip tone="warning">Waiting for the other director</StatusChip>
                    ) : (
                      <StatusChip tone={s.required ? "danger" : "neutral"}>{s.required ? "Not set" : "Not set (acts alone, other is told)"}</StatusChip>
                    )}
                  </span>
                </div>
                <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{s.covers}</div>
                {s.proposed && (
                  <div style={{ fontSize: fs.sm }}>
                    {s.proposed.byMe ? "You proposed" : `${s.proposed.byName} proposed`}: <strong>{MODE_TEXT[s.proposed.mode]}</strong> ({formatDateTime(s.proposed.at)}).
                    {s.mode ? ` Until it is confirmed, “${MODE_TEXT[s.mode]}” stays in force.` : ""}
                  </div>
                )}
                <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
                  <Radio.Group
                    aria-label={`How ${s.label} is decided`}
                    value={value}
                    onChange={(e) => setPicked((p) => ({ ...p, [s.step]: e.target.value as directorApi.DirectorChoiceMode }))}
                    options={(["SECOND_DIRECTOR", "DIRECTOR_AUTHORITY"] as const).map((m) => ({ value: m, label: MODE_TEXT[m] }))}
                  />
                  {s.proposed && !s.proposed.byMe && (
                    <Button type="primary" loading={busy} onClick={() => confirm.mutate({ step: s.step, mode: s.proposed!.mode })}>
                      Confirm “{MODE_TEXT[s.proposed.mode]}”
                    </Button>
                  )}
                  <Button loading={busy} disabled={!value || (value === s.mode && !s.proposed) || (s.proposed?.byMe === true && value === s.proposed.mode)} onClick={() => value && propose.mutate({ step: s.step, mode: value })}>
                    Propose this
                  </Button>
                </div>
              </div>
            );
          })}
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
