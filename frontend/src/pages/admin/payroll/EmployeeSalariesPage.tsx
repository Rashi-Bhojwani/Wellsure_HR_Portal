import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Drawer, Flex, Input, Space, Spin, Table, Tag, Timeline, Typography } from "antd";
import { HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import * as payrollApi from "../../../api/payroll";
import type { EmployeeSalaryRow, SalaryRowView } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";
import { CancelScheduledModal } from "../../../components/payroll/CancelScheduledModal";
import { REASON_LABEL } from "./salaryText";
import { fs } from "../../../theme/tokens";

const { Title, Text } = Typography;

// Payroll → Employee salaries (Phase 6 P6-2). Everybody's current salary, and each person's whole timeline. Nothing is edited here: a salary changes only through
// a salary revision, which somebody else approves. Amounts are exact; what is shown is what is stored.

export function EmployeeSalariesPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const canEdit = hasPermission("payroll.salary.edit");
  const [q, setQ] = useState("");
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<EmployeeSalaryRow | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "salaries", q, missing, page], queryFn: () => payrollApi.listEmployeeSalaries({ q: q || undefined, missing, page, pageSize: 25 }) });

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Title level={3} style={{ margin: 0 }}>
          Employee salaries
        </Title>
        <Space>
          <Link to="/admin/payroll/revisions">
            <Button>Salary revisions</Button>
          </Link>
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/admin/payroll/revisions?new=1")}>
              Prepare a revision
            </Button>
          )}
        </Space>
      </Flex>
      <Text type="secondary">
        A salary is never edited. It changes through a salary revision: one person prepares it with a preview, a different person approves exactly those figures, and only then is it written, from the date it says. Everyone employed today is listed.
      </Text>
      <Flex gap={12} wrap align="center">
        <Input.Search allowClear placeholder="Employee code or name" style={{ width: 280 }} onSearch={(v) => { setQ(v.trim()); setPage(1); }} />
        <Checkbox checked={missing} onChange={(e) => { setMissing(e.target.checked); setPage(1); }}>
          Only people with no salary on record
        </Checkbox>
      </Flex>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the salaries.")} />}
      <Table<EmployeeSalaryRow>
        rowKey="employeeId"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize: 25, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
        columns={[
          { title: "Employee", render: (_, r) => <div><Text strong>{r.name}</Text><div><Text type="secondary" style={{ fontSize: fs.sm }}>{r.employeeCode}{r.branch ? ` · ${r.branch}` : ""}</Text></div></div> },
          { title: "Yearly CTC", align: "right", render: (_, r) => (r.current ? formatRupees(r.current.annualCtc) : <Tag>No salary yet</Tag>) },
          { title: "A month", align: "right", render: (_, r) => (r.current ? formatRupees(r.current.monthlyCtc) : null) },
          { title: "Structure", render: (_, r) => r.current?.structure },
          { title: "Since", render: (_, r) => (r.current ? formatDate(r.current.since) : null) },
          { title: "Next change", render: (_, r) => (r.scheduled ? <Tag color="blue">{formatRupees(r.scheduled.annualCtc)} from {formatDate(r.scheduled.effectiveFrom)}</Tag> : null) },
          { title: "", align: "right", render: (_, r) => <Button size="small" icon={<HistoryOutlined />} onClick={() => setOpen(r)}>Timeline</Button> },
        ]}
      />
      {open && <SalaryTimelineDrawer person={open} onClose={() => setOpen(null)} canEdit={canEdit} />}
    </Flex>
  );
}

const STATUS_COLOR = { current: "green", scheduled: "blue", past: "gray" } as const;

function SalaryTimelineDrawer({ person, onClose, canEdit }: { person: EmployeeSalaryRow; onClose: () => void; canEdit: boolean }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["payroll", "salary-timeline", person.employeeId], queryFn: () => payrollApi.getEmployeeSalary(person.employeeId) });
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const componentName = (code: string) => components.find((c) => c.code === code)?.value?.name ?? code;
  const [cancelling, setCancelling] = useState<string | null>(null);
  return (
    <Drawer
      open
      width={640}
      title={`${person.name} (${person.employeeCode})`}
      onClose={onClose}
      destroyOnHidden
      extra={canEdit && <Button type="primary" onClick={() => navigate(`/admin/payroll/revisions?new=1&employee=${person.employeeId}`)}>{data && data.history.length === 0 ? "Give a first salary" : "Prepare a revision"}</Button>}
    >
      {isLoading && <Spin />}
      {data && (
        <Flex vertical gap={16}>
          <Text type="secondary">Joined {formatDate(data.joinedOn)}{data.lastWorkingDate ? `, last working day ${formatDate(data.lastWorkingDate)}` : ""}.</Text>
          {data.history.length === 0 && <Alert type="info" showIcon title="No salary on record yet." description="A first salary is given through a salary revision, like every change." />}
          <Timeline
            items={data.history.map((r: SalaryRowView) => ({
              color: STATUS_COLOR[r.status],
              content: (
                <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                  <Space wrap>
                    <Text strong>{formatDate(r.effectiveFrom)}{r.effectiveTo ? ` to before ${formatDate(r.effectiveTo)}` : " onwards"}</Text>
                    <Tag color={STATUS_COLOR[r.status]}>{r.status === "current" ? "In force" : r.status === "scheduled" ? "Scheduled" : "Past"}</Tag>
                    <Tag>{REASON_LABEL[r.reason]}</Tag>
                  </Space>
                  <Text>{formatRupees(r.annualCtc)} a year, {formatRupees(r.monthlyCtc)} a month, on {r.structure}</Text>
                  <Table size="small" pagination={false} rowKey="component" dataSource={r.lines} columns={[{ title: "Line", dataIndex: "component" }, { title: "A month", align: "right", render: (_, l) => formatRupees(l.amount) }]} />
                  {r.note && <Text type="secondary">“{r.note}”</Text>}
                  {canEdit && r.status === "scheduled" && r.id === data.history[0]?.id && data.history.length > 1 && (
                    <div>
                      <Button size="small" danger onClick={() => setCancelling(r.id)}>Cancel this scheduled salary</Button>
                    </div>
                  )}
                </Space>
              ),
            }))}
          />
          {data.pendingAdjustments.length > 0 && (
            <>
              <Text strong>Waiting for the next run</Text>
              <Table size="small" pagination={false} rowKey="id" dataSource={data.pendingAdjustments} columns={[{ title: "What", dataIndex: "reason" }, { title: "Amount", align: "right", render: (_, a) => `${a.direction === "DEDUCTION" ? "-" : ""}${formatRupees(a.amount)}` }]} />
            </>
          )}
        </Flex>
      )}
      {cancelling && (
        <CancelScheduledModal
          employeeId={person.employeeId}
          salaryId={cancelling}
          componentName={componentName}
          onClose={() => setCancelling(null)}
          onSubmitted={(id) => navigate(`/admin/payroll/revisions?open=${id}`)}
        />
      )}
    </Drawer>
  );
}
