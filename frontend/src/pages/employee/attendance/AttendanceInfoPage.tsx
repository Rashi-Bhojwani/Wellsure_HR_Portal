import { useSearchParams } from "react-router-dom";
import { Flex, Typography } from "antd";
import { AttendanceInfoView } from "../../../components/attendance/AttendanceInfoView";

// Attendance → Attendance Info (Phase 2 P2-E, UI_REFERENCE §1.5): my month,
// live, with the forgot-to-punch request on a one-punch day. ?date= opens a day
// (links from notifications and the Request Hub).
export function AttendanceInfoPage() {
  const [params] = useSearchParams();
  return (
    <Flex vertical gap={12}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Attendance Info
      </Typography.Title>
      <AttendanceInfoView key={params.get("date") ?? "today"} initialDate={params.get("date")} />
    </Flex>
  );
}
