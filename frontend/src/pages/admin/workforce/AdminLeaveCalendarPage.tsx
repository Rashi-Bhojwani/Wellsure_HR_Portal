import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Button, Card, Select, Space, Tag, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import * as leaveApi from "../../../api/leave";
import * as orgApi from "../../../api/org";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title, Text } = Typography;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildMonthCells(monthStart: dayjs.Dayjs): (number | null)[] {
  const daysInMonth = monthStart.daysInMonth();
  const startWeekday = monthStart.day();
  const cells: (number | null)[] = Array(startWeekday).fill(null);
  for (let date = 1; date <= daysInMonth; date++) cells.push(date);
  return cells;
}

// Org-wide "who's on leave" calendar (leave.view widens beyond the
// caller's own department — see modules/leave/calendar.ts) with
// branch/department filters. Same month-grid as the employee-facing
// LeaveCalendarPage, plus the two filter dropdowns admins get.
export function AdminLeaveCalendarPage() {
  const [monthStart, setMonthStart] = useState(() => dayjs().startOf("month"));
  const [locationId, setLocationId] = useState<string | undefined>(undefined);
  const [departmentId, setDepartmentId] = useState<string | undefined>(undefined);
  const fromDate = monthStart.format("YYYY-MM-DD");
  const toDate = monthStart.endOf("month").format("YYYY-MM-DD");

  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: () => orgApi.departments.list() });

  const { data: entries = [] } = useQuery({
    queryKey: ["leave", "calendar", "admin", fromDate, toDate, locationId, departmentId],
    queryFn: () => leaveApi.getLeaveCalendar(fromDate, toDate, { locationId, departmentId }),
  });

  const cells = useMemo(() => buildMonthCells(monthStart), [monthStart]);
  const entriesByDate = useMemo(() => {
    const map = new Map<number, leaveApi.LeaveCalendarEntry[]>();
    for (const entry of entries) {
      let cursor = dayjs(entry.fromDate);
      const end = dayjs(entry.toDate);
      while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
        if (cursor.isSame(monthStart, "month") && !entry.releasedDates.includes(cursor.format("YYYY-MM-DD"))) {
          const list = map.get(cursor.date()) ?? [];
          list.push(entry);
          map.set(cursor.date(), list);
        }
        cursor = cursor.add(1, "day");
      }
    }
    return map;
  }, [entries, monthStart]);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Leave Calendar
      </Title>
      <Card
        title={
          <Space>
            <Button size="small" icon={<LeftOutlined />} onClick={() => setMonthStart((m) => m.subtract(1, "month"))} />
            <Text strong>{monthStart.format("MMMM YYYY")}</Text>
            <Button size="small" icon={<RightOutlined />} onClick={() => setMonthStart((m) => m.add(1, "month"))} />
          </Space>
        }
        extra={
          <Space>
            <Select
              allowClear
              placeholder="All branches"
              style={{ width: 180 }}
              value={locationId}
              onChange={setLocationId}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />
            <Select
              allowClear
              placeholder="All departments"
              style={{ width: 180 }}
              value={departmentId}
              onChange={setDepartmentId}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Space>
        }
      >
        {entries.length === 0 && <EmptyState message="No one is on leave this month." />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
          {WEEKDAYS.map((w) => (
            <div key={w} style={{ textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {w}
              </Text>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {cells.map((date, idx) =>
            date ? (
              <div key={date} style={{ background: "#f4f5f7", borderRadius: 8, padding: 6, minHeight: 76 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{date}</div>
                <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                  {(entriesByDate.get(date) ?? []).slice(0, 2).map((entry, i) => (
                    <Tag key={i} color="blue" style={{ fontSize: 10, margin: 0, whiteSpace: "normal" }}>
                      {entry.employeeName} · {entry.leaveTypeCode}
                    </Tag>
                  ))}
                  {(entriesByDate.get(date)?.length ?? 0) > 2 && (
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      +{(entriesByDate.get(date)?.length ?? 0) - 2} more
                    </Text>
                  )}
                </Space>
              </div>
            ) : (
              <div key={`blank-${idx}`} />
            ),
          )}
        </div>
      </Card>
    </Space>
  );
}
