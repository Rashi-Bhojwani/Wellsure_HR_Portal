import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, Col, Empty, Flex, List, Row, Select, Statistic, Tag, Typography } from "antd";
import * as infoApi from "../../../api/attendanceInfo";
import type { WhoPerson } from "../../../api/attendanceInfo";
import { useSocket } from "../../../sockets/SocketProvider";
import { fs } from "../../../theme/tokens";

const { Title, Text } = Typography;

function Person({ p, extra }: { p: WhoPerson; extra?: React.ReactNode }) {
  return (
    <List.Item style={{ padding: "6px 0" }}>
      <Flex justify="space-between" style={{ width: "100%" }} gap={8}>
        <div>
          <div>{p.name}</div>
          <Text type="secondary" style={{ fontSize: fs.sm }}>
            {p.employeeCode} · {p.branch ?? "—"}
            {p.department ? ` · ${p.department}` : ""}
          </Text>
        </div>
        <div style={{ textAlign: "right" }}>{extra}</div>
      </Flex>
    </List.Item>
  );
}

/**
 * Who Is In? (Phase 2 P2-E, plan §8): today's live board. Our device sends no
 * IN/OUT direction, so "in" means "has punched today" — it never claims who
 * has left. Manual-capture people are shown as manual, never as absent.
 */
export function WhoIsInPage() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [q, setQ] = useState<{ locationId?: string; departmentId?: string }>({});
  const { data } = useQuery({ queryKey: ["attendance", "who-is-in", q], queryFn: () => infoApi.whoIsIn(q), refetchInterval: 60_000 });
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

  const column = (title: string, count: number | undefined, children: React.ReactNode) => (
    <Col xs={24} md={12} xl={6}>
      <Card size="small" title={`${title} (${count ?? 0})`} styles={{ body: { maxHeight: 520, overflow: "auto" } }}>
        {children}
      </Card>
    </Col>
  );
  return (
    <Flex vertical gap={12}>
      <Flex align="center" gap={12} wrap>
        <Title level={3} style={{ margin: 0 }}>
          Who Is In?
        </Title>
        {data && <Text type="secondary">{dayjs(data.date).format("dddd, D MMM YYYY")} · updated {dayjs(data.asOf).format("HH:mm:ss")} · live</Text>}
      </Flex>
      <Alert type="info" showIcon title="Who has punched today, not who is in the building right now" description="The device records punches without IN or OUT, so someone who has left still shows as arrived. People at branches without a machine are shown as marked by hand." />
      <Flex gap={8} wrap>
        <Select allowClear placeholder="All branches" aria-label="Branch" style={{ width: 220 }} value={q.locationId} onChange={(v) => setQ((x) => ({ ...x, locationId: v }))} options={(data?.filters.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        <Select allowClear placeholder="All departments" aria-label="Department" style={{ width: 220 }} value={q.departmentId} onChange={(v) => setQ((x) => ({ ...x, departmentId: v }))} options={(data?.filters.departments ?? []).map((l) => ({ value: l.id, label: l.name }))} />
      </Flex>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Arrived" value={data?.counts.arrived ?? 0} suffix={data ? `/ ${data.counts.total}` : undefined} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Late" value={data?.counts.late ?? 0} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Not yet arrived" value={data?.counts.notArrived ?? 0} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Away (leave, holiday, week-off)" value={data?.counts.away ?? 0} /></Card></Col>
      </Row>
      <Row gutter={[12, 12]}>
        {column(
          "Arrived",
          data?.counts.arrived,
          data?.arrived.length ? (
            <List size="small" dataSource={data.arrived} renderItem={(p) => <Person p={p} extra={<><Text strong>{p.time}</Text>{p.lateInMinutes ? <div><Tag color="orange">late {p.lateInMinutes}m</Tag></div> : null}{p.halfDayLeave ? <div><Tag>{p.halfDayLeave} half day</Tag></div> : null}</>} />} />
          ) : (
            <Empty description="Nobody has punched yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        )}
        {column(
          "Not yet arrived",
          data?.counts.notArrived,
          data?.notArrived.length ? <List size="small" dataSource={data.notArrived} renderItem={(p) => <Person p={p} extra={p.shiftStart ? <Text type="secondary">due {p.shiftStart}</Text> : null} />} /> : <Empty description="Everyone expected has punched" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
        )}
        {column(
          "Marked by hand",
          data?.counts.manual,
          data?.manual.length ? (
            <List
              size="small"
              dataSource={data.manual}
              renderItem={(p) => <Person p={p} extra={p.state === "NOT_MARKED" ? <Tag>not marked yet</Tag> : p.state === "STATUS_ONLY" ? <Tag>{p.status} · status only</Tag> : <Text strong>{p.time} <Tag>manual</Tag></Text>} />}
            />
          ) : (
            <Empty description="No branches marked by hand" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        )}
        {column(
          "Away",
          data?.counts.away,
          data?.away.length ? <List size="small" dataSource={data.away} renderItem={(p) => <Person p={p} extra={<><Text type="secondary">{p.why}</Text>{p.workedToday ? <div><Tag color="green">worked anyway</Tag></div> : null}</>} />} /> : <Empty description="Nobody away" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
        )}
      </Row>
    </Flex>
  );
}
