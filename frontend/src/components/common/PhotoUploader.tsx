import { useRef } from "react";
import { Button, Popconfirm, Tooltip } from "antd";
import { CameraOutlined, DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { apiErrorMessage } from "../../lib/apiError";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { toast } from "../../ui";
import { fs, space, v } from "../../theme/tokens";

interface PhotoUploaderProps {
  employeeId: string;
  name: string;
  photoVersion: string | null;
  upload: (file: File) => Promise<unknown>;
  remove: () => Promise<unknown>;
  onChanged: () => void;
  disabled?: boolean;
  /** Avatar size (default 72). */
  size?: number;
  /** Profile-card layout (employees-05): avatar centred, compact photo actions underneath. */
  stacked?: boolean;
}

const HINT = "JPEG, PNG or WebP. Location and camera details are removed automatically.";

// Photo upload/remove with a live preview. The server re-encodes every photo
// and strips its metadata (location included), so any JPEG/PNG/WebP straight
// off a phone is fine.
export function PhotoUploader({ employeeId, name, photoVersion, upload, remove, onChanged, disabled, size = 72, stacked = false }: PhotoUploaderProps) {
  const input = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, "That didn't work — please try again."));
    }
  }

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      aria-label="Choose a photo"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void run(() => upload(file), "Photo updated.");
      }}
    />
  );
  const removeButton = (small: boolean) =>
    photoVersion && (
      <Popconfirm title="Remove this photo?" okText="Remove" onConfirm={() => run(remove, "Photo removed.")}>
        <Button size={small ? "small" : undefined} icon={<DeleteOutlined />} danger>
          Remove
        </Button>
      </Popconfirm>
    );

  if (stacked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[2] }}>
        <div style={{ position: "relative" }}>
          <EmployeeAvatar employeeId={employeeId} name={name} photoVersion={photoVersion} size={size} variant="full" />
          {!disabled && (
            <Tooltip title={`${photoVersion ? "Change photo" : "Upload photo"}. ${HINT}`}>
              <Button
                shape="circle"
                size="small"
                icon={<CameraOutlined />}
                aria-label={photoVersion ? "Change photo" : "Upload photo"}
                onClick={() => input.current?.click()}
                style={{ position: "absolute", right: -2, bottom: -2, background: v.bgSurface }}
              />
            </Tooltip>
          )}
        </div>
        {!disabled && photoVersion && removeButton(true)}
        {fileInput}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[4], flexWrap: "wrap" }}>
      <EmployeeAvatar employeeId={employeeId} name={name} photoVersion={photoVersion} size={size} variant="full" />
      {!disabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            <Button icon={<UploadOutlined />} onClick={() => input.current?.click()}>
              {photoVersion ? "Change photo" : "Upload photo"}
            </Button>
            {removeButton(false)}
          </div>
          <span style={{ fontSize: fs.sm, color: v.textSecondary }}>{HINT}</span>
        </div>
      )}
      {fileInput}
    </div>
  );
}
