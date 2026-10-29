import type { ReactNode } from "react";
import { fs, fw, radius, space, v } from "../theme/tokens";

export interface TimelineItem {
  key: string;
  /** The sentence, with actors/objects in <strong> (recruitment-08: "Name moved candidate from stage X to Y"). */
  content: ReactNode;
  time?: ReactNode;
  /** Avatar or icon; a dot when omitted. */
  marker?: ReactNode;
  tone?: "accent" | "neutral" | "danger" | "warning" | "info";
  detail?: ReactNode;
}

const DOT: Record<NonNullable<TimelineItem["tone"]>, string> = { accent: v.accent, neutral: v.borderControl, danger: v.danger, warning: v.warning, info: v.info };

// Activity / history list (DESIGN_SYSTEM.md §6.22): marker, sentence, grey time, joined by a thin line.
export function Timeline({ items, empty }: { items: TimelineItem[]; empty?: ReactNode }) {
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((it, i) => (
        <li key={it.key} style={{ display: "flex", gap: space[3], position: "relative", paddingBottom: i === items.length - 1 ? 0 : space[5] }}>
          {i < items.length - 1 && <span aria-hidden style={{ position: "absolute", left: 15, top: 32, bottom: 0, width: 1, background: v.borderDefault }} />}
          <span style={{ width: 32, flex: "none", display: "flex", justifyContent: "center" }}>
            {it.marker ?? <span aria-hidden style={{ width: 10, height: 10, marginTop: 6, borderRadius: radius.pill, background: DOT[it.tone ?? "neutral"], boxShadow: `0 0 0 4px ${v.bgSurface}` }} />}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: fs.md, color: v.textBody, fontWeight: fw.regular }}>{it.content}</div>
            {it.time && <div style={{ fontSize: fs.sm, color: v.textSecondary, marginTop: 2 }}>{it.time}</div>}
            {it.detail && <div style={{ marginTop: space[2] }}>{it.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
