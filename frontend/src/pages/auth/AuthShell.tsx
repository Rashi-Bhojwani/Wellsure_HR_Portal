import { useEffect, useState, type ReactNode } from "react";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { useThemeMode } from "../../theme/ThemeProvider";

interface AuthShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Max width of the form column (default 420). */
  width?: number;
  /**
   * "split": the board's sign-in layout (auth-01) — a navy brand panel on the left, the form on the right; collapses to a logo row
   * above the form under 900 px (m-auth-01). "centred": the secondary pages (auth-06..09) — logo, heading and form centred on a faint
   * wavy-line background.
   */
  layout?: "split" | "centred";
  /** Shown above the heading (e.g. the success illustration, auth-09). */
  hero?: ReactNode;
  children: ReactNode;
}

const NARROW = "(max-width: 899px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Our text mark (no template logo): a small accent tile with "W" and the product name. */
export function BrandMark({ inverse = false, size = "md" }: { inverse?: boolean; size?: "md" | "lg" }) {
  const tile = size === "lg" ? 36 : 30;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: space[3] }}>
      <span
        aria-hidden
        style={{
          width: tile,
          height: tile,
          borderRadius: radius.sm,
          background: v.accent,
          color: v.textInverse,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: fw.bold,
          fontSize: size === "lg" ? fs.xl : fs.lg,
        }}
      >
        W
      </span>
      <span style={{ fontSize: size === "lg" ? fs.xl : fs.lg, fontWeight: fw.bold, color: inverse ? "inherit" : v.textPrimary, letterSpacing: "-0.01em" }}>
        Wellsure HR Portal
      </span>
    </div>
  );
}

// Faint wavy lines (our own, generated): a family of gently phase-shifted sine curves, drawn behind the centred auth pages (auth-06).
const WAVES = Array.from({ length: 34 }, (_, i) => {
  const y0 = -120 + i * 34;
  const amp = 60 + (i % 7) * 6;
  const phase = i * 0.22;
  const pts: string[] = [];
  for (let x = -40; x <= 1480; x += 40) {
    const y = y0 + amp * Math.sin(x / 260 + phase) + 0.18 * x;
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
});

function WavyBackground() {
  return (
    <svg aria-hidden viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <g fill="none" stroke={v.accent} strokeOpacity={0.09} strokeWidth={1.2}>
        {WAVES.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

// The brand panel's pattern (our own): a few large concentric arcs and a dot grid, very low contrast on the panel colour.
function BrandPattern() {
  return (
    <svg aria-hidden viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <defs>
        <pattern id="ws-auth-dots" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.4" fill={v.accent} fillOpacity={0.22} />
        </pattern>
      </defs>
      <rect x="0" y="0" width="600" height="380" fill="url(#ws-auth-dots)" />
      <g fill="none" stroke={v.accent} strokeWidth={1.5}>
        {[120, 190, 260, 330, 400, 470].map((r, i) => (
          <circle key={r} cx="560" cy="120" r={r} strokeOpacity={0.28 - i * 0.04} />
        ))}
      </g>
    </svg>
  );
}

function Footer() {
  return (
    <div style={{ textAlign: "center", color: v.textSecondary, fontSize: fs.sm, padding: `${space[6]}px ${space[4]}px ${space[5]}px` }}>
      © {new Date().getFullYear()} Wellsure HR Portal
    </div>
  );
}

function Heading({ title, subtitle, align }: { title: ReactNode; subtitle?: ReactNode; align: "left" | "center" }) {
  return (
    <div style={{ textAlign: align, marginBottom: space[8] }}>
      <h1 style={{ margin: 0, fontSize: fs.authH1, lineHeight: 1.3, fontWeight: fw.bold, color: v.textPrimary }}>{title}</h1>
      {subtitle && <div style={{ marginTop: space[2], color: v.textSecondary, fontSize: fs.md, lineHeight: 1.6 }}>{subtitle}</div>}
    </div>
  );
}

// Shared shell for every auth page (login, set/forgot/reset password, two-step challenge/enrolment). Pages render outside the app shell.
export function AuthShell({ title, subtitle, width = 420, layout = "centred", hero, children }: AuthShellProps) {
  const { mode } = useThemeMode();
  const narrow = useNarrow();

  if (layout === "split" && !narrow) {
    const panelBg = mode === "dark" ? v.bgSurface : v.primary;
    const panelText = mode === "dark" ? v.textPrimary : v.primaryText;
    return (
      <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(380px, 1fr) minmax(480px, 1fr)", background: mode === "dark" ? v.bgPage : v.bgSurface }}>
        <aside
          style={{ position: "relative", overflow: "hidden", background: panelBg, color: panelText, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: `${space[10]}px ${space[12]}px` }}
        >
          <BrandPattern />
          <div style={{ position: "relative" }}>
            <BrandMark inverse size="lg" />
          </div>
          <div style={{ position: "relative", maxWidth: 460 }}>
            <div style={{ width: 48, height: 4, borderRadius: radius.pill, background: v.accent, marginBottom: space[6] }} />
            <p style={{ margin: 0, fontSize: fs.display, lineHeight: 1.2, fontWeight: fw.bold, letterSpacing: "-0.01em" }}>Your workday, in one place.</p>
            <p style={{ margin: `${space[4]}px 0 0`, fontSize: fs.lg, lineHeight: 1.6, opacity: 0.8 }}>
              Attendance as it happens, leave in a few taps, and your team's news — for everyone at Wellsure.
            </p>
          </div>
        </aside>
        <main style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: `${space[10]}px ${space[6]}px 0` }}>
            <div style={{ width: "100%", maxWidth: width }}>
              {hero}
              <Heading title={title} subtitle={subtitle} align="left" />
              {children}
            </div>
          </div>
          <Footer />
        </main>
      </div>
    );
  }

  // Centred layout (also the split layout's narrow form: the brand panel becomes the logo row above the form).
  const split = layout === "split";
  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", background: split && mode === "light" ? v.bgSurface : v.bgPage, overflow: "hidden" }}>
      {!split && <WavyBackground />}
      <main style={{ position: "relative", flex: 1, display: "flex", alignItems: narrow ? "flex-start" : "center", justifyContent: "center", padding: `${narrow ? space[8] : space[12]}px ${space[4]}px 0` }}>
        <div style={{ width: "100%", maxWidth: width }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: space[6] }}>
            <BrandMark />
          </div>
          {hero && <div style={{ display: "flex", justifyContent: "center", marginBottom: space[4] }}>{hero}</div>}
          <Heading title={title} subtitle={subtitle} align="center" />
          {children}
        </div>
      </main>
      <div style={{ position: "relative" }}>
        <Footer />
      </div>
    </div>
  );
}
