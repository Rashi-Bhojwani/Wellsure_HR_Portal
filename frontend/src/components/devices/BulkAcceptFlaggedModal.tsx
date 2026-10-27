import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox, Input } from "antd";
import dayjs from "dayjs";
import * as biometricApi from "../../api/biometric";
import type { BulkAcceptPreview, FlaggedSelection } from "../../api/biometric";
import { apiErrorMessage } from "../../lib/apiError";
import { fs, fw, space, v } from "../../theme/tokens";
import { ApprovalBanner, DataTable, KeyValueGrid, SideDrawer, Skel, Stack, StatusChip, toast } from "../../ui";

const FLAG_LABEL: Record<string, string> = { FUTURE: "In the future", TOO_OLD: "Too old" };
type Punch = BulkAcceptPreview["punches"][number];

const Chips = ({ children }: { children: ReactNode }) => <span style={{ display: "inline-flex", flexWrap: "wrap", gap: space[1] }}>{children}</span>;

// Accept many flagged punches at once (docs/plans/PHASE_2.md "P2-J", D). The device-outage case: when a device's
// clock goes wrong, flagged punches arrive for a whole branch together. It shows exactly what will be accepted,
// needs a reason and an explicit tick, and only accepts the set it showed (the server checks). The caller keys it by
// the selection, so a new selection starts with an empty reason and an unticked box. It is an audited decision, so
// it closes only once the server has answered.
export function BulkAcceptFlaggedModal({ selection, onClose }: { selection: FlaggedSelection | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [looked, setLooked] = useState(false);
  const preview = useQuery({
    queryKey: ["biometric", "flagged", "bulk-preview", selection],
    queryFn: () => biometricApi.previewBulkAccept(selection!),
    enabled: !!selection,
    gcTime: 0,
    staleTime: 0,
  });

  const accept = useMutation({
    mutationFn: () => biometricApi.bulkAcceptFlagged(selection!, { fingerprint: preview.data!.fingerprint, reason: reason.trim() }),
    onSuccess: (r) => {
      toast.success(`Accepted ${r.accepted} punches; ${r.recomputedDays} attendance days are being recomputed.${r.unmapped ? ` ${r.unmapped} belong to nobody yet and count once their device ID is mapped.` : ""}`);
      void qc.invalidateQueries({ queryKey: ["biometric"] });
      onClose();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not accept these punches."));
      void preview.refetch(); // the set may have changed: show the new one, and make them look again
      setLooked(false);
    },
  });

  const p = preview.data;
  const reasonShort = reason.trim().length < 5;
  const ready = !!p && p.count > 0 && !reasonShort && looked;
  return (
    <SideDrawer
      open={!!selection}
      onClose={() => {
        if (!accept.isPending) onClose();
      }}
      size="wide"
      title={p ? `Accept ${p.count} flagged punch${p.count === 1 ? "" : "es"}?` : "Accept flagged punches?"}
      primaryLabel={p ? `Accept ${p.count}` : "Accept"}
      onPrimary={() => accept.mutate()}
      primaryDisabled={!ready}
      primaryLoading={accept.isPending}
    >
      {preview.isError ? (
        <ApprovalBanner tone="danger" title={apiErrorMessage(preview.error, "Could not list these punches.")} />
      ) : !p ? (
        <Stack gap={space[3]}>
          <span style={{ color: v.textSecondary }}>Loading exactly what would be accepted…</span>
          <Skel h={56} />
          <Skel h={120} />
          <Skel h={200} />
        </Stack>
      ) : p.count === 0 ? (
        <ApprovalBanner tone="info" title="Nothing is waiting for a decision in that selection any more." />
      ) : (
        <Stack gap={space[4]}>
          <ApprovalBanner
            tone="warning"
            title="Accepted punches count towards attendance from now on, and the days they belong to are recomputed."
            description="Use this when you have checked that the times are right (for example a device clock that was wrong, now corrected). It is recorded against each punch, with your reason."
          />
          {p.ownLeftOut > 0 && (
            <ApprovalBanner
              tone="info"
              title={`${p.ownLeftOut} of your own punch${p.ownLeftOut === 1 ? " is" : "es are"} left out.`}
              description="Nobody decides the evidence of their own attendance. Another HR admin or Super Admin decides those."
            />
          )}
          <KeyValueGrid
            items={[
              { label: "Punches", value: p.count },
              { label: "People", value: p.employees },
              { label: "Attendance days affected", value: p.affectedDays },
              { label: "Belong to nobody yet", value: p.unmappedCount ? `${p.unmappedCount} (they count once their device ID is mapped)` : "0" },
              {
                label: "Devices",
                wide: true,
                value: (
                  <Chips>
                    {p.byDevice.map((d) => (
                      <StatusChip key={d.device} tone="neutral">{`${d.device}: ${d.count}`}</StatusChip>
                    ))}
                  </Chips>
                ),
              },
              {
                label: "Reason flagged",
                wide: true,
                value: (
                  <Chips>
                    {p.byFlag.map((f) => (
                      <StatusChip key={f.flag} tone="warning">{`${FLAG_LABEL[f.flag] ?? f.flag}: ${f.count}`}</StatusChip>
                    ))}
                  </Chips>
                ),
              },
              {
                label: "Days",
                wide: true,
                value: (
                  <Chips>
                    {p.byDate.map((d) => (
                      <StatusChip key={d.date} tone="neutral">{`${dayjs(d.date).format("D MMM YYYY")}: ${d.count}`}</StatusChip>
                    ))}
                  </Chips>
                ),
              },
            ]}
          />
          <DataTable<Punch>
            density="compact"
            rowKey="id"
            dataSource={p.punches}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              { title: "Device", dataIndex: "device" },
              { title: "Device user ID", dataIndex: "deviceUserId" },
              { title: "Employee", key: "emp", render: (_, r) => r.employee?.name ?? <span style={{ color: v.textSecondary }}>unmapped</span> },
              { title: "Device time", dataIndex: "localTime" },
              { title: "Flag", dataIndex: "flag", render: (f: string) => FLAG_LABEL[f] ?? f },
            ]}
            mobile={{
              title: (r) => r.employee?.name ?? `Unmapped · ${r.deviceUserId}`,
              subtitle: (r) => `${r.device} · ${r.localTime}`,
              status: (r) => <StatusChip tone="warning">{FLAG_LABEL[r.flag] ?? r.flag}</StatusChip>,
            }}
          />
          <div>
            <label htmlFor="bulk-accept-reason" style={{ display: "block", fontWeight: fw.semibold, color: v.textPrimary, marginBottom: space[1] }}>
              Why are these right? (required)
            </label>
            <Input.TextArea
              id="bulk-accept-reason"
              rows={2}
              maxLength={500}
              value={reason}
              status={reasonTouched && reasonShort ? "error" : undefined}
              aria-invalid={reasonTouched && reasonShort}
              aria-describedby="bulk-accept-reason-help"
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setReasonTouched(true)}
              placeholder="e.g. The device clock was an hour slow from 3 to 5 August; corrected on 6 August."
            />
            <div id="bulk-accept-reason-help" style={{ fontSize: fs.sm, marginTop: space[1], color: reasonTouched && reasonShort ? v.danger : v.textSecondary }}>
              At least 5 characters. It is recorded against each punch.
            </div>
          </div>
          <Checkbox checked={looked} onChange={(e) => setLooked(e.target.checked)} style={{ minHeight: 44, alignItems: "center" }}>
            I have looked at these {p.count} punches and want them to count.
          </Checkbox>
          <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.sm }}>If anything is decided or arrives while you confirm, nothing is changed and you are shown the new list.</p>
        </Stack>
      )}
    </SideDrawer>
  );
}
