import { useNavigate } from "react-router-dom";
import { quickActions } from "../../../routes/employeeMenu.config";
import { tintFor } from "./tints";
import { EmptyState, PageHeader, useIsPhone } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

// Mobile Action tab (Phase 5 commit G, docs/UI_REFERENCE.md Part 4 §4.1):
// the menu's quickAction pages, flattened, in menu order. Anything not built
// yet, or built over data that doesn't exist yet, is left out here (Explore
// shows it as "Coming soon"). Full-width white cards, a tinted icon tile by
// area, the label — no chevrons or subtitles (PART 4).
export function MobileActionPage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const actions = quickActions();
  return (
    <>
      {!phone && <PageHeader title="Actions" subtitle="The things you do most, one tap away." />}
      {actions.length === 0 ? (
        <EmptyState title="No quick actions yet" description="Use Explore to find every section." />
      ) : (
        <nav aria-label="Quick actions">
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: space[3], gridTemplateColumns: phone ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {actions.map((a, i) => {
              const Icon = a.icon;
              const tint = tintFor(a.path, i);
              return (
                <li key={a.key}>
                  <button
                    type="button"
                    onClick={() => navigate(`/app/${a.path}`)}
                    style={{
                      width: "100%",
                      minHeight: 64,
                      display: "flex",
                      alignItems: "center",
                      gap: space[4],
                      padding: `${space[3]}px ${space[4]}px`,
                      background: v.bgSurface,
                      border: `1px solid ${v.borderDefault}`,
                      borderRadius: radius.lg,
                      cursor: "pointer",
                      textAlign: "left",
                      font: "inherit",
                      color: v.textPrimary,
                    }}
                  >
                    <span aria-hidden style={{ width: 44, height: 44, flex: "none", borderRadius: radius.md, background: tint.bg, color: tint.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.h2 }}>
                      {Icon && <Icon />}
                    </span>
                    <span style={{ flex: 1, fontSize: fs.lg, fontWeight: fw.semibold }}>{a.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </>
  );
}
