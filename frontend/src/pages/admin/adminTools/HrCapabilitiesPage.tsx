import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Input, Segmented, Select } from "antd";
import type { Dayjs } from "dayjs";
import * as hrApi from "../../../api/hrCapabilities";
import type { CapabilityLine, HistoryRow, PersonLine, RoleLine, SwitchState } from "../../../api/hrCapabilities";
import { apiErrorCode, apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, PageHeader, Panel, QueryState, SkeletonTable, Stack, StatusChip, toast, useIsPhone } from "../../../ui";

// What HR can do (docs/plans/HR_CAPABILITIES.md §1B). A director switches each duty on or off for HR, for a whole role or for one named person. Nothing here can give HR salary, payroll,
// bank file or pay-document access: those are locked in code and are not on this screen. Every change needs a reason, starts now or at a time you choose, and stays in the history below.

const ROLE_LABEL: Record<"HR_ADMIN" | "HR_EXECUTIVE", string> & Record<string, string> = { HR_ADMIN: "HR Admin", HR_EXECUTIVE: "HR Executive" };
const STATE_LABEL: Record<SwitchState, string> = { DEFAULT: "As today", ON: "On", OFF: "Off" };

interface Target {
  capability: CapabilityLine;
  subject: { kind: "ROLE"; roleCode: "HR_ADMIN" | "HR_EXECUTIVE" } | { kind: "USER"; employeeId: string; label: string };
  to: SwitchState;
}

function chipFor(state: SwitchState, defaultHolds?: boolean) {
  if (state === "ON") return <StatusChip tone="success">On</StatusChip>;
  if (state === "OFF") return <StatusChip tone="danger">Off</StatusChip>;
  return <StatusChip tone="neutral">{defaultHolds === false ? "As today: not held" : "As today"}</StatusChip>;
}

function RoleCell({ cap, line, onPick }: { cap: CapabilityLine; line: RoleLine; onPick: (t: Target) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
      <Segmented
        aria-label={`${cap.label} for ${ROLE_LABEL[line.roleCode]}`}
        size="middle"
        value={line.state}
        options={(["DEFAULT", "ON", "OFF"] as const).map((s) => ({ value: s, label: STATE_LABEL[s] }))}
        onChange={(to) => onPick({ capability: cap, subject: { kind: "ROLE", roleCode: line.roleCode }, to: to as SwitchState })}
      />
      {line.pending && (
        <span style={{ fontSize: fs.sm, color: v.textSecondary }}>
          Then {STATE_LABEL[line.pending.state as SwitchState] ?? line.pending.state} from {formatDateTime(line.pending.effectiveFrom)}
        </span>
      )}
    </div>
  );
}

function PeoplePanel({ data, onPick }: { data: { capabilities: CapabilityLine[]; people: hrApi.HrPerson[] }; onPick: (t: Target) => void }) {
  const [person, setPerson] = useState<string | undefined>();
  const [capId, setCapId] = useState<string | undefined>();
  const cap = data.capabilities.find((c) => c.id === capId);
  const who = data.people.find((p) => p.employeeId === person);
  const rows = data.capabilities.flatMap((c) => c.people.map((p) => ({ ...p, cap: c })));
  return (
    <Panel title="For one named person" subtitle="A switch for a named person beats the one for their role. Use it to give or take away one duty for one HR colleague.">
      <Stack>
        <div style={{ display: "flex", gap: space[3], flexWrap: "wrap" }}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Choose an HR colleague"
            aria-label="HR colleague"
            style={{ minWidth: 240, flex: 1 }}
            value={person}
            onChange={setPerson}
            options={data.people.map((p) => ({ value: p.employeeId, label: `${p.name || p.employeeCode} (${p.employeeCode})` }))}
          />
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Choose a duty"
            aria-label="Duty"
            style={{ minWidth: 240, flex: 1 }}
            value={capId}
            onChange={setCapId}
            options={data.capabilities.map((c) => ({ value: c.id, label: c.label }))}
          />
          {(["ON", "OFF", "DEFAULT"] as const).map((s) => (
            <Button key={s} size="large" disabled={!cap || !who} onClick={() => cap && who && onPick({ capability: cap, subject: { kind: "USER", employeeId: who.employeeId, label: `${who.name || who.employeeCode}` }, to: s })}>
              {s === "DEFAULT" ? "Back to as today" : `Switch ${STATE_LABEL[s].toLowerCase()}`}
            </Button>
          ))}
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No one is set individually" description="Everyone follows the switch for their role." />
        ) : (
          <DataTable<(typeof rows)[number]>
            rowKey={(r) => `${r.userId}-${r.cap.id}`}
            dataSource={rows}
            pagination={false}
            columns={[
              { title: "Person", key: "p", render: (_: unknown, r) => `${r.name || r.employeeCode} (${r.employeeCode})` },
              { title: "Duty", key: "d", render: (_: unknown, r) => r.cap.label },
              { title: "Now", key: "s", render: (_: unknown, r: PersonLine & { cap: CapabilityLine }) => chipFor(r.state) },
            ]}
            mobile={{ title: (r) => `${r.name || r.employeeCode}`, subtitle: (r) => r.cap.label, status: (r) => chipFor(r.state) }}
          />
        )}
      </Stack>
    </Panel>
  );
}

function History() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["hr-capabilities", "history", page], queryFn: () => hrApi.getHistory(page) });
  return (
    <Panel title="History" subtitle="Every change, who made it and why. Nothing here is ever edited or removed.">
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonTable rows={4} />}>
        {(data?.rows ?? []).length === 0 ? (
          <EmptyState title="No changes yet" description="Everything is as it was." />
        ) : (
          <DataTable<HistoryRow>
            rowKey="id"
            dataSource={data?.rows ?? []}
            pagination={{ current: page, pageSize: data?.pageSize ?? 10, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
            columns={[
              { title: "When", key: "w", render: (_: unknown, r) => formatDateTime(r.changedAt) },
              { title: "Duty", dataIndex: "label" },
              { title: "For", key: "f", render: (_: unknown, r) => (r.subjectKind === "ROLE" ? (ROLE_LABEL[r.subject.roleCode ?? ""] ?? r.subject.roleCode) : `${r.subject.name || r.subject.employeeCode} (${r.subject.employeeCode})`) },
              { title: "Set to", key: "s", render: (_: unknown, r) => chipFor(r.state) },
              { title: "From", key: "e", render: (_: unknown, r) => formatDateTime(r.effectiveFrom) },
              { title: "By", key: "b", render: (_: unknown, r) => `${r.changedBy.name || r.changedBy.employeeCode}` },
              { title: "Why", dataIndex: "reason" },
            ]}
            mobile={{
              title: (r) => r.label,
              subtitle: (r) => (r.subjectKind === "ROLE" ? (ROLE_LABEL[r.subject.roleCode ?? ""] ?? "") : `${r.subject.name || r.subject.employeeCode}`),
              status: (r) => chipFor(r.state),
              fields: [
                { label: "When", render: (r) => formatDateTime(r.changedAt) },
                { label: "By", render: (r) => r.changedBy.name || r.changedBy.employeeCode },
                { label: "Why", render: (r) => r.reason },
              ],
            }}
          />
        )}
      </QueryState>
    </Panel>
  );
}

export function HrCapabilitiesPage() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["hr-capabilities"], queryFn: hrApi.getOverview, retry: false });
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState("");
  const [start, setStart] = useState<Dayjs | null>(null);
  const close = () => {
    setTarget(null);
    setReason("");
    setStart(null);
  };
  const mutation = useMutation({
    mutationFn: (t: Target) =>
      hrApi.setSwitch({
        capability: t.capability.id,
        subject: t.subject.kind === "ROLE" ? { kind: "ROLE", roleCode: t.subject.roleCode } : { kind: "USER", employeeId: t.subject.employeeId },
        state: t.to,
        reason: reason.trim(),
        effectiveFrom: start ? start.toISOString() : undefined,
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(["hr-capabilities"], res.overview);
      void queryClient.invalidateQueries({ queryKey: ["hr-capabilities", "history"] });
      toast.success(res.changed ? "Saved. It is in force from the moment shown in the history." : "Nothing to change: it is already set that way.");
      close();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save it.")),
  });

  if (error && apiErrorCode(error) === "DIRECTOR_ONLY") {
    return (
      <>
        <PageHeader title="What HR can do" />
        <EmptyState title="Only the directors can see this" description="What HR may do is decided by the directors (the Super Admins)." />
      </>
    );
  }

  const subjectName = target ? (target.subject.kind === "ROLE" ? ROLE_LABEL[target.subject.roleCode] : target.subject.label) : "";
  return (
    <>
      <PageHeader title="What HR can do" subtitle="Switch each attendance and leave duty on or off for HR, for a whole role or for one person. It applies to their very next click." />
      <ApprovalBanner tone="info" title="Salary, payroll, bank files, tax and pay documents are never HR's, and no switch here can change that. Anything switched off keeps waiting for a director: nothing is approved or lost." />
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonTable rows={6} />}>
        <Stack>
          <Panel title="For a whole role" subtitle="“As today” means the role keeps exactly what it had before these switches existed.">
            <DataTable<CapabilityLine>
              rowKey="id"
              dataSource={data?.capabilities ?? []}
              pagination={false}
              columns={[
                {
                  title: "Duty",
                  key: "duty",
                  render: (_: unknown, c) => (
                    <div>
                      <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{c.label}</div>
                      <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{c.what}</div>
                    </div>
                  ),
                },
                ...(["HR_ADMIN", "HR_EXECUTIVE"] as const).map((code) => ({
                  title: ROLE_LABEL[code],
                  key: code,
                  render: (_: unknown, c: CapabilityLine) => <RoleCell cap={c} line={c.roles.find((r) => r.roleCode === code)!} onPick={setTarget} />,
                })),
              ]}
              mobile={{
                title: (c) => c.label,
                subtitle: (c) => c.what,
                fields: (["HR_ADMIN", "HR_EXECUTIVE"] as const).map((code) => ({ label: ROLE_LABEL[code] as string, render: (c: CapabilityLine) => <RoleCell cap={c} line={c.roles.find((r) => r.roleCode === code)!} onPick={setTarget} /> })),
              }}
            />
          </Panel>
          {data && <PeoplePanel data={data} onPick={setTarget} />}
          <History />
        </Stack>
      </QueryState>
      <ConfirmModal
        open={target !== null}
        onCancel={close}
        title={target ? `${target.capability.label}: ${STATE_LABEL[target.to] === "As today" ? "back to as today" : `switch ${STATE_LABEL[target.to].toLowerCase()}`}` : ""}
        description={target ? `For ${subjectName}. ${target.to === "OFF" ? "Whatever is waiting for them stays waiting; nothing is approved or lost." : target.to === "ON" ? "They can do this from their next click." : "They keep exactly what their role had before."}` : undefined}
        confirmLabel="Save"
        loading={mutation.isPending}
        confirmDisabled={reason.trim().length < 3}
        onConfirm={() => target && mutation.mutate(target)}
        width={phone ? undefined : 520}
      >
        <Stack>
          <label htmlFor="hr-switch-reason" style={{ fontWeight: fw.semibold, color: v.textPrimary }}>
            Why (kept in the history)
          </label>
          <Input.TextArea id="hr-switch-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <label htmlFor="hr-switch-start" style={{ fontWeight: fw.semibold, color: v.textPrimary }}>
            Starts (leave empty for now)
          </label>
          <DatePicker id="hr-switch-start" showTime value={start} onChange={setStart} disabledDate={(d) => d.isBefore(new Date(), "day")} style={{ width: "100%" }} />
        </Stack>
      </ConfirmModal>
    </>
  );
}
