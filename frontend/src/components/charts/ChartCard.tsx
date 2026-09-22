import { Card, Select, Space, Typography } from "antd";
import type { ReactNode } from "react";

const { Text } = Typography;

interface ChartCardProps {
  title: string;
  subtitle?: string;
  filter?: { value: string; options: string[]; onChange?: (value: string) => void };
  height?: number;
  children: ReactNode;
}

// Card wrapper for the Admin Dashboard 2x2 widget grid and the Workforce
// Management Overview charts (docs/UI_REFERENCE.md §2.2, §2.3): bold blue
// title, optional "Category: All ▾" filter top-right.
export function ChartCard({ title, subtitle, filter, height = 280, children }: ChartCardProps) {
  return (
    <Card
      title={
        <Space orientation="vertical" size={0}>
          <Text strong style={{ color: "#2f6fed" }}>
            {title}
          </Text>
          {subtitle && (
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              {subtitle}
            </Text>
          )}
        </Space>
      }
      extra={
        filter && (
          <Select
            size="small"
            value={filter.value}
            style={{ width: 140 }}
            onChange={filter.onChange}
            options={filter.options.map((o) => ({ value: o, label: o }))}
          />
        )
      }
      style={{ height: "100%" }}
    >
      <div style={{ width: "100%", height }}>{children}</div>
    </Card>
  );
}
