import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Checkbox } from "antd";
import { HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import * as payrollApi from "../../../api/payroll";
import type { EmployeeSalaryRow, SalaryRowView } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";
import { CancelScheduledModal } from "../../../components/payroll/CancelScheduledModal";
import { REASON_LABEL } from "./salaryText";
import { ApprovalBanner, DataTable, EmptyState, FilterBar, FormGroupTitle, PageHeader, Panel, QueryState, SideDrawer, SkeletonCard, Stack, StatusChip, Timeline, type ChipTone } from "../../../ui";
import { Caption, Num, PersonCell } from "../../../components/payroll/payrollUi";
import { fw, space, v } from "../../../theme/tokens";

// Payroll → Employee salaries (Phase 6 P6-2). Everybody's current salary, and each person's whole timeline. Nothing is edited here: a salary changes only through
// a salary revision, which somebody else approves. Amounts are exact; what is shown is what is stored. (The API decides who sees amounts; the UI never widens it.)

export function EmployeeSalariesPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const canEdit = hasPermission("payroll.salary.edit");
  const [q, setQ] = useState("");
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<EmployeeSalaryRow | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["payroll", "salaries", q, missing, page],
    queryFn: () => payrollApi.listEmployeeSalaries({ q: q || undefined, missing, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const timelineButton = (r: EmployeeSalaryRow, block?: boolean) => (
    <Button size={block ? undefined : "small"} block={block} icon={<HistoryOutlined />} onClick={(e) => { e.stopPropagation(); setOpen(r); }}>
      Timeline
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Employee salaries"
        subtitle="Everyone employed today, and the salary in force"
        actions={
          <>
            <Button onClick={() => navigate("/admin/payroll/revisions")}>Salary revisions</Button>
            {canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/admin/payroll/revisions?new=1")}>
                Prepare a revision
              </Button>
            )}
          </>
        }
      />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="A salary is never edited"
          description="It changes through a salary revision: one person prepares it with a preview, a different person approves exactly those figures, and only then is it written, from the date it says. Everyone employed today is listed."
        />
        <Panel>
          <FilterBar
            onSearch={(s) => { setQ(s.trim()); setPage(1); }}
            searchValue={q}
            searchPlaceholder="Employee code or name"
            activeCount={missing ? 1 : 0}
            onClear={() => { setMissing(false); setPage(1); }}
            filters={
              <Checkbox checked={missing} onChange={(e) => { setMissing(e.target.checked); setPage(1); }}>
                Only people with no salary on record
              </Checkbox>
            }
          />
          <DataTable<EmployeeSalaryRow>
            rowKey="employeeId"
            density="compact"
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.items ?? []}
            pagination={{ current: page, pageSize: 25, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
            showTotal
            onRowOpen={setOpen}
            empty={
              q || missing ? (
                <EmptyState kind="no-results" compact title="Nobody matches" description="Try another name or code, or clear the filter." action={<Button onClick={() => { setQ(""); setMissing(false); setPage(1); }}>Clear search and filter</Button>} />
              ) : (
                <EmptyState compact title="Nobody to list yet" description="People appear here once they are employed." />
              )
            }
            mobile={{
              title: (r) => r.name,
              subtitle: (r) => `${r.employeeCode}${r.branch ? ` · ${r.branch}` : ""}`,
              status: (r) => (r.current ? null : <StatusChip tone="neutral">No salary yet</StatusChip>),
              fields: [
                { label: "Yearly CTC", render: (r) => (r.current ? <Num>{formatRupees(r.current.annualCtc)}</Num> : "—") },
                { label: "A month", render: (r) => (r.current ? <Num>{formatRupees(r.current.monthlyCtc)}</Num> : "—") },
                { label: "Structure", render: (r) => r.current?.structure ?? "—" },
                { label: "Next change", render: (r) => (r.scheduled ? <NextChange s={r.scheduled} /> : "—") },
              ],
              actions: (r) => timelineButton(r, true),
            }}
            columns={[
              { title: "Employee", key: "employee", render: (_, r) => <PersonCell name={r.name} code={`${r.employeeCode}${r.branch ? ` · ${r.branch}` : ""}`} /> },
              { title: "Yearly CTC", key: "annual", align: "right", render: (_, r) => (r.current ? <Num>{formatRupees(r.current.annualCtc)}</Num> : <StatusChip tone="neutral">No salary yet</StatusChip>) },
              { title: "A month", key: "monthly", align: "right", render: (_, r) => (r.current ? <Num>{formatRupees(r.current.monthlyCtc)}</Num> : null) },
              { title: "Structure", key: "structure", render: (_, r) => r.current?.structure },
              { title: "Since", key: "since", render: (_, r) => (r.current ? formatDate(r.current.since) : null) },
              { title: "Next change", key: "next", render: (_, r) => (r.scheduled ? <NextChange s={r.scheduled} /> : null) },
              { title: "", key: "actions", align: "right", render: (_, r) => timelineButton(r) },
            ]}
          />
        </Panel>
      </Stack>
      {open && <SalaryTimelineDrawer person={open} onClose={() => setOpen(null)} canEdit={canEdit} />}
    </>
  );
}

function NextChange({ s }: { s: NonNullable<EmployeeSalaryRow["scheduled"]> }) {
  return (
    <StatusChip tone="info">
      <span className="ws-num">{formatRupees(s.annualCtc)}</span> from {formatDate(s.effectiveFrom)}
    </StatusChip>
  );
}

const ROW_STATUS: Record<SalaryRowView["status"], { tone: ChipTone; label: string; dot: "accent" | "info" | "neutral" }> = {
  current: { tone: "success", label: "In force", dot: "accent" },
  scheduled: { tone: "info", label: "Scheduled", dot: "info" },
  past: { tone: "neutral", label: "Past", dot: "neutral" },
};

function SalaryTimelineDrawer({ person, onClose, canEdit }: { person: EmployeeSalaryRow; onClose: () => void; canEdit: boolean }) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "salary-timeline", person.employeeId], queryFn: () => payrollApi.getEmployeeSalary(person.employeeId) });
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const componentName = (code: string) => components.find((c) => c.code === code)?.value?.name ?? code;
  const [cancelling, setCancelling] = useState<string | null>(null);
  return (
    <SideDrawer
      open
      size="wide"
      title={`${person.name} (${person.employeeCode})`}
      subtitle="Salary timeline"
      onClose={onClose}
      footer={
        canEdit ? (
          <div style={{ display: "flex", gap: space[3], width: "100%" }}>
            <Button size="large" style={{ flex: 1 }} onClick={onClose}>Close</Button>
            <Button size="large" type="primary" style={{ flex: 1 }} disabled={!data} onClick={() => navigate(`/admin/payroll/revisions?new=1&employee=${person.employeeId}`)}>
              {data && data.history.length === 0 ? "Give a first salary" : "Prepare a revision"}
            </Button>
          </div>
        ) : null
      }
    >
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonCard lines={6} />} compact>
        {data && (
          <Stack gap={space[3]}>
            <Caption>
              Joined {formatDate(data.joinedOn)}
              {data.lastWorkingDate ? `, last working day ${formatDate(data.lastWorkingDate)}` : ""}.
            </Caption>
            {data.history.length === 0 && <ApprovalBanner tone="info" title="No salary on record yet." description="A first salary is given through a salary revision, like every change." />}
            <Timeline
              items={data.history.map((r: SalaryRowView) => ({
                key: r.id,
                tone: ROW_STATUS[r.status].dot,
                content: (
                  <span style={{ display: "inline-flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>
                      {formatDate(r.effectiveFrom)}
                      {r.effectiveTo ? ` to before ${formatDate(r.effectiveTo)}` : " onwards"}
                    </span>
                    <StatusChip tone={ROW_STATUS[r.status].tone}>{ROW_STATUS[r.status].label}</StatusChip>
                    <StatusChip tone="neutral">{REASON_LABEL[r.reason]}</StatusChip>
                  </span>
                ),
                time: (
                  <span className="ws-num">
                    {formatRupees(r.annualCtc)} a year, {formatRupees(r.monthlyCtc)} a month, on {r.structure}
                  </span>
                ),
                detail: (
                  <Stack gap={space[3]}>
                    <DataTable
                      density="compact"
                      pagination={false}
                      rowKey="component"
                      dataSource={r.lines}
                      columns={[
                        { title: "Line", dataIndex: "component" },
                        { title: "A month", key: "amount", align: "right", render: (_, l) => <Num>{formatRupees(l.amount)}</Num> },
                      ]}
                      mobile={{ title: (l) => l.component, status: (l) => <Num>{formatRupees(l.amount)}</Num> }}
                    />
                    {r.note && <Caption>“{r.note}”</Caption>}
                    {canEdit && r.status === "scheduled" && r.id === data.history[0]?.id && data.history.length > 1 && (
                      <div>
                        <Button danger onClick={() => setCancelling(r.id)}>Cancel this scheduled salary</Button>
                      </div>
                    )}
                  </Stack>
                ),
              }))}
            />
            {data.pendingAdjustments.length > 0 && (
              <div>
                <FormGroupTitle>Waiting for the next run</FormGroupTitle>
                <DataTable
                  density="compact"
                  pagination={false}
                  rowKey="id"
                  dataSource={data.pendingAdjustments}
                  columns={[
                    { title: "What", dataIndex: "reason" },
                    { title: "Amount", key: "amount", align: "right", render: (_, a) => <Num>{`${a.direction === "DEDUCTION" ? "-" : ""}${formatRupees(a.amount)}`}</Num> },
                  ]}
                  mobile={{ title: (a) => a.reason, status: (a) => <Num>{`${a.direction === "DEDUCTION" ? "-" : ""}${formatRupees(a.amount)}`}</Num> }}
                />
              </div>
            )}
          </Stack>
        )}
      </QueryState>
      {cancelling && (
        <CancelScheduledModal
          employeeId={person.employeeId}
          salaryId={cancelling}
          componentName={componentName}
          onClose={() => setCancelling(null)}
          onSubmitted={(id) => navigate(`/admin/payroll/revisions?open=${id}`)}
        />
      )}
    </SideDrawer>
  );
}
