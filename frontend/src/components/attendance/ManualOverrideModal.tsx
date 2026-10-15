import { Modal } from "antd";
import { ManualOverrideForm } from "./ManualOverrideForm";

/** Manual Override for one person and one day, opened from their day (Attendance Info) or the muster. */
export function ManualOverrideModal({ target, onClose }: { target: { employeeId: string; name: string; date: string } | null; onClose: () => void }) {
  return (
    <Modal title="Set this day" open={target !== null} onCancel={onClose} footer={null} width={760} destroyOnHidden>
      {target && <ManualOverrideForm fixed={target} onDone={onClose} />}
    </Modal>
  );
}
