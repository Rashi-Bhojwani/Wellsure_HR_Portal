import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, Space, Table, Tabs, Typography } from "antd";
import * as leaveApi from "../../../api/leave";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title } = Typography;
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => ({ value: y, label: String(y) }));

const COLUMNS = [
  { title: "Date", dataIndex: "date", render: (v: string) => new Date(v).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) },
  { title: "Occasion", dataIndex: "name" },
];

// Company-wide — holidays don't vary by branch (spec §5.4, HR-confirmed
// 2026-09-28).
export function HolidayCalendarPage() {
  const [year, setYear] = useState(CURRENT_YEAR);

  const { data: holidays = [], isLoading: loadingHolidays } = useQuery({
    queryKey: ["leave", "holidays", year],
    queryFn: () => leaveApi.listHolidays(year),
  });
  const { data: restrictedHolidays = [], isLoading: loadingRh } = useQuery({
    queryKey: ["leave", "restricted-holidays", year],
    queryFn: () => leaveApi.listRestrictedHolidays(year),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Title level={3} style={{ margin: 0 }}>
          Holiday Calendar
        </Title>
        <Select value={year} onChange={setYear} options={YEAR_OPTIONS} style={{ width: 120 }} />
      </Space>

      <Tabs
        items={[
          {
            key: "holidays",
            label: "Holidays",
            children: (
              <Table
                rowKey="id"
                loading={loadingHolidays}
                dataSource={holidays}
                columns={COLUMNS}
                pagination={false}
                locale={{ emptyText: <EmptyState message="No holidays found for this year." /> }}
              />
            ),
          },
          {
            key: "restricted",
            label: "Restricted Holidays",
            children: (
              <Table
                rowKey="id"
                loading={loadingRh}
                dataSource={restrictedHolidays}
                columns={COLUMNS}
                pagination={false}
                locale={{ emptyText: <EmptyState message="No restricted holidays found for this year." /> }}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}
