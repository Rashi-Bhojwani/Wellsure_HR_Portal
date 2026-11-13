import { BrandLogo } from "../../ui/BrandLogo";
import { fs, fw, v } from "../../theme/tokens";

// The sidebar's brand: the Wellsure logo (public/logo.png) and the name. Without the logo file the name alone shows — in the collapsed sidebar, the plain word
// "Wellsure".
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <BrandLogo
        size={36}
        fallback={compact ? <span style={{ fontWeight: fw.bold, fontSize: fs.xs, color: v.textPrimary, whiteSpace: "nowrap" }}>Wellsure</span> : null}
      />
      {!compact && (
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, minWidth: 0 }}>
          <span style={{ fontWeight: fw.bold, fontSize: fs.lg, color: v.textPrimary, whiteSpace: "nowrap" }}>Wellsure</span>
          <span style={{ fontWeight: fw.medium, fontSize: fs.xs, color: v.textSecondary, whiteSpace: "nowrap", letterSpacing: "0.04em" }}>HR PORTAL</span>
        </span>
      )}
    </span>
  );
}
