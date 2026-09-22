import { Card, Typography } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

interface PlaceholderPageProps {
  title: string;
  phase?: string;
  description?: string;
}

// Generic stand-in for every menu item that doesn't have a real mock-up
// yet. Driven by the menu configs (routes/employeeMenu.config.tsx,
// routes/adminMenu.config.tsx) so adding/renaming a menu item never
// requires a new page file.
export function PlaceholderPage({ title, phase, description }: PlaceholderPageProps) {
  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        {title}
      </Title>
      <Text type="secondary">
        <ClockCircleOutlined style={{ marginRight: 8 }} />
        {phase ? `Coming in ${phase}` : "Coming in a later phase"}
        {description ? ` — ${description}` : ""}
      </Text>
    </Card>
  );
}
