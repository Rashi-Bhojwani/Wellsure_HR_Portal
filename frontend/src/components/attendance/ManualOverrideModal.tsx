import { SideDrawer } from "../../ui";
import { ManualOverrideForm } from "./ManualOverrideForm";

/** Manual Override for one person and one day, opened from their day (Attendance Info) or the muster. A wide drawer (the form keeps its own audited Save). */
export function ManualOverrideModal({ target, onClose }: { target: { employeeId: string; name: string; date: string } | null; onClose: () => void }) {
  return (
    <SideDrawer title="Set this day" subtitle={target ? target.name : undefined} open={target !== null} onClose={onClose} size="wide" footer={null}>
      {target && <ManualOverrideForm fixed={target} onDone={onClose} />}
    </SideDrawer>
  );
}
