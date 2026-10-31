import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, fw, space, v } from "../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, SideDrawer, SkeletonTable, Stack, StatusChip, toast } from "../../../ui";
import * as unmuteApi from "../api";
import type { HostSlot } from "../api";

const when = (s: { startsAt: string; endsAt: string }) => `${formatDateTime(s.startsAt)} – ${new Date(s.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

// Wellsure Office → Unmute hosting (D-30): an authorised host offers times inside the availability window, sees who booked them, cancels if needed and
// marks each conversation held or not held. Only times and attendance are recorded.
export function HostCalendarPage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["unmute", "status"], queryFn: unmuteApi.status });
  const slots = useQuery({ queryKey: ["unmute", "host"], queryFn: unmuteApi.hostSlots, enabled: Boolean(status.data?.isHost) });
  const [offering, setOffering] = useState(false);
  const [startsAt, setStartsAt] = useState<Dayjs | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["unmute"] });
  const fail = (fallback: string) => (err: unknown) => toast.error(apiErrorMessage(err, fallback));
  const create = useMutation({ mutationFn: (iso: string) => unmuteApi.createSlot(iso), onSuccess: () => { setOffering(false); setStartsAt(null); refresh(); toast.success("Time offered."); }, onError: fail("Couldn't offer that time.") });
  const withdraw = useMutation({ mutationFn: unmuteApi.withdrawSlot, onSuccess: () => { refresh(); toast.success("Time withdrawn."); }, onError: fail("Couldn't withdraw that time.") });
  const cancel = useMutation({ mutationFn: unmuteApi.hostCancel, onSuccess: () => { refresh(); toast.success("Booking cancelled. The employee has been told."); }, onError: fail("Couldn't cancel the booking.") });
  const done = useMutation({ mutationFn: ({ id, outcome }: { id: string; outcome: "COMPLETED" | "NOT_HELD" }) => unmuteApi.complete(id, outcome), onSuccess: () => { refresh(); toast.success("Recorded."); }, onError: fail("Couldn't record that.") });

  const live = (s: HostSlot) => s.bookings.find((b) => b.status === "BOOKED");
  const past = (s: HostSlot) => new Date(s.startsAt).getTime() <= Date.now();
  const actions = (s: HostSlot) => {
    const b = live(s);
    if (b && past(s))
      return (
        <Space wrap size={space[2]}>
          <Button onClick={() => done.mutate({ id: b.id, outcome: "COMPLETED" })}>Held</Button>
          <Button onClick={() => done.mutate({ id: b.id, outcome: "NOT_HELD" })}>Not held</Button>
        </Space>
      );
    if (b) return <Button danger onClick={() => cancel.mutate(b.id)}>Cancel booking</Button>;
    if (s.status === "OPEN" && !past(s)) return <Button onClick={() => withdraw.mutate(s.id)}>Withdraw</Button>;
    return null;
  };
  const who = (s: HostSlot) => {
    const b = live(s) ?? s.bookings.find((x) => x.status === "COMPLETED" || x.status === "NOT_HELD");
    return b ? `${b.booker.name} (${b.booker.employeeCode})` : s.status === "OPEN" ? "Free" : "Withdrawn";
  };
  const state = (s: HostSlot) => {
    const b = s.bookings[0];
    if (live(s)) return <StatusChip tone="success">Booked</StatusChip>;
    if (b?.status === "COMPLETED") return <StatusChip tone="info">Held</StatusChip>;
    if (b?.status === "NOT_HELD") return <StatusChip tone="neutral">Not held</StatusChip>;
    return <StatusChip tone="neutral">{s.status === "OPEN" ? "Free" : "Withdrawn"}</StatusChip>;
  };

  const offerButton = status.data?.isHost && status.data.active && (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setOffering(true)}>
      Offer a time
    </Button>
  );

  return (
    <>
      <PageHeader title="Unmute hosting" subtitle="Times you offer, and who booked them" actions={offerButton || undefined} />
      <QueryState isLoading={status.isLoading} error={status.error} onRetry={() => void status.refetch()} skeleton={<SkeletonTable rows={4} />}>
        {!status.data?.isHost ? (
          <Panel>
            <EmptyState kind="forbidden" title="You are not an Unmute host" description="A director authorises Wellsure Office members as hosts." compact />
          </Panel>
        ) : !status.data.active ? (
          <Panel>
            <EmptyState illustration="inbox" title="Unmute is not set up yet" description={`Not set: ${status.data.missing.join(", ").toLowerCase()}.`} compact />
          </Panel>
        ) : (
          <Stack>
            <Panel title="My times" subtitle="Employees see these as the Wellsure Office, not by your name">
              <DataTable<HostSlot>
                rowKey="id"
                loading={slots.isLoading}
                error={slots.error}
                onRetry={() => void slots.refetch()}
                dataSource={slots.data ?? []}
                pagination={false}
                empty={<EmptyState title="No times offered" description="Offer a time inside the availability window." compact illustration={false} action={offerButton || undefined} />}
                columns={[
                  { title: "When", key: "when", render: (_: unknown, s) => <span style={{ fontWeight: fw.medium, color: v.textPrimary }}>{when(s)}</span> },
                  { title: "Booked by", key: "who", render: (_: unknown, s) => who(s) },
                  { title: "Status", key: "state", render: (_: unknown, s) => state(s) },
                  { title: "", key: "act", align: "right", render: (_: unknown, s) => actions(s) },
                ]}
                mobile={{ title: (s) => when(s), subtitle: (s) => who(s), status: state, actions }}
              />
            </Panel>
          </Stack>
        )}
      </QueryState>
      <SideDrawer
        open={offering}
        onClose={() => setOffering(false)}
        title="Offer a time"
        subtitle="It must fall inside the availability window; its length is the session length the directors set."
        primaryLabel="Offer"
        primaryDisabled={!startsAt}
        primaryLoading={create.isPending}
        onPrimary={() => startsAt && create.mutate(startsAt.second(0).millisecond(0).toISOString())}
      >
        <label htmlFor="unmute-start" style={{ display: "block", marginBottom: space[2], color: v.textBody, fontSize: fs.md }}>
          Starts at
        </label>
        <DatePicker id="unmute-start" showTime={{ format: "HH:mm", minuteStep: 5 }} format="DD MMM YYYY HH:mm" style={{ width: "100%" }} value={startsAt} onChange={setStartsAt} />
      </SideDrawer>
    </>
  );
}
