import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import * as leaveApi from "../../../api/leave";
import { LeaveMonthCalendar } from "../../../components/leave/LeaveMonthCalendar";
import { PageHeader, Panel } from "../../../ui";

// The employee-facing "who's on leave" view (spec §5.4) — own department by
// default; see modules/leave/calendar.ts for the leave.view-gated org-wide
// widening on the admin side (commit C).
export function LeaveCalendarPage() {
  const [monthStart, setMonthStart] = useState(() => dayjs().startOf("month"));
  const fromDate = monthStart.format("YYYY-MM-DD");
  const toDate = monthStart.endOf("month").format("YYYY-MM-DD");

  const { data: entries = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["leave", "calendar", fromDate, toDate],
    queryFn: () => leaveApi.getLeaveCalendar(fromDate, toDate),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Leave Calendar" subtitle="Who on your team is on leave this month" />
      <Panel>
        <LeaveMonthCalendar
          entries={entries}
          monthStart={monthStart}
          onMonthChange={setMonthStart}
          loading={isLoading || isFetching}
          error={error}
          onRetry={() => void refetch()}
          emptyText="No one on your team is on leave this month."
        />
      </Panel>
    </>
  );
}
