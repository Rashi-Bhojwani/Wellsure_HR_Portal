import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Segmented } from "antd";
import { LoginOutlined, LogoutOutlined } from "@ant-design/icons";
import * as api from "../../api/remoteAttendance";
import type { DayState, RemoteRecord } from "../../api/remoteAttendance";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { ApprovalBanner, ConfirmModal, Panel, StatusChip, toast, type ChipTone } from "../../ui";
import { fs, radius, space, v } from "../../theme/tokens";

// Remote work, for a person a director has marked as remote (nobody is, by default). Check in and Check out each stamp the time on the server; nothing about where the person is
// is asked for or kept. The card shows today's state and the server's time, a rejected day's reason and outcome, and the history as a list or a calendar with hours.
// A person can ask for a correction (a wrong or missed time, with a reason) and, once, for a review after a rejection or a half day.

const STATE_LABEL: Record<DayState, string> = { NOT_STARTED: "Not started", CHECKED_IN: "Checked in", CHECKED_OUT: "Checked out", PENDING_APPROVAL: "Pending approval", APPROVED: "Approved", HALF_DAY: "Half day", REJECTED: "Rejected" };
const STATE_TONE: Record<DayState, ChipTone> = { NOT_STARTED: "neutral", CHECKED_IN: "info", CHECKED_OUT: "info", PENDING_APPROVAL: "warning", APPROVED: "success", HALF_DAY: "info", REJECTED: "danger" };
const STATUS_STATE: Record<RemoteRecord["status"], DayState> = { OPEN: "CHECKED_IN", PENDING: "PENDING_APPROVAL", APPROVED_FULL: "APPROVED", APPROVED_HALF: "HALF_DAY", REJECTED: "REJECTED" };
const OUTCOME = { ABSENT: "Absent", LOSS_OF_PAY: "Loss of pay" } as const;

export function RemoteCheckCard() {
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ["remote", "today"], queryFn: api.myRemoteToday, refetchInterval: 60_000 });
  const records = useQuery({ queryKey: ["remote", "records"], queryFn: () => api.myRemoteRecords(), enabled: today.data?.remote === true });
  const [asking, setAsking] = useState<RemoteRecord | null>(null);
  const [missed, setMissed] = useState(false);
  const [view, setView] = useState<"list" | "calendar">("list");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["remote"] });
  const checkIn = useMutation({ mutationFn: api.remoteCheckIn, onSuccess: () => { toast.success("Checked in."); refresh(); }, onError: (e) => { toast.error(apiErrorMessage(e, "Could not check in.")); refresh(); } });
  const checkOut = useMutation({ mutationFn: api.remoteCheckOut, onSuccess: () => { toast.success("Checked out. A director will decide the day."); refresh(); }, onError: (e) => { toast.error(apiErrorMessage(e, "Could not check out.")); refresh(); } });
  if (!today.data?.remote) return null;
  const t = today.data;
  const rec = t.record;
  const busy = checkIn.isPending || checkOut.isPending; // a second press while one is on its way does nothing
  const tall = { minHeight: 44 };
  return (
    <>
      <Panel title="Remote work" subtitle={`Today, ${formatDate(t.today)} · server time ${t.serverTime}`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], alignItems: "center" }}>
          <Button type="primary" size="large" style={tall} icon={<LoginOutlined />} disabled={!t.canCheckIn || busy} loading={checkIn.isPending} onClick={() => checkIn.mutate()}>Check in</Button>
          <Button size="large" style={tall} icon={<LogoutOutlined />} disabled={!t.canCheckOut || busy} loading={checkOut.isPending} onClick={() => checkOut.mutate()}>Check out</Button>
          <StatusChip tone={STATE_TONE[t.state]}>{STATE_LABEL[t.state]}</StatusChip>
          <span style={{ color: v.textSecondary, fontSize: fs.md }}>{rec?.checkIn ? `In ${rec.checkIn}` : ""}{rec?.checkOut ? ` · Out ${rec.checkOut}` : ""}{rec?.hours ? ` · ${rec.hours} h` : ""}</span>
        </div>
        {rec && (t.state === "REJECTED" || t.state === "HALF_DAY") && (
          <ApprovalBanner style={{ marginTop: space[3] }} tone={t.state === "REJECTED" ? "danger" : "info"} title={t.state === "REJECTED" ? `Not approved: ${rec.rejectOutcome ? OUTCOME[rec.rejectOutcome] : ""}` : `Half day (${rec.half === "FIRST" ? "first" : "second"} half)`} description={rec.decisionReason ?? undefined} />
        )}
        <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: space[2] }}>The time is stamped by the server. Nothing about where you are is asked for or kept.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], alignItems: "center", justifyContent: "space-between", marginTop: space[4] }}>
          <Segmented aria-label="History view" value={view} onChange={(x) => setView(x as "list" | "calendar")} options={[{ value: "list", label: "List" }, { value: "calendar", label: "Calendar" }]} />
          <Button style={tall} onClick={() => setMissed(true)}>I missed a day</Button>
        </div>
        {view === "list" ? <History rows={records.data ?? []} onAsk={setAsking} /> : <Calendar rows={records.data ?? []} />}
      </Panel>
      {asking && <AskDialog record={asking} onClose={() => setAsking(null)} onDone={refresh} />}
      {missed && <MissedDialog onClose={() => setMissed(false)} onDone={refresh} />}
    </>
  );
}

function History({ rows, onAsk }: { rows: RemoteRecord[]; onAsk: (r: RemoteRecord) => void }) {
  if (rows.length === 0) return <div style={{ color: v.textSecondary, marginTop: space[3] }}>Your remote days appear here.</div>;
  return (
    <ul style={{ listStyle: "none", margin: `${space[3]}px 0 0`, padding: 0, display: "grid", gap: space[3] }} aria-label="Your remote days">
      {rows.slice(0, 31).map((r) => {
        const state = STATUS_STATE[r.status];
        const canReview = (r.status === "REJECTED" || r.status === "APPROVED_HALF") && !r.reviewUsed && r.openRequests === 0;
        const canCorrect = (r.status === "PENDING" || r.status === "OPEN") && r.openRequests === 0;
        return (
          <li key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${v.borderDefault}`, paddingTop: space[3] }}>
            <div>
              <div>{formatDate(r.date)} · in {r.checkIn ?? "—"} · out {r.checkOut ?? "—"} · {r.hours ? `${r.hours} h` : "no hours"} <StatusChip tone={STATE_TONE[state]}>{STATE_LABEL[state]}</StatusChip></div>
              {(r.status === "REJECTED" || r.status === "APPROVED_HALF") && r.decisionReason && <div style={{ color: r.status === "REJECTED" ? v.danger : v.textSecondary, fontSize: fs.sm }}>{r.status === "REJECTED" && r.rejectOutcome ? `${OUTCOME[r.rejectOutcome]}: ` : ""}{r.decisionReason}</div>}
              {r.openRequests > 0 && <div style={{ color: v.textSecondary, fontSize: fs.sm }}>A request is waiting for a director.</div>}
            </div>
            {canCorrect && <Button style={{ minHeight: 44 }} onClick={() => onAsk(r)}>Ask for a correction</Button>}
            {canReview && <Button style={{ minHeight: 44 }} onClick={() => onAsk(r)}>Ask for a review (one allowed)</Button>}
          </li>
        );
      })}
    </ul>
  );
}

const CELL: Record<RemoteRecord["status"], string> = { OPEN: v.chipInfoBg, PENDING: v.chipWarningBg, APPROVED_FULL: v.attPBg, APPROVED_HALF: v.attHdBg, REJECTED: v.attABg };

function Calendar({ rows }: { rows: RemoteRecord[] }) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const base = rows[0]?.date ?? new Date().toISOString().slice(0, 10); // allow-clock: only picks which month the calendar opens on
  const [y, m] = base.split("-").map((x) => Number.parseInt(x, 10)) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array.from({ length: first.getUTCDay() }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div style={{ marginTop: space[3] }} role="grid" aria-label={`Remote days in ${first.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: space[1] }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} style={{ color: v.textSecondary, fontSize: fs.sm, textAlign: "center" }}>{d}</div>)}
        {cells.map((d, i) => {
          const r = d ? byDate.get(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`) : undefined;
          return (
            <div key={i} role="gridcell" title={r ? `${STATE_LABEL[STATUS_STATE[r.status]]}${r.hours ? `, ${r.hours} h` : ""}${r.decisionReason ? `: ${r.decisionReason}` : ""}` : undefined} style={{ minHeight: 44, borderRadius: radius.sm, padding: space[1], background: r ? CELL[r.status] : "transparent", color: v.textPrimary, fontSize: fs.sm }}>
              {d ?? ""}
              {r && <div style={{ fontSize: fs.xs }}>{r.hours ?? STATE_LABEL[STATUS_STATE[r.status]]}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AskDialog({ record, onClose, onDone }: { record: RemoteRecord; onClose: () => void; onDone: () => void }) {
  const review = record.status === "REJECTED" || record.status === "APPROVED_HALF";
  const [note, setNote] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => api.askRemoteChange(record.id, { kind: review ? "REVIEW" : "CORRECTION", note: note.trim(), ...(!review && checkIn ? { checkIn } : {}), ...(!review && checkOut ? { checkOut } : {}) }),
    onSuccess: () => { toast.success("Sent to the directors."); onDone(); onClose(); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not send it.")),
  });
  return (
    <ConfirmModal open title={review ? `Ask for a review of ${formatDate(record.date)}` : `Ask for a correction of ${formatDate(record.date)}`} description={review ? "You can ask once. A director looks at the day again." : "Give the right time in, the right time out, or both (for example 09:30), and say what was wrong."} confirmLabel="Send" cancelLabel="Cancel" confirmDisabled={note.trim().length < 3 || (!review && !checkIn && !checkOut)} loading={ask.isPending} onCancel={onClose} onConfirm={() => ask.mutate()}>
      <Form layout="vertical" component="div" requiredMark={false}>
        {!review && (
          <div style={{ display: "flex", gap: space[3] }}>
            <Form.Item label="Time in" htmlFor="rc-in"><Input id="rc-in" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></Form.Item>
            <Form.Item label="Time out" htmlFor="rc-out"><Input id="rc-out" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></Form.Item>
          </div>
        )}
        <Form.Item label="Why (required)" htmlFor="rc-note" validateStatus={problem ? "error" : undefined} help={problem ?? undefined} style={{ marginBottom: 0 }}><Input.TextArea id="rc-note" rows={2} maxLength={300} value={note} onChange={(e) => { setNote(e.target.value); setProblem(null); }} /></Form.Item>
      </Form>
    </ConfirmModal>
  );
}

function MissedDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ask = useMutation({ mutationFn: () => api.askMissedDay({ date, note: note.trim(), checkIn, checkOut }), onSuccess: () => { toast.success("Sent to the directors."); onDone(); onClose(); }, onError: (e) => setProblem(apiErrorMessage(e, "Could not send it.")) });
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(checkIn) && /^\d{2}:\d{2}$/.test(checkOut) && note.trim().length >= 3;
  return (
    <ConfirmModal open title="Ask to record a day you missed" description="For a remote day you did not check in for. A director decides." confirmLabel="Send" cancelLabel="Cancel" confirmDisabled={!ok} loading={ask.isPending} onCancel={onClose} onConfirm={() => ask.mutate()}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Day" htmlFor="ms-date" extra="For example 2026-10-14."><Input id="ms-date" inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 200 }} /></Form.Item>
        <div style={{ display: "flex", gap: space[3] }}>
          <Form.Item label="Time in" htmlFor="ms-in"><Input id="ms-in" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></Form.Item>
          <Form.Item label="Time out" htmlFor="ms-out"><Input id="ms-out" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></Form.Item>
        </div>
        <Form.Item label="What happened (required)" htmlFor="ms-note" validateStatus={problem ? "error" : undefined} help={problem ?? undefined} style={{ marginBottom: 0 }}><Input.TextArea id="ms-note" rows={2} maxLength={300} value={note} onChange={(e) => { setNote(e.target.value); setProblem(null); }} /></Form.Item>
      </Form>
    </ConfirmModal>
  );
}
