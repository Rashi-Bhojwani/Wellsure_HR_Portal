import { useState } from "react";
import { OfficeGate } from "../OfficeGate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Form, Input, Select, Space } from "antd";
import { UserAddOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import type { OfficeCapabilityId, OfficeChangeKind } from "@shared/constants/peeps";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast, useDebouncedValue } from "../../../ui";
import * as peepsApi from "../api";
import type { Membership, PersonRef } from "../api";
import { usePeepsMe } from "../usePeepsMe";

const FORM_ID = "office-change-form";
const KIND_LABEL: Record<OfficeChangeKind, string> = { APPOINT: "Appoint", UPDATE: "Change what they can do", REMOVE: "Remove", REPLACE: "Hand over to someone else" };
type Member = Membership["members"][number];
type Change = Membership["changes"][number];
const person = (p: PersonRef) => `${p.name} (${p.employeeCode})`;

function PersonSelect({ value, onChange, id }: { value?: string; onChange?: (v: string) => void; id?: string }) {
  const [q, setQ] = useState("");
  const search = useDebouncedValue(q, 250);
  const { data = [], isFetching } = useQuery({ queryKey: ["peeps", "people", search], queryFn: () => peepsApi.people(search) });
  return (
    <Select id={id} showSearch={{ filterOption: false, onSearch: setQ }} loading={isFetching} value={value} onChange={onChange} placeholder="Search by name or employee code" options={data.map((p) => ({ value: p.employeeId, label: person(p) }))} />
  );
}

// Wellsure Office → Members (directors only, D-30). Every person signs in with their own account; the directors choose who may open the workspace and
// what each member may do. A change is proposed by one director and confirmed by the other; it takes effect at its time (now, or a later date applied by
// the scheduled job) and writes ordinary per-person grants labelled "Wellsure Office membership".
export function OfficeMembersPage() {
  return (
    <OfficeGate title="Wellsure Office members" need="director">
      <OfficeMembersPageInner />
    </OfficeGate>
  );
}

function OfficeMembersPageInner() {
  const queryClient = useQueryClient();
  const me = usePeepsMe();
  const catalog = me.data?.capabilityCatalog ?? [];
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["peeps", "members"], queryFn: peepsApi.membership });
  const drift = useQuery({ queryKey: ["peeps", "drift"], queryFn: peepsApi.drift });
  const [form] = Form.useForm<{ employeeId?: string; capabilities?: OfficeCapabilityId[]; effectiveFrom?: Dayjs | null; reason: string }>();
  const [editing, setEditing] = useState<{ kind: OfficeChangeKind; member?: Member } | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["peeps"] });
  const propose = useMutation({
    mutationFn: (values: { employeeId?: string; capabilities?: OfficeCapabilityId[]; effectiveFrom?: Dayjs | null; reason: string }) => {
      const kind = editing!.kind;
      const m = editing!.member;
      return peepsApi.proposeChange({
        kind,
        employeeId: kind === "APPOINT" || kind === "REPLACE" ? values.employeeId! : m!.employeeId,
        ...(kind === "REPLACE" ? { fromEmployeeId: m!.employeeId } : {}),
        ...(kind === "APPOINT" || kind === "UPDATE" ? { capabilities: values.capabilities ?? [] } : {}),
        ...(values.effectiveFrom ? { effectiveFrom: values.effectiveFrom.toISOString() } : {}),
        reason: values.reason,
      });
    },
    onSuccess: () => {
      setEditing(null);
      form.resetFields();
      refresh();
      toast.success("Proposed. The other director confirms it before it takes effect.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't propose the change.")),
  });
  const confirm = useMutation({
    mutationFn: peepsApi.confirmChange,
    onSuccess: (r) => {
      refresh();
      toast.success(r.applied ? "Confirmed and in effect." : "Confirmed. It takes effect at its date.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't confirm the change.")),
  });

  const capLabel = (id: string) => catalog.find((c) => c.id === id)?.label ?? id;
  const open = (kind: OfficeChangeKind, member?: Member) => {
    form.setFieldsValue({ employeeId: undefined, capabilities: member?.capabilities ?? [], effectiveFrom: null, reason: "" });
    setEditing({ kind, member });
  };
  const appointButton = (
    <Button type="primary" icon={<UserAddOutlined />} onClick={() => open("APPOINT")}>
      Appoint a member
    </Button>
  );
  const memberActions = (m: Member) => (
    <Space wrap size={space[2]}>
      <Button onClick={() => open("UPDATE", m)}>Change</Button>
      <Button onClick={() => open("REPLACE", m)}>Hand over</Button>
      <Button danger onClick={() => open("REMOVE", m)}>Remove</Button>
    </Space>
  );
  const changeState = (c: Change) => (c.appliedAt ? <StatusChip tone="success">In effect</StatusChip> : c.confirmedAt ? <StatusChip tone="info">Confirmed, from {formatDateTime(c.effectiveFrom)}</StatusChip> : <StatusChip tone="warning">Waiting for the other director</StatusChip>);
  const changeAction = (c: Change) =>
    !c.confirmedAt ? (
      c.proposedByMe ? (
        <span style={{ color: v.textSecondary, fontSize: fs.sm }}>The other director confirms</span>
      ) : (
        <Button type="primary" loading={confirm.isPending && confirm.variables === c.id} onClick={() => confirm.mutate(c.id)}>
          Confirm
        </Button>
      )
    ) : null;

  return (
    <>
      <PageHeader title="Wellsure Office members" subtitle="Who may open the workspace, and what each member may do" actions={appointButton} />
      <Stack>
        {(drift.data?.length ?? 0) > 0 && (
          <ApprovalBanner
            tone="warning"
            title="Membership grants were changed by hand"
            description={`${drift.data!.length} grant${drift.data!.length === 1 ? "" : "s"} no longer match the membership (for example edited on Roles & Permissions). The workspace ignores them; a new confirmed change puts the grants right.`}
          />
        )}
        <Panel title="Members" subtitle="No role opens the workspace by itself: not HR, not managers. Members never get pay, bank or statutory access from it.">
          <DataTable<Member>
            rowKey="employeeId"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.members ?? []}
            pagination={false}
            empty={<EmptyState illustration="inbox" title="Nobody yet" description="Appoint the first member. The other director confirms it." action={appointButton} compact />}
            columns={[
              { title: "Member", key: "who", render: (_: unknown, m) => person(m) },
              { title: "May", key: "caps", render: (_: unknown, m) => (m.capabilities.length ? <Space wrap size={space[1]}>{m.capabilities.map((c) => <StatusChip key={c} tone="info">{capLabel(c)}</StatusChip>)}</Space> : "Open the workspace only") },
              { title: "Since", dataIndex: "since", render: (d: string) => formatDateTime(d) },
              { title: "", key: "act", align: "right", render: (_: unknown, m) => memberActions(m) },
            ]}
            mobile={{ title: (m) => person(m), subtitle: (m) => m.capabilities.map(capLabel).join(", ") || "Open the workspace only", actions: memberActions }}
          />
        </Panel>
        <Panel title="Changes" subtitle="Proposed by one director, confirmed by the other">
          <DataTable<Change>
            rowKey="id"
            loading={isLoading}
            dataSource={data?.changes ?? []}
            pagination={{ pageSize: 20 }}
            empty={<EmptyState title="No changes yet" description={null} compact illustration={false} />}
            columns={[
              { title: "Change", key: "kind", render: (_: unknown, c) => `${KIND_LABEL[c.kind]}: ${person(c.person)}${c.from ? ` (from ${person(c.from)})` : ""}` },
              { title: "Reason", dataIndex: "reason" },
              { title: "Status", key: "state", render: (_: unknown, c) => changeState(c) },
              { title: "", key: "act", align: "right", render: (_: unknown, c) => changeAction(c) },
            ]}
            mobile={{ title: (c) => `${KIND_LABEL[c.kind]}: ${person(c.person)}`, subtitle: (c) => c.reason, status: changeState, actions: changeAction }}
          />
        </Panel>
      </Stack>
      <SideDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? KIND_LABEL[editing.kind] : ""}
        subtitle={editing?.member ? person(editing.member) : "The other director confirms before it takes effect."}
        formId={FORM_ID}
        primaryLabel="Propose"
        primaryDanger={editing?.kind === "REMOVE"}
        primaryLoading={propose.isPending}
      >
        {editing && (
          <Form id={FORM_ID} form={form} layout="vertical" requiredMark onFinish={(values) => propose.mutate(values)}>
            {(editing.kind === "APPOINT" || editing.kind === "REPLACE") && (
              <Form.Item name="employeeId" label={editing.kind === "REPLACE" ? "Hand over to" : "Person"} rules={[{ required: true, message: "Choose a person." }]}>
                <PersonSelect />
              </Form.Item>
            )}
            {(editing.kind === "APPOINT" || editing.kind === "UPDATE") && (
              <Form.Item name="capabilities" label="May also" extra="Opening the workspace comes with membership. Each item below is a director's choice.">
                <Checkbox.Group style={{ display: "flex", flexDirection: "column", gap: space[2] }} options={catalog.map((c) => ({ value: c.id, label: `${c.label}: ${c.what}` }))} />
              </Form.Item>
            )}
            <Form.Item name="effectiveFrom" label="From" extra="Leave empty for now. A later date is applied automatically at that time.">
              <DatePicker showTime={{ format: "HH:mm" }} format="DD MMM YYYY HH:mm" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="reason" label="Reason (kept in the audit log)" rules={[{ required: true, min: 3, max: 500 }]}>
              <Input.TextArea rows={3} />
            </Form.Item>
          </Form>
        )}
      </SideDrawer>
    </>
  );
}
