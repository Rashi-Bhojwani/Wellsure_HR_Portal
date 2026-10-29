import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, InputNumber, Switch } from "antd";
import * as engageApi from "../../../api/engage";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, PageHeader, Panel, QueryState, Skel, Stack, toast, useIsPhone } from "../../../ui";

const { TextArea } = Input;

const KIND_LABEL: Record<engageApi.AutoPostKind, string> = {
  BIRTHDAY: "Birthday",
  JOINING: "New Joiner",
  ANNIVERSARY: "Work Anniversary",
};

const KIND_HINT: Record<engageApi.AutoPostKind, string> = {
  BIRTHDAY: "Posted on the daily batch on each employee's birthday.",
  JOINING: "Posted the moment a new joiner accepts their invitation.",
  ANNIVERSARY: "Posted on the daily batch on each work anniversary.",
};

const KIND_PLACEHOLDERS: Record<engageApi.AutoPostKind, string> = {
  BIRTHDAY: "{name}",
  JOINING: "{name}, {date}",
  ANNIVERSARY: "{name}, {years}",
};

function SettingCard({ setting }: { setting: engageApi.AutoPostSettingRow }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  // null = no unsaved edit yet — display the canonical value from the
  // query. Avoids syncing local state from a prop via an effect: the
  // draft is only ever set by the user typing, and cleared back to null
  // (falling through to the fresh canonical value) once a save succeeds.
  const [draftTemplate, setDraftTemplate] = useState<string | null>(null);
  const template = draftTemplate ?? setting.template;
  const labelId = `autopost-${setting.kind}`;

  const mutation = useMutation({
    mutationFn: (input: Partial<{ enabled: boolean; template: string }>) => engageApi.updateAutoPostSetting(setting.kind, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "autopost-settings"] });
      setDraftTemplate(null);
      toast.success("Saved.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save this setting.")),
  });

  return (
    <div style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: phone ? space[4] : `${space[5]}px ${space[6]}px`, background: v.bgSurface }}>
      <div style={{ display: "flex", alignItems: "center", gap: space[4] }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id={labelId} style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>
            {KIND_LABEL[setting.kind]}
          </div>
          <div style={{ color: v.textSecondary, fontSize: fs.md, marginTop: 2 }}>{KIND_HINT[setting.kind]}</div>
        </div>
        <Switch aria-labelledby={labelId} checked={setting.enabled} loading={mutation.isPending && mutation.variables?.enabled !== undefined} onChange={(enabled) => mutation.mutate({ enabled })} />
      </div>
      <div style={{ marginTop: space[4] }}>
        <label htmlFor={`${labelId}-tpl`} style={{ display: "block", fontSize: fs.sm, color: v.textSecondary, marginBottom: space[1] }}>
          Template · Placeholders: {KIND_PLACEHOLDERS[setting.kind]}
        </label>
        <TextArea id={`${labelId}-tpl`} autoSize={{ minRows: 2, maxRows: 6 }} value={template} onChange={(e) => setDraftTemplate(e.target.value)} maxLength={500} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: space[2], marginTop: space[3] }}>
          {draftTemplate !== null && template !== setting.template && <Button onClick={() => setDraftTemplate(null)}>Discard</Button>}
          <Button type="primary" disabled={template === setting.template} loading={mutation.isPending && mutation.variables?.template !== undefined} onClick={() => mutation.mutate({ template })} block={phone}>
            Save Template
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AutoPostSettingsPage() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["engage", "autopost-settings"], queryFn: engageApi.listAutoPostSettings });
  const [draftHour, setDraftHour] = useState<number | null>(null);
  const hour = draftHour ?? data?.dailyRunHour ?? null;

  const hourMutation = useMutation({
    mutationFn: (h: number) => engageApi.updateDailyRunHour(h),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "autopost-settings"] });
      setDraftHour(null);
      toast.success("Daily run time saved.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the run time.")),
  });

  const skeleton = (
    <Stack gap={space[4]}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5] }}>
          <Skel w="30%" h={16} style={{ marginBottom: space[2] }} />
          <Skel w="55%" h={12} style={{ marginBottom: space[4] }} />
          <Skel h={52} />
        </div>
      ))}
    </Stack>
  );

  return (
    <>
      <PageHeader title="Auto-Post Settings" subtitle="Celebration posts the portal writes for you" />
      <Stack>
        <HelpStrip storageKey="engage-autopost-settings">
          Configure the template and enabled flag for each auto-generated celebration post. Birthdays and work anniversaries post on the shared daily batch below; new-joiner posts fire the moment someone accepts their invitation, not on this schedule.
        </HelpStrip>

        <Panel title="Daily batch run time (birthdays & anniversaries)">
          {isLoading ? (
            <Skel h={48} w={260} />
          ) : (
            <Stack gap={space[4]}>
              <ApprovalBanner tone="warning" title="Takes effect on the scheduler's next restart, not immediately — the running scheduler doesn't reload a changed cron schedule live." />
              <div style={{ display: "flex", gap: space[3], alignItems: "center", flexWrap: "wrap" }}>
                <InputNumber aria-label="Daily run hour" min={0} max={23} value={hour} onChange={(val) => setDraftHour(val)} suffix=":00 IST" style={{ width: phone ? "100%" : 180 }} />
                <Button type="primary" disabled={hour === null || hour === data?.dailyRunHour} loading={hourMutation.isPending} onClick={() => hour !== null && hourMutation.mutate(hour)} block={phone}>
                  Save
                </Button>
              </div>
            </Stack>
          )}
        </Panel>

        <Panel title="Celebration posts">
          <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={skeleton}>
            <Stack gap={space[4]}>
              {data?.settings.map((s) => (
                <SettingCard key={s.kind} setting={s} />
              ))}
            </Stack>
          </QueryState>
        </Panel>
      </Stack>
    </>
  );
}
