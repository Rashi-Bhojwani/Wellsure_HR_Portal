import { useState } from "react";
import { Alert, Button, Checkbox, Flex, Input, Space, Tag, Typography, Upload, message } from "antd";
import type { UploadFile } from "antd";
import { LockOutlined, PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { HELPDESK_STATUS_LABELS, type HelpdeskPriority, type HelpdeskStatus } from "@shared/constants/helpdesk";
import * as helpdeskApi from "../../api/helpdesk";
import type { HelpdeskMessage, HelpdeskTicketSummary } from "../../api/helpdesk";
import { startDownload } from "../../api/documents";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { toFiles } from "./helpdeskUtils";

const { Text, Paragraph } = Typography;

// The same 3-file cap the server enforces (modules/helpdesk/service.ts).
export const MAX_ATTACHMENTS = 3;
export const ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx";

const STATUS_COLORS: Record<HelpdeskStatus, string> = {
  OPEN: "blue",
  IN_PROGRESS: "processing",
  WAITING_ON_EMPLOYEE: "gold",
  RESOLVED: "green",
  CLOSED: "default",
};

// "Waiting on you" is the raiser's wording; HR sees "Waiting on employee".
export function StatusTag({ status, viewer = "raiser" }: { status: HelpdeskStatus; viewer?: "raiser" | "hr" }) {
  const label = viewer === "hr" && status === "WAITING_ON_EMPLOYEE" ? "Waiting on employee" : HELPDESK_STATUS_LABELS[status];
  return <Tag color={STATUS_COLORS[status]}>{label}</Tag>;
}

const PRIORITY_COLORS: Record<HelpdeskPriority, string> = { LOW: "default", NORMAL: "blue", HIGH: "red" };
export function PriorityTag({ priority }: { priority: HelpdeskPriority }) {
  return <Tag color={PRIORITY_COLORS[priority]}>{priority.charAt(0) + priority.slice(1).toLowerCase()}</Tag>;
}

// The banner at the top of a resolved/closed thread.
export function LifecycleNotice({
  ticket,
  viewer,
  onReopen,
  reopening,
}: {
  ticket: HelpdeskTicketSummary;
  viewer: "raiser" | "hr";
  onReopen?: () => void;
  reopening?: boolean;
}) {
  const canReopen = ticket.reopenUntil !== null && new Date(ticket.reopenUntil) > new Date();
  if (ticket.status === "RESOLVED" && ticket.autoClosesAt) {
    return (
      <Alert
        type="success"
        showIcon
        title={`Resolved — this ticket will close automatically on ${formatDateTime(ticket.autoClosesAt)}${viewer === "raiser" ? " unless you reply" : " unless the employee replies"}.`}
        description={viewer === "raiser" ? "Not sorted? Reply below and it goes straight back to HR." : undefined}
      />
    );
  }
  if (ticket.status === "CLOSED") {
    return (
      <Alert
        type="info"
        showIcon
        title={ticket.closedAt ? `Closed on ${formatDateTime(ticket.closedAt)}.` : "Closed."}
        description={
          viewer === "raiser"
            ? canReopen
              ? `You can reopen it until ${formatDateTime(ticket.reopenUntil!)}; after that, please raise a new ticket.`
              : "The reopen window has passed — raise a new ticket if you still need help."
            : undefined
        }
        action={
          viewer === "raiser" && canReopen && onReopen ? (
            <Button size="small" onClick={onReopen} loading={reopening}>
              Reopen
            </Button>
          ) : undefined
        }
      />
    );
  }
  return null;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function download(id: string) {
  try {
    startDownload(await helpdeskApi.downloadAttachment(id));
  } catch (err) {
    void message.error(apiErrorMessage(err, "Couldn't download that file."));
  }
}

// The conversation. The raiser's messages sit on the right; internal notes
// (only ever present in HR's view — the server never sends them to the
// raiser) are visually unmistakable.
export function Thread({ messages, viewer }: { messages: HelpdeskMessage[]; viewer: "raiser" | "hr" }) {
  return (
    <Flex vertical gap={12}>
      {messages.map((m) => {
        const mine = viewer === "raiser" ? m.fromRaiser : !m.fromRaiser;
        const background = m.isInternalNote ? "rgba(250, 173, 20, 0.12)" : mine ? "rgba(22, 119, 255, 0.08)" : "rgba(128, 128, 128, 0.08)";
        return (
          <Flex key={m.id} justify={mine ? "flex-end" : "flex-start"}>
            <div
              data-testid={m.isInternalNote ? "internal-note" : "message"}
              style={{ maxWidth: "min(640px, 100%)", background, borderRadius: 8, padding: "8px 12px", border: m.isInternalNote ? "1px dashed #faad14" : undefined }}
            >
              <Space size={6} wrap>
                <Text strong>{m.fromRaiser ? m.author.name : viewer === "raiser" ? `${m.author.name} (HR)` : m.author.name}</Text>
                {m.isInternalNote && (
                  <Tag icon={<LockOutlined />} color="warning">
                    Internal note — not visible to the employee
                  </Tag>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {formatDateTime(m.createdAt)}
                </Text>
              </Space>
              <Paragraph style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{m.body}</Paragraph>
              {m.attachments.length > 0 && (
                <Space wrap style={{ marginTop: 6 }}>
                  {m.attachments.map((a) => (
                    <Button key={a.id} size="small" icon={<PaperClipOutlined />} onClick={() => void download(a.id)}>
                      {a.fileName} · {formatSize(a.sizeBytes)}
                    </Button>
                  ))}
                </Space>
              )}
            </div>
          </Flex>
        );
      })}
    </Flex>
  );
}

// Files are held in the browser and sent with the message (multipart) —
// beforeUpload returning false stops AntD uploading them itself.
export function AttachmentPicker({ files, onChange }: { files: UploadFile[]; onChange: (files: UploadFile[]) => void }) {
  return (
    <Upload
      multiple
      accept={ATTACHMENT_ACCEPT}
      fileList={files}
      maxCount={MAX_ATTACHMENTS}
      beforeUpload={() => false}
      onChange={({ fileList }) => onChange(fileList.slice(0, MAX_ATTACHMENTS))}
    >
      <Button icon={<UploadOutlined />} disabled={files.length >= MAX_ATTACHMENTS}>
        Attach files (up to {MAX_ATTACHMENTS})
      </Button>
    </Upload>
  );
}

export function ReplyBox({
  allowInternal,
  disabledReason,
  submitting,
  onSubmit,
}: {
  allowInternal: boolean;
  disabledReason?: string | null;
  submitting: boolean;
  onSubmit: (input: { body: string; isInternalNote: boolean; files: File[] }) => Promise<unknown>;
}) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);

  if (disabledReason) return <Alert type="info" title={disabledReason} />;

  async function submit() {
    try {
      await onSubmit({ body: body.trim(), isInternalNote: internal, files: toFiles(files) });
      setBody("");
      setFiles([]);
      setInternal(false);
    } catch {
      // the caller shows the error; keep what was typed
    }
  }

  return (
    <Flex vertical gap={8}>
      <Input.TextArea
        rows={3}
        maxLength={5000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? "Internal note — only HR will see this" : "Write a reply…"}
        style={internal ? { borderColor: "#faad14" } : undefined}
      />
      <Flex justify="space-between" align="flex-start" wrap gap={8}>
        <AttachmentPicker files={files} onChange={setFiles} />
        <Space>
          {allowInternal && (
            <Checkbox checked={internal} onChange={(e) => setInternal(e.target.checked)}>
              Internal note
            </Checkbox>
          )}
          <Button type="primary" onClick={() => void submit()} loading={submitting} disabled={!body.trim()}>
            {internal ? "Add note" : "Send"}
          </Button>
        </Space>
      </Flex>
    </Flex>
  );
}
