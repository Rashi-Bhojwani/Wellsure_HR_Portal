import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { BulkCorrectionModal } from "../../../components/attendance/BulkCorrectionModal";
import type { CarriedSelection } from "../../../components/attendance/targetSelection";
import { RegularizationQueue } from "../../../components/attendance/RegularizationQueue";
import { useAuth } from "../../../hooks/useAuth";
import { PageHeader, Panel, Stack, useIsPhone } from "../../../ui";

// Workforce → Attendance → Regularizations (Phase 2 P2-E began it; Phase 3 commit 1 completes it): correction
// requests from everyone in scope, and (for HR) bulk corrections, for example a whole branch after a device outage.
// Board frame time-off-05 (a filtered request table with status chips).
export function RegularizationsPage() {
  const { hasPermission } = useAuth();
  const phone = useIsPhone();
  const carried = (useLocation().state as { carried?: CarriedSelection } | null)?.carried; // people and dates chosen on the Exceptions queue
  const canBulk = hasPermission("attendance.regularization.bulk");
  const [bulk, setBulk] = useState(!!carried && canBulk);
  return (
    <>
      <PageHeader
        title="Regularizations"
        subtitle="Correction requests to a day: missing punches, wrong times or a wrong status"
        actions={
          canBulk && (
            <Button type="primary" icon={<EditOutlined />} onClick={() => setBulk(true)} block={phone}>
              Correct in bulk…
            </Button>
          )
        }
      />
      <Stack>
        <Panel
          title="Correction requests"
          subtitle="Employees raise these from their Attendance Info. Approving applies the correction and works the day out again; the device's punches never change, and the corrected day is marked as not from the device everywhere it appears."
        >
          <RegularizationQueue />
        </Panel>
      </Stack>
      <BulkCorrectionModal open={bulk} onClose={() => setBulk(false)} carried={carried} />
    </>
  );
}
