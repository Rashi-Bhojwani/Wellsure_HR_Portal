import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import * as biometricApi from "../../../api/biometric";
import type { ImportPreview } from "../../../api/biometric";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, CardGrid, DataTable, FormGroupTitle, StatCard, StatusChip, toast, useIsPhone } from "../../../ui";
import { Dropzone } from "./Dropzone";

type SampleLine = ImportPreview["sample"][number];
type RejectedLine = ImportPreview["rejected"][number];

const OUTCOME_TONE = (o: string) => (o === "new" ? "success" : o === "duplicate" ? "neutral" : "warning") as "success" | "neutral" | "warning";

// Import Center → Punches (ATTLOG) (Phase 2 P2-B, spec §4.1 route 3).
// Emergency use only: the agent is the routine path. ATTLOG lines don't say
// which device they came from, so HR picks it. Upload → preview (nothing
// stored) → commit with a reason, through the same ingestion service.
export function PunchImportTab() {
  const qc = useQueryClient();
  const phone = useIsPhone();
  const { data: devices = [], isLoading: devicesLoading } = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  const [deviceId, setDeviceId] = useState<string>();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reason, setReason] = useState("");
  const upload = useMutation({
    mutationFn: (file: File) => biometricApi.previewImport(deviceId!, file),
    onSuccess: setPreview,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not read this file.")),
  });
  const commit = useMutation({
    mutationFn: () => biometricApi.commitImport(preview!.batchId, reason),
    onSuccess: (r) => {
      toast.success(`Stored ${r.newCount} new punch(es); ${r.duplicateCount} were already on record.`);
      void qc.invalidateQueries({ queryKey: ["biometric"] });
      setPreview(null);
      setReason("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not commit this upload.")),
  });
  const reasonOk = reason.trim().length >= 5;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: phone ? space[4] : space[5], paddingTop: space[2] }}>
      <ApprovalBanner
        tone="warning"
        title="Emergency use only"
        description="Use this when the sync agent couldn't deliver punches (for example, the office PC was down). Upload the device's ATTLOG export exactly as it came off the machine. Punches already on record are skipped, so overlapping files are safe."
      />

      <div>
        <label htmlFor="punch-import-device" style={{ display: "block", fontWeight: fw.medium, color: v.textPrimary, marginBottom: space[2] }}>
          1. Which device is this file from?
        </label>
        <Select
          id="punch-import-device"
          style={{ width: phone ? "100%" : 360 }}
          placeholder="Which device is this file from?"
          value={deviceId}
          loading={devicesLoading}
          onChange={(val) => {
            setDeviceId(val);
            setPreview(null);
          }}
          options={devices.filter((d) => d.isActive).map((d) => ({ value: d.id, label: `${d.name} (${d.location.name})` }))}
          aria-label="Device the file came from"
        />
      </div>

      <div>
        <div style={{ fontWeight: fw.medium, color: v.textPrimary, marginBottom: space[2] }}>2. Upload the ATTLOG file</div>
        <Dropzone
          compact
          accept=".txt,.dat,.log,text/plain"
          disabled={!deviceId}
          loading={upload.isPending}
          onFile={(file) => upload.mutate(file)}
          title={deviceId ? "Drop the ATTLOG file here" : "Pick the device first"}
          hint="A .txt, .dat or .log export, exactly as it came off the machine. Nothing is stored until you commit."
          buttonLabel="Upload ATTLOG file"
        />
      </div>

      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: space[4] }} aria-live="polite">
          <div>
            <FormGroupTitle>Preview: {preview.fileName} → {preview.device.name}</FormGroupTitle>
            <div style={{ color: v.textSecondary, fontSize: fs.md, marginTop: -space[2], marginBottom: space[3] }}>Nothing stored yet.</div>
            <CardGrid min={150} gap={space[3]}>
              <StatCard variant="compact" label="Lines" value={preview.totalLines} />
              <StatCard variant="compact" tone="accent" label="New" value={preview.newCount} />
              <StatCard variant="compact" label="Already on record" value={preview.duplicateCount} />
              <StatCard variant="compact" tone={preview.unmappedCount > 0 ? "warning" : "neutral"} label="Unmapped" value={preview.unmappedCount} />
              <StatCard variant="compact" tone={preview.flaggedCount > 0 ? "warning" : "neutral"} label="Flagged (implausible time)" value={preview.flaggedCount} />
              <StatCard variant="compact" tone={preview.rejectedCount > 0 ? "danger" : "neutral"} label="Rejected" value={preview.rejectedCount} />
            </CardGrid>
          </div>

          {preview.rejected.length > 0 && (
            <div>
              <FormGroupTitle>Rejected lines (kept verbatim; they won't be stored)</FormGroupTitle>
              <DataTable<RejectedLine>
                rowKey="lineNumber"
                density="compact"
                pagination={false}
                dataSource={preview.rejected.slice(0, 50)}
                mobile={{ title: (r) => `Line ${r.lineNumber}`, subtitle: (r) => r.reason, fields: [{ label: "As received", render: (r) => <code style={codeStyle}>{r.raw}</code> }] }}
                columns={[
                  { title: "Line", dataIndex: "lineNumber", render: (n: number) => <span className="ws-num">{n}</span> },
                  { title: "As received", dataIndex: "raw", render: (raw: string) => <code style={codeStyle}>{raw}</code> },
                  { title: "Why", dataIndex: "reason" },
                ]}
              />
            </div>
          )}

          <div>
            <FormGroupTitle>First lines</FormGroupTitle>
            <DataTable<SampleLine>
              rowKey="lineNumber"
              density="compact"
              pagination={{ pageSize: 20 }}
              dataSource={preview.sample}
              mobile={{
                title: (r) => `Line ${r.lineNumber} · user ${r.deviceUserId}`,
                subtitle: (r) => r.localTime,
                status: (r) => <StatusChip tone={OUTCOME_TONE(r.outcome)}>{r.outcome}</StatusChip>,
              }}
              columns={[
                { title: "Line", dataIndex: "lineNumber", render: (n: number) => <span className="ws-num">{n}</span> },
                { title: "Device user ID", dataIndex: "deviceUserId" },
                { title: "Device time", dataIndex: "localTime", render: (t: string) => <span className="ws-num">{t}</span> },
                { title: "Outcome", dataIndex: "outcome", render: (o: string) => <StatusChip tone={OUTCOME_TONE(o)}>{o}</StatusChip> },
              ]}
            />
          </div>

          <div>
            <label htmlFor="punch-import-reason" style={{ display: "block", fontWeight: fw.medium, color: v.textPrimary, marginBottom: space[2] }}>
              3. Why was the emergency upload needed?
            </label>
            <Input.TextArea
              id="punch-import-reason"
              rows={2}
              placeholder="Why was the emergency upload needed? (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Reason for the upload"
              status={reason.length > 0 && !reasonOk ? "error" : undefined}
            />
            <div style={{ fontSize: fs.sm, color: reason.length > 0 && !reasonOk ? v.danger : v.textSecondary, marginTop: space[1] }}>
              Required, at least 5 characters. Recorded with this upload.
            </div>
          </div>
          <div>
            <Button type="primary" icon={<CheckOutlined />} block={phone} disabled={!reasonOk || preview.newCount === 0} loading={commit.isPending} onClick={() => commit.mutate()}>
              Commit {preview.newCount} new punch(es)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const codeStyle = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: fs.sm, background: v.bgSubtle, padding: `1px ${space[1]}px`, borderRadius: radius.xs, wordBreak: "break-all" } as const;
