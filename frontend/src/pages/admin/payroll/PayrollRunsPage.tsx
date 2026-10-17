import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Flex, List, Select, Space, Spin, Table, Tag, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import * as payrollApi from "../../../api/payroll";
import * as attendanceApi from "../../../api/attendance";
import type { PersonProblem, RunReadiness, RunSummary } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";
import { RUN_STATUS_COLOR } from "./runText";

const { Title, Text } = Typography;

// Payroll → Payroll runs (Phase 6 P6-3). One regular run per attendance cycle. Starting one shows what stands in its way first, the way the Finalisation screen does.
// A run on Placeholder rules is a TEST: it can be looked at, compared and exported, and nothing real can come out of it.

export function PayrollRunsPage() {
  const { hasPermission } = useAuth();
  const canRun = hasPermission("payroll.run");
  const [page, setPage] = useState(1);
  const [starting, setStarting] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["payroll", "runs", page],
    queryFn: () => payrollApi.listRuns(page, 25),
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === "CALCULATING") ? 3000 : false),
  });
  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Title level={3} style={{ margin: 0 }}>
          Payroll runs
        </Title>
        {canRun && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setStarting(true)}>
            Start a payroll run
          </Button>
        )}
      </Flex>
      <Text type="secondary">
        A run pays one attendance cycle, from the days attendance has finalised and the salary in force on each of them. You see what stands in its way before you start, what it came to once calculated, and how it differs from last month. A run that used any Placeholder rule is marked TEST everywhere, and cannot be approved, finalised, published or turned into a bank file.
      </Text>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the runs.")} />}
      <Table<RunSummary>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize: 25, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
        locale={{ emptyText: "No payroll runs yet." }}
        columns={[
          { title: "Cycle", render: (_, r) => <Link to={`/admin/payroll/run/${r.id}`}><Text strong>{r.cycle.label}</Text></Link> },
          {
            title: "Status",
            render: (_, r) => (
              <Space size={4}>
                <Tag color={RUN_STATUS_COLOR[r.status]}>{r.statusLabel}</Tag>
                {r.test && <Tag color="red">TEST</Tag>}
              </Space>
            ),
          },
          { title: "People", align: "right", render: (_, r) => (r.runHash ? `${r.counts.payable} payable${r.counts.held ? `, ${r.counts.held} held` : ""}${r.counts.excluded ? `, ${r.counts.excluded} left out` : ""}` : "") },
          { title: "Gross", align: "right", render: (_, r) => (r.runHash ? formatRupees(r.totals.gross) : "") },
          { title: "Net", align: "right", render: (_, r) => (r.runHash ? formatRupees(r.totals.net) : "") },
          { title: "Calculated", render: (_, r) => (r.calculatedAt ? formatDateTime(r.calculatedAt) : "") },
          { title: "", align: "right", render: (_, r) => <Link to={`/admin/payroll/run/${r.id}`}>Open</Link> },
        ]}
      />
      {starting && <StartRunDrawer onClose={() => setStarting(false)} />}
    </Flex>
  );
}

function People({ people, what }: { people: PersonProblem[]; what: string }) {
  if (people.length === 0) return null;
  return (
    <List
      size="small"
      dataSource={people}
      renderItem={(p) => (
        <List.Item>
          <Text>{p.name}</Text>
          <Text type="secondary">{p.days} {p.days === 1 ? "day" : "days"} {what}: {p.firstDays.map(formatDate).join(", ")}{p.days > p.firstDays.length ? " ..." : ""}</Text>
        </List.Item>
      )}
    />
  );
}

function Check({ ok, title, children }: { ok: boolean; title: string; children?: React.ReactNode }) {
  return <Alert type={ok ? "success" : "warning"} showIcon title={title} description={children} />;
}

function StartRunDrawer({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cycleStart, setCycleStart] = useState<string>();
  const cycles = useQuery({ queryKey: ["attendance", "cycle"], queryFn: attendanceApi.getCycle });
  const readiness = useQuery({ queryKey: ["payroll", "readiness", cycleStart], enabled: !!cycleStart, queryFn: () => payrollApi.getRunReadiness(cycleStart!), retry: false });
  const create = useMutation({
    mutationFn: () => payrollApi.createRun(cycleStart!),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["payroll", "runs"] });
      navigate(`/admin/payroll/run/${id}`);
    },
    onError: (e) => void message.error(apiErrorMessage(e, "Could not start the run.")),
  });
  const r: RunReadiness | undefined = readiness.data;
  return (
    <Drawer open width={720} title="Start a payroll run" onClose={onClose} destroyOnHidden>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Text type="secondary">Which attendance cycle</Text>
          <Select
            style={{ width: "100%" }}
            placeholder="Choose a cycle"
            loading={cycles.isLoading}
            value={cycleStart}
            onChange={setCycleStart}
            options={(cycles.data?.recent ?? []).map((c) => ({ value: c.start, label: `${c.label} (${formatDate(c.start)} to ${formatDate(c.end)})` }))}
          />
        </div>
        {readiness.isLoading && <Spin />}
        {readiness.error && <Alert type="error" showIcon title={apiErrorMessage(readiness.error, "Could not check this cycle.")} />}
        {r && (
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            <Text strong>{r.people} {r.people === 1 ? "person was" : "people were"} employed in {r.cycle.label}.</Text>
            <Check ok={r.cycleOver} title={r.cycleOver ? "The cycle has ended" : `The cycle runs to ${formatDate(r.cycle.end)}`}>
              {!r.cycleOver && "Payroll is run after the cycle has ended and its attendance is finalised."}
            </Check>
            <Check ok={r.attendance.unfinalisedCount === 0} title={r.attendance.unfinalisedCount === 0 ? "Everyone's attendance is finalised" : `${r.attendance.unfinalisedCount} ${r.attendance.unfinalisedCount === 1 ? "person has" : "people have"} days attendance has not finalised`}>
              {r.attendance.unfinalisedCount > 0 && (
                <>
                  <Text>They are left out of the run, and listed, until their days are finalised. Payroll never pays from a day that can still change.</Text>
                  <People people={r.attendance.unfinalised} what="not finalised" />
                </>
              )}
            </Check>
            <Check ok={r.salary.gapCount === 0} title={r.salary.gapCount === 0 ? "Everyone has a salary for the days they were employed" : `${r.salary.gapCount} ${r.salary.gapCount === 1 ? "person has" : "people have"} days with no salary on record`}>
              {r.salary.gapCount > 0 && (
                <>
                  <Text>They are left out, and never paid zero silently. Give them a salary through a salary revision.</Text>
                  <People people={r.salary.gaps} what="without a salary" />
                </>
              )}
            </Check>
            <Check ok={r.bank.missingCount === 0} title={r.bank.missingCount === 0 ? `Everyone has a bank account on the payment date${r.paymentDate ? ` (${formatDate(r.paymentDate)})` : ""}` : `${r.bank.missingCount} ${r.bank.missingCount === 1 ? "person has" : "people have"} no bank account on the payment date`}>
              {r.bank.missingCount > 0 && <Text>They are calculated but held: they will not be in a bank file until an account is in force. {r.bank.missing.map((b) => b.name).join(", ")}</Text>}
            </Check>
            <Check ok={r.rules.missing.length === 0} title={r.rules.missing.length === 0 ? "Every rule the calculation needs has a value" : `${r.rules.missing.length} ${r.rules.missing.length === 1 ? "rule has" : "rules have"} no value yet, so it cannot be calculated`}>
              {r.rules.missing.length > 0 && (
                <>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{r.rules.missing.map((m) => <li key={m.key}>{m.label}</li>)}</ul>
                  <Link to="/admin/payroll/rules">Enter them under Rules and setup</Link>
                </>
              )}
            </Check>
            {r.rules.placeholders.length > 0 && (
              <Alert
                type="error"
                showIcon
                title="This run will be a TEST"
                description={
                  <>
                    <Text>These are still Placeholders (or not set), so the run can be looked at but nothing real can come out of it:</Text>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>{r.rules.placeholders.map((p) => <li key={`${p.kind}-${p.key}-${p.label}`}>{p.label}</li>)}</ul>
                  </>
                }
              />
            )}
            <Alert type="info" showIcon title="Waiting for this run" description={`${r.adjustments.pending} adjustment${r.adjustments.pending === 1 ? "" : "s"}, ${r.adjustments.arrears} arrears, ${r.adjustments.encashments} leave encashment${r.adjustments.encashments === 1 ? "" : "s"}${r.adjustments.encashmentsPaidLater ? `; ${r.adjustments.encashmentsPaidLater} more are paid in a later run` : ""}.`} />
            {r.existingRun && (
              <Alert type="warning" showIcon title="There is already a run for this cycle" description={<Link to={`/admin/payroll/run/${r.existingRun.id}`}>Open it</Link>} />
            )}
            <Button type="primary" size="large" disabled={!r.canCreate} loading={create.isPending} onClick={() => create.mutate()}>
              Create the run for {r.cycle.label}
            </Button>
            <Text type="secondary">Creating the run does not calculate anything. You will see exactly what the calculation changes before you confirm it.</Text>
          </Space>
        )}
      </Space>
    </Drawer>
  );
}
