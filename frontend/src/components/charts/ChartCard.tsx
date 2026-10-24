import { Select } from "antd";
import type { ReactNode } from "react";
import { EmptyState, Panel, Skel } from "../../ui";
import { radius, space } from "../../theme/tokens";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  filter?: { value: string; options: string[]; onChange?: (value: string) => void };
  /** Anything else for the header's right side (a button, a link). */
  extra?: ReactNode;
  /** Height of the chart body. Reserved up front so nothing jumps while data loads. */
  height?: number;
  /** Shows a chart-shaped skeleton in the reserved space. */
  loading?: boolean;
  /** True when there is nothing to plot: shows the chart empty state instead of an empty axis. */
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}

function ChartSkeleton({ height }: { height: number }) {
  const bars = [0.45, 0.7, 0.55, 0.85, 0.6, 0.4, 0.75];
  return (
    <div aria-hidden="true" style={{ height, display: "flex", flexDirection: "column", gap: space[3] }}>
      <Skel w={140} h={12} />
      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: space[3], paddingTop: space[2] }}>
        {bars.map((b, i) => (
          <Skel key={i} w="100%" h={`${b * 100}%`} r={radius.xs} />
        ))}
      </div>
    </div>
  );
}

// The board's chart card (home-02, reports-02/05): a Panel with the title, an optional filter or extra on the right, and a body of fixed height,
// so a chart never makes the page jump. Loading shows a chart-shaped skeleton; no data shows the chart empty state.
export function ChartCard({ title, subtitle, filter, extra, height = 280, loading, empty, emptyText = "No data to show yet", children }: ChartCardProps) {
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      style={{ height: "100%" }}
      extra={
        filter || extra ? (
          <>
            {filter && (
              <Select
                value={filter.value}
                style={{ width: 150 }}
                onChange={filter.onChange}
                aria-label={`${title}: filter`}
                options={filter.options.map((o) => ({ value: o, label: o }))}
              />
            )}
            {extra}
          </>
        ) : undefined
      }
    >
      <div style={{ width: "100%", height, position: "relative" }} aria-busy={loading || undefined}>
        {loading ? (
          <ChartSkeleton height={height} />
        ) : empty ? (
          <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EmptyState compact illustration="chart" title={emptyText} description={null} />
          </div>
        ) : (
          children
        )}
      </div>
    </Panel>
  );
}
