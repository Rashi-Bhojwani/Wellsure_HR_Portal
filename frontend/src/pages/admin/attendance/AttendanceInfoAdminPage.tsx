import { useSearchParams } from "react-router-dom";
import { Alert, Flex, Typography } from "antd";
import { AttendanceInfoView } from "../../../components/attendance/AttendanceInfoView";
import { EmployeePicker } from "../../../components/letters/LetterFields";

// Workforce → Attendance → Attendance Info (Phase 2 P2-E): the employee's own
// view, for anyone in the viewer's attendance.view scope, read-only.
export function AttendanceInfoAdminPage() {
  const [params, setParams] = useSearchParams();
  const employeeId = params.get("employee") ?? undefined;
  return (
    <Flex vertical gap={12}>
      <Flex align="center" gap={12} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Attendance Info
        </Typography.Title>
        <div style={{ width: 320 }}>
          <EmployeePicker value={employeeId} onChange={(id) => setParams(id ? { employee: id } : {})} />
        </div>
      </Flex>
      {employeeId ? <AttendanceInfoView key={`${employeeId}|${params.get("date") ?? ""}`} employeeId={employeeId} initialDate={params.get("date")} /> : <Alert type="info" showIcon title="Choose an employee to see their attendance month." />}
    </Flex>
  );
}
