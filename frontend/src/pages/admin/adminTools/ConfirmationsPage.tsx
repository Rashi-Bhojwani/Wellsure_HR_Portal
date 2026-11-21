import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "antd";
import * as api from "../../../api/confirmations";
import { apiErrorMessage } from "../../../lib/apiError";
import { space } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, StatusChip, errorStatus, toast, useIsPhone } from "../../../ui";

// FIX (independent audit 2026-11-20): one place for the confirmations the audit fixes add. A director confirms a leave change (C3), a change to who is a
// director (C2), and a change to a sign-in email or to a director's own details (C1), never their own; a director or an HR Admin clears a blocked sign-in
// address (H2). Each panel shows only what the signed-in person may see: a refusal (403) hides it. No value is ever shown, only what kind of change it is.
type Rejecting = { kind: "leave" | "director" | "contact"; id: string; title: string } | null;

function Actions({ canConfirm, canReject, label, onConfirm, onReject, confirming }: { canConfirm: boolean; canReject: boolean; label: string; onConfirm: () => void; onReject: () => void; confirming: boolean }) {
  const phone = useIsPhone();
  if (!canConfirm && !canReject) return null;
  return (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "stretch" : "flex-end" }}>
      {canReject && <Button danger onClick={onReject} block={phone} aria-label={`Turn down: ${label}`}>Turn down</Button>}
      {canConfirm && <Button type="primary" loading={confirming} onClick={onConfirm} block={phone} aria-label={`Confirm: ${label}`}>Confirm</Button>}
    </div>
  );
}

function Section({ title, subtitle, children, hidden }: { title: string; subtitle: string; children: ReactNode; hidden: boolean }) {
  if (hidden) return null;
  return <Panel title={title} subtitle={subtitle}>{children}</Panel>;
}

export function ConfirmationsPage() {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState<Rejecting>(null);
  const [note, setNote] = useState("");
  const [clearing, setClearing] = useState<api.LoginBlock | null>(null);
  const leave = useQuery({ queryKey: ["confirmations", "leave"], queryFn: api.listLeaveChanges, retry: false });
  const director = useQuery({ queryKey: ["confirmations", "director"], queryFn: api.listDirectorChanges, retry: false });
  const contact = useQuery({ queryKey: ["confirmations", "contact"], queryFn: api.listContactChanges, retry: false });
  const blocks = useQuery({ queryKey: ["confirmations", "blocks"], queryFn: api.listLoginBlocks, retry: false });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["confirmations"] });
  const onError = (e: unknown) => toast.error(apiErrorMessage(e, "That could not be done."));
  const confirmLeave = useMutation({ mutationFn: api.confirmLeaveChange, onSuccess: () => { toast.success("Confirmed. The balance has changed."); refresh(); }, onError });
  const confirmDirector = useMutation({ mutationFn: api.confirmDirectorChange, onSuccess: (r) => { toast.success(r.applied ? "Confirmed. It has taken effect, and both directors are told." : "Confirmed. It waits for every other director."); refresh(); }, onError });
  const confirmContact = useMutation({ mutationFn: api.confirmContactChange, onSuccess: () => { toast.success("Confirmed. It has taken effect; the old address is told."); refresh(); }, onError });
  const reject = useMutation({
    mutationFn: () => (rejecting!.kind === "leave" ? api.rejectLeaveChange : rejecting!.kind === "director" ? api.rejectDirectorChange : api.rejectContactChange)(rejecting!.id, note.trim()),
    onSuccess: () => { toast.success("Turned down. Nothing changed."); setRejecting(null); setNote(""); refresh(); },
    onError,
  });
  const clear = useMutation({ mutationFn: () => api.clearLoginBlock(clearing!.ip, note.trim()), onSuccess: () => { toast.success("Cleared. People at that address can sign in again."); setClearing(null); setNote(""); refresh(); }, onError });
  const hidden = (q: { error: unknown }) => errorStatus(q.error) === 403 || errorStatus(q.error) === 401;
  const minutes = (s: number) => `${Math.max(1, Math.ceil(s / 60))} min`;

  return (
    <>
      <PageHeader title="Waiting for confirmation" subtitle="Changes that take effect only when a second person confirms them. Nobody confirms their own." />
      <div style={{ display: "grid", gap: space[4] }}>
        <Section hidden={hidden(leave)} title="Leave changes" subtitle="Grants, debits, comp-off credits and leave imports. A director who did not propose it, and is not credited by it, confirms it.">
          <DataTable<api.LeaveChangeRow> rowKey="id" loading={leave.isLoading} error={leave.error} onRetry={() => void leave.refetch()} dataSource={leave.data ?? []} pagination={false}
            empty={<EmptyState compact title="Nothing is waiting" description={null} />}
            columns={[
              { title: "Kind", key: "k", render: (_, r) => api.LEAVE_KIND_LABEL[r.kind] },
              { title: "Change", dataIndex: "summary" },
              { title: "", key: "m", render: (_, r) => (r.mine ? <StatusChip tone="neutral">You proposed it</StatusChip> : r.aboutMe ? <StatusChip tone="warning">About you</StatusChip> : null) },
              { title: "", key: "a", align: "right", render: (_, r) => <Actions label={r.summary} canConfirm={r.canConfirm} canReject={r.canReject} confirming={confirmLeave.isPending && confirmLeave.variables === r.id} onConfirm={() => confirmLeave.mutate(r.id)} onReject={() => setRejecting({ kind: "leave", id: r.id, title: r.summary })} /> },
            ]}
            mobile={{ title: (r) => api.LEAVE_KIND_LABEL[r.kind], subtitle: (r) => r.summary, actions: (r) => <Actions label={r.summary} canConfirm={r.canConfirm} canReject={r.canReject} confirming={confirmLeave.isPending && confirmLeave.variables === r.id} onConfirm={() => confirmLeave.mutate(r.id)} onReject={() => setRejecting({ kind: "leave", id: r.id, title: r.summary })} /> }} />
        </Section>

        <Section hidden={hidden(director)} title="Who is a director" subtitle="Making or removing a director, or changing a director's roles or access. One director proposes, the other confirms; a third director needs every existing director.">
          <DataTable<api.DirectorChangeRow> rowKey="id" loading={director.isLoading} error={director.error} onRetry={() => void director.refetch()} dataSource={(director.data ?? []).filter((r) => r.status === "PENDING")} pagination={false}
            empty={<EmptyState compact title="Nothing is waiting" description={null} />}
            columns={[
              { title: "Change", key: "c", render: (_, r) => `${api.DIRECTOR_ACTION_LABEL[r.action]}${r.roleCode ? ` (${r.roleCode})` : ""}` },
              { title: "Employee", dataIndex: "target" },
              { title: "Reason", dataIndex: "reason" },
              { title: "Confirmations", dataIndex: "confirmations" },
              { title: "", key: "a", align: "right", render: (_, r) => <Actions label={`${api.DIRECTOR_ACTION_LABEL[r.action]} ${r.target}`} canConfirm={r.canConfirm} canReject={r.canReject} confirming={confirmDirector.isPending && confirmDirector.variables === r.id} onConfirm={() => confirmDirector.mutate(r.id)} onReject={() => setRejecting({ kind: "director", id: r.id, title: `${api.DIRECTOR_ACTION_LABEL[r.action]} ${r.target}` })} /> },
            ]}
            mobile={{ title: (r) => api.DIRECTOR_ACTION_LABEL[r.action], subtitle: (r) => `${r.target} · ${r.reason}`, actions: (r) => <Actions label={`${api.DIRECTOR_ACTION_LABEL[r.action]} ${r.target}`} canConfirm={r.canConfirm} canReject={r.canReject} confirming={confirmDirector.isPending && confirmDirector.variables === r.id} onConfirm={() => confirmDirector.mutate(r.id)} onReject={() => setRejecting({ kind: "director", id: r.id, title: `${api.DIRECTOR_ACTION_LABEL[r.action]} ${r.target}` })} /> }} />
        </Section>

        <Section hidden={hidden(contact)} title="Sign-in email and director details" subtitle="A change to the email that receives sign-in and reset links, or to a director's own details. Only which fields change is shown here.">
          <DataTable<api.ContactChangeRow> rowKey="id" loading={contact.isLoading} error={contact.error} onRetry={() => void contact.refetch()} dataSource={(contact.data ?? []).filter((r) => r.status === "PENDING")} pagination={false}
            empty={<EmptyState compact title="Nothing is waiting" description={null} />}
            columns={[
              { title: "Kind", key: "k", render: (_, r) => api.CONTACT_KIND_LABEL[r.kind] },
              { title: "Employee", dataIndex: "employeeCode" },
              { title: "Fields", key: "f", render: (_, r) => r.fields.join(", ") },
              { title: "", key: "m", render: (_, r) => (r.aboutMe ? <StatusChip tone="warning">Your own record</StatusChip> : r.mine ? <StatusChip tone="neutral">You made it</StatusChip> : null) },
              { title: "", key: "a", align: "right", render: (_, r) => <Actions label={`${api.CONTACT_KIND_LABEL[r.kind]} for ${r.employeeCode}`} canConfirm={r.canConfirm} canReject={r.canReject} confirming={confirmContact.isPending && confirmContact.variables === r.id} onConfirm={() => confirmContact.mutate(r.id)} onReject={() => setRejecting({ kind: "contact", id: r.id, title: `${api.CONTACT_KIND_LABEL[r.kind]} for ${r.employeeCode}` })} /> },
            ]}
            mobile={{ title: (r) => api.CONTACT_KIND_LABEL[r.kind], subtitle: (r) => `${r.employeeCode} · ${r.fields.join(", ")}`, actions: (r) => <Actions label={`${api.CONTACT_KIND_LABEL[r.kind]} for ${r.employeeCode}`} canConfirm={r.canConfirm} canReject={r.canReject} confirming={confirmContact.isPending && confirmContact.variables === r.id} onConfirm={() => confirmContact.mutate(r.id)} onReject={() => setRejecting({ kind: "contact", id: r.id, title: `${api.CONTACT_KIND_LABEL[r.kind]} for ${r.employeeCode}` })} /> }} />
        </Section>

        <Section hidden={hidden(blocks)} title="Blocked sign-in addresses" subtitle={`An address with ${blocks.data?.limit.maxAttempts ?? 100} failed sign-ins in ${Math.round((blocks.data?.limit.windowSeconds ?? 900) / 60)} minutes is slowed down. People with no failures of their own still sign in.`}>
          <DataTable<api.LoginBlock> rowKey="ip" loading={blocks.isLoading} error={blocks.error} onRetry={() => void blocks.refetch()} dataSource={blocks.data?.blocks ?? []} pagination={false}
            empty={<EmptyState compact title="No address is blocked" description={null} />}
            columns={[
              { title: "Address", dataIndex: "ip" },
              { title: "Failed sign-ins", dataIndex: "failures" },
              { title: "Ends in", key: "t", render: (_, r) => minutes(r.secondsLeft) },
              { title: "", key: "a", align: "right", render: (_, r) => <Button onClick={() => setClearing(r)} aria-label={`Clear the block on ${r.ip}`}>Clear</Button> },
            ]}
            mobile={{ title: (r) => r.ip, subtitle: (r) => `${r.failures} failed · ends in ${minutes(r.secondsLeft)}`, actions: (r) => <Button block onClick={() => setClearing(r)} aria-label={`Clear the block on ${r.ip}`}>Clear</Button> }} />
        </Section>
      </div>

      <ConfirmModal open={!!rejecting} danger title="Turn this down" confirmLabel="Turn down" description={rejecting?.title} loading={reject.isPending} confirmDisabled={note.trim().length < 3} onCancel={() => { setRejecting(null); setNote(""); }} onConfirm={() => reject.mutate()}>
        <Input.TextArea aria-label="Why (recorded)" placeholder="Why (recorded)" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmModal>
      <ConfirmModal open={!!clearing} title="Clear this blocked address" confirmLabel="Clear" description={clearing ? `${clearing.ip}: ${clearing.failures} failed sign-ins` : undefined} loading={clear.isPending} confirmDisabled={note.trim().length < 3} onCancel={() => { setClearing(null); setNote(""); }} onConfirm={() => clear.mutate()}>
        <Input.TextArea aria-label="Why (recorded)" placeholder="Why (recorded)" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
