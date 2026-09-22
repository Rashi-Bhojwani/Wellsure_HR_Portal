import { useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  CalendarOutlined,
  LeftOutlined,
  RightOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { StatCard } from "../../../components/common/StatCard";
import { StatusCalendarCell, type AttendanceDayData } from "../../../components/calendar/StatusCalendarCell";

const { Title, Text } = Typography;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildMonth(monthStart: dayjs.Dayjs): (AttendanceDayData | null)[] {
  const daysInMonth = monthStart.daysInMonth();
  const startWeekday = monthStart.day();
  const cells: (AttendanceDayData | null)[] = Array(startWeekday).fill(null);

  for (let date = 1; date <= daysInMonth; date++) {
    const d = monthStart.date(date);
    let status = "P";
    let hasException = false;

    if (d.day() === 0) {
      status = "O";
    } else if (date === 15) {
      status = "H"; // Independence Day
    } else if (date === 11) {
      status = "A:P";
      hasException = true;
    } else if (date === 4 || date === 19) {
      status = "A";
    }

    cells.push({ date, status, shift: status === "O" || status === "H" ? undefined : "GEN", hasException });
  }
  return cells;
}

export function AttendanceInfoPage() {
  const [monthStart, setMonthStart] = useState(() => dayjs("2026-08-01"));
  const [selectedDate, setSelectedDate] = useState(11);
  const [view, setView] = useState<string | number>("Grid");

  const cells = useMemo(() => buildMonth(monthStart), [monthStart]);
  const exceptionCount = cells.filter((c) => c?.hasException).length;
  const selectedDay = cells.find((c) => c?.date === selectedDate) ?? undefined;

  const sessionColumns = [
    { title: "First In", dataIndex: "firstIn", key: "firstIn" },
    { title: "Last Out", dataIndex: "lastOut", key: "lastOut" },
    { title: "Late In", dataIndex: "lateIn", key: "lateIn" },
    { title: "Early Out", dataIndex: "earlyOut", key: "earlyOut" },
    { title: "Total Work Hrs", dataIndex: "total", key: "total" },
    { title: "Break Hrs", dataIndex: "break", key: "break" },
    { title: "Actual Work Hrs", dataIndex: "actual", key: "actual" },
    { title: "Work Hours in Shift Time", dataIndex: "shiftHrs", key: "shiftHrs" },
    { title: "Shortfall Hrs", dataIndex: "shortfall", key: "shortfall" },
    { title: "Excess Hrs", dataIndex: "excess", key: "excess" },
  ];

  const sessionRow = [
    {
      key: "1",
      firstIn: "10:00",
      lastOut: "19:00",
      lateIn: "-",
      earlyOut: "-",
      total: "09:00",
      break: "-",
      actual: "09:00",
      shiftHrs: "09:00",
      shortfall: "08:59",
      excess: "-",
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Row justify="end">
        <Button icon={<CalendarOutlined />}>My Regularizations</Button>
      </Row>

      {exceptionCount > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          title={
            <Space>
              <Text>{exceptionCount} exception day(s)</Text>
              <a onClick={() => setSelectedDate(11)}>Regularize</a>
            </Space>
          }
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <StatCard label="Avg. Work Hrs" value="08:27" trend={{ text: "-6% From July", positive: false }} />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard
            label="Avg. Actual Work Hrs"
            value="08:27"
            trend={{ text: "-6% From July", positive: false }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard label="Penalty Days" value="0" />
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ height: "100%", display: "flex", alignItems: "center" }}>
            <a>+3 Insights</a>
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} xl={selectedDay ? 14 : 24}>
          <Card
            title={
              <Space>
                <Button size="small" icon={<LeftOutlined />} onClick={() => setMonthStart((m) => m.subtract(1, "month"))} />
                <Text strong>{monthStart.format("MMMM YYYY")}</Text>
                <Button size="small" icon={<RightOutlined />} onClick={() => setMonthStart((m) => m.add(1, "month"))} />
              </Space>
            }
            extra={<Segmented options={["Grid", "List"]} value={view} onChange={setView} size="small" />}
          >
            {view === "Grid" ? (
              <>
                <Row gutter={4} style={{ marginBottom: 4 }}>
                  {WEEKDAYS.map((w) => (
                    <Col span={24 / 7} key={w} style={{ textAlign: "center" }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {w}
                      </Text>
                    </Col>
                  ))}
                </Row>
                <Row gutter={[4, 4]}>
                  {cells.map((cell, idx) =>
                    cell ? (
                      <Col span={24 / 7} key={cell.date}>
                        <StatusCalendarCell
                          day={cell}
                          selected={cell.date === selectedDate}
                          onSelect={() => setSelectedDate(cell.date)}
                        />
                      </Col>
                    ) : (
                      <Col span={24 / 7} key={`blank-${idx}`} />
                    ),
                  )}
                </Row>
              </>
            ) : (
              <Table
                size="small"
                pagination={false}
                rowKey="date"
                dataSource={cells.filter((c): c is AttendanceDayData => c !== null)}
                columns={[
                  { title: "Date", dataIndex: "date", key: "date" },
                  {
                    title: "Status",
                    dataIndex: "status",
                    key: "status",
                    render: (s: string) => <Tag>{s}</Tag>,
                  },
                  { title: "Shift", dataIndex: "shift", key: "shift", render: (s?: string) => s ?? "-" },
                ]}
                onRow={(record) => ({ onClick: () => setSelectedDate(record.date) })}
              />
            )}
          </Card>
        </Col>

        {selectedDay && (
          <Col xs={24} xl={10}>
            <Card
              title={`${monthStart.date(selectedDay.date).format("Do MMMM, YYYY")} — ${monthStart.date(selectedDay.date).format("dddd")}`}
              extra={<a onClick={() => setSelectedDate(-1)}>Hide</a>}
            >
              {selectedDay.hasException && (
                <Alert
                  type="warning"
                  showIcon
                  title="Half Day Minimum Hours"
                  description="Half day minimum hours is not fulfilled and so, 1 day(s) of LOP will be deducted."
                  style={{ marginBottom: 16 }}
                />
              )}

              <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
                <Descriptions.Item label="Shift">General Shift(GEN)</Descriptions.Item>
                <Descriptions.Item label="Shift Timing">10:00 to 19:00</Descriptions.Item>
                <Descriptions.Item label="Scheme">General Biometrics Scheme</Descriptions.Item>
                <Descriptions.Item label="Processed">
                  Processed on {monthStart.date(selectedDay.date).format("Do MMM")} at 15:29
                </Descriptions.Item>
              </Descriptions>

              <Table
                size="small"
                pagination={false}
                columns={sessionColumns}
                dataSource={sessionRow}
                scroll={{ x: true }}
                style={{ marginBottom: 16 }}
              />

              <Title level={5}>Status Details</Title>
              <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
                <Descriptions.Item label="Status">Override</Descriptions.Item>
                <Descriptions.Item label="Remarks">—</Descriptions.Item>
              </Descriptions>

              <Title level={5}>Session Details</Title>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Session">First Half</Descriptions.Item>
                <Descriptions.Item label="Session Timing">10:00 – 14:30</Descriptions.Item>
                <Descriptions.Item label="First In">10:00</Descriptions.Item>
                <Descriptions.Item label="Last Out">19:00</Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        )}
      </Row>
    </Space>
  );
}
