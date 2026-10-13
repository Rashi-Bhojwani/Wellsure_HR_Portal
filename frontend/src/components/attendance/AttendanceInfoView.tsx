import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Flex, Row, Spin, Statistic, Tag, Typography, theme } from "antd";
import { ClockCircleOutlined, EditOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import * as infoApi from "../../api/attendanceInfo";
import type { MonthDay } from "../../api/attendanceInfo";
import { hoursLabel } from "../../pages/admin/attendance/settings/format";
import { useCellTones } from "../../pages/admin/attendance/muster/musterCells";
import { DayPanel } from "./DayPanel";

const { Text } = Typography;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KIND_TEXT: Record<string, string> = { MISSING_PUNCH: "missing punch", HALF_DAY_MIN_NOT_MET: "under the half-day minimum", SHORTFALL: "shortfall", NO_SHIFT: "no shift", CLOCK_FLAGGED: "punch time to check" };

/**
 * Attendance Info (Phase 2 P2-E, UI_REFERENCE §1.5): the month calendar,
 * stats cards, exception banner and the day panel. `employeeId` unset = the
 * signed-in employee's own view (with the forgot-to-punch request). Callers
 * key it by `initialDate` so a new ?date= link opens that day.
 */
export function AttendanceInfoView({ employeeId, initialDate }: { employeeId?: string; initialDate?: string | null }) {
  const self = !employeeId;
  const { token } = theme.useToken();
  const tones = useCellTones();
  const [month, setMonth] = useState(() => (initialDate ? initialDate.slice(0, 7) : dayjs().format("YYYY-MM")));
  const [selected, setSelected] = useState<string | null>(initialDate ?? null);
  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "info", "month", employeeId ?? "me", month],
    queryFn: () => (self ? infoApi.myMonth(month) : infoApi.employeeMonth(employeeId!, month)),
  });
  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const first = dayjs(`${month}-01`);
  const cells: Array<string | null> = [...Array(first.day()).fill(null), ...Array.from({ length: first.daysInMonth() }, (_, i) => first.add(i, "day").format("YYYY-MM-DD"))];
  while (cells.length % 7) cells.push(null);
  const go = (n: number) => {
    setMonth(first.add(n, "month").format("YYYY-MM"));
    setSelected(null);
  };
  const exceptionDays = (data?.days ?? []).filter((d) => d.flags.some((f) => f in KIND_TEXT));

  const stat = (title: string, value: string | number, hint?: string) => (
    <Card size="small">
      <Statistic title={title} value={value} />
      {hint && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {hint}
        </Text>
      )}
    </Card>
  );

  return (
    <Flex vertical gap={12}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>{stat("Avg. work hrs", data?.stats.avgWorkMinutes ? hoursLabel(data.stats.avgWorkMinutes) : "—", "first in to last out")}</Col>
        <Col xs={12} md={6}>{stat("Avg. actual work hrs", data?.stats.avgActualMinutes ? hoursLabel(data.stats.avgActualMinutes) : "—", "less scheduled breaks")}</Col>
        <Col xs={12} md={6}>{stat("Late days", data?.stats.lateDays ?? "—", "recorded only, no penalty")}</Col>
        <Col xs={12} md={6}>{stat("LOP days", data?.stats.lopDays ?? "—", "loss of pay this month")}</Col>
      </Row>
      {exceptionDays.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={`${exceptionDays.length} exception ${exceptionDays.length === 1 ? "day" : "days"} this month`}
          description={Object.entries(data!.stats.exceptionKinds)
            .map(([k, n]) => `${n} ${KIND_TEXT[k] ?? k}`)
            .join(" · ")}
          action={
            <Button size="small" onClick={() => setSelected(exceptionDays[0]!.date)}>
              Show {exceptionDays.length === 1 ? "it" : "the first"}
            </Button>
          }
        />
      )}
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={selected ? 13 : 24}>
          <Card size="small">
            <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
              <Button size="small" icon={<LeftOutlined />} onClick={() => go(-1)}>
                Prev
              </Button>
              <Text strong style={{ fontSize: 16 }}>
                {first.format("MMMM YYYY")}
              </Text>
              <Button size="small" onClick={() => go(1)} disabled={month >= dayjs().format("YYYY-MM")}>
                Next <RightOutlined />
              </Button>
            </Flex>
            {isLoading ? (
              <Flex justify="center" style={{ padding: 40 }}>
                <Spin />
              </Flex>
            ) : (
              <div role="grid" aria-label={`Attendance, ${first.format("MMMM YYYY")}`} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {WEEKDAYS.map((w) => (
                  <div key={w} role="columnheader" style={{ textAlign: "center", fontSize: 12, color: token.colorTextTertiary }}>
                    {w}
                  </div>
                ))}
                {cells.map((date, i) => {
                  if (!date) return <div key={`blank-${i}`} />;
                  const d: MonthDay | undefined = byDate.get(date);
                  const tone = tones(d?.code ?? null);
                  const isSel = selected === date;
                  const isToday = date === data?.today;
                  return (
                    <button
                      key={date}
                      type="button"
                      role="gridcell"
                      aria-selected={isSel}
                      aria-label={`${dayjs(date).format("ddd D MMM")}: ${d ? d.code : "no record"}${d?.missingPunch ? ", one punch only" : ""}${d?.corrected ? ", corrected" : ""}`}
                      onClick={() => setSelected(date)}
                      style={{
                        position: "relative",
                        minHeight: 64,
                        border: `1px solid ${isSel ? token.colorPrimary : token.colorBorderSecondary}`,
                        outline: isSel ? `2px solid ${token.colorPrimary}` : isToday ? `1px dashed ${token.colorPrimary}` : undefined,
                        outlineOffset: -2,
                        borderRadius: token.borderRadiusSM,
                        background: d ? tone.background : "transparent",
                        color: d ? tone.color : token.colorTextQuaternary,
                        cursor: "pointer",
                        padding: 4,
                        textAlign: "left",
                        font: "inherit",
                      }}
                    >
                      <div style={{ fontSize: 12 }}>{Number(date.slice(8))}</div>
                      <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15, borderStyle: d?.statusOnly ? "dashed" : undefined }}>{d?.code ?? ""}</div>
                      <div style={{ position: "absolute", bottom: 2, right: 4, fontSize: 10, color: token.colorTextTertiary }}>{d?.shiftCode ?? ""}</div>
                      <div style={{ position: "absolute", top: 2, right: 4, fontSize: 10, display: "flex", gap: 2 }}>
                        {d?.missingPunch && <span title="One punch only" style={{ width: 7, height: 7, borderRadius: 7, background: token.colorError, display: "inline-block", marginTop: 3 }} />}
                        {d?.corrected && <EditOutlined title={d.overrideKind === "MANUAL_OVERRIDE" ? "Overridden by HR (not from the device)" : "Corrected: an approved request (not from the device)"} />}
                        {d?.request?.status === "PENDING" && <ClockCircleOutlined title="Request waiting for approval" />}
                        {d?.capture === "MANUAL" && d.source === "MANUAL" && <span title={d.statusOnly ? "Marked by hand, status only" : "Marked by hand"}>{d.statusOnly ? "S" : "M"}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <Flex gap={12} wrap style={{ marginTop: 8, fontSize: 12 }}>
              <Text type="secondary">
                <span style={{ width: 7, height: 7, borderRadius: 7, background: token.colorError, display: "inline-block", marginRight: 4 }} />
                one punch only
              </Text>
              <Text type="secondary">
                <EditOutlined /> corrected by hand (a request or an HR override)
              </Text>
              <Text type="secondary">
                <ClockCircleOutlined /> request waiting
              </Text>
              <Text type="secondary">M marked by hand · S status only</Text>
              <Tag style={{ fontSize: 11 }}>OFF</Tag>
              <Text type="secondary">week-off</Text>
            </Flex>
          </Card>
        </Col>
        {selected && (
          <Col xs={24} lg={11}>
            <DayPanel employeeId={employeeId} date={selected} self={self} onClose={() => setSelected(null)} />
          </Col>
        )}
      </Row>
    </Flex>
  );
}
