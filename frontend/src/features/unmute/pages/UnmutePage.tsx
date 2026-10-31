import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, Space } from "antd";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, QueryState, SideDrawer, SkeletonTable, Stack, StatusChip, toast } from "../../../ui";
import * as unmuteApi from "../api";
import { slotTime } from "../time";
import type { FreeSlot, MyBooking } from "../api";

const STATUS_LABEL: Record<MyBooking["status"], string> = { BOOKED: "Booked", CANCELLED: "Cancelled", RESCHEDULED: "Moved", COMPLETED: "Held", NOT_HELD: "Not held" };
const tone = (s: MyBooking["status"]) => (s === "BOOKED" ? "success" : s === "CANCELLED" ? "neutral" : s === "COMPLETED" ? "info" : "neutral");
const when = slotTime;

// Employee portal → Unmute (D-29): book a conversation with the Wellsure Office to raise an issue or share an idea for the company. Nothing about the
// conversation is stored: only the time and whether it happened. The host appears as the workspace's name.
export function UnmutePage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["unmute", "status"], queryFn: unmuteApi.status });
  const canBook = status.data?.active && status.data.canBook;
  const slots = useQuery({ queryKey: ["unmute", "slots"], queryFn: unmuteApi.freeSlots, enabled: Boolean(canBook) });
  const mine = useQuery({ queryKey: ["unmute", "mine"], queryFn: unmuteApi.myBookings });
  const [booking, setBooking] = useState<FreeSlot | null>(null);
  const [cancelling, setCancelling] = useState<MyBooking | null>(null);
  const [moving, setMoving] = useState<MyBooking | null>(null);
  const [moveTo, setMoveTo] = useState<string>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["unmute"] });
  const onError = (fallback: string) => (err: unknown) => {
    toast.error(apiErrorMessage(err, fallback));
    refresh();
  };

  const book = useMutation({ mutationFn: (slotId: string) => unmuteApi.book(slotId), onSuccess: () => { setBooking(null); refresh(); toast.success("Booked. You can see it under My bookings."); }, onError: onError("Couldn't book that time.") });
  const cancel = useMutation({ mutationFn: (id: string) => unmuteApi.cancel(id), onSuccess: () => { setCancelling(null); refresh(); toast.success("Booking cancelled."); }, onError: onError("Couldn't cancel the booking.") });
  const move = useMutation({ mutationFn: ({ id, slotId }: { id: string; slotId: string }) => unmuteApi.reschedule(id, slotId), onSuccess: () => { setMoving(null); setMoveTo(undefined); refresh(); toast.success("Booking moved."); }, onError: onError("Couldn't move the booking.") });

  const name = status.data?.officeName ?? "Wellsure Office";
  const slotOptions = (slots.data ?? []).map((s) => ({ value: s.id, label: when(s) }));

  return (
    <>
      <PageHeader title="Unmute" subtitle={`Book a conversation with the ${name} to raise an issue or share an idea for the company`} />
      <QueryState isLoading={status.isLoading} error={status.error} onRetry={() => void status.refetch()} skeleton={<SkeletonTable rows={4} />}>
        <Stack>
          <div style={{ color: v.textSecondary, fontSize: fs.sm }}>Only the time and whether the conversation happened are kept. Nothing you say is recorded or written down here.</div>
          {!status.data?.active ? (
            <Panel>
              <EmptyState illustration="inbox" title="Unmute is not set up yet" description="It opens once the directors have chosen its times." compact />
            </Panel>
          ) : !status.data.canBook ? (
            <Panel>
              <EmptyState illustration="inbox" title="Booking is not open" description="The directors have not opened Unmute bookings yet." compact />
            </Panel>
          ) : (
            <Panel title="Free times" subtitle={slots.data ? `${slots.data.length} available` : undefined}>
              <DataTable<FreeSlot>
                rowKey="id"
                loading={slots.isLoading}
                error={slots.error}
                onRetry={() => void slots.refetch()}
                dataSource={slots.data ?? []}
                pagination={false}
                empty={<EmptyState title="No free times right now" description="Please look again later." compact illustration={false} />}
                columns={[
                  { title: "When", key: "when", render: (_: unknown, s) => <span style={{ fontWeight: fw.medium, color: v.textPrimary }}>{when(s)}</span> },
                  { title: "With", key: "with", render: () => name },
                  { title: "", key: "act", align: "right", render: (_: unknown, s) => <Button type="primary" onClick={() => setBooking(s)} aria-label={`Book ${when(s)}`}>Book</Button> },
                ]}
                mobile={{ title: (s) => when(s), subtitle: () => name, actions: (s) => <Button type="primary" block onClick={() => setBooking(s)}>Book</Button> }}
              />
            </Panel>
          )}
          <Panel title="My bookings">
            <DataTable<MyBooking>
              rowKey="id"
              loading={mine.isLoading}
              error={mine.error}
              onRetry={() => void mine.refetch()}
              dataSource={mine.data ?? []}
              pagination={false}
              empty={<EmptyState title="No bookings yet" description={null} compact illustration={false} />}
              columns={[
                { title: "When", key: "when", render: (_: unknown, b) => when(b) },
                { title: "With", dataIndex: "host" },
                { title: "Status", key: "status", render: (_: unknown, b) => <StatusChip tone={tone(b.status)}>{STATUS_LABEL[b.status]}</StatusChip> },
                {
                  title: "",
                  key: "act",
                  align: "right",
                  render: (_: unknown, b) =>
                    b.status === "BOOKED" ? (
                      <Space wrap size={space[2]}>
                        {canBook && <Button onClick={() => setMoving(b)}>Move</Button>}
                        <Button danger onClick={() => setCancelling(b)}>Cancel</Button>
                      </Space>
                    ) : null,
                },
              ]}
              mobile={{
                title: (b) => when(b),
                subtitle: (b) => b.host,
                status: (b) => <StatusChip tone={tone(b.status)}>{STATUS_LABEL[b.status]}</StatusChip>,
                actions: (b) =>
                  b.status === "BOOKED" ? (
                    <Space wrap size={space[2]}>
                      {canBook && <Button onClick={() => setMoving(b)}>Move</Button>}
                      <Button danger onClick={() => setCancelling(b)}>Cancel</Button>
                    </Space>
                  ) : null,
              }}
            />
          </Panel>
        </Stack>
      </QueryState>

      <ConfirmModal
        open={booking !== null}
        onCancel={() => setBooking(null)}
        onConfirm={() => booking && book.mutate(booking.id)}
        loading={book.isPending}
        title="Book this time?"
        description={booking ? `${when(booking)} with the ${name}.` : ""}
        confirmLabel="Book"
      />
      <ConfirmModal
        open={cancelling !== null}
        onCancel={() => setCancelling(null)}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        loading={cancel.isPending}
        danger
        title="Cancel this booking?"
        description={cancelling ? when(cancelling) : ""}
        confirmLabel="Cancel booking"
        cancelLabel="Keep it"
      />
      <SideDrawer
        open={moving !== null}
        onClose={() => setMoving(null)}
        title="Move this booking"
        subtitle={moving ? `Now: ${when(moving)}` : undefined}
        primaryLabel="Move"
        primaryDisabled={!moveTo}
        primaryLoading={move.isPending}
        onPrimary={() => moving && moveTo && move.mutate({ id: moving.id, slotId: moveTo })}
      >
        <label htmlFor="unmute-move" style={{ display: "block", marginBottom: space[2], color: v.textBody }}>
          New time
        </label>
        <Select id="unmute-move" style={{ width: "100%" }} placeholder={slotOptions.length ? "Choose a free time" : "No free times right now"} options={slotOptions} value={moveTo} onChange={setMoveTo} />
      </SideDrawer>
    </>
  );
}
