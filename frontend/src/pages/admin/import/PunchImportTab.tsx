import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Input, Select, Space, Table, Tag, Typography, Upload, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import * as biometricApi from "../../../api/biometric";
import type { ImportPreview } from "../../../api/biometric";
import { apiErrorMessage } from "../../../lib/apiError";

const { Text } = Typography;

// Import Center → Punches (ATTLOG) (Phase 2 P2-B, spec §4.1 route 3).
// Emergency use only: the agent is the routine path. ATTLOG lines don't say
// which device they came from, so HR picks it. Upload → preview (nothing
// stored) → commit with a reason, through the same ingestion service.
export function PunchImportTab() {
  const qc = useQueryClient();
  const { data: devices = [] } = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  const [deviceId, setDeviceId] = useState<string>();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reason, setReason] = useState("");
  const upload = useMutation({
    mutationFn: (file: File) => biometricApi.previewImport(deviceId!, file),
    onSuccess: setPreview,
    onError: (err) => void message.error(apiErrorMessage(err, "Could not read this file.")),
  });
  const commit = useMutation({
    mutationFn: () => biometricApi.commitImport(preview!.batchId, reason),
    onSuccess: (r) => {
      void message.success(`Stored ${r.newCount} new punch(es); ${r.duplicateCount} were already on record.`);
      void qc.invalidateQueries({ queryKey: ["biometric"] });
      setPreview(null);
      setReason("");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not commit this upload.")),
  });
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Alert
        type="warning"
        showIcon
        title="Emergency use only"
        description="Use this when the sync agent couldn't deliver punches (for example, the office PC was down). Upload the device's ATTLOG export exactly as it came off the machine. Punches already on record are skipped, so overlapping files are safe."
      />
      <Space wrap>
        <Select
          style={{ width: 320 }}
          placeholder="Which device is this file from?"
          value={deviceId}
          onChange={(v) => { setDeviceId(v); setPreview(null); }}
          options={devices.filter((d) => d.isActive).map((d) => ({ value: d.id, label: `${d.name} (${d.location.name})` }))}
          aria-label="Device the file came from"
        />
        <Upload
          accept=".txt,.dat,.log,text/plain"
          showUploadList={false}
          disabled={!deviceId}
          beforeUpload={(file) => {
            upload.mutate(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} disabled={!deviceId} loading={upload.isPending}>
            Upload ATTLOG file
          </Button>
        </Upload>
      </Space>
      {preview && (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 3 }} title={`Preview: ${preview.fileName} → ${preview.device.name} (nothing stored yet)`}>
            <Descriptions.Item label="Lines">{preview.totalLines}</Descriptions.Item>
            <Descriptions.Item label="New">{preview.newCount}</Descriptions.Item>
            <Descriptions.Item label="Already on record">{preview.duplicateCount}</Descriptions.Item>
            <Descriptions.Item label="Unmapped">{preview.unmappedCount}</Descriptions.Item>
            <Descriptions.Item label="Flagged (implausible time)">{preview.flaggedCount}</Descriptions.Item>
            <Descriptions.Item label="Rejected">{preview.rejectedCount}</Descriptions.Item>
          </Descriptions>
          {preview.rejected.length > 0 && (
            <Table
              size="small"
              rowKey="lineNumber"
              title={() => "Rejected lines (kept verbatim; they won't be stored)"}
              pagination={false}
              dataSource={preview.rejected.slice(0, 50)}
              columns={[
                { title: "Line", dataIndex: "lineNumber" },
                { title: "As received", dataIndex: "raw", render: (v: string) => <Text code>{v}</Text> },
                { title: "Why", dataIndex: "reason" },
              ]}
            />
          )}
          <Table
            size="small"
            rowKey="lineNumber"
            title={() => "First lines"}
            pagination={{ pageSize: 20 }}
            dataSource={preview.sample}
            columns={[
              { title: "Line", dataIndex: "lineNumber" },
              { title: "Device user ID", dataIndex: "deviceUserId" },
              { title: "Device time", dataIndex: "localTime" },
              { title: "Outcome", dataIndex: "outcome", render: (v: string) => <Tag color={v === "new" ? "green" : v === "duplicate" ? "default" : "gold"}>{v}</Tag> },
            ]}
          />
          <Input.TextArea rows={2} placeholder="Why was the emergency upload needed? (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for the upload" />
          <Button type="primary" disabled={reason.trim().length < 5 || preview.newCount === 0} loading={commit.isPending} onClick={() => commit.mutate()}>
            Commit {preview.newCount} new punch(es)
          </Button>
        </Space>
      )}
    </Space>
  );
}
