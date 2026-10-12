import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Checkbox, Descriptions, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import * as biometricApi from "../../api/biometric";
import type { FlaggedSelection } from "../../api/biometric";
import { apiErrorMessage } from "../../lib/apiError";

const { Text, Paragraph } = Typography;
const FLAG_LABEL: Record<string, string> = { FUTURE: "In the future", TOO_OLD: "Too old" };

// Accept many flagged punches at once (docs/plans/PHASE_2.md "P2-J", D). The device-outage case: when a device's
// clock goes wrong, flagged punches arrive for a whole branch together. It shows exactly what will be accepted,
// needs a reason and an explicit tick, and only accepts the set it showed (the server checks). The caller keys it by
// the selection, so a new selection starts with an empty reason and an unticked box.
export function BulkAcceptFlaggedModal({ selection, onClose }: { selection: FlaggedSelection | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
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
      void message.success(`Accepted ${r.accepted} punches; ${r.recomputedDays} attendance days are being recomputed.${r.unmapped ? ` ${r.unmapped} belong to nobody yet and count once their device ID is mapped.` : ""}`);
      void qc.invalidateQueries({ queryKey: ["biometric"] });
      onClose();
    },
    onError: (err) => {
      void message.error(apiErrorMessage(err, "Could not accept these punches."));
      void preview.refetch(); // the set may have changed: show the new one, and make them look again
      setLooked(false);
    },
  });

  const p = preview.data;
  const ready = !!p && p.count > 0 && reason.trim().length >= 5 && looked;
  return (
    <Modal
      open={!!selection}
      title={p ? `Accept ${p.count} flagged punch${p.count === 1 ? "" : "es"}?` : "Accept flagged punches?"}
      width={860}
      onCancel={onClose}
      okText={p ? `Accept ${p.count}` : "Accept"}
      onOk={() => accept.mutate()}
      okButtonProps={{ disabled: !ready, loading: accept.isPending }}
      destroyOnHidden
    >
      {preview.isError ? (
        <Alert type="error" showIcon title={apiErrorMessage(preview.error, "Could not list these punches.")} />
      ) : !p ? (
        <Text type="secondary">Loading exactly what would be accepted…</Text>
      ) : p.count === 0 ? (
        <Alert type="info" showIcon title="Nothing is waiting for a decision in that selection any more." />
      ) : (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            title="Accepted punches count towards attendance from now on, and the days they belong to are recomputed."
            description="Use this when you have checked that the times are right (for example a device clock that was wrong, now corrected). It is recorded against each punch, with your reason."
          />
          {p.ownLeftOut > 0 && (
            <Alert
              type="info"
              showIcon
              title={`${p.ownLeftOut} of your own punch${p.ownLeftOut === 1 ? " is" : "es are"} left out.`}
              description="Nobody decides the evidence of their own attendance. Another HR admin or Super Admin decides those."
            />
          )}
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Punches">{p.count}</Descriptions.Item>
            <Descriptions.Item label="People">{p.employees}</Descriptions.Item>
            <Descriptions.Item label="Attendance days affected">{p.affectedDays}</Descriptions.Item>
            <Descriptions.Item label="Belong to nobody yet">{p.unmappedCount ? `${p.unmappedCount} (they count once their device ID is mapped)` : "0"}</Descriptions.Item>
            <Descriptions.Item label="Devices" span={2}>
              {p.byDevice.map((d) => <Tag key={d.device}>{d.device}: {d.count}</Tag>)}
            </Descriptions.Item>
            <Descriptions.Item label="Reason flagged" span={2}>
              {p.byFlag.map((f) => <Tag key={f.flag} color="orange">{FLAG_LABEL[f.flag] ?? f.flag}: {f.count}</Tag>)}
            </Descriptions.Item>
            <Descriptions.Item label="Days" span={2}>
              {p.byDate.map((d) => <Tag key={d.date}>{dayjs(d.date).format("D MMM YYYY")}: {d.count}</Tag>)}
            </Descriptions.Item>
          </Descriptions>
          <Table
            size="small"
            rowKey="id"
            dataSource={p.punches}
            pagination={{ pageSize: 10, size: "small", showSizeChanger: false }}
            scroll={{ y: 240 }}
            columns={[
              { title: "Device", dataIndex: "device" },
              { title: "Device user ID", dataIndex: "deviceUserId" },
              { title: "Employee", key: "emp", render: (_, r) => r.employee?.name ?? <Text type="secondary">unmapped</Text> },
              { title: "Device time", dataIndex: "localTime" },
              { title: "Flag", dataIndex: "flag", render: (f: string) => FLAG_LABEL[f] ?? f },
            ]}
          />
          <div>
            <Text strong>Why are these right? (required)</Text>
            <Input.TextArea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The device clock was an hour slow from 3 to 5 August; corrected on 6 August." />
          </div>
          <Checkbox checked={looked} onChange={(e) => setLooked(e.target.checked)}>
            I have looked at these {p.count} punches and want them to count.
          </Checkbox>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            If anything is decided or arrives while you confirm, nothing is changed and you are shown the new list.
          </Paragraph>
        </Space>
      )}
    </Modal>
  );
}
