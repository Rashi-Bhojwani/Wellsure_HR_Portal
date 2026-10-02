import { useMemo, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Typography,
} from "antd";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  AuditOutlined,
  BankOutlined,
  CalendarOutlined,
  CloseOutlined,
  DollarOutlined,
  FileTextOutlined,
  HomeOutlined,
  LinkOutlined,
  PlusOutlined,
  SettingOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { useThemeMode } from "../../../theme/ThemeProvider";
import { useChartColors } from "../../../theme/chartPalette";
import { ChartCard } from "../../../components/charts/ChartCard";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAuth } from "../../../hooks/useAuth";
import * as adminHomeApi from "../../../api/adminHome";
import * as announcementsApi from "../../../api/announcements";
import type { DashboardWidgetKey, WidgetLayoutEntry } from "../../../api/adminHome";

const { Title, Text } = Typography;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

// Fixed icon set for My Favourites shortcut tiles — UserFavourite.icon
// stores one of these keys, never a free-form icon name.
const FAVOURITE_ICONS: Record<string, ComponentType> = {
  useradd: UserAddOutlined,
  team: TeamOutlined,
  calendar: CalendarOutlined,
  file: FileTextOutlined,
  dollar: DollarOutlined,
  setting: SettingOutlined,
  audit: AuditOutlined,
  home: HomeOutlined,
  trophy: TrophyOutlined,
  bank: BankOutlined,
};

const WIDGET_LABELS: Record<DashboardWidgetKey, string> = {
  yearsInService: "Years In Service Distribution",
  additionsAttrition: "Additions & Attrition",
  headcountByLocation: "Employee Count By Branch",
  headcountByCity: "Employee Count By City",
  ageDistribution: "Age Distribution",
  genderSplit: "Gender Split",
  departmentHeadcount: "Department Headcount",
};

function AddFavouriteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ label: string; path: string; icon: string }>();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: adminHomeApi.createFavourite,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "favourites"] });
      form.resetFields();
      onClose();
    },
  });

  return (
    <Modal
      title="Add Shortcut"
      open={open}
      onCancel={onClose}
      onOk={() => form.validateFields().then((values) => mutation.mutate(values))}
      confirmLoading={mutation.isPending}
      okText="Add"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="label" label="Label" rules={[{ required: true, max: 60 }]}>
          <Input placeholder="Add Employee" />
        </Form.Item>
        <Form.Item name="path" label="Link" rules={[{ required: true, max: 200 }]}>
          <Input placeholder="/admin/employee/add" />
        </Form.Item>
        <Form.Item name="icon" label="Icon" rules={[{ required: true }]}>
          <Select
            options={Object.keys(FAVOURITE_ICONS).map((key) => ({ value: key, label: key }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function WelcomeTab() {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const canManageAnnouncements = hasPermission("announcements.manage");

  const { data: favourites = [] } = useQuery({
    queryKey: ["admin", "favourites"],
    queryFn: adminHomeApi.listFavourites,
  });

  const deleteFavourite = useMutation({
    mutationFn: adminHomeApi.deleteFavourite,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "favourites"] }),
  });

  const { data: taskCounts } = useQuery({
    queryKey: ["admin", "tasks", "counts"],
    queryFn: adminHomeApi.getTaskCounts,
  });

  const { data: allAnnouncements } = useQuery({
    queryKey: ["announcements", "all"],
    queryFn: announcementsApi.listAnnouncements,
    enabled: canManageAnnouncements,
  });
  const { data: activeAnnouncement } = useQuery({
    queryKey: ["announcements", "active"],
    queryFn: announcementsApi.getActiveAnnouncement,
    enabled: !canManageAnnouncements,
  });
  const latestUpdates = canManageAnnouncements
    ? (allAnnouncements ?? []).slice(0, 5)
    : activeAnnouncement
      ? [activeAnnouncement]
      : [];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Title level={3} style={{ marginBottom: 4 }}>
          {greeting()}, {user?.fullName?.split(" ")[0] ?? ""}
        </Title>
        <Text type="secondary">Here&apos;s what needs your attention today.</Text>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Card title="My Favourites">
              <Row gutter={[12, 12]}>
                {favourites.map((f) => {
                  const Icon = FAVOURITE_ICONS[f.icon] ?? LinkOutlined;
                  return (
                    <Col key={f.id}>
                      <div style={{ position: "relative" }}>
                        <Card
                          size="small"
                          hoverable
                          style={{ width: 120, textAlign: "center" }}
                          onClick={() => navigate(f.path)}
                        >
                          <Icon style={{ fontSize: 20, color: "#2a78d6" }} />
                          <div style={{ fontSize: 12, marginTop: 6 }}>{f.label}</div>
                        </Card>
                        <Popconfirm title="Remove this shortcut?" onConfirm={() => deleteFavourite.mutate(f.id)}>
                          <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined style={{ fontSize: 10 }} />}
                            style={{ position: "absolute", top: -6, right: -6, background: "#fff", borderRadius: "50%", boxShadow: "0 0 0 1px #f0f0f0" }}
                          />
                        </Popconfirm>
                      </div>
                    </Col>
                  );
                })}
                <Col>
                  <Card
                    size="small"
                    hoverable
                    style={{ width: 120, textAlign: "center", borderStyle: "dashed" }}
                    onClick={() => setAddOpen(true)}
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
                  <Statistic title="Things to review" value={taskCounts?.review.total ?? 0} />
                </Col>
                <Col span={8}>
                  <Statistic title="Things to monitor" value={taskCounts?.monitor.total ?? 0} />
                </Col>
              </Row>
              {taskCounts && (taskCounts.review.total > 0 || taskCounts.monitor.total > 0) ? (
                <List
                  style={{ marginTop: 16 }}
                  dataSource={[
                    ...taskCounts.review.byType
                      .filter((t) => t.count > 0)
                      .map((t) => ({ ...t, note: "pending your review", action: "Review", to: "/app/todo/review" })),
                    ...taskCounts.monitor.byType
                      .filter((t) => t.count > 0)
                      .map((t) => ({ ...t, note: "pending for others' review", action: "Monitor", to: "/admin/workforce/leave/employee-leave" })),
                  ]}
                  renderItem={(t) => (
                    <List.Item actions={[<a key={t.action} onClick={() => navigate(t.to)}>{t.action}</a>]}>
                      <List.Item.Meta title={t.label} description={`${t.count} ${t.note}`} />
                    </List.Item>
                  )}
                />
              ) : (
                <EmptyState message="Nothing to review or monitor" compact />
              )}
            </Card>
          </Space>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Latest Updates">
            {latestUpdates.length > 0 ? (
              <List
                dataSource={latestUpdates}
                renderItem={(u) => (
                  <List.Item>
                    <List.Item.Meta
                      title={u.title}
                      description={<Text type="secondary" style={{ fontSize: 12 }}>{u.activeFrom}</Text>}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <EmptyState message="No updates yet" compact />
            )}
          </Card>
        </Col>
      </Row>

      <AddFavouriteModal open={addOpen} onClose={() => setAddOpen(false)} />
    </Space>
  );
}

function BucketLineChart({ data }: { data: { bucket: string; count: number }[] }) {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={colors.ink.grid} vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: colors.ink.muted }} />
        <YAxis tick={{ fontSize: 11, fill: colors.ink.muted }} width={28} />
        <Tooltip />
        <Line type="monotone" dataKey="count" name="Employees" stroke={colors.sequential} strokeWidth={2} dot={{ r: 3 }}>
          <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: colors.ink.secondary }} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

function NamedBarChart({ data }: { data: { name: string; count: number }[] }) {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={colors.ink.grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: colors.ink.muted }} />
        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: colors.ink.muted }} />
        <Tooltip />
        <Bar dataKey="count" name="Employees" fill={colors.sequential} radius={[0, 4, 4, 0]} barSize={16}>
          <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: colors.ink.secondary }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GenderSplitChart({ data }: { data: { gender: string; count: number }[] }) {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="gender" innerRadius="50%" outerRadius="80%" paddingAngle={2} isAnimationActive={false}>
          {data.map((entry, i) => (
            <Cell key={entry.gender} fill={colors.categorical[i % colors.categorical.length]} />
          ))}
        </Pie>
        <Legend />
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

function EditLayoutModal({ open, onClose, layout }: { open: boolean; onClose: () => void; layout: WidgetLayoutEntry[] }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<WidgetLayoutEntry[]>(layout);

  const mutation = useMutation({
    mutationFn: adminHomeApi.saveLayout,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-layout"] });
      onClose();
    },
  });

  function move(index: number, delta: number): void {
    const next = [...draft];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setDraft(next);
  }

  function toggle(index: number): void {
    const next = [...draft];
    next[index] = { ...next[index]!, visible: !next[index]!.visible };
    setDraft(next);
  }

  return (
    <Modal
      title="Edit Dashboard"
      open={open}
      onCancel={onClose}
      onOk={() => mutation.mutate(draft)}
      confirmLoading={mutation.isPending}
      okText="Save"
      afterOpenChange={(isOpen) => isOpen && setDraft(layout)}
    >
      <List
        dataSource={draft}
        renderItem={(entry, index) => (
          <List.Item
            actions={[
              <Button key="up" type="text" size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} />,
              <Button key="down" type="text" size="small" icon={<ArrowDownOutlined />} disabled={index === draft.length - 1} onClick={() => move(index, 1)} />,
              <Switch key="visible" checked={entry.visible} onChange={() => toggle(index)} />,
            ]}
          >
            {WIDGET_LABELS[entry.key]}
          </List.Item>
        )}
      />
    </Modal>
  );
}

function DashboardTab() {
  const [editOpen, setEditOpen] = useState(false);
  const { data: widgets, isLoading } = useQuery({
    queryKey: ["admin", "dashboard", "widgets"],
    queryFn: adminHomeApi.getDashboardWidgets,
  });
  const { data: layout } = useQuery({
    queryKey: ["admin", "dashboard-layout"],
    queryFn: adminHomeApi.getLayout,
  });

  const orderedVisible = useMemo(() => (layout ?? []).filter((entry) => entry.visible), [layout]);

  if (isLoading || !widgets || !layout) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  function renderWidget(key: DashboardWidgetKey) {
    switch (key) {
      case "yearsInService":
        return (
          <ChartCard title={WIDGET_LABELS.yearsInService}>
            <BucketLineChart data={widgets!.yearsInService} />
          </ChartCard>
        );
      case "ageDistribution":
        return (
          <ChartCard title={WIDGET_LABELS.ageDistribution}>
            <BucketLineChart data={widgets!.ageDistribution} />
          </ChartCard>
        );
      case "additionsAttrition":
        return (
          <ChartCard title={WIDGET_LABELS.additionsAttrition}>
            <AdditionsAttritionChart data={widgets!.additionsAttrition} />
          </ChartCard>
        );
      case "headcountByLocation":
        return (
          <ChartCard title={WIDGET_LABELS.headcountByLocation}>
            <NamedBarChart data={widgets!.headcountByLocation} />
          </ChartCard>
        );
      case "headcountByCity":
        return (
          <ChartCard title={WIDGET_LABELS.headcountByCity}>
            <NamedBarChart data={widgets!.headcountByCity} />
          </ChartCard>
        );
      case "departmentHeadcount":
        return (
          <ChartCard title={WIDGET_LABELS.departmentHeadcount}>
            <NamedBarChart data={widgets!.departmentHeadcount} />
          </ChartCard>
        );
      case "genderSplit":
        return (
          <ChartCard title={WIDGET_LABELS.genderSplit}>
            <GenderSplitChart data={widgets!.genderSplit} />
          </ChartCard>
        );
      default:
        return null;
    }
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Row justify="end">
        <Button onClick={() => setEditOpen(true)}>Edit</Button>
      </Row>
      {widgets.scope === "team" && <Alert type="info" showIcon title="Showing your team only — you and the people who report to you." />}
      {orderedVisible.length === 0 ? (
        <EmptyState message="No widgets are visible — use Edit to show some." />
      ) : (
        <Row gutter={[16, 16]}>
          {orderedVisible.map((entry) => (
            <Col key={entry.key} xs={24} xl={12}>
              {renderWidget(entry.key)}
            </Col>
          ))}
        </Row>
      )}
      <EditLayoutModal open={editOpen} onClose={() => setEditOpen(false)} layout={layout} />
    </Space>
  );
}

function AdditionsAttritionChart({ data }: { data: { month: string; joined: number; resigned: number }[] }) {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={colors.ink.grid} vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: colors.ink.muted }} />
        <YAxis tick={{ fontSize: 11, fill: colors.ink.muted }} width={28} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="joined" name="Joined" stroke={colors.positive} strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="resigned" name="Resigned" stroke={colors.negative} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
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
