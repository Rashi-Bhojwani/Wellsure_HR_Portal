import type { CSSProperties } from "react";
import { layout, radius, space, v } from "../theme/tokens";

// Placeholders shaped like the content they stand in for (board home-01): circles for icons and avatars, pills for lines. Never a whole-page spinner.

export function Skel({ w = "100%", h = 14, r = radius.sm, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="ws-skel" aria-hidden="true" style={{ display: "block", width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonCard({ lines = 3, height, style }: { lines?: number; height?: number; style?: CSSProperties }) {
  return (
    <div aria-hidden="true" style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[6], minHeight: height, ...style }}>
      <Skel w="40%" h={18} style={{ marginBottom: space[5] }} />
      {Array.from({ length: lines }, (_, i) => (
        <Skel key={i} w={`${90 - i * 12}%`} style={{ marginBottom: space[3] }} />
      ))}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(200px, 1fr))`, gap: space[4] }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5] }}>
          <Skel w={44} h={44} r={radius.pill} style={{ marginBottom: space[4] }} />
          <Skel w="50%" h={26} style={{ marginBottom: space[2] }} />
          <Skel w="70%" h={12} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden="true">
      <div style={{ display: "flex", gap: space[4], background: v.bgTableHeader, borderRadius: radius.md, padding: `${space[4]}px ${space[4]}px` }}>
        {Array.from({ length: columns }, (_, i) => (
          <Skel key={i} w={`${100 / columns}%`} h={12} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "flex", gap: space[4], alignItems: "center", padding: `${space[4]}px ${space[4]}px`, borderBottom: `1px solid ${v.borderDefault}` }}>
          {Array.from({ length: columns }, (_, c) =>
            c === 0 ? (
              <div key={c} style={{ display: "flex", gap: space[3], alignItems: "center", width: `${100 / columns}%` }}>
                <Skel w={32} h={32} r={radius.pill} style={{ flex: "none" }} />
                <Skel w="70%" h={12} />
              </div>
            ) : (
              <Skel key={c} w={`${(100 / columns) * 0.7}%`} h={12} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

/** The route-level fallback while a page's code loads: header + stats + a table card, inside the mounted shell. */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[6], maxWidth: layout.contentMax }}>
      <div>
        <Skel w={260} h={28} style={{ marginBottom: space[2] }} />
        <Skel w={180} h={14} />
      </div>
      <SkeletonStats count={4} />
      <div style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[6] }}>
        <SkeletonTable rows={6} />
      </div>
    </div>
  );
}
