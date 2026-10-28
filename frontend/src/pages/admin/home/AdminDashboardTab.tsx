import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Switch, Tooltip } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, EditOutlined } from '@ant-design/icons';
import { ChartCard } from '../../../components/charts/ChartCard';
import { ColumnChart, DonutChart, SmoothLineChart } from '../../../components/charts/chartKit';
import * as adminHomeApi from '../../../api/adminHome';
import type { DashboardWidgetKey, DashboardWidgets, WidgetLayoutEntry } from '../../../api/adminHome';
import { useThemeMode } from '../../../theme/ThemeProvider';
import { useChartColors } from '../../../theme/chartPalette';
import { fw, space, v } from '../../../theme/tokens';
import { apiErrorMessage } from '../../../lib/apiError';
import { ApprovalBanner } from '../../../ui/ApprovalBanner';
import { EmptyState } from '../../../ui/EmptyState';
import { Panel, Stack } from '../../../ui/Panel';
import { QueryState } from '../../../ui/QueryState';
import { SideDrawer } from '../../../ui/SideDrawer';
import { toast } from '../../../ui/Toast';
import { useIsPhone } from '../../../ui/hooks';

// Admin Home's Dashboard tab (charts + Edit layout). Its own chunk, loaded when the tab opens (AdminHomePage), so the default Welcome view and the shell stay
// within the bundle budget and the chart library never loads for someone who doesn't look at charts.

const WIDGET_LABELS: Record<DashboardWidgetKey, string> = {
  yearsInService: 'Years In Service Distribution',
  additionsAttrition: 'Additions & Attrition',
  headcountByLocation: 'Employee Count By Branch',
  headcountByCity: 'Employee Count By City',
  ageDistribution: 'Age Distribution',
  genderSplit: 'Gender Split',
  departmentHeadcount: 'Department Headcount',
};

const CHART_HEIGHT = 280;

function EditLayoutDrawer({
  open,
  onClose,
  layout,
}: {
  open: boolean;
  onClose: () => void;
  layout: WidgetLayoutEntry[];
}) {
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
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-layout'] });
      toast.success('Dashboard saved');
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not save the dashboard.')),
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
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Edit Dashboard"
      subtitle="Choose which widgets show, and in what order."
      primaryLabel="Save"
      onPrimary={() => mutation.mutate(draft)}
      primaryLoading={mutation.isPending}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {draft.map((entry, index) => {
          const label = WIDGET_LABELS[entry.key];
          return (
            <li
              key={entry.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: space[2],
                padding: `${space[3]}px 0`,
                borderTop: index === 0 ? undefined : `1px solid ${v.borderDefault}`,
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontWeight: fw.medium,
                  color: entry.visible ? v.textPrimary : v.textSecondary,
                }}
              >
                {label}
              </span>
              <Tooltip title="Move up">
                <Button
                  type="text"
                  aria-label={`Move ${label} up`}
                  icon={<ArrowUpOutlined />}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />
              </Tooltip>
              <Tooltip title="Move down">
                <Button
                  type="text"
                  aria-label={`Move ${label} down`}
                  icon={<ArrowDownOutlined />}
                  disabled={index === draft.length - 1}
                  onClick={() => move(index, 1)}
                />
              </Tooltip>
              <Switch
                aria-label={`Show ${label}`}
                checked={entry.visible}
                onChange={() => toggle(index)}
              />
            </li>
          );
        })}
      </ul>
    </SideDrawer>
  );
}

function GenderDonut({ data }: { data: { gender: string; count: number }[] }) {
  return (
    <DonutChart
      data={data.map((d) => ({ name: d.gender.charAt(0) + d.gender.slice(1).toLowerCase().replace(/_/g, ' '), value: d.count }))}
      totalLabel="Employees"
      height={CHART_HEIGHT}
    />
  );
}

function AdditionsAttritionChart({
  data,
}: {
  data: { month: string; joined: number; resigned: number }[];
}) {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  return (
    <SmoothLineChart
      data={data}
      xKey="month"
      height={CHART_HEIGHT}
      series={[
        { key: 'joined', label: 'Joined', color: colors.positive },
        { key: 'resigned', label: 'Resigned', color: colors.negative },
      ]}
    />
  );
}

export function AdminDashboardTab() {
  const [editOpen, setEditOpen] = useState(false);
  const phone = useIsPhone();
  const widgetsQ = useQuery({
    queryKey: ['admin', 'dashboard', 'widgets'],
    queryFn: adminHomeApi.getDashboardWidgets,
  });
  const layoutQ = useQuery({
    queryKey: ['admin', 'dashboard-layout'],
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
      case 'yearsInService':
        return card(
          w && (
            <SmoothLineChart
              data={w.yearsInService}
              xKey="bucket"
              series={[{ key: 'count', label: 'Employees' }]}
              height={CHART_HEIGHT}
              showValues
            />
          ),
          !!w && sum(w.yearsInService) === 0,
        );
      case 'ageDistribution':
        return card(
          w && (
            <SmoothLineChart
              data={w.ageDistribution}
              xKey="bucket"
              series={[{ key: 'count', label: 'Employees' }]}
              height={CHART_HEIGHT}
              showValues
            />
          ),
          !!w && sum(w.ageDistribution) === 0,
        );
      case 'additionsAttrition':
        return card(
          w && <AdditionsAttritionChart data={w.additionsAttrition} />,
          !!w && w.additionsAttrition.length === 0,
        );
      case 'headcountByLocation':
        return card(
          w && (
            <ColumnChart
              data={w.headcountByLocation}
              seriesLabel="Employees"
              height={CHART_HEIGHT}
            />
          ),
          !!w && w.headcountByLocation.length === 0,
        );
      case 'headcountByCity':
        return card(
          w && (
            <ColumnChart data={w.headcountByCity} seriesLabel="Employees" height={CHART_HEIGHT} />
          ),
          !!w && w.headcountByCity.length === 0,
        );
      case 'departmentHeadcount':
        return card(
          w && (
            <ColumnChart
              data={w.departmentHeadcount}
              seriesLabel="Employees"
              height={CHART_HEIGHT}
            />
          ),
          !!w && w.departmentHeadcount.length === 0,
        );
      case 'genderSplit':
        return card(w && <GenderDonut data={w.genderSplit} />, !!w && sum(w.genderSplit) === 0);
      default:
        return null;
    }
  }

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(400px, 100%), 1fr))',
    gap: phone ? space[4] : space[6],
  };
  const error = widgetsQ.error ?? layoutQ.error;

  return (
    <Stack>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          {widgets?.scope === 'team' && (
            <ApprovalBanner
              tone="info"
              title="Showing your team only — you and the people who report to you."
            />
          )}
        </div>
        <Button
          icon={<EditOutlined />}
          onClick={() => setEditOpen(true)}
          disabled={!layout}
          block={phone}
        >
          Edit
        </Button>
      </div>
      {error ? (
        <Panel>
          <QueryState
            isLoading={false}
            error={error}
            onRetry={() => void (widgetsQ.error ? widgetsQ.refetch() : layoutQ.refetch())}
          >
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
          <EmptyState
            illustration="chart"
            title="No widgets are visible"
            description="Use Edit to choose which widgets show, and in what order."
            action={<Button onClick={() => setEditOpen(true)}>Edit dashboard</Button>}
          />
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
      {layout && (
        <EditLayoutDrawer open={editOpen} onClose={() => setEditOpen(false)} layout={layout} />
      )}
    </Stack>
  );
}
