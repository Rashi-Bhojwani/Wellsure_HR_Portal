import type { ReactNode } from "react";
import { fs, fw, space, v } from "../theme/tokens";
import { useIsPhone } from "./hooks";
import { Panel } from "./Panel";

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Spans the full row (addresses, descriptions). */
  wide?: boolean;
  key?: string;
}

/** Label/value grid (employees-05): grey label, dark value; 2 pairs per row on desktop, stacked on phones. */
export function KeyValueGrid({ items, columns = 2 }: { items: KeyValueItem[]; columns?: 1 | 2 | 3 }) {
  const phone = useIsPhone();
  const cols = phone ? 1 : columns;
  return (
    <dl style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: `${space[4]}px ${space[8]}px`, margin: 0 }}>
      {items.map((it, i) => (
        <div
          key={it.key ?? (typeof it.label === "string" ? it.label : i)}
          style={{ display: phone ? "block" : "grid", gridTemplateColumns: "minmax(120px, 40%) 1fr", gap: space[4], gridColumn: it.wide ? "1 / -1" : undefined, minWidth: 0 }}
        >
          <dt style={{ color: v.textSecondary, fontSize: fs.md, marginBottom: phone ? 2 : 0 }}>{it.label}</dt>
          <dd style={{ margin: 0, color: v.textBody, fontSize: fs.md, fontWeight: fw.medium, wordBreak: "break-word" }}>{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface FormSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Pencil in the header (switches the section into edit mode in the caller). */
  onEdit?: () => void;
  extra?: ReactNode;
  children: ReactNode;
}

/** A titled block of a form or a profile (employees-06, time-off-13). Sub-heads inside long drawers use `FormGroupTitle`. */
export function FormSection({ title, description, onEdit, extra, children }: FormSectionProps) {
  return (
    <Panel title={title} subtitle={description} onEdit={onEdit} extra={extra}>
      {children}
    </Panel>
  );
}

export function FormGroupTitle({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: `${space[5]}px 0 ${space[3]}px`, fontSize: fs.xl, fontWeight: fw.semibold, color: v.textPrimary }}>{children}</h3>;
}
