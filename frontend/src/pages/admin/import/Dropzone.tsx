import type { ReactNode } from "react";
import { Button, Upload } from "antd";
import { CloudUploadOutlined } from "@ant-design/icons";
import { Illustration, useIsPhone } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

export interface DropzoneProps {
  accept?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Called with the chosen file; nothing is uploaded by antd itself. */
  onFile: (file: File) => void;
  title?: ReactNode;
  hint?: ReactNode;
  buttonLabel?: string;
  /** Smaller illustration and padding (inside a tab or next to other content). */
  compact?: boolean;
}

// The board's drag-and-drop upload (recruitment-15, employees-09): our illustration, "Drag & drop here to upload", "or select a file from your computer",
// a primary "Upload file" button. Ant Design's Upload.Dragger underneath, so drop, click and keyboard (Enter/Space on the zone) all work.
export function Dropzone({ accept, disabled, loading, onFile, title = "Drag & drop here to upload", hint = "or select a file from your computer", buttonLabel = "Upload file", compact }: DropzoneProps) {
  const phone = useIsPhone();
  return (
    <Upload.Dragger
      multiple={false}
      accept={accept}
      showUploadList={false}
      disabled={disabled || loading}
      beforeUpload={(file) => {
        onFile(file);
        return false;
      }}
      style={{ background: v.bgSurface, borderRadius: radius.lg, border: `1px dashed ${v.borderControl}` }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[2], padding: compact || phone ? space[4] : space[8] }}>
        <Illustration name="upload" size={compact || phone ? 110 : 150} />
        <div style={{ fontSize: phone ? fs.lg : fs.h2, fontWeight: fw.bold, color: v.textPrimary, marginTop: space[2] }}>{title}</div>
        <div style={{ fontSize: fs.md, color: v.textSecondary, maxWidth: 520 }}>{hint}</div>
        <Button type="primary" size="large" icon={<CloudUploadOutlined />} loading={loading} disabled={disabled} style={{ marginTop: space[3] }} tabIndex={-1}>
          {buttonLabel}
        </Button>
      </div>
    </Upload.Dragger>
  );
}
