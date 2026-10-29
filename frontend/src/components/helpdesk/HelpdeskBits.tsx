import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Input, Tooltip, Upload } from "antd";
import type { UploadFile } from "antd";
import { LockOutlined, PaperClipOutlined, SendOutlined } from "@ant-design/icons";
import { HELPDESK_STATUS_LABELS, type HelpdeskPriority, type HelpdeskStatus } from "@shared/constants/helpdesk";
import * as helpdeskApi from "../../api/helpdesk";
import type { HelpdeskMessage, HelpdeskTicketSummary } from "../../api/helpdesk";
import { startDownload } from "../../api/documents";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate, formatDateTime } from "../../lib/dates";
import { toFiles } from "./helpdeskUtils";
import { fs, fw, layout, radius, space, v } from "../../theme/tokens";
import { ApprovalBanner, InitialsAvatar, Panel, Skel, Stack, StatusChip, toast, useIsPhone, usePrefersReducedMotion, type ChipTone } from "../../ui";

// The same 3-file cap the server enforces (modules/helpdesk/service.ts).
export const MAX_ATTACHMENTS = 3;
export const ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx";

const STATUS_TONES: Record<HelpdeskStatus, ChipTone> = {
  OPEN: "info",
  IN_PROGRESS: "purple",
  WAITING_ON_EMPLOYEE: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

// "Waiting on you" is the raiser's wording; HR sees "Waiting on employee".
export function StatusTag({ status, viewer = "raiser" }: { status: HelpdeskStatus; viewer?: "raiser" | "hr" }) {
  const label = viewer === "hr" && status === "WAITING_ON_EMPLOYEE" ? "Waiting on employee" : HELPDESK_STATUS_LABELS[status];
  return <StatusChip tone={STATUS_TONES[status]}>{label}</StatusChip>;
}

const PRIORITY_TONES: Record<HelpdeskPriority, ChipTone> = { LOW: "neutral", NORMAL: "info", HIGH: "danger" };
const priorityLabel = (p: HelpdeskPriority) => p.charAt(0) + p.slice(1).toLowerCase();
export function PriorityTag({ priority }: { priority: HelpdeskPriority }) {
  return <StatusChip tone={PRIORITY_TONES[priority]}>{priorityLabel(priority)}</StatusChip>;
}

export function SensitiveChip() {
  return (
    <StatusChip tone="purple" icon={<LockOutlined aria-hidden />} title="Only roles with the sensitive-ticket permission can see this">
      Sensitive
    </StatusChip>
  );
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
      <ApprovalBanner
        tone="success"
        title={`Resolved — this ticket will close automatically on ${formatDateTime(ticket.autoClosesAt)}${viewer === "raiser" ? " unless you reply" : " unless the employee replies"}.`}
        description={viewer === "raiser" ? "Not sorted? Reply below and it goes straight back to HR." : undefined}
      />
    );
  }
  if (ticket.status === "CLOSED") {
    return (
      <ApprovalBanner
        tone="info"
        title={ticket.closedAt ? `Closed on ${formatDateTime(ticket.closedAt)}.` : "Closed."}
        description={
          viewer === "raiser"
            ? canReopen
              ? `You can reopen it until ${formatDateTime(ticket.reopenUntil!)}; after that, please raise a new ticket.`
              : "The reopen window has passed — raise a new ticket if you still need help."
            : undefined
        }
        actions={
          viewer === "raiser" && canReopen && onReopen ? (
            <Button onClick={onReopen} loading={reopening}>
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
    toast.error(apiErrorMessage(err, "Couldn't download that file."));
  }
}

// Day separators and bubble times are in the company's timezone, like every other date (lib/dates.ts).
const TZ = "Asia/Kolkata";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TZ });
function dayLabel(iso: string): string {
  const key = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  return key === today ? "Today" : key === yesterday ? "Yesterday" : formatDate(iso);
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} style={{ display: "flex", alignItems: "center", gap: space[3], margin: `${space[2]}px 0` }}>
      <span aria-hidden style={{ flex: 1, height: 1, background: v.borderDefault }} />
      <span style={{ fontSize: fs.xs, fontWeight: fw.semibold, color: v.textSecondary, background: v.bgSubtle, borderRadius: radius.pill, padding: `2px ${space[3]}px` }}>{label}</span>
      <span aria-hidden style={{ flex: 1, height: 1, background: v.borderDefault }} />
    </div>
  );
}

// The conversation, as chat bubbles (notifications-05). The viewer's own messages sit on the right; internal notes (only ever present in
// HR's view — the server never sends them to the raiser) are visually unmistakable: amber, dashed, with a lock and a written warning.
export function Thread({ messages, viewer }: { messages: HelpdeskMessage[]; viewer: "raiser" | "hr" }) {
  const phone = useIsPhone();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      {messages.map((m, i) => {
        const mine = viewer === "raiser" ? m.fromRaiser : !m.fromRaiser;
        const name = m.fromRaiser ? m.author.name : viewer === "raiser" ? `${m.author.name} (HR)` : m.author.name;
        const newDay = i === 0 || dayKey(messages[i - 1]!.createdAt) !== dayKey(m.createdAt);
        const background = m.isInternalNote ? v.warningSubtle : mine ? v.accentSubtle : v.bgSubtle;
        return (
          <Fragment key={m.id}>
            {newDay && <DaySeparator label={dayLabel(m.createdAt)} />}
            <div style={{ display: "flex", gap: space[2], justifyContent: mine ? "flex-end" : "flex-start", alignItems: "flex-end" }}>
              {!mine && !phone && <InitialsAvatar name={m.author.name} size={32} />}
              <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", maxWidth: phone ? "88%" : "min(560px, 80%)", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap", marginBottom: space[1], fontSize: fs.sm, color: v.textSecondary }}>
                  <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{name}</span>
                  {m.isInternalNote && (
                    <StatusChip tone="warning" icon={<LockOutlined aria-hidden />}>
                      Internal note — not visible to the employee
                    </StatusChip>
                  )}
                </div>
                <div
                  data-testid={m.isInternalNote ? "internal-note" : "message"}
                  style={{
                    background,
                    color: v.textBody,
                    border: m.isInternalNote ? `1px dashed ${v.warning}` : `1px solid ${mine ? "transparent" : v.borderDefault}`,
                    borderRadius: radius.lg,
                    [mine ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: radius.xs,
                    padding: `${space[2] + 2}px ${space[4]}px`,
                    fontSize: fs.md,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    maxWidth: "100%",
                  }}
                >
                  {m.body}
                  {m.attachments.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], marginTop: space[2] }}>
                      {m.attachments.map((a) => (
                        <Button key={a.id} size={phone ? "middle" : "small"} icon={<PaperClipOutlined />} onClick={() => void download(a.id)} style={{ maxWidth: "100%" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {a.fileName} · {formatSize(a.sizeBytes)}
                          </span>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)} style={{ fontSize: fs.xs, color: v.textSecondary, marginTop: space[1] }}>
                  {timeOf(m.createdAt)}
                </time>
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// Files are held in the browser and sent with the message (multipart) —
// beforeUpload returning false stops AntD uploading them itself.
export function AttachmentPicker({ files, onChange, compact = false }: { files: UploadFile[]; onChange: (files: UploadFile[]) => void; compact?: boolean }) {
  const full = files.length >= MAX_ATTACHMENTS;
  const label = `Attach files (up to ${MAX_ATTACHMENTS})`;
  return (
    <Upload
      multiple
      accept={ATTACHMENT_ACCEPT}
      fileList={files}
      maxCount={MAX_ATTACHMENTS}
      beforeUpload={() => false}
      onChange={({ fileList }) => onChange(fileList.slice(0, MAX_ATTACHMENTS))}
    >
      {compact ? (
        <Tooltip title={full ? `Up to ${MAX_ATTACHMENTS} files` : label}>
          <Button type="text" icon={<PaperClipOutlined />} aria-label={label} disabled={full} />
        </Tooltip>
      ) : (
        <Button icon={<PaperClipOutlined />} disabled={full}>
          {label}
        </Button>
      )}
    </Upload>
  );
}

// The composer under the thread: grows with the text, Ctrl/⌘ + Enter sends, a paperclip for files and — for HR — an internal-note switch
// that turns the whole box amber so a note is never sent to the employee by mistake.
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

  if (disabledReason) return <ApprovalBanner tone="info" title={disabledReason} />;

  async function submit() {
    if (!body.trim() || submitting) return;
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
    <div
      style={{
        border: `1px solid ${internal ? v.warning : v.borderControl}`,
        borderStyle: internal ? "dashed" : "solid",
        background: internal ? v.warningSubtle : v.bgSurface,
        borderRadius: radius.lg,
        padding: space[2],
        display: "flex",
        flexDirection: "column",
        gap: space[1],
      }}
    >
      {internal && (
        <div style={{ display: "flex", alignItems: "center", gap: space[2], color: v.warningText, fontSize: fs.sm, fontWeight: fw.semibold, padding: `0 ${space[2]}px` }}>
          <LockOutlined aria-hidden /> Internal note — only HR will see this
        </div>
      )}
      <Input.TextArea
        variant="borderless"
        autoSize={{ minRows: 2, maxRows: 8 }}
        maxLength={5000}
        value={body}
        aria-label={internal ? "Internal note" : "Reply"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={internal ? "Internal note — only HR will see this" : "Write a reply…"}
      />
      <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px", minWidth: 0 }}>
          <AttachmentPicker compact files={files} onChange={setFiles} />
        </div>
        {allowInternal && (
          <Checkbox checked={internal} onChange={(e) => setInternal(e.target.checked)}>
            Internal note
          </Checkbox>
        )}
        <Tooltip title="Ctrl + Enter">
          <Button type="primary" icon={internal ? <LockOutlined /> : <SendOutlined />} onClick={() => void submit()} loading={submitting} disabled={!body.trim()}>
            {internal ? "Add note" : "Send"}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

// The thread + composer in one panel. Desktop: the messages scroll inside the panel and the composer stays under them; phones: the page
// scrolls and the composer sticks above the tab bar. Either way the newest message is scrolled into view on open and whenever a new one
// arrives (sent here or pushed live over the socket).
export function Conversation({ messages, viewer, composer, title = "Conversation" }: { messages: HelpdeskMessage[]; viewer: "raiser" | "hr"; composer: ReactNode; title?: string }) {
  const phone = useIsPhone();
  const reduced = usePrefersReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const seen = useRef<{ count: number; phone: boolean } | null>(null);

  useLayoutEffect(() => {
    // A switch between the phone and desktop layouts counts as opening afresh (the scroller changes from the page to the panel).
    const first = seen.current === null || seen.current.phone !== phone;
    const grew = !first && messages.length > (seen.current?.count ?? 0);
    seen.current = { count: messages.length, phone };
    if (!first && !grew) return;
    const behavior: ScrollBehavior = first || reduced ? "auto" : "smooth";
    if (!phone && scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
    else if (endRef.current) {
      // The page scrolls on a phone: stop the newest message above the sticky composer and the tab bar, not behind them.
      endRef.current.style.scrollMarginBottom = `${(composerRef.current?.offsetHeight ?? 0) + layout.phoneTabBar + space[2]}px`;
      endRef.current.scrollIntoView({ block: "end", behavior });
    }
  }, [messages.length, phone, reduced]);

  return (
    <Panel title={title} subtitle={`${messages.length} message${messages.length === 1 ? "" : "s"}`} flush style={{ display: "flex", flexDirection: "column" }}>
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Messages"
        tabIndex={phone ? undefined : 0}
        style={{
          padding: phone ? space[4] : `${space[2]}px ${space[6]}px ${space[6]}px`,
          // Short enough that header + thread + composer fit one screen: the composer is sticky, so a taller thread hid its newest message.
          maxHeight: phone ? undefined : "clamp(280px, calc(100vh - 480px), 720px)",
          minHeight: phone ? undefined : 280,
          overflowY: phone ? undefined : "auto",
          borderTop: `1px solid ${v.borderDefault}`,
        }}
      >
        <Thread messages={messages} viewer={viewer} />
        <div ref={endRef} />
      </div>
      <div
        ref={composerRef}
        style={{
          position: "sticky",
          bottom: phone ? layout.phoneTabBar : 0,
          zIndex: 2,
          background: v.bgSurface,
          borderTop: `1px solid ${v.borderDefault}`,
          borderRadius: `0 0 ${radius.lg}px ${radius.lg}px`,
          padding: phone ? space[3] : space[4],
        }}
      >
        {composer}
      </div>
    </Panel>
  );
}

/** Loading shape of a ticket page: header lines, then alternating bubbles. */
export function TicketSkeleton() {
  return (
    <Stack>
      <div>
        <Skel w={120} h={14} />
        <Skel w="55%" h={28} style={{ marginTop: space[2] }} />
      </div>
      <Panel>
        <Stack gap={space[5]}>
          {[60, 45, 70, 40].map((w, i) => (
            <div key={i} style={{ display: "flex", justifyContent: i % 2 ? "flex-end" : "flex-start" }}>
              <Skel w={`${w}%`} h={i % 2 ? 48 : 64} r={radius.lg} />
            </div>
          ))}
        </Stack>
      </Panel>
    </Stack>
  );
}
