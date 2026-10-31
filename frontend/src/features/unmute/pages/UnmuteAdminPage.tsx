import { useState } from "react";
import { OfficeGate } from "../../peeps/OfficeGate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select, Space } from "antd";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import * as unmuteApi from "../api";
import { slotTime } from "../time";
import type { AdminBooking, PersonRef } from "../api";

const when = slotTime;
const person = (p: PersonRef) => `${p.name} (${p.employeeCode})`;

// Wellsure Office → Unmute (directors, D-28): authorise and remove hosts, handle the bookings a removed host leaves behind (reassign or cancel), and see
// every booking. Opening bookings here writes an audit entry for each one that is not the director's own.
export function UnmuteAdminPage() {
  return (
    <OfficeGate title="Unmute" need="director">
      <UnmuteAdminPageInner />
    </OfficeGate>
  );
}

function UnmuteAdminPageInner() {
  const queryClient = useQueryClient();
  const hosts = useQuery({ queryKey: ["unmute", "admin", "hosts"], queryFn: unmuteApi.hosts });
  const affected = useQuery({ queryKey: ["unmute", "admin", "affected"], queryFn: unmuteApi.affected });
  const all = useQuery({ queryKey: ["unmute", "admin", "all"], queryFn: unmuteApi.allBookings });
  const free = useQuery({ queryKey: ["unmute", "admin", "free"], queryFn: unmuteApi.adminFreeSlots });
  const [reasonFor, setReasonFor] = useState<{ person: PersonRef & { isHost: boolean } } | null>(null);
  const [reason, setReason] = useState("");
  const [moving, setMoving] = useState<AdminBooking | null>(null);
  const [moveTo, setMoveTo] = useState<string>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["unmute"] });
  const fail = (fallback: string) => (err: unknown) => toast.error(apiErrorMessage(err, fallback));

  const hostChange = useMutation({
    mutationFn: ({ p, why }: { p: PersonRef & { isHost: boolean }; why: string }) => (p.isHost ? unmuteApi.revokeHost(p.employeeId, why) : unmuteApi.authoriseHost(p.employeeId, why)),
    onSuccess: (res) => {
      setReasonFor(null);
      setReason("");
      refresh();
      const left = (res as { bookingsToHandle?: number }).bookingsToHandle;
      toast.success(left ? `Host removed. ${left} booking${left === 1 ? "" : "s"} to reassign or cancel below.` : "Saved.");
    },
    onError: fail("Couldn't change the host."),
  });
  const reassign = useMutation({ mutationFn: ({ id, slotId }: { id: string; slotId: string }) => unmuteApi.reassign(id, slotId), onSuccess: () => { setMoving(null); setMoveTo(undefined); refresh(); toast.success("Booking moved. The employee has been told."); }, onError: fail("Couldn't move the booking.") });
  const cancel = useMutation({ mutationFn: unmuteApi.adminCancel, onSuccess: () => { refresh(); toast.success("Booking cancelled. The employee has been told."); }, onError: fail("Couldn't cancel the booking.") });

  const bookingColumns = (withActions: boolean) => [
    { title: "When", key: "when", render: (_: unknown, b: AdminBooking) => when(b) },
    { title: "Employee", key: "booker", render: (_: unknown, b: AdminBooking) => person(b.booker) },
    { title: "Host", key: "host", render: (_: unknown, b: AdminBooking) => person(b.host) },
    { title: "Status", key: "status", render: (_: unknown, b: AdminBooking) => <StatusChip tone={b.status === "BOOKED" ? "success" : "neutral"}>{b.status.replace("_", " ").toLowerCase()}</StatusChip> },
    ...(withActions
      ? [
          {
            title: "",
            key: "act",
            align: "right" as const,
            render: (_: unknown, b: AdminBooking) => (
              <Space wrap size={space[2]}>
                <Button onClick={() => setMoving(b)}>Reassign</Button>
                <Button danger onClick={() => cancel.mutate(b.id)}>Cancel</Button>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title="Unmute" subtitle="Hosts, and every booking" />
      <Stack>
        <ApprovalBanner tone="info" title="Opening bookings is recorded" description="Each booking you open here that is not your own is written to the audit log with your name and the time." />
        <Panel title="Hosts" subtitle="Wellsure Office members. Nobody is a host until a director authorises them.">
          <DataTable<PersonRef & { isHost: boolean }>
            rowKey="employeeId"
            loading={hosts.isLoading}
            error={hosts.error}
            onRetry={() => void hosts.refetch()}
            dataSource={hosts.data ?? []}
            pagination={false}
            empty={<EmptyState title="No Wellsure Office members yet" description="Appoint members first; then authorise hosts here." compact illustration={false} />}
            columns={[
              { title: "Member", key: "who", render: (_: unknown, h) => person(h) },
              { title: "Host", key: "host", render: (_: unknown, h) => (h.isHost ? <StatusChip tone="success">Host</StatusChip> : <StatusChip tone="neutral">Not a host</StatusChip>) },
              { title: "", key: "act", align: "right", render: (_: unknown, h) => <Button danger={h.isHost} onClick={() => setReasonFor({ person: h })}>{h.isHost ? "Remove as host" : "Authorise as host"}</Button> },
            ]}
            mobile={{ title: (h) => person(h), status: (h) => (h.isHost ? <StatusChip tone="success">Host</StatusChip> : undefined), actions: (h) => <Button danger={h.isHost} block onClick={() => setReasonFor({ person: h })}>{h.isHost ? "Remove as host" : "Authorise as host"}</Button> }}
          />
        </Panel>
        <Panel title="Bookings to handle" subtitle="Booked with a host who is no longer a host. Reassign each to a free time, or cancel it.">
          <DataTable<AdminBooking>
            rowKey="id"
            loading={affected.isLoading}
            error={affected.error}
            onRetry={() => void affected.refetch()}
            dataSource={affected.data ?? []}
            pagination={false}
            empty={<EmptyState title="Nothing to handle" description={null} compact illustration={false} />}
            columns={bookingColumns(true)}
            mobile={{ title: (b) => when(b), subtitle: (b) => person(b.booker), actions: (b) => <Space wrap><Button onClick={() => setMoving(b)}>Reassign</Button><Button danger onClick={() => cancel.mutate(b.id)}>Cancel</Button></Space> }}
          />
        </Panel>
        <Panel title="All bookings" subtitle={all.data ? `${all.data.length} most recent` : undefined}>
          <DataTable<AdminBooking>
            rowKey="id"
            loading={all.isLoading}
            error={all.error}
            onRetry={() => void all.refetch()}
            dataSource={all.data ?? []}
            pagination={{ pageSize: 25 }}
            empty={<EmptyState title="No bookings yet" description={null} compact illustration={false} />}
            columns={bookingColumns(false)}
            mobile={{ title: (b) => when(b), subtitle: (b) => `${person(b.booker)} · ${person(b.host)}` }}
          />
        </Panel>
      </Stack>

      <SideDrawer
        open={reasonFor !== null}
        onClose={() => setReasonFor(null)}
        title={reasonFor?.person.isHost ? "Remove as host" : "Authorise as host"}
        subtitle={reasonFor ? person(reasonFor.person) : undefined}
        primaryLabel={reasonFor?.person.isHost ? "Remove" : "Authorise"}
        primaryDanger={reasonFor?.person.isHost}
        primaryDisabled={reason.trim().length < 3}
        primaryLoading={hostChange.isPending}
        onPrimary={() => reasonFor && hostChange.mutate({ p: reasonFor.person, why: reason.trim() })}
      >
        <label htmlFor="host-reason" style={{ display: "block", marginBottom: space[2], color: v.textBody, fontSize: fs.md }}>
          Reason (kept in the audit log)
        </label>
        <Input.TextArea id="host-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        {reasonFor?.person.isHost && <p style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: space[3] }}>New bookings stop at once. Free times are withdrawn; booked ones appear under "Bookings to handle".</p>}
      </SideDrawer>
      <SideDrawer
        open={moving !== null}
        onClose={() => setMoving(null)}
        title="Reassign booking"
        subtitle={moving ? `${person(moving.booker)} · ${when(moving)}` : undefined}
        primaryLabel="Reassign"
        primaryDisabled={!moveTo}
        primaryLoading={reassign.isPending}
        onPrimary={() => moving && moveTo && reassign.mutate({ id: moving.id, slotId: moveTo })}
      >
        <label htmlFor="reassign-slot" style={{ display: "block", marginBottom: space[2], color: v.textBody, fontSize: fs.md }}>
          Free time with an active host
        </label>
        <Select id="reassign-slot" style={{ width: "100%" }} value={moveTo} onChange={setMoveTo} placeholder={(free.data ?? []).length ? "Choose" : "No free times"} options={(free.data ?? []).map((s) => ({ value: s.id, label: `${when(s)} · ${person(s.host)}` }))} />
      </SideDrawer>
    </>
  );
}
