import type { CSSProperties, ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../theme/tokens";
import { useIsPhone } from "./hooks";

export interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right side of the header: a link, a select, buttons. */
  extra?: ReactNode;
  /** Shows the board's pencil icon in the header (FormSection, employees-05). */
  onEdit?: () => void;
  editLabel?: string;
  children?: ReactNode;
  /** Remove the body padding (tables that run edge to edge). */
  flush?: boolean;
  /** Tinted surface instead of white. */
  tone?: "default" | "subtle";
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  id?: string;
  as?: "section" | "div" | "article";
}

// The board's card (rounded 16, thin border, flat, 24 padding; 16 on phones) with an optional title row. Use for every content block.
export function Panel({ title, subtitle, extra, onEdit, editLabel = "Edit", children, flush, tone = "default", style, bodyStyle, id, as = "section" }: PanelProps) {
  const phone = useIsPhone();
  const pad = phone ? space[4] : space[6];
  const Tag = as;
  const hasHead = title || extra || onEdit;
  return (
    <Tag
      id={id}
      style={{
        background: tone === "subtle" ? v.bgSubtle : v.bgSurface,
        border: `1px solid ${v.borderDefault}`,
        borderRadius: radius.lg,
        minWidth: 0,
        ...style,
      }}
    >
      {hasHead && (
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap", padding: `${pad}px ${pad}px ${flush ? pad : 0}px` }}>
          <div style={{ minWidth: 0 }}>
            {title && <h2 style={{ margin: 0, fontSize: phone ? fs.lg : fs.xl, fontWeight: fw.semibold, color: v.textPrimary, lineHeight: 1.35 }}>{title}</h2>}
            {subtitle && <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap", minWidth: 0, maxWidth: "100%" }}>
            {extra}
            {onEdit && (
              <Tooltip title={editLabel}>
                <Button type="text" aria-label={editLabel} icon={<EditOutlined />} onClick={onEdit} style={{ color: v.textSecondary }} />
              </Tooltip>
            )}
          </div>
        </header>
      )}
      {children !== undefined && <div style={{ paddingTop: flush ? 0 : hasHead ? space[5] : pad, paddingInline: flush ? 0 : pad, paddingBottom: flush ? 0 : pad, ...bodyStyle }}>{children}</div>}
    </Tag>
  );
}

/** Responsive grid for cards: `min` is the narrowest a column may get before wrapping. */
export function CardGrid({ children, min = 280, gap = space[6], style }: { children: ReactNode; min?: number; gap?: number; style?: CSSProperties }) {
  const phone = useIsPhone();
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, gap: phone ? space[4] : gap, ...style }}>{children}</div>;
}

/** Vertical stack with the page rhythm (24 desktop, 16 phone). */
export function Stack({ children, gap, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) {
  const phone = useIsPhone();
  return <div style={{ display: "flex", flexDirection: "column", gap: gap ?? (phone ? space[4] : space[6]), minWidth: 0, ...style }}>{children}</div>;
}
