import { useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Space,
  Typography,
  type MenuProps,
} from "antd";
import {
  BellOutlined,
  DownOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { employeeMenu, isEmployeeMenuGroup } from "../routes/employeeMenu.config";

const { Sider, Header, Content, Footer } = Layout;
const { Text, Title } = Typography;
const { useBreakpoint } = Grid;

function buildMenuItems(): MenuProps["items"] {
  return employeeMenu.map((entry) => {
    const Icon = entry.icon;
    if (isEmployeeMenuGroup(entry)) {
      return {
        key: entry.key,
        icon: Icon ? <Icon /> : undefined,
        label: entry.label,
        children: entry.children.map((child) => {
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

function findLabel(path: string): string {
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
  const currentKey = location.pathname.replace(/^\/app\//, "");
  const items = useMemo(() => buildMenuItems(), []);

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
          <Text strong>Hi Aditi</Text>
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
        <SettingOutlined style={{ color: "#8c8c8c" }} />
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const pageTitle = findLabel(location.pathname.replace(/^\/app\//, ""));

  const quickLinksMenu: MenuProps["items"] = [
    { key: "policies", label: "Company Policies" },
    { key: "org-chart", label: "Org Chart" },
    { key: "helpdesk", label: "Raise a Helpdesk Ticket" },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && (
        <Sider width={220} theme="light" style={{ borderInlineEnd: "1px solid #f0f0f0" }}>
          <SidebarContent />
        </Sider>
      )}
      {isMobile && (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          size={260}
          styles={{ body: { padding: 0 } }}
        >
          <SidebarContent onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      )}

      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
          }}
        >
          <Space>
            {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />}
            <span style={{ width: 8, height: 20, background: "#2f6fed", borderRadius: 4, display: "inline-block" }} />
            <Title level={4} style={{ margin: 0 }}>
              {pageTitle}
            </Title>
          </Space>
          <Space size="large">
            <Dropdown menu={{ items: quickLinksMenu }}>
              <a onClick={(e) => e.preventDefault()}>
                <Space size={4}>
                  Quick Links <DownOutlined style={{ fontSize: 10 }} />
                </Space>
              </a>
            </Dropdown>
            <Badge dot>
              <BellOutlined style={{ fontSize: 18 }} />
            </Badge>
            <LogoutOutlined style={{ fontSize: 18, cursor: "pointer" }} onClick={() => navigate("/login")} />
          </Space>
        </Header>

        <Content style={{ padding: isMobile ? 12 : 24 }}>
          <Outlet />
        </Content>

        <Footer style={{ textAlign: "center", color: "#8c8c8c", fontSize: 12 }}>
          Wellsure HR Portal v0.1.0 &nbsp;|&nbsp; <a href="#privacy">Privacy Policy</a> &nbsp;|&nbsp;{" "}
          <a href="#terms">Terms Of Service</a>
        </Footer>
      </Layout>
    </Layout>
  );
}
