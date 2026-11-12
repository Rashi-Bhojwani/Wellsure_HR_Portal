import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "antd";
import * as notificationsApi from "../../api/notifications";
import { apiErrorMessage } from "../../lib/apiError";
import { fs, space, v } from "../../theme/tokens";
import { Panel, QueryState, SkeletonCard, toast } from "../../ui";

// NT-09 (M session): switch off the notices you do not want. Approvals, decisions, security, payroll and helpdesk notices are always sent.
export function NotificationChoices() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["notification-preferences"], queryFn: notificationsApi.notificationPreferences });
  const set = useMutation({
    mutationFn: (a: { key: notificationsApi.NotificationCategoryPref["key"]; on: boolean }) => notificationsApi.setNotificationPreference(a.key, a.on),
    onSuccess: (data) => queryClient.setQueryData(["notification-preferences"], data),
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save that.")),
  });
  return (
    <Panel title="Notifications" subtitle="Switch off the notices you do not want. Approvals, decisions, security, payroll and helpdesk notices are always sent.">
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} skeleton={<SkeletonCard lines={3} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
          {(q.data ?? []).map((c) => (
            <label key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[3], minHeight: 44, cursor: "pointer" }}>
              <span style={{ color: v.textPrimary, fontSize: fs.md }}>{c.label}</span>
              <Switch checked={c.on} loading={set.isPending && set.variables?.key === c.key} onChange={(on) => set.mutate({ key: c.key, on })} aria-label={c.label} />
            </label>
          ))}
        </div>
      </QueryState>
    </Panel>
  );
}
