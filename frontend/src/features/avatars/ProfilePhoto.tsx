import { useState } from "react";
import { Button, Input } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import * as peopleApi from "../../api/people";
import { EmployeeAvatar } from "../../components/common/EmployeeAvatar";
import { PhotoUploader } from "../../components/common/PhotoUploader";
import { useAuth } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/apiError";
import { space, v } from "../../theme/tokens";
import { ConfirmModal, toast } from "../../ui";
import { removeAvatar } from "./api";

interface ProfilePhotoProps {
  employeeId: string;
  name: string;
  photoVersion: string | null;
  onChanged: () => void;
  size?: number;
  /** The person has no personal details yet, so there is no photo to set. */
  disabled?: boolean;
}

// The photo on an admin profile (Peeps avatars and directory). Your own: upload, change or remove it, as on your own profile. Someone else's: HR and
// the directors (avatars.moderate) may remove an inappropriate photo with a reason, which is audited; nobody puts a photo on someone else's profile.
export function ProfilePhoto({ employeeId, name, photoVersion, onChanged, size = 84, disabled }: ProfilePhotoProps) {
  const { user, hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (user?.employeeId === employeeId)
    return <PhotoUploader stacked size={size} employeeId={employeeId} name={name} photoVersion={photoVersion} upload={peopleApi.uploadMyPhoto} remove={peopleApi.removeMyPhoto} onChanged={onChanged} disabled={disabled} />;

  const canRemove = Boolean(photoVersion) && hasPermission("avatars.moderate");
  const submit = async () => {
    setBusy(true);
    try {
      await removeAvatar(employeeId, reason.trim());
      toast.success("Photo removed. They have been told and can add a different one.");
      setOpen(false);
      setReason("");
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't remove the photo."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[2] }}>
      <EmployeeAvatar employeeId={employeeId} name={name} photoVersion={photoVersion} size={size} variant="full" />
      {canRemove && (
        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setOpen(true)}>
          Remove photo
        </Button>
      )}
      <ConfirmModal
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => void submit()}
        title="Remove this photo?"
        info="Only the person can add or change their photo. Your reason is kept in the audit log; they are told the photo was removed."
        confirmLabel="Remove photo"
        danger
        loading={busy}
        confirmDisabled={reason.trim().length < 3}
      >
        <label htmlFor="avatar-remove-reason" style={{ display: "block", marginBottom: space[2], color: v.textBody }}>
          Why is it being removed?
        </label>
        <Input.TextArea id="avatar-remove-reason" rows={3} maxLength={500} showCount value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmModal>
    </div>
  );
}
