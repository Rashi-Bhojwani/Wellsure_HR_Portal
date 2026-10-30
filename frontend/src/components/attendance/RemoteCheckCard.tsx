import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { LoginOutlined, LogoutOutlined } from "@ant-design/icons";
import * as api from "../../api/remoteAttendance";
import type { RemoteRecord } from "../../api/remoteAttendance";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { ApprovalBanner, ConfirmModal, Panel, StatusChip, toast, type ChipTone } from "../../ui";
import { fs, space, v } from "../../theme/tokens";

// Attendance Info → Remote work. Only a person a director has marked as remote sees this. Check in and Check out each stamp the time on the server; nothing about
// where the person is, is asked for or kept. A director decides the day; the person can ask for a correction (a wrong time, before it is decided) or a review (after).

const TONE: Record<api.RemoteStatus, ChipTone> = { OPEN: "neutral", PENDING: "warning", APPROVED_FULL: "success", APPROVED_HALF: "info", REJECTED: "danger" };
const LABEL: Record<api.RemoteStatus, string> = { OPEN: "Checked in", PENDING: "Waiting for a director", APPROVED_FULL: "Approved: full day", APPROVED_HALF: "Approved: half day", REJECTED: "Not approved" };

export function RemoteCheckCard() {
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ["remote", "today"], queryFn: api.myRemoteToday, refetchInterval: 60_000 });
  const records = useQuery({ queryKey: ["remote", "records"], queryFn: api.myRemoteRecords, enabled: today.data?.remote === true });
  const [asking, setAsking] = useState<RemoteRecord | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["remote"] });
  const checkIn = useMutation({ mutationFn: api.remoteCheckIn, onSuccess: () => { toast.success("Checked in."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not check in.")) });
  const checkOut = useMutation({ mutationFn: api.remoteCheckOut, onSuccess: () => { toast.success("Checked out. A director will decide the day."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not check out.")) });
  if (!today.data?.remote) return null;
  const rec = today.data.record;
  const tall = { minHeight: 44 };
  return (
    <>
      <Panel title="Remote work" subtitle={`Today, ${formatDate(today.data.today)}`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], alignItems: "center" }}>
          <Button type="primary" size="large" style={tall} icon={<LoginOutlined />} disabled={!today.data.canCheckIn} loading={checkIn.isPending} onClick={() => checkIn.mutate()}>Check in</Button>
          <Button size="large" style={tall} icon={<LogoutOutlined />} disabled={!today.data.canCheckOut} loading={checkOut.isPending} onClick={() => checkOut.mutate()}>Check out</Button>
          <div style={{ color: v.textSecondary, fontSize: fs.md }}>
            {rec?.checkIn ? `In ${rec.checkIn}` : "Not checked in"}{rec?.checkOut ? ` · Out ${rec.checkOut}` : ""}
            {rec && <> <StatusChip tone={TONE[rec.status]}>{LABEL[rec.status]}</StatusChip></>}
          </div>
        </div>
        <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: space[2] }}>The time is stamped by the server. Nothing about where you are is asked for or kept.</div>
        {(records.data ?? []).length > 0 && (
          <ul style={{ listStyle: "none", margin: `${space[4]}px 0 0`, padding: 0, display: "grid", gap: space[3] }} aria-label="Your remote days">
            {(records.data ?? []).slice(0, 10).map((r) => (
              <li key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${v.borderDefault}`, paddingTop: space[3] }}>
                <div>
                  <div>{formatDate(r.date)} · {r.checkIn ?? "—"} to {r.checkOut ?? "—"} <StatusChip tone={TONE[r.status]}>{LABEL[r.status]}{r.status === "APPROVED_HALF" && r.half ? ` (${r.half === "FIRST" ? "first" : "second"} half)` : ""}</StatusChip></div>
                  {r.status === "REJECTED" && r.decisionReason && <div style={{ color: v.danger, fontSize: fs.sm }}>{r.decisionReason}</div>}
                  {r.openRequests > 0 && <div style={{ color: v.textSecondary, fontSize: fs.sm }}>A request is waiting for a director.</div>}
                </div>
                {r.openRequests === 0 && (r.status === "PENDING" || r.status === "OPEN" || r.status === "REJECTED" || r.status === "APPROVED_HALF") && (
                  <Button style={tall} onClick={() => setAsking(r)}>{r.status === "PENDING" || r.status === "OPEN" ? "Ask for a correction" : "Ask for a review"}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {asking && <AskDialog record={asking} onClose={() => setAsking(null)} onDone={refresh} />}
    </>
  );
}

function AskDialog({ record, onClose, onDone }: { record: RemoteRecord; onClose: () => void; onDone: () => void }) {
  const decided = record.status === "REJECTED" || record.status === "APPROVED_HALF" || record.status === "APPROVED_FULL";
  const [note, setNote] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => api.askRemoteChange(record.id, { kind: decided ? "REVIEW" : "CORRECTION", note: note.trim(), ...(!decided && checkIn ? { checkIn } : {}), ...(!decided && checkOut ? { checkOut } : {}) }),
    onSuccess: () => { toast.success("Sent to the directors."); onDone(); onClose(); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not send it.")),
  });
  const timesOk = decided || (checkIn !== "" || checkOut !== "");
  return (
    <ConfirmModal
      open
      title={decided ? `Ask for a review of ${formatDate(record.date)}` : `Ask for a correction of ${formatDate(record.date)}`}
      description={decided ? "A director looks at the day again." : "Give the right time in, the right time out, or both (for example 09:30)."}
      confirmLabel="Send"
      cancelLabel="Cancel"
      confirmDisabled={note.trim().length < 3 || !timesOk}
      loading={ask.isPending}
      onCancel={onClose}
      onConfirm={() => ask.mutate()}
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        {!decided && (
          <div style={{ display: "flex", gap: space[3] }}>
            <Form.Item label="Time in" htmlFor="rc-in"><Input id="rc-in" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></Form.Item>
            <Form.Item label="Time out" htmlFor="rc-out"><Input id="rc-out" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></Form.Item>
          </div>
        )}
        <Form.Item label="What is wrong" htmlFor="rc-note" validateStatus={problem ? "error" : undefined} help={problem ?? undefined} style={{ marginBottom: 0 }}>
          <Input.TextArea id="rc-note" rows={2} maxLength={300} value={note} onChange={(e) => { setNote(e.target.value); setProblem(null); }} />
        </Form.Item>
      </Form>
      {problem && <ApprovalBanner tone="danger" title={problem} style={{ marginTop: space[3] }} />}
    </ConfirmModal>
  );
}
