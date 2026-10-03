import type { ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { theme } from "antd";
import { AppstoreOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { employeeMenu, mobileTabs, type MobileTab } from "../../routes/employeeMenu.config";
import { activeTabFor, MOBILE_TAB_BAR_HEIGHT } from "../../lib/mobileNav";

const GENERATED_ICONS: Partial<Record<MobileTab["key"], ComponentType>> = { action: ThunderboltOutlined, explore: AppstoreOutlined };

function iconFor(tab: MobileTab): ComponentType | undefined {
  if (tab.menuKey) return employeeMenu.find((e) => e.key === tab.menuKey)?.icon;
  return GENERATED_ICONS[tab.key];
}

// The phone-width bottom tab bar (Phase 5 commit G, docs/UI_REFERENCE.md
// Part 4 §4.0) — tabs from employeeMenu.config.tsx's mobileTabs.
export function MobileTabBar() {
  const { token } = theme.useToken();
  const location = useLocation();
  const navigate = useNavigate();
  const active = activeTabFor(location.pathname);
  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        display: "flex",
        background: token.colorBgContainer,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {mobileTabs.map((tab) => {
        const Icon = iconFor(tab);
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => navigate(`/app/${tab.path}`)}
            style={{
              flex: 1,
              height: MOBILE_TAB_BAR_HEIGHT,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: isActive ? token.colorPrimary : token.colorTextTertiary,
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {Icon && (
              <span style={{ fontSize: 20, lineHeight: 1 }}>
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
