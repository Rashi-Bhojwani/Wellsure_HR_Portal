import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { PaperClipOutlined } from "@ant-design/icons";
import { isPeepsLeaveTypeCode } from "@shared/constants/peepsLeave";
import * as leaveApi from "../../api/leave";
import type { LeaveRequestRow } from "../../api/leave";
import { useAuth } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { fs, fw, space, v } from "../../theme/tokens";
import { Panel, StatusChip, toast } from "../../ui";
import * as api from "./api";

// The employee's own requests of the new leave types, where a supporting document is attached. Only HR and the directors ever open it; the employee
// sees that it is attached. Nothing shows when the employee has no such request.

function Row({ r }: { r: LeaveRequestRow }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const docs = useQuery({ queryKey: ["leave-documents", r.id], queryFn: () => api.listDocuments(r.id) });
  const attach = useMutation({
    mutationFn: (file: File) => api.attachDocument(r.id, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave-documents", r.id] });
      toast.success("Document attached. Only HR and the directors can open it.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't attach the document.")),
  });
  const attached = docs.data?.attached ?? 0;
  return (
    <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[3], justifyContent: "space-between" }}>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.leaveTypeName}</span>
        <span className="ws-num" style={{ fontSize: fs.sm, color: v.textSecondary }}>
          {formatDate(r.fromDate)} – {formatDate(r.toDate)} · {r.totalDays} day(s)
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: space[2] }}>
        {attached > 0 ? <StatusChip tone="success">{attached === 1 ? "Document attached" : `${attached} documents attached`}</StatusChip> : <StatusChip tone="neutral">No document</StatusChip>}
        <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate(f); e.target.value = ""; }} />
        <Button icon={<PaperClipOutlined />} loading={attach.isPending} onClick={() => input.current?.click()}>
          Attach
        </Button>
      </span>
    </li>
  );
}

export function MyLeaveDocumentsPanel() {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ["leave", "requests", "mine", "new-types"], queryFn: () => leaveApi.listLeaveRequests({ employeeId: user!.employeeId, pageSize: 100 }), enabled: Boolean(user) });
  const rows = (data?.rows ?? []).filter((r) => isPeepsLeaveTypeCode(r.leaveTypeCode) && (r.status === "PENDING" || r.status === "APPROVED"));
  if (rows.length === 0) return null;
  return (
    <Panel title="Supporting documents" subtitle="For medical, menstrual, wedding or bereavement leave. Only HR and the directors can open them." style={{ flex: "1 1 520px", maxWidth: 720 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[4] }}>
        {rows.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
    </Panel>
  );
}
