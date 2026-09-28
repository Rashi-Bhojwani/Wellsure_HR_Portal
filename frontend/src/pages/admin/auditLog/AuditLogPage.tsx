import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Input, Modal, Space, Table, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import * as auditLogApi from "../../../api/auditLog";
import type { AuditLogRow } from "../../../api/auditLog";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

export function AuditLogPage() {
  const [actorSearch, setActorSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  const query = {
    actorSearch: actorSearch || undefined,
    entityType: entityType || undefined,
    action: action || undefined,
    dateFrom: dateRange?.[0]?.format("YYYY-MM-DD"),
    dateTo: dateRange?.[1]?.format("YYYY-MM-DD"),
    page,
    pageSize,
  };
  const { data, isLoading } = useQuery({ queryKey: ["audit-log", query], queryFn: () => auditLogApi.listAuditLogs(query) });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Audit Log
      </Title>

      <Space wrap>
        <Input
          placeholder="Actor (name or code)"
          value={actorSearch}
          onChange={(e) => {
            setActorSearch(e.target.value);
            setPage(1);
          }}
          style={{ width: 200 }}
          allowClear
        />
        <Input
          placeholder="Entity type"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setPage(1);
          }}
          style={{ width: 160 }}
          allowClear
        />
        <Input
          placeholder="Action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          style={{ width: 200 }}
          allowClear
        />
        <RangePicker
          value={dateRange}
          onChange={(v) => {
            setDateRange(v as [Dayjs | null, Dayjs | null] | null);
            setPage(1);
          }}
        />
      </Space>

      <Table<AuditLogRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.rows ?? []}
        locale={{ emptyText: <EmptyState message="No matching audit entries." /> }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        columns={[
          { title: "When", dataIndex: "createdAt", render: (v: string) => dayjs(v).format("DD-MMM-YYYY HH:mm") },
          { title: "Actor", key: "actor", render: (_: unknown, r) => (r.actorName ? `${r.actorName} (${r.actorEmployeeCode})` : "System") },
          { title: "Action", dataIndex: "action" },
          { title: "Entity", key: "entity", render: (_: unknown, r) => `${r.entityType} · ${r.entityId}` },
          { title: "IP", dataIndex: "ipAddress" },
          { title: "", key: "detail", render: (_: unknown, r) => <a onClick={() => setDetail(r)}>Details</a> },
        ]}
      />

      <Modal title="Audit entry" open={!!detail} onCancel={() => setDetail(null)} footer={null} width={720} destroyOnHidden>
        {detail && (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Text>
              <b>{detail.action}</b> on {detail.entityType} ({detail.entityId})
            </Text>
            <Text type="secondary">
              {detail.actorName ? `${detail.actorName} (${detail.actorEmployeeCode})` : "System"} · {dayjs(detail.createdAt).format("DD-MMM-YYYY HH:mm:ss")}
              {detail.ipAddress ? ` · ${detail.ipAddress}` : ""}
            </Text>
            {detail.before !== null && (
              <>
                <Text strong>Before</Text>
                <pre style={{ background: "#fafafa", padding: 8, borderRadius: 4, maxHeight: 200, overflow: "auto" }}>{JSON.stringify(detail.before, null, 2)}</pre>
              </>
            )}
            {detail.after !== null && (
              <>
                <Text strong>After</Text>
                <pre style={{ background: "#fafafa", padding: 8, borderRadius: 4, maxHeight: 200, overflow: "auto" }}>{JSON.stringify(detail.after, null, 2)}</pre>
              </>
            )}
            <Button onClick={() => setDetail(null)}>Close</Button>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
