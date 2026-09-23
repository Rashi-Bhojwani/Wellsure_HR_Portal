import { useState } from "react";
import { Row, Col, Space, Typography, Button } from "antd";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis } from "recharts";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { ChartCard } from "../../../components/charts/ChartCard";
import { EmptyState } from "../../../components/common/EmptyState";
import { useThemeMode } from "../../../theme/ThemeProvider";
import { useChartColors } from "../../../theme/chartPalette";

const { Text } = Typography;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const leaveTypeBreakdown = [
  { type: "LOP", value: 7.5 },
  { type: "COF", value: 0 },
  { type: "PL", value: 18.5 },
  { type: "WFH", value: 2.5 },
  { type: "RH", value: 0 },
];

const monthlyLeaves = [
  { month: "Jan", total: 18 },
  { month: "Feb", total: 22 },
  { month: "Mar", total: 15 },
  { month: "Apr", total: 26 },
  { month: "May", total: 19 },
  { month: "Jun", total: 24 },
  { month: "Jul", total: 21 },
  { month: "Aug", total: 30 },
  { month: "Sep", total: 28.5 },
];

export function WorkforceOverviewPage() {
  const [selectedMonth, setSelectedMonth] = useState(8); // Sep, 0-indexed
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  const total = leaveTypeBreakdown.reduce((sum, l) => sum + l.value, 0);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <HelpStrip storageKey="workforce-overview">
        This page summarises leave usage patterns across the organisation for the selected month.
      </HelpStrip>

      <Row justify="end">
        <Text type="secondary">Jan 2026 - Dec 2026</Text>
      </Row>

      <Row gutter={4} wrap>
        {MONTHS.map((m, i) => (
          <Col key={m}>
            <Button
              type={i === selectedMonth ? "primary" : "default"}
              size="small"
              shape="round"
              onClick={() => setSelectedMonth(i)}
              style={{ marginBottom: 4 }}
            >
              {m}
            </Button>
          </Col>
        ))}
      </Row>

      <Typography.Title level={5} style={{ margin: 0 }}>
        {MONTHS[selectedMonth]} 2026
      </Typography.Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <ChartCard
            title="Type of leaves taken"
            filter={{ value: "All", options: ["All", "PL", "LOP", "COF", "WFH", "RH"] }}
          >
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={leaveTypeBreakdown}
                    dataKey="value"
                    nameKey="type"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                    cx="35%"
                    isAnimationActive={false}
                  >
                    {leaveTypeBreakdown.map((entry, i) => (
                      <Cell key={entry.type} fill={colors.categorical[i % colors.categorical.length]} />
                    ))}
                  </Pie>
                  <Legend layout="vertical" align="right" verticalAlign="middle" formatter={(v) => `${v}`} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div
                style={{
                  position: "absolute",
                  left: "35%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  textAlign: "center",
                  pointerEvents: "none",
                }}
              >
                <Text strong style={{ fontSize: 18 }}>
                  {total}
                </Text>
                <div style={{ fontSize: 11, color: colors.ink.muted }}>Leaves taken</div>
              </div>
            </div>
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <ChartCard
            title="Total leaves taken this year"
            filter={{ value: "All", options: ["All", "PL", "LOP", "COF", "WFH", "RH"] }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyLeaves} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={colors.ink.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: colors.ink.muted }} />
                <YAxis tick={{ fontSize: 11, fill: colors.ink.muted }} width={28} />
                <Tooltip />
                <Bar dataKey="total" name="Leaves" fill={colors.sequential} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <ChartCard
            title="Employees on Leave for each RH"
            filter={{ value: "All", options: ["All"] }}
          >
            <EmptyState message="No records found" />
          </ChartCard>
        </Col>
      </Row>
    </Space>
  );
}
