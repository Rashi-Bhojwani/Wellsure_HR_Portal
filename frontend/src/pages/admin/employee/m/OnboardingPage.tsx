import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented } from "antd";
import { PlayCircleOutlined, UnorderedListOutlined } from "@ant-design/icons";
import * as api from "../../../../api/onboarding";
import { StepList } from "../../../../components/onboarding/StepList";
import { apiErrorMessage } from "../../../../lib/apiError";
import { formatDate } from "../../../../lib/dates";
import { fs, fw, v } from "../../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, SideDrawer, StatusChip, toast, useIsPhone } from "../../../../ui";

// M session block 2, OE-04: people who joined in the last four months and their onboarding. Starting copies the checklist (System Settings → Policy
// settings, a conventional default) as the person's steps.
export function OnboardingPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [show, setShow] = useState<"open" | "all">("open");
  const [open, setOpen] = useState<api.Joiner | null>(null);
  const q = useQuery({ queryKey: ["onboarding", "joiners", show], queryFn: () => api.listJoiners(show) });
  const steps = useQuery({ queryKey: ["onboarding", "steps", open?.employeeId], queryFn: () => api.stepsOf(open!.employeeId), enabled: !!open });
  const start = useMutation({
    mutationFn: (id: string) => api.startOnboarding(id),
    onSuccess: () => { toast.success("Started. The joiner and their manager are told."); void queryClient.invalidateQueries({ queryKey: ["onboarding"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not start it.")),
  });
  const progress = (j: api.Joiner) => (!j.started ? <StatusChip tone="neutral">Not started</StatusChip> : j.done === j.total ? <StatusChip tone="success">Done</StatusChip> : <StatusChip tone={j.overdue ? "warning" : "info"}>{`${j.done} of ${j.total}${j.overdue ? `, ${j.overdue} overdue` : ""}`}</StatusChip>);
  const actions = (j: api.Joiner) =>
    j.started ? (
      <Button icon={<UnorderedListOutlined />} onClick={() => setOpen(j)} block={phone} aria-label={`Steps of ${j.fullName}`}>Steps</Button>
    ) : (
      <Button type="primary" icon={<PlayCircleOutlined />} loading={start.isPending && start.variables === j.employeeId} onClick={() => start.mutate(j.employeeId)} block={phone} aria-label={`Start onboarding for ${j.fullName}`}>Start</Button>
    );
  return (
    <>
      <PageHeader title="Onboarding" subtitle="New joiners' first steps. Each step is ticked by whoever owns it: HR, the manager or the employee." />
      <Panel title={show === "open" ? "Not finished" : "Everyone who joined in the last four months"} extra={<Segmented value={show} onChange={(val) => setShow(val as "open" | "all")} options={[{ value: "open", label: "Not finished" }, { value: "all", label: "Everyone" }]} aria-label="Which joiners" />}>
        <DataTable<api.Joiner>
          rowKey="employeeId"
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          dataSource={q.data ?? []}
          pagination={(q.data?.length ?? 0) > 20 ? { pageSize: 20 } : false}
          empty={<EmptyState compact title="No joiners to onboard" description={null} />}
          columns={[
            { title: "Employee", key: "e", render: (_, j) => <span><span style={{ fontWeight: fw.semibold }}>{j.fullName}</span><span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{j.employeeCode}</span></span> },
            { title: "Joined", dataIndex: "dateOfJoining", render: (d: string) => formatDate(d) },
            { title: "Progress", key: "p", render: (_, j) => progress(j) },
            { title: "", key: "a", align: "right", render: (_, j) => actions(j) },
          ]}
          mobile={{ title: (j) => j.fullName, subtitle: (j) => `Joined ${formatDate(j.dateOfJoining)}`, status: progress, actions }}
        />
      </Panel>
      <SideDrawer open={!!open} title="Onboarding steps" subtitle={open?.fullName} onClose={() => setOpen(null)} footer={null}>
        {steps.data && <StepList tasks={steps.data} canTick={() => true} queryKey={["onboarding"]} />}
      </SideDrawer>
    </>
  );
}
