import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Select } from "antd";
import * as leaveApi from "../../../api/leave";
import * as orgApi from "../../../api/org";
import { LeaveMonthCalendar } from "../../../components/leave/LeaveMonthCalendar";
import { PageHeader, Panel, useIsPhone } from "../../../ui";

// Org-wide "who's on leave" calendar (leave.view widens beyond the
// caller's own department — see modules/leave/calendar.ts) with
// branch/department filters. Same month-grid as the employee-facing
// LeaveCalendarPage, plus the two filter dropdowns admins get.
export function AdminLeaveCalendarPage() {
  const phone = useIsPhone();
  const [monthStart, setMonthStart] = useState(() => dayjs().startOf("month"));
  const [locationId, setLocationId] = useState<string | undefined>(undefined);
  const [departmentId, setDepartmentId] = useState<string | undefined>(undefined);
  const fromDate = monthStart.format("YYYY-MM-DD");
  const toDate = monthStart.endOf("month").format("YYYY-MM-DD");

  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), staleTime: 30_000 });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: () => orgApi.departments.list(), staleTime: 30_000 });

  const { data: entries = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["leave", "calendar", "admin", fromDate, toDate, locationId, departmentId],
    queryFn: () => leaveApi.getLeaveCalendar(fromDate, toDate, { locationId, departmentId }),
    placeholderData: keepPreviousData,
  });

  const selectStyle = { width: phone ? "100%" : 200 };
  return (
    <>
      <PageHeader title="Leave Calendar" subtitle="Who is on leave across the organisation" />
      <Panel>
        <LeaveMonthCalendar
          entries={entries}
          monthStart={monthStart}
          onMonthChange={setMonthStart}
          loading={isLoading || isFetching}
          error={error}
          onRetry={() => void refetch()}
          emptyText="No one is on leave this month."
          toolbar={
            <>
              <Select
                allowClear
                placeholder="All branches"
                aria-label="Branch"
                style={selectStyle}
                value={locationId}
                onChange={setLocationId}
                options={locations.map((l) => ({ value: l.id, label: l.name }))}
              />
              <Select
                allowClear
                placeholder="All departments"
                aria-label="Department"
                style={selectStyle}
                value={departmentId}
                onChange={setDepartmentId}
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
              />
            </>
          }
        />
      </Panel>
    </>
  );
}
