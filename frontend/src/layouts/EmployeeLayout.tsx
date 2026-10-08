import { useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Space,
  Typography,
  type MenuProps,
} from "antd";
import {
  DownOutlined,
  LogoutOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { canSeeLeaf, employeeMenu, isEmployeeMenuGroup } from "../routes/employeeMenu.config";
import { useAuth } from "../hooks/useAuth";
import { NotificationBell } from "../components/common/NotificationBell";
import { MobileTabBar } from "../components/mobile/MobileTabBar";
import { InstallAppBanner } from "../components/mobile/InstallAppBanner";
import { MOBILE_TAB_BAR_HEIGHT } from "../lib/mobileNav";

const { Sider, Header, Content, Footer } = Layout;
const { Text, Title } = Typography;
const { useBreakpoint } = Grid;

function buildMenuItems(hasPermission: (key: string) => boolean): MenuProps["items"] {
  return employeeMenu.map((entry) => {
    const Icon = entry.icon;
    if (isEmployeeMenuGroup(entry)) {
      return {
        key: entry.key,
        icon: Icon ? <Icon /> : undefined,
        label: entry.label,
        children: entry.children.filter((child) => canSeeLeaf(child, hasPermission)).map((child) => {
          const ChildIcon = child.icon;
          return {
            key: child.path,
            icon: ChildIcon ? <ChildIcon /> : undefined,
            label: child.label,
          };
        }),
      };
    }
    return { key: entry.path, icon: Icon ? <Icon /> : undefined, label: entry.label };
  });
}

// A detail page (e.g. helpdesk/<ticket id>) belongs to its menu entry: the
// longest menu path the current path sits under.
function menuPathFor(path: string): string {
  const paths = employeeMenu.flatMap((entry) => (isEmployeeMenuGroup(entry) ? entry.children.map((c) => c.path) : [entry.path]));
  if (paths.includes(path)) return path;
  return paths.filter((p) => path.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0] ?? path;
}

function findLabel(rawPath: string): string {
  const path = menuPathFor(rawPath);
  for (const entry of employeeMenu) {
    if (isEmployeeMenuGroup(entry)) {
      const child = entry.children.find((c) => c.path === path);
      if (child) return child.label;
    } else if (entry.path === path) {
      return entry.label;
    }
  }
  return "Wellsure HR";
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission } = useAuth();
  const currentKey = menuPathFor(location.pathname.replace(/^\/app\//, ""));
  const items = useMemo(() => buildMenuItems(hasPermission), [hasPermission]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "20px 16px 12px" }}>
        {/* Logo placeholder — replace with the real Wellsure logo */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "#2f6fed",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
          }}
        >
          W
        </div>
      </div>
      <div style={{ padding: "0 16px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar size={40} icon={<UserOutlined />} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong>Hi {user?.fullName?.split(" ")[0] ?? ""}</Text>
          <br />
          <a
            onClick={() => {
              navigate("/app/profile");
              onNavigate?.();
            }}
            style={{ fontSize: 12 }}
          >
            View My Info
          </a>
        </div>
        <SettingOutlined
          style={{ color: "#8c8c8c", cursor: "pointer" }}
          onClick={() => {
            navigate("/app/security");
            onNavigate?.();
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <Menu
          mode="inline"
          items={items}
          selectedKeys={[currentKey]}
          defaultOpenKeys={employeeMenu.filter(isEmployeeMenuGroup).map((g) => g.key)}
          style={{ borderInlineEnd: "none" }}
          onClick={({ key }) => {
            navigate(`/app/${key}`);
            onNavigate?.();
          }}
        />
      </div>
    </div>
  );
}

export function EmployeeLayout() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate("/login");
  }

  const relPath = location.pathname.replace(/^\/app\//, "");
  // The phone tab pages aren't menu entries; their header title is the tab's.
  const pageTitle = relPath === "action" ? "Actions" : relPath === "explore" ? "Explore" : findLabel(relPath);

  const quickLinks: Partial<Record<string, string>> = {
    policies: "/app/document-center",
    "org-chart": "/app/people?tab=org-chart",
    helpdesk: "/app/helpdesk?raise=1",
  };
  const quickLinksMenu: MenuProps = {
    items: [
      { key: "policies", label: "Company Policies" },
      { key: "org-chart", label: "Org Chart" },
      { key: "helpdesk", label: "Raise a Helpdesk Ticket" },
    ],
    onClick: ({ key }) => {
      if (quickLinks[key]) navigate(quickLinks[key]);
    },
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && (
        <Sider width={220} theme="light" style={{ borderInlineEnd: "1px solid #f0f0f0" }}>
          <SidebarContent />
        </Sider>
      )}
      {/* Phones: no sidebar and no drawer — the bottom tab bar (Home, Action,
          Explore, Engage) generated from employeeMenu.config.tsx replaces
          them (Phase 5 commit G, docs/UI_REFERENCE.md Part 4). */}
      {isMobile && <MobileTabBar />}

      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isMobile ? "0 12px" : "0 20px",
            position: isMobile ? "sticky" : undefined,
            top: 0,
            zIndex: 99,
          }}
        >
          <Space>
            <span style={{ width: 8, height: 20, background: "#2f6fed", borderRadius: 4, display: "inline-block" }} />
            <Title level={4} style={{ margin: 0 }}>
              {pageTitle}
            </Title>
          </Space>
          <Space size="large">
            {!isMobile && (
            <Dropdown menu={quickLinksMenu}>
              <a onClick={(e) => e.preventDefault()}>
                <Space size={4}>
                  Quick Links <DownOutlined style={{ fontSize: 10 }} />
                </Space>
              </a>
            </Dropdown>
            )}
            <NotificationBell homePath="/app/home" />
            <LogoutOutlined style={{ fontSize: 18, cursor: "pointer" }} onClick={() => void handleLogout()} />
          </Space>
        </Header>

        <Content style={{ padding: isMobile ? 12 : 24, paddingBottom: isMobile ? `calc(${MOBILE_TAB_BAR_HEIGHT + 16}px + env(safe-area-inset-bottom))` : 24 }}>
          {isMobile && <InstallAppBanner />}
          <Outlet />
        </Content>

        {!isMobile && (
          <Footer style={{ textAlign: "center", color: "#8c8c8c", fontSize: 12 }}>
            {/* No Privacy Policy / Terms links until those pages exist (the §9
                privacy notice is its own item) — dead links read as broken. */}
            Wellsure HR Portal v0.1.0
          </Footer>
        )}
      </Layout>
    </Layout>
  );
}
