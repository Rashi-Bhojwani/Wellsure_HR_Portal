import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Col, List, Row, Segmented, Space, Statistic, Typography } from "antd";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";
import { PlusOutlined, UserAddOutlined } from "@ant-design/icons";
import { useThemeMode } from "../../../theme/ThemeProvider";
import { useChartColors } from "../../../theme/chartPalette";
import { ChartCard } from "../../../components/charts/ChartCard";

const { Title, Text } = Typography;

const yearsInService = [
  { bucket: "<1", count: 82 },
  { bucket: "1-2", count: 23 },
  { bucket: "2-3", count: 18 },
  { bucket: "3-4", count: 7 },
  { bucket: "4-5", count: 9 },
  { bucket: "5-6", count: 6 },
  { bucket: "6-7", count: 4 },
  { bucket: "7-8", count: 3 },
  { bucket: "9-10", count: 3 },
  { bucket: ">10", count: 2 },
];

const additionsAttrition = [
  { month: "Oct'25", joined: 4, resigned: 2 },
  { month: "Nov'25", joined: 6, resigned: 1 },
  { month: "Dec'25", joined: 3, resigned: 3 },
  { month: "Jan'26", joined: 8, resigned: 2 },
  { month: "Feb'26", joined: 5, resigned: 4 },
  { month: "Mar'26", joined: 7, resigned: 1 },
  { month: "Apr'26", joined: 4, resigned: 2 },
  { month: "May'26", joined: 6, resigned: 3 },
  { month: "Jun'26", joined: 9, resigned: 2 },
  { month: "Jul'26", joined: 5, resigned: 1 },
  { month: "Aug'26", joined: 7, resigned: 3 },
  { month: "Sep'26", joined: 6, resigned: 2 },
];

const locationCounts = [
  { location: "B-22 Panchsheel", count: 1 },
  { location: "B-22 Panchsheel ", count: 18 },
  { location: "SPN-Panchsheel", count: 27 },
  { location: "Ajmer", count: 45 },
  { location: "C-10 Panchsheel", count: 60 },
];

const ageDistribution = [
  { bucket: "<20", count: 2 },
  { bucket: "20-25", count: 34 },
  { bucket: "25-30", count: 58 },
  { bucket: "30-35", count: 41 },
  { bucket: "35-40", count: 19 },
  { bucket: ">50", count: 5 },
];

const myTasks = [
  { type: "Attendance Regularization", count: 182, note: "tasks pending for others' review" },
  { type: "Leave", count: 50, note: "tasks pending for others' review" },
];

const latestUpdates = [
  { date: "18 Sep 2026", title: "Diwali holiday calendar published for all locations" },
  { date: "10 Sep 2026", title: "New employee handbook available in Document Center" },
  { date: "02 Sep 2026", title: "Q3 town hall recording posted to Engage" },
];

function WelcomeTab() {
  const navigate = useNavigate();

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Title level={3} style={{ marginBottom: 4 }}>
          Good Afternoon,
        </Title>
        <Text type="secondary">Here&apos;s what needs your attention today.</Text>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Card title="My Favourites">
              <Row gutter={[12, 12]}>
                <Col>
                  <Card
                    size="small"
                    hoverable
                    style={{ width: 120, textAlign: "center" }}
                    onClick={() => navigate("/admin/employee/add")}
                  >
                    <UserAddOutlined style={{ fontSize: 20, color: "#2a78d6" }} />
                    <div style={{ fontSize: 12, marginTop: 6 }}>Add Employee</div>
                  </Card>
                </Col>
                <Col>
                  <Card
                    size="small"
                    hoverable
                    style={{ width: 120, textAlign: "center", borderStyle: "dashed" }}
                  >
                    <PlusOutlined style={{ fontSize: 20, color: "#8c8c8c" }} />
                    <div style={{ fontSize: 12, marginTop: 6 }}>Add Shortcut</div>
                  </Card>
                </Col>
              </Row>
            </Card>

            <Card title="My Tasks">
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title="Things to review" value={0} />
                </Col>
                <Col span={8}>
                  <Statistic title="Things to monitor" value={232} />
                </Col>
              </Row>
              <List
                style={{ marginTop: 16 }}
                dataSource={myTasks}
                renderItem={(t) => (
                  <List.Item actions={[<a key="monitor">Monitor</a>]}>
                    <List.Item.Meta
                      title={t.type}
                      description={`${t.count} ${t.note}`}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Space>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Latest Updates">
            <List
              dataSource={latestUpdates}
              renderItem={(u) => (
                <List.Item>
                  <List.Item.Meta
                    title={u.title}
                    description={<Text type="secondary" style={{ fontSize: 12 }}>{u.date}</Text>}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        <Space wrap>
          <Button shape="round">Help Center</Button>
          <Button shape="round">Company Policies</Button>
          <Button shape="round">Contact HR</Button>
        </Space>
      </Card>
    </Space>
  );
}

function DashboardTab() {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Row justify="end">
        <Button>Edit</Button>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <ChartCard title="Years In Service Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearsInService} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={colors.ink.grid} vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: colors.ink.muted }} />
                <YAxis tick={{ fontSize: 11, fill: colors.ink.muted }} width={28} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="Employees"
                  stroke={colors.sequential}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                >
                  <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: colors.ink.secondary }} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>

        <Col xs={24} xl={12}>
          <ChartCard title="Additions & Attrition" subtitle="October-2025 to September-2026">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={additionsAttrition} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={colors.ink.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: colors.ink.muted }} />
                <YAxis tick={{ fontSize: 11, fill: colors.ink.muted }} width={28} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="joined" name="Joined" stroke={colors.positive} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="resigned" name="Resigned" stroke={colors.negative} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>

        <Col xs={24} xl={12}>
          <ChartCard title="Employee Count By Location">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={locationCounts} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={colors.ink.grid} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: colors.ink.muted }} />
                <YAxis
                  type="category"
                  dataKey="location"
                  width={110}
                  tick={{ fontSize: 10, fill: colors.ink.muted }}
                />
                <Tooltip />
                <Bar dataKey="count" name="Employees" fill={colors.sequential} radius={[0, 4, 4, 0]} barSize={16}>
                  <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: colors.ink.secondary }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>

        <Col xs={24} xl={12}>
          <ChartCard title="Age Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ageDistribution} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={colors.ink.grid} vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: colors.ink.muted }} />
                <YAxis tick={{ fontSize: 11, fill: colors.ink.muted }} width={28} />
                <Tooltip />
                <Line type="monotone" dataKey="count" name="Employees" stroke={colors.sequential} strokeWidth={2} dot={{ r: 3 }}>
                  <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: colors.ink.secondary }} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>
      </Row>
    </Space>
  );
}

export function AdminHomePage() {
  const [tab, setTab] = useState<string | number>("Welcome");

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Row justify="center">
        <Segmented options={["Welcome", "Dashboard"]} value={tab} onChange={setTab} size="large" />
      </Row>
      {tab === "Welcome" ? <WelcomeTab /> : <DashboardTab />}
    </Space>
  );
}
