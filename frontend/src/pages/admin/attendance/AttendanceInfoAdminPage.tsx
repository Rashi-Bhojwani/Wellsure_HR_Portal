import { useSearchParams } from "react-router-dom";
import { AttendanceInfoView } from "../../../components/attendance/AttendanceInfoView";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { EmptyState, PageHeader, Panel } from "../../../ui";

// Workforce → Attendance → Attendance Info (Phase 2 P2-E): the employee's own
// view, for anyone in the viewer's attendance.view scope, read-only.
export function AttendanceInfoAdminPage() {
  const [params, setParams] = useSearchParams();
  const employeeId = params.get("employee") ?? undefined;
  return (
    <>
      <PageHeader
        title="Attendance Info"
        subtitle="Any employee's month, live, read-only"
        actions={
          <div style={{ width: "100%", minWidth: 260, maxWidth: 360 }}>
            <EmployeePicker value={employeeId} onChange={(id) => setParams(id ? { employee: id } : {})} />
          </div>
        }
      />
      {employeeId ? (
        <AttendanceInfoView key={`${employeeId}|${params.get("date") ?? ""}`} employeeId={employeeId} initialDate={params.get("date")} />
      ) : (
        <Panel>
          <EmptyState kind="empty" illustration="calendar" title="Choose an employee" description="Choose an employee to see their attendance month." />
        </Panel>
      )}
    </>
  );
}
