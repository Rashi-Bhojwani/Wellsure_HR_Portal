import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { FileProtectOutlined } from "@ant-design/icons";
import { isPeepsLeaveTypeCode } from "@shared/constants/peepsLeave";
import type { LeaveRequestRow } from "../../api/leave";
import { useAuth } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { space, v } from "../../theme/tokens";
import { EmptyState, QueryState, SideDrawer, SkeletonTable, toast } from "../../ui";
import * as api from "./api";

// HR's Employee Leave queue: the supporting documents of a new-type request, for HR (leave.documents.view) and the directors only. Opening one is
// recorded with the opener's name and the time.
export function LeaveDocumentsCell({ r }: { r: Pick<LeaveRequestRow, "id" | "leaveTypeCode" | "employeeName" | "leaveTypeName"> }) {
  const { hasPermission, hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  const canOpen = hasPermission("leave.documents.view") || hasRole("SUPER_ADMIN");
  const docs = useQuery({ queryKey: ["leave-documents", r.id], queryFn: () => api.listDocuments(r.id), enabled: open });
  if (!canOpen || !isPeepsLeaveTypeCode(r.leaveTypeCode)) return <span style={{ color: v.textSecondary }}>—</span>;
  const openDoc = (id: string) => void api.openDocument(id).catch((err) => toast.error(apiErrorMessage(err, "Couldn't open the document.")));
  return (
    <>
      <Button size="small" icon={<FileProtectOutlined />} onClick={() => setOpen(true)}>
        Documents
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Supporting documents" subtitle={`${r.employeeName} · ${r.leaveTypeName}. Each open is recorded.`} footer={null}>
        <QueryState isLoading={docs.isLoading} error={docs.error} onRetry={() => void docs.refetch()} skeleton={<SkeletonTable rows={2} />}>
          {docs.data && docs.data.documents.length === 0 ? (
            <EmptyState compact illustration={false} title="No document attached" description="The employee attaches it from their Apply for Leave page." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[3] }}>
              {docs.data?.documents.map((d) => (
                <li key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[3] }}>
                  <span style={{ color: v.textBody }}>
                    {d.label} · {formatDateTime(d.uploadedAt)}
                  </span>
                  <Button onClick={() => openDoc(d.id)}>Open</Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </SideDrawer>
    </>
  );
}
