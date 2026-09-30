import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Input, InputNumber, Space, Switch, Typography, message } from "antd";
import * as engageApi from "../../../api/engage";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;
const { TextArea } = Input;

const KIND_LABEL: Record<engageApi.AutoPostKind, string> = {
  BIRTHDAY: "Birthday",
  JOINING: "New Joiner",
  ANNIVERSARY: "Work Anniversary",
};

const KIND_PLACEHOLDERS: Record<engageApi.AutoPostKind, string> = {
  BIRTHDAY: "{name}",
  JOINING: "{name}, {date}",
  ANNIVERSARY: "{name}, {years}",
};

function SettingCard({ setting }: { setting: engageApi.AutoPostSettingRow }) {
  const queryClient = useQueryClient();
  // null = no unsaved edit yet — display the canonical value from the
  // query. Avoids syncing local state from a prop via an effect: the
  // draft is only ever set by the user typing, and cleared back to null
  // (falling through to the fresh canonical value) once a save succeeds.
  const [draftTemplate, setDraftTemplate] = useState<string | null>(null);
  const template = draftTemplate ?? setting.template;

  const mutation = useMutation({
    mutationFn: (input: Partial<{ enabled: boolean; template: string }>) => engageApi.updateAutoPostSetting(setting.kind, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "autopost-settings"] });
      setDraftTemplate(null);
      void message.success("Saved.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save this setting.")),
  });

  return (
    <Card
      size="small"
      title={KIND_LABEL[setting.kind]}
      extra={<Switch checked={setting.enabled} onChange={(enabled) => mutation.mutate({ enabled })} checkedChildren="On" unCheckedChildren="Off" />}
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        Placeholders: {KIND_PLACEHOLDERS[setting.kind]}
      </Text>
      <TextArea rows={2} value={template} onChange={(e) => setDraftTemplate(e.target.value)} maxLength={500} style={{ marginTop: 8 }} />
      <Button
        size="small"
        type="primary"
        style={{ marginTop: 8 }}
        disabled={template === setting.template}
        loading={mutation.isPending}
        onClick={() => mutation.mutate({ template })}
      >
        Save Template
      </Button>
    </Card>
  );
}

export function AutoPostSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["engage", "autopost-settings"], queryFn: engageApi.listAutoPostSettings });
  const [draftHour, setDraftHour] = useState<number | null>(null);
  const hour = draftHour ?? data?.dailyRunHour ?? null;

  const hourMutation = useMutation({
    mutationFn: (h: number) => engageApi.updateDailyRunHour(h),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "autopost-settings"] });
      setDraftHour(null);
      void message.success("Daily run time saved.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save the run time.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <HelpStrip storageKey="engage-autopost-settings">
        Configure the template and enabled flag for each auto-generated celebration post. Birthdays and work anniversaries post on the shared daily batch below; new-joiner posts fire the moment someone accepts their invitation, not on this schedule.
      </HelpStrip>

      <Title level={4} style={{ margin: 0 }}>
        Auto-Post Settings
      </Title>

      <Card size="small" title="Daily batch run time (birthdays & anniversaries)" loading={isLoading}>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Takes effect on the scheduler's next restart, not immediately — the running scheduler doesn't reload a changed cron schedule live."
        />
        <Space>
          <InputNumber min={0} max={23} value={hour} onChange={(v) => setDraftHour(v)} addonAfter=":00 IST" />
          <Button type="primary" disabled={hour === null || hour === data?.dailyRunHour} loading={hourMutation.isPending} onClick={() => hour !== null && hourMutation.mutate(hour)}>
            Save
          </Button>
        </Space>
      </Card>

      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {data?.settings.map((s) => (
          <SettingCard key={s.kind} setting={s} />
        ))}
      </Space>
    </Space>
  );
}
