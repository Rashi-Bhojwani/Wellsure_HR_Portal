import type { ReactNode } from "react";
import { CheckOutlined, FileExcelOutlined, FileTextOutlined } from "@ant-design/icons";
import type { RunStatus } from "../../api/payroll";
import { StatusChip, useIsPhone, type ChipTone } from "../../ui";
import { fs, fw, radius, space, v } from "../../theme/tokens";

// Small presentational pieces the payroll screens share (docs/DESIGN_SYSTEM.md §6): run state chips, the run's step strip (recruitment-09 numbered stepper),
// checklist-03 progress rows, and the documents-03 file row. Nothing here fetches or decides anything.

const RUN_TONE: Record<RunStatus, ChipTone> = {
  NEW: "neutral",
  CALCULATING: "info",
  CALCULATED: "info",
  SUBMITTED: "warning",
  APPROVED: "purple",
  FAILED: "danger",
  VOID: "neutral",
  FINALISED: "success",
};

export function RunStatusChip({ status, label }: { status: RunStatus; label: string }) {
  return <StatusChip tone={RUN_TONE[status]}>{label}</StatusChip>;
}

/** The on-screen TEST mark of a run that used a Placeholder rule. Always the word TEST. */
export function TestChip() {
  return (
    <StatusChip tone="danger" title="A test run: it used a Placeholder rule">
      TEST
    </StatusChip>
  );
}

/** Right-aligned, tabular money/figure cell content. */
export function Num({ children, strong, tone }: { children: ReactNode; strong?: boolean; tone?: "danger" | "secondary" | "success" }) {
  const color = tone === "danger" ? v.danger : tone === "secondary" ? v.textSecondary : tone === "success" ? v.accentText : undefined;
  return (
    <span className="ws-num" style={{ fontWeight: strong ? fw.semibold : undefined, color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** A small caption line under a name (employee code, a source, a date). */
export function Caption({ children, tone }: { children: ReactNode; tone?: "warning" | "danger" | "success" }) {
  const color = tone === "warning" ? v.warningText : tone === "danger" ? v.danger : tone === "success" ? v.accentText : v.textSecondary;
  return <div style={{ fontSize: fs.sm, color, marginTop: 2 }}>{children}</div>;
}

/** Name over code, the board's two-line person cell. */
export function PersonCell({ name, code, extra }: { name: ReactNode; code?: ReactNode; extra?: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{name}</span>
        {extra}
      </div>
      {code && <Caption>{code}</Caption>}
    </div>
  );
}

// ── checklist-03 progress row: thin bar coloured by value + bold % + "x/y done". The % and the count are always shown. ──

export function ProgressRow({ done, total, label = "done", width = 120 }: { done: number; total: number; label?: string; width?: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const color = pct >= 70 ? v.accent : pct >= 30 ? v.warning : v.danger;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
      <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}%, ${done} of ${total} ${label}`} style={{ width, height: 6, borderRadius: radius.pill, background: v.bgSubtle, border: `1px solid ${v.borderDefault}`, overflow: "hidden", flex: "none" }}>
        <span style={{ display: "block", height: "100%", width: `${pct}%`, background: color, borderRadius: radius.pill }} />
      </span>
      <span className="ws-num" style={{ fontWeight: fw.bold, color: v.textPrimary, fontSize: fs.table }}>{pct}%</span>
      <span className="ws-num" style={{ color: v.textSecondary, fontSize: fs.sm }}>
        {done}/{total} {label}
      </span>
    </div>
  );
}

// ── The run's steps (recruitment-09 numbered stepper): a row on desktop, a vertical list on phones. Derived from the run's status only. ──

export interface StepItem {
  key: string;
  label: string;
  hint?: string;
}

export function StepStrip({ steps, current, done }: { steps: StepItem[]; current: number; done?: boolean }) {
  const phone = useIsPhone();
  return (
    <ol aria-label={`Step ${Math.min(current + 1, steps.length)} of ${steps.length}`} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: phone ? "column" : "row", gap: phone ? space[3] : space[2] }}>
      {steps.map((s, i) => {
        const isDone = done || i < current;
        const active = !done && i === current;
        return (
          <li key={s.key} aria-current={active ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: space[2], flex: phone ? undefined : 1, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 30,
                height: 30,
                flex: "none",
                borderRadius: radius.pill,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: fs.md,
                fontWeight: fw.semibold,
                background: active ? v.accentSubtle : isDone ? v.accent : v.bgSubtle,
                color: active ? v.accentText : isDone ? v.textInverse : v.textSecondary,
                border: `1px solid ${active ? v.accent : isDone ? v.accent : v.borderDefault}`,
              }}
            >
              {isDone ? <CheckOutlined /> : i + 1}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: fs.md, fontWeight: active ? fw.bold : fw.medium, color: active || isDone ? v.textPrimary : v.textSecondary, lineHeight: 1.3 }}>
                {s.label}
                <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  {isDone ? " (done)" : active ? " (current step)" : " (to do)"}
                </span>
              </span>
              {s.hint && <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{s.hint}</span>}
            </span>
            {!phone && i < steps.length - 1 && <span aria-hidden style={{ flex: 1, minWidth: space[3], height: 1, background: isDone ? v.accent : v.borderDefault, marginInline: space[2] }} />}
          </li>
        );
      })}
    </ol>
  );
}

// ── documents-03 file row: icon, name, meta, actions on the right ──

export function FileRow({ name, meta, actions, kind = "text" }: { name: ReactNode; meta?: ReactNode; actions?: ReactNode; kind?: "text" | "excel" }) {
  const phone = useIsPhone();
  return (
    <div style={{ display: "flex", alignItems: phone ? "flex-start" : "center", gap: space[3], padding: `${space[3]}px 0`, borderBottom: `1px solid ${v.borderDefault}`, flexDirection: phone ? "column" : "row" }}>
      <div style={{ display: "flex", alignItems: "center", gap: space[3], flex: 1, minWidth: 0 }}>
        <span aria-hidden style={{ width: 36, height: 36, flex: "none", borderRadius: radius.sm, background: v.bgSubtle, color: kind === "excel" ? v.accentText : v.textSecondary, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.lg }}>
          {kind === "excel" ? <FileExcelOutlined /> : <FileTextOutlined />}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: fw.semibold, color: v.textPrimary, wordBreak: "break-word" }}>{name}</div>
          {meta && <div style={{ fontSize: fs.sm, color: v.textSecondary, wordBreak: "break-word" }}>{meta}</div>}
        </div>
      </div>
      {actions && <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", flex: "none" }}>{actions}</div>}
    </div>
  );
}

/** A label/value pair for compact summaries inside a Panel (the board's grey label over dark value). */
export function Figure({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "danger" }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{label}</div>
      <div className="ws-num" style={{ fontSize: fs.xl, fontWeight: fw.bold, color: tone === "danger" ? v.danger : v.textPrimary, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

export function FigureRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))", gap: space[4] }}>{children}</div>;
}
