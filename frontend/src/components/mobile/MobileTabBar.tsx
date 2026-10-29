import type { ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppstoreOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { employeeMenu, mobileTabs, type MobileTab } from "../../routes/employeeMenu.config";
import { activeTabFor } from "../../lib/mobileNav";

const GENERATED_ICONS: Partial<Record<MobileTab["key"], ComponentType>> = { action: ThunderboltOutlined, explore: AppstoreOutlined };

function iconFor(tab: MobileTab): ComponentType | undefined {
  if (tab.menuKey) return employeeMenu.find((e) => e.key === tab.menuKey)?.icon;
  return GENERATED_ICONS[tab.key];
}

// The phone-width bottom tab bar (Phase 5 commit G, docs/UI_REFERENCE.md Part 4 §4.0) — tabs from employeeMenu.config.tsx's mobileTabs. Styled in shell.css.
export function MobileTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = activeTabFor(location.pathname);
  return (
    <nav aria-label="Main" className="ws-tabbar">
      {mobileTabs.map((tab) => {
        const Icon = iconFor(tab);
        const isActive = tab.key === active;
        return (
          <button key={tab.key} type="button" className="ws-tabbar__tab" aria-current={isActive ? "page" : undefined} onClick={() => navigate(`/app/${tab.path}`)}>
            {Icon && (
              <span className="ws-tabbar__icon" aria-hidden>
                <Icon />
              </span>
            )}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
