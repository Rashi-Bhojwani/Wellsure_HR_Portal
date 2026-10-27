import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Input, Select, Tooltip } from "antd";
import * as biometricApi from "../../../api/biometric";
import type { FlaggedRow } from "../../../api/biometric";
import { BulkAcceptFlaggedModal } from "../../../components/devices/BulkAcceptFlaggedModal";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, FilterBar, StatusChip, toast, useIsPhone } from "../../../ui";
import { FLAG_LABEL, invalidateBiometric, when } from "./deviceLabels";

const FlagChip = ({ flag }: { flag: string }) => <StatusChip tone="warning">{FLAG_LABEL[flag] ?? flag}</StatusChip>;

// Flagged punches (P2-J): implausible times, stored but left out of attendance until someone accepts or discards them.
// Each decision is recorded with its reason, so nothing here is optimistic; bulk accept previews exactly what it will accept.
export function FlaggedTab() {
  const qc = useQueryClient();
  const phone = useIsPhone();
  const [filter, setFilter] = useState<biometricApi.FlaggedFilter>({});
  const [ticked, setTicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState<biometricApi.FlaggedSelection | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ["biometric", "flagged", filter], queryFn: () => biometricApi.listFlagged(filter) });
  const { data: devices = [] } = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  const rows = data?.flagged ?? [];
  const total = data?.total ?? 0;
  const activeCount = Object.values(filter).filter((x) => x !== undefined).length;
  const filtered = activeCount > 0;
  const [deciding, setDeciding] = useState<{ row: FlaggedRow; decision: "ACCEPTED" | "DISCARDED" } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const resolve = useMutation({
    mutationFn: () => biometricApi.resolveFlag(deciding!.row.id, { decision: deciding!.decision, reason }),
    onSuccess: () => {
      invalidateBiometric(qc);
      toast.success(deciding?.decision === "ACCEPTED" ? "Punch accepted." : "Punch discarded.");
      setDeciding(null);
      setReason("");
      setReasonTouched(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not record the decision.")),
  });
  const setF = (patch: Partial<biometricApi.FlaggedFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setTicked([]);
  };
  const decide = (row: FlaggedRow, decision: "ACCEPTED" | "DISCARDED") => {
    setReason("");
    setReasonTouched(false);
    setDeciding({ row, decision });
  };
  const decideButtons = (r: FlaggedRow, block = false) => (
    <>
      <Button size={block ? "middle" : "small"} onClick={() => decide(r, "ACCEPTED")} style={block ? { flex: 1 } : undefined}>
        Accept
      </Button>
      <Button size={block ? "middle" : "small"} danger onClick={() => decide(r, "DISCARDED")} style={block ? { flex: 1 } : undefined}>
        Discard
      </Button>
    </>
  );
  const reasonMissing = reasonTouched && !reason.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
      <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.md }}>
        Punches with an implausible time — in the future, or very old — usually mean the device clock is wrong. They are stored but left out of attendance until you accept or discard them. When a device goes
        wrong, flagged punches arrive for a whole branch at once: filter to them, tick them, or accept everything that matches, after seeing exactly what that is.
      </p>
      <FilterBar
        activeCount={activeCount}
        onClear={() => setF({ deviceId: undefined, flag: undefined, from: undefined, to: undefined })}
        style={{ marginBottom: 0 }}
        filters={
          <>
            <Select
              allowClear
              aria-label="Device"
              placeholder="Any device"
              style={{ width: phone ? "100%" : 240 }}
              value={filter.deviceId}
              onChange={(val) => setF({ deviceId: val })}
              options={devices.map((d) => ({ value: d.id, label: d.name }))}
            />
            <Select
              allowClear
              aria-label="Reason flagged"
              placeholder="Any reason"
              style={{ width: phone ? "100%" : 160 }}
              value={filter.flag}
              onChange={(val) => setF({ flag: val })}
              options={[
                { value: "TOO_OLD", label: "Too old" },
                { value: "FUTURE", label: "In the future" },
              ]}
            />
            <DatePicker.RangePicker
              aria-label="Dates"
              format="D MMM YYYY"
              style={{ width: phone ? "100%" : undefined }}
              value={filter.from && filter.to ? [dayjs(filter.from), dayjs(filter.to)] : null}
              onChange={(val) => setF({ from: val?.[0]?.format("YYYY-MM-DD"), to: val?.[1]?.format("YYYY-MM-DD") })}
            />
          </>
        }
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center" }}>
        <Button type="primary" disabled={ticked.length === 0} onClick={() => setBulk({ ids: ticked })} block={phone}>
          {ticked.length ? `Accept the ${ticked.length} ticked…` : "Accept ticked…"}
        </Button>
        <Tooltip title={!filtered ? "Choose a device, a reason or dates first, so you know what you are accepting." : total > 2000 ? "More than 2,000 match: narrow it and accept in parts." : ""}>
          <span style={{ display: phone ? "block" : undefined, width: phone ? "100%" : undefined }}>
            <Button disabled={!filtered || total === 0 || total > 2000} onClick={() => setBulk({ filter })} block={phone}>
              {filtered ? `Accept all ${total} that match…` : "Accept all that match…"}
            </Button>
          </span>
        </Tooltip>
        <span style={{ color: v.textSecondary, fontSize: fs.sm }}>
          {total > rows.length ? `Showing the latest ${rows.length} of ${total}. ` : ""}
          You will see every punch and confirm before anything is accepted.
        </span>
      </div>
      <DataTable<FlaggedRow>
        rowKey="id"
        density="compact"
        loading={isLoading || isFetching}
        error={error}
        onRetry={() => void refetch()}
        dataSource={rows}
        pagination={{ pageSize: 50 }}
        rowSelection={{ selectedRowKeys: ticked, onChange: (keys) => setTicked(keys as string[]), preserveSelectedRowKeys: true }}
        empty={filtered ? <EmptyState kind="no-results" compact title="No flagged punches match." description="Try another device, reason or dates." /> : <EmptyState compact title="No flagged punches." description="Punches with an implausible time will wait here for a decision." />}
        columns={[
          { title: "Device", dataIndex: "device" },
          { title: "Device user ID", dataIndex: "deviceUserId" },
          { title: "Employee", key: "emp", render: (_, r) => r.employee?.name ?? <span style={{ color: v.textSecondary }}>unmapped</span> },
          { title: "Device time", dataIndex: "localTime" },
          { title: "Received", dataIndex: "receivedAt", render: when },
          { title: "Flag", dataIndex: "flag", render: (f: string) => <FlagChip flag={f} /> },
          { title: "", key: "actions", align: "right", render: (_, r) => <span style={{ display: "inline-flex", gap: space[1] }}>{decideButtons(r)}</span> },
        ]}
        mobile={{
          selection: false, // renders its own select control on the card
          title: (r) => r.employee?.name ?? `Unmapped · ${r.deviceUserId}`,
          subtitle: (r) => `${r.device} · ${r.localTime}`,
          status: (r) => <FlagChip flag={r.flag} />,
          fields: [
            { label: "Device user ID", render: (r) => r.deviceUserId },
            { label: "Received", render: (r) => when(r.receivedAt) },
          ],
          actions: (r) => (
            <div style={{ display: "flex", flexDirection: "column", gap: space[2], width: "100%" }}>
              <Checkbox
                checked={ticked.includes(r.id)}
                onChange={(e) => setTicked((t) => (e.target.checked ? [...t, r.id] : t.filter((k) => k !== r.id)))}
                style={{ minHeight: 44, alignItems: "center" }}
              >
                Tick to accept together
              </Checkbox>
              <div style={{ display: "flex", gap: space[2] }}>{decideButtons(r, true)}</div>
            </div>
          ),
        }}
      />
      <BulkAcceptFlaggedModal
        key={JSON.stringify(bulk)}
        selection={bulk}
        onClose={() => {
          setBulk(null);
          setTicked([]);
        }}
      />
      <ConfirmModal
        open={!!deciding}
        onCancel={() => {
          if (!resolve.isPending) setDeciding(null);
        }}
        onConfirm={() => {
          setReasonTouched(true);
          if (reason.trim()) resolve.mutate();
        }}
        loading={resolve.isPending}
        danger={deciding?.decision === "DISCARDED"}
        title={deciding?.decision === "ACCEPTED" ? "Accept this punch?" : "Discard this punch?"}
        description={
          deciding
            ? `${deciding.row.deviceUserId} at ${deciding.row.localTime} on ${deciding.row.device}. ${deciding.decision === "ACCEPTED" ? "It will count towards attendance from now on." : "It stays on record but never counts."}`
            : undefined
        }
        confirmLabel={deciding?.decision === "ACCEPTED" ? "Accept" : "Discard"}
      >
        <label htmlFor="flag-reason" style={{ display: "block", fontSize: fs.sm, color: v.textSecondary, marginBottom: space[1] }}>
          Why (required)
        </label>
        <Input.TextArea
          id="flag-reason"
          rows={2}
          placeholder="Why (required)"
          value={reason}
          status={reasonMissing ? "error" : undefined}
          aria-invalid={reasonMissing}
          aria-describedby={reasonMissing ? "flag-reason-error" : undefined}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setReasonTouched(true)}
        />
        {reasonMissing && (
          <div id="flag-reason-error" role="alert" style={{ color: v.danger, fontSize: fs.sm, marginTop: space[1] }}>
            Give a reason: it is recorded with the decision.
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}
