import { CloseCircleFilled, ExclamationCircleFilled, TeamOutlined } from "@ant-design/icons";
import type { CheckerAvailability } from "../../api/payroll";
import { fs, fw, radius, space, v } from "../../theme/tokens";

/** Who could decide this, in words. One eligible person and nobody are shown as what they are, never as a silent block. A quoted card with a tinted edge. */
export function CheckersNote({ checkers, what }: { checkers: CheckerAvailability | null | undefined; what: string }) {
  if (!checkers) return null;
  const tone = checkers.state === "NONE" ? { edge: v.danger, fg: v.danger, icon: <CloseCircleFilled /> } : checkers.state === "ONE" ? { edge: v.warning, fg: v.warningText, icon: <ExclamationCircleFilled /> } : { edge: v.info, fg: v.infoText, icon: <TeamOutlined /> };
  const title = checkers.state === "MANY" ? `Who can approve ${what}` : checkers.state === "ONE" ? `One person can approve ${what}` : `Nobody can approve ${what}`;
  return (
    <figure role={checkers.state === "MANY" ? undefined : "alert"} style={{ margin: 0, display: "flex", gap: space[3], padding: `${space[3]}px ${space[4]}px`, background: v.bgSubtle, border: `1px solid ${v.borderDefault}`, borderLeft: `4px solid ${tone.edge}`, borderRadius: radius.md }}>
      <span aria-hidden style={{ color: tone.fg, fontSize: fs.lg, lineHeight: 1.4 }}>{tone.icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{title}</div>
        <blockquote style={{ margin: `${space[1]}px 0 0`, color: v.textBody, fontSize: fs.md }}>{checkers.message}</blockquote>
      </div>
    </figure>
  );
}
