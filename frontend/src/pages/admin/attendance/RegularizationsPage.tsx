import { Flex, Typography } from "antd";
import { RegularizationQueue } from "../../../components/attendance/RegularizationQueue";

// Workforce → Attendance → Regularizations (Phase 2 P2-E): forgot-to-punch
// requests from everyone in scope. The fuller regularization workflow is Phase 3.
export function RegularizationsPage() {
  return (
    <Flex vertical gap={12}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Regularizations
      </Typography.Title>
      <Typography.Text type="secondary">Employees who forgot to punch in or out ask for the missing time from their Attendance Info. Approving it works the day out again with that time; the device's punches never change.</Typography.Text>
      <RegularizationQueue />
    </Flex>
  );
}
