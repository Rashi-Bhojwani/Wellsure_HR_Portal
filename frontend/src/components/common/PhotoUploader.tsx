import { useRef } from "react";
import { Button, Popconfirm, Space, Typography, message } from "antd";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { apiErrorMessage } from "../../lib/apiError";
import { EmployeeAvatar } from "./EmployeeAvatar";

interface PhotoUploaderProps {
  employeeId: string;
  name: string;
  photoVersion: string | null;
  upload: (file: File) => Promise<unknown>;
  remove: () => Promise<unknown>;
  onChanged: () => void;
  disabled?: boolean;
}

// Photo upload/remove with a live preview. The server re-encodes every photo
// and strips its metadata (location included), so any JPEG/PNG/WebP straight
// off a phone is fine.
export function PhotoUploader({ employeeId, name, photoVersion, upload, remove, onChanged, disabled }: PhotoUploaderProps) {
  const input = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      void message.success(success);
      onChanged();
    } catch (err) {
      void message.error(apiErrorMessage(err, "That didn't work — please try again."));
    }
  }

  return (
    <Space align="center" size={16} wrap>
      <EmployeeAvatar employeeId={employeeId} name={name} photoVersion={photoVersion} size={72} variant="full" />
      {!disabled && (
        <Space orientation="vertical" size={4}>
          <Space wrap>
            <Button icon={<UploadOutlined />} onClick={() => input.current?.click()}>
              {photoVersion ? "Change photo" : "Upload photo"}
            </Button>
            {photoVersion && (
              <Popconfirm title="Remove this photo?" okText="Remove" onConfirm={() => run(remove, "Photo removed.")}>
                <Button icon={<DeleteOutlined />} danger>
                  Remove
                </Button>
              </Popconfirm>
            )}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            JPEG, PNG or WebP. Location and camera details are removed automatically.
          </Typography.Text>
        </Space>
      )}
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
    </Space>
  );
}
