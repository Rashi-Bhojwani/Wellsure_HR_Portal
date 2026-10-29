import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "antd";
import { AuditOutlined } from "@ant-design/icons";
import { AttendanceInfoView } from "../../../components/attendance/AttendanceInfoView";
import { PageHeader } from "../../../ui";

// Attendance → Attendance Info (Phase 2 P2-E, UI_REFERENCE §1.5): my month,
// live, with the forgot-to-punch request on a one-punch day. ?date= opens a day
// (links from notifications and the Request Hub).
export function AttendanceInfoPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Attendance Info"
        subtitle="Your month, live from the biometric device. Pick a day to see its punches."
        actions={
          <Button icon={<AuditOutlined />} onClick={() => navigate("/app/request-hub")}>
            My regularizations
          </Button>
        }
      />
      <AttendanceInfoView key={params.get("date") ?? "today"} initialDate={params.get("date")} />
    </>
  );
}
