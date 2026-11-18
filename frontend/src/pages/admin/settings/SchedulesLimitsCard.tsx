import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, InputNumber } from "antd";
import * as settingsApi from "../../../api/settings";
import type { ScheduleLimitSetting } from "../../../api/settings";
import { apiErrorMessage } from "../../../lib/apiError";
import { Panel, QueryState, SkeletonCard, StatusChip, toast } from "../../../ui";
import { fw, space, v } from "../../../theme/tokens";
import { SectionIntro } from "./SettingsNav";

// System Settings, "Schedules and limits" (audit fix 2026-11-18: audit #14, #15, A-17, A-18, A-19, A-21). Directors only (settings.manage). None of these changes
// pay or leave; while nobody has saved one, it says "Default in use: <value>". A saved time moves its job at once.
const show = (s: Pick<ScheduleLimitSetting, "kind">, value: number | string) => (s.kind === "hour" ? `${String(value).padStart(2, "0")}:00` : String(value));

function Row({ s }: { s: ScheduleLimitSetting }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<number | string | null>(null);
  const save = useMutation({
    mutationFn: (value: number | string) => settingsApi.setScheduleLimit(s.key, value),
    onSuccess: (rows) => {
      qc.setQueryData(["settings", "schedules-limits"], rows);
      setDraft(null);
      toast.success("Saved.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save it.")),
  });
  const value = draft ?? s.value;
  const id = `sl-${s.key.replace(/\W/g, "-")}`;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], alignItems: "flex-end", padding: `${space[3]}px 0`, borderBottom: `1px solid ${v.borderDefault}` }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <label htmlFor={id} style={{ display: "block", fontWeight: fw.semibold }}>{s.label}</label>
        <div style={{ color: v.textSecondary }}>{s.help}</div>
        <div style={{ marginTop: space[1] }}>
          {s.defaultInUse ? <StatusChip tone="info">{`Default in use: ${show(s, s.defaultValue)}`}</StatusChip> : <StatusChip tone="success">{`Set: ${show(s, s.value)}`}</StatusChip>}
        </div>
      </div>
      {s.kind === "time" ? (
        <Input id={id} value={String(value)} onChange={(e) => setDraft(e.target.value)} placeholder="HH:MM" style={{ width: 120 }} inputMode="numeric" />
      ) : (
        <InputNumber id={id} value={Number(value)} min={s.min ?? undefined} max={s.max ?? undefined} onChange={(n) => setDraft(typeof n === "number" ? n : null)} style={{ width: 120 }} />
      )}
      <Button type="primary" disabled={draft === null} loading={save.isPending} onClick={() => draft !== null && save.mutate(draft)}>
        Save
      </Button>
    </div>
  );
}

export function SchedulesLimitsCard() {
  const q = useQuery({ queryKey: ["settings", "schedules-limits"], queryFn: settingsApi.getSchedulesLimits });
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} skeleton={<SkeletonCard lines={6} />}>
      <Panel title="Schedules and limits">
        <SectionIntro>When the daily jobs run, and a few limits. Each keeps its built-in value until a director saves one; a saved time takes effect at once. Every change is audited.</SectionIntro>
        {(q.data ?? []).map((s) => (
          <Row key={s.key} s={s} />
        ))}
      </Panel>
    </QueryState>
  );
}
