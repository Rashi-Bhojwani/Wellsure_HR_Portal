import { fs, fw, radius, v } from "../../theme/tokens";

// Our plain text logo mark (DESIGN_SYSTEM.md §0): a "W" tile and the name. No template logo. Replace the tile with the real Wellsure logo when it exists.
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          flex: "none",
          borderRadius: radius.sm + 2,
          background: v.primary,
          color: v.accent,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: fs.xl,
          letterSpacing: "-0.02em",
        }}
      >
        W
      </span>
      {!compact && (
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, minWidth: 0 }}>
          <span style={{ fontWeight: fw.bold, fontSize: fs.lg, color: v.textPrimary, whiteSpace: "nowrap" }}>Wellsure</span>
          <span style={{ fontWeight: fw.medium, fontSize: fs.xs, color: v.textSecondary, whiteSpace: "nowrap", letterSpacing: "0.04em" }}>HR PORTAL</span>
        </span>
      )}
    </span>
  );
}
