import type { ReactNode } from "react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Input, Modal, Space, Typography } from "antd";
import { EmptyState, SideDrawer, SkeletonCard, StatusChip, Timeline, toast } from "../../ui";
import { CheckCircleOutlined } from "@ant-design/icons";
import type { CheckerAvailability, VersionView } from "../../api/payroll";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { CheckersNote } from "./CheckersNote";

const { Text } = Typography;

interface ConfirmPreviewLike {
  version: number;
  sourceLabel: string | null;
  authorName: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}

/** Confirming a component or structure: shows what is being vouched for and who wrote it, asks what was checked, and refuses the author. */
export function ItemConfirmModal<P extends ConfirmPreviewLike>({
  title,
  queryKey,
  loadPreview,
  confirm,
  renderValue,
  extra,
  onClose,
  onDone,
}: {
  title: string;
  queryKey: readonly unknown[];
  loadPreview: () => Promise<P>;
  confirm: (body: { version: number; note: string; fingerprint: string }) => Promise<unknown>;
  renderValue: (p: P) => ReactNode;
  extra?: (p: P) => ReactNode;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: preview, isLoading, error } = useQuery({ queryKey, queryFn: loadPreview, staleTime: 0, gcTime: 0 });
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => confirm({ version: preview!.version, note, fingerprint: preview!.fingerprint }),
    onSuccess: () => {
      toast.success("Confirmed.");
      onDone();
      onClose();
    },
    onError: (err) => setProblem(apiErrorMessage(err, "Could not confirm.")),
  });
  const ready = !!preview && !preview.blocked && note.trim().length >= 5;
  return (
    <Modal
      open
      width={680}
      title={title}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} disabled={!ready} loading={run.isPending} onClick={() => run.mutate()}>
            Confirm this version
          </Button>
        </Space>
      }
    >
      {isLoading && <SkeletonCard lines={4} />}
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load.")} />}
      {preview && (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          {preview.blocked && <Alert type="warning" showIcon title={preview.blocked} />}
          <Descriptions
            size="small"
            column={1}
            bordered
            items={[
              { key: "value", label: "What it is", children: renderValue(preview) },
              { key: "source", label: "Where it came from", children: preview.sourceLabel },
              { key: "who", label: "Entered by", children: preview.authorName },
              { key: "ver", label: "Version", children: preview.version },
            ]}
          />
          {extra?.(preview)}
          <CheckersNote checkers={preview.checkers} what="this" />
          <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="What you checked it against, for example “offer template dated 14 Oct” (required)" />
          {problem && <Alert type="error" showIcon title={problem} />}
        </Space>
      )}
    </Modal>
  );
}

export function ItemHistoryDrawer({ title, load, queryKey, renderValue, onClose }: { title: string; queryKey: readonly unknown[]; load: () => Promise<VersionView[]>; renderValue: (v: unknown) => ReactNode; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey, queryFn: load });
  return (
    <SideDrawer open title={title} subtitle="Every version, who entered it and who confirmed it" onClose={onClose} footer={null}>
      {isLoading && <SkeletonCard lines={4} />}
      <Timeline
        empty={!isLoading ? <EmptyState compact title="No versions yet" description={null} /> : null}
        items={(data ?? []).map((v) => ({
          key: String(v.version),
          tone: v.confirmation ? "accent" : "warning",
          content: (
            <>
              <Text strong>Version {v.version}</Text> <span style={{ marginLeft: 4 }}>{v.confirmation ? <StatusChip tone="success">Confirmed</StatusChip> : <StatusChip tone="warning">Never confirmed</StatusChip>}</span>
              <div>{renderValue(v.value)}</div>
            </>
          ),
          time: (
            <>
              Entered by {v.authorName} on {formatDate(v.createdAt)}
              {v.note ? `: “${v.note}”` : ""}
            </>
          ),
          detail: v.confirmation ? (
            <Text type="success">
              Confirmed by {v.confirmation.confirmedByName} on {formatDate(v.confirmation.confirmedAt)}: “{v.confirmation.note}”
            </Text>
          ) : undefined,
        }))}
      />
    </SideDrawer>
  );
}
