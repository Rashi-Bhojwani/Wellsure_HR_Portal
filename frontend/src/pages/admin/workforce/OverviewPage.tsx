import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Row, Col, Space, Typography, Button } from "antd";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis } from "recharts";
import * as leaveApi from "../../../api/leave";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { ChartCard } from "../../../components/charts/ChartCard";
import { EmptyState } from "../../../components/common/EmptyState";
import { useThemeMode } from "../../../theme/ThemeProvider";
import { useChartColors } from "../../../theme/chartPalette";
import { fs } from "../../../theme/tokens";

const { Text } = Typography;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Workforce Overview (docs/UI_REFERENCE.md §2.3) — real data from
// GET /api/leave/dashboard (leave.view; company-wide for ALL scope, the
// viewer's team otherwise — E1.1). One fetch per selected
// year drives both the month-strip donut and the two "Category: All"
// filters client-side, since the whole year's (month, leaveTypeCode)
// matrix is small enough to slice locally without extra round trips.
export function WorkforceOverviewPage() {
  const year = new Date().getFullYear();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [pieFilter, setPieFilter] = useState("All");
  const [barFilter, setBarFilter] = useState("All");
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);

  const { data } = useQuery({ queryKey: ["leave", "dashboard", year], queryFn: () => leaveApi.getWorkforceDashboard(year) });
  const leaveTypes = useMemo(() => data?.leaveTypes ?? [], [data]);
  const byMonthAndType = useMemo(() => data?.byMonthAndType ?? [], [data]);
  const rhBreakdown = data?.rhBreakdown ?? [];

  const leaveTypeBreakdown = useMemo(() => {
    const types = pieFilter === "All" ? leaveTypes : [pieFilter];
    return types.map((type) => ({
      type,
      value: byMonthAndType.filter((e) => e.month === selectedMonth + 1 && e.leaveTypeCode === type).reduce((sum, e) => sum + e.days, 0),
    }));
  }, [leaveTypes, byMonthAndType, selectedMonth, pieFilter]);
  const total = leaveTypeBreakdown.reduce((sum, l) => sum + l.value, 0);

  const monthlyLeaves = useMemo(() => {
    const types = barFilter === "All" ? leaveTypes : [barFilter];
    return MONTHS.map((m, i) => ({
      month: m,
      total: byMonthAndType.filter((e) => e.month === i + 1 && types.includes(e.leaveTypeCode)).reduce((sum, e) => sum + e.days, 0),
    }));
  }, [leaveTypes, byMonthAndType, barFilter]);

  const typeFilterOptions = ["All", ...leaveTypes];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <HelpStrip storageKey="workforce-overview">
        This page summarises leave usage patterns across the organisation for the selected month.
      </HelpStrip>
      {data?.scope === "team" && <Alert type="info" showIcon title="Showing your team only — you and the people who report to you." />}

      <Row justify="end">
        <Text type="secondary">Jan {year} - Dec {year}</Text>
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
        {MONTHS[selectedMonth]} {year}
      </Typography.Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <ChartCard
            title="Type of leaves taken"
            filter={{ value: pieFilter, options: typeFilterOptions, onChange: setPieFilter }}
          >
            {total === 0 ? (
              <EmptyState message="No leave taken this month" />
            ) : (
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
                  <Text strong style={{ fontSize: fs.xl }}>
                    {total}
                  </Text>
                  <div style={{ fontSize: fs.xs, color: colors.ink.muted }}>Leaves taken</div>
                </div>
              </div>
            )}
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <ChartCard
            title="Total leaves taken this year"
            filter={{ value: barFilter, options: typeFilterOptions, onChange: setBarFilter }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyLeaves} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={colors.ink.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: fs.xs, fill: colors.ink.muted }} />
                <YAxis tick={{ fontSize: fs.xs, fill: colors.ink.muted }} width={28} />
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
            {rhBreakdown.length === 0 ? (
              <EmptyState message="No records found" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rhBreakdown} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={colors.ink.grid} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: fs.xs, fill: colors.ink.muted }} />
                  <YAxis tick={{ fontSize: fs.xs, fill: colors.ink.muted }} width={28} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="employeeCount" name="Employees" fill={colors.sequential} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Col>
      </Row>
    </Space>
  );
}
