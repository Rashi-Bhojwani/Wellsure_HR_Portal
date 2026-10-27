import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form } from "antd";
import { UserAddOutlined, UserDeleteOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import * as employeeApi from "../../../api/employee";
import * as managersApi from "../../../api/managers";
import type { ManagerRow, PersonPlacement, ScheduledMove } from "../../../api/managers";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, InitialsAvatar, SideDrawer, Stack, toast } from "../../../ui";
import { ManagerDateField } from "./ManagerDateField";

const ymd = (d?: Dayjs | null) => (d ? d.format("YYYY-MM-DD") : undefined);

type Pending = { kind: "remove"; member: PersonPlacement } | { kind: "cancel"; move: ScheduledMove & { text: string } };

// A manager's team (Phase 5 E2): add someone (effective-dated, may be scheduled
// ahead), take someone off (they become Unassigned), and cancel a scheduled
// move. Every one is a job-history row and an audit entry, so each waits for
// the server and the destructive ones are confirmed first.
export function ManagerTeamDrawer({ manager, canAssign, onClose }: { manager: ManagerRow | null; canAssign: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ employeeId: string; effectiveFrom: Dayjs }>();
  const [pending, setPending] = useState<Pending | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["managers", "team", manager?.employeeId], queryFn: () => managersApi.getTeam(manager!.employeeId), enabled: manager !== null });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["managers"] });
  const add = useMutation({
    mutationFn: (val: { employeeId: string; effectiveFrom: Dayjs }) => managersApi.assignTeam(manager!.employeeId, [val.employeeId], ymd(val.effectiveFrom)),
    onSuccess: () => {
      refresh();
      form.resetFields();
      toast.success("Added to the team.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't add them.")),
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) => managersApi.removeTeamMember(manager!.employeeId, memberId),
    onSuccess: () => {
      refresh();
      setPending(null);
      toast.success("Removed from the team — they're now Unassigned.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't remove them.")),
  });
  const cancelMove = useMutation({
    mutationFn: ({ employeeId, rowId }: { employeeId: string; rowId: string }) => employeeApi.cancelScheduledChange(employeeId, "job", rowId),
    onSuccess: () => {
      refresh();
      setPending(null);
      toast.success("Scheduled move cancelled.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't cancel it.")),
  });

  const scheduled = [
    ...(data?.joining ?? []).map((m) => ({ ...m, text: `${m.name} joins on ${dayjs(m.from).format("D MMM YYYY")}` })),
    ...(data?.leaving ?? []).map((m) => ({ ...m, text: `${m.name} moves ${m.toManager ? `to ${m.toManager}` : "out"} on ${dayjs(m.from).format("D MMM YYYY")}` })),
  ];
  const busy = removeMember.isPending || cancelMove.isPending;

  return (
    <SideDrawer
      open={manager !== null}
      onClose={onClose}
      title={manager ? `${manager.name}'s team` : ""}
      subtitle={data ? `${data.members.length} ${data.members.length === 1 ? "person" : "people"}` : undefined}
      size="wide"
      footer={null}
    >
      <Stack gap={space[6]}>
        {canAssign && (
          <section aria-label="Add someone to the team" style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[4] }}>
            <h3 style={{ margin: `0 0 ${space[3]}px`, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>Add someone</h3>
            <Form form={form} layout="vertical" requiredMark={false} onFinish={(val) => add.mutate(val)}>
              <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: "Choose someone" }]} extra="Moves them from their current manager (if any). A new job-history entry is written; the old one is kept.">
                <EmployeePicker />
              </Form.Item>
              <ManagerDateField allowFuture />
              <Button type="primary" htmlType="submit" icon={<UserAddOutlined />} loading={add.isPending}>
                Add to team
              </Button>
            </Form>
          </section>
        )}
        {scheduled.length > 0 && (
          <ApprovalBanner
            tone="info"
            title="Scheduled team changes"
            description={
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[2] }}>
                {scheduled.map((m) => (
                  <li key={m.jobHistoryId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                    <span>{m.text}</span>
                    {canAssign && (
                      <Button size="small" type="link" danger onClick={() => setPending({ kind: "cancel", move: m })}>
                        Cancel
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            }
          />
        )}
        <section aria-label="Team members">
          <h3 style={{ margin: `0 0 ${space[3]}px`, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>Members</h3>
          <DataTable<PersonPlacement>
            rowKey="employeeId"
            density="compact"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.members ?? []}
            pagination={false}
            empty={<EmptyState compact illustration="people" title="No team yet" description={canAssign ? "Add someone above to start the team." : null} />}
            columns={[
              {
                title: "Member",
                key: "name",
                render: (_: unknown, r) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                    <InitialsAvatar name={r.name} size={28} />
                    <Link to={`/admin/employee/profile/${r.employeeId}`}>{r.name}</Link>
                  </span>
                ),
              },
              { title: "Code", dataIndex: "employeeCode" },
              { title: "Since", dataIndex: "placedSince", render: (val: string | null) => (val ? dayjs(val).format("D MMM YYYY") : "—") },
              ...(canAssign
                ? [
                    {
                      title: "",
                      key: "actions",
                      align: "right" as const,
                      render: (_: unknown, r: PersonPlacement) => (
                        <Button size="small" danger icon={<UserDeleteOutlined />} onClick={() => setPending({ kind: "remove", member: r })}>
                          Remove
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
            mobile={{
              avatar: (r) => <InitialsAvatar name={r.name} size={36} />,
              title: (r) => <Link to={`/admin/employee/profile/${r.employeeId}`}>{r.name}</Link>,
              subtitle: (r) => r.employeeCode,
              fields: [{ label: "Since", render: (r) => (r.placedSince ? dayjs(r.placedSince).format("D MMM YYYY") : "—") }],
              actions: canAssign
                ? (r) => (
                    <Button block danger icon={<UserDeleteOutlined />} onClick={() => setPending({ kind: "remove", member: r })}>
                      Remove
                    </Button>
                  )
                : undefined,
            }}
          />
        </section>
        <span style={{ fontSize: fs.sm, color: v.textSecondary, fontWeight: fw.regular }}>Every change here is effective-dated and recorded in the audit log.</span>
      </Stack>

      <ConfirmModal
        open={pending !== null}
        onCancel={() => {
          if (!busy) setPending(null);
        }}
        danger
        loading={busy}
        title={pending?.kind === "remove" ? `Remove ${pending.member.name} from the team?` : "Cancel this scheduled move?"}
        description={pending?.kind === "remove" ? "From today. They'll be on the Unassigned list until someone gives them a manager." : pending?.kind === "cancel" ? pending.move.text : undefined}
        confirmLabel={pending?.kind === "remove" ? "Remove" : "Cancel move"}
        cancelLabel={pending?.kind === "cancel" ? "Keep it" : "Cancel"}
        onConfirm={() => {
          if (pending?.kind === "remove") removeMember.mutate(pending.member.employeeId);
          else if (pending?.kind === "cancel") cancelMove.mutate({ employeeId: pending.move.employeeId, rowId: pending.move.jobHistoryId });
        }}
      />
    </SideDrawer>
  );
}
