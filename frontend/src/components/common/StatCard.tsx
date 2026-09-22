import { Card, Typography, Space } from "antd";
import type { ReactNode } from "react";

const { Text, Title } = Typography;

interface StatCardProps {
  label: string;
  value: ReactNode;
  trend?: { text: string; positive?: boolean };
  extra?: ReactNode;
}

// Used by the Attendance Info stats row (AVG. WORK HRS, PENALTY DAYS, ...)
// and reusable anywhere else a single big number needs a label. See
// docs/UI_REFERENCE.md §1.5.
export function StatCard({ label, value, trend, extra }: StatCardProps) {
  return (
    <Card size="small" style={{ height: "100%" }}>
      <Space orientation="vertical" size={4} style={{ width: "100%" }}>
        <Text type="secondary" style={{ fontSize: 12, textTransform: "uppercase" }}>
          {label}
        </Text>
        <Title level={3} style={{ margin: 0 }}>
          {value}
        </Title>
        {trend && (
          <Text style={{ fontSize: 12 }} type={trend.positive ? "success" : "danger"}>
            {trend.text}
          </Text>
        )}
        {extra}
      </Space>
    </Card>
  );
}
