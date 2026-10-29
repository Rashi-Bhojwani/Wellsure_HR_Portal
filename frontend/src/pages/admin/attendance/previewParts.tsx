import type { ReactNode } from "react";
import { Button, Checkbox } from "antd";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { StatusChip, useIsPhone } from "../../../ui";

// Shared pieces of the preview-then-confirm admin screens (Shift Roster, Shift Override): the "left out, and why" list and the
// look-then-confirm footer.

export function LeftOutList({ title, groups }: { title: string; groups: Array<{ code: string; label: string; count: number; examples: string[] }> }) {
  if (groups.length === 0) return null;
  return (
    <section aria-label={title} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[4] }}>
      <div style={{ fontWeight: fw.semibold, color: v.textPrimary, marginBottom: space[2] }}>{title}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[2] }}>
        {groups.map((g) => (
          <li key={g.code} style={{ display: "flex", alignItems: "baseline", gap: space[2], flexWrap: "wrap" }}>
            <StatusChip tone="warning">{g.count}</StatusChip>
            <span style={{ color: v.textBody }}>{g.label}</span>
            {g.examples.length > 0 && <span style={{ color: v.textSecondary, fontSize: fs.sm }}>e.g. {g.examples.join(", ")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "I have looked at this" + the confirming primary button, on a subtle band. */
export function ConfirmBar({ checked, onChecked, label, action, loading, onConfirm }: { checked: boolean; onChecked: (c: boolean) => void; label: ReactNode; action: ReactNode; loading: boolean; onConfirm: () => void }) {
  const phone = useIsPhone();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: phone ? "column" : "row",
        alignItems: phone ? "stretch" : "center",
        justifyContent: "space-between",
        gap: space[3],
        padding: space[4],
        borderRadius: radius.md,
        background: v.bgSubtle,
      }}
    >
      <Checkbox checked={checked} onChange={(e) => onChecked(e.target.checked)} style={{ alignItems: "center", minHeight: phone ? 44 : undefined }}>
        {label}
      </Checkbox>
      <Button type="primary" disabled={!checked} loading={loading} onClick={onConfirm} block={phone}>
        {action}
      </Button>
    </div>
  );
}
