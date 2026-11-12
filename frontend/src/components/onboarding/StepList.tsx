import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "antd";
import * as api from "../../api/onboarding";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { fs, space, v } from "../../theme/tokens";
import { StatusChip, toast } from "../../ui";

// M session block 2, OE-04: a list of onboarding steps with a tick box for the ones this person may tick (the server decides; `canTick` only hides
// boxes it would refuse).
export function StepList({ tasks, canTick, queryKey }: { tasks: api.OnboardingTask[]; canTick: (t: api.OnboardingTask) => boolean; queryKey: unknown[] }) {
  const queryClient = useQueryClient();
  const tick = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.setStepDone(id, done),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")),
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[2] }}>
      {tasks.map((t) => {
        const label = (
          <span>
            <span style={{ textDecoration: t.doneAt ? "line-through" : undefined, color: t.doneAt ? v.textSecondary : v.textPrimary }}>{t.step}</span>
            <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>
              {api.OWNER_LABEL[t.owner]} · due {formatDate(t.dueDate)}{t.doneAt ? ` · done ${formatDate(t.doneAt)}` : ""}
            </span>
          </span>
        );
        return (
          <li key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: space[2], minHeight: 44, justifyContent: "space-between" }}>
            {canTick(t) ? (
              <Checkbox checked={!!t.doneAt} disabled={tick.isPending && tick.variables?.id === t.id} onChange={(e) => tick.mutate({ id: t.id, done: e.target.checked })}>{label}</Checkbox>
            ) : (
              label
            )}
            {!t.doneAt && t.dueDate < today && <StatusChip tone="warning">Overdue</StatusChip>}
          </li>
        );
      })}
    </ul>
  );
}
