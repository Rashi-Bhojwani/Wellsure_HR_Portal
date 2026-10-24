import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Popconfirm, Segmented, Select, Switch, Tooltip } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  AuditOutlined,
  BankOutlined,
  CalendarOutlined,
  CloseOutlined,
  DollarOutlined,
  EditOutlined,
  EyeOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  HomeOutlined,
  LinkOutlined,
  PlusOutlined,
  RightOutlined,
  SettingOutlined,
  SoundOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { ChartCard } from "../../../components/charts/ChartCard";
import { ColumnChart, DonutChart, SmoothLineChart } from "../../../components/charts/chartKit";
import { useAuth } from "../../../hooks/useAuth";
import * as managersApi from "../../../api/managers";
import * as adminHomeApi from "../../../api/adminHome";
import * as announcementsApi from "../../../api/announcements";
import type { DashboardWidgetKey, DashboardWidgets, WidgetLayoutEntry } from "../../../api/adminHome";
import { DeviceWarnings } from "../../../components/devices/DeviceWarnings";
import { useThemeMode } from "../../../theme/ThemeProvider";
import { useChartColors } from "../../../theme/chartPalette";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { ApprovalBanner, EmptyState, PageHeader, Panel, QueryState, SideDrawer, Skel, Stack, StatCard, toast, useIsCompact, useIsPhone } from "../../../ui";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

const CHART_HEIGHT = 280;

function AddFavouriteDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ label: string; path: string; icon: string }>();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: adminHomeApi.createFavourite,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "favourites"] });
      form.resetFields();
      toast.success("Shortcut added");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not add this shortcut.")),
  });

  return (
    <SideDrawer open={open} onClose={onClose} title="Add Shortcut" formId="add-favourite-form" primaryLabel="Add" primaryLoading={mutation.isPending}>
      <Form id="add-favourite-form" form={form} layout="vertical" requiredMark onFinish={(values) => mutation.mutate(values)}>
        <Form.Item name="label" label="Label" rules={[{ required: true, max: 60 }]}>
          <Input placeholder="Add Employee" />
        </Form.Item>
        <Form.Item name="path" label="Link" rules={[{ required: true, max: 200 }]}>
          <Input placeholder="/admin/employee/add" />
        </Form.Item>
        <Form.Item name="icon" label="Icon" rules={[{ required: true }]}>
          <Select
            options={Object.keys(FAVOURITE_ICONS).map((key) => {
              const Icon = FAVOURITE_ICONS[key]!;
              return {
                value: key,
                label: (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                    <Icon /> {key}
                  </span>
                ),
              };
            })}
          />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

const tileStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 112,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: space[2],
  padding: space[3],
  background: v.bgSurface,
  border: `1px solid ${v.borderDefault}`,
  borderRadius: radius.md,
  cursor: "pointer",
  font: "inherit",
  color: v.textPrimary,
  textAlign: "center",
};

function FavouriteTiles() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const { data: favourites = [], isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "favourites"],
    queryFn: adminHomeApi.listFavourites,
  });
  const deleteFavourite = useMutation({
    mutationFn: adminHomeApi.deleteFavourite,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "favourites"] }),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not remove this shortcut.")),
  });

  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(120px, 100%), 1fr))", gap: space[3] };

  return (
    <Panel title="My Favourites" subtitle="Your shortcuts to the screens you use most">
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        compact
        skeleton={
          <div style={grid} aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skel key={i} h={112} r={radius.md} />
            ))}
          </div>
        }
      >
        <div style={grid}>
          {favourites.map((f) => {
            const Icon = FAVOURITE_ICONS[f.icon] ?? LinkOutlined;
            return (
              <div key={f.id} style={{ position: "relative" }}>
                <button type="button" className="ws-stat-card" style={tileStyle} onClick={() => navigate(f.path)}>
                  <span aria-hidden style={{ width: 40, height: 40, borderRadius: radius.pill, background: v.accentSubtle, color: v.accentText, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.h2 }}>
                    <Icon />
                  </span>
                  <span style={{ fontSize: fs.sm, fontWeight: fw.semibold, lineHeight: 1.3, wordBreak: "break-word" }}>{f.label}</span>
                </button>
                <Popconfirm title="Remove this shortcut?" okText="Remove" okButtonProps={{ danger: true, loading: deleteFavourite.isPending }} onConfirm={() => deleteFavourite.mutateAsync(f.id)}>
                  <Tooltip title="Remove shortcut">
                    <Button
                      type="text"
                      size="small"
                      aria-label={`Remove shortcut ${f.label}`}
                      icon={<CloseOutlined style={{ fontSize: fs.chip }} />}
                      style={{ position: "absolute", top: space[1], right: space[1], color: v.textSecondary, minWidth: 28, width: 28, height: 28 }}
                    />
                  </Tooltip>
                </Popconfirm>
              </div>
            );
          })}
          <button type="button" style={{ ...tileStyle, borderStyle: "dashed", borderColor: v.borderControl, color: v.textSecondary }} onClick={() => setAddOpen(true)}>
            <span aria-hidden style={{ width: 40, height: 40, borderRadius: radius.pill, background: v.bgSubtle, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.h2 }}>
              <PlusOutlined />
            </span>
            <span style={{ fontSize: fs.sm, fontWeight: fw.semibold }}>Add Shortcut</span>
          </button>
        </div>
      </QueryState>
      <AddFavouriteDrawer open={addOpen} onClose={() => setAddOpen(false)} />
    </Panel>
  );
}

function TaskRow({ label, count, note, action, onOpen }: { label: string; count: number; note: string; action: string; onOpen: () => void }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: space[3], padding: `${space[3]}px 0`, borderTop: `1px solid ${v.borderDefault}` }}>
      <span className="ws-num" style={{ minWidth: 36, height: 36, padding: `0 ${space[2]}px`, borderRadius: radius.sm, background: v.bgSubtle, color: v.textPrimary, fontWeight: fw.bold, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        {count}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{label}</div>
        <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{`${count} ${note}`}</div>
      </div>
      <Button type="link" onClick={onOpen} style={{ paddingInline: space[2] }}>
        {action} <RightOutlined />
      </Button>
    </li>
  );
}

function MyTasks() {
  const navigate = useNavigate();
  const { data: taskCounts, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "tasks", "counts"],
    queryFn: adminHomeApi.getTaskCounts,
  });
  const rows = taskCounts
    ? [
        ...taskCounts.review.byType.filter((t) => t.count > 0).map((t) => ({ ...t, note: "pending your review", action: "Review", to: "/app/todo/review" })),
        ...taskCounts.monitor.byType.filter((t) => t.count > 0).map((t) => ({ ...t, note: "pending for others' review", action: "Monitor", to: "/admin/workforce/leave/employee-leave" })),
      ]
    : [];

  return (
    <Panel title="My Tasks">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: space[4] }}>
        <StatCard tone="warning" icon={<FileSearchOutlined />} label="Things to review" value={taskCounts?.review.total ?? 0} loading={isLoading} />
        <StatCard tone="info" icon={<EyeOutlined />} label="Things to monitor" value={taskCounts?.monitor.total ?? 0} loading={isLoading} />
      </div>
      <div style={{ marginTop: space[4] }}>
        <QueryState
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          compact
          skeleton={
            <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
              <Skel h={44} />
              <Skel h={44} />
            </div>
          }
          isEmpty={rows.length === 0}
          empty={<EmptyState compact illustration="success" title="Nothing to review or monitor" description="New approvals waiting on you or your team will show up here." />}
        >
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((t) => (
              <TaskRow key={`${t.action}:${t.type}`} label={t.label} count={t.count} note={t.note} action={t.action} onOpen={() => navigate(t.to)} />
            ))}
          </ul>
        </QueryState>
      </div>
    </Panel>
  );
}

function LatestUpdates() {
  const { hasPermission } = useAuth();
  const canManageAnnouncements = hasPermission("announcements.manage");
  const all = useQuery({
    queryKey: ["announcements", "all"],
    queryFn: announcementsApi.listAnnouncements,
    enabled: canManageAnnouncements,
  });
  const active = useQuery({
    queryKey: ["announcements", "active"],
    queryFn: announcementsApi.getActiveAnnouncement,
    enabled: !canManageAnnouncements,
  });
  const q = canManageAnnouncements ? all : active;
  const latestUpdates = canManageAnnouncements ? (all.data ?? []).slice(0, 5) : active.data ? [active.data] : [];

  return (
    <Panel title="Latest Updates" style={{ height: "100%" }}>
      <QueryState
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        compact
        skeleton={
          <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "flex", gap: space[3] }}>
                <Skel w={36} h={36} r={radius.pill} />
                <div style={{ flex: 1 }}>
                  <Skel w="70%" style={{ marginBottom: space[2] }} />
                  <Skel w="40%" h={10} />
                </div>
              </div>
            ))}
          </div>
        }
        isEmpty={latestUpdates.length === 0}
        empty={<EmptyState compact illustration="documents" title="No updates yet" description="Company announcements will appear here." />}
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {latestUpdates.map((u, i) => (
            <li key={u.id} style={{ display: "flex", gap: space[3], padding: `${space[3]}px 0`, borderTop: i === 0 ? undefined : `1px solid ${v.borderDefault}` }}>
              <span aria-hidden style={{ width: 36, height: 36, flex: "none", borderRadius: radius.pill, background: v.infoSubtle, color: v.infoText, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <SoundOutlined />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: fw.semibold, color: v.textPrimary, wordBreak: "break-word" }}>{u.title}</div>
                <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{u.activeFrom ? formatDate(u.activeFrom) : ""}</div>
              </div>
            </li>
          ))}
        </ul>
      </QueryState>
    </Panel>
  );
}

function WelcomeTab() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const compact = useIsCompact();

  const { data: taskCounts } = useQuery({
    queryKey: ["admin", "tasks", "counts"],
    queryFn: adminHomeApi.getTaskCounts,
  });

  // E2: people with no (valid) manager, for whoever can assign teams.
  const canAssignTeams = hasPermission("manager.team.assign");
  const { data: unassigned = [] } = useQuery({ queryKey: ["managers", "unassigned"], queryFn: managersApi.listUnassigned, enabled: canAssignTeams });
  const noApprover = taskCounts?.leaveNoTeamApprover ?? 0;

  return (
    <Stack>
      {noApprover > 0 && (
        <ApprovalBanner
          tone="warning"
          title={`${noApprover} leave ${noApprover === 1 ? "request has" : "requests have"} no manager who can approve ${noApprover === 1 ? "it" : "them"}`}
          description="Their manager hasn't been given leave approval and nobody is covering, or they have no reporting manager. They wait on HR."
          actions={<Button onClick={() => navigate("/admin/workforce/leave/employee-leave?noTeamApprover=1")}>Review</Button>}
        />
      )}
      {/* P2-F: a wrong device clock or punches at risk — "nobody would think to look". */}
      <DeviceWarnings enabled={hasPermission("attendance.devices.manage")} linkToDevices />
      {canAssignTeams && unassigned.length > 0 && (
        <ApprovalBanner
          tone="warning"
          title={`${unassigned.length} ${unassigned.length === 1 ? "person has" : "people have"} no reporting manager`}
          description="Their leave has no manager to approve it, and they don't appear in any team."
          actions={<Button onClick={() => navigate("/admin/admin-tools/managers")}>Assign</Button>}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: compact ? "minmax(0, 1fr)" : "minmax(0, 2fr) minmax(0, 1fr)", gap: "inherit", alignItems: "start" }}>
        <Stack>
          <FavouriteTiles />
          <MyTasks />
        </Stack>
        <LatestUpdates />
      </div>
    </Stack>
  );
}

function EditLayoutDrawer({ open, onClose, layout }: { open: boolean; onClose: () => void; layout: WidgetLayoutEntry[] }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<WidgetLayoutEntry[]>(layout);
  const [openedWith, setOpenedWith] = useState<WidgetLayoutEntry[] | null>(null);
  // Start from the saved layout each time the drawer opens.
  if (open && openedWith !== layout) {
    setOpenedWith(layout);
    setDraft(layout);
  }
  if (!open && openedWith !== null) setOpenedWith(null);

  const mutation = useMutation({
    mutationFn: adminHomeApi.saveLayout,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-layout"] });
      toast.success("Dashboard saved");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the dashboard.")),
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
    <SideDrawer open={open} onClose={onClose} title="Edit Dashboard" subtitle="Choose which widgets show, and in what order." primaryLabel="Save" onPrimary={() => mutation.mutate(draft)} primaryLoading={mutation.isPending}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {draft.map((entry, index) => {
          const label = WIDGET_LABELS[entry.key];
          return (
            <li key={entry.key} style={{ display: "flex", alignItems: "center", gap: space[2], padding: `${space[3]}px 0`, borderTop: index === 0 ? undefined : `1px solid ${v.borderDefault}` }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: fw.medium, color: entry.visible ? v.textPrimary : v.textSecondary }}>{label}</span>
              <Tooltip title="Move up">
                <Button type="text" aria-label={`Move ${label} up`} icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} />
              </Tooltip>
              <Tooltip title="Move down">
                <Button type="text" aria-label={`Move ${label} down`} icon={<ArrowDownOutlined />} disabled={index === draft.length - 1} onClick={() => move(index, 1)} />
              </Tooltip>
              <Switch aria-label={`Show ${label}`} checked={entry.visible} onChange={() => toggle(index)} />
            </li>
          );
        })}
      </ul>
    </SideDrawer>
  );
}

function GenderDonut({ data }: { data: { gender: string; count: number }[] }) {
  return <DonutChart data={data.map((d) => ({ name: d.gender, value: d.count }))} totalLabel="Employees" height={CHART_HEIGHT} />;
}

function AdditionsAttritionChart({ data }: { data: { month: string; joined: number; resigned: number }[] }) {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  return (
    <SmoothLineChart
      data={data}
      xKey="month"
      height={CHART_HEIGHT}
      series={[
        { key: "joined", label: "Joined", color: colors.positive },
        { key: "resigned", label: "Resigned", color: colors.negative },
      ]}
    />
  );
}

function DashboardTab() {
  const [editOpen, setEditOpen] = useState(false);
  const phone = useIsPhone();
  const widgetsQ = useQuery({
    queryKey: ["admin", "dashboard", "widgets"],
    queryFn: adminHomeApi.getDashboardWidgets,
  });
  const layoutQ = useQuery({
    queryKey: ["admin", "dashboard-layout"],
    queryFn: adminHomeApi.getLayout,
  });
  const widgets = widgetsQ.data;
  const layout = layoutQ.data;
  const loading = widgetsQ.isLoading || layoutQ.isLoading;

  const orderedVisible = useMemo(() => (layout ?? []).filter((entry) => entry.visible), [layout]);

  function renderWidget(key: DashboardWidgetKey, w: DashboardWidgets | undefined): ReactNode {
    const card = (body: ReactNode, empty: boolean) => (
      <ChartCard title={WIDGET_LABELS[key]} height={CHART_HEIGHT} loading={!w} empty={empty}>
        {body}
      </ChartCard>
    );
    const sum = (rows: { count: number }[]) => rows.reduce((s, r) => s + r.count, 0);
    switch (key) {
      case "yearsInService":
        return card(w && <SmoothLineChart data={w.yearsInService} xKey="bucket" series={[{ key: "count", label: "Employees" }]} height={CHART_HEIGHT} showValues />, !!w && sum(w.yearsInService) === 0);
      case "ageDistribution":
        return card(w && <SmoothLineChart data={w.ageDistribution} xKey="bucket" series={[{ key: "count", label: "Employees" }]} height={CHART_HEIGHT} showValues />, !!w && sum(w.ageDistribution) === 0);
      case "additionsAttrition":
        return card(w && <AdditionsAttritionChart data={w.additionsAttrition} />, !!w && w.additionsAttrition.length === 0);
      case "headcountByLocation":
        return card(w && <ColumnChart data={w.headcountByLocation} seriesLabel="Employees" height={CHART_HEIGHT} />, !!w && w.headcountByLocation.length === 0);
      case "headcountByCity":
        return card(w && <ColumnChart data={w.headcountByCity} seriesLabel="Employees" height={CHART_HEIGHT} />, !!w && w.headcountByCity.length === 0);
      case "departmentHeadcount":
        return card(w && <ColumnChart data={w.departmentHeadcount} seriesLabel="Employees" height={CHART_HEIGHT} />, !!w && w.departmentHeadcount.length === 0);
      case "genderSplit":
        return card(w && <GenderDonut data={w.genderSplit} />, !!w && sum(w.genderSplit) === 0);
      default:
        return null;
    }
  }

  const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(460px, 100%), 1fr))", gap: phone ? space[4] : space[6] };
  const error = widgetsQ.error ?? layoutQ.error;

  return (
    <Stack>
      <div style={{ display: "flex", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          {widgets?.scope === "team" && <ApprovalBanner tone="info" title="Showing your team only — you and the people who report to you." />}
        </div>
        <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)} disabled={!layout} block={phone}>
          Edit
        </Button>
      </div>
      {error ? (
        <Panel>
          <QueryState isLoading={false} error={error} onRetry={() => void (widgetsQ.error ? widgetsQ.refetch() : layoutQ.refetch())}>
            {null}
          </QueryState>
        </Panel>
      ) : loading ? (
        <div style={gridStyle} aria-busy="true" aria-label="Loading dashboard">
          {[0, 1, 2, 3].map((i) => (
            <ChartCard key={i} title=" " height={CHART_HEIGHT} loading>
              {null}
            </ChartCard>
          ))}
        </div>
      ) : orderedVisible.length === 0 ? (
        <Panel>
          <EmptyState illustration="chart" title="No widgets are visible" description="Use Edit to choose which widgets show, and in what order." action={<Button onClick={() => setEditOpen(true)}>Edit dashboard</Button>} />
        </Panel>
      ) : (
        <div style={gridStyle}>
          {orderedVisible.map((entry) => (
            <div key={entry.key} style={{ minWidth: 0 }}>
              {renderWidget(entry.key, widgets)}
            </div>
          ))}
        </div>
      )}
      {layout && <EditLayoutDrawer open={editOpen} onClose={() => setEditOpen(false)} layout={layout} />}
    </Stack>
  );
}

type View = "Welcome" | "Dashboard";

export function AdminHomePage() {
  const { user } = useAuth();
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  // ?view=dashboard makes the Dashboard tab linkable; the default stays Welcome.
  const tab: View = params.get("view") === "dashboard" ? "Dashboard" : "Welcome";
  const setTab = (t: View) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === "Dashboard") next.set("view", "dashboard");
        else next.delete("view");
        return next;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${user?.fullName?.split(" ")[0] ?? ""}`}
        subtitle={tab === "Welcome" ? "Here's what needs your attention today." : "Your people at a glance, from the figures we hold."}
        actions={<Segmented<View> options={["Welcome", "Dashboard"]} value={tab} onChange={setTab} size="large" block={phone} aria-label="Home view" />}
      />
      {tab === "Welcome" ? <WelcomeTab /> : <DashboardTab />}
    </div>
  );
}
