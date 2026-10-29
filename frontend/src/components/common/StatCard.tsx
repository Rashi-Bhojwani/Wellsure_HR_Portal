import type { ReactNode } from "react";
import { StatCard as UiStatCard } from "../../ui/StatCard";
import { fs, v } from "../../theme/tokens";

interface StatCardProps {
  label: string;
  value: ReactNode;
  trend?: { text: string; positive?: boolean };
  extra?: ReactNode;
  icon?: ReactNode;
}

// Used by the Attendance Info stats row (AVG. WORK HRS, PENALTY DAYS, ...) and anywhere a single big number needs a label; the design system's StatCard (src/ui).
export function StatCard({ label, value, trend, extra, icon }: StatCardProps) {
  return (
    <UiStatCard
      label={label}
      value={value}
      icon={icon}
      hint={
        trend || extra ? (
          <>
            {trend && <span style={{ color: trend.positive ? v.accentText : v.danger, fontSize: fs.sm }}>{trend.text}</span>}
            {extra}
          </>
        ) : undefined
      }
    />
  );
}
