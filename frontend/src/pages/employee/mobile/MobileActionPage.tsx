import { useNavigate } from "react-router-dom";
import { Card, Flex, Space, Typography, theme } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { quickActions } from "../../../routes/employeeMenu.config";
import { tintFor } from "./tints";
import { fs } from "../../../theme/tokens";

const { Text } = Typography;

// Mobile Action tab (Phase 5 commit G, docs/UI_REFERENCE.md Part 4 §4.1):
// the menu's quickAction pages, flattened, in menu order. Anything not built
// yet, or built over data that doesn't exist yet, is left out here (Explore
// shows it as "Coming soon").
export function MobileActionPage() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const actions = quickActions();
  return (
    <Space orientation="vertical" size={10} style={{ width: "100%" }}>
      {actions.map((a, i) => {
        const Icon = a.icon;
        const tint = tintFor(a.path, i, token);
        return (
          <Card key={a.key} size="small" hoverable onClick={() => navigate(`/app/${a.path}`)} styles={{ body: { padding: 12 } }} role="link" aria-label={a.label}>
            <Flex align="center" gap={14}>
              <span style={{ width: 44, height: 44, borderRadius: 10, background: tint.bg, color: tint.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.h2 }}>{Icon && <Icon />}</span>
              <Text style={{ flex: 1, fontSize: fs.lg }}>{a.label}</Text>
              <RightOutlined style={{ color: token.colorTextQuaternary }} />
            </Flex>
          </Card>
        );
      })}
    </Space>
  );
}
