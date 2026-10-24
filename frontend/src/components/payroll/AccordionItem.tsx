import { useId, useState, type ReactNode } from "react";
import { DownOutlined } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { useIsPhone } from "../../ui";

/** The board's accordion card (checklist-09, payroll-02): chevron, title with chips, a line under it, actions on the right; the body opens below. Keyboard: the
 *  title is a button with aria-expanded. Actions stay visible whether it is open or not (never hover-only). */
export function AccordionItem({ title, chips, summary, right, children, defaultOpen = false, testId }: { title: ReactNode; chips?: ReactNode; summary?: ReactNode; right?: ReactNode; children?: ReactNode; defaultOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const phone = useIsPhone();
  const bodyId = useId();
  const canOpen = children !== undefined && children !== null && children !== false;
  return (
    <div data-testid={testId} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, background: v.bgSurface }}>
      <div style={{ display: "flex", alignItems: phone ? "stretch" : "center", gap: space[3], padding: `${space[4]}px ${space[5]}px`, flexDirection: phone ? "column" : "row" }}>
        <button
          type="button"
          aria-expanded={canOpen ? open : undefined}
          aria-controls={canOpen ? bodyId : undefined}
          onClick={() => canOpen && setOpen((o) => !o)}
          disabled={!canOpen}
          style={{ all: "unset", cursor: canOpen ? "pointer" : "default", display: "flex", alignItems: "flex-start", gap: space[3], flex: 1, minWidth: 0 }}
        >
          <DownOutlined aria-hidden style={{ fontSize: fs.sm, color: v.textSecondary, marginTop: 6, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s", visibility: canOpen ? "visible" : "hidden" }} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <span style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>{title}</span>
              {chips}
            </span>
            {summary && <span style={{ display: "block", marginTop: space[1], fontSize: fs.md, color: v.textBody }}>{summary}</span>}
          </span>
        </button>
        {right && <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap", flex: "none", paddingLeft: phone ? space[6] : 0 }}>{right}</div>}
      </div>
      {canOpen && open && (
        <div id={bodyId} style={{ borderTop: `1px solid ${v.borderDefault}`, padding: `${space[4]}px ${space[5]}px ${space[5]}px` }}>
          {children}
        </div>
      )}
    </div>
  );
}
