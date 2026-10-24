import type { ReactNode } from "react";
import { Button, Modal } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { fs, fw, space, v } from "../theme/tokens";
import { useIsPhone } from "./hooks";
import { Illustration, type IllustrationName } from "./Illustrations";

export interface ConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm?: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** The (i) info line under the title (attendance-02). */
  info?: ReactNode;
  illustration?: IllustrationName;
  confirmLabel?: string;
  cancelLabel?: string | null;
  danger?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
  width?: number;
}

// The board's centred modal (attendance-02, home-05, recruitment-12): optional illustration, title, info line, body, two equal buttons. Bottom sheet on phones.
// Never used for an optimistic action: the confirm button waits for the server (loading) before closing.
export function ConfirmModal({ open, onCancel, onConfirm, title, description, info, illustration, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, loading, confirmDisabled, children, width = 480 }: ConfirmModalProps) {
  const phone = useIsPhone();
  const centred = Boolean(illustration);
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      width={phone ? "100%" : width}
      centered={!phone}
      footer={null}
      destroyOnHidden
      style={phone ? { top: "auto", bottom: 0, position: "fixed", left: 0, right: 0, margin: 0, padding: 0, maxWidth: "100vw" } : undefined}
      styles={{ container: { padding: phone ? space[5] : space[8], borderRadius: phone ? "16px 16px 0 0" : undefined } }}
    >
      <div style={{ textAlign: centred ? "center" : "left", display: "flex", flexDirection: "column", alignItems: centred ? "center" : "stretch", gap: space[3] }}>
        {illustration && <Illustration name={illustration} size={150} />}
        <div style={{ fontSize: fs.h1, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.3, paddingRight: centred ? 0 : space[6] }}>{title}</div>
        {info && (
          <div style={{ display: "flex", gap: space[2], color: v.textSecondary, fontSize: fs.md, textAlign: "left" }}>
            <InfoCircleOutlined style={{ marginTop: 4 }} aria-hidden />
            <span>{info}</span>
          </div>
        )}
        {description && <div style={{ color: v.textSecondary, fontSize: fs.md }}>{description}</div>}
        {children && <div style={{ textAlign: "left", width: "100%" }}>{children}</div>}
        <div style={{ display: "flex", gap: space[3], marginTop: space[3], width: "100%" }}>
          {cancelLabel !== null && (
            <Button size="large" onClick={onCancel} style={{ flex: 1 }}>
              {cancelLabel}
            </Button>
          )}
          {onConfirm && (
            <Button size="large" type="primary" danger={danger} loading={loading} disabled={confirmDisabled} onClick={onConfirm} style={{ flex: 1 }}>
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
