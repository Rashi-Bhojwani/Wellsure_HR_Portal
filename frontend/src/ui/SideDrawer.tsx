import type { ReactNode } from "react";
import { Button, Drawer } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { fs, fw, layout, space, v } from "../theme/tokens";
import { useIsPhone } from "./hooks";

export interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Chip next to the title (time-off-02's PENDING). */
  status?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** "form" 440px, "wide" 640px (time-off-13). Phones: always a full-screen sheet. */
  size?: "form" | "wide";
  /** Footer: by default Cancel + primary. Pass `footer` to replace it, or `null` for none. */
  footer?: ReactNode | null;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  primaryDanger?: boolean;
  cancelLabel?: string;
  /** A text action on the left of the footer ("Save & Assign Employee"). */
  secondaryAction?: ReactNode;
  /** Form id to submit from the primary button (htmlType=submit). */
  formId?: string;
  destroyOnHidden?: boolean;
}

// The board's right drawer for "Add" and detail forms (employees-03, time-off-02/13): title row, scrolling body, sticky footer with equal buttons.
// antd's Drawer traps focus while open, returns it on close, and closes on Esc and on the overlay.
export function SideDrawer({
  open,
  onClose,
  title,
  status,
  subtitle,
  children,
  size = "form",
  footer,
  primaryLabel = "Save",
  onPrimary,
  primaryLoading,
  primaryDisabled,
  primaryDanger,
  cancelLabel = "Cancel",
  secondaryAction,
  formId,
  destroyOnHidden = true,
}: SideDrawerProps) {
  const phone = useIsPhone();
  const defaultFooter =
    onPrimary || formId ? (
      <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
        {secondaryAction && <div style={{ marginRight: "auto" }}>{secondaryAction}</div>}
        <div style={{ display: "flex", gap: space[3], flex: secondaryAction ? undefined : 1, width: phone ? "100%" : undefined }}>
          <Button size="large" onClick={onClose} style={{ flex: 1, minWidth: 120 }}>
            {cancelLabel}
          </Button>
          <Button
            size="large"
            type="primary"
            danger={primaryDanger}
            loading={primaryLoading}
            disabled={primaryDisabled}
            onClick={onPrimary}
            htmlType={formId ? "submit" : "button"}
            form={formId}
            style={{ flex: 1, minWidth: 120 }}
          >
            {primaryLabel}
          </Button>
        </div>
      </div>
    ) : null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement={phone ? "bottom" : "right"}
      size={phone ? "100%" : size === "wide" ? layout.drawerWide : layout.drawer}
      destroyOnHidden={destroyOnHidden}
      closable={false}
      title={
        <div style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
              <span style={{ fontSize: phone ? fs.h2 : fs.h1, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.3 }}>{title}</span>
              {status}
            </div>
            {subtitle && <div style={{ fontSize: fs.md, fontWeight: fw.regular, color: v.textSecondary, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <Button type="text" aria-label="Close" icon={<CloseOutlined />} onClick={onClose} />
        </div>
      }
      footer={footer === undefined ? defaultFooter : footer}
      styles={{
        header: { borderBottom: "none", padding: `${space[6]}px ${space[6]}px ${space[2]}px` },
        body: { padding: `${space[4]}px ${space[6]}px ${space[6]}px` },
        footer: { padding: `${space[4]}px ${space[6]}px`, borderTop: `1px solid ${v.borderDefault}` },
      }}
    >
      {children}
    </Drawer>
  );
}
