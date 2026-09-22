import { useNavigate } from "react-router-dom";
import { Button, Space } from "antd";
import { BulbOutlined } from "@ant-design/icons";
import { useThemeMode } from "../../theme/ThemeProvider";

// Dev-only convenience so both portals are reachable before real login
// exists (Phase 1). Rendered only when import.meta.env.DEV — never ships
// in a production build.
export function DevRoleSwitcher() {
  const navigate = useNavigate();
  const { mode, toggleMode } = useThemeMode();

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        background: "#fff",
        border: "1px solid #d9d9d9",
        borderRadius: 8,
        padding: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      }}
    >
      <Space size={8}>
        <span style={{ fontSize: 11, color: "#8c8c8c" }}>DEV</span>
        <Button size="small" onClick={() => navigate("/app/home")}>
          Employee portal
        </Button>
        <Button size="small" onClick={() => navigate("/admin")}>
          Admin portal
        </Button>
        <Button size="small" icon={<BulbOutlined />} onClick={toggleMode}>
          {mode === "light" ? "Dark" : "Light"}
        </Button>
      </Space>
    </div>
  );
}
