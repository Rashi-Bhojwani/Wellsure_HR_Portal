import { useState } from "react";
import { Button, Flex, Typography } from "antd";
import { BulkCorrectionModal } from "../../../components/attendance/BulkCorrectionModal";
import { RegularizationQueue } from "../../../components/attendance/RegularizationQueue";
import { useAuth } from "../../../hooks/useAuth";

// Workforce → Attendance → Regularizations (Phase 2 P2-E began it; Phase 3 commit 1 completes it): correction
// requests from everyone in scope, and (for HR) bulk corrections, for example a whole branch after a device outage.
export function RegularizationsPage() {
  const { hasPermission } = useAuth();
  const [bulk, setBulk] = useState(false);
  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Regularizations
        </Typography.Title>
        {hasPermission("attendance.regularization.bulk") && (
          <Button type="primary" onClick={() => setBulk(true)}>
            Correct in bulk…
          </Button>
        )}
      </Flex>
      <Typography.Text type="secondary">
        Employees ask for a correction to a day (missing punches, wrong times or a wrong status) from their Attendance Info. Approving applies it and works the day out again; the device's punches never change, and
        the corrected day is marked as not from the device everywhere it appears.
      </Typography.Text>
      <RegularizationQueue />
      <BulkCorrectionModal open={bulk} onClose={() => setBulk(false)} />
    </Flex>
  );
}
