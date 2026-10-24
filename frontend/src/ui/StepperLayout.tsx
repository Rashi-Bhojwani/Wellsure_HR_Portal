import type { ReactNode } from "react";
import { CheckOutlined } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../theme/tokens";

export interface StepperLayoutProps {
  /** Step labels, in order. */
  steps: string[];
  /** 0-based index of the current step. */
  current: number;
  /** "dots": the board's square progress dots + "STEP 2 OF 4" (auth-10); "numbered": "1 Job Info  2 …" (recruitment-09). */
  variant?: "dots" | "numbered";
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Back / Continue buttons. */
  footer?: ReactNode;
}

// A multi-step flow (DESIGN_SYSTEM.md §6.14). The progress is also announced in words ("Step 2 of 4"), so it is never shown by colour alone.
export function StepperLayout({ steps, current, variant = "dots", title, description, children, footer }: StepperLayoutProps) {
  const label = `Step ${current + 1} of ${steps.length}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
      {variant === "dots" ? (
        <div>
          <div role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={current + 1} aria-label={label} style={{ display: "flex", gap: space[2], marginBottom: space[3] }}>
            {steps.map((s, i) => (
              <span key={s} title={s} style={{ width: 20, height: 20, borderRadius: radius.xs, background: i <= current ? v.accent : v.bgSubtle, border: i <= current ? "none" : `1px solid ${v.borderDefault}` }} />
            ))}
          </div>
          <div style={{ fontSize: fs.sm, fontWeight: fw.semibold, letterSpacing: "0.08em", color: v.textSecondary, textTransform: "uppercase" }}>
            {label}
            {steps[current] ? ` · ${steps[current]}` : ""}
          </div>
        </div>
      ) : (
        <ol aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: space[5], listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s} aria-current={active ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: space[2], fontSize: fs.lg, color: active || done ? v.textPrimary : v.textSecondary, fontWeight: active ? fw.semibold : fw.medium }}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: radius.pill,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: fs.md,
                    background: active ? v.accentSubtle : done ? v.accent : v.bgSubtle,
                    color: active ? v.accentText : done ? v.textInverse : v.textSecondary,
                    border: `1px solid ${active ? v.accent : v.borderDefault}`,
                  }}
                >
                  {done ? <CheckOutlined /> : i + 1}
                </span>
                {s}
              </li>
            );
          })}
        </ol>
      )}
      {(title || description) && (
        <div>
          {title && <div style={{ fontSize: variant === "dots" ? fs.display - 8 : fs.h1, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.2 }}>{title}</div>}
          {description && <div style={{ marginTop: space[2], color: v.textSecondary, fontSize: fs.md }}>{description}</div>}
        </div>
      )}
      <div>{children}</div>
      {footer && <div style={{ display: "flex", gap: space[3], flexWrap: "wrap" }}>{footer}</div>}
    </div>
  );
}
