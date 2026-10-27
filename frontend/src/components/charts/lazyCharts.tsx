import { lazy, Suspense, type ComponentProps } from "react";
import type * as Kit from "./chartKit";
import { Skel } from "../../ui/Skeletons";
import { radius } from "../../theme/tokens";

// The chart kit (recharts + d3, ~110 KB gzip) loads on demand, after the page around it has painted: a chart-sized skeleton holds its place meanwhile, so nothing
// jumps. Same props as chartKit.tsx; import charts from here in pages that sit on a bundle budget (DESIGN_SYSTEM.md §7: shell + home < 400 KB).
const loadKit = () => import("./chartKit");
const LazyColumnChart = lazy(() => loadKit().then((m) => ({ default: m.ColumnChart })));
const LazyDonutChart = lazy(() => loadKit().then((m) => ({ default: m.DonutChart })));
const LazySmoothLineChart = lazy(() => loadKit().then((m) => ({ default: m.SmoothLineChart })));

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div aria-busy="true" aria-label="Loading chart">
      <Skel h={height} r={radius.md} />
    </div>
  );
}

export function ColumnChart(props: ComponentProps<typeof Kit.ColumnChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height} />}>
      <LazyColumnChart {...props} />
    </Suspense>
  );
}

export function DonutChart(props: ComponentProps<typeof Kit.DonutChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height} />}>
      <LazyDonutChart {...props} />
    </Suspense>
  );
}

export function SmoothLineChart(props: ComponentProps<typeof Kit.SmoothLineChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height} />}>
      <LazySmoothLineChart {...props} />
    </Suspense>
  );
}
