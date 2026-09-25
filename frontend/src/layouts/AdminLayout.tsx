import { useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Breadcrumb,
  Button,
  DatePicker,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Select,
  Space,
  Typography,
  type MenuProps,
} from "antd";
import {
  AppstoreOutlined,
  CalendarOutlined,
  DownOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MenuOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { adminApps, type AdminApp } from "../routes/adminMenu.config";
import { AdminFiltersProvider, useAdminFilters } from "../context/AdminFiltersContext";
import { useAuth } from "../hooks/useAuth";

const { Header, Content, Footer } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

function currentApp(pathname: string): AdminApp {
  const rest = pathname.replace(/^\/admin\/?/, "");
  const segment = rest.split("/")[0];
  return adminApps.find((a) => a.path === segment) ?? adminApps[0]!;
}

function AppSwitcherPanel({ onSelect }: { onSelect: (app: AdminApp) => void }) {
  return (
    <div style={{ padding: 16, width: 320 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        YOUR APPS
      </Text>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        {adminApps.map((app) => {
          const Icon = app.icon;
          return (
            <div
              key={app.key}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(app)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(app)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 10,
                borderRadius: 8,
                cursor: "pointer",
              }}
              className="wellsure-app-tile"
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "#eef1ff",
                  color: "#2f6fed",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{app.label}</div>
                {app.subLabel && (
                  <div style={{ fontSize: 11, color: "#8c8c8c" }}>{app.subLabel}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const app = currentApp(location.pathname);

  const goToApp = (target: AdminApp): void => {
    navigate(`/admin/${target.path}`);
    setSwitcherOpen(false);
  };

  async function handleLogout(): Promise<void> {
    await logout();
    navigate("/login");
  }

  const settingsMenu: MenuProps["items"] = [
    { key: "security", label: "Account & Security", onClick: () => navigate("/admin/security") },
  ];

  return (
    <Header
      style={{
        background: "#fff",
        borderBottom: "1px solid #f0f0f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        height: "auto",
        lineHeight: "normal",
        paddingTop: 10,
        paddingBottom: 10,
      }}
    >
      <Space size="middle" wrap>
        <Dropdown
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
          popupRender={() => <AppSwitcherPanel onSelect={goToApp} />}
          trigger={["click"]}
        >
          <Button type="text" icon={<AppstoreOutlined style={{ fontSize: 18 }} />} />
        </Dropdown>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            background: "#2f6fed",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          W
        </div>
        {!isMobile && (
          <>
            <span
              style={{
                background: "#eef1ff",
                color: "#2f6fed",
                padding: "4px 12px",
                borderRadius: 16,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {app.label}
            </span>
            {app.menus?.map((group) => (
              <Dropdown
                key={group.key}
                menu={{
                  items: group.items.map((item) => ({ key: item.path, label: item.label })),
                  onClick: ({ key }) => navigate(`/admin/${key}`),
                }}
              >
                <a onClick={(e) => e.preventDefault()} style={{ color: "rgba(0,0,0,0.85)" }}>
                  <Space size={4}>
                    {group.label} <DownOutlined style={{ fontSize: 10 }} />
                  </Space>
                </a>
              </Dropdown>
            ))}
          </>
        )}
      </Space>

      <Space size="large">
        <SearchOutlined style={{ fontSize: 16 }} />
        <Dropdown menu={{ items: settingsMenu }}>
          <SettingOutlined style={{ fontSize: 16, cursor: "pointer" }} />
        </Dropdown>
        <Avatar size={28} icon={<UserOutlined />} />
        <LogoutOutlined style={{ fontSize: 16, cursor: "pointer" }} onClick={() => void handleLogout()} />
      </Space>
    </Header>
  );
}

function SubBar() {
  const location = useLocation();
  const { payrollMonth, setPayrollMonth, employeeFilter, setEmployeeFilter } = useAdminFilters();
  const app = currentApp(location.pathname);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        padding: "10px 20px",
        borderBottom: "1px solid #f0f0f0",
        background: "#fafbfc",
      }}
    >
      <Breadcrumb
        items={[{ title: "Home" }, { title: app.label }]}
        style={{ fontSize: 13 }}
      />
      <Space size="middle" wrap>
        <Space size={6}>
          <CalendarOutlined style={{ color: "#8c8c8c" }} />
          <Text style={{ fontSize: 12, color: "#8c8c8c" }}>Payroll Month:</Text>
          <DatePicker
            picker="month"
            value={payrollMonth}
            onChange={(v) => v && setPayrollMonth(v)}
            allowClear={false}
            size="small"
            format="MMM'YY"
          />
        </Space>
        <Space size={6}>
          <TeamOutlined style={{ color: "#8c8c8c" }} />
          <Select
            size="small"
            value={employeeFilter}
            onChange={setEmployeeFilter}
            style={{ width: 150 }}
            options={[
              { value: "all", label: "All" },
              { value: "c-10-panchsheel", label: "C-10 Panchsheel" },
              { value: "ajmer", label: "Ajmer" },
              { value: "spn-panchsheel", label: "SPN-Panchsheel" },
              { value: "b-22-panchsheel", label: "B-22 Panchsheel" },
            ]}
          />
        </Space>
        <HistoryOutlined style={{ fontSize: 16, color: "#8c8c8c" }} />
      </Space>
    </div>
  );
}

function AdminLayoutInner() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const app = currentApp(location.pathname);

  const menuItems = useMemo<MenuProps["items"]>(() => {
    if (!app.menus) return [];
    return app.menus.map((group) => ({
      key: group.key,
      label: group.label,
      children: group.items.map((item) => ({ key: item.path, label: item.label })),
    }));
  }, [app]);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {isMobile && (
        <div style={{ position: "fixed", top: 10, left: 8, zIndex: 20 }}>
          <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />
        </div>
      )}
      <TopBar />
      <SubBar />

      {isMobile && (
        <Drawer title={app.label} open={drawerOpen} onClose={() => setDrawerOpen(false)} placement="left">
          <div style={{ marginBottom: 16 }}>
            <AppSwitcherPanel
              onSelect={(target) => {
                navigate(`/admin/${target.path}`);
                setDrawerOpen(false);
              }}
            />
          </div>
          {menuItems && menuItems.length > 0 && (
            <Space orientation="vertical" style={{ width: "100%" }}>
              {app.menus?.map((group) => (
                <div key={group.key}>
                  <Text strong>{group.label}</Text>
                  <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
                    {group.items.map((item) => (
                      <a
                        key={item.path}
                        onClick={() => {
                          navigate(`/admin/${item.path}`);
                          setDrawerOpen(false);
                        }}
                        style={{ padding: "6px 0" }}
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </Space>
          )}
        </Drawer>
      )}

      <Content style={{ padding: isMobile ? 12 : 24 }}>
        <Outlet />
      </Content>

      <Footer style={{ textAlign: "center", color: "#8c8c8c", fontSize: 12 }}>
        Wellsure HR Portal v0.1.0 &nbsp;|&nbsp; <a href="#privacy">Privacy Policy</a> &nbsp;|&nbsp;{" "}
        <a href="#terms">Terms Of Service</a>
      </Footer>
    </Layout>
  );
}

export function AdminLayout() {
  return (
    <AdminFiltersProvider>
      <AdminLayoutInner />
    </AdminFiltersProvider>
  );
}
