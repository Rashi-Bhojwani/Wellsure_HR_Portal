import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Segmented } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import * as api from "../../../api/lateness";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, space, v } from "../../../theme/tokens";
import { CardGrid, DataTable, EmptyState, PageHeader, Panel, QueryState, SideDrawer, StatCard, StatusChip, toast, useIsPhone } from "../../../ui";

// Lateness rule (docs/plans/LATE_CHECKLIST.md §6): an employee sees their own late marks, allowances left and waiver status; a manager also sees their direct
// reports' (no rupee amounts) and asks HR to waive one arrival.

function Consequence({ a }: { a: api.Arrival }) {
  return (
    <span style={{ display: "inline-flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
      <StatusChip tone={api.CONSEQUENCE_TONE[a.consequence.kind]}>{api.CONSEQUENCE_LABEL[a.consequence.kind]}</StatusChip>
      {a.waiver && a.consequence.kind !== "WAIVED" && <StatusChip tone={api.WAIVER_TONE[a.waiver.status]}>{api.WAIVER_LABEL[a.waiver.status]}</StatusChip>}
    </span>
  );
}

function RuleNote({ rule }: { rule: api.RuleSummary }) {
  return (
    <ul style={{ margin: 0, paddingLeft: space[5], color: v.textSecondary, fontSize: fs.sm }}>
      {rule.bands.map((b) => (
        <li key={b.band}>
          {b.label}: {api.outcomeText(b.outcome, b.applies)}
        </li>
      ))}
    </ul>
  );
}

function Arrivals({ person, actions }: { person: api.PersonMonth; actions?: (a: api.Arrival) => React.ReactNode }) {
  return (
    <DataTable<api.Arrival>
      rowKey="date"
      dataSource={person.arrivals}
      pagination={false}
      empty={<EmptyState compact title="No late arrivals this month" description={null} />}
      columns={[
        { title: "Day", key: "d", render: (_, a) => formatDate(a.date) },
        { title: "In at", dataIndex: "time" },
        { title: "Band", dataIndex: "bandLabel" },
        { title: "Consequence", key: "c", render: (_, a) => <Consequence a={a} /> },
        { title: "What it means", dataIndex: "says" },
        ...(actions ? [{ title: "", key: "a", align: "right" as const, render: (_: unknown, a: api.Arrival) => actions(a) }] : []),
      ]}
      mobile={{ title: (a) => `${formatDate(a.date)} · ${a.time}`, subtitle: (a) => a.says, status: (a) => <Consequence a={a} />, actions: actions ? (a) => actions(a) ?? null : undefined }}
    />
  );
}

export function LatenessPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [view, setView] = useState<"mine" | "team">("mine");
  const [asking, setAsking] = useState<{ person: api.PersonMonth; arrival: api.Arrival } | null>(null);
  const [form] = Form.useForm<{ reason: string }>();
  const m = month.format("YYYY-MM");
  const mine = useQuery({ queryKey: ["lateness", "mine", m], queryFn: () => api.myLateness(m) });
  const team = useQuery({ queryKey: ["lateness", "team", m], queryFn: () => api.teamLateness(m) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["lateness"] });
  const ask = useMutation({
    mutationFn: (reason: string) => api.askWaiver({ employeeId: asking!.person.employeeId, date: asking!.arrival.date, reason }),
    onSuccess: () => { toast.success("Asked. HR decides."); setAsking(null); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not send it.")),
  });
  const withdraw = useMutation({ mutationFn: api.withdrawWaiver, onSuccess: () => { toast.success("Withdrawn."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not withdraw it.")) });
  const isManager = !!team.data?.isManager;
  const q = view === "team" ? team : mine;
  const active = view === "team" ? team.data?.active : mine.data?.active;
  const rule = view === "team" ? team.data?.rule : mine.data?.rule;

  const teamAction = (person: api.PersonMonth) => (a: api.Arrival) => {
    if (team.data?.finalised) return null;
    if (a.waiver?.status === "PENDING") return <Button block={phone} onClick={() => withdraw.mutate(a.waiver!.id)} aria-label={`Withdraw the waiver request for ${person.name} on ${a.date}`}>Withdraw</Button>;
    if (a.waiver?.status === "APPROVED") return null;
    return <Button block={phone} onClick={() => { form.resetFields(); setAsking({ person, arrival: a }); }} aria-label={`Ask HR to waive ${person.name}'s late arrival on ${a.date}`}>Ask to waive</Button>;
  };

  return (
    <>
      <PageHeader
        title="Late arrivals"
        subtitle="Arrivals after the company's cutoffs, what each costs, and the free allowances left this month."
        actions={
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            {isManager && <Segmented value={view} onChange={(x) => setView(x as typeof view)} options={[{ value: "mine", label: "Mine" }, { value: "team", label: "My team" }]} aria-label="Whose arrivals" />}
            <DatePicker picker="month" value={month} onChange={(d) => d && setMonth(d)} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), "month")} aria-label="Month" />
          </div>
        }
      />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={!!q.data && !active} empty={<EmptyState title="The lateness rule is not in use" description="Nobody is marked late by it, and nothing changes in attendance or pay." />}>
        <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
          {rule && (
            <Panel title="The rule this month" subtitle={`In force from ${formatDate(rule.effectiveFrom)}. Times are Asia/Kolkata.`}>
              <RuleNote rule={rule} />
            </Panel>
          )}
          {view === "mine" && mine.data?.me && (
            <>
              {mine.data.me.allowances.length > 0 && (
                <CardGrid>
                  {mine.data.me.allowances.map((x) => <StatCard key={x.band} label={`Free allowances left, ${x.bandLabel}`} value={`${x.left} of ${x.free}`} />)}
                </CardGrid>
              )}
              <Panel title="Your late arrivals">
                <Arrivals person={mine.data.me} />
              </Panel>
            </>
          )}
          {view === "mine" && mine.data?.active && !mine.data.me && <EmptyState title="No late arrivals this month" description={null} />}
          {view === "team" &&
            (team.data?.people.length ? (
              team.data.people.map((person) => (
                <Panel key={person.employeeId} title={`${person.name} (${person.employeeCode})`} subtitle={person.allowances.map((x) => `${x.left} of ${x.free} free left, ${x.bandLabel}`).join(" · ") || undefined}>
                  <Arrivals person={person} actions={teamAction(person)} />
                </Panel>
              ))
            ) : (
              <EmptyState title="Nobody reports to you" description={null} />
            ))}
        </div>
      </QueryState>
      <SideDrawer open={!!asking} title="Ask HR to waive this arrival" subtitle={asking ? `${asking.person.name}, ${formatDate(asking.arrival.date)} at ${asking.arrival.time} (${asking.arrival.bandLabel}). If HR agrees, the arrival has no consequence and any allowance it used comes back.` : undefined} onClose={() => setAsking(null)} formId="late-waiver-form" primaryLabel="Ask" primaryLoading={ask.isPending}>
        <Form id="late-waiver-form" form={form} layout="vertical" requiredMark={false} onFinish={(vals) => ask.mutate(vals.reason)}>
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "A few words" }]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
