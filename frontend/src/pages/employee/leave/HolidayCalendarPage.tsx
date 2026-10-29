import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Segmented, Select } from "antd";
import * as leaveApi from "../../../api/leave";
import { fmtHolidayDate, holidayColumns, holidayWeekday, type HolidayListRow } from "../../../components/leave/holidayColumns";
import { HolidayKindChip, type HolidayKind } from "../../../components/leave/HolidayKindChip";
import { DataTable, EmptyState, PageHeader, Panel, useIsPhone } from "../../../ui";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => ({ value: y, label: String(y) }));
type Show = "ALL" | HolidayKind;

// Company-wide — holidays don't vary by branch (spec §5.4, HR-confirmed
// 2026-09-28).
export function HolidayCalendarPage() {
  const phone = useIsPhone();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [show, setShow] = useState<Show>("ALL");

  const holidaysQ = useQuery({
    queryKey: ["leave", "holidays", year],
    queryFn: () => leaveApi.listHolidays(year),
    placeholderData: keepPreviousData,
  });
  const restrictedQ = useQuery({
    queryKey: ["leave", "restricted-holidays", year],
    queryFn: () => leaveApi.listRestrictedHolidays(year),
    placeholderData: keepPreviousData,
  });

  const holidays = holidaysQ.data;
  const restricted = restrictedQ.data;
  const rows = useMemo<HolidayListRow[]>(() => {
    const all = [
      ...(show !== "RESTRICTED" ? (holidays ?? []).map((h) => ({ ...h, kind: "HOLIDAY" as const })) : []),
      ...(show !== "HOLIDAY" ? (restricted ?? []).map((h) => ({ ...h, kind: "RESTRICTED" as const })) : []),
    ];
    return all.sort((a, b) => a.date.localeCompare(b.date));
  }, [holidays, restricted, show]);

  const loading = holidaysQ.isLoading || restrictedQ.isLoading || holidaysQ.isFetching || restrictedQ.isFetching;
  const emptyTitle = show === "RESTRICTED" ? "No restricted holidays found for this year." : "No holidays found for this year.";

  return (
    <>
      <PageHeader
        title="Holiday Calendar"
        subtitle="Company-wide holidays, and restricted holidays you can choose to take"
        actions={<Select aria-label="Year" value={year} onChange={setYear} options={YEAR_OPTIONS} style={{ width: phone ? "100%" : 120 }} />}
      />
      <Panel
        title={`Holidays ${year}`}
        extra={
          <Segmented<Show>
            value={show}
            onChange={setShow}
            options={[
              { value: "ALL", label: `All (${(holidays?.length ?? 0) + (restricted?.length ?? 0)})` },
              { value: "HOLIDAY", label: `Holidays (${holidays?.length ?? 0})` },
              { value: "RESTRICTED", label: `Restricted (${restricted?.length ?? 0})` },
            ]}
          />
        }
      >
        <DataTable<HolidayListRow>
          rowKey={(r) => `${r.kind}-${r.id}`}
          loading={loading}
          error={holidaysQ.error ?? restrictedQ.error}
          onRetry={() => {
            void holidaysQ.refetch();
            void restrictedQ.refetch();
          }}
          dataSource={rows}
          pagination={false}
          columns={holidayColumns<HolidayListRow>({ withKind: (r) => r.kind })}
          empty={<EmptyState compact illustration="calendar" title={emptyTitle} description={null} />}
          mobile={{
            title: (r) => r.name,
            subtitle: (r) => `${fmtHolidayDate(r.date)} · ${holidayWeekday(r.date)}`,
            status: (r) => <HolidayKindChip kind={r.kind} />,
          }}
        />
      </Panel>
    </>
  );
}
