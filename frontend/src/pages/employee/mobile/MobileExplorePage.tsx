import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { canSeeLeaf, exploreEntries, isComingSoon, isEmployeeMenuGroup, type EmployeeMenuLeaf } from "../../../routes/employeeMenu.config";
import { useAuth } from "../../../hooks/useAuth";
import { tintFor } from "./tints";
import { PageHeader, StatusChip, useIsPhone, usePrefersReducedMotion } from "../../../ui";
import { fs, fw, motion, radius, space, v } from "../../../theme/tokens";

const areaOf = (key: string, children?: EmployeeMenuLeaf[]) => children?.[0]?.path.split("/")[0] ?? key;

const resetButton = { width: "100%", display: "flex", alignItems: "center", textAlign: "left", background: "none", border: "none", font: "inherit", color: "inherit", padding: 0 } as const;

// Mobile Explore tab (Phase 5 commit G, docs/UI_REFERENCE.md Part 4 §4.2):
// every menu section except the ones that are tabs themselves. A group is an
// expandable card listing its pages; a single page is a card that opens it.
// Pages not built yet (or over data that doesn't exist yet: attendance,
// payroll) are listed greyed with "Coming soon" and don't open.
export function MobileExplorePage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState<string | null>(null);
  const { hasPermission } = useAuth();

  const leafRow = (leaf: EmployeeMenuLeaf) => {
    const soon = isComingSoon(leaf);
    const Icon = leaf.icon;
    return (
      <li key={leaf.key}>
        <button
          type="button"
          disabled={soon}
          aria-label={soon ? `${leaf.label} (coming soon)` : leaf.label}
          onClick={soon ? undefined : () => navigate(`/app/${leaf.path}`)}
          style={{ ...resetButton, gap: space[3], minHeight: 52, padding: `${space[2]}px ${space[4]}px`, borderRadius: radius.md, background: v.bgSurface, cursor: soon ? "default" : "pointer" }}
        >
          <span aria-hidden style={{ fontSize: fs.lg, color: soon ? v.textSecondary : v.textBody, display: "inline-flex" }}>
            {Icon && <Icon />}
          </span>
          <span style={{ flex: 1, fontSize: fs.md, fontWeight: fw.medium, color: soon ? v.textSecondary : v.textPrimary }}>{leaf.label}</span>
          {soon ? <StatusChip tone="neutral">Coming soon</StatusChip> : <RightOutlined aria-hidden style={{ color: v.textSecondary, fontSize: fs.sm }} />}
        </button>
      </li>
    );
  };

  return (
    <>
      {!phone && <PageHeader title="Explore" subtitle="Every section of the portal." />}
      <div style={{ display: "grid", gap: space[3], gridTemplateColumns: phone ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", alignItems: "start" }}>
        {exploreEntries().map((entry, i) => {
          const group = isEmployeeMenuGroup(entry) ? entry : null;
          const tint = tintFor(areaOf(entry.key, group?.children), i);
          const Icon = entry.icon;
          const isOpen = open === entry.key;
          const soon = !group && isComingSoon(entry as EmployeeMenuLeaf);
          const onClick = group ? () => setOpen(isOpen ? null : entry.key) : soon ? undefined : () => navigate(`/app/${(entry as EmployeeMenuLeaf).path}`);
          const panelId = `explore-${entry.key}`;
          return (
            <section key={entry.key} style={{ background: tint.bg, borderRadius: radius.lg, overflow: "hidden" }}>
              <button
                type="button"
                onClick={onClick}
                disabled={!onClick}
                aria-expanded={group ? isOpen : undefined}
                aria-controls={group ? panelId : undefined}
                style={{ ...resetButton, gap: space[3], minHeight: 96, padding: `${space[5]}px ${space[5]}px`, cursor: onClick ? "pointer" : "default" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                    <span style={{ fontSize: fs.h2, fontWeight: fw.bold, color: v.textPrimary }}>{entry.label}</span>
                    {group && (
                      <DownOutlined
                        aria-hidden
                        style={{ fontSize: fs.sm, color: v.textPrimary, transform: isOpen ? "rotate(180deg)" : "none", transition: reduced ? undefined : `transform ${motion.base}ms ${motion.easing}` }}
                      />
                    )}
                    {soon && <StatusChip tone="neutral">Coming soon</StatusChip>}
                  </div>
                  {entry.description && <div style={{ marginTop: space[1], fontSize: fs.md, color: v.textBody }}>{entry.description}</div>}
                </div>
                <span aria-hidden style={{ width: 56, height: 56, flex: "none", borderRadius: radius.lg, background: v.bgSurface, color: tint.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.stat - 4 }}>
                  {Icon && <Icon />}
                </span>
              </button>
              {group && isOpen && (
                <ul id={panelId} style={{ listStyle: "none", margin: 0, padding: `0 ${space[3]}px ${space[3]}px`, display: "grid", gap: space[2] }}>
                  {group.children.filter((l) => canSeeLeaf(l, hasPermission)).map(leafRow)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
