import { useEffect, useMemo, useState, type ReactNode } from "react";
import dayjs from "dayjs";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Segmented, Select, Typography } from "antd";
import { CalendarOutlined, ClockCircleOutlined, EditOutlined, LoginOutlined, UserDeleteOutlined } from "@ant-design/icons";
import * as infoApi from "../../../api/attendanceInfo";
import type { WhoIsIn } from "../../../api/attendanceInfo";
import { useSocket } from "../../../sockets/SocketProvider";
import { ApprovalBanner, CardGrid, DataTable, FilterBar, InitialsAvatar, PageHeader, Panel, Stack, StatCard, StatusChip, EmptyState } from "../../../ui";
import { fs, radius, space, v } from "../../../theme/tokens";

const { Text } = Typography;

type Group = "ARRIVED" | "NOT_ARRIVED" | "MANUAL" | "AWAY";
const GROUP_LABEL: Record<Group, string> = { ARRIVED: "Arrived", NOT_ARRIVED: "Not yet arrived", MANUAL: "Marked by hand", AWAY: "Away" };
const GROUP_TONE = { ARRIVED: "success", NOT_ARRIVED: "warning", MANUAL: "info", AWAY: "purple" } as const;

interface Row {
  key: string;
  group: Group;
  employeeCode: string;
  name: string;
  branch: string | null;
  department: string | null;
  /** Time column: punch time, due time, manual time. */
  time: ReactNode;
  /** Chips / notes. */
  detail: ReactNode;
  /** For the test hooks: an away person who punched anyway. */
  worked?: boolean;
}

function rowsOf(data: WhoIsIn | undefined): Row[] {
  if (!data) return [];
  const base = (p: { employeeId: string; employeeCode: string; name: string; branch: string | null; department: string | null }, group: Group) => ({
    key: `${group}|${p.employeeId}`,
    group,
    employeeCode: p.employeeCode,
    name: p.name,
    branch: p.branch,
    department: p.department,
  });
  return [
    ...data.arrived.map((p) => ({
      ...base(p, "ARRIVED"),
      time: <Text strong className="ws-num">{p.time ?? "—"}</Text>,
      detail: (
        <span style={{ display: "inline-flex", gap: space[1], flexWrap: "wrap" }}>
          {p.lateInMinutes ? <StatusChip tone="warning">late {p.lateInMinutes}m</StatusChip> : null}
          {p.halfDayLeave ? <StatusChip tone="neutral">{p.halfDayLeave} half day</StatusChip> : null}
          {!p.lateInMinutes && !p.halfDayLeave ? <Text type="secondary">—</Text> : null}
        </span>
      ),
    })),
    ...data.notArrived.map((p) => ({
      ...base(p, "NOT_ARRIVED"),
      time: p.shiftStart ? <Text type="secondary">due {p.shiftStart}</Text> : <Text type="secondary">—</Text>,
      detail: <Text type="secondary">—</Text>,
    })),
    ...data.manual.map((p) => ({
      ...base(p, "MANUAL"),
      time: p.state === "TIMED" ? <Text strong className="ws-num">{p.time}</Text> : <Text type="secondary">—</Text>,
      detail: p.state === "NOT_MARKED" ? <StatusChip tone="neutral">not marked yet</StatusChip> : p.state === "STATUS_ONLY" ? <StatusChip tone="neutral">{p.status} · status only</StatusChip> : <StatusChip tone="info">manual</StatusChip>,
    })),
    ...data.away.map((p) => ({
      ...base(p, "AWAY"),
      worked: Boolean(p.workedToday),
      time: <Text type="secondary">—</Text>,
      detail: (
        <span style={{ display: "inline-flex", gap: space[1], flexWrap: "wrap", alignItems: "center" }}>
          <Text type="secondary">{p.why}</Text>
          {p.workedToday ? <StatusChip tone="success">worked anyway</StatusChip> : null}
        </span>
      ),
    })),
  ];
}

/**
 * Who Is In? (Phase 2 P2-E, plan §8): today's live board. Our device sends no
 * IN/OUT direction, so "in" means "has punched today" — it never claims who
 * has left. Manual-capture people are shown as manual, never as absent.
 * Live: socket events invalidate the query; the old rows stay on screen while it refetches (no flash), rows keep stable keys.
 */
export function WhoIsInPage() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [q, setQ] = useState<{ locationId?: string; departmentId?: string }>({});
  const [group, setGroup] = useState<Group | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["attendance", "who-is-in", q], queryFn: () => infoApi.whoIsIn(q), refetchInterval: 60_000, placeholderData: keepPreviousData });
  useEffect(() => {
    if (!socket) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["attendance", "who-is-in"] });
    socket.on("punch.received.batch", refresh);
    socket.on("attendance.updated", refresh);
    return () => {
      socket.off("punch.received.batch", refresh);
      socket.off("attendance.updated", refresh);
    };
  }, [socket, queryClient]);

  const all = useMemo(() => rowsOf(data), [data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter((r) => (group === "ALL" || r.group === group) && (!s || r.name.toLowerCase().includes(s) || r.employeeCode.toLowerCase().includes(s)));
  }, [all, group, search]);
  const c = data?.counts;
  const pick = (g: Group) => setGroup((cur) => (cur === g ? "ALL" : g));

  return (
    <>
      <PageHeader
        title="Who Is In?"
        subtitle={
          data ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              {dayjs(data.date).format("dddd, D MMM YYYY")} · updated {dayjs(data.asOf).format("HH:mm:ss")}
              <span style={{ display: "inline-flex", alignItems: "center", gap: space[1], color: v.accentText, fontWeight: 600 }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: radius.pill, background: v.accent, display: "inline-block" }} />
                live
              </span>
            </span>
          ) : (
            "Today's live board"
          )
        }
      />
      <Stack>
        <ApprovalBanner tone="info" title="Who has punched today, not who is in the building right now" description="The device records punches without IN or OUT, so someone who has left still shows as arrived. People at branches without a machine are shown as marked by hand." />
        <CardGrid min={180}>
          <StatCard icon={<LoginOutlined />} tone="accent" label="Arrived" loading={isLoading} value={c ? `${c.arrived} / ${c.total}` : 0} onClick={() => pick("ARRIVED")} />
          <StatCard icon={<ClockCircleOutlined />} tone="warning" label="Late" loading={isLoading} value={c?.late ?? 0} onClick={() => pick("ARRIVED")} />
          <StatCard icon={<UserDeleteOutlined />} tone="danger" label="Not yet arrived" loading={isLoading} value={c?.notArrived ?? 0} onClick={() => pick("NOT_ARRIVED")} />
          <StatCard icon={<EditOutlined />} tone="info" label="Marked by hand" loading={isLoading} value={c?.manual ?? 0} onClick={() => pick("MANUAL")} />
          <StatCard icon={<CalendarOutlined />} tone="neutral" label="Away (leave, holiday, week-off)" loading={isLoading} value={c?.away ?? 0} onClick={() => pick("AWAY")} />
        </CardGrid>
        <Panel
          title="Today"
          extra={
            <Segmented<Group | "ALL">
              value={group}
              onChange={setGroup}
              options={[
                { value: "ALL", label: "All" },
                ...(Object.keys(GROUP_LABEL) as Group[]).map((g) => ({ value: g, label: `${GROUP_LABEL[g]} (${(c ? { ARRIVED: c.arrived, NOT_ARRIVED: c.notArrived, MANUAL: c.manual, AWAY: c.away }[g] : 0) ?? 0})` })),
              ]}
              style={{ maxWidth: "100%", overflowX: "auto" }}
            />
          }
        >
          <FilterBar
            onSearch={setSearch}
            searchValue={search}
            searchPlaceholder="Search name or code"
            activeCount={(q.locationId ? 1 : 0) + (q.departmentId ? 1 : 0)}
            onClear={() => setQ({})}
            filters={
              <>
                <Select allowClear placeholder="All branches" aria-label="Branch" style={{ width: 220 }} value={q.locationId} onChange={(val) => setQ((x) => ({ ...x, locationId: val }))} options={(data?.filters.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
                <Select allowClear placeholder="All departments" aria-label="Department" style={{ width: 220 }} value={q.departmentId} onChange={(val) => setQ((x) => ({ ...x, departmentId: val }))} options={(data?.filters.departments ?? []).map((l) => ({ value: l.id, label: l.name }))} />
              </>
            }
          />
          <DataTable<Row>
            rowKey="key"
            // Stable hooks for the punch-to-screen latency test (biometric-agent/src/simulator/latency): what it reads is the employee code, the group and the time, not the look of the row.
            onRow={(r) => ({ "data-testid": "whoisin-row", "data-employee-code": r.employeeCode, "data-group": r.group, "data-worked": r.worked ? "1" : "0" }) as import("react").HTMLAttributes<HTMLElement>}
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={rows}
            pagination={{ pageSize: 25 }}
            empty={
              <EmptyState
                kind={search || group !== "ALL" ? "no-results" : "empty"}
                compact
                title={group === "ARRIVED" ? "Nobody has punched yet" : group === "NOT_ARRIVED" ? "Everyone expected has punched" : group === "AWAY" ? "Nobody away" : group === "MANUAL" ? "No branches marked by hand" : "Nobody here"}
                description={search ? "Try another name or code." : null}
              />
            }
            mobile={{
              avatar: (r) => <InitialsAvatar name={r.name} size={36} />,
              title: (r) => r.name,
              subtitle: (r) => `${r.employeeCode} · ${r.branch ?? "—"}${r.department ? ` · ${r.department}` : ""}`,
              status: (r) => <StatusChip tone={GROUP_TONE[r.group]}>{GROUP_LABEL[r.group]}</StatusChip>,
              fields: [
                { label: "Time", render: (r) => r.time },
                { label: "Note", render: (r) => r.detail },
              ],
            }}
            columns={[
              {
                title: "Employee",
                key: "name",
                render: (_, r) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: space[3] }}>
                    <InitialsAvatar name={r.name} size={32} />
                    <span>
                      <div style={{ color: v.textPrimary, fontWeight: 600 }}>{r.name}</div>
                      <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{r.employeeCode}</div>
                    </span>
                  </span>
                ),
              },
              { title: "Branch", dataIndex: "branch", render: (val: string | null) => val ?? "—" },
              { title: "Department", dataIndex: "department", render: (val: string | null) => val ?? "—" },
              { title: "State", key: "group", render: (_, r) => <StatusChip tone={GROUP_TONE[r.group]}>{GROUP_LABEL[r.group]}</StatusChip> },
              { title: "Time", key: "time", render: (_, r) => r.time },
              { title: "Note", key: "detail", render: (_, r) => r.detail },
            ]}
          />
        </Panel>
      </Stack>
    </>
  );
}
